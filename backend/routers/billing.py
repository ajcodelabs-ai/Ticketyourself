"""Billing router: Stripe Checkout + Nuvei/DeUna gateway intents + Customer Portal."""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import stripe_service
from audit import log_audit
from database import get_db
from db_helpers import row_to_dict
from models import CheckoutRequest, CheckoutResponse, PortalResponse
from orm_models import BillingIntent, Organizer, SubscriptionPlan
from security import require_role

logger = logging.getLogger("tys.billing")

router = APIRouter(prefix="/api/billing", tags=["billing"])

GATEWAY_METHODS = ("nuvei", "deuna")
GATEWAY_LABELS = {"nuvei": "Nuvei", "deuna": "DeUna"}


async def _get_organizer_or_403(user: dict, session: AsyncSession) -> Organizer:
    org_id = user.get("organizer_id")
    if not org_id:
        raise HTTPException(404, "Organizer profile not found")
    result = await session.execute(select(Organizer).where(Organizer.id == org_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Organizer not found")
    return row


async def _load_active_plan(session: AsyncSession, plan_code: str) -> dict:
    plan_result = await session.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == plan_code,
            SubscriptionPlan.active == True,  # noqa: E712
        )
    )
    plan_row = plan_result.scalar_one_or_none()
    if not plan_row:
        raise HTTPException(404, "Plan not found or inactive")
    return row_to_dict(plan_row)


@router.post("/checkout-session", response_model=CheckoutResponse)
async def create_checkout_session(
    payload: CheckoutRequest,
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer_or_403(user, session)
    if org.status != "approved":
        raise HTTPException(403, "La cuenta debe estar aprobada antes de pagar el plan")

    plan = await _load_active_plan(session, payload.plan_code)
    payment_method = payload.payment_method or "stripe"

    # ── Nuvei: openOrder + Simply Connect ─────────────────────────────────────
    if payment_method == "nuvei":
        from services import nuvei_service

        intent_id = str(uuid.uuid4())
        client_unique_id = f"bill_{intent_id.replace('-', '')[:20]}"
        origin = (payload.origin_url or "").rstrip("/")
        success_url = f"{origin}/billing/success"
        cancel_url = f"{origin}/billing/cancel"

        if not nuvei_service.is_configured():
            session_ref = f"gw_nuvei_{intent_id[:12]}"
            session.add(
                BillingIntent(
                    id=intent_id,
                    organizer_id=org.id,
                    plan_id=plan["id"],
                    plan_code=plan["code"],
                    session_id=session_ref,
                    payment_method="nuvei",
                    mode="gateway",
                    status="pending_gateway",
                )
            )
            await session.flush()
            await log_audit(
                user["id"],
                "billing.gateway_checkout_created",
                "billing_intent",
                intent_id,
                {
                    "plan_code": plan["code"],
                    "payment_method": "nuvei",
                    "configured": False,
                },
            )
            return CheckoutResponse(
                checkout_url=None,
                session_id=session_ref,
                mode="gateway",
                payment_method="nuvei",
                status="pending_gateway",
                plan_code=plan["code"],
                intent_id=intent_id,
                message=(
                    "Nuvei aún no está configurado. Registramos tu solicitud; "
                    "el equipo TYS confirmará el cobro manualmente."
                ),
            )

        try:
            nuvei = nuvei_service.open_order(
                amount_cents=plan["price_cents"],
                currency=plan.get("currency") or "USD",
                client_unique_id=client_unique_id,
                user_token_id=org.id,
                email=user.get("email"),
                first_name=(org.company_name or "Organizer")[:30],
                last_name="TYS",
                success_url=success_url,
                failure_url=cancel_url,
                pending_url=success_url,
                custom_data=f"billing:{intent_id}",
            )
        except nuvei_service.NuveiError as e:
            logger.error("Nuvei billing openOrder failed: %s", type(e).__name__)
            raise HTTPException(
                502,
                "No pudimos iniciar el pago con Nuvei. Intentá de nuevo en unos minutos.",
            ) from e

        session.add(
            BillingIntent(
                id=intent_id,
                organizer_id=org.id,
                plan_id=plan["id"],
                plan_code=plan["code"],
                session_id=client_unique_id,
                payment_method="nuvei",
                mode="payment",
                status="pending",
            )
        )
        await session.flush()
        await log_audit(
            user["id"],
            "billing.nuvei_checkout_created",
            "billing_intent",
            intent_id,
            {"plan_code": plan["code"], "payment_method": "nuvei"},
        )
        try:
            from services.activation import log_funnel_event

            await log_funnel_event(organizer_id=org.id, event_name="plan_selected")
            await log_funnel_event(organizer_id=org.id, event_name="checkout_started")
        except Exception:  # noqa: BLE001
            pass
        return CheckoutResponse(
            checkout_url=None,
            session_id=client_unique_id,
            mode="payment",
            payment_method="nuvei",
            status="nuvei_checkout",
            plan_code=plan["code"],
            intent_id=intent_id,
            session_token=nuvei["session_token"],
            merchant_id=nuvei["merchant_id"],
            merchant_site_id=nuvei["merchant_site_id"],
            nuvei_env=nuvei["env"],
            checkout_js_url=nuvei["checkout_js_url"],
            client_unique_id=client_unique_id,
            message=f"Completá el pago del plan {plan['name']} con Nuvei.",
        )

    # ── DEUNA: Create Order + Payment Widget ──────────────────────────────────
    if payment_method == "deuna":
        from services import deuna_service

        intent_id = str(uuid.uuid4())
        client_unique_id = f"bill_{intent_id.replace('-', '')[:20]}"

        if not deuna_service.is_configured():
            session_ref = f"gw_deuna_{intent_id[:12]}"
            session.add(
                BillingIntent(
                    id=intent_id,
                    organizer_id=org.id,
                    plan_id=plan["id"],
                    plan_code=plan["code"],
                    session_id=session_ref,
                    payment_method="deuna",
                    mode="gateway",
                    status="pending_gateway",
                )
            )
            await session.flush()
            await log_audit(
                user["id"],
                "billing.gateway_checkout_created",
                "billing_intent",
                intent_id,
                {
                    "plan_code": plan["code"],
                    "payment_method": "deuna",
                    "configured": False,
                },
            )
            return CheckoutResponse(
                checkout_url=None,
                session_id=session_ref,
                mode="gateway",
                payment_method="deuna",
                status="pending_gateway",
                plan_code=plan["code"],
                intent_id=intent_id,
                message=(
                    "DEUNA aún no está configurado. Registramos tu solicitud; "
                    "el equipo TYS confirmará el cobro manualmente."
                ),
            )

        try:
            first_name, last_name = deuna_service.split_buyer_name(
                org.company_name or user.get("email") or "Organizer"
            )
            deuna = deuna_service.create_order(
                order_id=client_unique_id,
                amount_cents=plan["price_cents"],
                currency=plan.get("currency") or "USD",
                item_name=f"Plan {plan['name']}",
                item_description=plan.get("description") or plan["code"],
                email=user.get("email") or "",
                first_name=first_name,
                last_name=last_name,
                metadata={
                    "tys_purpose": "billing",
                    "intent_id": intent_id,
                    "plan_code": plan["code"],
                    "organizer_id": org.id,
                },
            )
        except deuna_service.DeunaError as e:
            logger.error("DEUNA billing create_order failed: %s", type(e).__name__)
            raise HTTPException(
                502,
                "No pudimos iniciar el pago con DEUNA. Intentá de nuevo en unos minutos.",
            ) from e

        session.add(
            BillingIntent(
                id=intent_id,
                organizer_id=org.id,
                plan_id=plan["id"],
                plan_code=plan["code"],
                session_id=client_unique_id,
                payment_method="deuna",
                mode="payment",
                status="pending",
            )
        )
        await session.flush()
        await log_audit(
            user["id"],
            "billing.deuna_checkout_created",
            "billing_intent",
            intent_id,
            {"plan_code": plan["code"], "payment_method": "deuna"},
        )
        try:
            from services.activation import log_funnel_event

            await log_funnel_event(organizer_id=org.id, event_name="plan_selected")
            await log_funnel_event(organizer_id=org.id, event_name="checkout_started")
        except Exception:  # noqa: BLE001
            pass
        return CheckoutResponse(
            checkout_url=None,
            session_id=client_unique_id,
            mode="payment",
            payment_method="deuna",
            status="deuna_checkout",
            plan_code=plan["code"],
            intent_id=intent_id,
            order_token=deuna["order_token"],
            public_api_key=deuna["public_api_key"],
            deuna_env=deuna["env"],
            checkout_js_url=deuna["checkout_js_url"],
            client_unique_id=client_unique_id,
            message=f"Completá el pago del plan {plan['name']} con DEUNA.",
        )

    # ── Stripe Checkout ───────────────────────────────────────────────────────
    org_dict = row_to_dict(org)
    try:
        customer_id, created = await stripe_service.get_or_create_customer(
            org_dict, user["email"]
        )
    except Exception as e:
        logger.error("Stripe customer create failed: %s", type(e).__name__)
        raise HTTPException(
            502, "No pudimos conectar con Stripe. Intentá de nuevo en unos minutos."
        )

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
        logger.error("Stripe checkout create failed: %s", type(e).__name__)
        raise HTTPException(
            502,
            (
                "No pudimos iniciar el checkout con Stripe. Si esto se repite con "
                "`sk_test_emergent`, el wrapper de Emergent puede no soportar "
                "`mode=subscription`; usá el endpoint /api/stripe/_simulate_webhook "
                "para testear el flujo."
            ),
        )

    session.add(
        BillingIntent(
            organizer_id=org.id,
            plan_id=plan["id"],
            plan_code=plan["code"],
            session_id=stripe_session["id"],
            payment_method="stripe",
            mode=mode,
            status="pending",
        )
    )
    await session.flush()
    await log_audit(
        user["id"],
        "billing.checkout_created",
        "stripe_session",
        stripe_session["id"],
        {"plan_code": plan["code"], "mode": mode, "payment_method": "stripe"},
    )
    try:
        from services.activation import log_funnel_event

        await log_funnel_event(organizer_id=org.id, event_name="plan_selected")
        await log_funnel_event(organizer_id=org.id, event_name="checkout_started")
    except Exception:  # noqa: BLE001
        pass
    return CheckoutResponse(
        checkout_url=stripe_session["url"],
        session_id=stripe_session["id"],
        mode=mode,
        payment_method="stripe",
        status="redirect",
        plan_code=plan["code"],
    )


@router.get("/me/pending-intent")
async def get_my_pending_intent(
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    """Latest pending / pending_gateway billing intent for the organizer."""
    org = await _get_organizer_or_403(user, session)
    result = await session.execute(
        select(BillingIntent)
        .where(
            BillingIntent.organizer_id == org.id,
            BillingIntent.status.in_(("pending", "pending_gateway")),
        )
        .order_by(BillingIntent.created_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    return row_to_dict(row)


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
        logger.error("Stripe portal create failed: %s", type(e).__name__)
        raise HTTPException(
            502,
            "No pudimos abrir el portal de facturación de Stripe. Intentá de nuevo en unos minutos.",
        )
    return PortalResponse(portal_url=url)


async def complete_gateway_billing_intent(
    session: AsyncSession,
    *,
    organizer: Organizer,
    intent: BillingIntent,
    admin_id: str,
) -> Organizer:
    """Mark gateway intent completed and activate organizer subscription."""
    if intent.status not in ("pending_gateway", "pending"):
        raise HTTPException(400, f"Intent status is {intent.status}, cannot confirm")
    if intent.payment_method not in GATEWAY_METHODS:
        raise HTTPException(400, "Only Nuvei/DeUna intents can be confirmed this way")

    plan_result = await session.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.code == intent.plan_code)
    )
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, f"Plan '{intent.plan_code}' not found")

    now = datetime.now(timezone.utc)
    intent.status = "completed"
    intent.completed_at = now
    organizer.plan_id = plan.id
    organizer.plan_code = plan.code
    organizer.subscription_status = "active"
    await session.flush()
    await log_audit(
        admin_id,
        "billing.gateway_payment_confirmed",
        "billing_intent",
        intent.id,
        {
            "plan_code": plan.code,
            "payment_method": intent.payment_method,
            "organizer_id": organizer.id,
        },
    )
    return organizer
