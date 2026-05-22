"""
Activation token + funnel event logger.

Token = JWT (HS256) with 7-day TTL signed by the same secret as auth.
Purpose claim distinguishes it from auth tokens. The funnel is stored as a
single document per organizer in `activation_events`, mutated in place as
the user progresses through onboarding.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import HTTPException

from db import db
from security import JWT_ALGORITHM, _jwt_secret

logger = logging.getLogger("tys.activation")

ACTIVATION_TTL_DAYS = 7
ACTIVATION_PURPOSE = "first_access"

FunnelEvent = Literal[
    "email_sent",
    "link_clicked",
    "first_doc_uploaded",
    "plan_selected",
    "checkout_started",
    "subscription_active",
]

# Funnel order — used by the admin endpoint to compute conversion rates.
FUNNEL_ORDER: tuple[FunnelEvent, ...] = (
    "email_sent",
    "link_clicked",
    "first_doc_uploaded",
    "plan_selected",
    "checkout_started",
    "subscription_active",
)

# Maps event name → field in activation_events doc.
_FIELD_MAP = {
    "email_sent": "email_sent_at",
    "link_clicked": "link_clicked_at",
    "first_doc_uploaded": "first_doc_uploaded_at",
    "plan_selected": "plan_selected_at",
    "checkout_started": "checkout_started_at",
    "subscription_active": "subscription_active_at",
}


def create_activation_token(*, user_id: str, organizer_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "organizer_id": organizer_id,
        "purpose": ACTIVATION_PURPOSE,
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=ACTIVATION_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_activation_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Activation token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid activation token")
    if payload.get("purpose") != ACTIVATION_PURPOSE:
        raise HTTPException(status_code=401, detail="Wrong token purpose")
    return payload


async def ensure_activation_record(*, user_id: str, organizer_id: str, token_jti: str) -> None:
    """Idempotent — only creates if missing."""
    existing = await db.activation_events.find_one({"organizer_id": organizer_id})
    if existing:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.activation_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "organizer_id": organizer_id,
            "token_jti": token_jti,
            "email_sent_at": now_iso,
            "link_clicked_at": None,
            "first_doc_uploaded_at": None,
            "plan_selected_at": None,
            "checkout_started_at": None,
            "subscription_active_at": None,
            "created_at": now_iso,
        }
    )


async def log_funnel_event(
    *,
    organizer_id: str,
    event_name: FunnelEvent,
) -> None:
    """Sets the *_at field to now if not already set (no clobber)."""
    field = _FIELD_MAP.get(event_name)
    if not field:
        return
    doc = await db.activation_events.find_one(
        {"organizer_id": organizer_id}, {"_id": 0, field: 1}
    )
    if doc and doc.get(field):
        return  # Already logged.
    now_iso = datetime.now(timezone.utc).isoformat()
    # upsert: create the row if no welcome email was logged (defensive).
    await db.activation_events.update_one(
        {"organizer_id": organizer_id},
        {
            "$set": {field: now_iso},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "organizer_id": organizer_id,
                "created_at": now_iso,
            },
        },
        upsert=True,
    )
    logger.info("Funnel event organizer=%s event=%s", organizer_id, event_name)


async def aggregate_funnel() -> dict:
    """
    Returns {counts: {event_name: int}, conversion: {step: pct_vs_previous}}.
    Each event is counted as "any organizer with that *_at field non-null".
    """
    counts = {}
    for event in FUNNEL_ORDER:
        field = _FIELD_MAP[event]
        counts[event] = await db.activation_events.count_documents(
            {field: {"$ne": None, "$exists": True}}
        )
    conversion = {}
    prev_event = None
    for event in FUNNEL_ORDER:
        if prev_event is None:
            conversion[event] = 1.0 if counts[event] > 0 else 0.0
        else:
            prev_count = counts[prev_event]
            conversion[event] = (counts[event] / prev_count) if prev_count > 0 else 0.0
        prev_event = event
    return {"counts": counts, "conversion": conversion}
