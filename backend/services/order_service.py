"""
Order business logic — capacity reservation, ticket emission, totals.

Mode-agnostic: works for free events (instant paid), Stripe checkout, and the
DEV simulator. The webhook handler delegates the "mark paid + emit tickets"
step to `finalize_paid_order` so the path is single-sourced.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import stripe

from database import AsyncSessionLocal
from db_helpers import row_to_dict
from services.ticket_jwt import issue_ticket_token

logger = logging.getLogger("tys.orders")

RESERVATION_TTL_MIN = 15
MANUAL_RESERVATION_TTL_HOURS = 48  # transfer / cash buyers get 48h to complete
DEFAULT_FEE_PERCENT = float(os.environ.get("TYS_FEE_PERCENT", "5"))
MAX_QUANTITY = 10
ORDER_PREFIX = "TYS-"
VALID_PAYMENT_METHODS = ("stripe", "transfer", "cash")


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
async def _active_reservation_qty(event_id: str) -> int:
    """Sum of un-expired capacity reservations for an event."""
    from database import AsyncSessionLocal
    from orm_models import EventCapacityReservation
    from sqlalchemy import select, func

    now = _now()
    async with AsyncSessionLocal() as session:
        total = await session.scalar(
            select(func.coalesce(func.sum(EventCapacityReservation.quantity), 0)).where(
                EventCapacityReservation.event_id == event_id,
                EventCapacityReservation.expires_at > now,
            )
        ) or 0
    return total


async def compute_availability(event: dict) -> dict:
    """Returns {capacity, sold, reserved, available}. None capacity = unlimited."""
    capacity = event.get("capacity")
    sold = event.get("tickets_sold") or 0
    if capacity is None:
        return {"capacity": None, "sold": sold, "reserved": 0, "available": None}
    reserved = await _active_reservation_qty(event["id"])
    available = max(0, capacity - sold - reserved)
    return {"capacity": capacity, "sold": sold, "reserved": reserved, "available": available}


async def reserve_capacity(
    *, event_id: str, order_id: str, quantity: int, ttl_minutes: int | None = None
) -> None:
    from database import AsyncSessionLocal
    from orm_models import EventCapacityReservation

    minutes = ttl_minutes if ttl_minutes is not None else RESERVATION_TTL_MIN
    now = _now()
    async with AsyncSessionLocal() as session:
        session.add(EventCapacityReservation(
            event_id=event_id,
            order_id=order_id,
            quantity=quantity,
            expires_at=now + timedelta(minutes=minutes),
            created_at=now,
        ))
        await session.commit()


async def release_reservation(order_id: str) -> None:
    from database import AsyncSessionLocal
    from orm_models import EventCapacityReservation
    from sqlalchemy import delete

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
def compute_totals(*, event: dict, quantity: int, donation_amount_cents: int = 0) -> dict:
    pricing = event.get("pricing_type", "free")
    if pricing == "free":
        return {
            "unit_price_cents": 0,
            "subtotal_cents": 0,
            "fees_cents": 0,
            "total_cents": 0,
            "donation_amount_cents": 0,
        }
    if pricing == "donation":
        if donation_amount_cents < 100:
            raise HTTPException(422, "El aporte mínimo es $1")
        subtotal = donation_amount_cents
        return {
            "unit_price_cents": donation_amount_cents,
            "subtotal_cents": subtotal,
            "fees_cents": 0,
            "total_cents": subtotal,
            "donation_amount_cents": donation_amount_cents,
        }
    unit = event.get("base_price_cents") or 0
    subtotal = unit * quantity
    fees = int(round(subtotal * DEFAULT_FEE_PERCENT / 100))
    return {
        "unit_price_cents": unit,
        "subtotal_cents": subtotal,
        "fees_cents": fees,
        "total_cents": subtotal + fees,
        "donation_amount_cents": 0,
    }


def compute_totals_with_seats(
    *, event: dict, venue: dict, seat_ids: list[str],
) -> dict:
    """Per-locality pricing for seat-numbered events."""
    from services.seats import seats_by_id

    if not seat_ids:
        raise HTTPException(422, "No seleccionaste asientos.")
    pricing_map = {
        lp["locality_id"]: int(lp.get("price_cents") or 0)
        for lp in (event.get("locality_pricing") or [])
    }
    by_id = seats_by_id(venue)
    subtotal = 0
    missing_loc = []
    for sid in seat_ids:
        seat = by_id.get(sid)
        if not seat:
            raise HTTPException(422, f"Asiento {sid} no existe en el venue.")
        loc_id = seat.get("locality_id")
        if loc_id not in pricing_map:
            missing_loc.append(loc_id or "(sin localidad)")
            continue
        subtotal += pricing_map[loc_id]
    if missing_loc:
        raise HTTPException(422, f"El evento no tiene precio para: {set(missing_loc)}")
    fees = int(round(subtotal * DEFAULT_FEE_PERCENT / 100))
    avg_unit = subtotal // max(1, len(seat_ids))
    return {
        "unit_price_cents": avg_unit,
        "subtotal_cents": subtotal,
        "fees_cents": fees,
        "total_cents": subtotal + fees,
        "donation_amount_cents": 0,
    }


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
    function_id: str | None = None,
    items_override: list[dict] | None = None,
) -> dict:
    from database import AsyncSessionLocal
    from orm_models import TicketOrder

    if quantity < 1 or quantity > MAX_QUANTITY:
        raise HTTPException(422, f"Cantidad debe estar entre 1 y {MAX_QUANTITY}")
    if payment_method not in VALID_PAYMENT_METHODS:
        raise HTTPException(422, f"Método de pago inválido: {payment_method}")

    avail = await compute_availability(event)
    if avail["available"] is not None and quantity > avail["available"]:
        raise HTTPException(409, "No hay capacidad disponible para esa cantidad")

    is_manual = payment_method in ("transfer", "cash")
    if is_manual:
        pm = (event.get("payment_methods") or {}).get(payment_method) or {}
        if not pm.get("enabled"):
            raise HTTPException(
                400, f"El organizador no acepta pagos con '{payment_method}'"
            )
        ttl = timedelta(hours=MANUAL_RESERVATION_TTL_HOURS)
        initial_status = "pending_manual_payment"
    else:
        ttl = timedelta(minutes=RESERVATION_TTL_MIN)
        initial_status = "pending"

    order_id = str(uuid.uuid4())
    order_number = await _next_order_number()
    order_token = str(uuid.uuid4())  # Guest access token — unguessable UUID v4
    now = _now()

    order_items = items_override if items_override else [{
        "ticket_type": "general",
        "quantity": quantity,
        "unit_price_cents": totals["unit_price_cents"],
        "subtotal_cents": totals["subtotal_cents"],
    }]

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
            if is_manual else None
        ),
        metadata_={"source": "web"},
        expires_at=now + ttl,
        created_at=now,
        updated_at=now,
    )

    async with AsyncSessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)
        order = row_to_dict(row)

    if seat_ids and seat_holds_session_token:
        from services.seats import consume_holds_for_order
        await consume_holds_for_order(
            event_id=event["id"], session_token=seat_holds_session_token,
            seat_ids=seat_ids, order_id=order_id,
        )
    return order


# ── Issue tickets ───────────────────────────────────────────────────────────
async def issue_tickets_for_order(order: dict) -> list[dict]:
    """Idempotent — only issues if the order has no tickets yet."""
    from database import AsyncSessionLocal
    from orm_models import Ticket as TicketModel
    from sqlalchemy import select, func

    async with AsyncSessionLocal() as session:
        existing_count = await session.scalar(
            select(func.count(TicketModel.id)).where(TicketModel.order_id == order["id"])
        ) or 0
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

    async with AsyncSessionLocal() as session:
        for _ in range(order["quantity_total"]):
            ticket_id = str(uuid.uuid4())
            token = issue_ticket_token(
                ticket_id=ticket_id,
                event_id=order["event_id"],
                order_id=order["id"],
                buyer_email=holder_base.get("email", ""),
                event_ends_at_iso=event.get("ends_at"),
            )
            session.add(TicketModel(
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
            ))
        await session.commit()
        result = await session.execute(
            select(TicketModel).where(TicketModel.order_id == order["id"])
        )
        return [row_to_dict(r) for r in result.scalars().all()]


# ── Phase 7 — seat assignment helper ────────────────────────────────────────
async def _assign_seats_if_needed(order: dict, tickets: list[dict]) -> None:
    if not order.get("seat_ids"):
        return
    from db_helpers import get_event_by_id, get_venue_by_id
    event_doc = await get_event_by_id(order["event_id"])
    if not event_doc or not event_doc.get("venue_id"):
        return
    venue_doc = await get_venue_by_id(event_doc["venue_id"])
    if not venue_doc:
        return
    from services.seats import assign_seats_to_tickets
    await assign_seats_to_tickets(
        event_id=event_doc["id"], venue=venue_doc, order=order, tickets=tickets,
    )


# ── Mark paid + emit ────────────────────────────────────────────────────────
async def finalize_paid_order(
    *, order: dict, stripe_session_id: str | None = None
) -> tuple[dict, list[dict]]:
    """
    Idempotent state transition: pending → paid, emit tickets, bump event.tickets_sold,
    release reservation.
    """
    from database import AsyncSessionLocal
    from orm_models import TicketOrder as TOModel, Ticket as TicketModel, Event as _Event
    from sqlalchemy import select, update as _sa_update

    if order["status"] == "paid":
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(TicketModel).where(TicketModel.order_id == order["id"])
            )
            return order, [row_to_dict(r) for r in result.scalars().all()]

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
            .values(tickets_sold=_Event.tickets_sold + order["quantity_total"], updated_at=now)
        )
        await _pg.commit()
    await release_reservation(order["id"])

    for applied in order.get("discounts_applied") or []:
        if applied.get("type") != "promo_code" or not applied.get("rule_id"):
            continue
        try:
            from services.discount_service import consume_promo_code
            await consume_promo_code(order["event_id"], applied["rule_id"])
        except Exception:  # noqa: BLE001
            logger.exception("Failed to bump uses_count for promo code rule %s", applied.get("rule_id"))

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        refreshed = row_to_dict(row)

    logger.info(
        "Order paid: %s event=%s qty=%d total=%d",
        refreshed["order_number"], refreshed["event_id"],
        refreshed["quantity_total"], refreshed["total_cents"],
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
    from database import AsyncSessionLocal
    from orm_models import TicketOrder as TOModel, Ticket as TicketModel, Event as _Event
    from sqlalchemy import select, update as _sa_update

    if order["status"] != "paid":
        raise HTTPException(422, "Sólo órdenes pagadas pueden reembolsarse")

    if order.get("stripe_session_id"):
        try:
            session = stripe.checkout.Session.retrieve(order["stripe_session_id"])
            pi = session.get("payment_intent")
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
        await _pg.execute(
            _sa_update(_Event)
            .where(_Event.id == order["event_id"])
            .values(tickets_sold=_Event.tickets_sold - order["quantity_total"])
        )
        await _pg.commit()

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
    from database import AsyncSessionLocal
    from orm_models import TicketOrder as TOModel, Ticket as TicketModel, Event as _Event
    from sqlalchemy import select, update as _sa_update
    from sqlalchemy.orm.attributes import flag_modified

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
    info.update({
        "confirmed_by": confirmer_user_id,
        "confirmed_at": now.isoformat(),
        "paid_at": now.isoformat(),
        "organizer_notes": (notes or "")[:500],
        "reference": (reference or "")[:120] or info.get("reference"),
    })

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
        await _pg.execute(
            _sa_update(_Event)
            .where(_Event.id == order["event_id"])
            .values(tickets_sold=_Event.tickets_sold + order["quantity_total"], updated_at=now)
        )
        await _pg.commit()
    await release_reservation(order["id"])

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(TOModel).where(TOModel.id == order["id"]))
        refreshed = row_to_dict(row)

    logger.info(
        "Order manual-confirmed: %s by=%s qty=%d total=%d",
        refreshed["order_number"], confirmer_user_id,
        refreshed["quantity_total"], refreshed["total_cents"],
    )
    return refreshed, tickets


async def reject_manual_payment(
    *,
    order: dict,
    reason: str,
    rejecter_user_id: str,
) -> dict:
    from database import AsyncSessionLocal
    from orm_models import TicketOrder as TOModel
    from sqlalchemy import select
    from sqlalchemy.orm.attributes import flag_modified

    if order["status"] not in ("pending_manual_payment", "pending"):
        raise HTTPException(
            422,
            f"Sólo órdenes pendientes se pueden rechazar (status={order['status']})",
        )

    now = _now()
    info = dict(order.get("manual_payment_info") or {})
    info.update({
        "confirmed_by": rejecter_user_id,
        "confirmed_at": now.isoformat(),
        "organizer_notes": (reason or "")[:500],
    })

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
