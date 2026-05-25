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

from db import db
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


def _now_iso() -> str:
    return _now().isoformat()


# ── Order number sequence ────────────────────────────────────────────────────
async def _next_order_number() -> str:
    """Atomic auto-incrementing counter via findAndModify on the `counters` doc."""
    result = await db.counters.find_one_and_update(
        {"_id": "ticket_orders"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    if not result or "seq" not in result:
        # Initial state
        result = await db.counters.find_one({"_id": "ticket_orders"}) or {"seq": 1}
    seq = result["seq"]
    return f"{ORDER_PREFIX}{seq:06d}"


# ── Capacity ─────────────────────────────────────────────────────────────────
async def _active_reservation_qty(event_id: str) -> int:
    """Sum of un-expired reservations for an event."""
    now = _now_iso()
    cursor = db.event_capacity_reservations.find(
        {"event_id": event_id, "expires_at": {"$gt": now}}, {"_id": 0, "quantity": 1}
    )
    total = 0
    async for r in cursor:
        total += r.get("quantity") or 0
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
    minutes = ttl_minutes if ttl_minutes is not None else RESERVATION_TTL_MIN
    await db.event_capacity_reservations.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_id": event_id,
            "order_id": order_id,
            "quantity": quantity,
            "expires_at": (_now() + timedelta(minutes=minutes)).isoformat(),
            "created_at": _now_iso(),
        }
    )


async def release_reservation(order_id: str) -> None:
    await db.event_capacity_reservations.delete_many({"order_id": order_id})


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
            "fees_cents": 0,  # donations: no service fee
            "total_cents": subtotal,
            "donation_amount_cents": donation_amount_cents,
        }
    # paid
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


# Phase 7 — totals for a numbered event with explicit seat_ids.
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
) -> dict:
    if quantity < 1 or quantity > MAX_QUANTITY:
        raise HTTPException(422, f"Cantidad debe estar entre 1 y {MAX_QUANTITY}")
    if payment_method not in VALID_PAYMENT_METHODS:
        raise HTTPException(422, f"Método de pago inválido: {payment_method}")

    avail = await compute_availability(event)
    if avail["available"] is not None and quantity > avail["available"]:
        raise HTTPException(409, "No hay capacidad disponible para esa cantidad")

    is_manual = payment_method in ("transfer", "cash")
    if is_manual:
        # Validate the chosen method is actually enabled on the event.
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
    order = {
        "id": order_id,
        "order_number": order_number,
        "event_id": event["id"],
        "organizer_id": organizer["id"],
        "tenant_slug": organizer["slug"],
        "buyer": buyer,
        "items": [
            {
                "ticket_type": "general",
                "quantity": quantity,
                "unit_price_cents": totals["unit_price_cents"],
                "subtotal_cents": totals["subtotal_cents"],
            }
        ],
        "quantity_total": quantity,
        "subtotal_cents": totals["subtotal_cents"],
        "fees_cents": totals["fees_cents"],
        "total_cents": totals["total_cents"],
        "currency": event.get("currency", "USD"),
        "donation_amount_cents": totals["donation_amount_cents"] or None,
        # Phase 9.5 — preserve discounts applied so finalize_paid_order can
        # increment promo_code uses atomically once payment confirms.
        "discounts_applied": totals.get("discounts_applied") or [],
        "discount_total_cents": int(totals.get("discount_total_cents") or 0),
        "status": initial_status,
        "payment_method": payment_method,
        "manual_payment_info": (
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
        "stripe_session_id": None,
        "stripe_payment_intent_id": None,
        "paid_at": None,
        "refunded_at": None,
        "refund_reason": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "expires_at": (_now() + ttl).isoformat(),
        "metadata": {"source": "web"},
        # Phase 7 — numbered events: persist the seats this order is buying
        "seat_ids": seat_ids or None,
        "seat_holds_session_token": seat_holds_session_token,
    }
    await db.ticket_orders.insert_one({**order})
    # If numbered, convert the matching held rows to "converted"
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
    existing = await db.tickets.count_documents({"order_id": order["id"]})
    if existing:
        cursor = db.tickets.find({"order_id": order["id"]}, {"_id": 0})
        return [t async for t in cursor]

    event = await db.events.find_one({"id": order["event_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event vanished")

    tickets: list[dict] = []
    holder_base = order.get("buyer") or {}
    for _ in range(order["quantity_total"]):
        ticket_id = str(uuid.uuid4())
        token = issue_ticket_token(
            ticket_id=ticket_id,
            event_id=order["event_id"],
            order_id=order["id"],
            buyer_email=holder_base.get("email", ""),
            event_ends_at_iso=event.get("ends_at"),
        )
        ticket = {
            "id": ticket_id,
            "order_id": order["id"],
            "event_id": order["event_id"],
            "organizer_id": order["organizer_id"],
            "tenant_slug": order["tenant_slug"],
            "holder": {
                "name": holder_base.get("name"),
                "email": holder_base.get("email"),
                "phone": holder_base.get("phone"),
                "document_id": holder_base.get("document_id"),
            },
            "qr_token": token,
            "status": "issued",
            "issued_at": _now_iso(),
            "used_at": None,
            "used_by": None,
            "seat_label": None,
            "created_at": _now_iso(),
        }
        await db.tickets.insert_one({**ticket})
        tickets.append(ticket)
    return tickets


# ── Phase 7 — seat assignment helper ────────────────────────────────────────
async def _assign_seats_if_needed(order: dict, tickets: list[dict]) -> None:
    """Calls services.seats.assign_seats_to_tickets if this order is for a numbered event."""
    if not order.get("seat_ids"):
        return
    event_doc = await db.events.find_one({"id": order["event_id"]}, {"_id": 0})
    if not event_doc or not event_doc.get("venue_id"):
        return
    venue_doc = await db.venues.find_one({"id": event_doc["venue_id"]}, {"_id": 0})
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
    if order["status"] == "paid":
        cursor = db.tickets.find({"order_id": order["id"]}, {"_id": 0})
        return order, [t async for t in cursor]

    now_iso = _now_iso()
    update: dict = {"status": "paid", "paid_at": now_iso, "updated_at": now_iso}
    if stripe_session_id:
        update["stripe_session_id"] = stripe_session_id
    await db.ticket_orders.update_one({"id": order["id"]}, {"$set": update})

    tickets = await issue_tickets_for_order(order)
    await _assign_seats_if_needed(order, tickets)
    await db.events.update_one(
        {"id": order["event_id"]},
        {"$inc": {"tickets_sold": order["quantity_total"]}, "$set": {"updated_at": now_iso}},
    )
    await release_reservation(order["id"])

    # Phase 9.5 — bump uses_count for every promo_code rule that contributed
    # to this order. Atomic per-rule so concurrent buyers can't slip past
    # `max_uses`. Failures are logged but don't break payment.
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

    refreshed = await db.ticket_orders.find_one({"id": order["id"]}, {"_id": 0})
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
    """mode=payment for ticket purchases. ad-hoc price_data per order."""
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
    if order["status"] != "paid":
        raise HTTPException(422, "Sólo órdenes pagadas pueden reembolsarse")
    # Stripe refund if applicable
    if order.get("stripe_session_id"):
        try:
            session = stripe.checkout.Session.retrieve(order["stripe_session_id"])
            pi = session.get("payment_intent")
            if pi:
                stripe.Refund.create(payment_intent=pi, reason="requested_by_customer")
        except Exception as e:  # noqa: BLE001
            logger.warning("Stripe refund failed for %s: %s", order["order_number"], e)

    now_iso = _now_iso()
    await db.ticket_orders.update_one(
        {"id": order["id"]},
        {
            "$set": {
                "status": "refunded",
                "refunded_at": now_iso,
                "refund_reason": reason or "",
                "updated_at": now_iso,
            }
        },
    )
    await db.tickets.update_many(
        {"order_id": order["id"]},
        {"$set": {"status": "revoked"}},
    )
    await db.events.update_one(
        {"id": order["event_id"]},
        {"$inc": {"tickets_sold": -order["quantity_total"]}},
    )
    return await db.ticket_orders.find_one({"id": order["id"]}, {"_id": 0})


# ── Manual payment confirmation ─────────────────────────────────────────────
async def confirm_manual_payment(
    *,
    order: dict,
    confirmer_user_id: str,
    notes: str | None = None,
    reference: str | None = None,
) -> tuple[dict, list[dict]]:
    """
    Organizer flips a pending_manual_payment order to paid.
    Idempotent — already-paid orders return tickets without side effects.
    """
    if order["status"] == "paid":
        cursor = db.tickets.find({"order_id": order["id"]}, {"_id": 0})
        return order, [t async for t in cursor]
    if order["status"] != "pending_manual_payment":
        raise HTTPException(
            422,
            f"Sólo órdenes pending_manual_payment se pueden confirmar (status={order['status']})",
        )

    now_iso = _now_iso()
    info = (order.get("manual_payment_info") or {}).copy()
    info.update(
        {
            "confirmed_by": confirmer_user_id,
            "confirmed_at": now_iso,
            "paid_at": now_iso,
            "organizer_notes": (notes or "")[:500],
            "reference": (reference or "")[:120] or info.get("reference"),
        }
    )
    await db.ticket_orders.update_one(
        {"id": order["id"]},
        {
            "$set": {
                "status": "paid",
                "paid_at": now_iso,
                "updated_at": now_iso,
                "manual_payment_info": info,
            }
        },
    )

    tickets = await issue_tickets_for_order(order)
    await _assign_seats_if_needed(order, tickets)
    await db.events.update_one(
        {"id": order["event_id"]},
        {"$inc": {"tickets_sold": order["quantity_total"]}, "$set": {"updated_at": now_iso}},
    )
    await release_reservation(order["id"])

    refreshed = await db.ticket_orders.find_one({"id": order["id"]}, {"_id": 0})
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
    if order["status"] not in ("pending_manual_payment", "pending"):
        raise HTTPException(
            422,
            f"Sólo órdenes pendientes se pueden rechazar (status={order['status']})",
        )
    now_iso = _now_iso()
    info = (order.get("manual_payment_info") or {}).copy()
    info.update(
        {
            "confirmed_by": rejecter_user_id,
            "confirmed_at": now_iso,
            "organizer_notes": (reason or "")[:500],
        }
    )
    await db.ticket_orders.update_one(
        {"id": order["id"]},
        {
            "$set": {
                "status": "cancelled",
                "refund_reason": (reason or "")[:500],
                "updated_at": now_iso,
                "manual_payment_info": info,
            }
        },
    )
    await release_reservation(order["id"])
    return await db.ticket_orders.find_one({"id": order["id"]}, {"_id": 0})


def get_payment_instructions(*, event: dict, payment_method: str) -> dict:
    """
    Returns the public-safe payment instructions for a manual method.
    None for stripe; the dict for transfer/cash with all fields filled.
    """
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
