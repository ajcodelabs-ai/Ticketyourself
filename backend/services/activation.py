"""
Activation token + funnel event logger.

Token = JWT (HS256) with 7-day TTL signed by the same secret as auth.
Purpose claim distinguishes it from auth tokens. The funnel is stored as
one row per (organizer_id, event_type) in `activation_events` (PostgreSQL).
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from database import AsyncSessionLocal
from orm_models import ActivationEvent
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

FUNNEL_ORDER: tuple[FunnelEvent, ...] = (
    "email_sent",
    "link_clicked",
    "first_doc_uploaded",
    "plan_selected",
    "checkout_started",
    "subscription_active",
)


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
    """Idempotent — only creates the email_sent row if missing."""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        stmt = (
            pg_insert(ActivationEvent)
            .values(
                id=str(uuid.uuid4()),
                organizer_id=organizer_id,
                event_type="email_sent",
                metadata_={"user_id": user_id, "token_jti": token_jti},
                created_at=now,
            )
            .on_conflict_do_nothing(constraint="uq_activation_org_type")
        )
        await session.execute(stmt)
        await session.commit()


async def log_funnel_event(*, organizer_id: str, event_name: FunnelEvent) -> None:
    """Inserts a funnel event row; silently no-ops if already logged."""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        stmt = (
            pg_insert(ActivationEvent)
            .values(
                id=str(uuid.uuid4()),
                organizer_id=organizer_id,
                event_type=event_name,
                metadata_=None,
                created_at=now,
            )
            .on_conflict_do_nothing(constraint="uq_activation_org_type")
        )
        await session.execute(stmt)
        await session.commit()
    logger.info("Funnel event organizer=%s event=%s", organizer_id, event_name)


async def aggregate_funnel() -> dict:
    """
    Returns {counts: {event_name: int}, conversion: {step: pct_vs_previous}}.
    Each funnel step is counted as the number of distinct organizers that have
    a row with that event_type.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ActivationEvent.event_type, func.count(ActivationEvent.id).label("n"))
            .group_by(ActivationEvent.event_type)
        )
        counts_by_type = {r.event_type: r.n for r in result.all()}

    counts = {event: counts_by_type.get(event, 0) for event in FUNNEL_ORDER}
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
