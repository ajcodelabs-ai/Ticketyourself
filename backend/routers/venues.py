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
from pydantic import BaseModel, Field, field_validator

from db import db
from security import get_current_user
from services.plan_features import get_plan_features
from slugs import normalize_slug

logger = logging.getLogger("tys.venues")
router = APIRouter(prefix="/api/venues/me", tags=["venues"])
public_router = APIRouter(prefix="/api/public/venues", tags=["venues-public"])


async def _require_approved_organizer(user) -> Dict[str, Any]:
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    org = await db.organizers.find_one({"id": user["organizer_id"]}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=403, detail="Organizer profile missing")
    if org.get("status") != "approved":
        raise HTTPException(status_code=403, detail="Organizer not approved")
    # Resolve plan_code (organizers store plan_id, plans have code).
    if org.get("plan_id"):
        plan = await db.subscription_plans.find_one(
            {"id": org["plan_id"]}, {"_id": 0, "code": 1}
        )
        org["plan_code"] = plan.get("code") if plan else None
    else:
        org["plan_code"] = None
    return org


async def require_organizer(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Dependency: returns the approved organizer dict for the calling user."""
    return await _require_approved_organizer(user)


# ───────────────────────── Models ──────────────────────────────────────────
VENUE_TYPES = {"theater", "auditorium", "stadium", "fair", "classroom", "mixed", "other"}
ELEMENT_KINDS = {"stage", "unnumbered_zone", "seat_row_straight"}


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
    kind: Literal["stage", "unnumbered_zone", "seat_row_straight"]
    x: float
    y: float
    rotation: float = 0.0
    label: str = ""
    locality_id: Optional[str] = None
    z_index: int = 0
    # Stage / zone shared
    width: Optional[float] = None
    height: Optional[float] = None
    color: Optional[str] = None
    # Zone-specific
    capacity: Optional[int] = None
    # Seat row
    seats_count: Optional[int] = None
    seat_spacing: Optional[int] = 24
    seat_radius: Optional[int] = 10
    row_label: Optional[str] = None
    numbering_start: Optional[int] = 1
    numbering_direction: Optional[Literal["ltr", "rtl"]] = "ltr"
    numbering_style: Optional[Literal["numeric", "alpha"]] = "numeric"


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
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_capacity(elements: List[Dict[str, Any]]) -> int:
    """Sum of unnumbered_zone capacities + seat row seats_count."""
    total = 0
    for e in elements:
        if e.get("kind") == "unnumbered_zone":
            total += int(e.get("capacity") or 0)
        elif e.get("kind") == "seat_row_straight":
            total += int(e.get("seats_count") or 0)
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
        if el.kind == "seat_row_straight":
            n = el.seats_count or 0
            if not (1 <= n <= 200):
                raise HTTPException(
                    422, f"Row '{el.row_label or el.id}' seats_count must be 1..200 (got {n})"
                )


async def _get_active_events_using(venue_id: str) -> List[Dict[str, Any]]:
    """Events that bind to venue and have tickets_sold > 0 and not ended."""
    now_iso = _now_iso()
    cur = db.events.find(
        {
            "venue_id": venue_id,
            "tickets_sold": {"$gt": 0},
            "$or": [{"ends_at": None}, {"ends_at": {"$gte": now_iso}}],
        },
        {"_id": 0, "id": 1, "title": 1, "starts_at": 1, "tickets_sold": 1},
    )
    return [d async for d in cur]


async def _ensure_organizer_owns(organizer_id: str, venue_id: str) -> Dict[str, Any]:
    v = await db.venues.find_one({"id": venue_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Venue not found")
    if v.get("organizer_id") != organizer_id:
        raise HTTPException(404, "Venue not found")
    return v


def _new_slug(name: str) -> str:
    return normalize_slug(name)


async def _unique_slug(organizer_id: str, base: str, ignore_id: Optional[str] = None) -> str:
    candidate = base
    i = 2
    while True:
        q = {"organizer_id": organizer_id, "slug": candidate}
        if ignore_id:
            q["id"] = {"$ne": ignore_id}
        existing = await db.venues.find_one(q, {"_id": 0, "id": 1})
        if not existing:
            return candidate
        candidate = f"{base}-{i}"
        i += 1


async def _venue_count(organizer_id: str) -> int:
    return await db.venues.count_documents(
        {"organizer_id": organizer_id, "status": {"$ne": "archived"}}
    )


def _is_locked(active_events: List[Dict[str, Any]]) -> bool:
    return len(active_events) > 0


# ───────────────────────── Public preview ──────────────────────────────────
@public_router.get("/{tenant_slug}/{venue_slug}")
async def public_venue(tenant_slug: str, venue_slug: str) -> Dict[str, Any]:
    org = await db.organizers.find_one({"slug": tenant_slug}, {"_id": 0, "id": 1, "status": 1, "company_name": 1, "slug": 1})
    if not org or org.get("status") != "approved":
        raise HTTPException(404, "Venue not found")
    v = await db.venues.find_one(
        {"organizer_id": org["id"], "slug": venue_slug, "status": "published"},
        {"_id": 0},
    )
    if not v:
        raise HTTPException(404, "Venue not found")
    v["organizer"] = {"slug": org["slug"], "company_name": org["company_name"]}
    return v


# ───────────────────────── Organizer venues CRUD ───────────────────────────
@router.get("")
async def list_venues(
    org: Dict[str, Any] = Depends(require_organizer),
    status_f: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    q: dict = {"organizer_id": org["id"]}
    if status_f:
        q["status"] = status_f
    if search:
        q["$or"] = [
            {"name": {"$regex": search.strip(), "$options": "i"}},
            {"slug": {"$regex": search.strip(), "$options": "i"}},
        ]
    cur = db.venues.find(q, {"_id": 0}).sort("created_at", -1)
    items = [v async for v in cur]
    # Enrich: # of events using each venue
    venue_ids = [v["id"] for v in items]
    counts: Dict[str, int] = {}
    if venue_ids:
        pipe = [
            {"$match": {"venue_id": {"$in": venue_ids}}},
            {"$group": {"_id": "$venue_id", "n": {"$sum": 1}}},
        ]
        async for r in db.events.aggregate(pipe):
            counts[r["_id"]] = r["n"]
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
) -> Dict[str, Any]:
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    features = get_plan_features(org.get("plan_code"))
    max_v = features.get("max_venues", 1)
    if max_v != -1:
        active = await _venue_count(org["id"])
        if active >= max_v:
            raise HTTPException(
                403,
                f"Tu plan permite hasta {max_v} venue(s) activos. Archivá uno para crear otro.",
            )
    base = _new_slug(body.name)
    venue_slug = await _unique_slug(org["id"], base)
    now = _now_iso()
    canvas = (body.canvas or CanvasCfg()).model_dump()
    doc = {
        "id": str(uuid.uuid4()),
        "organizer_id": org["id"],
        "tenant_slug": org["slug"],
        "name": body.name,
        "slug": venue_slug,
        "description": body.description,
        "type": body.type,
        "canvas": canvas,
        "elements": [],
        "localities": [],
        "capacity_calculated": 0,
        "status": "draft",
        "is_template": False,
        "created_at": now,
        "updated_at": now,
        "published_at": None,
    }
    await db.venues.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/{venue_id}")
async def get_venue(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    v = await _ensure_organizer_owns(org["id"], venue_id)
    active = await _get_active_events_using(venue_id)
    v["lock_status"] = {
        "locked": _is_locked(active),
        "active_events": active,
    }
    return v


@router.get("/{venue_id}/lock-status")
async def lock_status(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    await _ensure_organizer_owns(org["id"], venue_id)
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
):
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    v = await _ensure_organizer_owns(org["id"], venue_id)
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
        # Block any structural mutation.
        old_elements = v.get("elements", [])
        old_locs = v.get("localities", [])
        if _structural_diff(old_elements, elements) or _locality_structural_diff(old_locs, localities):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "error": "venue_locked",
                    "message": "El venue está bloqueado por eventos con ventas activas.",
                    "active_events": active,
                },
            )

    # Slug stays unless name changed
    new_slug = v["slug"]
    if v["name"] != body.name:
        new_slug = await _unique_slug(org["id"], _new_slug(body.name), ignore_id=venue_id)

    cap = _compute_capacity(elements)
    update_doc = {
        "name": body.name,
        "slug": new_slug,
        "description": body.description,
        "type": body.type,
        "canvas": body.canvas.model_dump(),
        "elements": elements,
        "localities": localities,
        "capacity_calculated": cap,
        "updated_at": _now_iso(),
    }
    await db.venues.update_one({"id": venue_id}, {"$set": update_doc})
    fresh = await db.venues.find_one({"id": venue_id}, {"_id": 0})
    fresh["lock_status"] = {"locked": locked, "active_events": active}
    return fresh


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
    # Color + default_price are structural-ish; allow renames + description.
    for k, a in by_id_old.items():
        b = by_id_new[k]
        if a.get("color") != b.get("color"):
            return True
        if a.get("default_price_cents") != b.get("default_price_cents"):
            return True
    return False


@router.delete("/{venue_id}", status_code=204)
async def delete_venue(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    await _ensure_organizer_owns(org["id"], venue_id)
    bound = await db.events.count_documents({"venue_id": venue_id})
    if bound > 0:
        raise HTTPException(409, f"No se puede eliminar: {bound} evento(s) lo usan.")
    await db.venues.delete_one({"id": venue_id})
    return None


@router.post("/{venue_id}/duplicate", status_code=201)
async def duplicate_venue(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    features = get_plan_features(org.get("plan_code"))
    max_v = features.get("max_venues", 1)
    if max_v != -1:
        active = await _venue_count(org["id"])
        if active >= max_v:
            raise HTTPException(403, f"Tu plan permite hasta {max_v} venue(s).")
    v = await _ensure_organizer_owns(org["id"], venue_id)
    name = f"{v['name']} (copia)"
    new_slug = await _unique_slug(org["id"], _new_slug(name))
    now = _now_iso()
    # Regenerate element + locality ids to avoid cross-venue collision.
    loc_map = {}
    new_locs = []
    for loc in v.get("localities", []):
        new_id = str(uuid.uuid4())
        loc_map[loc["id"]] = new_id
        new_locs.append({**loc, "id": new_id})
    new_elements = []
    for el in v.get("elements", []):
        ne = {**el, "id": str(uuid.uuid4())}
        if ne.get("locality_id"):
            ne["locality_id"] = loc_map.get(ne["locality_id"])
        new_elements.append(ne)
    doc = {
        **v,
        "id": str(uuid.uuid4()),
        "name": name,
        "slug": new_slug,
        "status": "draft",
        "is_template": False,
        "elements": new_elements,
        "localities": new_locs,
        "created_at": now,
        "updated_at": now,
        "published_at": None,
    }
    await db.venues.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/{venue_id}/publish")
async def publish_venue(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    v = await _ensure_organizer_owns(org["id"], venue_id)
    if not v.get("elements"):
        raise HTTPException(422, "Agregá al menos un elemento antes de publicar el venue.")
    await db.venues.update_one(
        {"id": venue_id},
        {"$set": {"status": "published", "published_at": _now_iso(), "updated_at": _now_iso()}},
    )
    return {"id": venue_id, "status": "published"}


@router.post("/{venue_id}/archive")
async def archive_venue(venue_id: str, org: Dict[str, Any] = Depends(require_organizer)):
    await _ensure_organizer_owns(org["id"], venue_id)
    await db.venues.update_one(
        {"id": venue_id},
        {"$set": {"status": "archived", "updated_at": _now_iso()}},
    )
    return {"id": venue_id, "status": "archived"}


# ───────────────────────── Locality sub-CRUD ───────────────────────────────
@router.post("/{venue_id}/localities", status_code=201)
async def add_locality(
    venue_id: str,
    body: LocalityIn,
    org: Dict[str, Any] = Depends(require_organizer),
):
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    await _ensure_organizer_owns(org["id"], venue_id)
    loc = Locality(
        id=str(uuid.uuid4()),
        name=body.name,
        color=body.color,
        description=body.description,
        default_price_cents=body.default_price_cents,
    ).model_dump()
    await db.venues.update_one(
        {"id": venue_id},
        {"$push": {"localities": loc}, "$set": {"updated_at": _now_iso()}},
    )
    return loc


@router.put("/{venue_id}/localities/{loc_id}")
async def update_locality(
    venue_id: str,
    loc_id: str,
    body: LocalityIn,
    org: Dict[str, Any] = Depends(require_organizer),
):
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    await _ensure_organizer_owns(org["id"], venue_id)
    new_doc = {
        "localities.$.name": body.name,
        "localities.$.color": body.color,
        "localities.$.description": body.description,
        "localities.$.default_price_cents": body.default_price_cents,
        "updated_at": _now_iso(),
    }
    res = await db.venues.update_one(
        {"id": venue_id, "localities.id": loc_id},
        {"$set": new_doc},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Locality not found")
    return {"id": loc_id, "updated": True}


@router.delete("/{venue_id}/localities/{loc_id}", status_code=204)
async def delete_locality(
    venue_id: str,
    loc_id: str,
    org: Dict[str, Any] = Depends(require_organizer),
):
    org = org  # noqa: PLW0127  (kept after auth refactor; org comes from dep)
    v = await _ensure_organizer_owns(org["id"], venue_id)
    in_use = sum(1 for e in v.get("elements", []) if e.get("locality_id") == loc_id)
    if in_use > 0:
        raise HTTPException(
            409,
            f"Hay {in_use} elemento(s) asignados a esta localidad. Reasignalos antes de borrarla.",
        )
    await db.venues.update_one(
        {"id": venue_id},
        {"$pull": {"localities": {"id": loc_id}}, "$set": {"updated_at": _now_iso()}},
    )
    return None
