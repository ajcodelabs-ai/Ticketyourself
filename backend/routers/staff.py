"""Staff management — Phase 8.

Organizers create staff accounts (scanner | cajero | admin_evento).
Staff log in with their own credentials and see only their assigned events.

Routes
------
POST   /api/auth/staff-login              — staff login (public)
GET    /api/staff/me                      — current staff profile (staff only)
GET    /api/staff/me/events               — events assigned to current staff (staff only)

POST   /api/staff                         — create staff member (organizer)
GET    /api/staff                         — list staff members (organizer)
GET    /api/staff/{id}                    — get single staff (organizer)
PUT    /api/staff/{id}                    — update staff (organizer)
DELETE /api/staff/{id}                    — delete staff (organizer)
PUT    /api/staff/{id}/events             — replace event assignments (organizer)
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from orm_models import Event, Organizer, StaffEventAssignment, StaffMember
from security import (
    create_staff_token,
    get_current_staff,
    get_current_user,
    hash_password,
    require_role,
    verify_password,
)

VALID_ROLES = {"scanner", "cajero", "admin_evento"}

router = APIRouter(prefix="/api/staff", tags=["staff"])
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class StaffLoginRequest(BaseModel):
    email: str
    password: str


class StaffCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    roles: List[str]
    event_ids: List[str] = []

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: list) -> list:
        invalid = set(v) - VALID_ROLES
        if invalid:
            raise ValueError(f"Invalid roles: {invalid}. Valid: {VALID_ROLES}")
        if not v:
            raise ValueError("At least one role required")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class StaffUpdate(BaseModel):
    name: Optional[str] = None
    roles: Optional[List[str]] = None
    active: Optional[bool] = None
    event_ids: Optional[List[str]] = None
    new_password: Optional[str] = None

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v):
        if v is not None:
            invalid = set(v) - VALID_ROLES
            if invalid:
                raise ValueError(f"Invalid roles: {invalid}")
            if not v:
                raise ValueError("At least one role required")
        return v

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        if v is not None and len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class StaffEventAssignRequest(BaseModel):
    event_ids: List[str]


def _staff_out(row: StaffMember, assignments: list = None) -> dict:
    d = row_to_dict(row)
    d.pop("password_hash", None)
    if assignments is not None:
        d["event_ids"] = [a.event_id for a in assignments]
    return d


# ── Staff login (public) ──────────────────────────────────────────────────────

@auth_router.post("/staff-login")
async def staff_login(
    body: StaffLoginRequest,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(StaffMember).where(StaffMember.email == body.email.lower().strip())
    )
    staff = result.scalar_one_or_none()
    if not staff or not verify_password(body.password, staff.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    if not staff.active:
        raise HTTPException(status_code=403, detail="Cuenta desactivada")

    staff.last_login = datetime.now(timezone.utc)
    await session.commit()

    # Fetch assigned events for event selector screen
    result = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff.id)
    )
    assignments = result.scalars().all()
    event_ids = [a.event_id for a in assignments]

    token = create_staff_token(
        staff_id=staff.id,
        email=staff.email,
        organizer_id=staff.organizer_id,
        roles=staff.roles or [],
    )
    return {
        "access_token": token,
        "staff": _staff_out(staff),
        "event_ids": event_ids,
    }


# ── Current staff profile ─────────────────────────────────────────────────────

@router.get("/me")
async def get_my_profile(
    staff: dict = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff["id"])
    )
    assignments = result.scalars().all()
    return {**staff, "event_ids": [a.event_id for a in assignments]}


@router.get("/me/events")
async def get_my_events(
    staff: dict = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff["id"])
    )
    assignments = result.scalars().all()
    event_ids = [a.event_id for a in assignments]
    if not event_ids:
        return []
    result = await session.execute(
        select(Event).where(Event.id.in_(event_ids), Event.status == "published")
    )
    events = result.scalars().all()
    return [row_to_dict(e) for e in events]


# ── Organizer CRUD ────────────────────────────────────────────────────────────

async def _get_organizer(user: dict, session: AsyncSession) -> Organizer:
    result = await session.execute(
        select(Organizer).where(Organizer.user_id == user["id"])
    )
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return org


@router.post("", status_code=201)
async def create_staff(
    body: StaffCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer(user, session)
    email = body.email.lower().strip()

    existing = await session.execute(
        select(StaffMember).where(
            StaffMember.organizer_id == org.id,
            StaffMember.email == email,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Ya existe un staff con ese email")

    staff = StaffMember(
        id=str(uuid.uuid4()),
        organizer_id=org.id,
        name=body.name,
        email=email,
        password_hash=hash_password(body.password),
        roles=body.roles,
        active=True,
    )
    session.add(staff)
    await session.flush()

    for event_id in body.event_ids:
        session.add(StaffEventAssignment(
            id=str(uuid.uuid4()),
            staff_id=staff.id,
            event_id=event_id,
            organizer_id=org.id,
        ))

    await session.commit()
    result = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff.id)
    )
    return _staff_out(staff, result.scalars().all())


@router.get("")
async def list_staff(
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer(user, session)
    result = await session.execute(
        select(StaffMember).where(StaffMember.organizer_id == org.id)
        .order_by(StaffMember.created_at.desc())
    )
    members = result.scalars().all()

    assigns_result = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.organizer_id == org.id)
    )
    assigns = assigns_result.scalars().all()
    by_staff = {}
    for a in assigns:
        by_staff.setdefault(a.staff_id, []).append(a)

    return [_staff_out(m, by_staff.get(m.id, [])) for m in members]


@router.get("/{staff_id}")
async def get_staff(
    staff_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer(user, session)
    result = await session.execute(
        select(StaffMember).where(
            StaffMember.id == staff_id,
            StaffMember.organizer_id == org.id,
        )
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")
    assigns = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff_id)
    )
    return _staff_out(staff, assigns.scalars().all())


@router.put("/{staff_id}")
async def update_staff(
    staff_id: str,
    body: StaffUpdate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer(user, session)
    result = await session.execute(
        select(StaffMember).where(
            StaffMember.id == staff_id,
            StaffMember.organizer_id == org.id,
        )
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")

    if body.name is not None:
        staff.name = body.name
    if body.roles is not None:
        staff.roles = body.roles
    if body.active is not None:
        staff.active = body.active
    if body.new_password is not None:
        staff.password_hash = hash_password(body.new_password)

    if body.event_ids is not None:
        await session.execute(
            StaffEventAssignment.__table__.delete().where(
                StaffEventAssignment.staff_id == staff_id
            )
        )
        for event_id in body.event_ids:
            session.add(StaffEventAssignment(
                id=str(uuid.uuid4()),
                staff_id=staff.id,
                event_id=event_id,
                organizer_id=org.id,
            ))

    await session.commit()
    assigns = await session.execute(
        select(StaffEventAssignment).where(StaffEventAssignment.staff_id == staff_id)
    )
    return _staff_out(staff, assigns.scalars().all())


@router.delete("/{staff_id}", status_code=204)
async def delete_staff(
    staff_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_organizer(user, session)
    result = await session.execute(
        select(StaffMember).where(
            StaffMember.id == staff_id,
            StaffMember.organizer_id == org.id,
        )
    )
    staff = result.scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")
    await session.delete(staff)
    await session.commit()
