"""
Events Phase 3a — basic events: free / paid / donation, single occurrence,
no numbered seating, no tiered pricing. Phase 3b will add complexity.
"""
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from db import db
from security import get_current_user, require_role
from slugs import normalize_slug

logger = logging.getLogger("tys.events")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "event_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMG_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_IMG_BYTES = 5 * 1024 * 1024

EventCategory = Literal[
    "educational", "entertainment", "corporate", "sports", "fairs", "family"
]
EventStatus = Literal["draft", "published", "sold_out", "ended", "cancelled"]
PricingType = Literal["free", "paid", "donation"]
Visibility = Literal["public", "private"]


router = APIRouter(prefix="/api/events/me", tags=["events"])
public_router = APIRouter(prefix="/api/public/events", tags=["events-public"])
admin_router = APIRouter(prefix="/api/admin/events", tags=["events-admin"])
asset_router = APIRouter(prefix="/api/events/assets", tags=["events-assets"])


# ── Models ───────────────────────────────────────────────────────────────────
class EventBase(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    description: str = Field(default="", max_length=8000)
    short_description: str = Field(default="", max_length=160)
    category: EventCategory = "entertainment"
    venue_name: str = Field(default="", max_length=120)
    venue_address: str = Field(default="", max_length=200)
    venue_city: str = Field(default="", max_length=80)
    venue_country: str = Field(default="Ecuador", max_length=80)
    starts_at: datetime
    ends_at: datetime
    timezone: str = Field(default="America/Guayaquil", max_length=64)
    pricing_type: PricingType = "free"
    base_price_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="USD", max_length=3)
    capacity: Optional[int] = Field(default=None, ge=0)
    visibility: Visibility = "public"

    @field_validator("ends_at")
    @classmethod
    def _ends_after_start(cls, v: datetime, info):
        starts = info.data.get("starts_at")
        if starts and v <= starts:
            raise ValueError("ends_at must be after starts_at")
        return v


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=140)
    description: Optional[str] = None
    short_description: Optional[str] = None
    category: Optional[EventCategory] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    venue_city: Optional[str] = None
    venue_country: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    timezone: Optional[str] = None
    pricing_type: Optional[PricingType] = None
    base_price_cents: Optional[int] = None
    currency: Optional[str] = None
    capacity: Optional[int] = None
    visibility: Optional[Visibility] = None


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _require_approved_organizer(user) -> dict:
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    org = await db.organizers.find_one({"id": user["organizer_id"]}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Organizer not found")
    if org["status"] != "approved":
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta debe estar aprobada para gestionar eventos",
        )
    return org


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _next_event_slug(organizer_id: str, base: str) -> str:
    """Find a unique event slug for the organizer."""
    candidate = base or "evento"
    suffix = 1
    while True:
        c = candidate if suffix == 1 else f"{candidate}-{suffix}"
        existing = await db.events.find_one(
            {"organizer_id": organizer_id, "slug": c}, {"_id": 0, "id": 1}
        )
        if not existing:
            return c
        suffix += 1


def _project(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    doc.pop("_id", None)
    return doc


def _to_iso(dt) -> str:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _publish_validation(doc: dict) -> None:
    """Required fields to allow publishing."""
    missing = []
    if not doc.get("title"):
        missing.append("título")
    if not doc.get("starts_at") or not doc.get("ends_at"):
        missing.append("fechas")
    if not doc.get("venue_name"):
        missing.append("nombre del venue")
    if not doc.get("poster_url"):
        missing.append("poster")
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Faltan campos para publicar: {', '.join(missing)}",
        )


# ── Organizer endpoints ─────────────────────────────────────────────────────
@router.get("")
async def list_my_events(
    user=Depends(get_current_user),
    status: Optional[EventStatus] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    org = await _require_approved_organizer(user)
    query: dict = {"organizer_id": org["id"]}
    if status:
        query["status"] = status
    if search:
        query["title"] = {"$regex": re.escape(search), "$options": "i"}
    total = await db.events.count_documents(query)
    cursor = (
        db.events.find(query, {"_id": 0})
        .sort("starts_at", 1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [d async for d in cursor]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/{event_id}")
async def get_my_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    return doc


@router.post("", status_code=201)
async def create_my_event(payload: EventCreate, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    slug = await _next_event_slug(org["id"], normalize_slug(payload.title))

    # Same (starts_at, venue_name) in same organizer is rejected.
    duplicate = await db.events.find_one(
        {
            "organizer_id": org["id"],
            "starts_at": payload.starts_at.isoformat(),
            "venue_name": payload.venue_name,
            "venue_name_set": {"$ne": ""},
        },
        {"_id": 0, "id": 1},
    )
    # Note: simple check — avoid duplicates only when venue_name is non-empty.
    if duplicate and payload.venue_name:
        raise HTTPException(
            status_code=409,
            detail="Ya tenés un evento en ese venue y fecha",
        )

    now = _now_iso()
    record = {
        "id": str(uuid.uuid4()),
        "organizer_id": org["id"],
        "tenant_slug": org["slug"],
        "slug": slug,
        **payload.model_dump(),
        "starts_at": payload.starts_at.isoformat(),
        "ends_at": payload.ends_at.isoformat(),
        "poster_url": None,
        "banner_url": None,
        "status": "draft",
        "tickets_sold": 0,
        "created_at": now,
        "updated_at": now,
        "published_at": None,
    }
    await db.events.insert_one({**record})
    return record


@router.put("/{event_id}")
async def update_my_event(
    event_id: str, payload: EventUpdate, user=Depends(get_current_user)
):
    org = await _require_approved_organizer(user)
    current = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0}
    )
    if not current:
        raise HTTPException(status_code=404, detail="Event not found")

    diff = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}

    # Lock critical fields once tickets are sold.
    if (current.get("tickets_sold") or 0) > 0:
        for locked in ("base_price_cents", "pricing_type", "currency"):
            if locked in diff:
                raise HTTPException(
                    status_code=422,
                    detail=f"No se puede modificar `{locked}` con ventas registradas",
                )
        if "capacity" in diff and diff["capacity"] is not None:
            if diff["capacity"] < (current.get("tickets_sold") or 0):
                raise HTTPException(
                    status_code=422,
                    detail="La capacidad no puede ser menor a tickets ya vendidos",
                )

    if "starts_at" in diff:
        diff["starts_at"] = _to_iso(diff["starts_at"])
    if "ends_at" in diff:
        diff["ends_at"] = _to_iso(diff["ends_at"])

    # Ends must remain after starts.
    new_starts = diff.get("starts_at", current.get("starts_at"))
    new_ends = diff.get("ends_at", current.get("ends_at"))
    if new_starts and new_ends and new_ends <= new_starts:
        raise HTTPException(status_code=422, detail="ends_at must be after starts_at")

    diff["updated_at"] = _now_iso()
    await db.events.update_one({"id": event_id}, {"$set": diff})
    refreshed = await db.events.find_one({"id": event_id}, {"_id": 0})
    return refreshed


@router.post("/{event_id}/publish")
async def publish_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    _publish_validation(doc)
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"status": "published", "published_at": _now_iso(), "updated_at": _now_iso()}},
    )
    return {"ok": True, "status": "published"}


@router.post("/{event_id}/unpublish")
async def unpublish_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    res = await db.events.update_one(
        {"id": event_id, "organizer_id": org["id"]},
        {"$set": {"status": "draft", "updated_at": _now_iso()}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"ok": True, "status": "draft"}


@router.post("/{event_id}/cancel")
async def cancel_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    res = await db.events.update_one(
        {"id": event_id, "organizer_id": org["id"]},
        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"ok": True, "status": "cancelled"}


@router.delete("/{event_id}", status_code=204)
async def delete_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0, "status": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    if doc["status"] != "draft":
        raise HTTPException(
            status_code=422, detail="Sólo eventos en borrador pueden eliminarse"
        )
    await db.events.delete_one({"id": event_id})
    return None


async def _store_event_image(
    event_id: str, organizer_id: str, file: UploadFile, kind: str
) -> str:
    """Persist file → return /api/events/assets/{id} URL."""
    if file.content_type not in ALLOWED_IMG_MIME:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Tipo de archivo no permitido: {file.content_type or 'desconocido'}. "
                "Aceptados: JPEG, PNG, WEBP, HEIC."
            ),
        )
    content = await file.read()
    if len(content) > MAX_IMG_BYTES:
        raise HTTPException(status_code=413, detail="Archivo supera los 5MB")

    asset_id = str(uuid.uuid4())
    ext = mimetypes.guess_extension(file.content_type) or ".bin"
    rel_path = f"{organizer_id}/{event_id}/{kind}_{asset_id}{ext}"
    abs_path = ASSETS_DIR / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)

    await db.event_assets.insert_one(
        {
            "id": asset_id,
            "event_id": event_id,
            "organizer_id": organizer_id,
            "kind": kind,
            "file_path": rel_path,
            "mime_type": file.content_type,
            "size_bytes": len(content),
            "uploaded_at": _now_iso(),
        }
    )
    return f"/api/events/assets/{asset_id}"


@router.post("/{event_id}/poster")
async def upload_poster(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0, "id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    url = await _store_event_image(event_id, org["id"], file, "poster")
    await db.events.update_one(
        {"id": event_id}, {"$set": {"poster_url": url, "updated_at": _now_iso()}}
    )
    return {"poster_url": url}


@router.post("/{event_id}/banner")
async def upload_banner(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]}, {"_id": 0, "id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    url = await _store_event_image(event_id, org["id"], file, "banner")
    await db.events.update_one(
        {"id": event_id}, {"$set": {"banner_url": url, "updated_at": _now_iso()}}
    )
    return {"banner_url": url}


# ── Asset serving ───────────────────────────────────────────────────────────
@asset_router.get("/{asset_id}")
async def serve_event_asset(asset_id: str):
    asset = await db.event_assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = ASSETS_DIR / asset["file_path"]
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        abs_path,
        media_type=asset.get("mime_type", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Public endpoints ────────────────────────────────────────────────────────
@public_router.get("")
async def list_public_events(
    tenant_slug: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    organizer = await db.organizers.find_one({"slug": tenant_slug}, {"_id": 0, "id": 1})
    if not organizer:
        return {"items": [], "total": 0}
    tenant = await db.tenants.find_one({"slug": tenant_slug}, {"_id": 0, "status": 1})
    if not tenant or tenant.get("status") != "active":
        return {"items": [], "total": 0}
    query = {
        "organizer_id": organizer["id"],
        "status": "published",
        "visibility": "public",
    }
    total = await db.events.count_documents(query)
    cursor = (
        db.events.find(query, {"_id": 0})
        .sort("starts_at", 1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [d async for d in cursor]
    return {"items": items, "total": total}


@public_router.get("/{tenant_slug}/{event_slug}")
async def get_public_event(tenant_slug: str, event_slug: str):
    organizer = await db.organizers.find_one({"slug": tenant_slug}, {"_id": 0})
    if not organizer:
        raise HTTPException(status_code=404, detail="Not found")
    tenant = await db.tenants.find_one({"slug": tenant_slug}, {"_id": 0, "status": 1})
    if not tenant or tenant.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not available")
    event = await db.events.find_one(
        {
            "organizer_id": organizer["id"],
            "slug": event_slug,
            "status": "published",
        },
        {"_id": 0},
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Trim org info to public-safe fields.
    event["organizer"] = {
        "slug": organizer["slug"],
        "company_name": organizer.get("company_name"),
    }
    return event


# ── Admin endpoints ─────────────────────────────────────────────────────────
@admin_router.get("")
async def admin_list_events(
    _admin=Depends(require_role("super_admin")),
    status: Optional[EventStatus] = None,
    organizer: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    query: dict = {}
    if status:
        query["status"] = status
    if organizer:
        query["organizer_id"] = organizer
    total = await db.events.count_documents(query)
    cursor = (
        db.events.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [d async for d in cursor]
    return {"items": items, "total": total}


class ForceCancelBody(BaseModel):
    comment: str = Field(default="", max_length=400)


@admin_router.post("/{event_id}/force-cancel")
async def admin_force_cancel(
    event_id: str,
    payload: ForceCancelBody,
    admin=Depends(require_role("super_admin")),
):
    res = await db.events.update_one(
        {"id": event_id},
        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.audit_logs.insert_one(
        {
            "id": str(uuid.uuid4()),
            "actor_id": admin["id"],
            "action": "event.force_cancelled",
            "subject_type": "event",
            "subject_id": event_id,
            "metadata": {"comment": payload.comment},
            "created_at": _now_iso(),
        }
    )
    return {"ok": True, "status": "cancelled"}
