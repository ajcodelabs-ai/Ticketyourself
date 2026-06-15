"""
Public ticket order endpoints (no auth — buyers don't have TYS accounts).

Free events: instant paid + ticket issuance.
Paid + donation events: Stripe Checkout Session, finalize via webhook
(or via DEV simulator when sk_test_emergent doesn't deliver webhooks).
"""
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
import stripe

from database import AsyncSessionLocal
from db_helpers import get_event_by_id, get_microsite_by_organizer, get_organizer_by_id, get_organizer_by_slug, get_venue_by_id, row_to_dict
from orm_models import Organizer
from services import order_service
from services import discount_service
from services.pdf_service import render_ticket_pdf
from sqlalchemy import select

logger = logging.getLogger("tys.public_orders")
router = APIRouter(prefix="/api/public/orders", tags=["public-orders"])


def _frontend_base(payload_origin: Optional[str]) -> str:
    """Resolve the origin used to build Stripe success/cancel URLs."""
    candidate = (payload_origin or "").rstrip("/")
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate
    env_url = (os.environ.get("FRONTEND_URL") or "").rstrip("/")
    if env_url:
        return env_url
    # Last resort — must be absolute or Stripe rejects it.
    raise HTTPException(500, "FRONTEND_URL not configured and origin_url missing")


# ── Schemas ──────────────────────────────────────────────────────────────────
class BuyerIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    email: str = Field(max_length=140)
    phone: Optional[str] = Field(default=None, max_length=40)
    document_id: Optional[str] = Field(default=None, max_length=40)
    document_type: Optional[str] = Field(default=None, max_length=20)


class CreateOrderBody(BaseModel):
    tenant_slug: str
    event_slug: str
    quantity: int = Field(ge=1, le=20)
    buyer: BuyerIn
    donation_amount_cents: Optional[int] = None
    origin_url: Optional[str] = None  # for success/cancel URL construction
    payment_method: str = Field(default="stripe")  # stripe | transfer | cash
    # Phase 7 — numbered events
    seat_holds_session_token: Optional[str] = None
    seat_ids: Optional[list[str]] = None
    # Phase 9.5 — promo codes (Bloque E)
    promo_code: Optional[str] = Field(default=None, max_length=40)


class PreviewOrderBody(BaseModel):
    tenant_slug: str
    event_slug: str
    quantity: int = Field(ge=1, le=20)
    seat_ids: Optional[list[str]] = None
    promo_code: Optional[str] = Field(default=None, max_length=40)


async def _resolve_event_for_pricing(tenant_slug: str, event_slug: str):
    organizer, event = await _load_event_or_404(tenant_slug, event_slug)
    venue = None
    if event.get("venue_id"):
        venue = await get_venue_by_id(event["venue_id"])
    return organizer, event, venue


def _apply_discount_breakdown(totals: dict, applied: list[dict]) -> dict:
    """Subtract discount amounts from `subtotal_cents` and recompute fees +
    total. The original totals dict is returned in-place (mutated copy)."""
    if not applied:
        return {**totals, "discounts_applied": [], "discount_total_cents": 0}
    discount_total = sum(int(a.get("amount_cents") or 0) for a in applied)
    new_subtotal = max(0, int(totals.get("subtotal_cents") or 0) - discount_total)
    # Re-apply 5% service fee on net (only when the original totals had fees,
    # i.e. paid pricing — donations and free events leave fees at 0).
    fees = totals.get("fees_cents") or 0
    if fees > 0:
        fees = int(round(new_subtotal * order_service.DEFAULT_FEE_PERCENT / 100))
    return {
        **totals,
        "discount_total_cents": discount_total,
        "fees_cents": fees,
        "total_cents": new_subtotal + fees,
        "discounts_applied": applied,
    }


@router.post("/preview")
async def preview_order(payload: PreviewOrderBody):
    """Computes the price breakdown for a tentative purchase (no DB commit).
    Lets the buyer see the discount before paying. Soft warnings — e.g.
    rejected promo code — are returned in `warnings` so the frontend can
    surface a toast without aborting the rest of the preview."""
    organizer, event, venue = await _resolve_event_for_pricing(
        payload.tenant_slug, payload.event_slug,
    )
    if event["status"] != "published":
        raise HTTPException(409, "El evento no está disponible para compra")

    # Gross totals (re-uses the existing pricing helpers so we never diverge).
    if payload.seat_ids and venue:
        totals = order_service.compute_totals_with_seats(
            event=event, venue=venue, seat_ids=payload.seat_ids,
        )
        quantity = len(payload.seat_ids)
    else:
        totals = order_service.compute_totals(
            event=event, quantity=payload.quantity,
        )
        quantity = payload.quantity

    items = discount_service.items_from_payload(
        event=event, venue=venue, seat_ids=payload.seat_ids, quantity=quantity,
    )
    applied, warnings = discount_service.evaluate_discounts(
        event=event, items=items, promo_code=payload.promo_code,
    )
    out = _apply_discount_breakdown(totals, applied)
    out["organizer_id"] = organizer["id"]
    out["currency"] = event.get("currency", "USD")
    out["warnings"] = warnings
    return out


async def _load_event_or_404(tenant_slug: str, event_slug: str) -> tuple[dict, dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Organizer).where(Organizer.slug == tenant_slug))
        org_row = result.scalar_one_or_none()
    if not org_row:
        raise HTTPException(404, "Organizador no encontrado")
    organizer = row_to_dict(org_row)
    async with AsyncSessionLocal() as pg:
        from orm_models import Event
        from sqlalchemy import select as _select
        event_row = await pg.scalar(
            _select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == event_slug,
            )
        )
    if not event_row:
        raise HTTPException(404, "Evento no encontrado")
    event = row_to_dict(event_row)
    return organizer, event


@router.post("")
async def create_order(payload: CreateOrderBody):
    organizer, event = await _load_event_or_404(payload.tenant_slug, payload.event_slug)
    if event["status"] != "published":
        raise HTTPException(409, "El evento no está disponible para compra")

    buyer = order_service.validate_buyer(payload.buyer.model_dump())

    # Phase 7 — numbered event: use seat-based totals
    seat_ids = payload.seat_ids or None
    venue = None
    if seat_ids and event.get("venue_id"):
        venue = await get_venue_by_id(event["venue_id"])
        if not venue:
            raise HTTPException(409, "El venue del evento ya no está disponible.")
        if not payload.seat_holds_session_token:
            raise HTTPException(422, "Falta el token de reservas (seat_holds_session_token).")
        totals = order_service.compute_totals_with_seats(
            event=event, venue=venue, seat_ids=seat_ids,
        )
        quantity = len(seat_ids)
    else:
        totals = order_service.compute_totals(
            event=event,
            quantity=payload.quantity,
            donation_amount_cents=payload.donation_amount_cents or 0,
        )
        quantity = payload.quantity

    # Phase 9.5 — apply discount rules (promo_code + best auto/quantity) BEFORE
    # creating the order so the persisted totals match what the buyer was shown.
    items = discount_service.items_from_payload(
        event=event, venue=venue, seat_ids=seat_ids, quantity=quantity,
    )
    applied_discounts, discount_warnings = discount_service.evaluate_discounts(
        event=event, items=items, promo_code=payload.promo_code,
    )
    if payload.promo_code and not any(
        a.get("type") == "promo_code" for a in applied_discounts
    ):
        # Buyer typed a code but it didn't resolve into a real discount — fail hard
        # so they don't pay for a code that won't apply.
        reason = discount_warnings[0] if discount_warnings else "Código no válido."
        raise HTTPException(422, reason)
    totals = _apply_discount_breakdown(totals, applied_discounts)

    # Free events ignore payment_method (no payment at all)
    effective_method = (
        "stripe" if event.get("pricing_type") == "free" else payload.payment_method
    )

    order = await order_service.create_order_skeleton(
        event=event,
        organizer=organizer,
        quantity=quantity,
        buyer=buyer,
        totals=totals,
        payment_method=effective_method,
        seat_ids=seat_ids,
        seat_holds_session_token=payload.seat_holds_session_token,
    )

    # FREE event — confirm instantly.
    if event.get("pricing_type") == "free":
        finalized, tickets = await order_service.finalize_paid_order(order=order)
        try:
            from services.email_service import send_purchase_confirmation
            await send_purchase_confirmation(
                order=finalized, event=event, organizer=organizer, tickets=tickets
            )
        except Exception:  # noqa: BLE001
            pass
        return {
            "order_number": finalized["order_number"],
            "status": "paid",
            "tickets": tickets,
            "redirect_to": f"/o/{organizer['slug']}/orden/{finalized['order_number']}",
        }

    # ── Manual payment (transfer / cash) — no Stripe, 48h reservation ─────
    if effective_method in ("transfer", "cash"):
        await order_service.reserve_capacity(
            event_id=event["id"],
            order_id=order["id"],
            quantity=payload.quantity,
            ttl_minutes=order_service.MANUAL_RESERVATION_TTL_HOURS * 60,
        )
        instructions = order_service.get_payment_instructions(
            event=event, payment_method=effective_method
        )
        # Best-effort email with instructions
        try:
            from services.email_service import send_manual_payment_instructions

            await send_manual_payment_instructions(
                order=order,
                event=event,
                organizer=organizer,
                instructions=instructions,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed sending manual payment instructions")
        return {
            "order_number": order["order_number"],
            "status": "pending_manual_payment",
            "payment_method": effective_method,
            "payment_instructions": instructions,
            "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}/instrucciones",
        }

    # Paid or donation > 0 — Stripe checkout.
    origin = _frontend_base(payload.origin_url)
    success_url = (
        f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}"
        "?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}/cancelado"
    try:
        session = order_service.create_ticket_checkout_session(
            order=order, event=event, success_url=success_url, cancel_url=cancel_url
        )
    except stripe.error.StripeError as e:
        logger.error("Stripe checkout failed for order %s: %s", order["order_number"], e)
        raise HTTPException(502, f"Stripe checkout error: {e.user_message or str(e)}") from e

    async with AsyncSessionLocal() as _pg:
        from orm_models import TicketOrder as _TOModel
        _row = await _pg.scalar(select(_TOModel).where(_TOModel.id == order["id"]))
        _row.stripe_session_id = session["id"]
        await _pg.commit()
    await order_service.reserve_capacity(
        event_id=event["id"], order_id=order["id"], quantity=payload.quantity
    )
    return {
        "order_number": order["order_number"],
        "checkout_url": session["url"],
        "session_id": session["id"],
        "status": "pending",
    }


@router.get("/{order_number}")
async def get_order(order_number: str, session_id: Optional[str] = Query(default=None)):
    from orm_models import TicketOrder as _TOModel, Ticket as _TModel

    async with AsyncSessionLocal() as _pg:
        order_row = await _pg.scalar(
            select(_TOModel).where(_TOModel.order_number == order_number)
        )
    if not order_row:
        raise HTTPException(404, "Orden no encontrada")
    order = row_to_dict(order_row)

    if (
        order["status"] == "pending"
        and session_id
        and order.get("stripe_session_id") == session_id
    ):
        try:
            stripe_session = stripe.checkout.Session.retrieve(session_id)
            if stripe_session.get("payment_status") == "paid":
                order, _tickets = await order_service.finalize_paid_order(
                    order=order, stripe_session_id=session_id
                )
                event = await get_event_by_id(order["event_id"])
                organizer = await get_organizer_by_id(order["organizer_id"])
                try:
                    from services.email_service import send_purchase_confirmation
                    await send_purchase_confirmation(
                        order=order, event=event, organizer=organizer, tickets=_tickets
                    )
                except Exception:  # noqa: BLE001
                    pass
        except stripe.error.StripeError as e:
            logger.warning("Could not refresh session %s: %s", session_id, e)

    async with AsyncSessionLocal() as _pg:
        _t_result = await _pg.execute(
            select(_TModel).where(_TModel.order_id == order["id"])
        )
        tickets = [row_to_dict(r) for r in _t_result.scalars().all()]
    event = await get_event_by_id(order["event_id"])
    organizer = await get_organizer_by_id(order["organizer_id"])
    microsite = await get_microsite_by_organizer(order["organizer_id"])
    return {
        "order": order,
        "tickets": tickets,
        "event": event,
        "organizer": {
            "slug": organizer["slug"] if organizer else None,
            "company_name": organizer.get("company_name") if organizer else None,
        },
        "branding": (microsite or {}).get("branding") or {},
    }


@router.get("/{order_number}/instructions")
async def get_payment_instructions(order_number: str):
    """
    Public endpoint that returns the manual-payment instructions for an order.
    Only meaningful when status=pending_manual_payment. Buyer reaches this via
    the `redirect_to` from create_order or the email link.
    """
    from orm_models import TicketOrder as _TOModel

    async with AsyncSessionLocal() as _pg:
        _row = await _pg.scalar(select(_TOModel).where(_TOModel.order_number == order_number))
    order = row_to_dict(_row) if _row else None
    if not order:
        raise HTTPException(404, "Orden no encontrada")
    event = await get_event_by_id(order["event_id"])
    organizer = await get_organizer_by_id(order["organizer_id"])
    microsite = await get_microsite_by_organizer(order["organizer_id"])
    method = order.get("payment_method") or "stripe"
    instructions = order_service.get_payment_instructions(
        event=event or {}, payment_method=method
    )
    return {
        "order": order,
        "event": event,
        "organizer": {
            "slug": organizer["slug"] if organizer else None,
            "company_name": organizer.get("company_name") if organizer else None,
            "email": organizer.get("email") if organizer else None,
        },
        "branding": (microsite or {}).get("branding") or {},
        "payment_method": method,
        "payment_instructions": instructions,
    }


@router.get("/{order_number}/tickets/{ticket_id}/pdf")
async def ticket_pdf(order_number: str, ticket_id: str):
    from orm_models import TicketOrder as _TOModel, Ticket as _TModel

    async with AsyncSessionLocal() as _pg:
        _o_row = await _pg.scalar(select(_TOModel).where(_TOModel.order_number == order_number))
    order = row_to_dict(_o_row) if _o_row else None
    if not order or order["status"] != "paid":
        raise HTTPException(404, "Orden no encontrada o no pagada")

    async with AsyncSessionLocal() as _pg:
        _t_row = await _pg.scalar(
            select(_TModel).where(_TModel.id == ticket_id, _TModel.order_id == order["id"])
        )
    ticket = row_to_dict(_t_row) if _t_row else None
    if not ticket:
        raise HTTPException(404, "Ticket no encontrado")
    event = await get_event_by_id(ticket["event_id"])
    organizer = await get_organizer_by_id(ticket["organizer_id"])
    microsite = await get_microsite_by_organizer(ticket["organizer_id"])
    pdf_bytes = render_ticket_pdf(
        event=event, order=order, ticket=ticket, organizer=organizer, microsite=microsite
    )
    filename = f"ticket-{order_number}-{ticket_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
