"""Verificante KYC (Talento Humano) for Ecuador persona natural.

Docs: https://dash.verificante.com/api/v1/docs
  POST /api/v1/vetting/request         — create a check (cédula)
  POST /api/v1/vetting/requests/status — fetch by id (admin refresh / webhook fallback)

``riskLevel == LOW`` is a signal for the super admin. This service never
changes ``organizers.status`` and never blocks registration.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from services.ec_id import digits_only, is_valid_ec_cedula

logger = logging.getLogger("tys.verificante")

DEFAULT_API_BASE = "https://dash.verificante.com"
ALLOWED_RISK = "LOW"
TERMINAL_OK = frozenset({"completed", "completed_partial"})
TERMINAL_FAIL = frozenset({"cancelled", "canceled", "failed", "error"})
IN_FLIGHT = frozenset({"pending", "sending", "in_progress"})
WEBHOOK_TOLERANCE_SEC = 300


class VerificanteError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def applies_to(country_code: str | None, org_type: str | None) -> bool:
    return (country_code or "").strip().upper() == "EC" and (
        org_type or ""
    ).strip().lower() == "individual"


def api_base() -> str:
    return (os.environ.get("VERIFICANTE_API_BASE") or DEFAULT_API_BASE).rstrip("/")


def api_key() -> str:
    return (os.environ.get("VERIFICANTE_API_KEY") or "").strip()


def is_configured() -> bool:
    return bool(api_key())


def mock_enabled() -> bool:
    if os.environ.get("ENV", "").strip().lower() == "production":
        return False
    return os.environ.get("VERIFICANTE_MOCK", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def normalize_risk_level(raw: Any) -> Optional[str]:
    text = str(raw or "").strip().upper()
    if text in {"LOW", "MEDIUM", "HIGH"}:
        return text
    return text or None


def is_admitted(risk_level: Any) -> bool:
    return normalize_risk_level(risk_level) == ALLOWED_RISK


def extract_cedula(legal_id: str | None) -> Optional[str]:
    """10-digit cédula. Natural-person RUC (13 digits) → first 10."""
    number = digits_only(legal_id)
    if len(number) >= 10:
        cedula = number[:10]
        if is_valid_ec_cedula(cedula) or len(number) in (10, 13):
            return cedula
    return None


def operator_user_info() -> dict[str, str]:
    """Platform identity for Verificante's userInfo (who requested the check)."""
    email = (os.environ.get("EMAIL_FROM") or "noreply@ticketyourself.com").strip()
    return {"userName": "Ticket Yourself", "userEmail": email[:255]}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _base_record(
    *,
    identification: str | None,
    names: str | None = None,
    organizer_id: str | None = None,
) -> dict[str, Any]:
    return {
        "applicable": True,
        "status": "pending",
        "verification_id": None,
        "identification": identification,
        "risk_level": None,
        "admitted": False,
        "pdf_url": None,
        "summary": None,
        "person_names": names,
        "error": None,
        "requested_at": _now_iso(),
        "completed_at": None,
        "webhook_event_id": None,
        "candidate_id": organizer_id,
        "mock": False,
    }


def skipped_record(
    *,
    identification: str | None = None,
    names: str | None = None,
    organizer_id: str | None = None,
    reason: str = "not_configured",
) -> dict[str, Any]:
    row = _base_record(
        identification=identification, names=names, organizer_id=organizer_id
    )
    row["status"] = "skipped"
    row["error"] = reason
    return row


def failed_record(
    *,
    identification: str | None = None,
    names: str | None = None,
    organizer_id: str | None = None,
    error: str = "unknown",
    verification_id: str | None = None,
) -> dict[str, Any]:
    row = _base_record(
        identification=identification, names=names, organizer_id=organizer_id
    )
    row["status"] = "failed"
    row["error"] = (error or "unknown")[:400]
    row["verification_id"] = verification_id
    return row


def mock_record(
    *,
    identification: str,
    names: str | None = None,
    organizer_id: str | None = None,
) -> dict[str, Any]:
    now = _now_iso()
    return {
        "applicable": True,
        "status": "completed",
        "verification_id": f"mock_{identification or uuid.uuid4().hex[:12]}",
        "identification": identification,
        "risk_level": ALLOWED_RISK,
        "admitted": True,
        "pdf_url": None,
        "summary": "Comprobante de prueba (VERIFICANTE_MOCK).",
        "person_names": names,
        "error": None,
        "requested_at": now,
        "completed_at": now,
        "webhook_event_id": None,
        "candidate_id": organizer_id,
        "mock": True,
    }


def record_from_api_item(
    item: dict[str, Any],
    *,
    identification: str,
    names: str | None = None,
    organizer_id: str | None = None,
    requested_at: str | None = None,
    mock: bool = False,
) -> dict[str, Any]:
    risk = normalize_risk_level(item.get("riskLevel") or item.get("risk_level"))
    state = str(item.get("state") or item.get("status") or "").strip().lower()
    if state in TERMINAL_FAIL:
        status = "failed"
    elif risk or state in TERMINAL_OK:
        status = "completed"
    else:
        status = "pending"
    completed = status in {"completed", "failed"}
    return {
        "applicable": True,
        "status": status,
        "verification_id": item.get("id") or item.get("verificationId"),
        "identification": digits_only(item.get("identification") or identification),
        "risk_level": risk,
        "admitted": is_admitted(risk),
        "pdf_url": item.get("urlPdf") or item.get("pdfUrl") or item.get("url_pdf"),
        "summary": item.get("verificanteRequestSummary") or item.get("summary"),
        "person_names": item.get("name") or names,
        "error": item.get("message") if status == "failed" else None,
        "requested_at": requested_at or _now_iso(),
        "completed_at": _now_iso() if completed else None,
        "webhook_event_id": None,
        "candidate_id": organizer_id,
        "mock": mock,
    }


def apply_webhook_data(
    existing: dict[str, Any] | None, payload: dict[str, Any]
) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    verification = (
        data.get("verification") if isinstance(data.get("verification"), dict) else {}
    )
    person = (
        verification.get("person")
        if isinstance(verification.get("person"), dict)
        else {}
    )
    merged = dict(existing or {})
    merged["applicable"] = True
    event_id = payload.get("id")
    if event_id:
        merged["webhook_event_id"] = event_id
    vid = (
        data.get("verificationId")
        or verification.get("id")
        or merged.get("verification_id")
    )
    if vid:
        merged["verification_id"] = vid
    risk = normalize_risk_level(data.get("riskLevel") or data.get("risk_level"))
    if risk:
        merged["risk_level"] = risk
        merged["admitted"] = is_admitted(risk)
    state = (
        str(data.get("status") or data.get("state") or verification.get("state") or "")
        .strip()
        .lower()
    )
    if risk or state in TERMINAL_OK:
        merged["status"] = "completed"
        merged["completed_at"] = data.get("completedAt") or _now_iso()
    elif state in TERMINAL_FAIL:
        merged["status"] = "failed"
        merged["error"] = str(data.get("message") or state)[:400]
        merged["completed_at"] = data.get("completedAt") or _now_iso()
    pdf = data.get("pdfUrl") or data.get("urlPdf")
    if pdf:
        merged["pdf_url"] = pdf
    if isinstance(data.get("summary"), (dict, str)) and data.get("summary"):
        merged["summary"] = data.get("summary")
    ident = person.get("identification") or data.get("identification")
    if ident:
        merged["identification"] = digits_only(str(ident))
    names = person.get("names") or person.get("name")
    if names:
        merged["person_names"] = names
    return merged


def verify_webhook_signature(
    raw_body: bytes,
    *,
    timestamp: str | None,
    signature: str | None,
    now: float | None = None,
) -> bool:
    secret = (os.environ.get("VERIFICANTE_WEBHOOK_SECRET") or "").strip()
    if not secret:
        return True
    if not timestamp or not signature:
        return False
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = int(now if now is not None else time.time())
    if abs(current - ts) > WEBHOOK_TOLERANCE_SEC:
        return False
    expected = (
        "v1="
        + hmac.new(
            secret.encode("utf-8"),
            timestamp.encode("utf-8") + b"." + raw_body,
            hashlib.sha256,
        ).hexdigest()
    )
    return hmac.compare_digest(expected, signature.strip())


async def start_check(
    *,
    organizer_id: str,
    legal_id: str,
    names: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Create a Verificante check. Never raises for business/network errors."""
    identification = extract_cedula(legal_id)
    if not identification:
        return failed_record(
            identification=digits_only(legal_id) or None,
            names=names,
            organizer_id=organizer_id,
            error="Cédula inválida",
        )
    if mock_enabled():
        logger.info("Verificante mock LOW for cedula ending %s", identification[-4:])
        return mock_record(
            identification=identification, names=names, organizer_id=organizer_id
        )
    if not is_configured():
        logger.info("Verificante skipped (no API key) for organizer %s", organizer_id)
        return skipped_record(
            identification=identification,
            names=names,
            organizer_id=organizer_id,
            reason="not_configured",
        )
    try:
        created = await _create_request(
            identification=identification,
            candidate_id=organizer_id,
            client=client,
        )
    except VerificanteError as exc:
        logger.warning("Verificante create failed for %s: %s", organizer_id, exc)
        return failed_record(
            identification=identification,
            names=names,
            organizer_id=organizer_id,
            error=str(exc),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Verificante unexpected error for %s: %s", organizer_id, type(exc).__name__
        )
        return failed_record(
            identification=identification,
            names=names,
            organizer_id=organizer_id,
            error=type(exc).__name__,
        )
    return record_from_api_item(
        created,
        identification=identification,
        names=names,
        organizer_id=organizer_id,
    )


async def fetch_status(
    record: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Refresh an existing check from Verificante. Best-effort."""
    verification_id = (record or {}).get("verification_id")
    if not verification_id or str(verification_id).startswith("mock_"):
        return dict(record or {})
    if not is_configured():
        return dict(record or {})
    try:
        item = await _fetch_request(str(verification_id), client=client)
    except VerificanteError as exc:
        logger.warning("Verificante status failed id=%s: %s", verification_id, exc)
        merged = dict(record)
        merged["error"] = str(exc)[:400]
        return merged
    updated = record_from_api_item(
        item,
        identification=record.get("identification") or "",
        names=record.get("person_names"),
        organizer_id=record.get("candidate_id"),
        requested_at=record.get("requested_at"),
    )
    updated["webhook_event_id"] = record.get("webhook_event_id")
    updated["mock"] = bool(record.get("mock"))
    return updated


async def _create_request(
    *,
    identification: str,
    candidate_id: str | None,
    client: httpx.AsyncClient | None,
) -> dict[str, Any]:
    subject: dict[str, Any] = {"identification": identification}
    if candidate_id:
        subject["metadata"] = {"candidateIdentifierExt": candidate_id}
    body = {
        "identifications": [subject],
        "showTakeScreenshot": False,
        "userInfo": operator_user_info(),
        "allowPartialReports": True,
    }
    data = await _post_json("/api/v1/vetting/request", body, client=client)
    rows = data.get("data") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise VerificanteError("Verificante no devolvió el resultado de la solicitud.")
    return rows[0] if isinstance(rows[0], dict) else {}


async def _fetch_request(
    verification_id: str, *, client: httpx.AsyncClient | None
) -> dict[str, Any]:
    data = await _post_json(
        "/api/v1/vetting/requests/status",
        {"ids": verification_id},
        client=client,
    )
    rows = data.get("data") if isinstance(data, dict) else None
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    raise VerificanteError("Verificante no devolvió el estado de la verificación.")


async def _post_json(
    path: str, body: dict[str, Any], *, client: httpx.AsyncClient | None
) -> dict[str, Any]:
    url = f"{api_base()}{path}"
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=20.0)
    try:
        resp = await http.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("Verificante network error %s %s", path, type(exc).__name__)
        raise VerificanteError("No pudimos contactar Verificante.") from exc
    finally:
        if owns_client:
            await http.aclose()

    if resp.status_code in (401, 403):
        raise VerificanteError(
            "Las credenciales de Verificante no son válidas o no tienen permiso."
        )
    if resp.status_code == 429:
        raise VerificanteError("Verificante está saturado (límite de solicitudes).")
    if resp.status_code >= 400:
        logger.warning(
            "Verificante %s → %s %s", path, resp.status_code, resp.text[:400]
        )
        raise VerificanteError(
            _friendly_error(resp.text) or "Verificante rechazó la solicitud."
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise VerificanteError("Verificante devolvió una respuesta inválida.") from exc
    return payload if isinstance(payload, dict) else {}


def _friendly_error(body: str) -> str:
    text = (body or "").strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except ValueError:
        return text[:240]
    if isinstance(parsed, dict):
        msg = parsed.get("message") or parsed.get("detail")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()[:240]
    return text[:240]
