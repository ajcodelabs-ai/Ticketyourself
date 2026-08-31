"""
Order business logic — capacity reservation, ticket emission, totals.

Mode-agnostic: works for free events (instant paid), Stripe checkout, and the
DEV simulator. The webhook handler delegates the "mark paid + emit tickets"
step to `finalize_paid_order` so the path is single-sourced.
"""

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from db_helpers import row_to_dict
from services.ticket_jwt import issue_ticket_token

logger = logging.getLogger("tys.orders")

RESERVATION_TTL_MIN = 15
MANUAL_RESERVATION_TTL_HOURS = 48  # transfer / cash buyers get 48h to complete
MAX_QUANTITY = 10
ORDER_PREFIX = "TYS-"
VALID_PAYMENT_METHODS = (
    "stripe",
    "nuvei",
    "deuna",
    "paypal",
    "transfer",
    "cash",
    "season_pass",
    "demo",  # dev/staging bypass — gated by routers.dev._dev_enabled(), see routers/orders.py
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Order number sequence ────────────────────────────────────────────────────
async def _next_order_number() -> str:
    """Atomic sequential order number via PostgreSQL SEQUENCE (nextval)."""
    from sqlalchemy import text

    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT nextval('ticket_order_seq')"))
        seq = result.scalar()
    return f"{ORDER_PREFIX}{seq:06d}"


# ── Capacity ─────────────────────────────────────────────────────────────────
async def _active_reservation_qty(event_id: str, function_id: str | None = None) -> int:
    """Sum of un-expired capacity reservations for an event, optionally scoped
    to a single función's own pool (when `function_id` is given)."""
    from sqlalchemy import func, select

    from database import AsyncSessionLocal
    from orm_models import EventCapacityReservation

    now = _now()
    conditions = [
        EventCapacityReservation.event_id == event_id,
        EventCapacityReservation.expires_at > now,
    ]
    if function_id is not None:
        conditions.append(EventCapacityReservation.function_id == function_id)
    async with AsyncSessionLocal() as session:
        total = (
            await session.scalar(
                select(
                    func.coalesce(func.sum(EventCapacityReservation.quantity), 0)
                ).where(*conditions)
            )
            or 0
        )
    return total


async def compute_availability(event: dict, function: dict | None = None) -> dict:
    """Returns {capacity, sold, reserved, available}. None capacity = unlimited.

    When `function` has its own `capacity` set, availability is computed
    against that función's own pool (capacity/tickets_sold/reservations
    scoped to function_id) instead of the event-level pool. Functions
    without an explicit capacity fall back to sharing the event's pool."""
    if function and function.get("capacity") is not None:
        capacity = function["capacity"]
        sold = function.get("tickets_sold") or 0
        reserved = await _active_reservation_qty(
            event["id"], function_id=function["id"]
        )
        available = max(0, capacity - sold - reserved)
        return {
            "capacity": capacity,
            "sold": sold,
            "reserved": reserved,
            "available": available,
        }

    capacity = event.get("capacity")
    sold = event.get("tickets_sold") or 0
    if capacity is None:
        return {"capacity": None, "sold": sold, "reserved": 0, "available": None}
    reserved = await _active_reservation_qty(event["id"])
    available = max(0, capacity - sold - reserved)
    return {
        "capacity": capacity,
        "sold": sold,
        "reserved": reserved,
        "available": available,
    }


async def reserve_capacity(
    *,
    event: dict,
    order_id: str,
    quantity: int,
    ttl_minutes: int | None = None,
    function_id: str | None = None,
    session: AsyncSession | None = None,
) -> None:
    from sqlalchemy import func, select

    from orm_models import Event as _Event
    from orm_models import EventCapacityReservation

    minutes = ttl_minutes if ttl_minutes is not None else RESERVATION_TTL_MIN
    now = _now()

    async def _do(s: AsyncSession) -> None:
        event_row = await s.scalar(
            select(_Event).where(_Event.id == event["id"]).with_for_update()
        )
        if event_row is None:
            raise HTTPException(404, "Evento no encontrado")

        cap = event_row.capacity
        if cap is not None:
            sold = event_row.tickets_sold or 0
            reserved_result = await s.scalar(
                select(
                    func.coalesce(func.sum(EventCapacityReservation.quantity), 0)
                ).where(
                    EventCapacityReservation.event_id == event["id"],
                    EventCapacityReservation.expires_at > now,
                    EventCapacityReservation.order_id != order_id,
                )
            )
            already_reserved = reserved_result or 0
            if sold + already_reserved + quantity > cap:
                raise HTTPException(
                    409, "No hay suficiente capacidad disponible en este momento"
                )

        s.add(
            EventCapacityReservation(
                event_id=event["id"],
                order_id=order_id,
                quantity=quantity,
                function_id=function_id,
                expires_at=now + timedelta(minutes=minutes),
                created_at=now,
            )
        )

    if session is not None:
        await _do(session)
    else:
        async with AsyncSessionLocal() as s:
            await _do(s)
            await s.commit()


async def release_reservation(order_id: str) -> None:
    from sqlalchemy import delete

    from database import AsyncSessionLocal
    from orm_models import EventCapacityReservation

    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(EventCapacityReservation).where(
                EventCapacityReservation.order_id == order_id
            )
        )
        await session.commit()


# ── Validation ──────────────────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NAME_BAD = re.compile(r"[<>{}\[\]\\]")


def validate_buyer(buyer: dict) -> dict:
    name = (buyer.get("name") or "").strip()
    email = (buyer.get("email") or "").strip().lower()
    if not name or len(name) < 2:
        raise HTTPException(422, "Nombre del comprador requerido")
    if _NAME_BAD.search(name):
        raise HTTPException(422, "El nombre contiene caracteres inválidos")
    if not _EMAIL_RE.match(email):
        raise HTTPException(422, "Email inválido")
    return {
        "name": name[:140],
        "email": email,
        "phone": (buyer.get("phone") or "")[:40],
        "document_id": (buyer.get("document_id") or "")[:40],
        "document_type": (buyer.get("document_type") or "")[:20],
    }


# ── Totals ──────────────────────────────────────────────────────────────────
def _ticket_fees_per_unit(event: dict) -> dict:
    """PRD §4.2.1 Pagado — fees for general (non-seated) events."""
    raw = event.get("ticket_fees") or {}
    return {
        "service_fee_cents": int(raw.get("service_fee_cents") or 0),
        "ticketseguro_cents": int(
            raw.get("ticketseguro_cents") or raw.get("admin_fee_cents") or 0
        ),
        "tax_cents": int(raw.get("tax_cents") or raw.get("vxs_cents") or 0),
        "wallet_fee_cents": int(raw.get("wallet_fee_cents") or 0),
    }


def compute_totals(
    *,
    event: dict,
    quantity: int,
    donation_amount_cents: int = 0,
    sales_fee_rules: list | None = None,
    plan_code: str | None = None,
) -> dict:
    from services.sales_fees import apply_platform_fee

    pricing = event.get("pricing_type", "free")
    if pricing == "free":
        if donation_amount_cents > 0:
            if not event.get("optional_donation_enabled"):
                raise HTTPException(422, "Este evento no acepta aportes voluntarios")
            if donation_amount_cents < 100:
                raise HTTPException(422, "El aporte mínimo es $1")
            totals = {
                "unit_price_cents": donation_amount_cents,
                "subtotal_cents": donation_amount_cents,
                "fees_cents": 0,
                "total_cents": donation_amount_cents,
                "donation_amount_cents": donation_amount_cents,
            }
            return apply_platform_fee(
                totals,
                event=event,
                unit_prices=[donation_amount_cents],
                sales_fee_rules=sales_fee_rules,
                plan_code=plan_code,
            )
        return {
            "unit_price_cents": 0,
            "subtotal_cents": 0,
            "fees_cents": 0,
            "total_cents": 0,
            "donation_amount_cents": 0,
            "platform_fee_bearer": event.get("platform_fee_bearer") or "buyer",
        }
    if pricing == "donation":
        if donation_amount_cents < 100:
            raise HTTPException(422, "El aporte mínimo es $1")
        subtotal = donation_amount_cents
        totals = {
            "unit_price_cents": donation_amount_cents,
            "subtotal_cents": subtotal,
            "fees_cents": 0,
            "total_cents": subtotal,
            "donation_amount_cents": donation_amount_cents,
        }
        return apply_platform_fee(
            totals,
            event=event,
            unit_prices=[donation_amount_cents],
            sales_fee_rules=sales_fee_rules,
            plan_code=plan_code,
        )
    unit = event.get("base_price_cents") or 0
    tf = _ticket_fees_per_unit(event)
    entrada = unit * quantity
    service = tf["service_fee_cents"] * quantity
    ticketseguro = tf["ticketseguro_cents"] * quantity
    tax = tf["tax_cents"] * quantity
    wallet = tf["wallet_fee_cents"] * quantity
    subtotal = entrada + service + ticketseguro + tax + wallet
    totals = {
        "unit_price_cents": unit,
        "subtotal_cents": subtotal,
        "entrada_cents": entrada,
        "service_fee_cents": service,
        "admin_fee_cents": ticketseguro,  # TicketSeguro (legacy key for UI)
        "ticketseguro_cents": ticketseguro,
        "vxs_cents": tax,  # Impuestos (legacy key for UI)
        "tax_cents": tax,
        "wallet_fee_cents": wallet,
        "fees_cents": 0,
        "total_cents": subtotal,
        "donation_amount_cents": 0,
    }
    return apply_platform_fee(
        totals,
        event=event,
        unit_prices=[unit] * max(0, int(quantity)),
        sales_fee_rules=sales_fee_rules,
        plan_code=plan_code,
    )


def locality_pricing_map(event: dict) -> dict:
    return {lp["locality_id"]: lp for lp in (event.get("locality_pricing") or [])}


def locality_fee_cents(pricing_map: dict, locality_id: str | None) -> tuple[int, int]:
    """service_fee_cents / TicketSeguro (admin_fee_cents) for a locality, or (0, 0)."""
    lp = pricing_map.get(locality_id) if locality_id else None
    if not lp:
        return 0, 0
    return int(lp.get("service_fee_cents") or 0), int(lp.get("admin_fee_cents") or 0)


def locality_extra_fees(pricing_map: dict, locality_id: str | None) -> dict:
    lp = pricing_map.get(locality_id) if locality_id else None
    if not lp:
        return {
            "service_fee_cents": 0,
            "admin_fee_cents": 0,
            "vxs_cents": 0,
            "wallet_fee_cents": 0,
        }
    return {
        "service_fee_cents": int(lp.get("service_fee_cents") or 0),
        "admin_fee_cents": int(lp.get("admin_fee_cents") or 0),
        "vxs_cents": int(lp.get("vxs_cents") or 0),
        "wallet_fee_cents": int(lp.get("wallet_fee_cents") or 0),
    }


def compute_totals_with_seats(
    *,
    event: dict,
    venue: dict,
    seat_ids: list[str],
    sales_fee_rules: list | None = None,
    plan_code: str | None = None,
) -> dict:
    """Per-locality pricing for seat-numbered events.

    Per seat the buyer pays entrada + cargo servicio + TicketSeguro + impuestos
    + billetera. Platform sales commission applies only to the entrada
    (admin matrix, falling back to `TYS_FEE_PERCENT`).
    """
    from services.seats import seats_by_id

    if not seat_ids:
        raise HTTPException(422, "No seleccionaste asientos.")
    pricing_map = locality_pricing_map(event)
    by_id = seats_by_id(venue)
    subtotal = 0
    entrada_subtotal = 0
    service_subtotal = 0
    admin_subtotal = 0
    vxs_subtotal = 0
    wallet_subtotal = 0
    missing_loc = []
    unit_prices: list[int] = []
    for sid in seat_ids:
        seat = by_id.get(sid)
        if not seat:
            raise HTTPException(422, f"Asiento {sid} no existe en el venue.")
        loc_id = seat.get("locality_id")
        lp = pricing_map.get(loc_id)
        if not lp:
            missing_loc.append(loc_id or "(sin localidad)")
            continue
        entrada = int(lp.get("price_cents") or 0)
        extras = locality_extra_fees(pricing_map, loc_id)
        unit_prices.append(entrada)
        entrada_subtotal += entrada
        service_subtotal += extras["service_fee_cents"]
        admin_subtotal += extras["admin_fee_cents"]
        vxs_subtotal += extras["vxs_cents"]
        wallet_subtotal += extras["wallet_fee_cents"]
        subtotal += (
            entrada
            + extras["service_fee_cents"]
            + extras["admin_fee_cents"]
            + extras["vxs_cents"]
            + extras["wallet_fee_cents"]
        )
    if missing_loc:
        raise HTTPException(422, f"El evento no tiene precio para: {set(missing_loc)}")
    from services.sales_fees import apply_platform_fee

    avg_unit = entrada_subtotal // max(1, len(seat_ids))
    totals = {
        # unit_price_cents = average entrada only (excludes service/admin/vxs/wallet)
        "unit_price_cents": avg_unit,
        "subtotal_cents": subtotal,
        "entrada_cents": entrada_subtotal,
        "service_fee_cents": service_subtotal,
        "admin_fee_cents": admin_subtotal,
        "ticketseguro_cents": admin_subtotal,
        "vxs_cents": vxs_subtotal,
        "tax_cents": vxs_subtotal,
        "wallet_fee_cents": wallet_subtotal,
        "fees_cents": 0,
        "total_cents": subtotal,
        "donation_amount_cents": 0,
    }
    return apply_platform_fee(
        totals,
        event=event,
        unit_prices=unit_prices,
        sales_fee_rules=sales_fee_rules,
        plan_code=plan_code,
    )


# ── Create order ────────────────────────────────────────────────────────────
async def create_order_skeleton(
    *,
    event: dict,
    organizer: dict,
    quantity: int,
    buyer: dict,
    totals: dict,
    payment_method: str = "stripe",
    seat_ids: list[str] | None = None,
    seat_holds_session_token: str | None = None,
    function: dict | None = None,
    items_override: list[dict] | None = None,
    access_code_id: str | None = None,
    custom_answers: dict[str, str] | None = None,
    law_category: str | None = None,
    law_document_id: str | None = None,
) -> dict:
    from database import AsyncSessionLocal
    from orm_models import TicketOrder

    function_id = function["id"] if function else None

    if quantity < 1 or quantity > MAX_QUANTITY:
        raise HTTPException(422, f"Cantidad debe estar entre 1 y {MAX_QUANTITY}")
    if payment_method not in VALID_PAYMENT_METHODS:
        raise HTTPException(422, f"Método de pago inválido: {payment_method}")

    from services.payment_methods import (
        GATEWAY_STUB_CODES,
        MANUAL_CODES,
        accepts_payment_method,
    )

    # Free / season_pass / demo paths pass through without catalog checks.
    # Free + optional donation > 0 must still validate the chosen gateway.
    needs_payment_check = payment_method not in ("season_pass", "demo") and (
        event.get("pricing_type") != "free"
        or (
            event.get("optional_donation_enabled")
            and int(totals.get("donation_amount_cents") or 0) > 0
        )
    )
    if needs_payment_check:
        if not accepts_payment_method(event, payment_method):
            raise HTTPException(
                400, f"El organizador no acepta pagos con '{payment_method}'"
            )

    avail = await compute_availability(event, function=function)
    if avail["available"] is not None and quantity > avail["available"]:
        raise HTTPException(409, "No hay capacidad disponible para esa cantidad")

    is_manual = payment_method in MANUAL_CODES
    is_gateway_stub = payment_method in GATEWAY_STUB_CODES
    is_live_gateway = payment_method in ("nuvei", "deuna")
    if is_manual:
        ttl = timedelta(hours=MANUAL_RESERVATION_TTL_HOURS)
        initial_status = "pending_manual_payment"
    elif is_gateway_stub:
        ttl = timedelta(minutes=RESERVATION_TTL_MIN)
        initial_status = "pending_gateway"
    elif is_live_gateway:
        ttl = timedelta(minutes=RESERVATION_TTL_MIN)
        initial_status = "pending"
    else:
        ttl = timedelta(minutes=RESERVATION_TTL_MIN)
        initial_status = "pending"

    order_id = str(uuid.uuid4())
    order_number = await _next_order_number()
    order_token = str(uuid.uuid4())  # Guest access token — unguessable UUID v4
    now = _now()

    order_items = (
        items_override
        if items_override
        else [
            {
                "ticket_type": "general",
                "quantity": quantity,
                "unit_price_cents": totals["unit_price_cents"],
                "subtotal_cents": totals["subtotal_cents"],
            }
        ]
    )

    row = TicketOrder(
        id=order_id,
        order_number=order_number,
        order_token=order_token,
        event_id=event["id"],
        organizer_id=organizer["id"],
        tenant_slug=organizer.get("slug"),
        buyer=buyer,
        buyer_email=buyer["email"],
        status=initial_status,
        payment_method=payment_method,
        quantity_total=quantity,
        subtotal_cents=totals["subtotal_cents"],
        fees_cents=totals["fees_cents"],
        total_cents=totals["total_cents"],
        currency=event.get("currency", "USD"),
        donation_amount_cents=totals.get("donation_amount_cents") or None,
        discount_total_cents=int(totals.get("discount_total_cents") or 0),
        discounts_applied=totals.get("discounts_applied") or [],
        items=order_items,
        function_id=function_id,
        seat_ids=seat_ids or None,
        seat_holds_session_token=seat_holds_session_token,
        manual_payment_info=(
            {
                "method": payment_method,
                "reference": None,
                "paid_at": None,
                "confirmed_by": None,
                "confirmed_at": None,
                "organizer_notes": None,
            }
            if is_manual
            else None
        ),
        metadata_={
            "source": "web",
            **({"access_code_id": access_code_id} if access_code_id else {}),
            **({"custom_answers": custom_answers} if custom_answers else {}),
            **({"law_category": law_category} if law_category else {}),
            **({"law_document_id": law_document_id} if law_document_id else {}),
        },
        expires_at=now + ttl,
        created_at=now,
        updated_at=now,
    )

    access_type = (event.get("access_params") or {}).get("access_type", "open")
    async with AsyncSessionLocal() as session:
        if access_type == "verified_list":
            from services.access_control import relock_and_check_guest_cap

            try:
                await relock_and_check_guest_cap(
                    session,
                    event_id=event["id"],
                    email=(buyer.get("email") or "").strip().lower() or None,
                    cedula=(buyer.get("document_id") or "").strip() or None,
                    quantity=quantity,
                )
            except ValueError as exc:
                raise HTTPException(403, str(exc)) from exc
        session.add(row)
        await session.commit()
        await session.refresh(row)
        order = row_to_dict(row)

    if seat_ids and seat_holds_session_token:
        from services.seats import consume_holds_for_order

        await consume_holds_for_order(
            event_id=event["id"],
            session_token=seat_holds_session_token,
            seat_ids=seat_ids,
            order_id=order_id,
            function_id=function_id or "",
        )
    return order


# ── Issue tickets ───────────────────────────────────────────────────────────
async def issue_tickets_for_order(order: dict) -> list[dict]:
    """Idempotent — only issues if the order has no tickets yet."""
    from sqlalchemy import func, select

    from database import AsyncSessionLocal
    from orm_models import Ticket as TicketModel

    async with AsyncSessionLocal() as session:
        existing_count = (
            await session.scalar(
                select(func.count(TicketModel.id)).where(
                    TicketModel.order_id == order["id"]
                )
            )
            or 0
        )
        if existing_count:
            result = await session.execute(
                select(TicketModel).where(TicketModel.order_id == order["id"])
            )
            return [row_to_dict(r) for r in result.scalars().all()]

    from db_helpers import get_event_by_id

    event = await get_event_by_id(order["event_id"])
    if not event:
        raise HTTPException(404, "Event vanished")

    holder_base = order.get("buyer") or {}
    now = _now()
    raffle_enabled = event.get("pricing_type") == "donation" and event.get(
        "raffle_enabled"
    )

    async with AsyncSessionLocal() as session:
        next_raffle_number = None
        if raffle_enabled:
            from orm_models import Event as _EventModel

            ev_row = await session.scalar(
                select(_EventModel)
                .where(_EventModel.id == order["event_id"])
                .with_for_update()
            )
            next_raffle_number = ev_row.raffle_numbers_issued or 0

        for _ in range(order["quantity_total"]):
            ticket_id = str(uuid.uuid4())
            token = issue_ticket_token(
                ticket_id=ticket_id,
                event_id=order["event_id"],
                order_id=order["id"],
                buyer_email=holder_base.get("email", ""),
                event_ends_at_iso=event.get("ends_at"),
            )
            raffle_number = None
            if raffle_enabled:
                next_raffle_number += 1
                raffle_number = f"{next_raffle_number:06d}"
            session.add(
                TicketModel(
                    id=ticket_id,
                    order_id=order["id"],
                    event_id=order["event_id"],
                    organizer_id=order["organizer_id"],
                    tenant_slug=order.get("tenant_slug"),
                    order_number=order["order_number"],
                    holder={
                        "name": holder_base.get("name"),
                        "email": holder_base.get("email"),
                        "phone": holder_base.get("phone"),
                        "document_id": holder_base.get("document_id"),
                    },
                    holder_name=holder_base.get("name") or "",
                    holder_email=holder_base.get("email") or "",
                    qr_token=token,
                    status="issued",
                    issued_at=now,
                    created_at=now,
                    raffle_number=raffle_number,
                )
            )
        if raffle_enabled:
            ev_row.raffle_numbers_issued = next_raffle_number
        await session.commit()
        result = await session.execute(
            select(TicketModel).where(TicketModel.order_id == order["id"])
        )
        return [row_to_dict(r) for r in result.scalars().all()]


# ── Phase 7 — seat assignment helper ────────────────────────────────────────
async def _assign_seats_if_needed(order: dict, tickets: list[dict]) -> None:
    if not order.get("seat_ids"):
        return
    from db_helpers import get_event_by_id
    from services.event_venue import resolve_event_venue

    event_doc = await get_event_by_id(order["event_id"])
    if not event_doc or not event_doc.get("venue_id"):
        return
    venue_doc = await resolve_event_venue(event_doc)
    if not venue_doc:
        return
    from services.seats import assign_seats_to_tickets

    await assign_seats_to_tickets(
        event_id=event_doc["id"],
        venue=venue_doc,
        order=order,
        tickets=tickets,
    )


# ── Phase 8 — per-función / per-ticket-type counters ────────────────────────
async def _adjust_function_counters(order: dict, delta: int) -> None:
    """Bump (or, on refund, un-bump) `EventFunction.tickets_sold` and
    `FunctionTicketType.tickets_sold` for orders placed against a función.
    `delta` is +1 on paid/confirmed, -1 on refund. No-op for orders without
    `function_id` (general, non-multi-función events)."""
    function_id = order.get("function_id")
    if not function_id:
        return
    from sqlalchemy import update as _sa_update

    from orm_models import EventFunction, FunctionTicketType

    async with AsyncSessionLocal() as session:
        await session.execute(
            _sa_update(EventFunction)
            .where(EventFunction.id == function_id)
            .values(
                tickets_sold=EventFunction.tickets_sold
                + delta * order["quantity_total"]
            )
        )
        for item in order.get("items") or []:
            ticket_type_id = item.get("ticket_type_id")
            if not ticket_type_id:
                continue
            await session.execute(
                _sa_update(FunctionTicketType)
                .where(
                    FunctionTicketType.function_id == function_id,
                    FunctionTicketType.ticket_type_id == ticket_type_id,
                )
                .values(
                    tickets_sold=FunctionTicketType.tickets_sold
                    + delta * item.get("quantity", 0)
                )
            )
        await session.commit()


# ── Consume codes on payment confirmation ───────────────────────────────────
async def _consume_purchase_side_effects(order: dict) -> None:
    """Bump promo-code / access-code use counters and stamp guest-list entries
    as used. Shared by `finalize_paid_order` (Stripe/free) and
    `confirm_manual_payment` (transfer/cash) — both transition an order into
    `status=paid` and must consume codes exactly once, here."""
    for applied in order.get("discounts_applied") or []:
        if applied.get("type") != "promo_code" or not applied.get("rule_id"):
            continue
        try:
            from services.discount_service import consume_promo_code

            await consume_promo_code(order["event_id"], applied["rule_id"])
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to bump uses_count for promo code rule %s",
                applied.get("rule_id"),
            )

    access_code_id = (order.get("metadata") or {}).get("access_code_id")
    if access_code_id:
        try:
            from services.access_control import consume_access_code

            await consume_access_code(access_code_id)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to bump uses_count for access code %s", access_code_id
            )
    else:
        try:
            from db_helpers import get_event_by_id

            ev = await get_event_by_id(order["event_id"])
            if (
                ev
                and (ev.get("access_params") or {}).get("access_type")
                == "verified_list"
            ):
                from services.access_control import mark_guest_list_used

                buyer = order.get("buyer") or {}
                await mark_guest_list_used(
                    order["event_id"],
                    buyer.get("email"),
                    buyer.get("document_id"),
                )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Failed to mark guest-list entry used for order %s", order["id"]
            )


# ── Mark paid + emit ────────────────────────────────────────────────────────
async def finalize_paid_order(
    *, order: dict, stripe_session_id: str | None = None
) -> tuple[dict, list[dict]]:
    """
    Idempotent state transition: pending → paid, emit tickets, bump event.tickets_sold,
    release reservation.
    """
    from sqlalchemy import select
    from sqlalchemy import update as _sa_update

    from database import AsyncSessionLocal
    from orm_models import Event as _Event
    from orm_models import Ticket as TicketModel
    from orm_models import TicketOrder as TOModel

    async with AsyncSessionLocal() as _re_read:
        fresh = await _re_read.scalar(select(TOModel).where(TOModel.id == order["id"]))
    if fresh is None:
        raise HTTPException(404, "Orden no encontrada")
    if fresh.status == "paid":
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TicketModel).where(TicketModel.order_id == order["id"])
            )
            return row_to_dict(fresh), [row_to_dict(r) for r in result.scalars().all()]

    now = _now()
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        row.status = "paid"
        row.paid_at = now
        row.updated_at = now
        if stripe_session_id:
            row.stripe_session_id = stripe_session_id
        await session.commit()

    tickets = await issue_tickets_for_order(order)
    await _assign_seats_if_needed(order, tickets)

    async with AsyncSessionLocal() as _pg:
        await _pg.execute(
            _sa_update(_Event)
            .where(_Event.id == order["event_id"])
            .values(
                tickets_sold=_Event.tickets_sold + order["quantity_total"],
                updated_at=now,
            )
        )
        await _pg.commit()
    await _adjust_function_counters(order, +1)
    await release_reservation(order["id"])
    await _consume_purchase_side_effects(order)

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        refreshed = row_to_dict(row)

    logger.info(
        "Order paid: %s event=%s qty=%d total=%d",
        refreshed["order_number"],
        refreshed["event_id"],
        refreshed["quantity_total"],
        refreshed["total_cents"],
    )
    return refreshed, tickets


# ── Stripe Checkout for ticket purchase ─────────────────────────────────────
def create_ticket_checkout_session(
    *,
    order: dict,
    event: dict,
    success_url: str,
    cancel_url: str,
) -> dict:
    line_items = [
        {
            "price_data": {
                "currency": order.get("currency", "usd").lower(),
                "product_data": {
                    "name": f"{event['title']} · {order['quantity_total']} entradas",
                    "description": order["buyer"]["email"],
                },
                "unit_amount": order["total_cents"],
            },
            "quantity": 1,
        }
    ]
    session = stripe.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        customer_email=order["buyer"]["email"],
        line_items=line_items,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "order_id": order["id"],
            "order_number": order["order_number"],
            "event_id": event["id"],
            "tys_purpose": "ticket_purchase",
        },
    )
    return {"id": session.id, "url": session.url}


# ── Refund ──────────────────────────────────────────────────────────────────
async def refund_order(*, order: dict, reason: str | None = None) -> dict:
    from sqlalchemy import select
    from sqlalchemy import update as _sa_update

    from database import AsyncSessionLocal
    from orm_models import Event as _Event
    from orm_models import Ticket as TicketModel
    from orm_models import TicketOrder as TOModel

    if order["status"] != "paid":
        raise HTTPException(422, "Sólo órdenes pagadas pueden reembolsarse")

    if order.get("stripe_session_id"):
        try:
            stripe_sesh = stripe.checkout.Session.retrieve(order["stripe_session_id"])
            pi = stripe_sesh.payment_intent
            if pi:
                stripe.Refund.create(payment_intent=pi, reason="requested_by_customer")
        except Exception as e:  # noqa: BLE001
            logger.warning("Stripe refund failed for %s: %s", order["order_number"], e)

    now = _now()
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        row.status = "refunded"
        row.refunded_at = now
        row.refund_reason = reason or ""
        row.updated_at = now
        await session.execute(
            _sa_update(TicketModel)
            .where(TicketModel.order_id == order["id"])
            .values(status="revoked")
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        await session.refresh(row)
        refreshed = row_to_dict(row)

    async with AsyncSessionLocal() as _pg:
        event_row = await _pg.scalar(
            select(_Event).where(_Event.id == order["event_id"]).with_for_update()
        )
        if event_row is None:
            raise HTTPException(404, "Evento no encontrado")
        qty = order["quantity_total"]
        stmt = (
            _sa_update(_Event)
            .where(
                _Event.id == order["event_id"],
                _Event.tickets_sold >= qty,
            )
            .values(
                tickets_sold=_Event.tickets_sold - qty,
                updated_at=now,
            )
        )
        result = await _pg.execute(stmt)
        if result.rowcount == 0:
            raise HTTPException(409, "No se pudo ajustar el inventario del evento")
        await _pg.commit()
    await _adjust_function_counters(order, -1)

    return refreshed


# ── Manual payment confirmation ─────────────────────────────────────────────
async def confirm_manual_payment(
    *,
    order: dict,
    confirmer_user_id: str,
    notes: str | None = None,
    reference: str | None = None,
) -> tuple[dict, list[dict]]:
    """Idempotent — already-paid orders return tickets without side effects."""
    from sqlalchemy import select
    from sqlalchemy import update as _sa_update
    from sqlalchemy.orm.attributes import flag_modified

    from database import AsyncSessionLocal
    from orm_models import Event as _Event
    from orm_models import Ticket as TicketModel
    from orm_models import TicketOrder as TOModel

    if order["status"] == "paid":
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TicketModel).where(TicketModel.order_id == order["id"])
            )
            return order, [row_to_dict(r) for r in result.scalars().all()]

    if order["status"] != "pending_manual_payment":
        raise HTTPException(
            422,
            f"Sólo órdenes pending_manual_payment se pueden confirmar (status={order['status']})",
        )

    now = _now()
    info = dict(order.get("manual_payment_info") or {})
    info.update(
        {
            "confirmed_by": confirmer_user_id,
            "confirmed_at": now.isoformat(),
            "paid_at": now.isoformat(),
            "organizer_notes": (notes or "")[:500],
            "reference": (reference or "")[:120] or info.get("reference"),
        }
    )

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        row.status = "paid"
        row.paid_at = now
        row.updated_at = now
        row.manual_payment_info = info
        flag_modified(row, "manual_payment_info")
        await session.commit()

    tickets = await issue_tickets_for_order(order)
    await _assign_seats_if_needed(order, tickets)

    async with AsyncSessionLocal() as _pg:
        event_row = await _pg.scalar(
            select(_Event).where(_Event.id == order["event_id"]).with_for_update()
        )
        if event_row is None:
            raise HTTPException(404, "Evento no encontrado")
        stmt = (
            _sa_update(_Event)
            .where(_Event.id == order["event_id"])
            .values(
                tickets_sold=_Event.tickets_sold + order["quantity_total"],
                updated_at=now,
            )
        )
        if event_row.capacity is not None:
            stmt = stmt.where(
                _Event.tickets_sold + order["quantity_total"] <= _Event.capacity
            )
        result = await _pg.execute(stmt)
        if result.rowcount == 0:
            raise HTTPException(409, "El evento ya no tiene capacidad disponible")
        await _pg.commit()
    await _adjust_function_counters(order, +1)
    await release_reservation(order["id"])
    await _consume_purchase_side_effects(order)

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        refreshed = row_to_dict(row)

    logger.info(
        "Order manual-confirmed: %s by=%s qty=%d total=%d",
        refreshed["order_number"],
        confirmer_user_id,
        refreshed["quantity_total"],
        refreshed["total_cents"],
    )
    return refreshed, tickets


async def reject_manual_payment(
    *,
    order: dict,
    reason: str,
    rejecter_user_id: str,
) -> dict:
    from sqlalchemy import select
    from sqlalchemy.orm.attributes import flag_modified

    from database import AsyncSessionLocal
    from orm_models import TicketOrder as TOModel

    if order["status"] not in ("pending_manual_payment", "pending"):
        raise HTTPException(
            422,
            f"Sólo órdenes pendientes se pueden rechazar (status={order['status']})",
        )

    now = _now()
    info = dict(order.get("manual_payment_info") or {})
    info.update(
        {
            "confirmed_by": rejecter_user_id,
            "confirmed_at": now.isoformat(),
            "organizer_notes": (reason or "")[:500],
        }
    )

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        row.status = "cancelled"
        row.refund_reason = (reason or "")[:500]
        row.updated_at = now
        row.manual_payment_info = info
        flag_modified(row, "manual_payment_info")
        await session.commit()
        await session.refresh(row)
        refreshed = row_to_dict(row)

    await release_reservation(order["id"])
    return refreshed


def get_payment_instructions(*, event: dict, payment_method: str) -> dict:
    if payment_method == "stripe":
        return {}
    pm = (event.get("payment_methods") or {}).get(payment_method) or {}
    if payment_method == "transfer":
        return {
            "method": "transfer",
            "bank_name": pm.get("bank_name", ""),
            "account_number": pm.get("account_number", ""),
            "account_holder": pm.get("account_holder", ""),
            "instructions": pm.get("instructions", ""),
        }
    if payment_method == "cash":
        return {
            "method": "cash",
            "location": pm.get("location", ""),
            "schedule": pm.get("schedule", ""),
            "contact": pm.get("contact", ""),
        }
    return {}
