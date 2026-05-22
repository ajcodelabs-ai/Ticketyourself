"""DEV-only endpoints. Enabled when ENV=development OR ENABLE_DEMO_SHORTCUTS=true."""
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from db import db
from security import get_current_user
from services.activation import log_funnel_event
from services.microsite_factory import default_microsite

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

    organizer = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")

    # Authorization: a regular user can only activate their own organizer.
    if user.get("role") != "super_admin" and user.get("organizer_id") != organizer_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    plan_code = payload.plan_code or "profesional"
    plan = await db.subscription_plans.find_one({"code": plan_code}, {"_id": 0})
    if not plan:
        # fallback to any plan, then profesional should always exist as seed
        plan = await db.subscription_plans.find_one({}, {"_id": 0})
    plan_id = plan["id"] if plan else None

    now = datetime.now(timezone.utc)
    period_end = (now + timedelta(days=30)).isoformat()

    existing_comments = organizer.get("admin_comments") or []
    needs_demo_comment = not any(
        c.get("comment", "").startswith("[Demo]") for c in existing_comments
    )
    new_comments = list(existing_comments)
    if needs_demo_comment:
        new_comments.append(
            {
                "id": f"demo-{now.timestamp()}",
                "admin_id": "demo_shortcut",
                "admin_email": "demo@ticketyourself.com",
                "comment": "[Demo] Auto-aprobado por shortcut de preview",
                "created_at": now.isoformat(),
            }
        )

    set_doc = {
        "status": "approved",
        "subscription_status": "active",
        "stripe_customer_id": organizer.get("stripe_customer_id") or "demo_customer",
        "current_period_end": period_end,
        "plan_id": plan_id,
        "approved_at": organizer.get("approved_at") or now.isoformat(),
        "approved_by": organizer.get("approved_by") or "demo_shortcut",
        "admin_comments": new_comments,
    }

    await db.organizers.update_one({"id": organizer_id}, {"$set": set_doc})
    await db.tenants.update_one(
        {"slug": organizer["slug"]}, {"$set": {"status": "active"}}
    )

    # Microsite — create default if missing.
    existing_ms = await db.microsites.find_one(
        {"organizer_id": organizer_id}, {"_id": 0, "id": 1}
    )
    if not existing_ms:
        await db.microsites.insert_one(
            default_microsite(
                organizer_id=organizer_id,
                tenant_slug=organizer["slug"],
                company_name=organizer.get("company_name") or organizer["slug"],
            )
        )

    # Funnel — best-effort.
    try:
        await log_funnel_event(organizer_id=organizer_id, event_name="plan_selected")
        await log_funnel_event(organizer_id=organizer_id, event_name="checkout_started")
        await log_funnel_event(organizer_id=organizer_id, event_name="subscription_active")
    except Exception:  # noqa: BLE001
        pass

    refreshed = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    logger.info("Demo shortcut activated organizer=%s plan=%s", organizer_id, plan_code)
    return refreshed
