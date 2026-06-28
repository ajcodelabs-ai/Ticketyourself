"""
Events — PostgreSQL implementation.
Free / paid / donation events, single occurrence, numbered seating, tiered pricing.
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
from sqlalchemy import func, or_, select
from sqlalchemy.orm.attributes import flag_modified

from database import AsyncSessionLocal
from db_helpers import get_venue_by_id, row_to_dict
from orm_models import AuditLog, Event, EventAsset, Organizer, Tenant, TicketOrder
from security import get_current_user, require_role
from services.plan_features import assert_feature
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
    "music",
    "theater",
    "comedy",
    "festivals",
    "family",
    "sports",
    "educational",
    "corporate",
    "fairs",
    "conferences",
    "gastronomy",
    "art_culture",
    "health_wellness",
    "religious",
    "tourism",
    "technology",
    "fashion_beauty",
    "community",
    "nightlife",
    "other",
]
EventStatus = Literal["draft", "published", "sold_out", "ended", "cancelled"]
PricingType = Literal["free", "paid", "donation"]
Visibility = Literal["public", "public_blocked", "private"]


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
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(min_length=2, max_length=80)
    type: Literal["promo_code", "auto", "quantity"]
    enabled: bool = True
    code: Optional[str] = Field(default=None, max_length=40)
    max_uses: Optional[int] = Field(default=None, ge=1)
    uses_count: int = Field(default=0, ge=0)
    min_quantity: Optional[int] = Field(default=None, ge=1)
    conditions: DiscountConditions = Field(default_factory=DiscountConditions)
    discount: DiscountBenefit

    @model_validator(mode="after")
    def _check_shape(self):
        if self.type == "promo_code":
            if not self.code:
                raise ValueError("promo_code rules require a `code`")
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
    visibility: Visibility = "public"
    access_type: Literal["open", "link_only", "verified_list", "access_code"] = "open"
    max_per_purchase: int = Field(default=10, ge=1, le=100)
    max_per_email: Optional[int] = Field(default=None, ge=1)
    refund_window_hours: int = Field(default=24, ge=0)
    show_buyer_name_on_ticket: bool = True


class AgendaItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    time: str = Field(default="", max_length=20)
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=2000)


class FaqItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str = Field(default="", max_length=300)
    answer_html: str = Field(default="", max_length=8000)


class EventContent(BaseModel):
    policies_html: str = Field(default="", max_length=16000)
    agenda: List[AgendaItem] = Field(default_factory=list)
    faq: List[FaqItem] = Field(default_factory=list)


class EventBase(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    description: str = Field(default="", max_length=8000)
    short_description: str = Field(default="", max_length=160)
    category: EventCategory = "other"
    venue_name: str = Field(default="", max_length=120)
    venue_address: str = Field(default="", max_length=200)
    venue_city: str = Field(default="", max_length=80)
    venue_country: str = Field(default="Ecuador", max_length=80)
    starts_at: datetime
    ends_at: datetime
    timezone: str = Field(default="America/Guayaquil", max_length=64)
    sales_start: Optional[datetime] = None
    sales_end: Optional[datetime] = None
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
    content: Optional[EventContent] = None
    # eTicket delivery
    ticket_delivery_mode: Optional[str] = Field(default="al_momento", max_length=20)
    ticket_delivery_hours: Optional[int] = Field(default=None, ge=1)
    ticket_delivery_at: Optional[datetime] = None
    # "function" = Multifunción/Franjas horarias, "subevent" = Evento con
    # Subeventos — drives wording + the default EventFunction.kind.
    multi_function_mode: Literal["function", "subevent"] = "function"

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
    content: Optional[EventContent] = None
    # eTicket delivery
    ticket_delivery_mode: Optional[str] = Field(default=None, max_length=20)
    ticket_delivery_hours: Optional[int] = Field(default=None, ge=1)
    ticket_delivery_at: Optional[datetime] = None
    multi_function_mode: Optional[Literal["function", "subevent"]] = None


# ── Helpers ──────────────────────────────────────────────────────────────────
PANEL_ALLOWED_STATUSES = {"pending", "approved"}
PUBLISH_ALLOWED_STATUSES = {"approved"}


async def _require_active_organizer(user) -> dict:
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Organizer).where(Organizer.id == user["organizer_id"])
        )
        org_row = result.scalar_one_or_none()
    if not org_row:
        raise HTTPException(status_code=404, detail="Organizer not found")
    if org_row.status not in PANEL_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta no tiene acceso al panel de eventos.",
        )
    return row_to_dict(org_row)


async def _require_organizer_can_publish(user) -> dict:
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


_require_approved_organizer = _require_active_organizer


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _next_event_slug(organizer_id: str, base: str, session) -> str:
    candidate = base or "evento"
    suffix = 1
    while True:
        c = candidate if suffix == 1 else f"{candidate}-{suffix}"
        existing = await session.scalar(
            select(Event.id).where(
                Event.organizer_id == organizer_id,
                Event.slug == c,
            )
        )
        if not existing:
            return c
        suffix += 1


def _publish_validation(doc: dict) -> None:
    missing = []
    if not doc.get("title"):
        missing.append("título")
    if not doc.get("starts_at") or not doc.get("ends_at"):
        missing.append("fechas")
    if not doc.get("venue_name"):
        missing.append("nombre del venue")
    if not doc.get("poster_url"):
        missing.append("poster")
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
            has_paid_locality = any(int(lp.get("price_cents") or 0) > 0 for lp in pricing)
            if has_paid_locality and doc.get("pricing_type") == "free":
                missing.append(
                    "marcar el evento como 'Pago' en Tipo de recaudación "
                    "(tenés localidades con precio pero el evento está como Gratis)"
                )
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
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(404, "Evento no encontrado")

        venue = await get_venue_by_id(body.venue_id)
        if (
            not venue
            or venue.get("organizer_id") != org["id"]
            or venue.get("status") != "published"
        ):
            raise HTTPException(404, "Venue no encontrado o no publicado")

        needed_loc_ids = set(active_localities(venue))
        provided_loc_ids = {lp.locality_id for lp in body.locality_pricing}
        if not needed_loc_ids.issubset(provided_loc_ids):
            missing = needed_loc_ids - provided_loc_ids
            raise HTTPException(
                422,
                f"Faltan precios para las localidades: {', '.join(sorted(missing))}",
            )

        sold = row.tickets_sold or 0
        if sold > 0 and row.venue_id and row.venue_id != body.venue_id:
            raise HTTPException(
                409, f"El evento ya tiene {sold} ticket(s) vendido(s); no se puede cambiar el venue."
            )

        venue_capacity = venue.get("capacity_calculated") or 0
        row.venue_id = body.venue_id
        row.venue_slug = venue.get("slug")
        row.venue_name = venue.get("name") or row.venue_name
        row.locality_pricing = [lp.model_dump() for lp in body.locality_pricing]
        row.seat_holds_window_minutes = body.seat_holds_window_minutes
        row.capacity = venue_capacity
        row.updated_at = _now()
        flag_modified(row, "locality_pricing")
        await session.commit()
        return row_to_dict(row)


@router.delete("/{event_id}/venue")
async def unlink_venue_from_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(404, "Evento no encontrado")
        if (row.tickets_sold or 0) > 0:
            raise HTTPException(409, "El evento ya tiene tickets vendidos; no se puede desvincular.")
        row.venue_id = None
        row.venue_slug = None
        row.locality_pricing = []
        row.updated_at = _now()
        flag_modified(row, "locality_pricing")
        await session.commit()
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
    async with AsyncSessionLocal() as session:
        stmt = select(Event).where(Event.organizer_id == org["id"])
        if status:
            stmt = stmt.where(Event.status == status)
        if search:
            stmt = stmt.where(Event.title.ilike(f"%{re.escape(search)}%"))
        total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        result = await session.execute(
            stmt.order_by(Event.starts_at.asc()).offset((page - 1) * limit).limit(limit)
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/{event_id}")
async def get_my_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return row_to_dict(row)


def _assert_access_type_allowed(plan_code: Optional[str], access_type: Optional[str]) -> None:
    if access_type == "verified_list":
        assert_feature(plan_code, "verified_lists")
    elif access_type == "access_code":
        assert_feature(plan_code, "access_codes")


@router.post("", status_code=201)
async def create_my_event(payload: EventCreate, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    if payload.access_params:
        _assert_access_type_allowed(org.get("plan_code"), payload.access_params.access_type)
    async with AsyncSessionLocal() as session:
        slug = await _next_event_slug(org["id"], normalize_slug(payload.title), session)

        # Duplicate check: same (starts_at, venue_name) in same organizer.
        if payload.venue_name:
            existing = await session.scalar(
                select(Event.id).where(
                    Event.organizer_id == org["id"],
                    Event.starts_at == payload.starts_at,
                    Event.venue_name == payload.venue_name,
                    Event.venue_name != "",
                )
            )
            if existing:
                raise HTTPException(409, "Ya tenés un evento en ese venue y fecha")

        now = _now()
        row = Event(
            id=str(uuid.uuid4()),
            organizer_id=org["id"],
            tenant_slug=org["slug"],
            slug=slug,
            title=payload.title,
            description=payload.description or "",
            short_description=payload.short_description or "",
            category=payload.category,
            venue_name=payload.venue_name or "",
            venue_address=payload.venue_address or "",
            venue_city=payload.venue_city or "",
            venue_country=payload.venue_country or "Ecuador",
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            timezone=payload.timezone,
            sales_start=payload.sales_start,
            sales_end=payload.sales_end,
            duration_preset=payload.duration_preset,
            sales_window_preset_start=payload.sales_window_preset_start,
            sales_window_preset_end=payload.sales_window_preset_end,
            pricing_type=payload.pricing_type,
            base_price_cents=payload.base_price_cents,
            currency=payload.currency,
            capacity=payload.capacity,
            visibility=payload.visibility,
            multi_function_mode=payload.multi_function_mode,
            payment_methods=(
                payload.payment_methods.model_dump() if payload.payment_methods
                else PaymentMethodConfig().model_dump()
            ),
            discounts=(
                payload.discounts.model_dump(exclude_none=False) if payload.discounts
                else EventDiscounts().model_dump()
            ),
            access_params=(
                payload.access_params.model_dump() if payload.access_params
                else EventAccessParams().model_dump()
            ),
            content=(
                payload.content.model_dump() if payload.content
                else EventContent().model_dump()
            ),
            poster_url=None,
            banner_url=None,
            gallery_urls=[],
            locality_pricing=[],
            status="draft",
            tickets_sold=0,
            created_at=now,
            updated_at=now,
            published_at=None,
        )
        session.add(row)
        await session.flush()
        result = row_to_dict(row)
        await session.commit()
    return result


_JSONB_FIELDS = {"payment_methods", "discounts", "access_params", "content"}


@router.put("/{event_id}")
async def update_my_event(
    event_id: str, payload: EventUpdate, user=Depends(get_current_user)
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        diff = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}

        # Re-dump nested JSONB fields to preserve all values (e.g. None inside rules).
        if "discounts" in diff and payload.discounts is not None:
            diff["discounts"] = payload.discounts.model_dump(exclude_none=False)
        if "payment_methods" in diff and payload.payment_methods is not None:
            diff["payment_methods"] = payload.payment_methods.model_dump()
        if "access_params" in diff and payload.access_params is not None:
            diff["access_params"] = payload.access_params.model_dump()
            _assert_access_type_allowed(
                org.get("plan_code"), payload.access_params.access_type
            )
        if "content" in diff and payload.content is not None:
            diff["content"] = payload.content.model_dump()

        # Lock critical fields once tickets are sold.
        if (row.tickets_sold or 0) > 0:
            for locked in ("base_price_cents", "pricing_type", "currency"):
                if locked in diff:
                    raise HTTPException(
                        status_code=422,
                        detail=f"No se puede modificar `{locked}` con ventas registradas",
                    )
            if "capacity" in diff and diff["capacity"] is not None:
                if diff["capacity"] < (row.tickets_sold or 0):
                    raise HTTPException(
                        status_code=422,
                        detail="La capacidad no puede ser menor a tickets ya vendidos",
                    )

        new_starts = diff.get("starts_at", row.starts_at)
        new_ends = diff.get("ends_at", row.ends_at)
        if new_starts and new_ends and new_ends <= new_starts:
            raise HTTPException(status_code=422, detail="ends_at must be after starts_at")

        for k, v in diff.items():
            setattr(row, k, v)
            if k in _JSONB_FIELDS:
                flag_modified(row, k)

        row.updated_at = _now()
        await session.flush()
        result = row_to_dict(row)
        await session.commit()
    return result


@router.post("/{event_id}/publish")
async def publish_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_organizer_can_publish(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        _publish_validation(row_to_dict(row))
        now = _now()
        row.status = "published"
        row.published_at = now
        row.updated_at = now
        await session.commit()
    return {"ok": True, "status": "published"}


@router.post("/{event_id}/unpublish")
async def unpublish_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        row.status = "draft"
        row.updated_at = _now()
        await session.commit()
    return {"ok": True, "status": "draft"}


@router.post("/{event_id}/cancel")
async def cancel_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        row.status = "cancelled"
        row.updated_at = _now()
        await session.commit()
    return {"ok": True, "status": "cancelled"}


@router.delete("/{event_id}", status_code=204)
async def delete_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status != "draft":
            raise HTTPException(
                status_code=422, detail="Sólo eventos en borrador pueden eliminarse"
            )
        await session.delete(row)
        await session.commit()
    return None


async def _store_event_image(
    event_id: str, organizer_id: str, file: UploadFile, kind: str
) -> str:
    """Persist file → return /api/events/assets/{id} URL. Asset metadata kept in MongoDB."""
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

    async with AsyncSessionLocal() as _pg_asset:
        _pg_asset.add(EventAsset(
            id=asset_id,
            event_id=event_id,
            organizer_id=organizer_id,
            kind=kind,
            file_path=rel_path,
            mime_type=file.content_type,
            size_bytes=len(content),
            uploaded_at=datetime.now(timezone.utc),
        ))
        await _pg_asset.commit()
    return f"/api/events/assets/{asset_id}"


@router.post("/{event_id}/poster")
async def upload_poster(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        url = await _store_event_image(event_id, org["id"], file, "poster")
        row.poster_url = url
        row.updated_at = _now()
        await session.commit()
    return {"poster_url": url}


@router.post("/{event_id}/banner")
async def upload_banner(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        url = await _store_event_image(event_id, org["id"], file, "banner")
        row.banner_url = url
        row.updated_at = _now()
        await session.commit()
    return {"banner_url": url}


# ── Gallery ─────────────────────────────────────────────────────────────────
MAX_GALLERY_IMAGES = 10


@router.post("/{event_id}/gallery")
async def upload_gallery_image(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        current = list(row.gallery_urls or [])
        if len(current) >= MAX_GALLERY_IMAGES:
            raise HTTPException(
                status_code=422,
                detail=f"Máximo {MAX_GALLERY_IMAGES} imágenes en la galería.",
            )
        url = await _store_event_image(event_id, org["id"], file, "gallery")
        new_list = current + [url]
        row.gallery_urls = new_list
        row.updated_at = _now()
        flag_modified(row, "gallery_urls")
        await session.commit()
    return {"gallery_urls": new_list}


@router.delete("/{event_id}/gallery/{index}")
async def delete_gallery_image(
    event_id: str, index: int, user=Depends(get_current_user)
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        current: List[str] = list(row.gallery_urls or [])
        if index < 0 or index >= len(current):
            raise HTTPException(status_code=404, detail="Image not found")
        current.pop(index)
        row.gallery_urls = current
        row.updated_at = _now()
        flag_modified(row, "gallery_urls")
        await session.commit()
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
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        current: List[str] = list(row.gallery_urls or [])
        if sorted(payload.order) != list(range(len(current))):
            raise HTTPException(
                status_code=422,
                detail="`order` debe contener exactamente los índices actuales una vez cada uno",
            )
        new_list = [current[i] for i in payload.order]
        row.gallery_urls = new_list
        row.updated_at = _now()
        flag_modified(row, "gallery_urls")
        await session.commit()
    return {"gallery_urls": new_list}


# ── Asset serving ───────────────────────────────────────────────────────────
@asset_router.get("/{asset_id}")
async def serve_event_asset(asset_id: str):
    async with AsyncSessionLocal() as _pg_sa:
        _asset_row = await _pg_sa.scalar(
            select(EventAsset).where(EventAsset.id == asset_id)
        )
    if not _asset_row:
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = ASSETS_DIR / _asset_row.file_path
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        abs_path,
        media_type=_asset_row.mime_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Public endpoints ────────────────────────────────────────────────────────
@public_router.get("")
async def list_public_events(
    tenant_slug: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    async with AsyncSessionLocal() as pg:
        org_id_row = (await pg.execute(
            select(Organizer.id).where(Organizer.slug == tenant_slug)
        )).first()
        tenant_row = (await pg.execute(
            select(Tenant.status).where(Tenant.slug == tenant_slug)
        )).first()
    if not org_id_row:
        return {"items": [], "total": 0}
    if not tenant_row or tenant_row[0] != "active":
        return {"items": [], "total": 0}
    org_id = org_id_row[0]
    async with AsyncSessionLocal() as pg:
        stmt = select(Event).where(
            Event.organizer_id == org_id,
            Event.status == "published",
            Event.visibility.in_(["public", "public_blocked"]),
        )
        total = await pg.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        result = await pg.execute(
            stmt.order_by(Event.starts_at.asc()).offset((page - 1) * limit).limit(limit)
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total}


@public_router.get("/{tenant_slug}/{event_slug}")
async def get_public_event(
    tenant_slug: str, event_slug: str, function_id: Optional[str] = Query(default=None),
):
    async with AsyncSessionLocal() as pg:
        org_row = (await pg.execute(
            select(Organizer).where(Organizer.slug == tenant_slug)
        )).scalar_one_or_none()
        tenant_row = (await pg.execute(
            select(Tenant.status).where(Tenant.slug == tenant_slug)
        )).first()
    if not org_row:
        raise HTTPException(status_code=404, detail="Not found")
    if not tenant_row or tenant_row[0] != "active":
        raise HTTPException(status_code=404, detail="Not available")
    organizer = row_to_dict(org_row)
    async with AsyncSessionLocal() as pg:
        event_row = await pg.scalar(
            select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == event_slug,
                Event.status == "published",
            )
        )
    if not event_row:
        raise HTTPException(status_code=404, detail="Event not found")
    event = row_to_dict(event_row)
    event["organizer"] = {
        "slug": organizer["slug"],
        "company_name": organizer.get("company_name"),
    }
    if event.get("venue_id"):
        from services.seats import compute_event_seats_status
        venue = await get_venue_by_id(event["venue_id"])
        if venue:
            event["venue"] = venue
            event["seats_status"] = await compute_event_seats_status(
                event=event, venue=venue, function_id=function_id or "",
            )
    return event


# ── Phase 7 — public seat-holds endpoints ────────────────────────────────
class SeatHoldsBody(BaseModel):
    seat_ids: List[str]
    session_token: str = Field(min_length=8, max_length=80)
    buyer_email: Optional[str] = Field(default=None, max_length=140)
    function_id: Optional[str] = None


class SeatHoldsRelease(BaseModel):
    session_token: str = Field(min_length=8, max_length=80)
    function_id: Optional[str] = None


async def _validate_active_function(event_id: str, function_id: Optional[str]) -> None:
    """Raise 422 if function_id is set but doesn't belong to this event or
    isn't active — same función the buyer is holding seats for must exist."""
    if not function_id:
        return
    from orm_models import EventFunction
    async with AsyncSessionLocal() as pg:
        func_row = await pg.scalar(
            select(EventFunction).where(
                EventFunction.id == function_id,
                EventFunction.event_id == event_id,
                EventFunction.status == "active",
            )
        )
    if not func_row:
        raise HTTPException(422, "La función seleccionada no existe o ya no está disponible.")


async def _resolve_public_event(tenant_slug: str, event_slug: str) -> tuple:
    async with AsyncSessionLocal() as pg:
        org_row = (await pg.execute(
            select(Organizer).where(
                Organizer.slug == tenant_slug, Organizer.status == "approved"
            )
        )).scalar_one_or_none()
    if not org_row:
        raise HTTPException(404, "Organizador no encontrado")
    organizer = row_to_dict(org_row)
    async with AsyncSessionLocal() as pg:
        event_row = await pg.scalar(
            select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == event_slug,
                Event.status == "published",
            )
        )
    if not event_row:
        raise HTTPException(404, "Evento no encontrado")
    event = row_to_dict(event_row)
    if not event.get("venue_id"):
        raise HTTPException(409, "Este evento no usa asientos numerados.")
    venue = await get_venue_by_id(event["venue_id"])
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
    await _validate_active_function(event["id"], body.function_id)
    function_id = body.function_id or ""
    window = event.get("seat_holds_window_minutes") or 10
    holds = await create_seat_holds(
        event_id=event["id"], venue_id=venue["id"], seat_ids=body.seat_ids,
        session_token=body.session_token, buyer_email=body.buyer_email,
        window_minutes=window, function_id=function_id,
    )
    return {
        "holds": holds,
        "expires_at": holds[0]["expires_at"] if holds else None,
        "seats_status": await compute_event_seats_status(
            event=event, venue=venue, function_id=function_id,
        ),
    }


@public_router.delete("/{tenant_slug}/{event_slug}/seat-holds")
async def public_release_holds(tenant_slug: str, event_slug: str, body: SeatHoldsRelease):
    from services.seats import release_holds_for_session
    _, event, _venue = await _resolve_public_event(tenant_slug, event_slug)
    deleted = await release_holds_for_session(
        event_id=event["id"], session_token=body.session_token,
        function_id=body.function_id,
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
    async with AsyncSessionLocal() as pg:
        stmt = select(Event)
        if status:
            stmt = stmt.where(Event.status == status)
        if organizer:
            stmt = stmt.where(Event.organizer_id == organizer)
        if category:
            stmt = stmt.where(Event.category == category)
        if pricing_type:
            stmt = stmt.where(Event.pricing_type == pricing_type)
        if search:
            stmt = stmt.where(Event.title.ilike(f"%{search.strip()}%"))
        if starts_from:
            stmt = stmt.where(Event.starts_at >= datetime.fromisoformat(starts_from))
        if starts_to:
            stmt = stmt.where(Event.starts_at <= datetime.fromisoformat(starts_to))

        _sort_cols: Dict[str, Any] = {
            "created_at": Event.created_at,
            "starts_at": Event.starts_at,
            "title": Event.title,
            "tickets_sold": Event.tickets_sold,
        }
        sort_col = _sort_cols.get(sort, Event.created_at)
        order_expr = sort_col.desc() if direction == "desc" else sort_col.asc()

        total = await pg.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        result = await pg.execute(
            stmt.order_by(order_expr).offset((page - 1) * limit).limit(limit)
        )
        events = [row_to_dict(r) for r in result.scalars().all()]

    # Enrich with organizer company_name + per-event GMV/fees (GMV still from MongoDB orders).
    org_ids = list({e["organizer_id"] for e in events})
    evt_ids = [e["id"] for e in events]
    org_map: Dict[str, dict] = {}
    if org_ids:
        async with AsyncSessionLocal() as pg:
            org_result = await pg.execute(
                select(Organizer.id, Organizer.company_name, Organizer.slug).where(
                    Organizer.id.in_(org_ids)
                )
            )
            for row in org_result.all():
                org_map[row.id] = {"id": row.id, "company_name": row.company_name, "slug": row.slug}
    sales_map: Dict[str, dict] = {}
    if evt_ids:
        async with AsyncSessionLocal() as _pg_sales:
            _sales_result = await _pg_sales.execute(
                select(
                    TicketOrder.event_id,
                    func.coalesce(func.sum(TicketOrder.total_cents), 0).label("gmv"),
                    func.coalesce(func.sum(TicketOrder.fees_cents), 0).label("fees"),
                )
                .where(TicketOrder.event_id.in_(evt_ids), TicketOrder.status == "paid")
                .group_by(TicketOrder.event_id)
            )
            for r in _sales_result.all():
                sales_map[r.event_id] = {"gmv": r.gmv, "fees": r.fees}
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
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        now = _now()
        row.status = "cancelled"
        row.updated_at = now
        session.add(AuditLog(
            id=str(uuid.uuid4()),
            actor_user_id=admin["id"],
            action="event.force_cancelled",
            target_type="event",
            target_id=event_id,
            metadata_={"comment": payload.comment},
            created_at=now,
        ))
        await session.commit()
    return {"ok": True, "status": "cancelled"}
