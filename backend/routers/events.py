"""
Events — PostgreSQL implementation.
Free / paid / donation events, single occurrence, numbered seating, tiered pricing.
"""

import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm.attributes import flag_modified

from database import AsyncSessionLocal
from db_helpers import get_venue_by_id, row_to_dict
from orm_models import (
    AuditLog,
    Event,
    EventAsset,
    EventCapacityReservation,
    EventFunction,
    EventSeatAssignment,
    Organizer,
    SeasonPassPurchase,
    SeatHold,
    StaffEventAssignment,
    Tenant,
    Ticket,
    TicketOrder,
    TicketScan,
    TicketType,
)
from security import get_current_user, is_active_organizer, require_role
from services import datil_service
from services.event_venue import (
    locality_structural_diff,
    normalize_layout_localities,
    plan_layout_seating_conflict,
    recalc_layout_capacity,
    resolve_event_venue,
    snapshot_from_venue,
    structural_diff,
)
from services.order_service import LOCALITY_CHARGE_FIELDS, locality_pricing_has_charge
from services.path_safety import resolve_path_under
from services.plan_features import assert_feature_async, get_plan_features_async
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
ALLOWED_APPEAL_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_APPEAL_BYTES = 10 * 1024 * 1024
MAX_APPEAL_FILES = 5

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
EventStatus = Literal[
    "draft", "published", "sold_out", "ended", "cancelled", "suspended"
]
PricingType = Literal["free", "paid", "donation"]
Visibility = Literal[
    "public", "private", "public_blocked"
]  # public_blocked: legacy read
# Listed on microsite index (private is link-only, never listed).
LISTABLE_VISIBILITIES = ("public", "public_blocked")
# Resolvable by direct slug URL (includes private + legacy blocked).
RESOLVABLE_VISIBILITIES = ("public", "public_blocked", "private")


router = APIRouter(prefix="/api/events/me", tags=["events"])
public_router = APIRouter(prefix="/api/public/events", tags=["events-public"])
admin_router = APIRouter(prefix="/api/admin/events", tags=["events-admin"])
asset_router = APIRouter(prefix="/api/events/assets", tags=["events-assets"])


# ── Models ───────────────────────────────────────────────────────────────────
class PaymentMethodConfig(BaseModel):
    """Per-event payment methods.

    Canonical shape uses ``enabled_codes`` (nuvei | deuna | transfer | cash).
    Legacy ``{stripe,transfer,cash}.enabled`` is still accepted on input and
    mapped via ``services.payment_methods.normalize_payment_methods``.
    """

    enabled_codes: Optional[List[str]] = None
    stripe: Dict[str, Any] = Field(default_factory=lambda: {"enabled": False})
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
    payment_methods: Optional[
        List[Literal["stripe", "nuvei", "deuna", "transfer", "cash"]]
    ] = None


class DiscountBenefit(BaseModel):
    type: Literal["percent", "fixed"]
    value: int = Field(gt=0)  # 25 = 25% or 25 USD according to type


class DiscountRule(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(min_length=2, max_length=80)
    type: Literal["promo_code", "auto", "quantity", "buy_n_get_m"]
    enabled: bool = True
    code: Optional[str] = Field(default=None, max_length=40)
    max_uses: Optional[int] = Field(default=None, ge=1)
    uses_count: int = Field(default=0, ge=0)
    min_quantity: Optional[int] = Field(default=None, ge=1)
    # NxM — "compra N y recibe M gratis"
    buy_quantity: Optional[int] = Field(default=None, ge=1)
    free_quantity: Optional[int] = Field(default=None, ge=1)
    # Tracking de códigos de influencer (informativo, no afecta el cálculo)
    influencer_name: Optional[str] = Field(default=None, max_length=80)
    channel: Optional[str] = Field(default=None, max_length=40)
    conditions: DiscountConditions = Field(default_factory=DiscountConditions)
    discount: Optional[DiscountBenefit] = None

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
        if self.type == "buy_n_get_m":
            if not self.buy_quantity or not self.free_quantity:
                raise ValueError(
                    "buy_n_get_m rules require `buy_quantity` and `free_quantity`"
                )
        elif not self.discount:
            raise ValueError("Esta regla requiere un beneficio (`discount`).")
        if (
            self.conditions.valid_from
            and self.conditions.valid_until
            and self.conditions.valid_until <= self.conditions.valid_from
        ):
            raise ValueError("`valid_until` debe ser posterior a `valid_from`")
        if (
            self.discount
            and self.discount.type == "percent"
            and self.discount.value > 100
        ):
            raise ValueError("Un porcentaje no puede superar 100")
        return self


class EventDiscounts(BaseModel):
    disability_law: Dict[str, Any] = Field(
        default_factory=lambda: {"enabled": False, "percent": 50}
    )
    senior_law: Dict[str, Any] = Field(
        default_factory=lambda: {
            "enabled": False,
            "percent": 50,
            "min_age": 65,
            "require_document": True,
        }
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

    @model_validator(mode="after")
    def _normalize_law_blocks(self):
        # Keep percent in range; tolerate missing keys from older events.
        for key, default_pct in (("disability_law", 50), ("senior_law", 50)):
            block = getattr(self, key) or {}
            if not isinstance(block, dict):
                block = {}
            pct = int(block.get("percent") or default_pct)
            block["percent"] = max(1, min(100, pct))
            block["enabled"] = bool(block.get("enabled"))
            if key == "senior_law":
                age = int(block.get("min_age") or 65)
                block["min_age"] = max(50, min(100, age))
                block["require_document"] = bool(block.get("require_document", True))
            setattr(self, key, block)
        return self


class EventAccessParams(BaseModel):
    # Visibility lives only on `Event.visibility` (top-level column) — it used
    # to be duplicated here too, written by hand on every update. Removed to
    # avoid the two values drifting apart; see EventBase.visibility instead.
    # link_only is legacy (normalized to open); kept for read tolerance.
    access_type: Literal["open", "link_only", "verified_list", "access_code"] = "open"
    max_per_purchase: int = Field(default=10, ge=1, le=100)
    min_per_purchase: int = Field(default=1, ge=1, le=100)
    max_per_email: Optional[int] = Field(default=None, ge=1)
    show_buyer_name_on_ticket: bool = True
    # §4.2.2 Acceso — QR validable en puerta vs entrada solo PDF/email.
    ticket_validation: Literal["qr", "none"] = "qr"
    # §4.2.2 — código de acceso puede convivir con "continuar sin código".
    allow_continue_without_code: bool = False
    # §4.2.4 — formato de asistencia (wizard); layout may refine mixed vs numbered.
    attendance_format: Optional[Literal["numbered", "general", "mixed"]] = None

    @model_validator(mode="after")
    def _check_min_max(self):
        if self.min_per_purchase > self.max_per_purchase:
            raise ValueError("min_per_purchase no puede ser mayor que max_per_purchase")
        return self

    @model_validator(mode="after")
    def _normalize_legacy_access(self):
        if self.access_type == "link_only":
            self.access_type = "open"
        return self


# eTicket is always sent. Legacy "manual" (organizer opted out) maps to al_momento.
TICKET_DELIVERY_MODES = ("al_momento", "horas_antes", "fecha_especifica")


def _normalize_ticket_delivery_mode(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    if v in TICKET_DELIVERY_MODES:
        return v
    return "al_momento"


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
    tyc_url: Optional[str] = Field(default=None, max_length=2000)
    tyc_label: str = Field(default="", max_length=200)
    allow_full_group_purchase: bool = False


# M4 — diseñador visual de tickets (drag & drop): elements are positioned as
# fractions [0,1] of the canvas so the same design renders correctly at any
# output size (digital / A4 / PVC) without unit-conversion math.
TicketDesignField = Literal[
    "title",
    "starts_at",
    "venue",
    "holder_name",
    "holder_email",
    "price",
    "seat_or_raffle",
    "order_number",
    "organizer_name",
    "custom",
]


class TicketDesignElement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["logo", "qr", "text"]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    rotation: float = 0
    # type="logo"
    image_url: Optional[str] = None
    # type="text"
    field: Optional[TicketDesignField] = None
    text: Optional[str] = Field(default=None, max_length=200)  # field="custom"
    font_size: Optional[int] = Field(default=14, ge=6, le=72)
    color: Optional[str] = Field(default="#1f1f33", max_length=7)
    align: Optional[Literal["left", "center", "right"]] = "left"

    @model_validator(mode="after")
    def _check_shape(self):
        if (
            self.type == "text"
            and self.field == "custom"
            and not (self.text or "").strip()
        ):
            raise ValueError("Un texto personalizado requiere `text`")
        return self


class TicketDesign(BaseModel):
    format: Literal["digital", "a4", "pvc"] = "a4"
    background_url: Optional[str] = None
    background_color: str = Field(default="#ffffff", max_length=7)
    elements: List[TicketDesignElement] = Field(default_factory=list)
    # Optional curated template id from the wizard picker (clasico|noche|minimal|bold).
    template_id: Optional[str] = Field(default=None, max_length=40)


# §4.2.8 — preguntas adicionales al comprador al momento de la compra
class CustomQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str = Field(min_length=2, max_length=200)
    type: Literal["text", "select", "checkbox", "number"] = "text"
    required: bool = False
    options: Optional[List[str]] = Field(default=None, max_length=20)
    # Empty/null = applies to all localities; otherwise only when buyer picks these.
    locality_ids: Optional[List[str]] = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def _check_options(self):
        if self.type == "select" and not self.options:
            raise ValueError("Las preguntas de tipo 'select' requieren `options`")
        return self


class EventBase(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    description: str = Field(default="", max_length=8000)
    short_description: str = Field(default="", max_length=160)
    category: EventCategory = "other"
    priority: int = Field(default=0, ge=0, le=9999)
    video_url: Optional[str] = Field(default=None, max_length=500)
    keywords: List[str] = Field(default_factory=list, max_length=30)
    venue_name: str = Field(default="", max_length=120)
    venue_address: str = Field(default="", max_length=200)
    venue_city: str = Field(default="", max_length=80)
    venue_country: str = Field(default="Ecuador", max_length=80)
    # Dates are optional so a draft can be created before the schedule is set;
    # _publish_validation() enforces them at publish time.
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
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
    # §4.2.1 — "Por Donación" events may emit RIFA-numbered tickets
    raffle_enabled: bool = False
    # §4.2.1 — free events may accept an optional voluntary contribution
    optional_donation_enabled: bool = False
    # §4.2.1 Pagado — per-ticket fees (general / non-seated events)
    ticket_fees: Optional[dict] = None
    # SRI IVA % (included in ticket price). None = default from org / Ecuador 15.
    iva_percent: Optional[int] = Field(default=None, ge=0, le=30)
    # Comisión TYS: buyer la paga en checkout; organizer la absorbe.
    platform_fee_bearer: Literal["buyer", "organizer"] = "buyer"
    # §4.2.8 — preguntas adicionales al comprador
    custom_questions: List[CustomQuestion] = Field(default_factory=list)
    # M4 — diseñador visual de tickets; courtesy null = hereda el diseño principal
    ticket_design: Optional[TicketDesign] = None
    courtesy_ticket_design: Optional[TicketDesign] = None
    payment_methods: Optional[PaymentMethodConfig] = None
    discounts: Optional[EventDiscounts] = None
    access_params: Optional[EventAccessParams] = None
    content: Optional[EventContent] = None
    # eTicket delivery (always sent; "manual" is coerced to al_momento)
    ticket_delivery_mode: Optional[str] = Field(default="al_momento", max_length=20)
    ticket_delivery_hours: Optional[int] = Field(default=None, ge=1)
    ticket_delivery_at: Optional[datetime] = None
    # PRD §4.2.3 — "function" = Multifunción, "subevent" = Evento con Subeventos.
    # Entry time-slots / franjas de ingreso are Phase 2 — not in this version.
    multi_function_mode: Literal["function", "subevent"] = "function"

    @field_validator("ends_at")
    @classmethod
    def _ends_after_start(cls, v: datetime, info):
        starts = info.data.get("starts_at")
        if starts and v and v <= starts:
            raise ValueError("ends_at must be after starts_at")
        return v

    @field_validator("keywords")
    @classmethod
    def _normalize_keywords(cls, v: List[str]):
        out = []
        for kw in v or []:
            s = (kw or "").strip()[:40]
            if s and s not in out:
                out.append(s)
        return out[:30]

    @field_validator("video_url")
    @classmethod
    def _empty_video_to_none(cls, v: Optional[str]):
        if v is None:
            return None
        s = v.strip()
        return s or None

    @field_validator("ticket_delivery_mode", mode="before")
    @classmethod
    def _coerce_delivery_mode(cls, v):
        return _normalize_ticket_delivery_mode(v) or "al_momento"


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=140)
    description: Optional[str] = None
    short_description: Optional[str] = None
    category: Optional[EventCategory] = None
    priority: Optional[int] = Field(default=None, ge=0, le=9999)
    video_url: Optional[str] = Field(default=None, max_length=500)
    keywords: Optional[List[str]] = Field(default=None, max_length=30)
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
    raffle_enabled: Optional[bool] = None
    optional_donation_enabled: Optional[bool] = None
    ticket_fees: Optional[dict] = None
    iva_percent: Optional[int] = Field(default=None, ge=0, le=30)
    platform_fee_bearer: Optional[Literal["buyer", "organizer"]] = None
    custom_questions: Optional[List[CustomQuestion]] = None
    ticket_design: Optional[TicketDesign] = None
    courtesy_ticket_design: Optional[TicketDesign] = None
    payment_methods: Optional[PaymentMethodConfig] = None
    discounts: Optional[EventDiscounts] = None
    access_params: Optional[EventAccessParams] = None
    content: Optional[EventContent] = None
    # eTicket delivery
    ticket_delivery_mode: Optional[str] = Field(default=None, max_length=20)
    ticket_delivery_hours: Optional[int] = Field(default=None, ge=1)
    ticket_delivery_at: Optional[datetime] = None
    multi_function_mode: Optional[Literal["function", "subevent"]] = None

    @field_validator("ticket_delivery_mode", mode="before")
    @classmethod
    def _coerce_delivery_mode(cls, v):
        return _normalize_ticket_delivery_mode(v)


# ── Helpers ──────────────────────────────────────────────────────────────────
PANEL_ALLOWED_STATUSES = {"pending", "approved"}
PUBLISH_ALLOWED_STATUSES = {"approved"}


def _event_iva_percent(payload, org: Optional[dict] = None) -> int:
    """IVA of the product. Free events with no money collected are 0%."""
    pricing = getattr(payload, "pricing_type", None)
    optional = bool(getattr(payload, "optional_donation_enabled", False))
    if pricing == "free" and not optional:
        return 0
    default = datil_service.default_event_iva_percent(
        pricing_type=pricing,
        optional_donation_enabled=optional,
        country_code=(org or {}).get("country_code"),
    )
    raw = getattr(payload, "iva_percent", None)
    if raw is None:
        return default
    return datil_service.normalize_iva_percent(raw, default=default)


async def _require_active_organizer(user) -> dict:
    if not is_active_organizer(user):
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
    if org.get("subscription_status") in (None, "none"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "plan_not_paid",
                "message": "Debés pagar tu plan antes de publicar eventos.",
            },
        )
    v_status = org.get("verification_fee_status") or "none"
    if v_status not in ("paid", "waived"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "verification_fee_pending",
                "message": (
                    "Debés completar el pago de verificación de cuenta "
                    "antes de publicar."
                ),
            },
        )
    if (org.get("contract_status") or "none") != "signed":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "contract_not_signed",
                "message": (
                    "Debés firmar el contrato (OneShot) antes de publicar eventos."
                ),
            },
        )
    return org


_require_approved_organizer = _require_active_organizer


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dev_env() -> bool:
    return os.environ.get("ENV", "").startswith("development")


def _empty_appeal() -> dict:
    return {"status": "none", "message": "", "files": []}


def _appeal_of(row: Event) -> dict:
    raw = row.suspension_appeal
    if not isinstance(raw, dict):
        return _empty_appeal()
    files = raw.get("files") if isinstance(raw.get("files"), list) else []
    return {
        "status": raw.get("status") or "none",
        "message": raw.get("message") or "",
        "files": files,
        "submitted_at": raw.get("submitted_at"),
        "admin_note": raw.get("admin_note") or "",
        "reviewed_at": raw.get("reviewed_at"),
    }


def _set_appeal(row: Event, data: dict) -> None:
    row.suspension_appeal = data
    flag_modified(row, "suspension_appeal")


def _restore_status_after_suspend(row: Event) -> str:
    restore = row.status_before_suspend or (
        "published" if row.published_at else "draft"
    )
    if restore == "suspended":
        restore = "published" if row.published_at else "draft"
    return restore


def _appeal_file_response(asset: EventAsset, event: Event):
    abs_path = resolve_path_under(ASSETS_DIR, asset.file_path)
    if abs_path is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    appeal = _appeal_of(event)
    filename = next(
        (
            f.get("original_filename")
            for f in appeal["files"]
            if f.get("id") == asset.id
        ),
        "evidencia",
    )
    return FileResponse(
        abs_path,
        media_type=asset.mime_type or "application/octet-stream",
        filename=str(filename),
        headers={"X-Content-Type-Options": "nosniff"},
    )


async def _pre_event_fee_breakdown(session, org: dict, event_row) -> dict:
    from orm_models import SubscriptionPlan, TicketType
    from services.event_fees import calculate_pre_event_fee
    from services.platform_settings import is_pre_event_fee_required

    plan_code = org.get("plan_code") or org.get("signup_plan_code")
    plan_row = (
        await session.scalar(
            select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code)
        )
        if plan_code
        else None
    )
    tt_rows = (
        await session.scalars(
            select(TicketType).where(TicketType.event_id == event_row.id)
        )
    ).all()
    return calculate_pre_event_fee(
        plan=row_to_dict(plan_row) if plan_row else {},
        event=row_to_dict(event_row),
        ticket_types=[row_to_dict(t) for t in tt_rows],
        platform_required=await is_pre_event_fee_required(session),
    )


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


def _publish_validation(doc: dict, *, allow_numbered: bool = True) -> None:
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
        layout = doc.get("venue_layout") or {}
        seat_only_blocked = (
            plan_layout_seating_conflict(layout.get("elements"), allow_numbered)
            == "numbered_only_blocked"
        )
        if seat_only_blocked:
            missing.append(
                "un escenario con zonas de aforo (tu plan no incluye butacas numeradas)"
            )
        pricing = doc.get("locality_pricing") or []
        if not pricing:
            if not seat_only_blocked:
                missing.append("precios por localidad (evento numerado)")
        else:
            missing_loc = [
                lp
                for lp in pricing
                if lp.get("price_cents") is None or int(lp.get("price_cents") or 0) < 0
            ]
            if missing_loc:
                missing.append("precio válido en cada localidad")
            if (
                locality_pricing_has_charge(pricing)
                and doc.get("pricing_type") == "free"
            ):
                missing.append(
                    "marcar el evento como 'Pagado' en Tipo de recaudación "
                    "(tenés localidades con costo pero el evento está como Gratuito)"
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
    service_fee_cents: int = Field(default=0, ge=0)
    admin_fee_cents: int = Field(default=0, ge=0)  # TicketSeguro
    vxs_cents: int = Field(default=0, ge=0)  # Impuestos
    wallet_fee_cents: int = Field(default=0, ge=0)  # Billetera Virtual
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
    # Escenario (mapa) is available on every plan. `numbered_seating` only
    # gates numbered localities (butacas), not linking a venue.
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event)
            .where(Event.id == event_id, Event.organizer_id == org["id"])
            .with_for_update()
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

        sold = row.tickets_sold or 0
        if sold > 0 and row.venue_id and row.venue_id != body.venue_id:
            raise HTTPException(
                409,
                f"El evento ya tiene {sold} ticket(s) vendido(s); no se puede cambiar el venue.",
            )

        same_venue = row.venue_id == body.venue_id and bool(row.venue_layout)
        if same_venue:
            # Price-only update: keep the event's edited snapshot intact.
            layout = row.venue_layout
            venue_capacity = (
                (layout or {}).get("capacity_calculated")
                or venue.get("capacity_calculated")
                or 0
            )
        else:
            layout = snapshot_from_venue(venue)
            venue_capacity = layout.get("capacity_calculated") or 0
            if sold > 0 and venue_capacity < sold:
                raise HTTPException(
                    409,
                    f"El venue tiene capacidad para {venue_capacity} pero el evento ya vendió {sold} ticket(s).",
                )
            row.source_venue_id = body.venue_id
            row.venue_layout = layout
            flag_modified(row, "venue_layout")

        needed_loc_ids = set(active_localities(layout))
        provided_loc_ids = {lp.locality_id for lp in body.locality_pricing}
        if not needed_loc_ids.issubset(provided_loc_ids):
            missing = needed_loc_ids - provided_loc_ids
            raise HTTPException(
                422,
                f"Faltan precios para las localidades: {', '.join(sorted(missing))}",
            )
        if row.pricing_type == "free" and locality_pricing_has_charge(
            body.locality_pricing
        ):
            raise HTTPException(
                422,
                "El evento es Gratuito: las localidades no pueden tener costo "
                "(precio, cargo servicio, TicketSeguro, impuestos ni billetera). "
                "Marcá el evento como 'Pagado' o dejá todos los montos en $0.",
            )

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
            raise HTTPException(
                409, "El evento ya tiene tickets vendidos; no se puede desvincular."
            )
        row.venue_id = None
        row.venue_slug = None
        row.source_venue_id = None
        row.venue_layout = None
        row.locality_pricing = []
        row.updated_at = _now()
        flag_modified(row, "locality_pricing")
        flag_modified(row, "venue_layout")
        await session.commit()
    return {"ok": True}


class VenueLayoutBody(BaseModel):
    canvas: Dict[str, Any] = Field(default_factory=dict)
    elements: List[Dict[str, Any]] = Field(default_factory=list)
    localities: List[Dict[str, Any]] = Field(default_factory=list)


@router.get("/{event_id}/venue-layout")
async def get_event_venue_layout(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(404, "Evento no encontrado")
        if not row.venue_layout:
            raise HTTPException(404, "Este evento no tiene mapa vinculado")
        sold = int(row.tickets_sold or 0)
        return {
            "event_id": row.id,
            "venue_id": row.venue_id,
            "source_venue_id": row.source_venue_id or row.venue_id,
            "venue_name": row.venue_name,
            "venue_slug": row.venue_slug,
            "canvas": (row.venue_layout or {}).get("canvas") or {},
            "elements": (row.venue_layout or {}).get("elements") or [],
            "localities": (row.venue_layout or {}).get("localities") or [],
            "capacity_calculated": (row.venue_layout or {}).get("capacity_calculated")
            or 0,
            "snapshotted_at": (row.venue_layout or {}).get("snapshotted_at"),
            "lock_status": {
                "locked": sold > 0,
                "tickets_sold": sold,
                "reason": (
                    f"Hay {sold} ticket(s) vendido(s); no se pueden cambiar elementos estructurales."
                    if sold > 0
                    else None
                ),
            },
        }


@router.put("/{event_id}/venue-layout")
async def put_event_venue_layout(
    event_id: str,
    body: VenueLayoutBody,
    user=Depends(get_current_user),
):
    """Update the event-scoped venue snapshot. Structural diffs blocked when sold > 0."""
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event)
            .where(Event.id == event_id, Event.organizer_id == org["id"])
            .with_for_update()
        )
        if not row:
            raise HTTPException(404, "Evento no encontrado")
        if not row.venue_id:
            raise HTTPException(
                409, "Vinculá un venue al evento antes de editar el mapa."
            )
        old = row.venue_layout or {}
        if not old:
            raise HTTPException(
                404, "Este evento no tiene mapa; vinculá un venue primero."
            )

        localities = normalize_layout_localities(body.localities)
        feats = await get_plan_features_async(session, org.get("plan_code"))
        if not feats.get("numbered_seating") and any(
            loc.get("seating_type") == "numbered" for loc in localities
        ):
            raise HTTPException(
                403,
                "Tu plan no incluye localidades numeradas. Usá zonas de aforo o mejorá el plan.",
            )

        sold = int(row.tickets_sold or 0)
        if sold > 0:
            if structural_diff(
                old.get("elements") or [], body.elements
            ) or locality_structural_diff(old.get("localities") or [], localities):
                raise HTTPException(
                    409,
                    f"Hay {sold} ticket(s) vendido(s); no se pueden cambiar elementos estructurales del mapa.",
                )

        layout = {
            **old,
            "canvas": body.canvas or {},
            "elements": body.elements or [],
            "localities": localities,
            "source_venue_id": row.source_venue_id or row.venue_id,
        }
        capacity = recalc_layout_capacity(layout)
        row.venue_layout = layout
        row.capacity = capacity
        row.updated_at = _now()
        flag_modified(row, "venue_layout")

        # Keep locality_pricing in sync with the localities that still exist
        # (seed new ones with fees 0; drop only localities that were deleted).
        # Note: a locality keeps its pricing even before it's assigned to any
        # element on the map — the "Localidades" tab lets organizers price a
        # locality before running "Asignar en Mapa".
        existing_pricing = {
            lp.get("locality_id"): lp
            for lp in (row.locality_pricing or [])
            if lp.get("locality_id")
        }
        new_pricing = []
        for loc in localities:
            lid = loc.get("id")
            if not lid:
                continue
            prev = existing_pricing.get(lid) or {}
            seed_price = int(
                prev.get("price_cents")
                if prev.get("price_cents") is not None
                else loc.get("default_price_cents") or 0
            )
            entry = {
                "locality_id": lid,
                "price_cents": seed_price,
                "service_fee_cents": int(prev.get("service_fee_cents") or 0),
                "admin_fee_cents": int(prev.get("admin_fee_cents") or 0),
                "vxs_cents": int(prev.get("vxs_cents") or 0),
                "wallet_fee_cents": int(prev.get("wallet_fee_cents") or 0),
                "max_tickets_per_purchase": prev.get("max_tickets_per_purchase"),
            }
            if row.pricing_type == "free":
                # Free events can't have localities that charge the buyer
                # (TI-121): a new locality's default_price_cents is a
                # template value, and a carried-over fee could predate this
                # fix — clamp instead of rejecting so unrelated map edits
                # aren't blocked.
                entry.update({f: 0 for f in LOCALITY_CHARGE_FIELDS})
            new_pricing.append(entry)
        row.locality_pricing = new_pricing
        flag_modified(row, "locality_pricing")
        await session.commit()
        return {
            "event_id": row.id,
            "venue_id": row.venue_id,
            "source_venue_id": row.source_venue_id or row.venue_id,
            "canvas": layout.get("canvas") or {},
            "elements": layout.get("elements") or [],
            "localities": layout.get("localities") or [],
            "capacity_calculated": capacity,
            "locality_pricing": new_pricing,
            "lock_status": {
                "locked": sold > 0,
                "tickets_sold": sold,
            },
        }


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
        total = (
            await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        )
        result = await session.execute(
            stmt.order_by(Event.priority.desc(), Event.starts_at.asc())
            .offset((page - 1) * limit)
            .limit(limit)
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


@router.get("/{event_id}/discounts/report")
async def get_discounts_report(event_id: str, user=Depends(get_current_user)):
    """Per-rule conversion stats — uses_count plus what it actually drove:
    number of paid orders, total discount granted, total revenue attributed.
    Reads `TicketOrder.discounts_applied` (set at order creation time)."""
    org = await _require_active_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        event = row_to_dict(row)
        orders_result = await session.execute(
            select(TicketOrder.discounts_applied, TicketOrder.total_cents).where(
                TicketOrder.event_id == event_id,
                TicketOrder.status == "paid",
            )
        )
        orders = orders_result.all()

    stats: Dict[str, Dict[str, int]] = {}
    for discounts_applied, total_cents in orders:
        for d in discounts_applied or []:
            rule_id = d.get("rule_id")
            if not rule_id:
                continue
            s = stats.setdefault(
                rule_id,
                {
                    "orders_count": 0,
                    "total_discount_cents": 0,
                    "total_revenue_cents": 0,
                },
            )
            s["orders_count"] += 1
            s["total_discount_cents"] += int(d.get("amount_cents") or 0)
            s["total_revenue_cents"] += int(total_cents or 0)

    rules = (event.get("discounts") or {}).get("rules") or []
    report = []
    for r in rules:
        s = stats.get(
            r["id"],
            {"orders_count": 0, "total_discount_cents": 0, "total_revenue_cents": 0},
        )
        report.append(
            {
                "rule_id": r["id"],
                "name": r["name"],
                "type": r["type"],
                "code": r.get("code"),
                "influencer_name": r.get("influencer_name"),
                "channel": r.get("channel"),
                "enabled": r.get("enabled"),
                "max_uses": r.get("max_uses"),
                "uses_count": r.get("uses_count") or 0,
                **s,
            }
        )
    return {"rules": report}


async def _assert_access_type_allowed(
    session, plan_code: Optional[str], access_type: Optional[str]
) -> None:
    if access_type == "verified_list":
        await assert_feature_async(session, plan_code, "verified_lists")
    elif access_type == "access_code":
        await assert_feature_async(session, plan_code, "access_codes")


async def _assert_pricing_type_allowed(
    session, plan_code: Optional[str], pricing_type: Optional[str]
) -> None:
    """PRD §4.2.1 — Gratuito / Pagado / Por Donación gated by plan flags."""
    if not pricing_type:
        return
    from services.plan_features import get_plan_features_async

    features = await get_plan_features_async(session, plan_code)
    if pricing_type == "free":
        if not features.get("allows_free_events", True):
            raise HTTPException(
                403,
                "Tu plan no permite eventos gratuitos. Mejorá tu plan o elegí Pagado / Por Donación.",
            )
    elif pricing_type in ("paid", "donation"):
        if not features.get("allows_paid_events", True):
            raise HTTPException(
                403,
                "Tu plan no permite eventos con cobro (Pagado o Por Donación). Mejorá tu plan.",
            )


async def _assert_discounts_allowed(
    session, plan_code: Optional[str], discounts: Optional[EventDiscounts]
) -> None:
    """PRD §4.2.7 — gate legacy toggles + rules by plan feature flags."""
    if not discounts:
        return
    from services.plan_features import assert_feature_async

    if (discounts.disability_law or {}).get("enabled"):
        await assert_feature_async(session, plan_code, "disability_discount")
    if (discounts.senior_law or {}).get("enabled"):
        await assert_feature_async(session, plan_code, "senior_discount")
    if (discounts.presale or {}).get("enabled"):
        await assert_feature_async(session, plan_code, "presale_discount")
    rules = discounts.rules or []
    if any(r.type == "promo_code" for r in rules):
        await assert_feature_async(session, plan_code, "promo_codes")
    if any(r.type in ("auto", "quantity", "buy_n_get_m") for r in rules):
        await assert_feature_async(session, plan_code, "advanced_discounts")


async def _active_catalog_codes(session) -> set[str]:
    from orm_models import PaymentMethodCatalog

    rows = (
        (
            await session.execute(
                select(PaymentMethodCatalog.code).where(
                    PaymentMethodCatalog.is_active.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def _normalize_payment_methods_or_400(
    session, pm: Optional[PaymentMethodConfig]
) -> dict:
    from services.payment_methods import (
        default_payment_methods,
        normalize_payment_methods,
    )

    allowed = await _active_catalog_codes(session)
    raw = pm.model_dump() if pm is not None else default_payment_methods()
    try:
        return normalize_payment_methods(raw, allowed_codes=allowed or None)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("", status_code=201)
async def create_my_event(payload: EventCreate, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        if payload.access_params:
            await _assert_access_type_allowed(
                session,
                org.get("plan_code"),
                payload.access_params.access_type,
            )
        await _assert_pricing_type_allowed(
            session,
            org.get("plan_code"),
            payload.pricing_type,
        )
        if payload.discounts is not None:
            await _assert_discounts_allowed(
                session,
                org.get("plan_code"),
                payload.discounts,
            )
        slug = await _next_event_slug(org["id"], normalize_slug(payload.title), session)
        payment_methods = await _normalize_payment_methods_or_400(
            session, payload.payment_methods
        )

        # Duplicate check: same (starts_at, venue_name) in same organizer.
        # Only runs once the draft has a date (NULL starts_at can't collide).
        if payload.venue_name and payload.starts_at:
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
            priority=payload.priority,
            video_url=payload.video_url,
            keywords=list(payload.keywords or []),
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
            visibility=(
                "public"
                if payload.visibility == "public_blocked"
                else payload.visibility
            ),
            raffle_enabled=payload.raffle_enabled,
            optional_donation_enabled=(
                bool(payload.optional_donation_enabled)
                if payload.pricing_type == "free"
                else False
            ),
            ticket_fees=(
                payload.ticket_fees
                if payload.pricing_type == "paid" and payload.ticket_fees
                else {}
            ),
            iva_percent=_event_iva_percent(payload, org),
            platform_fee_bearer=payload.platform_fee_bearer or "buyer",
            custom_questions=[q.model_dump() for q in payload.custom_questions],
            multi_function_mode=payload.multi_function_mode,
            payment_methods=payment_methods,
            discounts=(
                payload.discounts.model_dump(mode="json", exclude_none=False)
                if payload.discounts
                else EventDiscounts().model_dump(mode="json")
            ),
            access_params=(
                payload.access_params.model_dump()
                if payload.access_params
                else EventAccessParams().model_dump()
            ),
            content=(
                payload.content.model_dump()
                if payload.content
                else EventContent().model_dump()
            ),
            poster_url=None,
            banner_url=None,
            small_url=None,
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


_JSONB_FIELDS = {
    "payment_methods",
    "discounts",
    "access_params",
    "content",
    "custom_questions",
    "ticket_design",
    "courtesy_ticket_design",
    "ticket_fees",
}


@router.put("/{event_id}")
async def update_my_event(
    event_id: str, payload: EventUpdate, user=Depends(get_current_user)
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event)
            .where(Event.id == event_id, Event.organizer_id == org["id"])
            .with_for_update()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        diff = {
            k: v
            for k, v in payload.model_dump(exclude_unset=True).items()
            if v is not None
        }
        if "iva_percent" in diff:
            diff["iva_percent"] = datil_service.normalize_iva_percent(
                diff["iva_percent"]
            )
        pricing = diff.get("pricing_type", row.pricing_type)
        optional = diff.get(
            "optional_donation_enabled", row.optional_donation_enabled
        )
        if pricing == "free" and not optional:
            diff["iva_percent"] = 0

        # Re-dump nested JSONB fields to preserve all values (e.g. None inside rules).
        if "discounts" in diff and payload.discounts is not None:
            diff["discounts"] = payload.discounts.model_dump(
                mode="json", exclude_none=False
            )
            await _assert_discounts_allowed(
                session,
                org.get("plan_code"),
                payload.discounts,
            )
        if "payment_methods" in diff and payload.payment_methods is not None:
            diff["payment_methods"] = await _normalize_payment_methods_or_400(
                session, payload.payment_methods
            )
        if "access_params" in diff and payload.access_params is not None:
            diff["access_params"] = payload.access_params.model_dump()
            await _assert_access_type_allowed(
                session,
                org.get("plan_code"),
                payload.access_params.access_type,
            )
        if "pricing_type" in diff:
            await _assert_pricing_type_allowed(
                session,
                org.get("plan_code"),
                diff["pricing_type"],
            )
            if diff["pricing_type"] == "free" and locality_pricing_has_charge(
                row.locality_pricing or []
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "No se puede marcar el evento como Gratuito: ya tenés "
                        "localidades con costo (precio o fees). Poné todos los "
                        "montos en $0 primero."
                    ),
                )
        if diff.get("visibility") == "public_blocked":
            diff["visibility"] = "public"
        if "content" in diff and payload.content is not None:
            diff["content"] = payload.content.model_dump()
        if "custom_questions" in diff and payload.custom_questions is not None:
            diff["custom_questions"] = [
                q.model_dump() for q in payload.custom_questions
            ]
        if "ticket_design" in diff and payload.ticket_design is not None:
            diff["ticket_design"] = payload.ticket_design.model_dump()
        if (
            "courtesy_ticket_design" in diff
            and payload.courtesy_ticket_design is not None
        ):
            diff["courtesy_ticket_design"] = payload.courtesy_ticket_design.model_dump()

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
            raise HTTPException(
                status_code=422, detail="ends_at must be after starts_at"
            )

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
        if row.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "event_suspended",
                    "message": (
                        "Este evento está suspendido por Ticket Yourself. "
                        "No se puede publicar hasta que el super admin lo reactive."
                    ),
                },
            )
        feats = await get_plan_features_async(session, org.get("plan_code"))
        _publish_validation(
            row_to_dict(row),
            allow_numbered=bool(feats.get("numbered_seating")),
        )

        # Pre-event platform fee (configurable per plan)
        breakdown = await _pre_event_fee_breakdown(session, org, row)
        fee_status = row.pre_event_fee_status or "none"
        if breakdown["enabled"] and breakdown["fee_cents"] > 0:
            if fee_status not in ("paid", "waived"):
                row.pre_event_fee_cents = breakdown["fee_cents"]
                row.pre_event_fee_status = "pending"
                row.pre_event_fee_breakdown = breakdown
                await session.commit()
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "pre_event_fee_required",
                        "message": (
                            "Debés pagar el cargo de plataforma del evento "
                            "antes de publicarlo."
                        ),
                        "fee_cents": breakdown["fee_cents"],
                        "breakdown": breakdown,
                        "simulate_allowed": _dev_env(),
                    },
                )
        else:
            row.pre_event_fee_cents = 0
            row.pre_event_fee_status = "waived"
            row.pre_event_fee_breakdown = breakdown

        now = _now()
        row.status = "published"
        row.published_at = now
        row.updated_at = now
        await session.commit()
    return {"ok": True, "status": "published"}


@router.get("/{event_id}/pre-event-fee")
async def get_pre_event_fee(event_id: str, user=Depends(get_current_user)):
    org = await _require_active_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        breakdown = await _pre_event_fee_breakdown(session, org, row)
        return {
            **breakdown,
            "current_status": row.pre_event_fee_status,
            "paid_at": row.pre_event_fee_paid_at,
            "simulate_allowed": _dev_env(),
        }


@router.post("/{event_id}/pay-pre-event-fee")
async def pay_pre_event_fee(
    event_id: str,
    payload: dict | None = None,
    user=Depends(get_current_user),
):
    """
    Start or confirm the pre-event platform fee payment.

    payment_method: simulate | stripe | nuvei | deuna
    - simulate / stripe in development: marks paid immediately
    - nuvei / deuna: opens gateway checkout when configured; otherwise pending
      for admin confirmation (or paid immediately in development)
    """
    org = await _require_active_organizer(user)
    payment_method = (payload or {}).get("payment_method") or (
        "simulate" if _dev_env() else "stripe"
    )
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        from services.event_fees import fee_session_id, mark_pre_event_fee_paid

        breakdown = await _pre_event_fee_breakdown(session, org, row)
        if (row.pre_event_fee_status or "") == "paid":
            return {
                "ok": True,
                "status": "paid",
                "fee_cents": row.pre_event_fee_cents or breakdown["fee_cents"],
                "breakdown": row.pre_event_fee_breakdown or breakdown,
            }

        row.pre_event_fee_cents = breakdown["fee_cents"]
        row.pre_event_fee_breakdown = breakdown
        if breakdown["fee_cents"] <= 0 or not breakdown["enabled"]:
            row.pre_event_fee_status = "waived"
            await session.commit()
            return {
                "ok": True,
                "status": "waived",
                "fee_cents": 0,
                "breakdown": breakdown,
            }

        instant_pay = payment_method == "simulate" or (
            payment_method == "stripe" and _dev_env()
        )
        if instant_pay:
            mark_pre_event_fee_paid(row, payment_method=payment_method)
            await session.commit()
            return {
                "ok": True,
                "status": "paid",
                "fee_cents": breakdown["fee_cents"],
                "payment_method": payment_method,
                "breakdown": breakdown,
            }

        if payment_method == "stripe":
            # Production Stripe Checkout for this fee is not wired yet; the
            # previous stub marked paid. Keep that until a dedicated session
            # exists, so organizers are not blocked.
            mark_pre_event_fee_paid(row, payment_method="stripe")
            await session.commit()
            return {
                "ok": True,
                "status": "paid",
                "fee_cents": breakdown["fee_cents"],
                "payment_method": "stripe",
                "breakdown": breakdown,
            }

        session_id = fee_session_id(event_id)
        stored = {
            **breakdown,
            "session_id": session_id,
            "payment_method": payment_method,
        }

        if payment_method == "nuvei":
            from services import nuvei_service

            if not nuvei_service.is_configured():
                if _dev_env():
                    mark_pre_event_fee_paid(row, payment_method="simulate")
                    await session.commit()
                    return {
                        "ok": True,
                        "status": "paid",
                        "fee_cents": breakdown["fee_cents"],
                        "payment_method": "simulate",
                        "breakdown": breakdown,
                    }
                row.pre_event_fee_status = "pending"
                row.pre_event_fee_breakdown = stored
                flag_modified(row, "pre_event_fee_breakdown")
                await session.commit()
                return {
                    "ok": True,
                    "status": "pending_gateway",
                    "fee_cents": breakdown["fee_cents"],
                    "payment_method": "nuvei",
                    "breakdown": stored,
                    "message": (
                        "Nuvei aún no está configurado. Registramos tu solicitud; "
                        "el equipo TYS confirmará el cobro."
                    ),
                }
            try:
                nuvei = nuvei_service.open_order(
                    amount_cents=breakdown["fee_cents"],
                    currency="USD",
                    client_unique_id=session_id,
                    user_token_id=org["id"],
                    email=user.get("email"),
                    first_name=(org.get("company_name") or "Organizer")[:30],
                    last_name="TYS",
                    custom_data=f"pre_event_fee:{event_id}",
                )
            except nuvei_service.NuveiError as e:
                logger.error("Nuvei pre-event fee init failed: %s", type(e).__name__)
                raise HTTPException(
                    502,
                    "No pudimos iniciar el pago con Nuvei. Intentá de nuevo en unos minutos.",
                ) from e
            row.pre_event_fee_status = "pending"
            row.pre_event_fee_breakdown = stored
            flag_modified(row, "pre_event_fee_breakdown")
            await session.commit()
            return {
                "ok": True,
                "status": "nuvei_checkout",
                "fee_cents": breakdown["fee_cents"],
                "payment_method": "nuvei",
                "breakdown": stored,
                "reference": nuvei.get("reference"),
                "session_token": nuvei.get("reference") or nuvei.get("session_token"),
                "checkout_mode": nuvei.get("checkout_mode"),
                "nuvei_env": nuvei.get("env"),
                "checkout_js_url": nuvei.get("checkout_js_url"),
                "checkout_url": nuvei.get("checkout_url"),
                "client_app_code": nuvei.get("client_app_code"),
                "client_app_key": nuvei.get("client_app_key"),
                "client_unique_id": session_id,
                "amount": nuvei.get("amount"),
                "currency": nuvei.get("currency"),
                "user_id": nuvei.get("user_id"),
                "user_email": nuvei.get("user_email"),
                "user_phone": nuvei.get("user_phone"),
                "order_description": nuvei.get("order_description"),
                "order_vat": nuvei.get("order_vat"),
                "order_installments_type": nuvei.get("order_installments_type"),
                "message": "Completá el cargo de plataforma con Nuvei.",
            }

        if payment_method == "deuna":
            from services import deuna_service

            if not deuna_service.is_configured():
                if _dev_env():
                    mark_pre_event_fee_paid(row, payment_method="simulate")
                    await session.commit()
                    return {
                        "ok": True,
                        "status": "paid",
                        "fee_cents": breakdown["fee_cents"],
                        "payment_method": "simulate",
                        "breakdown": breakdown,
                    }
                row.pre_event_fee_status = "pending"
                row.pre_event_fee_breakdown = stored
                flag_modified(row, "pre_event_fee_breakdown")
                await session.commit()
                return {
                    "ok": True,
                    "status": "pending_gateway",
                    "fee_cents": breakdown["fee_cents"],
                    "payment_method": "deuna",
                    "breakdown": stored,
                    "message": (
                        "DEUNA aún no está configurado. Registramos tu solicitud; "
                        "el equipo TYS confirmará el cobro."
                    ),
                }
            try:
                first_name, last_name = deuna_service.split_buyer_name(
                    org.get("company_name") or user.get("email") or "Organizer"
                )
                deuna = deuna_service.create_order(
                    order_id=session_id,
                    amount_cents=breakdown["fee_cents"],
                    currency="USD",
                    item_name="Cargo de plataforma TYS",
                    item_description=row.title or event_id,
                    email=user.get("email") or "",
                    first_name=first_name,
                    last_name=last_name,
                    metadata={
                        "tys_purpose": "pre_event_fee",
                        "event_id": event_id,
                        "organizer_id": org["id"],
                    },
                )
            except deuna_service.DeunaError as e:
                logger.error(
                    "DEUNA pre-event fee create_order failed: %s", type(e).__name__
                )
                raise HTTPException(
                    502,
                    "No pudimos iniciar el pago con DEUNA. Intentá de nuevo en unos minutos.",
                ) from e
            stored["session_id"] = deuna.get("order_id") or session_id
            row.pre_event_fee_status = "pending"
            row.pre_event_fee_breakdown = stored
            flag_modified(row, "pre_event_fee_breakdown")
            await session.commit()
            return {
                "ok": True,
                "status": "deuna_checkout",
                "fee_cents": breakdown["fee_cents"],
                "payment_method": "deuna",
                "breakdown": stored,
                "order_token": deuna.get("order_token"),
                "public_api_key": deuna.get("public_api_key"),
                "deuna_env": deuna.get("env"),
                "checkout_js_url": deuna.get("checkout_js_url"),
                "client_unique_id": stored["session_id"],
                "message": "Completá el cargo de plataforma con DEUNA.",
            }

        raise HTTPException(400, f"Unsupported payment_method: {payment_method}")


@router.post("/{event_id}/unpublish")
async def unpublish_event(event_id: str, user=Depends(get_current_user)):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "event_suspended",
                    "message": (
                        "Este evento está suspendido por Ticket Yourself. "
                        "No se puede despublicar ni republicar hasta reactivarlo."
                    ),
                },
            )
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
        row.status_before_suspend = None
        row.suspended_at = None
        row.suspended_reason = None
        row.updated_at = _now()
        await session.commit()
    return {"ok": True, "status": "cancelled"}


def _unlink_asset_file(file_path: str | None) -> None:
    """Best-effort delete of one relative path under ASSETS_DIR."""
    if not file_path:
        return
    abs_path = resolve_path_under(ASSETS_DIR, file_path)
    if abs_path and abs_path.exists():
        try:
            abs_path.unlink()
        except OSError:
            logger.warning("Could not delete appeal file %s", file_path)


def _finalize_appeal_disk(
    *, committed: bool, written: List[str], obsolete: List[str]
) -> None:
    """Keep disk in sync with the DB transaction outcome.

    New files are written before commit; old files stay on disk until commit
    succeeds. A rollback must drop the new files and leave the old ones.
    """
    if committed:
        for rel in obsolete:
            _unlink_asset_file(rel)
        return
    for rel in written:
        _unlink_asset_file(rel)


def _write_appeal_bytes(abs_path: Path, content: bytes) -> None:
    """Write bytes under ASSETS_DIR; remove a partial file if the OS write fails."""
    base = os.path.realpath(ASSETS_DIR) + os.sep
    resolved = os.path.realpath(abs_path)
    if not resolved.startswith(base):
        raise HTTPException(status_code=403, detail="Forbidden")
    abs_path = Path(resolved)
    try:
        abs_path.write_bytes(content)
    except OSError:
        try:
            if abs_path.exists():
                abs_path.unlink()
        except OSError:
            logger.warning("Could not remove partial appeal file %s", abs_path)
        raise HTTPException(
            status_code=500,
            detail="No se pudo guardar el archivo de evidencia",
        ) from None


async def _pop_appeal_asset_rows(session, event_id: str) -> List[str]:
    """Delete appeal EventAsset rows. Return relative paths to unlink after commit."""
    rows = (
        (
            await session.execute(
                select(EventAsset).where(
                    EventAsset.event_id == event_id, EventAsset.kind == "appeal"
                )
            )
        )
        .scalars()
        .all()
    )
    paths: List[str] = []
    for asset in rows:
        if asset.file_path:
            paths.append(asset.file_path)
        await session.delete(asset)
    return paths


async def _store_appeal_file(
    event_id: str, organizer_id: str, file: UploadFile
) -> dict:
    if file.content_type not in ALLOWED_APPEAL_MIME:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Tipo no permitido: {file.content_type or 'desconocido'}. "
                "Aceptados: PDF, JPEG, PNG, WEBP."
            ),
        )
    content = await file.read()
    if len(content) > MAX_APPEAL_BYTES:
        raise HTTPException(status_code=413, detail="Archivo supera los 10MB")
    asset_id = str(uuid.uuid4())
    ext = mimetypes.guess_extension(file.content_type) or ".bin"
    if file.content_type == "application/pdf":
        ext = ".pdf"
    rel_path = f"{organizer_id}/{event_id}/appeal_{asset_id}{ext}"
    abs_path = resolve_path_under(ASSETS_DIR, rel_path)
    if abs_path is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    base = os.path.realpath(ASSETS_DIR) + os.sep
    resolved = os.path.realpath(abs_path)
    if not resolved.startswith(base):
        raise HTTPException(status_code=403, detail="Forbidden")
    abs_path = Path(resolved)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    _write_appeal_bytes(abs_path, content)
    return {
        "id": asset_id,
        "file_path": rel_path,
        "mime_type": file.content_type,
        "size_bytes": len(content),
        "original_filename": (file.filename or "archivo").replace("/", "_")[:120],
    }


@router.post("/{event_id}/suspension-appeal")
async def submit_suspension_appeal(
    event_id: str,
    message: str = Form(..., min_length=10, max_length=2000),
    files: Optional[List[UploadFile]] = File(default=None),
    user=Depends(get_current_user),
):
    """Organizer rebuttal: explain a mistake / attach evidence while suspended."""
    org = await _require_approved_organizer(user)
    if files is None:
        uploads: List[UploadFile] = []
    elif isinstance(files, list):
        uploads = files
    else:
        uploads = [files]
    if len(uploads) > MAX_APPEAL_FILES:
        raise HTTPException(
            status_code=422, detail=f"Máximo {MAX_APPEAL_FILES} archivos"
        )
    stored_meta: List[dict] = []
    written_rel_paths: List[str] = []
    obsolete_rel_paths: List[str] = []
    appeal: dict = _empty_appeal()
    committed = False
    try:
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(Event).where(
                    Event.id == event_id, Event.organizer_id == org["id"]
                )
            )
            if not row:
                raise HTTPException(status_code=404, detail="Event not found")
            if row.status != "suspended":
                raise HTTPException(
                    status_code=409,
                    detail="Sólo se puede apelar un evento suspendido",
                )
            # Drop old DB rows now; leave their files on disk until commit.
            obsolete_rel_paths = await _pop_appeal_asset_rows(session, event_id)
            for up in uploads:
                if not up.filename:
                    continue
                meta = await _store_appeal_file(event_id, org["id"], up)
                written_rel_paths.append(meta["file_path"])
                session.add(
                    EventAsset(
                        id=meta["id"],
                        event_id=event_id,
                        organizer_id=org["id"],
                        kind="appeal",
                        file_path=meta["file_path"],
                        mime_type=meta["mime_type"],
                        size_bytes=meta["size_bytes"],
                        uploaded_at=_now(),
                    )
                )
                stored_meta.append(
                    {
                        "id": meta["id"],
                        "original_filename": meta["original_filename"],
                        "mime_type": meta["mime_type"],
                        "size_bytes": meta["size_bytes"],
                    }
                )
            appeal = {
                "status": "pending",
                "message": message.strip(),
                "files": stored_meta,
                "submitted_at": _now().isoformat(),
                "admin_note": "",
                "reviewed_at": None,
            }
            _set_appeal(row, appeal)
            row.updated_at = _now()
            session.add(
                AuditLog(
                    id=str(uuid.uuid4()),
                    actor_user_id=user["id"],
                    action="event.suspension_appealed",
                    target_type="event",
                    target_id=event_id,
                    metadata_={"files": len(stored_meta)},
                    created_at=_now(),
                )
            )
            await session.commit()
            committed = True
    finally:
        _finalize_appeal_disk(
            committed=committed,
            written=written_rel_paths,
            obsolete=obsolete_rel_paths,
        )
    return {"ok": True, "suspension_appeal": appeal}


@router.get("/{event_id}/suspension-appeal/files/{asset_id}")
async def download_my_appeal_file(
    event_id: str,
    asset_id: str,
    user=Depends(get_current_user),
):
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        asset = await session.scalar(
            select(EventAsset).where(
                EventAsset.id == asset_id,
                EventAsset.event_id == event_id,
                EventAsset.kind == "appeal",
            )
        )
    if not asset:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return _appeal_file_response(asset, row)


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
        # A handful of child tables don't have ON DELETE CASCADE on their
        # event_id FK (ticket_types/event_functions/season_passes/etc. do and
        # need no help here). A draft normally has none of these, but media
        # uploads (EventAsset) or a leftover seat-picker preview can exist —
        # clean them up explicitly instead of letting the DELETE 500.
        await session.execute(delete(TicketScan).where(TicketScan.event_id == event_id))
        await session.execute(
            delete(EventSeatAssignment).where(EventSeatAssignment.event_id == event_id)
        )
        await session.execute(delete(SeatHold).where(SeatHold.event_id == event_id))
        await session.execute(
            delete(EventCapacityReservation).where(
                EventCapacityReservation.event_id == event_id
            )
        )
        await session.execute(delete(Ticket).where(Ticket.event_id == event_id))
        await session.execute(
            delete(TicketOrder).where(TicketOrder.event_id == event_id)
        )
        await session.execute(
            delete(StaffEventAssignment).where(
                StaffEventAssignment.event_id == event_id
            )
        )
        await session.execute(
            delete(SeasonPassPurchase).where(SeasonPassPurchase.event_id == event_id)
        )
        await session.execute(delete(EventAsset).where(EventAsset.event_id == event_id))
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
    if file.size and file.size > MAX_IMG_BYTES:
        raise HTTPException(status_code=413, detail="Archivo supera los 5MB")
    content = await file.read()
    if len(content) > MAX_IMG_BYTES:
        raise HTTPException(status_code=413, detail="Archivo supera los 5MB")

    asset_id = str(uuid.uuid4())
    ext = mimetypes.guess_extension(file.content_type) or ".bin"
    rel_path = f"{organizer_id}/{event_id}/{kind}_{asset_id}{ext}"
    abs_path = resolve_path_under(ASSETS_DIR, rel_path)
    if abs_path is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    base = os.path.realpath(ASSETS_DIR) + os.sep
    resolved = os.path.realpath(abs_path)
    if not resolved.startswith(base):
        raise HTTPException(status_code=403, detail="Forbidden")
    abs_path = Path(resolved)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)

    async with AsyncSessionLocal() as _pg_asset:
        _pg_asset.add(
            EventAsset(
                id=asset_id,
                event_id=event_id,
                organizer_id=organizer_id,
                kind=kind,
                file_path=rel_path,
                mime_type=file.content_type,
                size_bytes=len(content),
                uploaded_at=datetime.now(timezone.utc),
            )
        )
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


@router.post("/{event_id}/small")
async def upload_small(
    event_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Pequeña — thumbnail used in compact listings / QR side."""
    org = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        url = await _store_event_image(event_id, org["id"], file, "small")
        row.small_url = url
        row.updated_at = _now()
        await session.commit()
    return {"small_url": url}


# ── M4 — diseñador visual de tickets: assets (fondo / logo) ─────────────────
def _ticket_asset_kind(slot: str, role: str) -> str:
    """EventAsset.kind must fit VARCHAR(20) until the widen-to-40 migration runs.

    ``ticket_main_background`` is 22 chars and was rejected by Postgres, which
    surfaced in the UI as the generic "No se pudo subir la imagen".
    """
    slot_key = "c" if slot == "courtesy" else "m"
    role_key = "bg" if role == "background" else "lg"
    return f"td_{slot_key}_{role_key}"


@router.post("/{event_id}/ticket-design/asset")
async def upload_ticket_design_asset(
    event_id: str,
    slot: Literal["main", "courtesy"] = Query(default="main"),
    role: Literal["background", "logo"] = Query(default="background"),
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
    url = await _store_event_image(
        event_id, org["id"], file, _ticket_asset_kind(slot, role)
    )
    return {"url": url}


@router.get("/{event_id}/ticket-design/preview.pdf")
async def preview_ticket_design(
    event_id: str,
    slot: Literal["main", "courtesy"] = Query(default="main"),
    user=Depends(get_current_user),
):
    """Renders a sample ticket PDF with placeholder data so the organizer can
    see exactly what the real PDF (fonts, image scaling) will look like —
    the canvas in the designer is an editing surface, not the renderer."""
    org = await _require_active_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Event).where(Event.id == event_id, Event.organizer_id == org["id"])
        )
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        event = row_to_dict(row)

    design = (
        event.get("courtesy_ticket_design") if slot == "courtesy" else None
    ) or event.get("ticket_design")
    if not design or not design.get("elements"):
        raise HTTPException(422, "Todavía no hay un diseño configurado.")

    sample_order = {
        "order_number": "TYS-000000",
        "donation_amount_cents": 1500,
    }
    sample_ticket = {
        "id": str(uuid.uuid4()),
        "holder": {"name": "Asistente de Prueba", "email": "asistente@ejemplo.com"},
        "qr_token": "PREVIEW-SAMPLE-TOKEN",
        "seat_label": "A-12" if event.get("venue_id") else None,
        "raffle_number": "000123" if event.get("raffle_enabled") else None,
        "issued_at": _now().isoformat(),
    }
    from services.pdf_service import render_ticket_pdf_from_design

    pdf_bytes = await render_ticket_pdf_from_design(
        design=design,
        event=event,
        order=sample_order,
        ticket=sample_ticket,
        organizer=org,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
    )


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
    if _asset_row.kind == "appeal":
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = resolve_path_under(ASSETS_DIR, _asset_row.file_path)
    if abs_path is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        abs_path,
        media_type=_asset_row.mime_type or "application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Public endpoints ────────────────────────────────────────────────────────

_TRGM_AVAILABLE: bool | None = None  # cached after first DB probe


async def _trgm_available(pg) -> bool:
    global _TRGM_AVAILABLE
    if _TRGM_AVAILABLE is not None:
        return _TRGM_AVAILABLE
    try:
        await pg.execute(text("SELECT similarity('a','a')"))
        _TRGM_AVAILABLE = True
    except Exception:
        # A failed statement leaves the session's transaction aborted — without
        # rolling back, the next query on this same session (the ILIKE fallback)
        # would also fail instead of gracefully degrading.
        await pg.rollback()
        _TRGM_AVAILABLE = False
    return _TRGM_AVAILABLE


@public_router.get("")
async def list_public_events(
    tenant_slug: str = Query(...),
    search: Optional[str] = Query(default=None, max_length=120),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    async with AsyncSessionLocal() as pg:
        org_id_row = (
            await pg.execute(select(Organizer.id).where(Organizer.slug == tenant_slug))
        ).first()
        tenant_row = (
            await pg.execute(select(Tenant.status).where(Tenant.slug == tenant_slug))
        ).first()
    if not org_id_row:
        return {"items": [], "total": 0}
    if not tenant_row or tenant_row[0] != "active":
        return {"items": [], "total": 0}
    org_id = org_id_row[0]
    async with AsyncSessionLocal() as pg:
        stmt = select(Event).where(
            Event.organizer_id == org_id,
            Event.status == "published",
            Event.visibility.in_(list(LISTABLE_VISIBILITIES)),
        )
        q = (search or "").strip()
        if q:
            use_trgm = await _trgm_available(pg)
            if use_trgm:
                stmt = stmt.where(
                    or_(
                        func.similarity(Event.title, q) > 0.15,
                        Event.title.ilike(f"%{q}%"),
                        Event.venue_city.ilike(f"%{q}%"),
                    )
                )
            else:
                stmt = stmt.where(
                    or_(
                        Event.title.ilike(f"%{q}%"),
                        Event.venue_city.ilike(f"%{q}%"),
                    )
                )
        total = await pg.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        # Higher priority first (microsite featured / landing order), then soonest date.
        if q and _TRGM_AVAILABLE:
            order = [
                func.similarity(Event.title, q).desc(),
                Event.priority.desc(),
                Event.starts_at.asc(),
            ]
        else:
            order = [Event.priority.desc(), Event.starts_at.asc()]
        result = await pg.execute(
            stmt.order_by(*order).offset((page - 1) * limit).limit(limit)
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total}


@public_router.get("/{tenant_slug}/{event_slug}")
async def get_public_event(
    tenant_slug: str,
    event_slug: str,
    function_id: Optional[str] = Query(default=None),
):
    async with AsyncSessionLocal() as pg:
        org_row = (
            await pg.execute(select(Organizer).where(Organizer.slug == tenant_slug))
        ).scalar_one_or_none()
        tenant_row = (
            await pg.execute(select(Tenant.status).where(Tenant.slug == tenant_slug))
        ).first()
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
                Event.visibility.in_(list(RESOLVABLE_VISIBILITIES)),
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

        venue = await resolve_event_venue(event)
        if venue:
            event["venue"] = venue
            event["seats_status"] = await compute_event_seats_status(
                event=event,
                venue=venue,
                function_id=function_id or "",
            )
    return event


# ── Fase 9 — access pre-check (lista verificada / código de acceso) ──────────


class CheckAccessBody(BaseModel):
    access_code: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=140)
    cedula: Optional[str] = Field(default=None, max_length=40)


@public_router.post("/{tenant_slug}/{event_slug}/check-access")
async def public_check_access(tenant_slug: str, event_slug: str, body: CheckAccessBody):
    """Pre-flight access gate used by PurchaseModal before showing the checkout
    form.  Validates the buyer's code / email / cédula WITHOUT consuming it
    (no side-effects — no uses_count bump, no used_at stamp).

    Returns ``{"ok": true}`` on success or ``{"ok": false, "reason": "…"}``
    on failure so the frontend can surface a friendly error without a 4xx.
    """
    from services.access_control import check_purchase_access

    # Resolve event (no venue required for access check)
    async with AsyncSessionLocal() as pg:
        org_row = (
            await pg.execute(
                select(Organizer).where(
                    Organizer.slug == tenant_slug, Organizer.status == "approved"
                )
            )
        ).scalar_one_or_none()
        if not org_row:
            raise HTTPException(404, "Organizador no encontrado")

        event_row = await pg.scalar(
            select(Event).where(
                Event.organizer_id == org_row.id,
                Event.slug == event_slug,
                Event.status == "published",
                Event.visibility.in_(list(RESOLVABLE_VISIBILITIES)),
            )
        )
        if not event_row:
            raise HTTPException(404, "Evento no encontrado")

        event = row_to_dict(event_row)
        access_params = event.get("access_params") or {}
        access_type = access_params.get("access_type", "open")

        # Open events don't need a gate check
        if access_type in ("open", "link_only"):
            return {"ok": True}

        try:
            await check_purchase_access(
                event=event,
                session=pg,
                buyer_email=body.email,
                buyer_document_id=body.cedula,
                access_code=body.access_code,
                quantity=1,  # pre-flight: check for at least 1 ticket
            )
            return {"ok": True}
        except ValueError as exc:
            # check_purchase_access only raises ValueError with hand-written,
            # user-facing Spanish messages (services/access_control.py) — never
            # a wrapped DB/library exception — so this is safe to surface. The
            # resulting CodeQL py/stack-trace-exposure alert is dismissed as a
            # false positive in the repo's Security tab with this justification
            # (Default Setup CodeQL doesn't honor inline suppression comments).
            return {"ok": False, "reason": str(exc)}


# ── Phase 7 — public seat-holds endpoints ────────────────────────────────
class SeatHoldsBody(BaseModel):
    seat_ids: List[str]
    session_token: str = Field(min_length=8, max_length=80)
    buyer_email: Optional[EmailStr] = Field(default=None, max_length=140)
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
        raise HTTPException(
            422, "La función seleccionada no existe o ya no está disponible."
        )


async def _resolve_public_event(tenant_slug: str, event_slug: str) -> tuple:
    async with AsyncSessionLocal() as pg:
        org_row = (
            await pg.execute(
                select(Organizer).where(
                    Organizer.slug == tenant_slug, Organizer.status == "approved"
                )
            )
        ).scalar_one_or_none()
    if not org_row:
        raise HTTPException(404, "Organizador no encontrado")
    organizer = row_to_dict(org_row)
    async with AsyncSessionLocal() as pg:
        event_row = await pg.scalar(
            select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == event_slug,
                Event.status == "published",
                Event.visibility.in_(list(RESOLVABLE_VISIBILITIES)),
            )
        )
    if not event_row:
        raise HTTPException(404, "Evento no encontrado")
    event = row_to_dict(event_row)
    if not event.get("venue_id"):
        raise HTTPException(409, "Este evento no usa asientos numerados.")
    venue = await resolve_event_venue(event)
    if not venue:
        raise HTTPException(409, "El venue del evento ya no está disponible.")
    return organizer, event, venue


@public_router.post("/{tenant_slug}/{event_slug}/seat-holds")
async def public_create_holds(tenant_slug: str, event_slug: str, body: SeatHoldsBody):
    from services.seats import compute_event_seats_status, create_seat_holds

    _, event, venue = await _resolve_public_event(tenant_slug, event_slug)
    if not body.seat_ids:
        raise HTTPException(422, "Tenés que elegir al menos un asiento.")
    if len(body.seat_ids) > 20:
        raise HTTPException(422, "Máximo 20 asientos por compra.")
    await _validate_active_function(event["id"], body.function_id)
    function_id = body.function_id or ""
    window = event.get("seat_holds_window_minutes") or 10
    holds = await create_seat_holds(
        event_id=event["id"],
        venue_id=event["venue_id"],
        seat_ids=body.seat_ids,
        session_token=body.session_token,
        buyer_email=body.buyer_email,
        window_minutes=window,
        function_id=function_id,
        venue=venue,
    )
    return {
        "holds": holds,
        "expires_at": holds[0]["expires_at"] if holds else None,
        "seats_status": await compute_event_seats_status(
            event=event,
            venue=venue,
            function_id=function_id,
        ),
    }


@public_router.delete("/{tenant_slug}/{event_slug}/seat-holds")
async def public_release_holds(
    tenant_slug: str, event_slug: str, body: SeatHoldsRelease
):
    from services.seats import release_holds_for_session

    _, event, _venue = await _resolve_public_event(tenant_slug, event_slug)
    deleted = await release_holds_for_session(
        event_id=event["id"],
        session_token=body.session_token,
        function_id=body.function_id,
    )
    return {"released": deleted}


@public_router.get("/{tenant_slug}/{event_slug}/seat-groups")
async def public_seat_groups(
    tenant_slug: str,
    event_slug: str,
    function_id: Optional[str] = Query(default=None),
):
    """Return available seat groups (rows / tables) for whole-group purchase.

    Enabled only when `event.content.allow_full_group_purchase` is true.
    """
    from services.seats import compute_event_seats_status

    _, event, venue = await _resolve_public_event(tenant_slug, event_slug)

    allow = (event.get("content") or {}).get("allow_full_group_purchase", False)
    if not allow:
        return {"groups": []}

    fn_id = function_id or ""
    seats_status: list[dict] = await compute_event_seats_status(
        event=event, venue=venue, function_id=fn_id
    )

    # Venue elements use `kind` (seat_row_straight/seat_row_curved/table_round/
    # table_rect/seat_individual), not `type`, and don't carry a `seats`/
    # `children` list — seat_status entries already carry `element_id`/`kind`
    # from expand_venue_seats(), so group by that instead of re-deriving it
    # from the venue layout JSON.
    GROUPABLE_KINDS = (
        "seat_row_straight",
        "seat_row_curved",
        "table_round",
        "table_rect",
    )
    elements = (venue.get("venue_layout") or venue).get("elements") or []
    elements_by_id = {el.get("id"): el for el in elements if isinstance(el, dict)}

    by_element: dict[str, list[dict]] = {}
    for s in seats_status or []:
        if s.get("kind") not in GROUPABLE_KINDS:
            continue
        by_element.setdefault(s["element_id"], []).append(s)

    groups = []
    for element_id, seats in by_element.items():
        avail = [s["seat_id"] for s in seats if s.get("status") == "available"]
        if not avail:
            continue
        el = elements_by_id.get(element_id) or {}
        groups.append(
            {
                "id": element_id,
                "type": seats[0].get("kind"),
                "label": el.get("label") or el.get("name") or element_id,
                "seat_ids": avail,
                "total_seats": len(seats),
                "available_seats": len(avail),
            }
        )

    return {"groups": groups}


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
                org_map[row.id] = {
                    "id": row.id,
                    "company_name": row.company_name,
                    "slug": row.slug,
                }
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


class SuspendEventBody(BaseModel):
    comment: str = Field(..., min_length=3, max_length=400)


def _clear_suspend_fields(row: Event) -> None:
    row.status_before_suspend = None
    row.suspended_at = None
    row.suspended_reason = None


def _layout_summary(layout: Any) -> dict:
    if not isinstance(layout, dict) or not layout:
        return {
            "has_layout": False,
            "localities_count": 0,
            "capacity_calculated": None,
        }
    locs = layout.get("localities") or []
    return {
        "has_layout": True,
        "localities_count": len(locs) if isinstance(locs, list) else 0,
        "capacity_calculated": layout.get("capacity_calculated"),
    }


@admin_router.get("/{event_id}")
async def admin_get_event(
    event_id: str,
    _admin=Depends(require_role("super_admin")),
):
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        event = row_to_dict(row)
        layout = event.pop("venue_layout", None)
        event["venue_layout_summary"] = _layout_summary(layout)
        loc_names = {}
        if isinstance(layout, dict):
            for loc in layout.get("localities") or []:
                if isinstance(loc, dict) and loc.get("id"):
                    loc_names[loc["id"]] = loc.get("name") or loc["id"]
        priced = []
        for lp in event.get("locality_pricing") or []:
            if not isinstance(lp, dict):
                continue
            item = dict(lp)
            item.setdefault("name", loc_names.get(item.get("locality_id")))
            priced.append(item)
        event["locality_pricing"] = priced

        org = await session.scalar(
            select(Organizer).where(Organizer.id == row.organizer_id)
        )
        tt_rows = (
            (
                await session.execute(
                    select(TicketType)
                    .where(TicketType.event_id == event_id)
                    .order_by(TicketType.sort_order.asc(), TicketType.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        fn_rows = (
            (
                await session.execute(
                    select(EventFunction)
                    .where(EventFunction.event_id == event_id)
                    .order_by(
                        EventFunction.sort_order.asc(), EventFunction.starts_at.asc()
                    )
                )
            )
            .scalars()
            .all()
        )

        paid = (
            await session.execute(
                select(
                    func.count(TicketOrder.id),
                    func.coalesce(func.sum(TicketOrder.total_cents), 0),
                    func.coalesce(func.sum(TicketOrder.fees_cents), 0),
                ).where(
                    TicketOrder.event_id == event_id,
                    TicketOrder.status == "paid",
                )
            )
        ).one()
        pending_count = (
            await session.scalar(
                select(func.count(TicketOrder.id)).where(
                    TicketOrder.event_id == event_id,
                    TicketOrder.status.in_(
                        ("pending", "pending_gateway", "pending_manual_payment")
                    ),
                )
            )
            or 0
        )
        recent = (
            (
                await session.execute(
                    select(TicketOrder)
                    .where(TicketOrder.event_id == event_id)
                    .order_by(TicketOrder.created_at.desc())
                    .limit(20)
                )
            )
            .scalars()
            .all()
        )

    organizer = None
    if org:
        organizer = {
            "id": org.id,
            "company_name": org.company_name,
            "slug": org.slug,
            "email": org.email,
            "status": org.status,
            "plan_code": org.plan_code,
        }

    event["organizer"] = organizer
    event["ticket_types"] = [row_to_dict(t) for t in tt_rows]
    event["functions"] = [row_to_dict(f) for f in fn_rows]
    event["sales"] = {
        "orders_paid": int(paid[0] or 0),
        "orders_pending": int(pending_count or 0),
        "gmv_cents": int(paid[1] or 0),
        "fees_cents": int(paid[2] or 0),
        "tickets_sold": int(event.get("tickets_sold") or 0),
    }
    event["recent_orders"] = [
        {
            "id": o.id,
            "order_number": o.order_number,
            "status": o.status,
            "payment_method": o.payment_method,
            "buyer_email": o.buyer_email,
            "total_cents": int(o.total_cents or 0),
            "fees_cents": int(o.fees_cents or 0),
            "created_at": o.created_at,
            "paid_at": o.paid_at,
        }
        for o in recent
    ]
    return event


@admin_router.post("/{event_id}/suspend")
async def admin_suspend_event(
    event_id: str,
    payload: SuspendEventBody,
    admin=Depends(require_role("super_admin")),
):
    obsolete_rel_paths: List[str] = []
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status == "cancelled":
            raise HTTPException(
                status_code=409,
                detail="No se puede suspender un evento cancelado",
            )
        if row.status == "suspended":
            raise HTTPException(status_code=409, detail="El evento ya está suspendido")
        now = _now()
        row.status_before_suspend = row.status
        row.status = "suspended"
        row.suspended_at = now
        row.suspended_reason = payload.comment.strip()
        obsolete_rel_paths = await _pop_appeal_asset_rows(session, event_id)
        _set_appeal(row, _empty_appeal())
        row.updated_at = now
        session.add(
            AuditLog(
                id=str(uuid.uuid4()),
                actor_user_id=admin["id"],
                action="event.suspended",
                target_type="event",
                target_id=event_id,
                metadata_={
                    "comment": payload.comment.strip(),
                    "status_before": row.status_before_suspend,
                },
                created_at=now,
            )
        )
        await session.commit()
    for rel in obsolete_rel_paths:
        _unlink_asset_file(rel)
    return {"ok": True, "status": "suspended"}


@admin_router.post("/{event_id}/unsuspend")
async def admin_unsuspend_event(
    event_id: str,
    admin=Depends(require_role("super_admin")),
):
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status != "suspended":
            raise HTTPException(status_code=409, detail="El evento no está suspendido")
        restore = row.status_before_suspend or (
            "published" if row.published_at else "draft"
        )
        if restore == "suspended":
            restore = "published" if row.published_at else "draft"
        now = _now()
        row.status = restore
        appeal = _appeal_of(row)
        if appeal["status"] == "pending":
            appeal["status"] = "accepted"
            appeal["reviewed_at"] = now.isoformat()
            appeal["admin_note"] = (
                appeal.get("admin_note") or "Reactivado por el super admin"
            )
            _set_appeal(row, appeal)
        _clear_suspend_fields(row)
        row.updated_at = now
        session.add(
            AuditLog(
                id=str(uuid.uuid4()),
                actor_user_id=admin["id"],
                action="event.unsuspended",
                target_type="event",
                target_id=event_id,
                metadata_={"restored_status": restore},
                created_at=now,
            )
        )
        await session.commit()
    return {"ok": True, "status": restore}


class AppealReviewBody(BaseModel):
    comment: str = Field(default="", max_length=400)


@admin_router.get("/{event_id}/suspension-appeal/files/{asset_id}")
async def admin_download_appeal_file(
    event_id: str,
    asset_id: str,
    _admin=Depends(require_role("super_admin")),
):
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        asset = await session.scalar(
            select(EventAsset).where(
                EventAsset.id == asset_id,
                EventAsset.event_id == event_id,
                EventAsset.kind == "appeal",
            )
        )
    if not asset:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return _appeal_file_response(asset, row)


@admin_router.post("/{event_id}/suspension-appeal/accept")
async def admin_accept_suspension_appeal(
    event_id: str,
    payload: AppealReviewBody,
    admin=Depends(require_role("super_admin")),
):
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status != "suspended":
            raise HTTPException(status_code=409, detail="El evento no está suspendido")
        appeal = _appeal_of(row)
        if appeal["status"] != "pending":
            raise HTTPException(
                status_code=409, detail="No hay una apelación pendiente"
            )
        restore = _restore_status_after_suspend(row)
        now = _now()
        appeal["status"] = "accepted"
        appeal["admin_note"] = (payload.comment or "").strip()
        appeal["reviewed_at"] = now.isoformat()
        _set_appeal(row, appeal)
        row.status = restore
        _clear_suspend_fields(row)
        row.updated_at = now
        session.add(
            AuditLog(
                id=str(uuid.uuid4()),
                actor_user_id=admin["id"],
                action="event.suspension_appeal_accepted",
                target_type="event",
                target_id=event_id,
                metadata_={"restored_status": restore, "comment": payload.comment},
                created_at=now,
            )
        )
        await session.commit()
    return {"ok": True, "status": restore}


@admin_router.post("/{event_id}/suspension-appeal/reject")
async def admin_reject_suspension_appeal(
    event_id: str,
    payload: AppealReviewBody,
    admin=Depends(require_role("super_admin")),
):
    note = (payload.comment or "").strip()
    if len(note) < 3:
        raise HTTPException(
            status_code=422, detail="Indicá por qué se rechaza la apelación"
        )
    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        if row.status != "suspended":
            raise HTTPException(status_code=409, detail="El evento no está suspendido")
        appeal = _appeal_of(row)
        if appeal["status"] != "pending":
            raise HTTPException(
                status_code=409, detail="No hay una apelación pendiente"
            )
        now = _now()
        appeal["status"] = "rejected"
        appeal["admin_note"] = note
        appeal["reviewed_at"] = now.isoformat()
        _set_appeal(row, appeal)
        row.updated_at = now
        session.add(
            AuditLog(
                id=str(uuid.uuid4()),
                actor_user_id=admin["id"],
                action="event.suspension_appeal_rejected",
                target_type="event",
                target_id=event_id,
                metadata_={"comment": note},
                created_at=now,
            )
        )
        await session.commit()
    return {"ok": True, "status": "suspended", "suspension_appeal": appeal}


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
        _clear_suspend_fields(row)
        row.updated_at = now
        session.add(
            AuditLog(
                id=str(uuid.uuid4()),
                actor_user_id=admin["id"],
                action="event.force_cancelled",
                target_type="event",
                target_id=event_id,
                metadata_={"comment": payload.comment},
                created_at=now,
            )
        )
        await session.commit()
    return {"ok": True, "status": "cancelled"}


@admin_router.post("/{event_id}/mark-pre-event-fee-paid")
async def admin_mark_pre_event_fee_paid(
    event_id: str,
    admin=Depends(require_role("super_admin")),
):
    from services.event_fees import mark_pre_event_fee_paid

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(Event).where(Event.id == event_id))
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        changed = mark_pre_event_fee_paid(row, payment_method="admin")
        if changed:
            session.add(
                AuditLog(
                    id=str(uuid.uuid4()),
                    actor_user_id=admin["id"],
                    action="event.pre_event_fee_paid",
                    target_type="event",
                    target_id=event_id,
                    metadata_={"fee_cents": row.pre_event_fee_cents},
                    created_at=_now(),
                )
            )
        await session.commit()
    return {"ok": True, "status": "paid", "changed": changed}
