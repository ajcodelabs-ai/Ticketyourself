"""Billing router: Stripe Checkout (subscription/payment) + Customer Portal."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from audit import log_audit
from db import db
from models import CheckoutRequest, CheckoutResponse, PortalResponse
from security import require_role
import stripe_service

logger = logging.getLogger("tys.billing")

router = APIRouter(prefix="/api/billing", tags=["billing"])


async def _get_organizer_or_403(user: dict) -> dict:
    org_id = user.get("organizer_id")
    if not org_id:
        raise HTTPException(404, "Organizer profile not found")
    org = await db.organizers.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Organizer not found")
    return org


@router.post("/checkout-session", response_model=CheckoutResponse)
async def create_checkout_session(payload: CheckoutRequest, user=Depends(require_role("organizer"))):
    org = await _get_organizer_or_403(user)
    if org["status"] == "suspended":
        raise HTTPException(403, "Account suspended — billing locked")

    plan = await db.subscription_plans.find_one(
        {"code": payload.plan_code, "active": True}, {"_id": 0}
    )
    if not plan:
        raise HTTPException(404, "Plan not found or inactive")

    # Get/create Stripe customer
    try:
        customer_id, created = await stripe_service.get_or_create_customer(org, user["email"])
    except Exception as e:
        logger.exception("Stripe customer create failed")
        raise HTTPException(502, f"Stripe customer error: {e}")

    if created:
        await db.organizers.update_one(
            {"id": org["id"]},
            {"$set": {"stripe_customer_id": customer_id}},
        )

    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"

    try:
        if plan["billing_period"] == "monthly":
            session = stripe_service.create_subscription_checkout(
                customer_id=customer_id,
                plan=plan,
                success_url=success_url,
                cancel_url=cancel_url,
                organizer_id=org["id"],
            )
            mode = "subscription"
        else:
            session = stripe_service.create_one_time_checkout(
                customer_id=customer_id,
                plan=plan,
                success_url=success_url,
                cancel_url=cancel_url,
                organizer_id=org["id"],
            )
            mode = "payment"
    except Exception as e:
        logger.exception("Stripe checkout create failed (mode=%s)", plan["billing_period"])
        raise HTTPException(
            502,
            (
                f"Stripe checkout error: {e}. Si esto se repite con `sk_test_emergent`, "
                "el wrapper de Emergent puede no soportar `mode=subscription`; usá el "
                "endpoint /api/stripe/_simulate_webhook para testear el flujo."
            ),
        )

    await db.billing_intents.insert_one(
        {
            "session_id": session["id"],
            "organizer_id": org["id"],
            "plan_id": plan["id"],
            "plan_code": plan["code"],
            "mode": mode,
            "status": "pending",
        }
    )
    await log_audit(
        user["id"],
        "billing.checkout_created",
        "stripe_session",
        session["id"],
        {"plan_code": plan["code"], "mode": mode},
    )
    return CheckoutResponse(checkout_url=session["url"], session_id=session["id"], mode=mode)


@router.post("/portal-session", response_model=PortalResponse)
async def create_portal_session(user=Depends(require_role("organizer"))):
    org = await _get_organizer_or_403(user)
    if not org.get("stripe_customer_id"):
        raise HTTPException(400, "No Stripe customer for this organizer yet")
    return_url = "https://example.com"  # Frontend pasa origin via /me settings; this is fallback
    try:
        url = stripe_service.create_billing_portal(org["stripe_customer_id"], return_url)
    except Exception as e:
        logger.exception("Stripe portal create failed")
        raise HTTPException(502, f"Stripe portal error: {e}")
    return PortalResponse(portal_url=url)
