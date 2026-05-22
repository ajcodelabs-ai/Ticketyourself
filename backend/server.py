"""
Ticket Yourself (TYS) — Backend
Fase 0: POC de integraciones riesgosas (Stripe + multitenancy resolution).

Endpoints prefixed with /api per ingress rules.
"""
from fastapi import FastAPI, APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime, timezone
from pathlib import Path
import os
import uuid
import logging

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
)

# ──────────────────────────────────────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("tys")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

# Sub-hosts que NUNCA representan un tenant.
RESERVED_SUBDOMAINS = {"www", "api", "admin", "app", "static", "assets"}

# Plan catalogue (POC). Real recurring subscriptions vienen en Fase 1+; aquí
# se cobra un cargo único equivalente al primer mes para validar el flujo.
SUBSCRIPTION_PLANS = {
    "basic": {"name": "Básico", "amount_usd": 20.00},
    "pro":   {"name": "Pro",    "amount_usd": 50.00},
}

# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────
class TenantOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slug: str
    name: str
    status: Literal["active", "suspended"]


class ResolveResponse(BaseModel):
    tenant: Optional[TenantOut] = None


class CreateSubscriptionRequest(BaseModel):
    tenant_slug: str
    plan_name: Literal["basic", "pro"]
    origin_url: str  # frontend window.location.origin


class CreateTicketRequest(BaseModel):
    tenant_slug: str
    event_name: str
    amount_cents: int = Field(..., gt=0, le=10_000_00)  # max $10k POC safety
    origin_url: str


class CheckoutCreatedResponse(BaseModel):
    checkout_url: str
    session_id: str


class PocPaymentOut(BaseModel):
    id: str
    tenant_slug: str
    stripe_session_id: str
    type: Literal["subscription", "ticket"]
    status: Literal["pending", "paid", "failed"]
    amount_cents: int
    currency: str
    description: Optional[str] = None
    plan_name: Optional[str] = None
    event_name: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None


class StatusResponse(BaseModel):
    session_id: str
    payment_status: str
    status: str
    amount_total: int
    currency: str
    db_status: Literal["pending", "paid", "failed"]


# ──────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Ticket Yourself API",
    version="0.1.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)
api = APIRouter(prefix="/api")


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _stripe_for_request(request: Request) -> StripeCheckout:
    """Crea instancia StripeCheckout con webhook_url derivado del request."""
    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/stripe/webhook"
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


def _extract_subdomain(host: str) -> Optional[str]:
    """
    Devuelve el sub-dominio "tenant" si aplica.

    Producción (TYS): clientes acceden vía `<slug>.ticketyourself.com`.
    En ese caso el primer label del host es el slug del tenant.

    Preview Emergent: el host es algo como
        d049ce64-7122-4dac-92d0-1c8f818c9d2b.preview.emergentagent.com
    El primer label es un UUID que jamás coincidirá con un slug en DB,
    así que el lookup en Mongo simplemente devolverá None y caeremos al
    fallback de ?tenant=... (ver /tenants/resolve).
    """
    if not host:
        return None
    host_no_port = host.split(":", 1)[0].strip().lower()
    parts = host_no_port.split(".")
    if len(parts) < 3:
        return None
    sub = parts[0]
    if not sub or sub in RESERVED_SUBDOMAINS:
        return None
    return sub


def _payment_doc_to_out(doc: dict) -> PocPaymentOut:
    created = doc["created_at"]
    if isinstance(created, str):
        created = datetime.fromisoformat(created)
    paid = doc.get("paid_at")
    if isinstance(paid, str):
        paid = datetime.fromisoformat(paid)
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
        created_at=created,
        paid_at=paid,
    )


async def _mark_payment_paid(session_id: str, amount_total: int, currency: str) -> Optional[dict]:
    """
    Marca el pago como 'paid' SOLO si todavía no está pagado (idempotente).
    Devuelve el documento actualizado o None si no existe.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.poc_payments.find_one_and_update(
        {"stripe_session_id": session_id, "status": {"$ne": "paid"}},
        {"$set": {
            "status": "paid",
            "paid_at": now_iso,
            "amount_cents": amount_total,
            "currency": currency,
        }},
        return_document=True,
        projection={"_id": 0},
    )
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────
@api.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/tenants/resolve", response_model=ResolveResponse)
async def resolve_tenant(
    request: Request,
    tenant: Optional[str] = Query(default=None),
):
    """
    Resolución de tenant.

    Orden:
      1. Subdominio del Host header (producción).
      2. Query param ?tenant=<slug> (preview / fallback explícito).

    Devuelve 200 con tenant=null si no se resuelve nada (no es error).
    """
    host = request.headers.get("host", "")
    slug = _extract_subdomain(host)

    if slug:
        doc = await db.tenants.find_one({"slug": slug}, {"_id": 0})
        if doc and doc.get("status") == "active":
            return ResolveResponse(tenant=TenantOut(**doc))

    if tenant:
        doc = await db.tenants.find_one({"slug": tenant.strip().lower()}, {"_id": 0})
        if doc:
            return ResolveResponse(tenant=TenantOut(**doc))

    return ResolveResponse(tenant=None)


@api.post(
    "/poc/stripe/create-subscription-session",
    response_model=CheckoutCreatedResponse,
)
async def create_subscription_session(
    request: Request,
    payload: CreateSubscriptionRequest,
):
    """
    Crea Stripe Checkout Session para "suscripción de organizador".

    Nota POC: emergentintegrations.checkout sólo expone pagos one-time, así
    que cobramos un cargo único equivalente al primer mes del plan elegido.
    El modelo de suscripción recurrente real (mode=subscription + price_id)
    se implementa en Fase 1+ cuando demos de alta los Products en Stripe.
    """
    tenant = await db.tenants.find_one({"slug": payload.tenant_slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.get("status") != "active":
        raise HTTPException(status_code=403, detail="Tenant not active")

    if payload.plan_name not in SUBSCRIPTION_PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")
    plan = SUBSCRIPTION_PLANS[payload.plan_name]
    amount_usd = plan["amount_usd"]

    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/poc/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/poc/cancel"

    stripe_checkout = _stripe_for_request(request)
    req = CheckoutSessionRequest(
        amount=float(amount_usd),
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "tys_type": "subscription",
            "tys_tenant_slug": payload.tenant_slug,
            "tys_plan": payload.plan_name,
        },
    )
    session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(req)

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_slug": payload.tenant_slug,
        "stripe_session_id": session.session_id,
        "type": "subscription",
        "status": "pending",
        "amount_cents": int(round(amount_usd * 100)),
        "currency": "usd",
        "description": f"Suscripción organizador {plan['name']} (POC, cargo único)",
        "plan_name": payload.plan_name,
        "event_name": None,
        "created_at": now_iso,
        "paid_at": None,
    }
    await db.poc_payments.insert_one(doc)

    return CheckoutCreatedResponse(checkout_url=session.url, session_id=session.session_id)


@api.post(
    "/poc/stripe/create-ticket-session",
    response_model=CheckoutCreatedResponse,
)
async def create_ticket_session(
    request: Request,
    payload: CreateTicketRequest,
):
    """
    Crea Stripe Checkout Session para compra de un ticket de evento (POC).
    """
    tenant = await db.tenants.find_one({"slug": payload.tenant_slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.get("status") != "active":
        raise HTTPException(status_code=403, detail="Tenant not active")

    event_name = payload.event_name.strip()
    if not event_name:
        raise HTTPException(status_code=400, detail="event_name required")

    amount_usd = payload.amount_cents / 100.0

    origin = payload.origin_url.rstrip("/")
    success_url = f"{origin}/poc/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/poc/cancel"

    stripe_checkout = _stripe_for_request(request)
    req = CheckoutSessionRequest(
        amount=float(amount_usd),
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "tys_type": "ticket",
            "tys_tenant_slug": payload.tenant_slug,
            "tys_event": event_name,
        },
    )
    session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(req)

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
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
        "created_at": now_iso,
        "paid_at": None,
    }
    await db.poc_payments.insert_one(doc)

    return CheckoutCreatedResponse(checkout_url=session.url, session_id=session.session_id)


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """
    Recibe webhook de Stripe. Verifica firma vía emergentintegrations y
    marca el poc_payment correspondiente como 'paid' (idempotente).

    NOTA: con la API key `sk_test_emergent` los webhooks pueden no
    llegar a este endpoint en preview (el playbook de Emergent indica
    que hay que polling). Por eso /api/poc/stripe/status/{session_id}
    también actualiza el DB. Ambos caminos son idempotentes.
    """
    body = await request.body()
    stripe_sig = request.headers.get("Stripe-Signature", "")

    if not body or not stripe_sig:
        raise HTTPException(status_code=400, detail="Missing body or signature")

    stripe_checkout = _stripe_for_request(request)
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, stripe_sig)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Webhook verification/parse failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid webhook: {e}")

    logger.info(
        "Stripe webhook event_type=%s event_id=%s session=%s payment_status=%s",
        webhook_response.event_type,
        webhook_response.event_id,
        webhook_response.session_id,
        webhook_response.payment_status,
    )

    if webhook_response.payment_status == "paid" and webhook_response.session_id:
        try:
            status_obj: CheckoutStatusResponse = await stripe_checkout.get_checkout_status(
                webhook_response.session_id
            )
            await _mark_payment_paid(
                webhook_response.session_id,
                status_obj.amount_total,
                status_obj.currency,
            )
        except Exception:
            logger.exception("Could not enrich payment from webhook")

    return JSONResponse({"received": True})


@api.get("/poc/stripe/status/{session_id}", response_model=StatusResponse)
async def poc_stripe_status(session_id: str, request: Request):
    """
    Polling de Stripe Checkout. Actualiza el DB si el pago está confirmado.
    El frontend llama esto en /poc/success como respaldo al webhook.

    Resilencia: si la lib `emergentintegrations` falla (bug conocido al
    deserializar `metadata` como StripeObject, o "No such checkout.session"
    transitorio), devolvemos HTTP 200 con el estado del DB y
    payment_status='unknown' para que el frontend pueda seguir polling.
    Cuando llegue el webhook el DB ya marcará 'paid'.
    """
    stripe_checkout = _stripe_for_request(request)

    stripe_payment_status = "unknown"
    stripe_status = "unknown"
    amount_total = 0
    currency = "usd"
    stripe_error: Optional[str] = None

    try:
        status_obj: CheckoutStatusResponse = await stripe_checkout.get_checkout_status(session_id)
        stripe_payment_status = status_obj.payment_status
        stripe_status = status_obj.status
        amount_total = status_obj.amount_total
        currency = status_obj.currency
        if status_obj.payment_status == "paid":
            await _mark_payment_paid(session_id, status_obj.amount_total, status_obj.currency)
    except Exception as e:
        stripe_error = str(e)
        logger.warning(
            "get_checkout_status soft-failed for %s: %s",
            session_id, stripe_error,
        )

    payment = await db.poc_payments.find_one(
        {"stripe_session_id": session_id}, {"_id": 0}
    )
    db_status = payment["status"] if payment else "pending"
    # Si el DB ya está paid (webhook ya llegó), reflejarlo aunque la lib falle.
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


@api.get("/poc/payments", response_model=List[PocPaymentOut])
async def list_poc_payments(tenant_slug: str = Query(..., min_length=1)):
    cursor = db.poc_payments.find(
        {"tenant_slug": tenant_slug.strip().lower()}, {"_id": 0}
    ).sort("created_at", -1).limit(100)
    docs = await cursor.to_list(length=100)
    return [_payment_doc_to_out(d) for d in docs]


# ──────────────────────────────────────────────────────────────────────────────
# Startup: seed tenants idempotente
# ──────────────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    # Índice único en slug (idempotente).
    await db.tenants.create_index("slug", unique=True)
    await db.poc_payments.create_index("stripe_session_id", unique=True)
    await db.poc_payments.create_index("tenant_slug")

    seeds = [
        {"slug": "demo-org",       "name": "Demo Organizer",   "status": "active"},
        {"slug": "prueba-eventos", "name": "Prueba Eventos",   "status": "active"},
    ]
    now_iso = datetime.now(timezone.utc).isoformat()
    for s in seeds:
        await db.tenants.update_one(
            {"slug": s["slug"]},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "slug": s["slug"],
                    "name": s["name"],
                    "status": s["status"],
                    "created_at": now_iso,
                }
            },
            upsert=True,
        )
    logger.info("Seed tenants OK")


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()


# Mount router
app.include_router(api)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
