"""Guest lists (lista verificada) & access codes — Fase 9.

Routes
------
# Guest list (organizer)
POST   /api/events/me/{event_id}/guest-list
GET    /api/events/me/{event_id}/guest-list
POST   /api/events/me/{event_id}/guest-list/import
DELETE /api/events/me/{event_id}/guest-list/{entry_id}

# Access codes (organizer)
POST   /api/events/me/{event_id}/access-codes
GET    /api/events/me/{event_id}/access-codes
PUT    /api/events/me/{event_id}/access-codes/{code_id}
DELETE /api/events/me/{event_id}/access-codes/{code_id}

# Public
POST   /api/public/events/{tenant_slug}/{event_slug}/check-access
"""
import csv
import io
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from orm_models import Event, EventAccessCode, EventGuestListEntry, Organizer, Tenant
from security import require_role
from services.plan_features import assert_feature

router = APIRouter(tags=["access-control"])
public_router = APIRouter(tags=["access-control-public"])

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I — easier to read aloud


def _gen_code(length: int = 8) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


# ── Shared helpers ────────────────────────────────────────────────────────────
async def _get_org(user: dict, session: AsyncSession) -> Organizer:
    result = await session.execute(select(Organizer).where(Organizer.user_id == user["id"]))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return org


async def _get_event_for_org(event_id: str, org_id: str, session: AsyncSession) -> Event:
    result = await session.execute(
        select(Event).where(Event.id == event_id, Event.organizer_id == org_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


# ═══════════════════════════════════════════════════════════════════════════════
# GUEST LIST (lista verificada)
# ═══════════════════════════════════════════════════════════════════════════════

class GuestListEntryCreate(BaseModel):
    email: Optional[str] = Field(default=None, max_length=254)
    cedula: Optional[str] = Field(default=None, max_length=40)
    name: Optional[str] = Field(default=None, max_length=140)
    notes: Optional[str] = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _require_one(self):
        if not (self.email or "").strip() and not (self.cedula or "").strip():
            raise ValueError("Debes indicar email o cédula")
        return self


@router.post("/api/events/me/{event_id}/guest-list", status_code=201)
async def add_guest_list_entry(
    event_id: str,
    body: GuestListEntryCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    assert_feature(org.plan_code, "verified_lists")

    entry = EventGuestListEntry(
        id=str(uuid.uuid4()),
        event_id=event_id,
        organizer_id=org.id,
        email=(body.email or "").strip().lower() or None,
        cedula=(body.cedula or "").strip() or None,
        name=(body.name or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return row_to_dict(entry)


@router.get("/api/events/me/{event_id}/guest-list")
async def list_guest_list_entries(
    event_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventGuestListEntry)
        .where(EventGuestListEntry.event_id == event_id)
        .order_by(EventGuestListEntry.created_at.desc())
    )
    return [row_to_dict(r) for r in result.scalars().all()]


@router.post("/api/events/me/{event_id}/guest-list/import")
async def import_guest_list(
    event_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    assert_feature(org.plan_code, "verified_lists")

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "El archivo debe estar codificado en UTF-8")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(422, "El CSV está vacío")
    headers = {h.strip().lower(): h for h in reader.fieldnames}
    email_col = headers.get("email")
    cedula_col = headers.get("cedula")
    name_col = headers.get("name") or headers.get("nombre")
    if not email_col and not cedula_col:
        raise HTTPException(422, "El CSV debe tener una columna 'email' o 'cedula'")

    existing = await session.execute(
        select(EventGuestListEntry.email, EventGuestListEntry.cedula).where(
            EventGuestListEntry.event_id == event_id,
        )
    )
    seen_emails = {e.lower() for e, _c in existing if e}
    seen_cedulas = {c for _e, c in existing if c}

    inserted = 0
    skipped = 0
    for row in reader:
        email = (row.get(email_col, "") or "").strip().lower() if email_col else ""
        cedula = (row.get(cedula_col, "") or "").strip() if cedula_col else ""
        name = (row.get(name_col, "") or "").strip() if name_col else ""
        email = email or None
        cedula = cedula or None
        if not email and not cedula:
            skipped += 1
            continue
        if (email and email in seen_emails) or (cedula and cedula in seen_cedulas):
            skipped += 1
            continue
        session.add(EventGuestListEntry(
            id=str(uuid.uuid4()),
            event_id=event_id,
            organizer_id=org.id,
            email=email,
            cedula=cedula,
            name=name or None,
        ))
        if email:
            seen_emails.add(email)
        if cedula:
            seen_cedulas.add(cedula)
        inserted += 1

    await session.commit()
    return {"inserted": inserted, "skipped": skipped}


@router.delete("/api/events/me/{event_id}/guest-list/{entry_id}", status_code=204)
async def delete_guest_list_entry(
    event_id: str,
    entry_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventGuestListEntry).where(
            EventGuestListEntry.id == entry_id, EventGuestListEntry.event_id == event_id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    await session.delete(entry)
    await session.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# ACCESS CODES (código de acceso)
# ═══════════════════════════════════════════════════════════════════════════════

class AccessCodeCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=40)
    max_uses: Optional[int] = Field(default=1, ge=1)
    active: bool = True


class AccessCodeUpdate(BaseModel):
    max_uses: Optional[int] = Field(default=None, ge=1)
    active: Optional[bool] = None


@router.post("/api/events/me/{event_id}/access-codes", status_code=201)
async def create_access_code(
    event_id: str,
    body: AccessCodeCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    assert_feature(org.plan_code, "access_codes")

    code = (body.code or "").strip().upper() or _gen_code()
    existing = await session.execute(
        select(EventAccessCode).where(
            EventAccessCode.event_id == event_id, EventAccessCode.code == code,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Ya existe un código igual para este evento")

    row = EventAccessCode(
        id=str(uuid.uuid4()),
        event_id=event_id,
        organizer_id=org.id,
        code=code,
        max_uses=body.max_uses,
        active=body.active,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row_to_dict(row)


@router.get("/api/events/me/{event_id}/access-codes")
async def list_access_codes(
    event_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventAccessCode)
        .where(EventAccessCode.event_id == event_id)
        .order_by(EventAccessCode.created_at.desc())
    )
    return [row_to_dict(r) for r in result.scalars().all()]


@router.put("/api/events/me/{event_id}/access-codes/{code_id}")
async def update_access_code(
    event_id: str,
    code_id: str,
    body: AccessCodeUpdate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventAccessCode).where(
            EventAccessCode.id == code_id, EventAccessCode.event_id == event_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Access code not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(row, field, val)
    row.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(row)
    return row_to_dict(row)


@router.delete("/api/events/me/{event_id}/access-codes/{code_id}", status_code=204)
async def delete_access_code(
    event_id: str,
    code_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventAccessCode).where(
            EventAccessCode.id == code_id, EventAccessCode.event_id == event_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Access code not found")
    await session.delete(row)
    await session.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC — check access before showing the purchase form
# ═══════════════════════════════════════════════════════════════════════════════

class CheckAccessBody(BaseModel):
    email: Optional[str] = Field(default=None, max_length=254)
    cedula: Optional[str] = Field(default=None, max_length=40)
    access_code: Optional[str] = Field(default=None, max_length=40)


@public_router.post("/api/public/events/{tenant_slug}/{event_slug}/check-access")
async def public_check_access(
    tenant_slug: str,
    event_slug: str,
    body: CheckAccessBody,
    session: AsyncSession = Depends(get_db),
):
    org_row = await session.scalar(select(Organizer).where(Organizer.slug == tenant_slug))
    if not org_row:
        raise HTTPException(404, "Organizador no encontrado")
    tenant_row = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
    if not tenant_row or tenant_row.status != "active":
        raise HTTPException(404, "No disponible")
    event_row = await session.scalar(
        select(Event).where(Event.organizer_id == org_row.id, Event.slug == event_slug)
    )
    if not event_row:
        raise HTTPException(404, "Evento no encontrado")

    from services.access_control import check_purchase_access

    try:
        await check_purchase_access(
            event=row_to_dict(event_row),
            session=session,
            buyer_email=body.email,
            buyer_document_id=body.cedula,
            access_code=body.access_code,
        )
    except ValueError as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True}
