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
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

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
class PaymentMethodConfig(BaseModel):
    """Per-event payment methods. Stripe always present; transfer & cash opt-in."""
    stripe: Dict[str, Any] = Field(default_factory=lambda: {"enabled": True})
    transfer: Dict[str, Any] = Field(
        default_factory=lambda: {
            "enabled": False,
            "bank_name": "",
            "account_number": "",
            "account_holder": "",
            "instructions": "",
        }
    )
    cash: Dict[str, Any] = Field(
        default_factory=lambda: {
            "enabled": False,
            "location": "",
            "schedule": "",
            "contact": "",
        }
    )


class DiscountConditions(BaseModel):
    locality_ids: Optional[List[str]] = None
    max_per_buyer: Optional[int] = Field(default=None, ge=1)
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


class DiscountBenefit(BaseModel):
    type: Literal["percent", "fixed"]
    value: int = Field(gt=0)  # 25 = 25% or 25 USD according to type


class DiscountRule(BaseModel):
    # UUID is generated server-side at model construction time so two rules
    # without explicit IDs never collide. Earlier we accepted `None` here,
    # which broke `evaluate_discounts` stacking (`auto_rule.id != promo_rule.id`
    # was False when both were None — one rule got silently dropped).
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(min_length=2, max_length=80)
    type: Literal["promo_code", "auto", "quantity"]
    enabled: bool = True
    # promo_code-only
    code: Optional[str] = Field(default=None, max_length=40)
    max_uses: Optional[int] = Field(default=None, ge=1)
    uses_count: int = Field(default=0, ge=0)
    # quantity-only
    min_quantity: Optional[int] = Field(default=None, ge=1)
    # common
    conditions: DiscountConditions = Field(default_factory=DiscountConditions)
    discount: DiscountBenefit

    @model_validator(mode="after")
    def _check_shape(self):
        if self.type == "promo_code":
            if not self.code:
                raise ValueError("promo_code rules require a `code`")
            # Canonicalise to uppercase + strip — codes are compared case-insensitive.
            self.code = self.code.strip().upper()
            if not self.code:
                raise ValueError("Code cannot be empty after trimming.")
        if self.type == "quantity" and not self.min_quantity:
            raise ValueError("quantity rules require `min_quantity`")
        if (
            self.conditions.valid_from
            and self.conditions.valid_until
            and self.conditions.valid_until <= self.conditions.valid_from
        ):
            raise ValueError("`valid_until` debe ser posterior a `valid_from`")
        if self.discount.type == "percent" and self.discount.value > 100:
            raise ValueError("Un porcentaje no puede superar 100")
        return self


class EventDiscounts(BaseModel):
    disability_law: Dict[str, Any] = Field(
        default_factory=lambda: {"enabled": False, "percent": 50}
    )
    presale: Dict[str, Any] = Field(
        default_factory=lambda: {"enabled": False, "percent": 0, "ends_at": None}
    )
    rules: List[DiscountRule] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_unique_codes(self):
        codes = [r.code for r in self.rules if r.type == "promo_code" and r.code]
        seen = set()
        for c in codes:
            if c in seen:
                raise ValueError(f"Código promocional duplicado: {c}")
            seen.add(c)
        return self


class EventAccessParams(BaseModel):
    visibility: Literal["public", "private"] = "public"
    access_type: Literal["open", "link_only", "verified_list", "access_code"] = "open"
    max_per_purchase: int = Field(default=10, ge=1, le=100)
    max_per_email: Optional[int] = Field(default=None, ge=1)
    refund_window_hours: int = Field(default=24, ge=0)
    show_buyer_name_on_ticket: bool = True


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
    sales_start: Optional[datetime] = None
    sales_end: Optional[datetime] = None
    # Phase 9.6 — UI presets so the wizard can re-open the form on the same
    # dropdown option the user chose. Values are opaque strings; the canonical
    # truth is still `ends_at` / `sales_start` / `sales_end`.
    duration_preset: Optional[str] = Field(default=None, max_length=40)
    sales_window_preset_start: Optional[str] = Field(default=None, max_length=40)
    sales_window_preset_end: Optional[str] = Field(default=None, max_length=40)
    pricing_type: PricingType = "free"
    base_price_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="USD", max_length=3)
    capacity: Optional[int] = Field(default=None, ge=0)
    visibility: Visibility = "public"
    payment_methods: Optional[PaymentMethodConfig] = None
    discounts: Optional[EventDiscounts] = None
    access_params: Optional[EventAccessParams] = None

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
    sales_start: Optional[datetime] = None
    sales_end: Optional[datetime] = None
    duration_preset: Optional[str] = None
    sales_window_preset_start: Optional[str] = None
    sales_window_preset_end: Optional[str] = None
    pricing_type: Optional[PricingType] = None
    base_price_cents: Optional[int] = None
    currency: Optional[str] = None
    capacity: Optional[int] = None
    visibility: Optional[Visibility] = None
    payment_methods: Optional[PaymentMethodConfig] = None
    discounts: Optional[EventDiscounts] = None
    access_params: Optional[EventAccessParams] = None


# ── Helpers ──────────────────────────────────────────────────────────────────
PANEL_ALLOWED_STATUSES = {"pending", "approved"}
PUBLISH_ALLOWED_STATUSES = {"approved"}


async def _require_active_organizer(user) -> dict:
    """Panel-level access. Allows `pending` (so the org can build drafts while
    awaiting admin approval). Rejects `rejected` / `suspended` / unknown."""
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    org = await db.organizers.find_one({"id": user["organizer_id"]}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Organizer not found")
    if org["status"] not in PANEL_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta no tiene acceso al panel de eventos.",
        )
    return org


async def _require_organizer_can_publish(user) -> dict:
    """Strict gate used by `publish` endpoints only. `pending` orgs cannot
    publish, even if they have an active subscription — they must be approved
    by an admin first."""
    org = await _require_active_organizer(user)
    if org["status"] not in PUBLISH_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "organizer_pending_review",
                "message": (
                    "Tu cuenta está en revisión. Una vez aprobada vas a poder "
                    "publicar este evento. Podés seguir editándolo libremente "
                    "mientras tanto."
                ),
            },
        )
    return org


# Backwards-compatible alias — code below was written before the relax/strict
# split and uses `_require_approved_organizer` for the panel-level dep. We
# keep the name pointing to the relaxed helper so pending orgs gain access
# to CRUD endpoints; the 3 publish endpoints opt into the strict version.
_require_approved_organizer = _require_active_organizer


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
    # Phase 7 — numbered events must have a price per active locality
    if doc.get("venue_id"):
        pricing = doc.get("locality_pricing") or []
        if not pricing:
            missing.append("precios por localidad (evento numerado)")
        else:
            missing_loc = [
                lp for lp in pricing
                if lp.get("price_cents") is None or int(lp.get("price_cents") or 0) < 0
            ]
            if missing_loc:
                missing.append("precio válido en cada localidad")
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Faltan campos para publicar: {', '.join(missing)}",
        )


# ── Phase 7: Venue link ─────────────────────────────────────────────────────
class LocalityPriceIn(BaseModel):
    locality_id: str
    price_cents: int = Field(ge=0)
    max_tickets_per_purchase: Optional[int] = Field(default=None, ge=1, le=20)


class LinkVenueBody(BaseModel):
    venue_id: str
    locality_pricing: List[LocalityPriceIn]
    seat_holds_window_minutes: int = Field(default=10, ge=1, le=60)


@router.put("/{event_id}/venue")
async def link_venue_to_event(
    event_id: str,
    body: LinkVenueBody,
    user=Depends(get_current_user),
):
    from services.seats import active_localities

    org = await _require_approved_organizer(user)
    event = await db.events.find_one({"id": event_id, "organizer_id": org["id"]}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Evento no encontrado")

    venue = await db.venues.find_one(
        {"id": body.venue_id, "organizer_id": org["id"], "status": "published"},
        {"_id": 0},
    )
    if not venue:
        raise HTTPException(404, "Venue no encontrado o no publicado")

    needed_loc_ids = set(active_localities(venue))
    provided_loc_ids = {lp.locality_id for lp in body.locality_pricing}
    if not needed_loc_ids.issubset(provided_loc_ids):
        missing = needed_loc_ids - provided_loc_ids
        raise HTTPException(
            422,
            f"Faltan precios para las localidades: {', '.join(sorted(missing))}",
        )

    # If event already has tickets sold AND venue is changing → reject.
    sold = event.get("tickets_sold") or 0
    if sold > 0 and event.get("venue_id") and event["venue_id"] != body.venue_id:
        raise HTTPException(
            409, f"El evento ya tiene {sold} ticket(s) vendido(s); no se puede cambiar el venue."
        )

    venue_capacity = venue.get("capacity_calculated") or 0
    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "venue_id": body.venue_id,
            "venue_slug": venue["slug"],
            "venue_name": venue.get("name") or event.get("venue_name"),
            "locality_pricing": [lp.model_dump() for lp in body.locality_pricing],
            "seat_holds_window_minutes": body.seat_holds_window_minutes,
            "capacity": venue_capacity,
            "updated_at": _now_iso(),
        }},
    )
    return await db.events.find_one({"id": event_id}, {"_id": 0})


@router.delete("/{event_id}/venue")
async def unlink_venue_from_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    event = await db.events.find_one({"id": event_id, "organizer_id": org["id"]}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    if (event.get("tickets_sold") or 0) > 0:
        raise HTTPException(409, "El evento ya tiene tickets vendidos; no se puede desvincular.")
    await db.events.update_one(
        {"id": event_id},
        {"$unset": {"venue_id": "", "venue_slug": "", "locality_pricing": ""},
         "$set": {"updated_at": _now_iso()}},
    )
    return {"ok": True}


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
    base = payload.model_dump()
    record = {
        "id": str(uuid.uuid4()),
        "organizer_id": org["id"],
        "tenant_slug": org["slug"],
        "slug": slug,
        **base,
        "starts_at": payload.starts_at.isoformat(),
        "ends_at": payload.ends_at.isoformat(),
        "sales_start": payload.sales_start.isoformat() if payload.sales_start else None,
        "sales_end": payload.sales_end.isoformat() if payload.sales_end else None,
        "poster_url": None,
        "banner_url": None,
        "gallery_urls": [],
        "payment_methods": (base.get("payment_methods") or PaymentMethodConfig().model_dump()),
        "discounts": (base.get("discounts") or EventDiscounts().model_dump()),
        "access_params": (base.get("access_params") or EventAccessParams().model_dump()),
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

    # `exclude_unset=True` drops nested fields filled by `default_factory` —
    # which would silently strip generated `DiscountRule.id` UUIDs on every
    # PUT. We re-dump the discounts block in full to preserve them.
    if "discounts" in diff and payload.discounts is not None:
        diff["discounts"] = payload.discounts.model_dump(exclude_none=False)

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
    # Strict: pending orgs can edit drafts but cannot publish.
    org = await _require_organizer_can_publish(user)
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


# ── Gallery (Fase 5) ────────────────────────────────────────────────────────
MAX_GALLERY_IMAGES = 10


@router.post("/{event_id}/gallery")
async def upload_gallery_image(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Append one image to the gallery. Returns the full gallery_urls list."""
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]},
        {"_id": 0, "id": 1, "gallery_urls": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    current = doc.get("gallery_urls") or []
    if len(current) >= MAX_GALLERY_IMAGES:
        raise HTTPException(
            status_code=422,
            detail=f"Máximo {MAX_GALLERY_IMAGES} imágenes en la galería.",
        )
    url = await _store_event_image(event_id, org["id"], file, "gallery")
    new_list = current + [url]
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"gallery_urls": new_list, "updated_at": _now_iso()}},
    )
    return {"gallery_urls": new_list}


@router.delete("/{event_id}/gallery/{index}")
async def delete_gallery_image(
    event_id: str, index: int, user=Depends(get_current_user)
):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]},
        {"_id": 0, "id": 1, "gallery_urls": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    current: List[str] = doc.get("gallery_urls") or []
    if index < 0 or index >= len(current):
        raise HTTPException(status_code=404, detail="Image not found")
    current.pop(index)
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"gallery_urls": current, "updated_at": _now_iso()}},
    )
    return {"gallery_urls": current}


class GalleryReorderBody(BaseModel):
    order: List[int] = Field(min_length=1, max_length=MAX_GALLERY_IMAGES)


@router.patch("/{event_id}/gallery/reorder")
async def reorder_gallery(
    event_id: str,
    payload: GalleryReorderBody,
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    doc = await db.events.find_one(
        {"id": event_id, "organizer_id": org["id"]},
        {"_id": 0, "id": 1, "gallery_urls": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    current: List[str] = doc.get("gallery_urls") or []
    if sorted(payload.order) != list(range(len(current))):
        raise HTTPException(
            status_code=422,
            detail="`order` debe contener exactamente los índices actuales una vez cada uno",
        )
    new_list = [current[i] for i in payload.order]
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"gallery_urls": new_list, "updated_at": _now_iso()}},
    )
    return {"gallery_urls": new_list}


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
    # Phase 7 — if event has a linked venue, attach the venue + live seat status.
    if event.get("venue_id"):
        from services.seats import compute_event_seats_status
        venue = await db.venues.find_one({"id": event["venue_id"]}, {"_id": 0})
        if venue:
            event["venue"] = venue
            event["seats_status"] = await compute_event_seats_status(event=event, venue=venue)
    return event


# ── Phase 7 — public seat-holds endpoints ────────────────────────────────
class SeatHoldsBody(BaseModel):
    seat_ids: List[str]
    session_token: str = Field(min_length=8, max_length=80)
    buyer_email: Optional[str] = Field(default=None, max_length=140)


class SeatHoldsRelease(BaseModel):
    session_token: str = Field(min_length=8, max_length=80)


async def _resolve_public_event(tenant_slug: str, event_slug: str) -> tuple:
    organizer = await db.organizers.find_one(
        {"slug": tenant_slug, "status": "approved"}, {"_id": 0},
    )
    if not organizer:
        raise HTTPException(404, "Organizador no encontrado")
    event = await db.events.find_one(
        {"organizer_id": organizer["id"], "slug": event_slug, "status": "published"},
        {"_id": 0},
    )
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    if not event.get("venue_id"):
        raise HTTPException(409, "Este evento no usa asientos numerados.")
    venue = await db.venues.find_one({"id": event["venue_id"]}, {"_id": 0})
    if not venue:
        raise HTTPException(409, "El venue del evento ya no está disponible.")
    return organizer, event, venue


@public_router.post("/{tenant_slug}/{event_slug}/seat-holds")
async def public_create_holds(tenant_slug: str, event_slug: str, body: SeatHoldsBody):
    from services.seats import create_seat_holds, compute_event_seats_status
    _, event, venue = await _resolve_public_event(tenant_slug, event_slug)
    if not body.seat_ids:
        raise HTTPException(422, "Tenés que elegir al menos un asiento.")
    if len(body.seat_ids) > 20:
        raise HTTPException(422, "Máximo 20 asientos por compra.")
    window = event.get("seat_holds_window_minutes") or 10
    holds = await create_seat_holds(
        event_id=event["id"], venue_id=venue["id"], seat_ids=body.seat_ids,
        session_token=body.session_token, buyer_email=body.buyer_email,
        window_minutes=window,
    )
    return {
        "holds": holds,
        "expires_at": holds[0]["expires_at"] if holds else None,
        "seats_status": await compute_event_seats_status(event=event, venue=venue),
    }


@public_router.delete("/{tenant_slug}/{event_slug}/seat-holds")
async def public_release_holds(tenant_slug: str, event_slug: str, body: SeatHoldsRelease):
    from services.seats import release_holds_for_session
    _, event, _venue = await _resolve_public_event(tenant_slug, event_slug)
    deleted = await release_holds_for_session(
        event_id=event["id"], session_token=body.session_token,
    )
    return {"released": deleted}


# ── Admin endpoints ─────────────────────────────────────────────────────────
@admin_router.get("")
async def admin_list_events(
    _admin=Depends(require_role("super_admin")),
    status: Optional[EventStatus] = None,
    organizer: Optional[str] = None,
    category: Optional[EventCategory] = None,
    pricing_type: Optional[PricingType] = None,
    search: Optional[str] = None,
    starts_from: Optional[str] = None,
    starts_to: Optional[str] = None,
    sort: str = Query(default="created_at"),
    direction: str = Query(default="desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    if organizer:
        query["organizer_id"] = organizer
    if category:
        query["category"] = category
    if pricing_type:
        query["pricing_type"] = pricing_type
    if search:
        query["title"] = {"$regex": search.strip(), "$options": "i"}
    if starts_from or starts_to:
        sq: Dict[str, Any] = {}
        if starts_from:
            sq["$gte"] = starts_from
        if starts_to:
            sq["$lte"] = starts_to
        query["starts_at"] = sq

    sort_dir = -1 if direction == "desc" else 1
    sort_field = sort if sort in ("created_at", "starts_at", "title", "tickets_sold") else "created_at"

    total = await db.events.count_documents(query)
    cursor = (
        db.events.find(query, {"_id": 0})
        .sort(sort_field, sort_dir)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    events = [d async for d in cursor]

    # Enrich with organizer company_name + per-event GMV/fees
    org_ids = list({e["organizer_id"] for e in events})
    evt_ids = [e["id"] for e in events]
    org_map: Dict[str, dict] = {}
    if org_ids:
        async for o in db.organizers.find(
            {"id": {"$in": org_ids}},
            {"_id": 0, "id": 1, "company_name": 1, "slug": 1},
        ):
            org_map[o["id"]] = o
    sales_map: Dict[str, dict] = {}
    if evt_ids:
        async for r in db.ticket_orders.aggregate([
            {"$match": {"event_id": {"$in": evt_ids}, "status": "paid"}},
            {"$group": {
                "_id": "$event_id",
                "gmv": {"$sum": "$total_cents"},
                "fees": {"$sum": "$fees_cents"},
            }},
        ]):
            sales_map[r["_id"]] = r
    for e in events:
        org = org_map.get(e["organizer_id"], {})
        s = sales_map.get(e["id"], {})
        e["organizer_company_name"] = org.get("company_name")
        e["organizer_slug"] = org.get("slug")
        e["gmv_cents"] = s.get("gmv", 0)
        e["fees_cents"] = s.get("fees", 0)
    return {"items": events, "total": total, "page": page, "limit": limit}


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
