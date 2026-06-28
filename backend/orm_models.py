"""
SQLAlchemy 2.x ORM models — full TYS schema.

All 21 collections mapped to PostgreSQL tables.
IDs are UUID stored as TEXT (keeps API contracts identical to MongoDB version).
Complex nested data (canvas, config, payment_methods, etc.) is stored as JSONB.
"""
import uuid as _uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from database import Base


def _uuid4() -> str:
    return str(_uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Order number sequence (replaces counters collection) ──────────────────────
ticket_order_seq = Sequence("ticket_order_seq", start=1)


# ─────────────────────────────────────────────────────────────────────────────
# Tenants
# ─────────────────────────────────────────────────────────────────────────────
class Tenant(Base):
    __tablename__ = "tenants"

    slug = Column(String(60), primary_key=True)
    name = Column(String(200), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Users
# ─────────────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid4)
    email = Column(String(254), unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(20), nullable=False, default="organizer")
    # FK to organizers added in Phase 2; kept nullable TEXT for now so
    # the column exists and auth can write it without a FK constraint error.
    organizer_id = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    last_login = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Subscription plans
# ─────────────────────────────────────────────────────────────────────────────
class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(String(36), primary_key=True, default=_uuid4)
    code = Column(String(40), unique=True, nullable=False, index=True)
    name = Column(String(80), nullable=False)
    description = Column(String(500), nullable=False)
    price_cents = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False, default="usd")
    billing_period = Column(String(20), nullable=False)
    features = Column(JSONB, nullable=False, default=list)
    max_events = Column(Integer, nullable=False, default=-1)
    max_tickets_per_event = Column(Integer, nullable=False, default=-1)
    includes_numbered = Column(Boolean, nullable=False, default=False)
    includes_ai_design = Column(Boolean, nullable=False, default=False)
    includes_custom_domain = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    stripe_price_id = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


# ─────────────────────────────────────────────────────────────────────────────
# Organizers  (Phase 2)
# ─────────────────────────────────────────────────────────────────────────────
class Organizer(Base):
    __tablename__ = "organizers"

    id = Column(String(36), primary_key=True, default=_uuid4)
    user_id = Column(String(36), ForeignKey("users.id"), unique=True, nullable=False)
    company_name = Column(String(120), nullable=False)
    legal_id = Column(String(40), nullable=False)
    org_type = Column(String(20), nullable=False)  # individual | company
    email = Column(String(254), nullable=False)
    phone = Column(String(40), nullable=False)
    country = Column(String(40), nullable=False)
    slug = Column(String(60), ForeignKey("tenants.slug"), unique=True, nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    rejection_reason = Column(Text, nullable=True)
    plan_id = Column(String(36), ForeignKey("subscription_plans.id"), nullable=True)
    plan_code = Column(String(40), nullable=True)
    subscription_status = Column(String(20), nullable=False, default="none")
    stripe_customer_id = Column(String(100), nullable=True)
    stripe_subscription_id = Column(String(100), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(String(36), nullable=True)  # user id or "system"

    admin_comments = relationship(
        "OrganizerAdminComment", back_populates="organizer", cascade="all, delete-orphan"
    )
    documents = relationship(
        "OrganizerDocument", back_populates="organizer", cascade="all, delete-orphan"
    )


class OrganizerAdminComment(Base):
    __tablename__ = "organizer_admin_comments"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(
        String(36), ForeignKey("organizers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    admin_id = Column(String(36), nullable=False)  # user id or "system"
    admin_email = Column(String(254), nullable=True)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    organizer = relationship("Organizer", back_populates="admin_comments")


class OrganizerDocument(Base):
    __tablename__ = "organizer_documents"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(
        String(36), ForeignKey("organizers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    doc_type = Column(String(30), nullable=False)
    original_filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    file_path = Column(Text, nullable=True)
    is_demo = Column(Boolean, nullable=False, default=False)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    organizer = relationship("Organizer", back_populates="documents")


class RequiredDocumentSet(Base):
    """Admin-configurable: which doc_types are mandatory per org_type."""
    __tablename__ = "required_document_sets"

    org_type = Column(String(20), primary_key=True)  # "individual" | "company"
    doc_types = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    updated_by = Column(String(36), nullable=True)


class DocumentType(Base):
    """Admin-extensible catalog of document types organizers can upload."""
    __tablename__ = "document_types"

    code = Column(String(40), primary_key=True)  # slug of label, e.g. "pasaporte"
    label = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    created_by = Column(String(36), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Venues  (Phase 3)
# ─────────────────────────────────────────────────────────────────────────────
class Venue(Base):
    __tablename__ = "venues"
    __table_args__ = (UniqueConstraint("organizer_id", "slug", name="uq_venue_org_slug"),)

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    tenant_slug = Column(String(60), ForeignKey("tenants.slug"), nullable=False)
    name = Column(String(200), nullable=False)
    slug = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(40), nullable=True)  # theater | auditorium | …
    # Full Konva canvas state: {width, height, background_color, grid_size}
    canvas = Column(JSONB, nullable=False, default=dict)
    # List of canvas elements (stages, rows, zones, tables, individual seats)
    elements = Column(JSONB, nullable=False, default=list)
    # [{id, name, color, description, default_price_cents}]
    localities = Column(JSONB, nullable=False, default=list)
    capacity_calculated = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default="draft")
    is_template = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
    published_at = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Events  (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────
class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("organizer_id", "slug", name="uq_event_org_slug"),)

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    tenant_slug = Column(String(60), ForeignKey("tenants.slug"), nullable=False)
    title = Column(String(300), nullable=False)
    slug = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    short_description = Column(String(500), nullable=True)
    category = Column(String(40), nullable=False)
    status = Column(String(20), nullable=False, default="draft")
    pricing_type = Column(String(20), nullable=False, default="free")
    visibility = Column(String(20), nullable=False, default="public")

    # Location
    venue_name = Column(String(200), nullable=True)
    venue_address = Column(String(300), nullable=True)
    venue_city = Column(String(100), nullable=True)
    venue_country = Column(String(100), nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)

    # Dates
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    timezone = Column(String(50), nullable=True)
    sales_start = Column(DateTime(timezone=True), nullable=True)
    sales_end = Column(DateTime(timezone=True), nullable=True)
    # Phase 9.6 — opaque UI preset hints
    duration_preset = Column(String(40), nullable=True)
    sales_window_preset_start = Column(String(40), nullable=True)
    sales_window_preset_end = Column(String(40), nullable=True)

    # Venue link (numbered seating)
    venue_id = Column(String(36), ForeignKey("venues.id"), nullable=True)
    venue_slug = Column(String(120), nullable=True)
    # [{locality_id, price_cents, max_tickets_per_purchase}]
    locality_pricing = Column(JSONB, nullable=False, default=list)
    seat_holds_window_minutes = Column(Integer, nullable=True, default=10)

    # Capacity & sales
    base_price_cents = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")
    capacity = Column(Integer, nullable=True)
    tickets_sold = Column(Integer, nullable=False, default=0)

    # Media
    poster_url = Column(Text, nullable=True)
    banner_url = Column(Text, nullable=True)
    gallery_urls = Column(JSONB, nullable=False, default=list)

    # Complex JSONB config fields
    payment_methods = Column(
        JSONB,
        nullable=False,
        default=lambda: {
            "stripe": {"enabled": True},
            "transfer": {"enabled": False},
            "cash": {"enabled": False},
        },
    )
    discounts = Column(JSONB, nullable=False, default=dict)
    access_params = Column(JSONB, nullable=False, default=dict)
    # policies_html, agenda[], faq[] — rich event page content
    content = Column(JSONB, nullable=False, default=dict)

    # Phase 8 — multi-function support
    is_multi_function = Column(Boolean, nullable=False, default=False)
    # "function" = Multifunción/Franjas horarias (same show repeated).
    # "subevent" = Evento con Subeventos (independent add-ons: sala VIP,
    # cena, meet & greet). Drives wording + EventFunction.kind default and
    # whether sibling funciones are allowed to overlap in time.
    multi_function_mode = Column(String(20), nullable=False, default="function")

    # Phase 8 — eTicket delivery mode
    # Values: al_momento | horas_antes | fecha_especifica | manual
    ticket_delivery_mode = Column(String(20), nullable=False, default="al_momento")
    ticket_delivery_hours = Column(Integer, nullable=True)
    ticket_delivery_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
    published_at = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Ticket types  (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────
class TicketType(Base):
    __tablename__ = "ticket_types"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    price_cents = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="usd")
    capacity = Column(Integer, nullable=True)
    tickets_sold = Column(Integer, nullable=False, default=0)
    venue_locality_id = Column(String(36), nullable=True)
    color = Column(String(20), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Phase 8 — sale window & buyer limits
    sale_start = Column(DateTime(timezone=True), nullable=True)
    sale_end = Column(DateTime(timezone=True), nullable=True)
    max_per_buyer = Column(Integer, nullable=True)
    is_early_bird = Column(Boolean, nullable=False, default=False)
    early_bird_closes_at = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Orders  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class TicketOrder(Base):
    __tablename__ = "ticket_orders"

    id = Column(String(36), primary_key=True, default=_uuid4)
    order_number = Column(String(20), unique=True, nullable=False)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    tenant_slug = Column(String(100), nullable=True)

    # Buyer — full dict in JSONB; buyer_email indexed for lookup
    buyer = Column(JSONB, nullable=False, default=dict)
    buyer_email = Column(String(254), nullable=False, index=True, default="")

    # Status & payment
    status = Column(String(30), nullable=False, default="pending")
    payment_method = Column(String(20), nullable=False, default="stripe")

    # Totals
    quantity_total = Column(Integer, nullable=False, default=1)
    subtotal_cents = Column(Integer, nullable=False, default=0)
    fees_cents = Column(Integer, nullable=False, default=0)
    total_cents = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="usd")
    donation_amount_cents = Column(Integer, nullable=True)
    discount_total_cents = Column(Integer, nullable=False, default=0)
    discounts_applied = Column(JSONB, nullable=False, default=list)

    # Stripe
    stripe_session_id = Column(String(200), nullable=True)
    stripe_payment_intent_id = Column(String(200), nullable=True)

    # Manual payment — {method, reference, confirmed_by, confirmed_at, organizer_notes, paid_at}
    manual_payment_info = Column(JSONB, nullable=True)

    # Items (ticket-type breakdown) and seat data
    items = Column(JSONB, nullable=False, default=list)
    seat_ids = Column(JSONB, nullable=True)
    seat_holds_session_token = Column(String(200), nullable=True)
    seat_assignments = Column(JSONB, nullable=False, default=list)

    metadata_ = Column("metadata", JSONB, nullable=True)

    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
    paid_at = Column(DateTime(timezone=True), nullable=True)
    refunded_at = Column(DateTime(timezone=True), nullable=True)
    refund_reason = Column(Text, nullable=True)

    # Phase 8 — guest mode & multi-function
    order_token = Column(String(36), unique=True, nullable=True, index=True)
    function_id = Column(String(36), ForeignKey("event_functions.id"), nullable=True)
    tickets_sent_at = Column(DateTime(timezone=True), nullable=True)

    tickets = relationship("Ticket", back_populates="order", cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────────────────────────
# Tickets  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(String(36), primary_key=True, default=_uuid4)
    order_id = Column(
        String(36), ForeignKey("ticket_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False)
    ticket_type_id = Column(String(36), ForeignKey("ticket_types.id"), nullable=True)
    tenant_slug = Column(String(100), nullable=True)

    order_number = Column(String(20), nullable=False)
    ticket_number = Column(String(30), nullable=True)

    # Holder — full dict in JSONB; flat columns for indexed lookup
    holder = Column(JSONB, nullable=False, default=dict)
    holder_name = Column(String(140), nullable=False, default="")
    holder_email = Column(String(254), nullable=False, default="")

    qr_token = Column(Text, nullable=True)

    seat_id = Column(String(200), nullable=True)
    seat_label = Column(String(100), nullable=True)
    locality_name = Column(String(100), nullable=True)
    locality_id = Column(String(36), nullable=True)

    status = Column(String(20), nullable=False, default="issued")
    issued_at = Column(DateTime(timezone=True), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by = Column(String(100), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    # Phase 8 — function link & captured price
    function_id = Column(String(36), ForeignKey("event_functions.id"), nullable=True)
    price_cents = Column(Integer, nullable=True)

    order = relationship("TicketOrder", back_populates="tickets")


# ─────────────────────────────────────────────────────────────────────────────
# Ticket scans  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class TicketScan(Base):
    __tablename__ = "ticket_scans"

    id = Column(String(36), primary_key=True, default=_uuid4)
    ticket_id = Column(String(36), ForeignKey("tickets.id"), nullable=True, index=True)  # nullable for not_found/invalid scans
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    result = Column(String(20), nullable=False)  # valid | already_used | invalid | not_found | revoked
    scanned_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    scanned_by = Column(String(100), nullable=True)
    reason = Column(Text, nullable=True)
    holder_name = Column(String(200), nullable=True)
    seat_label = Column(String(100), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Seat holds  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class SeatHold(Base):
    __tablename__ = "seat_holds"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    venue_id = Column(String(36), ForeignKey("venues.id"), nullable=False)
    seat_id = Column(String(200), nullable=False)
    order_id = Column(String(36), nullable=True)
    session_token = Column(String(200), nullable=True)
    buyer_email = Column(String(254), nullable=True)
    status = Column(String(20), nullable=False, default="held")
    held_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # "" (not NULL) = no función / general event. Same physical seat_id can be
    # held/sold independently per función — see uq_seat_holds_active index,
    # which needs equal (not NULL) values to actually enforce uniqueness.
    function_id = Column(String(36), nullable=False, default="", index=True)


# ─────────────────────────────────────────────────────────────────────────────
# Event capacity reservations  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class EventCapacityReservation(Base):
    __tablename__ = "event_capacity_reservations"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    order_id = Column(String(36), nullable=True, index=True)
    quantity = Column(Integer, nullable=False, default=1)
    # Scopes this reservation to a single función's own capacity pool. NULL
    # means it counts against the event-level shared pool (general/non-multi-
    # función events, or functions without their own capacity override).
    function_id = Column(String(36), ForeignKey("event_functions.id"), nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Event seat assignments  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────
class EventSeatAssignment(Base):
    __tablename__ = "event_seat_assignments"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    venue_id = Column(String(36), ForeignKey("venues.id"), nullable=False)
    seat_id = Column(String(200), nullable=False)
    ticket_id = Column(String(36), nullable=False)
    order_id = Column(String(36), nullable=False)
    holder_email = Column(String(254), nullable=True)
    locality_id = Column(String(36), nullable=True)
    assigned_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    # "" (not NULL) = no función / general event — same sentinel as SeatHold.
    function_id = Column(String(36), nullable=False, default="", index=True)


# ─────────────────────────────────────────────────────────────────────────────
# Microsites  (Phase 6)
# ─────────────────────────────────────────────────────────────────────────────
class Microsite(Base):
    __tablename__ = "microsites"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(
        String(36), ForeignKey("organizers.id"), unique=True, nullable=False
    )
    slug = Column(String(60), ForeignKey("tenants.slug"), unique=True, nullable=False)
    template = Column(String(40), nullable=True)
    branding = Column(JSONB, nullable=False, default=dict)
    content = Column(JSONB, nullable=False, default=dict)
    social_links = Column(JSONB, nullable=False, default=dict)
    sections_enabled = Column(JSONB, nullable=False, default=dict)
    published = Column(Boolean, nullable=False, default=False)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


# ─────────────────────────────────────────────────────────────────────────────
# Audit log
# ─────────────────────────────────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=_uuid4)
    actor_user_id = Column(String(36), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    target_type = Column(String(50), nullable=False)
    target_id = Column(String(36), nullable=False)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)


# ─────────────────────────────────────────────────────────────────────────────
# Billing intents
# ─────────────────────────────────────────────────────────────────────────────
class BillingIntent(Base):
    __tablename__ = "billing_intents"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    plan_id = Column(String(36), nullable=True)
    plan_code = Column(String(40), nullable=False)
    session_id = Column(String(200), nullable=True, index=True)  # Stripe checkout session ID
    mode = Column(String(20), nullable=True)  # subscription | payment
    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)


# ─────────────────────────────────────────────────────────────────────────────
# Activation events  (one row per organizer×event_type, upsert-safe)
# ─────────────────────────────────────────────────────────────────────────────
class ActivationEvent(Base):
    __tablename__ = "activation_events"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    event_type = Column(String(60), nullable=False)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    __table_args__ = (UniqueConstraint("organizer_id", "event_type", name="uq_activation_org_type"),)


# ─────────────────────────────────────────────────────────────────────────────
# Microsite assets
# ─────────────────────────────────────────────────────────────────────────────
class MicrositeAsset(Base):
    __tablename__ = "microsite_assets"

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    asset_type = Column(String(20), nullable=False)  # logo | banner | gallery
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(200), nullable=True)
    mime_type = Column(String(100), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, default=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Event assets  (poster / banner / gallery uploads)
# ─────────────────────────────────────────────────────────────────────────────
class EventAsset(Base):
    __tablename__ = "event_assets"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False)
    kind = Column(String(20), nullable=False)  # poster | banner | gallery
    file_path = Column(String(500), nullable=False)
    mime_type = Column(String(100), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, default=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8 — Event functions (multi-función)
# ─────────────────────────────────────────────────────────────────────────────
class EventFunction(Base):
    __tablename__ = "event_functions"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    timezone = Column(String(50), nullable=True)

    # Per-function venue (overrides event-level venue if set)
    venue_id = Column(String(36), ForeignKey("venues.id"), nullable=True)
    venue_name = Column(String(200), nullable=True)
    venue_address = Column(String(300), nullable=True)
    venue_city = Column(String(100), nullable=True)
    venue_country = Column(String(100), nullable=True)

    # [{locality_id, price_cents, max_tickets_per_purchase}] — overrides event-level if non-empty
    locality_pricing = Column(JSONB, nullable=False, default=list)

    capacity = Column(Integer, nullable=True)
    tickets_sold = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="active")  # active | cancelled | soldout
    sort_order = Column(Integer, nullable=False, default=0)
    # "function" = same show repeated (Multifunción/Franjas horarias) — blocked
    # from overlapping a sibling in the same venue. "subevent" = independent
    # add-on under the umbrella event (sala VIP, cena, meet & greet) — may
    # legitimately run concurrently with the main event or other subevents,
    # so the schedule-overlap check skips it. See _check_schedule_conflict.
    kind = Column(String(20), nullable=False, default="function")
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)

    ticket_type_overrides = relationship(
        "FunctionTicketType", back_populates="function", cascade="all, delete-orphan"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8 — Per-function ticket type overrides
# ─────────────────────────────────────────────────────────────────────────────
class FunctionTicketType(Base):
    __tablename__ = "function_ticket_types"
    __table_args__ = (
        UniqueConstraint("function_id", "ticket_type_id", name="uq_function_ticket_type"),
    )

    id = Column(String(36), primary_key=True, default=_uuid4)
    function_id = Column(
        String(36), ForeignKey("event_functions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ticket_type_id = Column(
        String(36), ForeignKey("ticket_types.id", ondelete="CASCADE"), nullable=False
    )
    # If null, inherits from ticket_type
    price_cents_override = Column(Integer, nullable=True)
    capacity_override = Column(Integer, nullable=True)
    tickets_sold = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)

    function = relationship("EventFunction", back_populates="ticket_type_overrides")


# ─────────────────────────────────────────────────────────────────────────────
# Fase 9 — Guest list (lista verificada) entries
# ─────────────────────────────────────────────────────────────────────────────
class EventGuestListEntry(Base):
    __tablename__ = "event_guest_list_entries"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    email = Column(String(254), nullable=True)
    cedula = Column(String(40), nullable=True)
    name = Column(String(140), nullable=True)
    notes = Column(String(300), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)  # set when they complete a purchase
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Fase 9 — Access codes (código de acceso único / multiuso)
# ─────────────────────────────────────────────────────────────────────────────
class EventAccessCode(Base):
    __tablename__ = "event_access_codes"
    __table_args__ = (
        UniqueConstraint("event_id", "code", name="uq_accesscode_event_code"),
    )

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    code = Column(String(40), nullable=False)
    max_uses = Column(Integer, nullable=True)  # null = unlimited
    uses_count = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8 — Staff members (org_staff role)
# ─────────────────────────────────────────────────────────────────────────────
class StaffMember(Base):
    __tablename__ = "staff_members"
    __table_args__ = (
        UniqueConstraint("organizer_id", "email", name="uq_staff_org_email"),
    )

    id = Column(String(36), primary_key=True, default=_uuid4)
    organizer_id = Column(
        String(36), ForeignKey("organizers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(140), nullable=False)
    email = Column(String(254), nullable=False)
    password_hash = Column(Text, nullable=False)
    # List of roles: ["scanner", "cajero", "admin_evento"] — can be multiple
    roles = Column(JSONB, nullable=False, default=list)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    last_login = Column(DateTime(timezone=True), nullable=True)

    event_assignments = relationship(
        "StaffEventAssignment", back_populates="staff", cascade="all, delete-orphan"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8 — Staff event assignments
# ─────────────────────────────────────────────────────────────────────────────
class StaffEventAssignment(Base):
    __tablename__ = "staff_event_assignments"
    __table_args__ = (
        UniqueConstraint("staff_id", "event_id", name="uq_staff_event_assignment"),
    )

    id = Column(String(36), primary_key=True, default=_uuid4)
    staff_id = Column(
        String(36), ForeignKey("staff_members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False)
    assigned_at = Column(DateTime(timezone=True), nullable=False, default=_now)

    staff = relationship("StaffMember", back_populates="event_assignments")


# ─────────────────────────────────────────────────────────────────────────────
# Abono de Temporada — Fase 4 (season pass: prepay N credits, redeem later
# against specific funciones of one multi-función event)
# ─────────────────────────────────────────────────────────────────────────────
class SeasonPass(Base):
    """Organizer-defined product: N redeemable credits for one event's
    funciones, sold as a single upfront payment."""

    __tablename__ = "season_passes"

    id = Column(String(36), primary_key=True, default=_uuid4)
    event_id = Column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    price_cents = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")
    credits_total = Column(Integer, nullable=False)
    # Capacity of the pass itself (how many people can buy it) — independent
    # from event/función capacity, which is only checked at redemption time.
    max_passes = Column(Integer, nullable=True)
    passes_sold = Column(Integer, nullable=False, default=0)
    redemption_starts_at = Column(DateTime(timezone=True), nullable=True)
    redemption_ends_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="active")  # active | cancelled
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)


class SeasonPassPurchase(Base):
    """One buyer's purchase of a SeasonPass — guest-accessed later via
    `purchase_token` to redeem individual credits (no buyer accounts in TYS)."""

    __tablename__ = "season_pass_purchases"

    id = Column(String(36), primary_key=True, default=_uuid4)
    season_pass_id = Column(
        String(36), ForeignKey("season_passes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id = Column(String(36), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id = Column(String(36), ForeignKey("organizers.id"), nullable=False, index=True)
    purchase_token = Column(String(36), unique=True, nullable=False, index=True)
    order_number = Column(String(20), unique=True, nullable=False)
    buyer = Column(JSONB, nullable=False, default=dict)
    buyer_email = Column(String(254), nullable=False, index=True)
    credits_total = Column(Integer, nullable=False)
    credits_used = Column(Integer, nullable=False, default=0)
    subtotal_cents = Column(Integer, nullable=False, default=0)
    fees_cents = Column(Integer, nullable=False, default=0)
    total_cents = Column(Integer, nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")
    # pending | pending_manual_payment | paid | cancelled — mirrors TicketOrder.
    status = Column(String(30), nullable=False, default="pending")
    payment_method = Column(String(20), nullable=False, default="stripe")
    stripe_session_id = Column(String(200), nullable=True)
    manual_payment_info = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)
    paid_at = Column(DateTime(timezone=True), nullable=True)


class SeasonPassRedemption(Base):
    """One credit redeemed against one función — links the purchase to the
    real TicketOrder/Ticket created at redemption time (capacity for that
    función is only consumed now, never at purchase time)."""

    __tablename__ = "season_pass_redemptions"

    id = Column(String(36), primary_key=True, default=_uuid4)
    season_pass_purchase_id = Column(
        String(36), ForeignKey("season_pass_purchases.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    function_id = Column(String(36), ForeignKey("event_functions.id"), nullable=False, index=True)
    order_id = Column(String(36), ForeignKey("ticket_orders.id"), nullable=False)
    redeemed_at = Column(DateTime(timezone=True), nullable=False, default=_now)
