"""Event functions & ticket types — Phase 8.

Multi-función: each event can have N functions (dates/shows), each with its own
venue, schedule, and optional price/capacity overrides per ticket type.

Ticket types: multiple ticket categories per event (VIP, General, Early Bird…).

Routes
------
# Ticket types (organizer)
POST   /api/events/me/{event_id}/ticket-types
GET    /api/events/me/{event_id}/ticket-types
PUT    /api/events/me/{event_id}/ticket-types/{type_id}
DELETE /api/events/me/{event_id}/ticket-types/{type_id}

# Ticket types (public)
GET    /api/public/events/{event_id}/ticket-types

# Event functions (organizer)
POST   /api/events/me/{event_id}/functions
GET    /api/events/me/{event_id}/functions
PUT    /api/events/me/{event_id}/functions/{function_id}
DELETE /api/events/me/{event_id}/functions/{function_id}

# Event functions (public)
GET    /api/public/events/{event_id}/functions
GET    /api/public/events/{event_id}/functions/{function_id}
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from orm_models import (
    Event,
    EventFunction,
    FunctionTicketType,
    Organizer,
    TicketType,
)
from security import get_current_user, require_role

router = APIRouter(tags=["functions"])
public_router = APIRouter(tags=["functions-public"])


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _get_org(user: dict, session: AsyncSession) -> Organizer:
    result = await session.execute(
        select(Organizer).where(Organizer.user_id == user["id"])
    )
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


def _type_out(row: TicketType) -> dict:
    return row_to_dict(row)


def _func_out(row: EventFunction, overrides: list = None) -> dict:
    d = row_to_dict(row)
    if overrides is not None:
        d["ticket_type_overrides"] = [row_to_dict(o) for o in overrides]
    return d


# ═══════════════════════════════════════════════════════════════════════════════
# TICKET TYPES
# ═══════════════════════════════════════════════════════════════════════════════

class TicketTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price_cents: int = 0
    currency: str = "usd"
    capacity: Optional[int] = None
    venue_locality_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: int = 0
    # Sale window
    sale_start: Optional[datetime] = None
    sale_end: Optional[datetime] = None
    # Buyer limit
    max_per_buyer: Optional[int] = None
    # Early bird
    is_early_bird: bool = False
    early_bird_closes_at: Optional[datetime] = None
    # §4.2.6 — purchase-quantity limits (mutually exclusive)
    min_quantity: Optional[int] = Field(default=None, ge=2)
    exact_quantity: Optional[int] = Field(default=None, ge=2)

    @field_validator("price_cents")
    @classmethod
    def non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("price_cents must be >= 0")
        return v

    @model_validator(mode="after")
    def _check_quantity_limits(self):
        if self.min_quantity and self.exact_quantity:
            raise ValueError("Elegí mínimo de compra O cantidad exacta, no ambos.")
        return self


class TicketTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = None
    capacity: Optional[int] = None
    venue_locality_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    active: Optional[bool] = None
    sale_start: Optional[datetime] = None
    sale_end: Optional[datetime] = None
    max_per_buyer: Optional[int] = None
    is_early_bird: Optional[bool] = None
    early_bird_closes_at: Optional[datetime] = None
    min_quantity: Optional[int] = Field(default=None, ge=2)
    exact_quantity: Optional[int] = Field(default=None, ge=2)

    @model_validator(mode="after")
    def _check_quantity_limits(self):
        if self.min_quantity and self.exact_quantity:
            raise ValueError("Elegí mínimo de compra O cantidad exacta, no ambos.")
        return self


@router.post("/api/events/me/{event_id}/ticket-types", status_code=201)
async def create_ticket_type(
    event_id: str,
    body: TicketTypeCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)

    tt = TicketType(
        id=str(uuid.uuid4()),
        event_id=event_id,
        organizer_id=org.id,
        **body.model_dump(),
    )
    session.add(tt)
    await session.commit()
    await session.refresh(tt)
    return _type_out(tt)


@router.get("/api/events/me/{event_id}/ticket-types")
async def list_ticket_types(
    event_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(TicketType)
        .where(TicketType.event_id == event_id)
        .order_by(TicketType.sort_order, TicketType.created_at)
    )
    return [_type_out(r) for r in result.scalars().all()]


@router.put("/api/events/me/{event_id}/ticket-types/{type_id}")
async def update_ticket_type(
    event_id: str,
    type_id: str,
    body: TicketTypeUpdate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(TicketType).where(TicketType.id == type_id, TicketType.event_id == event_id)
    )
    tt = result.scalar_one_or_none()
    if not tt:
        raise HTTPException(status_code=404, detail="Ticket type not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(tt, field, val)

    await session.commit()
    await session.refresh(tt)
    return _type_out(tt)


@router.delete("/api/events/me/{event_id}/ticket-types/{type_id}", status_code=204)
async def delete_ticket_type(
    event_id: str,
    type_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(TicketType).where(TicketType.id == type_id, TicketType.event_id == event_id)
    )
    tt = result.scalar_one_or_none()
    if not tt:
        raise HTTPException(status_code=404, detail="Ticket type not found")
    if tt.tickets_sold > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a ticket type that already has sales. Deactivate it instead.",
        )
    await session.delete(tt)
    await session.commit()


@public_router.get("/api/public/events/{event_id}/ticket-types")
async def public_list_ticket_types(
    event_id: str,
    function_id: Optional[str] = None,
    session: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(TicketType)
        .where(
            TicketType.event_id == event_id,
            TicketType.active == True,  # noqa: E712
        )
        .order_by(TicketType.sort_order, TicketType.created_at)
    )
    types = result.scalars().all()

    # Per-función overrides — price/capacity/availability for this ticket
    # type may differ when the buyer is purchasing for a specific función.
    overrides_by_type: Dict[str, FunctionTicketType] = {}
    if function_id:
        ov_result = await session.execute(
            select(FunctionTicketType).where(FunctionTicketType.function_id == function_id)
        )
        overrides_by_type = {o.ticket_type_id: o for o in ov_result.scalars().all()}

    out = []
    for tt in types:
        override = overrides_by_type.get(tt.id)
        if override and not override.active:
            continue  # not offered for this función
        d = _type_out(tt)
        effective_price = (
            override.price_cents_override
            if override and override.price_cents_override is not None
            else tt.price_cents
        )
        effective_capacity = (
            override.capacity_override
            if override and override.capacity_override is not None
            else tt.capacity
        )
        effective_sold = override.tickets_sold if override else tt.tickets_sold
        d["price_cents"] = effective_price
        d["capacity"] = effective_capacity
        # Compute availability flags
        d["is_on_sale"] = True
        if tt.sale_start and now < tt.sale_start:
            d["is_on_sale"] = False
        if tt.sale_end and now > tt.sale_end:
            d["is_on_sale"] = False
        # Early bird: closes at date OR when capacity exhausted (checked client-side via sold_out)
        if tt.is_early_bird and tt.early_bird_closes_at and now > tt.early_bird_closes_at:
            d["is_on_sale"] = False
        d["is_sold_out"] = effective_capacity is not None and effective_sold >= effective_capacity
        out.append(d)
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# EVENT FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

class FunctionTicketTypeOverride(BaseModel):
    ticket_type_id: str
    price_cents_override: Optional[int] = None
    capacity_override: Optional[int] = None
    active: bool = True


class EventFunctionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    timezone: Optional[str] = None
    venue_id: Optional[str] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    venue_city: Optional[str] = None
    venue_country: Optional[str] = None
    locality_pricing: List[Dict[str, Any]] = []
    capacity: Optional[int] = None
    sort_order: int = 0
    kind: Literal["function", "subevent"] = "function"
    ticket_type_overrides: List[FunctionTicketTypeOverride] = []


class EventFunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    timezone: Optional[str] = None
    venue_id: Optional[str] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    venue_city: Optional[str] = None
    venue_country: Optional[str] = None
    locality_pricing: Optional[List[Dict[str, Any]]] = None
    capacity: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None
    kind: Optional[Literal["function", "subevent"]] = None
    ticket_type_overrides: Optional[List[FunctionTicketTypeOverride]] = None


# Franjas horarias — a función without an explicit end is assumed to run ~1h
# for the purpose of detecting schedule overlaps against sibling funciones.
_DEFAULT_FUNCTION_DURATION = timedelta(hours=1)


def _same_venue(a: Optional[str], b: Optional[str]) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


async def _check_schedule_conflict(
    event_id: str,
    starts_at: Optional[datetime],
    ends_at: Optional[datetime],
    venue_name: Optional[str],
    exclude_function_id: Optional[str],
    session: AsyncSession,
    kind: str = "function",
) -> None:
    """Raise 409 if [starts_at, ends_at) overlaps a sibling, non-cancelled
    función that shares the same venue (same venue_name, including both
    blank = the event's main venue).

    Subeventos (kind="subevent") are independent add-ons under the umbrella
    event — sala VIP, cena, meet & greet — and are explicitly allowed to run
    concurrently with the main event or other subevents, so they're exempt
    from this check in both directions (a subevent never conflicts, and
    nothing conflicts with a subevent)."""
    if not starts_at or kind == "subevent":
        return
    candidate_end = ends_at or (starts_at + _DEFAULT_FUNCTION_DURATION)
    result = await session.execute(
        select(EventFunction).where(
            EventFunction.event_id == event_id,
            EventFunction.status != "cancelled",
            EventFunction.kind != "subevent",
        )
    )
    for other in result.scalars().all():
        if exclude_function_id and other.id == exclude_function_id:
            continue
        if not other.starts_at or not _same_venue(venue_name, other.venue_name):
            continue
        other_end = other.ends_at or (other.starts_at + _DEFAULT_FUNCTION_DURATION)
        if starts_at < other_end and other.starts_at < candidate_end:
            raise HTTPException(
                409,
                f"El horario se superpone con la función '{other.name}' en el mismo lugar.",
            )


async def _upsert_overrides(
    function_id: str,
    overrides: List[FunctionTicketTypeOverride],
    session: AsyncSession,
) -> None:
    await session.execute(
        FunctionTicketType.__table__.delete().where(
            FunctionTicketType.function_id == function_id
        )
    )
    for o in overrides:
        session.add(FunctionTicketType(
            id=str(uuid.uuid4()),
            function_id=function_id,
            ticket_type_id=o.ticket_type_id,
            price_cents_override=o.price_cents_override,
            capacity_override=o.capacity_override,
            active=o.active,
        ))


@router.post("/api/events/me/{event_id}/functions", status_code=201)
async def create_function(
    event_id: str,
    body: EventFunctionCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    event = await _get_event_for_org(event_id, org.id, session)
    await _check_schedule_conflict(
        event_id, body.starts_at, body.ends_at, body.venue_name, None, session,
        kind=body.kind,
    )

    func = EventFunction(
        id=str(uuid.uuid4()),
        event_id=event_id,
        organizer_id=org.id,
        name=body.name,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        timezone=body.timezone,
        venue_id=body.venue_id,
        venue_name=body.venue_name,
        venue_address=body.venue_address,
        venue_city=body.venue_city,
        venue_country=body.venue_country,
        locality_pricing=body.locality_pricing,
        capacity=body.capacity,
        sort_order=body.sort_order,
        kind=body.kind,
    )
    session.add(func)
    await session.flush()

    if body.ticket_type_overrides:
        await _upsert_overrides(func.id, body.ticket_type_overrides, session)

    # Mark event as multi-function
    if not event.is_multi_function:
        event.is_multi_function = True

    await session.commit()
    await session.refresh(func)

    overrides = await session.execute(
        select(FunctionTicketType).where(FunctionTicketType.function_id == func.id)
    )
    return _func_out(func, overrides.scalars().all())


@router.get("/api/events/me/{event_id}/functions")
async def list_functions(
    event_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(EventFunction)
        .where(EventFunction.event_id == event_id)
        .order_by(EventFunction.sort_order, EventFunction.starts_at)
    )
    funcs = result.scalars().all()

    overrides_result = await session.execute(
        select(FunctionTicketType).where(
            FunctionTicketType.function_id.in_([f.id for f in funcs])
        )
    )
    overrides_by_func: dict = {}
    for o in overrides_result.scalars().all():
        overrides_by_func.setdefault(o.function_id, []).append(o)

    return [_func_out(f, overrides_by_func.get(f.id, [])) for f in funcs]


@router.put("/api/events/me/{event_id}/functions/{function_id}")
async def update_function(
    event_id: str,
    function_id: str,
    body: EventFunctionUpdate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)

    result = await session.execute(
        select(EventFunction).where(
            EventFunction.id == function_id,
            EventFunction.event_id == event_id,
        )
    )
    func = result.scalar_one_or_none()
    if not func:
        raise HTTPException(status_code=404, detail="Function not found")

    effective_starts = body.starts_at if body.starts_at is not None else func.starts_at
    effective_ends = body.ends_at if body.ends_at is not None else func.ends_at
    effective_venue = body.venue_name if body.venue_name is not None else func.venue_name
    effective_kind = body.kind if body.kind is not None else func.kind
    await _check_schedule_conflict(
        event_id, effective_starts, effective_ends, effective_venue, function_id, session,
        kind=effective_kind,
    )

    overrides = body.ticket_type_overrides
    update_data = body.model_dump(exclude_none=True, exclude={"ticket_type_overrides"})
    for field, val in update_data.items():
        setattr(func, field, val)
    func.updated_at = datetime.now(timezone.utc)

    if overrides is not None:
        await _upsert_overrides(function_id, overrides, session)

    await session.commit()
    await session.refresh(func)

    result_ov = await session.execute(
        select(FunctionTicketType).where(FunctionTicketType.function_id == function_id)
    )
    return _func_out(func, result_ov.scalars().all())


@router.delete("/api/events/me/{event_id}/functions/{function_id}", status_code=204)
async def delete_function(
    event_id: str,
    function_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)

    result = await session.execute(
        select(EventFunction).where(
            EventFunction.id == function_id,
            EventFunction.event_id == event_id,
        )
    )
    func = result.scalar_one_or_none()
    if not func:
        raise HTTPException(status_code=404, detail="Function not found")
    if func.tickets_sold > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a function that already has ticket sales.",
        )
    await session.delete(func)
    await session.commit()


# ── Public function endpoints ─────────────────────────────────────────────────

@public_router.get("/api/public/events/{event_id}/functions")
async def public_list_functions(
    event_id: str,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(EventFunction)
        .where(
            EventFunction.event_id == event_id,
            EventFunction.status == "active",
        )
        .order_by(EventFunction.sort_order, EventFunction.starts_at)
    )
    funcs = result.scalars().all()

    overrides_result = await session.execute(
        select(FunctionTicketType).where(
            FunctionTicketType.function_id.in_([f.id for f in funcs]),
            FunctionTicketType.active == True,  # noqa: E712
        )
    )
    overrides_by_func: dict = {}
    for o in overrides_result.scalars().all():
        overrides_by_func.setdefault(o.function_id, []).append(o)

    return [_func_out(f, overrides_by_func.get(f.id, [])) for f in funcs]


@public_router.get("/api/public/events/{event_id}/functions/{function_id}")
async def public_get_function(
    event_id: str,
    function_id: str,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(EventFunction).where(
            EventFunction.id == function_id,
            EventFunction.event_id == event_id,
            EventFunction.status == "active",
        )
    )
    func = result.scalar_one_or_none()
    if not func:
        raise HTTPException(status_code=404, detail="Function not found")

    overrides = await session.execute(
        select(FunctionTicketType).where(
            FunctionTicketType.function_id == function_id,
            FunctionTicketType.active == True,  # noqa: E712
        )
    )
    return _func_out(func, overrides.scalars().all())
