"""Guest-list and access-code gating for event purchases — Fase 9.

`access_params.access_type` on the Event drives this:
  - "open" / "link_only": no gate, handled elsewhere (visibility/listing only).
  - "verified_list": buyer's email or cédula must exist in
    `event_guest_list_entries` for the event.
  - "access_code": buyer must supply an active, not-yet-exhausted code from
    `event_access_codes`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import EventAccessCode, EventGuestListEntry


async def check_purchase_access(
    *,
    event: dict,
    session: AsyncSession,
    buyer_email: Optional[str],
    buyer_document_id: Optional[str],
    access_code: Optional[str],
) -> Optional[str]:
    """Raises ValueError(message) when access is denied.

    Returns the matched `EventAccessCode.id` when `access_type == "access_code"`
    so the caller can persist it on the order and consume it once payment is
    confirmed — `None` otherwise.
    """
    access_type = (event.get("access_params") or {}).get("access_type", "open")

    if access_type == "verified_list":
        email = (buyer_email or "").strip().lower()
        cedula = (buyer_document_id or "").strip()
        if not email and not cedula:
            raise ValueError(
                "Este evento requiere verificar tu correo o cédula contra la lista de invitados."
            )
        conditions = []
        if email:
            conditions.append(func.lower(EventGuestListEntry.email) == email)
        if cedula:
            conditions.append(EventGuestListEntry.cedula == cedula)
        match = await session.scalar(
            select(EventGuestListEntry).where(
                EventGuestListEntry.event_id == event["id"], or_(*conditions),
            )
        )
        if not match:
            raise ValueError(
                "No encontramos tu correo o cédula en la lista de invitados de este evento."
            )
        return None

    if access_type == "access_code":
        code = (access_code or "").strip().upper()
        if not code:
            raise ValueError("Este evento requiere un código de acceso para comprar.")
        match = await session.scalar(
            select(EventAccessCode).where(
                EventAccessCode.event_id == event["id"],
                EventAccessCode.code == code,
                EventAccessCode.active == True,  # noqa: E712
            )
        )
        if not match:
            raise ValueError("Código de acceso inválido.")
        if match.max_uses is not None and match.uses_count >= match.max_uses:
            raise ValueError("Este código de acceso ya alcanzó su límite de usos.")
        return match.id

    return None


async def consume_access_code(access_code_id: str) -> bool:
    """Increment `uses_count` for the access code under a row-level lock.
    Mirrors `discount_service.consume_promo_code`."""
    from database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(EventAccessCode)
            .where(EventAccessCode.id == access_code_id)
            .with_for_update()
        )
        if not row:
            return False
        if row.max_uses is not None and row.uses_count >= row.max_uses:
            return False
        row.uses_count += 1
        await session.commit()
        return True


async def mark_guest_list_used(
    event_id: str, email: Optional[str], cedula: Optional[str]
) -> None:
    """Best-effort: stamp `used_at` on the matching guest-list entry so
    organizers can see who already redeemed their spot."""
    from database import AsyncSessionLocal

    email_n = (email or "").strip().lower()
    cedula_n = (cedula or "").strip()
    if not email_n and not cedula_n:
        return
    conditions = []
    if email_n:
        conditions.append(func.lower(EventGuestListEntry.email) == email_n)
    if cedula_n:
        conditions.append(EventGuestListEntry.cedula == cedula_n)
    async with AsyncSessionLocal() as session:
        match = await session.scalar(
            select(EventGuestListEntry).where(
                EventGuestListEntry.event_id == event_id, or_(*conditions),
            )
        )
        if match and not match.used_at:
            match.used_at = datetime.now(timezone.utc)
            await session.commit()
