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

from db import db
from services import order_service
from services.pdf_service import render_ticket_pdf

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
    quantity: int = Field(ge=1, le=10)
    buyer: BuyerIn
    donation_amount_cents: Optional[int] = None
    origin_url: Optional[str] = None  # for success/cancel URL construction


async def _load_event_or_404(tenant_slug: str, event_slug: str) -> tuple[dict, dict]:
    organizer = await db.organizers.find_one({"slug": tenant_slug}, {"_id": 0})
    if not organizer:
        raise HTTPException(404, "Organizador no encontrado")
    event = await db.events.find_one(
        {"organizer_id": organizer["id"], "slug": event_slug}, {"_id": 0}
    )
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    return organizer, event


@router.post("")
async def create_order(payload: CreateOrderBody):
    organizer, event = await _load_event_or_404(payload.tenant_slug, payload.event_slug)
    if event["status"] != "published":
        raise HTTPException(409, "El evento no está disponible para compra")

    buyer = order_service.validate_buyer(payload.buyer.model_dump())
    totals = order_service.compute_totals(
        event=event,
        quantity=payload.quantity,
        donation_amount_cents=payload.donation_amount_cents or 0,
    )

    order = await order_service.create_order_skeleton(
        event=event,
        organizer=organizer,
        quantity=payload.quantity,
        buyer=buyer,
        totals=totals,
    )

    # FREE event — confirm instantly.
    if event.get("pricing_type") == "free":
        finalized, tickets = await order_service.finalize_paid_order(order=order)
        # Best-effort email
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

    await db.ticket_orders.update_one(
        {"id": order["id"]},
        {"$set": {"stripe_session_id": session["id"]}},
    )
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
    order = await db.ticket_orders.find_one({"order_number": order_number}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Orden no encontrada")

    # If pending + session_id matches, try to refresh from Stripe.
    if (
        order["status"] == "pending"
        and session_id
        and order.get("stripe_session_id") == session_id
    ):
        try:
            session = stripe.checkout.Session.retrieve(session_id)
            if session.get("payment_status") == "paid":
                order, _tickets = await order_service.finalize_paid_order(
                    order=order, stripe_session_id=session_id
                )
                # Email
                event = await db.events.find_one({"id": order["event_id"]}, {"_id": 0})
                organizer = await db.organizers.find_one(
                    {"id": order["organizer_id"]}, {"_id": 0}
                )
                try:
                    from services.email_service import send_purchase_confirmation
                    await send_purchase_confirmation(
                        order=order, event=event, organizer=organizer, tickets=_tickets
                    )
                except Exception:  # noqa: BLE001
                    pass
        except stripe.error.StripeError as e:
            logger.warning("Could not refresh session %s: %s", session_id, e)

    # Attach tickets + minimal event + organizer info for the success page.
    tickets_cursor = db.tickets.find({"order_id": order["id"]}, {"_id": 0})
    tickets = [t async for t in tickets_cursor]
    event = await db.events.find_one({"id": order["event_id"]}, {"_id": 0})
    organizer = await db.organizers.find_one({"id": order["organizer_id"]}, {"_id": 0})
    microsite = await db.microsites.find_one(
        {"organizer_id": order["organizer_id"]}, {"_id": 0}
    )
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


@router.get("/{order_number}/tickets/{ticket_id}/pdf")
async def ticket_pdf(order_number: str, ticket_id: str):
    order = await db.ticket_orders.find_one({"order_number": order_number}, {"_id": 0})
    if not order or order["status"] != "paid":
        raise HTTPException(404, "Orden no encontrada o no pagada")
    ticket = await db.tickets.find_one(
        {"id": ticket_id, "order_id": order["id"]}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(404, "Ticket no encontrado")
    event = await db.events.find_one({"id": ticket["event_id"]}, {"_id": 0})
    organizer = await db.organizers.find_one({"id": ticket["organizer_id"]}, {"_id": 0})
    microsite = await db.microsites.find_one(
        {"organizer_id": ticket["organizer_id"]}, {"_id": 0}
    )
    pdf_bytes = render_ticket_pdf(
        event=event, order=order, ticket=ticket, organizer=organizer, microsite=microsite
    )
    filename = f"ticket-{order_number}-{ticket_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
