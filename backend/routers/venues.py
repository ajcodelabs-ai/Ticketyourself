"""
Phase 6a — Venue editor routes.

Scope (intentionally limited to 6a):
  - Element kinds: `stage`, `unnumbered_zone`, `seat_row_straight`.
  - Lock-on-sales logic: prevents structural edits once an event with sales
    is using this venue.
  - One locality CRUD per venue (embedded array).
  - Public read-only preview when venue is published.

Phase 6b will add: curved rows, tables, individual seats, advanced multi-select.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from db_helpers import get_organizer_by_id, get_organizer_by_slug, row_to_dict
from orm_models import Event, Organizer, SubscriptionPlan, Venue
from security import get_current_user
from services.plan_features import get_plan_features
from slugs import normalize_slug

logger = logging.getLogger("tys.venues")
router = APIRouter(prefix="/api/venues/me", tags=["venues"])
public_router = APIRouter(prefix="/api/public/venues", tags=["venues-public"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _require_active_organizer(user) -> Dict[str, Any]:
    """Panel-level access. Allows `pending` (so the org can build drafts while
    awaiting admin approval). Rejects `rejected` / `suspended` / unknown."""
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    org = await get_organizer_by_id(user["organizer_id"])
    if not org:
        raise HTTPException(status_code=403, detail="Organizer profile missing")
    if org.get("status") not in {"pending", "approved"}:
        raise HTTPException(status_code=403, detail="Tu cuenta no tiene acceso al panel de venues.")
    return org


async def _require_approved_organizer(user) -> Dict[str, Any]:
    """Strict gate used by publish endpoints — only approved orgs can publish."""
    org = await _require_active_organizer(user)
    if org.get("status") != "approved":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "organizer_pending_review",
                "message": (
                    "Tu cuenta está en revisión. Una vez aprobada vas a poder "
                    "publicar este venue. Podés seguir editándolo libremente "
                    "mientras tanto."
                ),
            },
        )
    return org


async def require_organizer(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Panel-level dependency used by CRUD endpoints (pending allowed)."""
    return await _require_active_organizer(user)


async def require_organizer_can_publish(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Strict dependency: only approved orgs can hit publish endpoints."""
    return await _require_approved_organizer(user)


# ───────────────────────── Models ──────────────────────────────────────────
VENUE_TYPES = {"theater", "auditorium", "stadium", "fair", "classroom", "mixed", "other"}
ELEMENT_KINDS = {
    "stage", "unnumbered_zone", "seat_row_straight",
    "seat_row_curved", "seat_individual", "table_round", "table_rect",
}


class Locality(BaseModel):
    id: str
    name: str
    color: str = "#6366F1"
    description: Optional[str] = None
    default_price_cents: Optional[int] = None


class CanvasCfg(BaseModel):
    width: int = 1200
    height: int = 800
    background_color: str = "#FAFAFA"
    grid_size: int = 20


class VenueElement(BaseModel):
    id: str
    kind: Literal[
        "stage", "unnumbered_zone", "seat_row_straight",
        "seat_row_curved", "seat_individual", "table_round", "table_rect",
    ]
    x: float
    y: float
    rotation: float = 0.0
    label: str = ""
    locality_id: Optional[str] = None
    z_index: int = 0
    # Stage / zone / table_rect shared
    width: Optional[float] = None
    height: Optional[float] = None
    color: Optional[str] = None
    # Zone-specific
    capacity: Optional[int] = None
    # Seat row (straight + curved share most)
    seats_count: Optional[int] = None
    seat_spacing: Optional[int] = 24
    seat_radius: Optional[int] = 10
    row_label: Optional[str] = None
    numbering_start: Optional[int] = 1
    numbering_direction: Optional[Literal["ltr", "rtl"]] = "ltr"
    numbering_style: Optional[Literal["numeric", "alpha"]] = "numeric"
    # Curved row only
    curve_radius: Optional[int] = None
    curve_arc_degrees: Optional[int] = None
    # Table round
    table_radius: Optional[int] = None
    chairs_count: Optional[int] = None
    chair_radius: Optional[int] = 10
    chair_distance: Optional[int] = 20
    # Table rect — chairs_per_side keyed by top/right/bottom/left
    chairs_per_side: Optional[Dict[str, int]] = None


class VenueIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    type: Literal["theater", "auditorium", "stadium", "fair", "classroom", "mixed", "other"] = "other"
    description: Optional[str] = None
    canvas: Optional[CanvasCfg] = None


class VenuePut(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    type: Literal["theater", "auditorium", "stadium", "fair", "classroom", "mixed", "other"] = "other"
    description: Optional[str] = None
    canvas: CanvasCfg
    elements: List[VenueElement] = []
    localities: List[Locality] = []


class LocalityIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = "#6366F1"
    description: Optional[str] = None
    default_price_cents: Optional[int] = None


# ───────────────────────── Helpers ─────────────────────────────────────────
def _compute_capacity(elements: List[Dict[str, Any]]) -> int:
    """Sum of seat counts across all element kinds that contribute."""
    total = 0
    for e in elements:
        k = e.get("kind")
        if k == "unnumbered_zone":
            total += int(e.get("capacity") or 0)
        elif k in ("seat_row_straight", "seat_row_curved"):
            total += int(e.get("seats_count") or 0)
        elif k == "seat_individual":
            total += 1
        elif k == "table_round":
            total += int(e.get("chairs_count") or 0)
        elif k == "table_rect":
            cps = e.get("chairs_per_side") or {}
            total += sum(int(cps.get(s) or 0) for s in ("top", "right", "bottom", "left"))
    return total


def _clamp_elements(elements: List[Dict[str, Any]], canvas: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Force x, y inside canvas bounds (top-left). No bounds for w/h — UI handles."""
    w = canvas.get("width", 1200)
    h = canvas.get("height", 800)
    for e in elements:
        e["x"] = max(0, min(float(e.get("x", 0)), float(w)))
        e["y"] = max(0, min(float(e.get("y", 0)), float(h)))
    return elements


def _validate_elements(elements: List[VenueElement]) -> None:
    for el in elements:
        if el.kind == "unnumbered_zone":
            if not el.capacity or el.capacity <= 0:
                raise HTTPException(422, f"Zone '{el.label or el.id}' must have capacity > 0")
        if el.kind in ("seat_row_straight", "seat_row_curved"):
            n = el.seats_count or 0
            if not (1 <= n <= 200):
                raise HTTPException(
                    422, f"Row '{el.row_label or el.id}' seats_count must be 1..200 (got {n})"
                )
        if el.kind == "seat_row_curved":
            arc = el.curve_arc_degrees or 0
            if not (10 <= arc <= 180):
                raise HTTPException(
                    422, f"Row '{el.row_label or el.id}' curve_arc_degrees must be 10..180 (got {arc})"
                )
        if el.kind == "table_round":
            n = el.chairs_count or 0
            if not (2 <= n <= 12):
                raise HTTPException(
                    422, f"Table '{el.label or el.id}' chairs_count must be 2..12 (got {n})"
                )
        if el.kind == "table_rect":
            cps = el.chairs_per_side or {}
            total = sum(int(cps.get(s) or 0) for s in ("top", "right", "bottom", "left"))
            if total < 1:
                raise HTTPException(
                    422, f"Table '{el.label or el.id}' must have at least 1 chair"
                )


async def _get_active_events_using(venue_id: str) -> List[Dict[str, Any]]:
    """Events that bind to venue and have tickets_sold > 0 and not ended."""
    from database import AsyncSessionLocal
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as pg:
        result = await pg.execute(
            select(Event.id, Event.title, Event.starts_at, Event.tickets_sold)
            .where(
                Event.venue_id == venue_id,
                Event.tickets_sold > 0,
                or_(Event.ends_at.is_(None), Event.ends_at >= now),
            )
        )
        return [
            {"id": r.id, "title": r.title, "starts_at": r.starts_at, "tickets_sold": r.tickets_sold}
            for r in result.all()
        ]


async def _ensure_organizer_owns(organizer_id: str, venue_id: str, session: AsyncSession) -> dict:
    result = await session.execute(select(Venue).where(Venue.id == venue_id))
    row = result.scalar_one_or_none()
    if not row or row.organizer_id != organizer_id or row.is_template:
        raise HTTPException(404, "Venue not found")
    return row_to_dict(row)


async def _ensure_organizer_owns_row(organizer_id: str, venue_id: str, session: AsyncSession) -> Venue:
    result = await session.execute(select(Venue).where(Venue.id == venue_id))
    row = result.scalar_one_or_none()
    if not row or row.organizer_id != organizer_id or row.is_template:
        raise HTTPException(404, "Venue not found")
    return row


async def _unique_slug(
    organizer_id: str,
    base: str,
    session: AsyncSession,
    *,
    ignore_id: Optional[str] = None,
) -> str:
    candidate = base
    i = 2
    while True:
        stmt = select(Venue.id).where(
            Venue.organizer_id == organizer_id,
            Venue.slug == candidate,
        )
        if ignore_id:
            stmt = stmt.where(Venue.id != ignore_id)
        existing = await session.scalar(stmt)
        if not existing:
            return candidate
        candidate = f"{base}-{i}"
        i += 1


async def _venue_count(organizer_id: str, session: AsyncSession) -> int:
    return await session.scalar(
        select(func.count(Venue.id)).where(
            Venue.organizer_id == organizer_id,
            Venue.status != "archived",
            Venue.is_template.is_(False),
        )
    ) or 0


def _clone_venue_elements(original: Venue) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Regenerate locality + element ids for a copy."""
    loc_map: Dict[str, str] = {}
    new_locs: List[Dict[str, Any]] = []
    for loc in (original.localities or []):
        new_id = str(uuid.uuid4())
        loc_map[loc["id"]] = new_id
        new_locs.append({**loc, "id": new_id})
    new_elements: List[Dict[str, Any]] = []
    for el in (original.elements or []):
        ne = {**el, "id": str(uuid.uuid4())}
        if ne.get("locality_id"):
            ne["locality_id"] = loc_map.get(ne["locality_id"])
        new_elements.append(ne)
    return new_elements, new_locs


def _is_locked(active_events: List[Dict[str, Any]]) -> bool:
    return len(active_events) > 0


# ───────────────────────── Public preview ──────────────────────────────────
@public_router.get("/{tenant_slug}/{venue_slug}")
async def public_venue(
    tenant_slug: str,
    venue_slug: str,
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    org = await get_organizer_by_slug(tenant_slug)
    if not org or org.get("status") != "approved":
        raise HTTPException(404, "Venue not found")
    result = await session.execute(
        select(Venue).where(
            Venue.organizer_id == org["id"],
            Venue.slug == venue_slug,
            Venue.status == "published",
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Venue not found")
    v = row_to_dict(row)
    v["organizer"] = {"slug": org["slug"], "company_name": org["company_name"]}
    return v


# ───────────────────────── Organizer venues CRUD ───────────────────────────
@router.get("")
async def list_venues(
    org: Dict[str, Any] = Depends(require_organizer),
    status_f: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    stmt = select(Venue).where(
        Venue.organizer_id == org["id"],
        Venue.is_template.is_(False),
    )
    if status_f:
        stmt = stmt.where(Venue.status == status_f)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Venue.name.ilike(like), Venue.slug.ilike(like)))
    stmt = stmt.order_by(Venue.created_at.desc())
    result = await session.execute(stmt)
    items = [row_to_dict(r) for r in result.scalars().all()]

    # Enrich: # of events using each venue (PG)
    venue_ids = [v["id"] for v in items]
    counts: Dict[str, int] = {}
    if venue_ids:
        evt_result = await session.execute(
            select(Event.venue_id, func.count(Event.id).label("n"))
            .where(Event.venue_id.in_(venue_ids))
            .group_by(Event.venue_id)
        )
        counts = {r.venue_id: r.n for r in evt_result.all()}
    for v in items:
        v["events_count"] = counts.get(v["id"], 0)

    features = get_plan_features(org.get("plan_code"))
    return {
        "items": items,
        "total": len(items),
        "max_venues": features.get("max_venues", 1),
        "active_count": sum(1 for v in items if v.get("status") != "archived"),
    }


@router.post("", status_code=201)
async def create_venue(
    body: VenueIn,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    features = get_plan_features(org.get("plan_code"))
    max_v = features.get("max_venues", 1)
    if max_v != -1:
        active = await _venue_count(org["id"], session)
        if active >= max_v:
            raise HTTPException(
                403,
                f"Tu plan permite hasta {max_v} venue(s) activos. Archivá uno para crear otro.",
            )
    base = normalize_slug(body.name)
    venue_slug = await _unique_slug(org["id"], base, session)
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
        is_template=False,
        created_at=now,
        updated_at=now,
        published_at=None,
    )
    session.add(row)
    await session.flush()
    return row_to_dict(row)


@router.get("/templates")
async def list_platform_templates(
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    _ = org
    result = await session.execute(
        select(Venue).where(Venue.is_template.is_(True)).order_by(Venue.name.asc())
    )
    items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": len(items)}


@router.post("/from-template/{template_id}", status_code=201)
async def create_from_template(
    template_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    features = get_plan_features(org.get("plan_code"))
    max_v = features.get("max_venues", 1)
    if max_v != -1:
        active = await _venue_count(org["id"], session)
        if active >= max_v:
            raise HTTPException(
                403,
                f"Tu plan permite hasta {max_v} venue(s). Archivá uno para usar una plantilla.",
            )
    result = await session.execute(
        select(Venue).where(Venue.id == template_id, Venue.is_template.is_(True))
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(404, "Plantilla no encontrada")

    name = original.name
    new_slug = await _unique_slug(org["id"], normalize_slug(name), session)
    now = _now()
    new_elements, new_locs = _clone_venue_elements(original)

    row = Venue(
        id=str(uuid.uuid4()),
        organizer_id=org["id"],
        tenant_slug=org["slug"],
        name=name,
        slug=new_slug,
        description=original.description,
        type=original.type,
        canvas=dict(original.canvas or {}),
        elements=new_elements,
        localities=new_locs,
        capacity_calculated=original.capacity_calculated,
        status="draft",
        is_template=False,
        created_at=now,
        updated_at=now,
        published_at=None,
    )
    session.add(row)
    await session.flush()
    return row_to_dict(row)


@router.get("/{venue_id}")
async def get_venue(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    v = await _ensure_organizer_owns(org["id"], venue_id, session)
    active = await _get_active_events_using(venue_id)
    v["lock_status"] = {
        "locked": _is_locked(active),
        "active_events": active,
    }
    return v


@router.get("/{venue_id}/lock-status")
async def lock_status(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    await _ensure_organizer_owns(org["id"], venue_id, session)
    active = await _get_active_events_using(venue_id)
    locked = _is_locked(active)
    return {
        "locked": locked,
        "locked_fields": ["elements", "localities"] if locked else [],
        "unlocked_fields": ["name", "description", "canvas.background_color"],
        "active_events": active,
    }


@router.put("/{venue_id}")
async def update_venue(
    venue_id: str,
    body: VenuePut,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    active = await _get_active_events_using(venue_id)
    locked = _is_locked(active)

    _validate_elements(body.elements)

    elements = [e.model_dump() for e in body.elements]
    elements = _clamp_elements(elements, body.canvas.model_dump())
    localities = [loc.model_dump() for loc in body.localities]

    # Locality references must exist
    loc_ids = {loc["id"] for loc in localities}
    for el in elements:
        if el.get("locality_id") and el["locality_id"] not in loc_ids:
            raise HTTPException(
                422,
                f"Locality {el['locality_id']} referenced by an element no longer exists.",
            )

    if locked:
        old_elements = row.elements or []
        old_locs = row.localities or []
        if _structural_diff(old_elements, elements) or _locality_structural_diff(old_locs, localities):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "error": "venue_locked",
                    "message": "El venue está bloqueado por eventos con ventas activas.",
                    "active_events": active,
                },
            )

    new_slug = row.slug
    if row.name != body.name:
        new_slug = await _unique_slug(org["id"], normalize_slug(body.name), session, ignore_id=venue_id)

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
    v["lock_status"] = {"locked": locked, "active_events": active}
    return v


def _structural_diff(old: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> bool:
    """Differ that ignores label/color-only edits but flags any add/delete/move/resize."""
    if len(old) != len(new):
        return True
    by_id_old = {e["id"]: e for e in old}
    by_id_new = {e["id"]: e for e in new}
    if set(by_id_old) != set(by_id_new):
        return True
    keys_structural = ("x", "y", "width", "height", "rotation", "kind",
                       "seats_count", "capacity", "locality_id")
    for k, a in by_id_old.items():
        b = by_id_new[k]
        for kk in keys_structural:
            if a.get(kk) != b.get(kk):
                return True
    return False


def _locality_structural_diff(old: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> bool:
    if len(old) != len(new):
        return True
    by_id_old = {it["id"]: it for it in old}
    by_id_new = {it["id"]: it for it in new}
    if set(by_id_old) != set(by_id_new):
        return True
    for k, a in by_id_old.items():
        b = by_id_new[k]
        if a.get("color") != b.get("color"):
            return True
        if a.get("default_price_cents") != b.get("default_price_cents"):
            return True
    return False


@router.delete("/{venue_id}", status_code=204)
async def delete_venue(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    bound = await session.scalar(
        select(func.count(Event.id)).where(Event.venue_id == venue_id)
    ) or 0
    if bound > 0:
        raise HTTPException(409, f"No se puede eliminar: {bound} evento(s) lo usan.")
    await session.delete(row)
    return None


@router.post("/{venue_id}/duplicate", status_code=201)
async def duplicate_venue(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    features = get_plan_features(org.get("plan_code"))
    max_v = features.get("max_venues", 1)
    if max_v != -1:
        active = await _venue_count(org["id"], session)
        if active >= max_v:
            raise HTTPException(403, f"Tu plan permite hasta {max_v} venue(s).")
    original = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    name = f"{original.name} (copia)"
    new_slug = await _unique_slug(org["id"], normalize_slug(name), session)
    now = _now()

    new_elements, new_locs = _clone_venue_elements(original)

    row = Venue(
        id=str(uuid.uuid4()),
        organizer_id=org["id"],
        tenant_slug=org["slug"],
        name=name,
        slug=new_slug,
        description=original.description,
        type=original.type,
        canvas=dict(original.canvas or {}),
        elements=new_elements,
        localities=new_locs,
        capacity_calculated=original.capacity_calculated,
        status="draft",
        is_template=False,
        created_at=now,
        updated_at=now,
        published_at=None,
    )
    session.add(row)
    await session.flush()
    return row_to_dict(row)


@router.post("/{venue_id}/publish")
async def publish_venue(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer_can_publish),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    if not row.elements:
        raise HTTPException(422, "Agregá al menos un elemento antes de publicar el venue.")
    row.status = "published"
    row.published_at = _now()
    row.updated_at = _now()
    await session.flush()
    return {"id": venue_id, "status": "published"}


@router.post("/{venue_id}/archive")
async def archive_venue(
    venue_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    row.status = "archived"
    row.updated_at = _now()
    await session.flush()
    return {"id": venue_id, "status": "archived"}


# ───────────────────────── Locality sub-CRUD ───────────────────────────────
@router.post("/{venue_id}/localities", status_code=201)
async def add_locality(
    venue_id: str,
    body: LocalityIn,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    loc = Locality(
        id=str(uuid.uuid4()),
        name=body.name,
        color=body.color,
        description=body.description,
        default_price_cents=body.default_price_cents,
    ).model_dump()
    row.localities = [*(row.localities or []), loc]
    row.updated_at = _now()
    flag_modified(row, "localities")
    await session.flush()
    return loc


@router.put("/{venue_id}/localities/{loc_id}")
async def update_locality(
    venue_id: str,
    loc_id: str,
    body: LocalityIn,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    locs = list(row.localities or [])
    found = False
    for i, loc in enumerate(locs):
        if loc["id"] == loc_id:
            locs[i] = {
                **loc,
                "name": body.name,
                "color": body.color,
                "description": body.description,
                "default_price_cents": body.default_price_cents,
            }
            found = True
            break
    if not found:
        raise HTTPException(404, "Locality not found")
    row.localities = locs
    row.updated_at = _now()
    flag_modified(row, "localities")
    await session.flush()
    return {"id": loc_id, "updated": True}


@router.delete("/{venue_id}/localities/{loc_id}", status_code=204)
async def delete_locality(
    venue_id: str,
    loc_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
    session: AsyncSession = Depends(get_db),
):
    row = await _ensure_organizer_owns_row(org["id"], venue_id, session)
    elements = row.elements or []
    in_use = sum(1 for e in elements if e.get("locality_id") == loc_id)
    if in_use > 0:
        raise HTTPException(
            409,
            f"Hay {in_use} elemento(s) asignados a esta localidad. Reasignalos antes de borrarla.",
        )
    row.localities = [loc for loc in (row.localities or []) if loc["id"] != loc_id]
    row.updated_at = _now()
    flag_modified(row, "localities")
    await session.flush()
    return None
