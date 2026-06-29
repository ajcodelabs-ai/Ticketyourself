"""
Abono de Temporada (season pass) — Fase 4.

Buyer prepays once for N credits against ONE event's funciones. Redemption
happens later, one credit at a time: "no se bloquea un asiento, solo se
precompra" — capacity for a función is only checked/consumed at redemption,
reusing order_service's per-función tracking (Fase 2), not at purchase time.

Scope (v1): general-admission events only (no venue_id) — redemption doesn't
support seat selection, so numbered events are rejected at SeasonPass
creation. Purchase payment: Stripe only (or instant-free when price_cents=0,
mirroring the free-ticket-event pattern) — no transfer/cash for the pass
itself.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
import stripe

from database import AsyncSessionLocal
from db_helpers import row_to_dict

logger = logging.getLogger("tys.season_pass")

ORDER_PREFIX = "ABN-"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _next_pass_order_number() -> str:
    """Shares ticket_order_seq with ticket orders — same atomic sequence,
    different prefix so the two are visually distinguishable."""
    from sqlalchemy import text
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT nextval('ticket_order_seq')"))
        seq = result.scalar()
    return f"{ORDER_PREFIX}{seq:06d}"


def compute_pass_availability(season_pass: dict) -> dict:
    """Returns {capacity, sold, available}. None capacity = unlimited."""
    capacity = season_pass.get("max_passes")
    sold = season_pass.get("passes_sold") or 0
    if capacity is None:
        return {"capacity": None, "sold": sold, "available": None}
    return {"capacity": capacity, "sold": sold, "available": max(0, capacity - sold)}


# ── Purchase the pass itself ─────────────────────────────────────────────────
async def create_purchase_skeleton(
    *, season_pass: dict, event: dict, organizer: dict, buyer: dict,
) -> dict:
    from orm_models import SeasonPassPurchase

    if season_pass.get("status") != "active":
        raise HTTPException(409, "Este abono ya no está disponible.")
    avail = compute_pass_availability(season_pass)
    if avail["available"] is not None and avail["available"] <= 0:
        raise HTTPException(409, "No quedan abonos disponibles.")

    now = _now()
    subtotal = int(season_pass.get("price_cents") or 0)
    purchase = SeasonPassPurchase(
        id=str(uuid.uuid4()),
        season_pass_id=season_pass["id"],
        event_id=event["id"],
        organizer_id=organizer["id"],
        purchase_token=str(uuid.uuid4()),
        order_number=await _next_pass_order_number(),
        buyer=buyer,
        buyer_email=buyer["email"],
        credits_total=season_pass["credits_total"],
        credits_used=0,
        subtotal_cents=subtotal,
        fees_cents=0,
        total_cents=subtotal,
        currency=season_pass.get("currency", "USD"),
        status="pending",
        payment_method="stripe",
        created_at=now,
        updated_at=now,
    )
    async with AsyncSessionLocal() as session:
        session.add(purchase)
        await session.commit()
        await session.refresh(purchase)
        return row_to_dict(purchase)


def create_pass_checkout_session(
    *, purchase: dict, season_pass: dict, event: dict, success_url: str, cancel_url: str,
) -> dict:
    line_items = [{
        "price_data": {
            "currency": purchase.get("currency", "usd").lower(),
            "product_data": {
                "name": f"{event['title']} · {season_pass['name']} ({purchase['credits_total']} créditos)",
                "description": purchase["buyer"]["email"],
            },
            "unit_amount": purchase["total_cents"],
        },
        "quantity": 1,
    }]
    session = stripe.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        customer_email=purchase["buyer"]["email"],
        line_items=line_items,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "purchase_id": purchase["id"],
            "order_number": purchase["order_number"],
            "event_id": event["id"],
            "tys_purpose": "season_pass_purchase",
        },
    )
    return {"id": session.id, "url": session.url}


async def finalize_paid_purchase(
    *, purchase: dict, stripe_session_id: str | None = None,
) -> dict:
    """Idempotent: already-paid purchases return as-is."""
    from orm_models import SeasonPassPurchase as SPModel, SeasonPass as SPassModel
    from sqlalchemy import select, update as _sa_update

    if purchase["status"] == "paid":
        return purchase

    now = _now()
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(SPModel).where(SPModel.id == purchase["id"]))
        row.status = "paid"
        row.paid_at = now
        row.updated_at = now
        if stripe_session_id:
            row.stripe_session_id = stripe_session_id
        await session.commit()

    async with AsyncSessionLocal() as _pg:
        await _pg.execute(
            _sa_update(SPassModel)
            .where(SPassModel.id == purchase["season_pass_id"])
            .values(passes_sold=SPassModel.passes_sold + 1, updated_at=now)
        )
        await _pg.commit()

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(SPModel).where(SPModel.id == purchase["id"]))
        refreshed = row_to_dict(row)

    logger.info(
        "Season pass purchase paid: %s event=%s credits=%d",
        refreshed["order_number"], refreshed["event_id"], refreshed["credits_total"],
    )
    return refreshed


# ── Redeem one credit against a función ──────────────────────────────────────
async def redeem_credit(
    *, purchase: dict, season_pass: dict, event: dict, organizer: dict,
    function: dict, ticket_type: dict | None,
) -> tuple[dict, dict, list[dict]]:
    from orm_models import SeasonPassPurchase as SPModel, SeasonPassRedemption
    from sqlalchemy import select

    if purchase["status"] != "paid":
        raise HTTPException(422, "Este abono todavía no está pagado.")
    if purchase["credits_used"] >= purchase["credits_total"]:
        raise HTTPException(409, "Ya usaste todos los créditos de este abono.")

    now = _now()
    starts = season_pass.get("redemption_starts_at")
    ends = season_pass.get("redemption_ends_at")
    if starts and now < starts:
        raise HTTPException(409, "Todavía no se abrió la ventana de redención de este abono.")
    if ends and now > ends:
        raise HTTPException(409, "La ventana de redención de este abono ya cerró.")
    if function.get("status") != "active":
        raise HTTPException(409, "Esa función ya no está disponible.")

    items_override = None
    if ticket_type:
        if not ticket_type.get("active", True):
            raise HTTPException(409, f"El tipo '{ticket_type['name']}' ya no está disponible.")
        items_override = [{
            "ticket_type_id": ticket_type["id"],
            "ticket_type": ticket_type["name"],
            "quantity": 1,
            "unit_price_cents": 0,
            "subtotal_cents": 0,
        }]

    from services import order_service
    totals = {
        "unit_price_cents": 0, "subtotal_cents": 0, "fees_cents": 0,
        "total_cents": 0, "donation_amount_cents": 0,
    }
    order = await order_service.create_order_skeleton(
        event=event, organizer=organizer, quantity=1, buyer=purchase["buyer"],
        totals=totals, payment_method="season_pass", function=function,
        items_override=items_override,
    )
    finalized, tickets = await order_service.finalize_paid_order(order=order)

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(SPModel).where(SPModel.id == purchase["id"]))
        row.credits_used = row.credits_used + 1
        row.updated_at = now
        session.add(SeasonPassRedemption(
            id=str(uuid.uuid4()),
            season_pass_purchase_id=purchase["id"],
            function_id=function["id"],
            order_id=finalized["id"],
            redeemed_at=now,
        ))
        await session.commit()
        await session.refresh(row)
        refreshed_purchase = row_to_dict(row)

    logger.info(
        "Season pass credit redeemed: purchase=%s function=%s order=%s credits_left=%d",
        purchase["order_number"], function["id"], finalized["order_number"],
        refreshed_purchase["credits_total"] - refreshed_purchase["credits_used"],
    )
    return refreshed_purchase, finalized, tickets
