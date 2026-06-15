"""
Ticket JWT — separate secret from auth JWT so we can rotate independently.
The QR code on each ticket is the JWT itself. Validators verify signature
+ exp + purpose, then look up the ticket in DB for revocation status.
"""
import logging
import os
from datetime import datetime, timezone

import jwt

logger = logging.getLogger("tys.ticket_jwt")

TICKET_PURPOSE = "ticket_admission"
TICKET_ALG = "HS256"


def _ticket_secret() -> str:
    # Falls back to auth secret + a suffix so it's always defined,
    # but prefer setting TICKET_JWT_SECRET explicitly in production.
    explicit = os.environ.get("TICKET_JWT_SECRET", "").strip()
    if explicit:
        return explicit
    auth = os.environ.get("JWT_SECRET", "").strip() or "dev-secret"
    return f"{auth}::ticket"


def issue_ticket_token(
    *,
    ticket_id: str,
    event_id: str,
    order_id: str,
    buyer_email: str,
    event_ends_at_iso: str | None,
) -> str:
    now = datetime.now(timezone.utc)
    # Token expires 1 year after event ends (default 1 year from now if unknown).
    if isinstance(event_ends_at_iso, datetime):
        event_ends_at_iso = event_ends_at_iso.isoformat()
    if event_ends_at_iso:
        try:
            ends = datetime.fromisoformat(event_ends_at_iso.replace("Z", "+00:00"))
            exp_dt = ends.replace(tzinfo=timezone.utc) if ends.tzinfo is None else ends
            exp_dt = exp_dt.replace(year=exp_dt.year + 1)
        except Exception:
            exp_dt = now.replace(year=now.year + 1)
    else:
        exp_dt = now.replace(year=now.year + 1)
    payload = {
        "purpose": TICKET_PURPOSE,
        "ticket_id": ticket_id,
        "event_id": event_id,
        "order_id": order_id,
        "buyer_email": buyer_email,
        "iat": int(now.timestamp()),
        "exp": int(exp_dt.timestamp()),
    }
    return jwt.encode(payload, _ticket_secret(), algorithm=TICKET_ALG)


def verify_ticket_token(token: str) -> dict:
    """Returns the decoded payload or raises ValueError."""
    try:
        payload = jwt.decode(token, _ticket_secret(), algorithms=[TICKET_ALG])
    except jwt.ExpiredSignatureError as e:
        raise ValueError("Ticket expired") from e
    except jwt.InvalidTokenError as e:
        raise ValueError("Invalid ticket token") from e
    if payload.get("purpose") != TICKET_PURPOSE:
        raise ValueError("Wrong token purpose")
    return payload
