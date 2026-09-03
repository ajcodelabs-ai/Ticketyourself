"""Verificante webhook — refresh KYC payload. Never changes organizer.status."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from orm_models import Organizer
from services import verificante_service as verificante

logger = logging.getLogger("tys.verificante.webhook")

router = APIRouter(prefix="/api/verificante", tags=["verificante"])


@router.post("/webhook")
async def verificante_webhook(
    request: Request, session: AsyncSession = Depends(get_db)
):
    raw = await request.body()
    if not verificante.verify_webhook_signature(
        raw,
        timestamp=request.headers.get("X-Webhook-Timestamp"),
        signature=request.headers.get("X-Webhook-Signature"),
    ):
        raise HTTPException(
            status_code=401, detail="Invalid Verificante webhook signature"
        )

    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    event_type = str(payload.get("type") or payload.get("event") or "")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    verification = (
        data.get("verification") if isinstance(data.get("verification"), dict) else {}
    )
    person = (
        verification.get("person")
        if isinstance(verification.get("person"), dict)
        else {}
    )
    metadata = (
        verification.get("metadata")
        if isinstance(verification.get("metadata"), dict)
        else {}
    )
    verification_id = str(
        data.get("verificationId") or verification.get("id") or ""
    ).strip()
    identification = ""
    if person.get("identification"):
        identification = verificante.digits_only(str(person["identification"]))
    candidate_id = str(
        metadata.get("candidateIdentifierExt")
        or data.get("externalId")
        or data.get("candidateId")
        or ""
    ).strip()

    row = await _find_organizer(session, verification_id, identification, candidate_id)
    if not row:
        logger.info(
            "Verificante webhook ignored event=%s id=%s (no organizer)",
            event_type,
            verification_id or "—",
        )
        return {"ok": True, "ignored": True}

    existing = row.verificante or {}
    event_id = payload.get("id")
    if event_id and existing.get("webhook_event_id") == event_id:
        return {"ok": True, "deduped": True, "organizer_id": row.id}

    row.verificante = verificante.apply_webhook_data(existing, payload)
    await session.flush()
    logger.info(
        "Verificante webhook updated organizer %s risk=%s status=%s",
        row.id,
        (row.verificante or {}).get("risk_level"),
        (row.verificante or {}).get("status"),
    )
    return {
        "ok": True,
        "organizer_id": row.id,
        "risk_level": (row.verificante or {}).get("risk_level"),
        "status": (row.verificante or {}).get("status"),
    }


async def _find_organizer(
    session: AsyncSession,
    verification_id: str,
    identification: str,
    candidate_id: str,
) -> Organizer | None:
    if candidate_id:
        row = await session.get(Organizer, candidate_id)
        if row:
            return row
        row = await session.scalar(
            select(Organizer).where(
                Organizer.verificante["candidate_id"].astext == candidate_id
            )
        )
        if row:
            return row
    if verification_id:
        row = await session.scalar(
            select(Organizer).where(
                Organizer.verificante["verification_id"].astext == verification_id
            )
        )
        if row:
            return row
    if identification:
        row = await session.scalar(
            select(Organizer)
            .where(
                Organizer.org_type == "individual",
                Organizer.country_code == "EC",
                or_(
                    Organizer.legal_id == identification,
                    Organizer.verificante["identification"].astext == identification,
                ),
            )
            .order_by(Organizer.created_at.desc())
        )
        if row:
            return row
    return None
