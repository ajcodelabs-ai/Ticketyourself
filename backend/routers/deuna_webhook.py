"""DEUNA webhooks + client-side payment confirmation."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from audit import log_audit
from database import AsyncSessionLocal
from db_helpers import row_to_dict
from orm_models import BillingIntent, Organizer, SubscriptionPlan, Tenant, TicketOrder
from services import deuna_service

logger = logging.getLogger("tys.deuna.webhook")

router = APIRouter(prefix="/api/deuna", tags=["deuna"])


async def _activate_tenant(slug: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Tenant).where(Tenant.slug == slug))
        tenant = result.scalar_one_or_none()
        if tenant:
            tenant.status = "active"
        await session.commit()


async def finalize_ticket_order_from_deuna(
    *,
    order: dict,
    order_token: Optional[str] = None,
    transaction_id: Optional[str] = None,
    source: str = "webhook",
) -> dict:
    from services import order_service

    finalized, tickets = await order_service.finalize_paid_order(
        order=order,
        stripe_session_id=order_token or order.get("stripe_session_id"),
    )
    if transaction_id or order_token:
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(TicketOrder).where(TicketOrder.id == order["id"])
            )
            if row:
                meta = dict(row.metadata_ or {})
                if transaction_id:
                    meta["deuna_transaction_id"] = transaction_id
                if order_token:
                    meta["deuna_order_token"] = order_token
                row.metadata_ = meta
                flag_modified(row, "metadata_")
                row.updated_at = datetime.now(timezone.utc)
                await session.commit()

    await log_audit(
        None,
        f"deuna.{source}",
        "ticket_order",
        order["id"],
        {"order_number": order["order_number"], "transaction_id": transaction_id},
    )

    async def _send_confirmation():
        try:
            from db_helpers import get_event_by_id, get_organizer_by_id
            from services.email_service import send_purchase_confirmation

            event = await get_event_by_id(order["event_id"])
            org = await get_organizer_by_id(order["organizer_id"]) or {}
            await send_purchase_confirmation(
                order=finalized, event=event, organizer=org, tickets=tickets
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed sending DEUNA purchase confirmation")

    asyncio.create_task(_send_confirmation())
    return finalized


async def finalize_billing_intent_from_deuna(
    *,
    intent: BillingIntent,
    transaction_id: Optional[str] = None,
    source: str = "webhook",
) -> None:
    if intent.status == "completed":
        return

    async with AsyncSessionLocal() as session:
        intent_row = await session.scalar(
            select(BillingIntent).where(BillingIntent.id == intent.id)
        )
        if not intent_row or intent_row.status == "completed":
            return

        plan = await session.scalar(
            select(SubscriptionPlan).where(SubscriptionPlan.id == intent_row.plan_id)
        )
        org = await session.scalar(
            select(Organizer).where(Organizer.id == intent_row.organizer_id)
        )
        now = datetime.now(timezone.utc)
        intent_row.status = "completed"
        intent_row.completed_at = now
        if org:
            org.plan_id = intent_row.plan_id
            org.plan_code = intent_row.plan_code
            org.subscription_status = "active"
            if plan and plan.billing_period == "monthly":
                org.current_period_end = now.replace(microsecond=0)
            org_slug = org.slug
            org_status = org.status
            org_id = org.id
        else:
            org_slug = None
            org_status = None
            org_id = intent_row.organizer_id
        await session.commit()

    if org_slug and org_status == "approved":
        await _activate_tenant(org_slug)

    await log_audit(
        None,
        f"deuna.{source}",
        "billing_intent",
        intent.id,
        {
            "plan_code": intent.plan_code,
            "transaction_id": transaction_id,
            "organizer_id": org_id,
        },
    )
    try:
        from services.activation import log_funnel_event

        await log_funnel_event(organizer_id=org_id, event_name="subscription_active")
    except Exception:  # noqa: BLE001
        pass


async def apply_deuna_notification(
    *,
    order_token: Optional[str],
    order_id: Optional[str],
    transaction_id: Optional[str],
    source: str,
) -> str:
    # Never trust caller-supplied status: always re-fetch the order from DEUNA's
    # API with our private key so a forged webhook body can't mark anything paid.
    if not order_token or not deuna_service.is_configured():
        logger.warning(
            "DEUNA %s: rejecting unverifiable notification (order_id=%s, has_token=%s)",
            source,
            order_id,
            bool(order_token),
        )
        return "ignored_unverified"

    try:
        info = deuna_service.get_order(order_token)
    except deuna_service.DeunaError as e:
        logger.warning("get_order during DEUNA %s failed: %s", source, e)
        return "ignored_unverified"

    order_id = info.get("order_id") or order_id
    transaction_id = info.get("transaction_id") or transaction_id
    order_token = info.get("order_token") or order_token

    if not deuna_service.is_paid(info):
        return "ignored_not_paid"

    async with AsyncSessionLocal() as session:
        order_row = None
        if order_id:
            order_row = await session.scalar(
                select(TicketOrder).where(TicketOrder.order_number == order_id)
            )
        if order_row is None and order_token:
            order_row = await session.scalar(
                select(TicketOrder).where(TicketOrder.stripe_session_id == order_token)
            )
        if order_row is not None:
            order = row_to_dict(order_row)

    if order_row is not None:
        if order.get("status") == "paid":
            return "already_paid"
        await finalize_ticket_order_from_deuna(
            order=order,
            order_token=order_token,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "order_paid"

    async with AsyncSessionLocal() as session:
        intent_row = None
        if order_id:
            intent_row = await session.scalar(
                select(BillingIntent).where(BillingIntent.session_id == order_id)
            )
        if intent_row is None and order_token:
            intent_row = await session.scalar(
                select(BillingIntent).where(BillingIntent.session_id == order_token)
            )

    if intent_row is not None:
        await finalize_billing_intent_from_deuna(
            intent=intent_row,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "billing_completed"

    from services.event_fees import find_event_by_fee_session, mark_pre_event_fee_paid
    from orm_models import Event

    event_id = None
    already_paid = False
    async with AsyncSessionLocal() as session:
        found = await find_event_by_fee_session(session, order_id, order_token)
        if found is not None:
            event_id = found.id
            already_paid = (found.pre_event_fee_status or "") == "paid"

    if event_id is not None:
        if already_paid:
            return "already_paid"
        async with AsyncSessionLocal() as session:
            row = await session.scalar(select(Event).where(Event.id == event_id))
            if row:
                mark_pre_event_fee_paid(
                    row,
                    transaction_id=str(transaction_id) if transaction_id else None,
                    payment_method="deuna",
                )
                await session.commit()
        await log_audit(
            None,
            f"deuna.{source}",
            "event",
            event_id,
            {"purpose": "pre_event_fee", "transaction_id": transaction_id},
        )
        return "pre_event_fee_paid"

    logger.warning(
        "DEUNA %s: no order/intent/fee for order_id=%s token=%s",
        source,
        order_id,
        order_token,
    )
    return "not_found"


@router.post("/webhook")
async def deuna_webhook(request: Request):
    """notify_order listener — always 200 so DEUNA does not retry forever."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}

    parsed = deuna_service.parse_webhook_payload(body)
    result = await apply_deuna_notification(
        order_token=parsed.get("order_token"),
        order_id=parsed.get("order_id"),
        transaction_id=parsed.get("transaction_id"),
        source="webhook",
    )
    logger.info(
        "DEUNA webhook result=%s status=%s order_id=%s",
        result,
        parsed.get("status"),
        parsed.get("order_id"),
    )
    return JSONResponse({"ok": True, "result": result})


@router.post("/confirm")
async def confirm_deuna_payment(body: dict[str, Any]):
    """
    Client onSuccess callback confirmation.
    Body: { order_token, order_id? }
    """
    if not deuna_service.is_configured():
        raise HTTPException(503, "DEUNA no está configurado")

    order_token = (body.get("order_token") or "").strip()
    if not order_token:
        raise HTTPException(422, "order_token requerido")

    try:
        info = deuna_service.get_order(order_token)
    except deuna_service.DeunaError as e:
        logger.error("DEUNA get_order failed: %s", e)
        raise HTTPException(502, "No pudimos verificar el pago con DEUNA") from e

    if not deuna_service.is_paid(info):
        raise HTTPException(
            402,
            f"Pago no aprobado ({info.get('status') or info.get('payment_status') or 'UNKNOWN'})",
        )

    result = await apply_deuna_notification(
        order_token=info.get("order_token") or order_token,
        order_id=body.get("order_id") or info.get("order_id"),
        transaction_id=info.get("transaction_id"),
        source="confirm",
    )
    if result == "not_found":
        raise HTTPException(404, "No encontramos la orden, el plan o el cargo asociado al pago")
    return {"ok": True, "result": result}
