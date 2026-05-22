"""POC routes (Fase 0) — kept under /api/poc/*."""
from datetime import datetime, timezone
from typing import List, Optional
import logging
import uuid

from fastapi import APIRouter, HTTPException, Query, Request

from db import db
from poc_models import (
    CheckoutCreatedResponse,
    CreateSubscriptionRequest,
    CreateTicketRequest,
    PocPaymentOut,
    StatusResponse,
)

# We keep using emergentintegrations for the POC routes (legacy behaviour).
from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    StripeCheckout,
)

import os

logger = logging.getLogger("tys.poc")

router = APIRouter(prefix="/api/poc", tags=["poc"])

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

SUBSCRIPTION_PLANS = {
    "basic": {"name": "Básico", "amount_usd": 20.00},
    "pro":   {"name": "Pro",    "amount_usd": 50.00},
}


def _checkout(request: Request) -> StripeCheckout:
    host_url = str(request.base_url).rstrip("/")
    return StripeCheckout(
        api_key=STRIPE_API_KEY,
        webhook_url=f"{host_url}/api/stripe/webhook",
    )


async def _mark_paid(session_id: str, amount_total: int, currency: str) -> None:
    await db.poc_payments.find_one_and_update(
        {"stripe_session_id": session_id, "status": {"$ne": "paid"}},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "amount_cents": amount_total,
            "currency": currency,
        }},
    )


def _to_out(doc: dict) -> PocPaymentOut:
    def _dt(v):
        if isinstance(v, str):
            return datetime.fromisoformat(v)
        return v
    return PocPaymentOut(
        id=doc["id"],
        tenant_slug=doc["tenant_slug"],
        stripe_session_id=doc["stripe_session_id"],
        type=doc["type"],
        status=doc["status"],
        amount_cents=doc["amount_cents"],
        currency=doc["currency"],
        description=doc.get("description"),
        plan_name=doc.get("plan_name"),
        event_name=doc.get("event_name"),
        created_at=_dt(doc["created_at"]),
        paid_at=_dt(doc.get("paid_at")) if doc.get("paid_at") else None,
    )


@router.post("/stripe/create-subscription-session", response_model=CheckoutCreatedResponse)
async def create_subscription_session(request: Request, payload: CreateSubscriptionRequest):
    tenant = await db.tenants.find_one({"slug": payload.tenant_slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.get("status") != "active":
        raise HTTPException(403, "Tenant not active")
    if payload.plan_name not in SUBSCRIPTION_PLANS:
        raise HTTPException(400, "Invalid plan")
    plan = SUBSCRIPTION_PLANS[payload.plan_name]
    amount_usd = plan["amount_usd"]

    origin = payload.origin_url.rstrip("/")
    chk = _checkout(request)
    req = CheckoutSessionRequest(
        amount=float(amount_usd),
        currency="usd",
        success_url=f"{origin}/poc/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/poc/cancel",
        metadata={
            "tys_type": "subscription",
            "tys_tenant_slug": payload.tenant_slug,
            "tys_plan": payload.plan_name,
        },
    )
    session: CheckoutSessionResponse = await chk.create_checkout_session(req)
    await db.poc_payments.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_slug": payload.tenant_slug,
        "stripe_session_id": session.session_id,
        "type": "subscription",
        "status": "pending",
        "amount_cents": int(round(amount_usd * 100)),
        "currency": "usd",
        "description": f"Suscripción organizador {plan['name']} (POC)",
        "plan_name": payload.plan_name,
        "event_name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
    })
    return CheckoutCreatedResponse(checkout_url=session.url, session_id=session.session_id)


@router.post("/stripe/create-ticket-session", response_model=CheckoutCreatedResponse)
async def create_ticket_session(request: Request, payload: CreateTicketRequest):
    tenant = await db.tenants.find_one({"slug": payload.tenant_slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if tenant.get("status") != "active":
        raise HTTPException(403, "Tenant not active")
    event_name = payload.event_name.strip()
    if not event_name:
        raise HTTPException(400, "event_name required")
    amount_usd = payload.amount_cents / 100.0

    origin = payload.origin_url.rstrip("/")
    chk = _checkout(request)
    req = CheckoutSessionRequest(
        amount=float(amount_usd),
        currency="usd",
        success_url=f"{origin}/poc/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/poc/cancel",
        metadata={
            "tys_type": "ticket",
            "tys_tenant_slug": payload.tenant_slug,
            "tys_event": event_name,
        },
    )
    session: CheckoutSessionResponse = await chk.create_checkout_session(req)
    await db.poc_payments.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_slug": payload.tenant_slug,
        "stripe_session_id": session.session_id,
        "type": "ticket",
        "status": "pending",
        "amount_cents": payload.amount_cents,
        "currency": "usd",
        "description": f"Ticket evento: {event_name}",
        "plan_name": None,
        "event_name": event_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
    })
    return CheckoutCreatedResponse(checkout_url=session.url, session_id=session.session_id)


@router.get("/stripe/status/{session_id}", response_model=StatusResponse)
async def poc_stripe_status(session_id: str, request: Request):
    chk = _checkout(request)
    stripe_payment_status = "unknown"
    stripe_status = "unknown"
    amount_total = 0
    currency = "usd"
    try:
        status_obj: CheckoutStatusResponse = await chk.get_checkout_status(session_id)
        stripe_payment_status = status_obj.payment_status
        stripe_status = status_obj.status
        amount_total = status_obj.amount_total
        currency = status_obj.currency
        if status_obj.payment_status == "paid":
            await _mark_paid(session_id, status_obj.amount_total, status_obj.currency)
    except Exception as e:
        logger.warning("poc get_checkout_status soft-failed: %s", e)

    payment = await db.poc_payments.find_one({"stripe_session_id": session_id}, {"_id": 0})
    db_status = payment["status"] if payment else "pending"
    if db_status == "paid" and stripe_payment_status == "unknown":
        stripe_payment_status = "paid"
        stripe_status = "complete"
        if payment:
            amount_total = payment.get("amount_cents", amount_total)
            currency = payment.get("currency", currency)

    return StatusResponse(
        session_id=session_id,
        payment_status=stripe_payment_status,
        status=stripe_status,
        amount_total=amount_total,
        currency=currency,
        db_status=db_status,
    )


@router.get("/payments", response_model=List[PocPaymentOut])
async def list_poc_payments(tenant_slug: str = Query(..., min_length=1)):
    cursor = db.poc_payments.find(
        {"tenant_slug": tenant_slug.strip().lower()}, {"_id": 0}
    ).sort("created_at", -1).limit(100)
    docs = await cursor.to_list(length=100)
    return [_to_out(d) for d in docs]
