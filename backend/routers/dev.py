"""DEV-only endpoints. Enabled when ENV=development OR ENABLE_DEMO_SHORTCUTS=true."""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import AsyncSessionLocal
from db_helpers import organizer_row_to_dict, get_organizer_by_id, row_to_dict
from orm_models import Organizer, OrganizerAdminComment, SubscriptionPlan, Tenant, Ticket, TicketOrder
from security import get_current_user
from services.activation import log_funnel_event

logger = logging.getLogger("tys.dev")
router = APIRouter(prefix="/api/_dev", tags=["dev"])

EMAIL_LOG_DIR = Path(__file__).resolve().parent.parent / "email_log"


def _dev_enabled() -> bool:
    env = os.environ.get("ENV", "development")
    flag = os.environ.get("ENABLE_DEMO_SHORTCUTS", "").lower() in ("1", "true", "yes")
    return env != "production" or flag


def _dev_only():
    if not _dev_enabled():
        raise HTTPException(status_code=404, detail="Not found")


# ── Public discovery flag (frontend asks if dev features are on) ────────────
@router.get("/enabled")
async def dev_enabled():
    return {"enabled": _dev_enabled()}


# ── Email log viewer ────────────────────────────────────────────────────────
@router.get("/email-log")
async def list_email_log():
    _dev_only()
    EMAIL_LOG_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(EMAIL_LOG_DIR.glob("*.html"), reverse=True)
    return [
        {
            "name": f.name,
            "size_bytes": f.stat().st_size,
            "viewer_url": f"/api/_dev/email-log/{f.name}",
        }
        for f in files
    ]


@router.get("/email-log/{name}", response_class=HTMLResponse)
async def get_email_log(name: str):
    _dev_only()
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    path = EMAIL_LOG_DIR / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/html")


# ── Demo shortcut — bypass payment + admin approval ─────────────────────────
class DemoActivateBody(BaseModel):
    organizer_id: Optional[str] = None
    plan_code: Optional[str] = None  # default: profesional


@router.post("/demo-activate")
async def demo_activate(payload: DemoActivateBody, user=Depends(get_current_user)):
    """
    Skip Stripe + admin approval. Approves the organizer, attaches a plan,
    activates the tenant, creates a default microsite, logs subscription_active.
    Idempotent: safe to call multiple times.
    """
    _dev_only()

    organizer_id = payload.organizer_id or user.get("organizer_id")
    if not organizer_id:
        raise HTTPException(status_code=422, detail="organizer_id required")

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Organizer)
            .where(Organizer.id == organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_row = result.scalar_one_or_none()
        if not org_row:
            raise HTTPException(status_code=404, detail="Organizer not found")

        # Authorization: a regular user can only activate their own organizer.
        if user.get("role") != "super_admin" and user.get("organizer_id") != organizer_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        plan_code = payload.plan_code or "profesional"
        plan_result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code)
        )
        plan = plan_result.scalar_one_or_none()
        if not plan:
            any_plan_result = await session.execute(select(SubscriptionPlan).limit(1))
            plan = any_plan_result.scalar_one_or_none()
        plan_id = plan.id if plan else None

        now = datetime.now(timezone.utc)
        period_end = now + timedelta(days=30)

        existing_comments = org_row.admin_comments or []
        needs_demo_comment = not any(
            c.comment.startswith("[Demo]") for c in existing_comments
        )
        if needs_demo_comment:
            comment = OrganizerAdminComment(
                id=str(uuid.uuid4()),
                organizer_id=organizer_id,
                admin_id="demo_shortcut",
                admin_email="demo@ticketyourself.com",
                comment="[Demo] Auto-aprobado por shortcut de preview",
                created_at=now,
            )
            session.add(comment)

        org_row.status = "approved"
        org_row.subscription_status = "active"
        if not org_row.stripe_customer_id:
            org_row.stripe_customer_id = "demo_customer"
        org_row.current_period_end = period_end
        org_row.plan_id = plan_id
        if not org_row.approved_at:
            org_row.approved_at = now
        if not org_row.approved_by:
            org_row.approved_by = "demo_shortcut"

        tenant_result = await session.execute(
            select(Tenant).where(Tenant.slug == org_row.slug)
        )
        tenant_row = tenant_result.scalar_one_or_none()
        if tenant_row:
            tenant_row.status = "active"

        await session.flush()
        await session.refresh(org_row, ["admin_comments"])
        organizer = organizer_row_to_dict(org_row)

    # Microsite — create default if missing.
    from routers.microsite import _get_or_create_microsite_row
    await _get_or_create_microsite_row(organizer)

    # Funnel — best-effort.
    try:
        await log_funnel_event(organizer_id=organizer_id, event_name="plan_selected")
        await log_funnel_event(organizer_id=organizer_id, event_name="checkout_started")
        await log_funnel_event(organizer_id=organizer_id, event_name="subscription_active")
    except Exception:  # noqa: BLE001
        pass

    logger.info("Demo shortcut activated organizer=%s plan=%s", organizer_id, plan_code)
    return organizer


# ── Demo shortcut — simulate ticket purchase paid ────────────────────────────
class SimulatePurchasePaidBody(BaseModel):
    order_number: str


@router.post("/simulate-purchase-paid")
async def simulate_purchase_paid(payload: SimulatePurchasePaidBody):
    """
    Public-safe (no auth) — accepts an `order_number` and finalizes it as paid.
    Useful in preview where Stripe webhooks don't arrive. The order_number is
    the secret (UUID-like sequence) so an attacker would need to guess valid
    sequential numbers. In production with real webhooks this endpoint is off.
    """
    _dev_only()
    async with AsyncSessionLocal() as _pg:
        _order_row = await _pg.scalar(
            select(TicketOrder).where(TicketOrder.order_number == payload.order_number)
        )
        if not _order_row:
            raise HTTPException(status_code=404, detail="Order not found")
        order = row_to_dict(_order_row)
        if order["status"] == "paid":
            _tickets_result = await _pg.execute(
                select(Ticket).where(Ticket.order_id == order["id"])
            )
            return {
                "ok": True,
                "already_paid": True,
                "tickets": [row_to_dict(t) for t in _tickets_result.scalars().all()],
            }

    from services import order_service
    from services.email_service import send_purchase_confirmation

    finalized, tickets = await order_service.finalize_paid_order(order=order)
    try:
        from db_helpers import get_event_by_id
        event = await get_event_by_id(order["event_id"])
        organizer = await get_organizer_by_id(order["organizer_id"])
        await send_purchase_confirmation(
            order=finalized, event=event, organizer=organizer, tickets=tickets
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed sending purchase confirmation in demo simulate")
    logger.info(
        "Demo simulate-purchase-paid order=%s tickets=%d",
        finalized["order_number"],
        len(tickets),
    )
    return {"ok": True, "order": finalized, "tickets": tickets}
