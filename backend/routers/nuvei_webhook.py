"""Nuvei DMN (Direct Merchant Notification) + payment confirmation."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from audit import log_audit
from database import AsyncSessionLocal
from db_helpers import row_to_dict
from orm_models import BillingIntent, Organizer, SubscriptionPlan, Tenant, TicketOrder
from services import nuvei_service

logger = logging.getLogger("tys.nuvei.webhook")

router = APIRouter(prefix="/api/nuvei", tags=["nuvei"])


async def _activate_tenant(slug: str) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Tenant).where(Tenant.slug == slug))
        tenant = result.scalar_one_or_none()
        if tenant:
            tenant.status = "active"
        await session.commit()


async def finalize_ticket_order_from_nuvei(
    *,
    order: dict,
    session_token: Optional[str] = None,
    transaction_id: Optional[str] = None,
    source: str = "dmn",
) -> dict:
    from services import order_service

    finalized, tickets = await order_service.finalize_paid_order(
        order=order,
        stripe_session_id=session_token or order.get("stripe_session_id"),
    )
    if transaction_id:
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(TicketOrder).where(TicketOrder.id == order["id"])
            )
            if row:
                meta = dict(row.metadata_ or {})
                meta["nuvei_transaction_id"] = transaction_id
                row.metadata_ = meta
                from sqlalchemy.orm.attributes import flag_modified

                flag_modified(row, "metadata_")
                row.updated_at = datetime.now(timezone.utc)
                await session.commit()

    await log_audit(
        None,
        f"nuvei.{source}",
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
            logger.exception("Failed sending Nuvei purchase confirmation")

    asyncio.create_task(_send_confirmation())
    return finalized


async def finalize_billing_intent_from_nuvei(
    *,
    intent: BillingIntent,
    transaction_id: Optional[str] = None,
    source: str = "dmn",
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
        f"nuvei.{source}",
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


async def apply_nuvei_notification(parsed: dict[str, Any], *, source: str) -> str:
    """Route an approved Nuvei notification to ticket order or billing intent."""
    if not nuvei_service.is_approved_status(parsed.get("status")):
        return "ignored_not_approved"

    client_unique_id = (parsed.get("client_unique_id") or "").strip()
    session_token = parsed.get("session_token")
    transaction_id = parsed.get("transaction_id")

    # Prefer verifying with getPaymentStatus when we have a session token.
    if session_token and nuvei_service.is_configured():
        try:
            status = nuvei_service.get_payment_status(session_token)
            if not nuvei_service.is_approved_status(status.get("transaction_status")):
                return "ignored_status_mismatch"
            client_unique_id = (
                status.get("client_unique_id") or client_unique_id or ""
            ).strip()
            transaction_id = status.get("transaction_id") or transaction_id
        except nuvei_service.NuveiError as e:
            logger.warning("getPaymentStatus during DMN failed: %s", e)

    if not client_unique_id:
        return "ignored_missing_id"

    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(TicketOrder.order_number == client_unique_id)
        )
        if order_row is None and session_token:
            order_row = await session.scalar(
                select(TicketOrder).where(TicketOrder.stripe_session_id == session_token)
            )
        if order_row is not None:
            order = row_to_dict(order_row)

    if order_row is not None:
        if order.get("status") == "paid":
            return "already_paid"
        await finalize_ticket_order_from_nuvei(
            order=order,
            session_token=session_token,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "order_paid"

    async with AsyncSessionLocal() as session:
        intent_row = await session.scalar(
            select(BillingIntent).where(BillingIntent.session_id == client_unique_id)
        )
        if intent_row is None and session_token:
            intent_row = await session.scalar(
                select(BillingIntent).where(BillingIntent.session_id == session_token)
            )
        if intent_row is None and client_unique_id.startswith("bill_"):
            # clientUniqueId format: bill_<intent_id_prefix>_<plan>
            intent_row = await session.scalar(
                select(BillingIntent).where(
                    BillingIntent.session_id == client_unique_id
                )
            )

    if intent_row is not None:
        await finalize_billing_intent_from_nuvei(
            intent=intent_row,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "billing_completed"

    logger.warning("Nuvei %s: no order/intent for %s", source, client_unique_id)
    return "not_found"


async def _params_from_request(request: Request) -> dict[str, Any]:
    params: dict[str, Any] = dict(request.query_params)
    if request.method == "POST":
        content_type = (request.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                body = await request.json()
                if isinstance(body, dict):
                    params.update(body)
            except Exception:  # noqa: BLE001
                pass
        else:
            form = await request.form()
            params.update({k: v for k, v in form.items()})
    return params


@router.api_route("/dmn", methods=["GET", "POST"])
async def nuvei_dmn(request: Request):
    """
    Nuvei Direct Merchant Notification listener.
    Always return 200 OK so Nuvei does not retry endlessly on business misses.
    """
    params = await _params_from_request(request)
    if not nuvei_service.verify_dmn_checksum(params):
        logger.warning("Nuvei DMN checksum mismatch")
        raise HTTPException(400, "Invalid DMN checksum")

    parsed = nuvei_service.parse_dmn_params(params)
    result = await apply_nuvei_notification(parsed, source="dmn")
    logger.info(
        "Nuvei DMN result=%s status=%s cuid=%s",
        result,
        parsed.get("status"),
        parsed.get("client_unique_id"),
    )
    return PlainTextResponse("OK")


@router.post("/confirm")
async def confirm_nuvei_payment(body: dict[str, Any]):
    """
    Client-side callback confirmation.
    Body: { session_token, client_unique_id? }
    Verifies with getPaymentStatus before finalizing.
    """
    if not nuvei_service.is_configured():
        raise HTTPException(503, "Nuvei no está configurado")

    session_token = (body.get("session_token") or "").strip()
    if not session_token:
        raise HTTPException(422, "session_token requerido")

    try:
        status = nuvei_service.get_payment_status(session_token)
    except nuvei_service.NuveiError as e:
        logger.error("getPaymentStatus failed: %s", e)
        raise HTTPException(502, "No pudimos verificar el pago con Nuvei") from e

    if not nuvei_service.is_approved_status(status.get("transaction_status")):
        raise HTTPException(
            402,
            f"Pago no aprobado ({status.get('transaction_status') or 'UNKNOWN'})",
        )

    parsed = {
        "status": status.get("transaction_status"),
        "client_unique_id": body.get("client_unique_id")
        or status.get("client_unique_id"),
        "session_token": session_token,
        "transaction_id": status.get("transaction_id"),
    }
    result = await apply_nuvei_notification(parsed, source="confirm")
    if result == "not_found":
        raise HTTPException(404, "No encontramos la orden o el plan asociado al pago")
    return {"ok": True, "result": result}
