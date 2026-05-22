"""Activation funnel endpoints (organizer events + admin aggregate)."""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from security import require_role
from services.activation import (
    FUNNEL_ORDER,
    aggregate_funnel,
    decode_activation_token,
    log_funnel_event,
)

logger = logging.getLogger("tys.activation_router")

router = APIRouter(prefix="/api/activation", tags=["activation"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin-activation"])


FunnelEventIn = Literal[
    "link_clicked",
    "first_doc_uploaded",
    "plan_selected",
    "checkout_started",
    "subscription_active",
]


class LogEventBody(BaseModel):
    token: Optional[str] = None
    organizer_id: Optional[str] = None  # alt path when user is logged in
    event_name: FunnelEventIn


@router.post("/log-event")
async def log_event(payload: LogEventBody):
    """
    Public endpoint (no auth) but requires either a valid activation token OR
    an organizer_id. Use the token path for unauthenticated link-clicked events,
    and the organizer_id path when the user is already logged in (frontend
    interceptor can forward it).
    """
    if payload.token:
        claims = decode_activation_token(payload.token)
        organizer_id = claims.get("organizer_id")
    else:
        organizer_id = payload.organizer_id
    if not organizer_id:
        raise HTTPException(status_code=422, detail="token or organizer_id required")
    await log_funnel_event(organizer_id=organizer_id, event_name=payload.event_name)
    return {"ok": True}


# ── Admin funnel ────────────────────────────────────────────────────────────
@admin_router.get("/activation-funnel")
async def admin_activation_funnel(_user=Depends(require_role("super_admin"))):
    agg = await aggregate_funnel()
    # Add a friendly ordered representation for the frontend.
    steps = []
    for event in FUNNEL_ORDER:
        steps.append(
            {
                "event": event,
                "count": agg["counts"].get(event, 0),
                "conversion_from_prev": agg["conversion"].get(event, 0.0),
            }
        )
    return {"steps": steps, "counts": agg["counts"], "conversion": agg["conversion"]}
