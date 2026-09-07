"""Billing router: Nuvei Checkout (Paymentez) for plan payments."""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
from database import get_db
from db_helpers import row_to_dict
from models import CheckoutRequest, CheckoutResponse, PortalResponse
from orm_models import BillingIntent, Organizer, SubscriptionPlan
from security import is_active_organizer, require_role

logger = logging.getLogger("tys.billing")

router = APIRouter(prefix="/api/billing", tags=["billing"])

GATEWAY_METHODS = ("nuvei",)
GATEWAY_LABELS = {"nuvei": "Nuvei"}


async def _get_organizer_or_403(user: dict, session: AsyncSession) -> Organizer:
    if not is_active_organizer(user):
        raise HTTPException(404, "Organizer profile not found")
    result = await session.execute(
        select(Organizer).where(Organizer.id == user["organizer_id"])
    )
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
    payment_method = payload.payment_method or "nuvei"
    if payment_method != "nuvei":
        raise HTTPException(400, "El cobro de planes se hace con Nuvei")

    # ── Nuvei Ecuador (Paymentez): Link to Pay ────────────────────────────────
    if payment_method == "nuvei":
        from services import nuvei_service

        intent_id = str(uuid.uuid4())
        client_unique_id = f"bill_{intent_id.replace('-', '')[:20]}"

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
            origin = (payload.origin_url or "").strip() or None
            nuvei = nuvei_service.open_order(
                amount_cents=plan["price_cents"],
                currency=plan.get("currency") or "USD",
                client_unique_id=client_unique_id,
                user_token_id=org.id,
                email=user.get("email"),
                first_name=(org.company_name or "Organizer")[:30],
                last_name="TYS",
                custom_data=f"billing:{intent_id}",
                expiration_time=36000,
                **nuvei_service.checkout_return_urls(
                    success_path=f"/app/billing/success?session_id={client_unique_id}",
                    failure_path="/app/onboarding",
                    origin=origin,
                ),
            )
        except nuvei_service.NuveiError as e:
            logger.error(
                "Nuvei billing checkout failed: %s",
                nuvei_service.describe_error(e),
            )
            raise HTTPException(
                502,
                nuvei_service.checkout_http_detail(e),
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
            checkout_url=nuvei.get("payment_url") or nuvei.get("checkout_url"),
            session_id=client_unique_id,
            mode="payment",
            payment_method="nuvei",
            status="nuvei_checkout",
            plan_code=plan["code"],
            intent_id=intent_id,
            reference=nuvei["reference"],
            session_token=nuvei["reference"],
            nuvei_env=nuvei["env"],
            checkout_js_url=nuvei.get("checkout_js_url"),
            checkout_mode=nuvei.get("checkout_mode"),
            payment_url=nuvei.get("payment_url"),
            client_app_code=nuvei.get("client_app_code"),
            client_app_key=nuvei.get("client_app_key"),
            client_unique_id=client_unique_id,
            user_id=nuvei.get("user_id"),
            user_email=nuvei.get("user_email"),
            user_phone=nuvei.get("user_phone"),
            order_description=nuvei.get("order_description"),
            order_vat=nuvei.get("order_vat"),
            order_installments_type=nuvei.get("order_installments_type"),
            amount=nuvei.get("amount"),
            currency=nuvei.get("currency"),
            message=f"Completá el pago del plan {plan['name']} con Nuvei.",
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
    await _get_organizer_or_403(user, session)
    raise HTTPException(
        400,
        "El cobro de planes se hace con Nuvei. Ya no usamos el portal de Stripe.",
    )


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
        raise HTTPException(400, "Only Nuvei intents can be confirmed this way")

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
