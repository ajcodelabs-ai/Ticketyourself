"""Nuvei Ecuador (Paymentez) webhook + payment confirmation."""

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
from orm_models import (
    BillingIntent,
    Event,
    Organizer,
    SubscriptionPlan,
    Tenant,
    TicketOrder,
)
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
    source: str = "webhook",
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


async def apply_nuvei_notification(
    parsed: dict[str, Any], *, source: str, checksum_verified: bool = False
) -> str:
    """Route an approved Paymentez notification to ticket order or billing intent."""
    status = parsed.get("status")
    status_detail = parsed.get("status_detail")
    client_unique_id = (parsed.get("client_unique_id") or "").strip()
    transaction_id = parsed.get("transaction_id")
    reference = (parsed.get("reference") or parsed.get("session_token") or "").strip()
    amount = parsed.get("amount") or parsed.get("total_amount")

    if checksum_verified:
        # Cryptographic stoken (or prior server-side get_transaction) already
        # proved this came from Paymentez.
        if not nuvei_service.is_approved_status(status, status_detail):
            return "ignored_not_approved"
    else:
        # No valid stoken to trust — the raw status/id in the request body
        # could be forged, so we MUST re-fetch the authoritative status from
        # Paymentez ourselves before finalizing anything.
        if not transaction_id or not nuvei_service.is_configured():
            logger.warning(
                "Nuvei %s: rejecting unverifiable notification (cuid=%s, has_txn=%s)",
                source,
                client_unique_id,
                bool(transaction_id),
            )
            return "ignored_unverified"
        try:
            verified = nuvei_service.get_transaction(str(transaction_id))
        except nuvei_service.NuveiError as e:
            logger.warning("get_transaction during %s failed: %s", source, e)
            return "ignored_unverified"
        if not nuvei_service.is_approved_status(
            verified.get("transaction_status"),
            verified.get("status_detail"),
        ):
            return "ignored_status_mismatch"
        client_unique_id = (
            verified.get("client_unique_id") or client_unique_id or ""
        ).strip()
        transaction_id = verified.get("transaction_id") or transaction_id
        amount = verified.get("amount") or amount

    # Both branches above already returned early on a non-approved status, so
    # by this point the notification is provably approved.

    if not client_unique_id and not reference:
        return "ignored_missing_id"

    order_row = None
    order: dict = {}
    intent_row = None
    intent_plan_price_cents: Optional[int] = None
    async with AsyncSessionLocal() as session:
        if client_unique_id:
            order_row = await session.scalar(
                select(TicketOrder).where(TicketOrder.order_number == client_unique_id)
            )
        if order_row is None and reference:
            order_row = await session.scalar(
                select(TicketOrder).where(TicketOrder.stripe_session_id == reference)
            )
        if order_row is not None:
            order = row_to_dict(order_row)
        else:
            if client_unique_id:
                intent_row = await session.scalar(
                    select(BillingIntent).where(
                        BillingIntent.session_id == client_unique_id
                    )
                )
            if intent_row is None and reference:
                intent_row = await session.scalar(
                    select(BillingIntent).where(BillingIntent.session_id == reference)
                )
            if intent_row is not None:
                plan = await session.scalar(
                    select(SubscriptionPlan).where(
                        SubscriptionPlan.code == intent_row.plan_code
                    )
                )
                intent_plan_price_cents = plan.price_cents if plan else None

    if order_row is not None:
        if order.get("status") == "paid":
            return "already_paid"
        if not nuvei_service.amount_matches(amount, order.get("total_cents") or 0):
            logger.warning(
                "Nuvei %s: amount mismatch for order %s (reported=%s, expected_cents=%s)",
                source,
                order.get("order_number"),
                amount,
                order.get("total_cents"),
            )
            return "ignored_amount_mismatch"
        await finalize_ticket_order_from_nuvei(
            order=order,
            # Prefer the reference we stored ourselves at checkout time — the
            # webhook's `reference` field may not carry the same value Paymentez
            # actually echoes back, so don't let it silently overwrite a known-
            # good value.
            session_token=order.get("stripe_session_id") or reference,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "order_paid"

    if intent_row is not None:
        if not nuvei_service.amount_matches(amount, intent_plan_price_cents or 0):
            logger.warning(
                "Nuvei %s: amount mismatch for billing intent %s (reported=%s, "
                "expected_cents=%s)",
                source,
                intent_row.id,
                amount,
                intent_plan_price_cents,
            )
            return "ignored_amount_mismatch"
        await finalize_billing_intent_from_nuvei(
            intent=intent_row,
            transaction_id=str(transaction_id) if transaction_id else None,
            source=source,
        )
        return "billing_completed"

    from services.event_fees import find_event_by_fee_session, mark_pre_event_fee_paid

    event_id = None
    fee_cents = 0
    already_paid = False
    async with AsyncSessionLocal() as session:
        found = await find_event_by_fee_session(session, client_unique_id, reference)
        if found is not None:
            event_id = found.id
            fee_cents = int(found.pre_event_fee_cents or 0)
            already_paid = (found.pre_event_fee_status or "") == "paid"

    if event_id is not None:
        if already_paid:
            return "already_paid"
        if fee_cents > 0 and not nuvei_service.amount_matches(amount, fee_cents):
            logger.warning(
                "Nuvei %s: amount mismatch for pre-event fee %s (reported=%s, "
                "expected_cents=%s)",
                source,
                event_id,
                amount,
                fee_cents,
            )
            return "ignored_amount_mismatch"
        async with AsyncSessionLocal() as session:
            row = await session.scalar(select(Event).where(Event.id == event_id))
            if row:
                mark_pre_event_fee_paid(
                    row,
                    transaction_id=str(transaction_id) if transaction_id else None,
                    payment_method="nuvei",
                )
                await session.commit()
        await log_audit(
            None,
            f"nuvei.{source}",
            "event",
            event_id,
            {"purpose": "pre_event_fee", "transaction_id": transaction_id},
        )
        return "pre_event_fee_paid"

    logger.warning(
        "Nuvei %s: no order/intent/fee for ref=%s cuid=%s",
        source,
        reference,
        client_unique_id,
    )
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


@router.api_route("/webhook", methods=["GET", "POST"])
@router.api_route("/dmn", methods=["GET", "POST"])
async def nuvei_webhook(request: Request):
    """
    Paymentez / Nuvei Ecuador webhook listener.
    Always return 200 OK so the gateway does not retry endlessly on business misses.
    Register this URL in the Paymentez dashboard (BACKEND_PUBLIC_URL/api/nuvei/webhook).
    """
    params = await _params_from_request(request)
    checksum_result = nuvei_service.verify_dmn_checksum(params)
    if checksum_result is False:
        logger.warning("Nuvei webhook stoken mismatch")
        raise HTTPException(400, "Invalid webhook stoken")

    parsed = nuvei_service.parse_webhook_payload(params)
    # The stoken only covers transaction_id+application_code+user_id+app_key —
    # never status/dev_reference/amount — so a valid stoken alone isn't enough
    # to trust the rest of the body. Always re-verify via get_transaction()
    # (checksum_verified=False forces that path in apply_nuvei_notification).
    # The stoken-mismatch rejection above still filters out forged requests early.
    result = await apply_nuvei_notification(
        parsed, source="webhook", checksum_verified=False
    )
    logger.info(
        "Nuvei webhook result=%s status=%s detail=%s cuid=%s",
        result,
        parsed.get("status"),
        parsed.get("status_detail"),
        parsed.get("client_unique_id"),
    )
    return PlainTextResponse("OK")


@router.post("/charge")
async def charge_nuvei_with_token(body: dict[str, Any]):
    """
    Charge a card token from PaymentGateway tokenization.
    Body: { card_token, client_unique_id, amount_cents? }
    """
    if not nuvei_service.is_configured():
        raise HTTPException(503, "Nuvei no está configurado")

    card_token = str(body.get("card_token") or "").strip()
    client_unique_id = str(body.get("client_unique_id") or "").strip()
    if not card_token:
        raise HTTPException(422, "card_token requerido")
    if not client_unique_id:
        raise HTTPException(422, "client_unique_id requerido")

    order = None
    intent = None
    plan = None
    fee_event_id = None
    fee_event_cents = 0
    fee_event_paid = False
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(TicketOrder.order_number == client_unique_id)
        )
        if order_row is not None:
            order = row_to_dict(order_row)
        else:
            intent = await session.scalar(
                select(BillingIntent).where(
                    BillingIntent.session_id == client_unique_id
                )
            )
            if intent is not None:
                plan = await session.scalar(
                    select(SubscriptionPlan).where(
                        SubscriptionPlan.code == intent.plan_code
                    )
                )
            else:
                from services.event_fees import find_event_by_fee_session

                found = await find_event_by_fee_session(session, client_unique_id)
                if found is not None:
                    fee_event_id = found.id
                    fee_event_cents = int(found.pre_event_fee_cents or 0)
                    fee_event_paid = (found.pre_event_fee_status or "") == "paid"

    if order is None and intent is None and fee_event_id is None:
        raise HTTPException(404, "No encontramos la orden, el plan o el cargo asociado")

    if order is not None and order.get("status") == "paid":
        return {"ok": True, "result": "already_paid"}

    if fee_event_id is not None and fee_event_paid:
        return {"ok": True, "result": "already_paid"}

    if order is not None:
        # Never trust the client's amount_cents — same principle as the billing
        # branch below. A falsy/missing total_cents means the order isn't in a
        # chargeable state, not an invitation to let the caller pick a price.
        amount_cents = int(order.get("total_cents") or 0)
        if amount_cents <= 0:
            raise HTTPException(422, "La orden no tiene un monto válido para cobrar")
        currency = order.get("currency") or "USD"
        email = order.get("buyer_email") or ""
        description = f"Orden {order.get('order_number')}"
        user_id = email or order["id"]
    elif fee_event_id is not None:
        amount_cents = fee_event_cents
        if amount_cents <= 0:
            raise HTTPException(422, "El cargo de plataforma no tiene un monto válido")
        currency = "USD"
        email = str(body.get("email") or "")
        description = str(
            body.get("description") or f"Cargo plataforma {client_unique_id}"
        )
        user_id = str(body.get("user_id") or email or client_unique_id)
    else:
        # Billing: amount/currency are the plan's real price — never trust the
        # client's amount_cents, or a $0.01 charge could activate the full plan.
        if plan is None:
            raise HTTPException(404, f"Plan '{intent.plan_code}' no encontrado")
        amount_cents = int(plan.price_cents)
        if amount_cents <= 0:
            raise HTTPException(422, "El plan no tiene un precio configurado")
        currency = plan.currency or "USD"
        email = str(body.get("email") or "")
        description = str(body.get("description") or f"Plan {client_unique_id}")
        user_id = str(body.get("user_id") or email or client_unique_id)

    try:
        debit = nuvei_service.debit_with_token(
            card_token=card_token,
            amount_cents=amount_cents,
            currency=currency.upper(),
            dev_reference=client_unique_id,
            description=description,
            user_id=user_id,
            email=email or "noreply@ticketyourself.com",
        )
    except nuvei_service.NuveiError as e:
        logger.error("Nuvei debit failed: %s", e)
        raise HTTPException(502, str(e) or "No pudimos cobrar con Nuvei") from e

    if not nuvei_service.is_approved_status(
        debit.get("transaction_status"),
        debit.get("status_detail"),
    ):
        raise HTTPException(
            402,
            f"Pago no aprobado ({debit.get('transaction_status') or 'UNKNOWN'})",
        )

    parsed = {
        "status": debit.get("transaction_status"),
        "status_detail": debit.get("status_detail"),
        "client_unique_id": client_unique_id,
        "session_token": client_unique_id,
        "reference": client_unique_id,
        "transaction_id": debit.get("transaction_id"),
        "amount": debit.get("amount"),
    }
    result = await apply_nuvei_notification(
        parsed, source="charge", checksum_verified=True
    )
    return {"ok": True, "result": result, "transaction_id": debit.get("transaction_id")}


@router.post("/confirm")
async def confirm_nuvei_payment(body: dict[str, Any]):
    """
    Client-side callback confirmation after PaymentCheckout.onResponse.
    Body: { transaction_id, client_unique_id?, reference? }
    Verifies with GET /v2/transaction/<id>/ before finalizing.
    """
    if not nuvei_service.is_configured():
        raise HTTPException(503, "Nuvei no está configurado")

    # Token charge path (preferred)
    if body.get("card_token"):
        return await charge_nuvei_with_token(body)

    transaction_id = (
        body.get("transaction_id")
        or body.get("session_token")  # legacy Simply Connect field name
        or ""
    )
    transaction_id = str(transaction_id).strip()
    if not transaction_id:
        raise HTTPException(422, "transaction_id requerido")

    try:
        status = nuvei_service.get_transaction(transaction_id)
    except nuvei_service.NuveiError as e:
        logger.error("get_transaction failed: %s", e)
        raise HTTPException(502, "No pudimos verificar el pago con Nuvei") from e

    if not nuvei_service.is_approved_status(
        status.get("transaction_status"),
        status.get("status_detail"),
    ):
        raise HTTPException(
            402,
            f"Pago no aprobado ({status.get('transaction_status') or 'UNKNOWN'})",
        )

    parsed = {
        "status": status.get("transaction_status"),
        "status_detail": status.get("status_detail"),
        "client_unique_id": status.get("client_unique_id")
        or body.get("client_unique_id"),
        "session_token": body.get("reference") or body.get("session_token"),
        "reference": body.get("reference") or body.get("session_token"),
        "transaction_id": status.get("transaction_id") or transaction_id,
        "amount": status.get("amount"),
    }
    result = await apply_nuvei_notification(
        parsed, source="confirm", checksum_verified=True
    )
    if result == "not_found":
        raise HTTPException(
            404, "No encontramos la orden, el plan o el cargo asociado al pago"
        )
    return {"ok": True, "result": result}
