"""
OneShot e-signature integration (contract before publish).

Credentials come from env (set later in .env):
  ONESHOT_API_KEY=
  ONESHOT_API_BASE=https://api.oneshot.example
  ONESHOT_WEBHOOK_SECRET=
  ONESHOT_TEMPLATE_ID=

Until credentials are set, send_contract() stores a local pending contract
and returns a stub external id so the publish gate and admin UI can be tested.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger("tys.oneshot")


def _cfg() -> Dict[str, str]:
    return {
        "api_key": os.environ.get("ONESHOT_API_KEY", "").strip(),
        "api_base": os.environ.get("ONESHOT_API_BASE", "").rstrip("/"),
        "webhook_secret": os.environ.get("ONESHOT_WEBHOOK_SECRET", "").strip(),
        "template_id": os.environ.get("ONESHOT_TEMPLATE_ID", "").strip(),
    }


def is_configured() -> bool:
    c = _cfg()
    return bool(c["api_key"] and c["api_base"])


async def send_contract(
    *,
    organizer_id: str,
    organizer_email: str,
    company_name: str,
    legal_id: str,
    plan_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create / send a contract for the organizer.
    Returns {external_id, status, stub}.
    """
    c = _cfg()
    now = datetime.now(timezone.utc)

    if not is_configured():
        external_id = f"stub_oneshot_{organizer_id[:8]}_{uuid.uuid4().hex[:8]}"
        logger.warning(
            "OneShot not configured — stub contract %s for organizer %s",
            external_id,
            organizer_id,
        )
        return {
            "external_id": external_id,
            "status": "sent",
            "stub": True,
            "sent_at": now.isoformat(),
            "message": (
                "Contrato registrado en modo stub (ONESHOT_API_KEY no configurada). "
                "Cuando configures OneShot se enviará el documento real."
            ),
        }

    payload = {
        "template_id": c["template_id"] or None,
        "signers": [
            {
                "email": organizer_email,
                "name": company_name,
                "role": "organizer",
            }
        ],
        "metadata": {
            "organizer_id": organizer_id,
            "legal_id": legal_id,
            "plan_code": plan_code,
        },
    }
    headers = {
        "Authorization": f"Bearer {c['api_key']}",
        "Content-Type": "application/json",
    }
    url = f"{c['api_base']}/contracts"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.error("OneShot send failed: %s %s", resp.status_code, resp.text[:200])
            raise RuntimeError(f"OneShot error {resp.status_code}")
        data = resp.json()
    external_id = str(
        data.get("id") or data.get("contract_id") or data.get("external_id") or ""
    )
    if not external_id:
        raise RuntimeError("OneShot response missing contract id")
    return {
        "external_id": external_id,
        "status": "sent",
        "stub": False,
        "sent_at": now.isoformat(),
        "raw": data,
    }


def verify_webhook_signature(body: bytes, signature_header: Optional[str]) -> bool:
    secret = _cfg()["webhook_secret"]
    if not secret:
        # Allow unsigned webhooks only when secret not configured (dev)
        return True
    if not signature_header:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    # Accept raw hex or "sha256=..."
    provided = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)
