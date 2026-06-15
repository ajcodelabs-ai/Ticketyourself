"""Billing router: Stripe Checkout + Customer Portal — Phase 2: PostgreSQL."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
from database import get_db
from db_helpers import row_to_dict
from models import CheckoutRequest, CheckoutResponse, PortalResponse
from orm_models import BillingIntent, Organizer, SubscriptionPlan
from security import require_role
import stripe_service

logger = logging.getLogger("tys.billing")

router = APIRouter(prefix="/api/billing", tags=["billing"])


async def _get_organizer_or_403(user: dict, session: AsyncSession) -> Organizer:
    org_id = user.get("organizer_id")
    if not org_id:
        raise HTTPException(404, "Organizer profile not found")
    result = await session.execute(select(Organizer).where(Organizer.id == org_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Organizer not found")
    return row


@router.post("/checkout-session", response_model=CheckoutResponse)
async def create_checkout_session(
    payload: CheckoutRequest,
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer_or_403(user, session)
    if org.status == "suspended":
        raise HTTPException(403, "Account suspended — billing locked")

    plan_result = await session.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == payload.plan_code,
            SubscriptionPlan.active == True,  # noqa: E712
        )
    )
    plan_row = plan_result.scalar_one_or_none()
    if not plan_row:
        raise HTTPException(404, "Plan not found or inactive")
    plan = row_to_dict(plan_row)

    org_dict = row_to_dict(org)
    try:
        customer_id, created = await stripe_service.get_or_create_customer(org_dict, user["email"])
    except Exception as e:
        logger.exception("Stripe customer create failed")
        raise HTTPException(502, f"Stripe customer error: {e}")

    if created:
        org.stripe_customer_id = customer_id
        await session.flush()

    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"

    try:
        if plan["billing_period"] == "monthly":
            stripe_session = stripe_service.create_subscription_checkout(
                customer_id=customer_id,
                plan=plan,
                success_url=success_url,
                cancel_url=cancel_url,
                organizer_id=org.id,
            )
            mode = "subscription"
        else:
            stripe_session = stripe_service.create_one_time_checkout(
                customer_id=customer_id,
                plan=plan,
                success_url=success_url,
                cancel_url=cancel_url,
                organizer_id=org.id,
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

    session.add(BillingIntent(
        organizer_id=org.id,
        plan_id=plan["id"],
        plan_code=plan["code"],
        session_id=stripe_session["id"],
        mode=mode,
        status="pending",
    ))
    await session.flush()
    await log_audit(
        user["id"],
        "billing.checkout_created",
        "stripe_session",
        stripe_session["id"],
        {"plan_code": plan["code"], "mode": mode},
    )
    try:
        from services.activation import log_funnel_event
        await log_funnel_event(organizer_id=org.id, event_name="plan_selected")
        await log_funnel_event(organizer_id=org.id, event_name="checkout_started")
    except Exception:  # noqa: BLE001
        pass
    return CheckoutResponse(checkout_url=stripe_session["url"], session_id=stripe_session["id"], mode=mode)


@router.post("/portal-session", response_model=PortalResponse)
async def create_portal_session(
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer_or_403(user, session)
    if not org.stripe_customer_id:
        raise HTTPException(400, "No Stripe customer for this organizer yet")
    return_url = "https://example.com"
    try:
        url = stripe_service.create_billing_portal(org.stripe_customer_id, return_url)
    except Exception as e:
        logger.exception("Stripe portal create failed")
        raise HTTPException(502, f"Stripe portal error: {e}")
    return PortalResponse(portal_url=url)
