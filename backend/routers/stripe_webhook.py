"""Stripe webhook + simulator (dev only) — Phase 2: organizers/tenants via PostgreSQL."""
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from audit import log_audit
from database import AsyncSessionLocal
from db_helpers import row_to_dict
from models import SimulateWebhookBody
from orm_models import BillingIntent, Organizer, SubscriptionPlan, Tenant, TicketOrder
import stripe_service

logger = logging.getLogger("tys.webhook")

router = APIRouter(prefix="/api/stripe", tags=["stripe"])


async def _activate_tenant(slug: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Tenant).where(Tenant.slug == slug))
        tenant = result.scalar_one_or_none()
        if tenant:
            tenant.status = "active"
        await session.commit()


async def _apply_checkout_completed(session_id: str, *, organizer_id: Optional[str] = None) -> None:
    """
    Marks billing_intent as completed and updates the organizer's
    subscription_status/plan based on the matching billing_intent.
    Idempotent.
    """
    async with AsyncSessionLocal() as session:
        intent_row = await session.scalar(
            select(BillingIntent).where(BillingIntent.session_id == session_id)
        )
        if not intent_row:
            logger.warning("No billing_intent for session %s", session_id)
            return
        if intent_row.status == "completed":
            return

        org_id = intent_row.organizer_id
        plan_result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id == intent_row.plan_id)
        )
        plan = plan_result.scalar_one_or_none()

        org_result = await session.execute(select(Organizer).where(Organizer.id == org_id))
        org = org_result.scalar_one_or_none()
        if org:
            org.plan_id = intent_row.plan_id
            org.plan_code = intent_row.plan_code
            org.subscription_status = "active"
            if plan and plan.billing_period == "monthly":
                org.current_period_end = datetime.now(timezone.utc).replace(microsecond=0)

        intent_row.status = "completed"
        intent_row.completed_at = datetime.now(timezone.utc)
        await session.commit()

    logger.info("Applied checkout.completed for org %s plan %s", org_id, intent_row.plan_code)


async def _apply_subscription_status(
    *, organizer_id: Optional[str], subscription_status: str, subscription_id: Optional[str] = None
) -> None:
    if not organizer_id:
        logger.warning("subscription update without organizer_id")
        return
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Organizer).where(Organizer.id == organizer_id))
        org = result.scalar_one_or_none()
        if org:
            org.subscription_status = subscription_status
            if subscription_id:
                org.stripe_subscription_id = subscription_id
        await session.commit()


async def _handle_event(
    *,
    event_type: str,
    session_id: Optional[str],
    organizer_id: Optional[str],
    subscription_status: Optional[str],
    subscription_id: Optional[str] = None,
    source: str = "webhook",
    purpose: Optional[str] = None,
    order_number: Optional[str] = None,
) -> None:
    # ── Ticket purchase finalization (mode=payment) ─────────────────────────
    if purpose == "ticket_purchase" or order_number:
        if not order_number and not session_id:
            logger.warning("ticket_purchase webhook with no order_number/session_id")
            return
        async with AsyncSessionLocal() as _pg:
            if order_number:
                _order_row = await _pg.scalar(
                    select(TicketOrder).where(TicketOrder.order_number == order_number)
                )
            else:
                _order_row = await _pg.scalar(
                    select(TicketOrder).where(TicketOrder.stripe_session_id == session_id)
                )
        if not _order_row:
            logger.warning("Order not found for order_number=%s session_id=%s", order_number, session_id)
            return
        order = row_to_dict(_order_row)
        from services import order_service

        finalized, tickets = await order_service.finalize_paid_order(
            order=order, stripe_session_id=session_id
        )
        await log_audit(
            None,
            f"stripe.{event_type}",
            "ticket_order",
            order["id"],
            {"source": source, "order_number": order["order_number"]},
        )
        # Fire-and-forget: email must not delay webhook response to Stripe
        import asyncio
        async def _send_confirmation():
            try:
                from db_helpers import get_event_by_id, get_organizer_by_id
                _event = await get_event_by_id(order["event_id"])
                _org = await get_organizer_by_id(order["organizer_id"]) or {}
                from services.email_service import send_purchase_confirmation
                await send_purchase_confirmation(
                    order=finalized, event=_event, organizer=_org, tickets=tickets
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed sending purchase confirmation")
        asyncio.create_task(_send_confirmation())
        return

    if event_type == "checkout.session.completed":
        if not session_id:
            return
        await _apply_checkout_completed(session_id, organizer_id=organizer_id)
        async with AsyncSessionLocal() as _pg_bi:
            _intent_row = await _pg_bi.scalar(
                select(BillingIntent).where(BillingIntent.session_id == session_id)
            )
        if _intent_row:
            org_id = _intent_row.organizer_id
            async with AsyncSessionLocal() as pg:
                org_result = await pg.execute(
                    select(Organizer.slug, Organizer.status).where(Organizer.id == org_id)
                )
                org_row = org_result.first()
            if org_row and org_row.status == "approved":
                await _activate_tenant(org_row.slug)
            await log_audit(None, f"stripe.{event_type}", "organizer", org_id, {"source": source, "session_id": session_id})  # noqa: E501
            try:
                from services.activation import log_funnel_event
                await log_funnel_event(organizer_id=org_id, event_name="subscription_active")
            except Exception:  # noqa: BLE001
                pass
    elif event_type == "customer.subscription.updated":
        await _apply_subscription_status(
            organizer_id=organizer_id,
            subscription_status=subscription_status or "active",
            subscription_id=subscription_id,
        )
        await log_audit(None, f"stripe.{event_type}", "organizer", organizer_id or "", {"source": source, "status": subscription_status})
    elif event_type == "customer.subscription.deleted":
        await _apply_subscription_status(
            organizer_id=organizer_id,
            subscription_status="canceled",
            subscription_id=subscription_id,
        )
        await log_audit(None, f"stripe.{event_type}", "organizer", organizer_id or "", {"source": source})
    elif event_type == "invoice.paid":
        await _apply_subscription_status(
            organizer_id=organizer_id,
            subscription_status="active",
            subscription_id=subscription_id,
        )
    elif event_type == "invoice.payment_failed":
        await _apply_subscription_status(
            organizer_id=organizer_id,
            subscription_status="past_due",
            subscription_id=subscription_id,
        )


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Real Stripe webhook endpoint. Requires STRIPE_WEBHOOK_SECRET to be set.
    """
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    if not body or not sig:
        raise HTTPException(400, "Missing body or signature")
    if not webhook_secret:
        raise HTTPException(503, "STRIPE_WEBHOOK_SECRET not configured")

    try:
        event = stripe_service.construct_event(body, sig, webhook_secret)
    except Exception as e:
        logger.warning("Stripe webhook verification failed: %s", e)
        raise HTTPException(400, f"Invalid webhook: {e}")

    et = event["type"]
    obj = event["data"]["object"]
    md = obj.get("metadata", {}) if isinstance(obj, dict) else {}
    organizer_id = md.get("organizer_id")
    session_id = obj.get("id") if et == "checkout.session.completed" else None
    subscription_id = (
        obj.get("subscription") if et == "checkout.session.completed" else obj.get("id")
    )
    sub_status = obj.get("status") if "subscription" in et else None

    await _handle_event(
        event_type=et,
        session_id=session_id,
        organizer_id=organizer_id,
        subscription_status=sub_status,
        subscription_id=subscription_id,
        source="stripe",
    )
    return JSONResponse({"received": True})


@router.post("/_simulate_webhook")
async def simulate_webhook(body: SimulateWebhookBody):
    """
    DEV-ONLY shortcut to fire the webhook handler internally (no signature).
    Only enabled when ENV=development.
    """
    if os.environ.get("ENV") != "development":
        raise HTTPException(404, "Not found")

    organizer_id = body.organizer_id
    if not organizer_id and body.session_id and not body.order_number:
        async with AsyncSessionLocal() as _pg:
            _intent = await _pg.scalar(
                select(BillingIntent).where(BillingIntent.session_id == body.session_id)
            )
        if _intent:
            organizer_id = _intent.organizer_id

    await _handle_event(
        event_type=body.event_type,
        session_id=body.session_id,
        organizer_id=organizer_id,
        subscription_status=body.subscription_status,
        source="simulator",
        purpose=body.purpose,
        order_number=body.order_number,
    )
    return {"ok": True, "applied": body.event_type}
