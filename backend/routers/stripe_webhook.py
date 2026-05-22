"""Stripe webhook + simulator (dev only)."""
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from audit import log_audit
from db import db
from models import SimulateWebhookBody
import stripe_service

logger = logging.getLogger("tys.webhook")

router = APIRouter(prefix="/api/stripe", tags=["stripe"])


async def _activate_tenant(slug: str) -> None:
    await db.tenants.update_one({"slug": slug}, {"$set": {"status": "active"}})


async def _apply_checkout_completed(session_id: str, *, organizer_id: Optional[str] = None) -> None:
    """
    Marks billing_intent as completed and updates the organizer's
    subscription_status/plan based on the matching billing_intent.
    Idempotent.
    """
    intent = await db.billing_intents.find_one({"session_id": session_id}, {"_id": 0})
    if not intent:
        logger.warning("No billing_intent for session %s", session_id)
        return

    if intent["status"] == "completed":
        return

    org_id = intent["organizer_id"]
    plan = await db.subscription_plans.find_one({"id": intent["plan_id"]}, {"_id": 0})
    new_status = "active"  # treat both subscription + one_time as active for POC

    update = {
        "plan_id": intent["plan_id"],
        "subscription_status": new_status,
    }
    if plan and plan["billing_period"] == "monthly":
        # Stripe would normally provide current_period_end via subscription event.
        # In the simulator we just set 30 days out so the UI looks correct.
        future = datetime.now(timezone.utc).replace(microsecond=0)
        update["current_period_end"] = future.isoformat()

    await db.organizers.update_one({"id": org_id}, {"$set": update})
    await db.billing_intents.update_one(
        {"session_id": session_id},
        {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    logger.info("Applied checkout.completed for org %s plan %s", org_id, intent["plan_code"])


async def _apply_subscription_status(
    *, organizer_id: Optional[str], subscription_status: str, subscription_id: Optional[str] = None
) -> None:
    if not organizer_id:
        logger.warning("subscription update without organizer_id")
        return
    update: Dict[str, Any] = {"subscription_status": subscription_status}
    if subscription_id:
        update["stripe_subscription_id"] = subscription_id
    await db.organizers.update_one({"id": organizer_id}, {"$set": update})


async def _handle_event(
    *,
    event_type: str,
    session_id: Optional[str],
    organizer_id: Optional[str],
    subscription_status: Optional[str],
    subscription_id: Optional[str] = None,
    source: str = "webhook",
) -> None:
    if event_type == "checkout.session.completed":
        if not session_id:
            return
        await _apply_checkout_completed(session_id, organizer_id=organizer_id)
        intent = await db.billing_intents.find_one({"session_id": session_id}, {"_id": 0})
        if intent:
            org_id = intent["organizer_id"]
            org = await db.organizers.find_one({"id": org_id}, {"_id": 0, "slug": 1, "status": 1})
            if org and org.get("status") == "approved":
                await _activate_tenant(org["slug"])
            await log_audit(None, f"stripe.{event_type}", "organizer", org_id, {"source": source, "session_id": session_id})
            # Funnel — subscription_active fires when checkout completes for subscriptions.
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
    Real Stripe webhook endpoint. Requires STRIPE_WEBHOOK_SECRET to be set,
    which only works when the user supplies their own Stripe test account.
    With Emergent's `sk_test_emergent` wrapper, webhooks usually don't arrive
    here; use POST /api/stripe/_simulate_webhook (dev only) to test the flow.
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
    Only enabled when ENV=development. Useful to test the flow under
    `sk_test_emergent` where real webhooks never arrive.
    """
    if os.environ.get("ENV") != "development":
        raise HTTPException(404, "Not found")

    organizer_id = body.organizer_id
    if not organizer_id and body.session_id:
        intent = await db.billing_intents.find_one(
            {"session_id": body.session_id}, {"_id": 0}
        )
        if intent:
            organizer_id = intent["organizer_id"]

    await _handle_event(
        event_type=body.event_type,
        session_id=body.session_id,
        organizer_id=organizer_id,
        subscription_status=body.subscription_status,
        source="simulator",
    )
    return {"ok": True, "applied": body.event_type}
