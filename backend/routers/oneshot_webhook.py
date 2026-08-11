"""OneShot webhook — mark organizer contract as signed when notified."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from orm_models import Organizer
from services.oneshot import verify_webhook_signature

logger = logging.getLogger("tys.oneshot.webhook")

router = APIRouter(prefix="/api/oneshot", tags=["oneshot"])


@router.post("/webhook")
async def oneshot_webhook(request: Request, session: AsyncSession = Depends(get_db)):
    body = await request.body()
    signature = request.headers.get("X-OneShot-Signature") or request.headers.get(
        "X-Signature"
    )
    if not verify_webhook_signature(body, signature):
        raise HTTPException(401, "Invalid OneShot webhook signature")

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Invalid JSON")

    event_type = (
        payload.get("event") or payload.get("type") or payload.get("event_type") or ""
    ).lower()
    data = payload.get("data") or payload
    external_id = str(
        data.get("id")
        or data.get("contract_id")
        or data.get("external_id")
        or payload.get("contract_id")
        or ""
    )
    organizer_id = (
        (data.get("metadata") or {}).get("organizer_id")
        or data.get("organizer_id")
        or payload.get("organizer_id")
    )

    if "sign" not in event_type and event_type not in (
        "contract.signed",
        "signed",
        "completed",
    ):
        logger.info("OneShot webhook ignored event=%s", event_type)
        return {"ok": True, "ignored": True}

    row = None
    if organizer_id:
        row = await session.get(Organizer, organizer_id)
    if not row and external_id:
        result = await session.execute(
            select(Organizer).where(Organizer.contract_external_id == external_id)
        )
        row = result.scalar_one_or_none()
    if not row:
        logger.warning(
            "OneShot signed webhook: organizer not found id=%s ext=%s",
            organizer_id,
            external_id,
        )
        raise HTTPException(404, "Organizer not found for contract")

    row.contract_status = "signed"
    row.contract_signed_at = datetime.now(timezone.utc)
    if external_id:
        row.contract_external_id = external_id
    await session.flush()
    logger.info("Contract signed for organizer %s via OneShot", row.id)
    return {"ok": True, "organizer_id": row.id, "contract_status": "signed"}
