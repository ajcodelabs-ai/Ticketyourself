"""Super-admin CRUD for platform venue templates (is_template=True).

Templates live under the seeded demo-org organizer for FK consistency but are
excluded from the organizer's normal venue list. All organizers can clone them
via POST /api/venues/me/from-template/{id}.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from db_helpers import get_organizer_by_slug, row_to_dict
from orm_models import Venue
from routers.venues import (
    CanvasCfg,
    VenueIn,
    VenuePut,
    _clamp_elements,
    _compute_capacity,
    _unique_slug,
    _validate_elements,
)
from security import require_role
from slugs import normalize_slug

router = APIRouter(
    prefix="/api/admin/venue-templates",
    tags=["admin-venue-templates"],
    dependencies=[Depends(require_role("super_admin"))],
)

PLATFORM_ORG_SLUG = "demo-org"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _platform_org() -> Dict[str, Any]:
    org = await get_organizer_by_slug(PLATFORM_ORG_SLUG)
    if not org:
        raise HTTPException(
            status_code=503,
            detail="Organizador plataforma no encontrado (seed demo-org).",
        )
    return org


async def _get_template_row(venue_id: str, session: AsyncSession) -> Venue:
    org = await _platform_org()
    result = await session.execute(
        select(Venue).where(
            Venue.id == venue_id,
            Venue.organizer_id == org["id"],
            Venue.is_template.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Plantilla no encontrada")
    return row


@router.get("")
async def list_templates(session: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    org = await _platform_org()
    result = await session.execute(
        select(Venue)
        .where(Venue.organizer_id == org["id"], Venue.is_template.is_(True))
        .order_by(Venue.name.asc())
    )
    items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
async def create_template(
    body: VenueIn,
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    org = await _platform_org()
    venue_slug = await _unique_slug(org["id"], normalize_slug(body.name), session)
    now = _now()
    canvas = (body.canvas or CanvasCfg()).model_dump()
    row = Venue(
        id=str(uuid.uuid4()),
        organizer_id=org["id"],
        tenant_slug=org["slug"],
        name=body.name,
        slug=venue_slug,
        description=body.description,
        type=body.type,
        canvas=canvas,
        elements=[],
        localities=[],
        capacity_calculated=0,
        status="draft",
        is_template=True,
        created_at=now,
        updated_at=now,
        published_at=None,
    )
    session.add(row)
    await session.flush()
    return row_to_dict(row)


@router.get("/{venue_id}")
async def get_template(
    venue_id: str,
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    row = await _get_template_row(venue_id, session)
    v = row_to_dict(row)
    v["lock_status"] = {"locked": False, "active_events": []}
    return v


@router.put("/{venue_id}")
async def update_template(
    venue_id: str,
    body: VenuePut,
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    row = await _get_template_row(venue_id, session)
    org = await _platform_org()

    _validate_elements(body.elements)

    elements = [e.model_dump() for e in body.elements]
    elements = _clamp_elements(elements, body.canvas.model_dump())
    localities = [loc.model_dump() for loc in body.localities]

    loc_ids = {loc["id"] for loc in localities}
    for el in elements:
        if el.get("locality_id") and el["locality_id"] not in loc_ids:
            raise HTTPException(
                422,
                f"Locality {el['locality_id']} referenced by an element no longer exists.",
            )

    new_slug = row.slug
    if row.name != body.name:
        new_slug = await _unique_slug(
            org["id"], normalize_slug(body.name), session, ignore_id=venue_id
        )

    row.name = body.name
    row.slug = new_slug
    row.description = body.description
    row.type = body.type
    row.canvas = body.canvas.model_dump()
    row.elements = elements
    row.localities = localities
    row.capacity_calculated = _compute_capacity(elements)
    row.updated_at = _now()
    flag_modified(row, "canvas")
    flag_modified(row, "elements")
    flag_modified(row, "localities")
    await session.flush()

    v = row_to_dict(row)
    v["lock_status"] = {"locked": False, "active_events": []}
    return v


@router.delete("/{venue_id}", status_code=204)
async def delete_template(
    venue_id: str,
    session: AsyncSession = Depends(get_db),
) -> None:
    row = await _get_template_row(venue_id, session)
    await session.delete(row)
