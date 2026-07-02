"""
Unit tests for SQLAlchemy ORM models (orm_models.py).

Tests model instantiation, default values (via column metadata), UUID generation,
and field constraints — without a database connection (pure Python checks).
"""
import os
import uuid as _uuid_mod
from datetime import datetime, timezone

# Set a dummy DATABASE_URL before any TYS imports — import order is sensitive.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from sqlalchemy import Column  # noqa: E402

from orm_models import (  # noqa: E402
    Tenant, User, SubscriptionPlan, Organizer, OrganizerAdminComment, OrganizerDocument,
    RequiredDocumentSet, DocumentType, Venue, Event, TicketType, TicketOrder,
    Ticket, TicketScan, SeatHold, EventCapacityReservation, EventSeatAssignment,
    Microsite, AuditLog, BillingIntent, ActivationEvent, MicrositeAsset,
    EventAsset, EventFunction, FunctionTicketType, EventGuestListEntry,
    EventAccessCode, StaffMember, StaffEventAssignment, SeasonPass,
    SeasonPassPurchase, SeasonPassRedemption, _uuid4, _now,
)


def _valid_uuid(s: str) -> bool:
    """Check if a string is a valid UUID."""
    try:
        _uuid_mod.UUID(s)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _col_default(model_class, col_name: str):
    """Return the effective default value for a column.

    SQLAlchemy wraps callable defaults (list, dict) to accept an execution
    context (ctx) parameter — pass None to evaluate them.
    """
    col: Column = model_class.__table__.columns[col_name]
    if col.default is None:
        return None
    arg = col.default.arg
    if callable(arg):
        try:
            return arg()
        except TypeError:
            return arg(None)  # ctx-aware wrapper
    return arg


def _has_unique_constraint(model_class, name_substr: str) -> bool:
    """Check if a model has a unique constraint whose name matches a substring."""
    seen = set()
    for c in model_class.__table__.constraints:
        if "UniqueConstraint" in type(c).__name__ and c.name and name_substr in c.name:
            return True
        seen.add(id(c))
    # Also check __table_args__ for constraints not yet on the table
    args = model_class.__table_args__
    if isinstance(args, tuple):
        for a in args:
            if "UniqueConstraint" in type(a).__name__ and a.name and name_substr in a.name:
                return True
    return False


# ── Utility tests ─────────────────────────────────────────────────────────────

class TestUtils:
    def test_uuid4_generates_valid_uuid(self):
        uid = _uuid4()
        assert isinstance(uid, str)
        assert len(uid) == 36
        assert _valid_uuid(uid)

    def test_uuid4_unique(self):
        uuids = {_uuid4() for _ in range(100)}
        assert len(uuids) == 100

    def test_now_returns_utc_datetime(self):
        dt = _now()
        assert isinstance(dt, datetime)
        assert dt.tzinfo is not None
        assert dt.tzinfo.utcoffset(dt) == timezone.utc.utcoffset(dt)

    def test_uuid4_returns_str(self):
        uid = _uuid4()
        assert isinstance(uid, str)
        assert len(uid) == 36
        assert uid.count("-") == 4


# ── Tenant ────────────────────────────────────────────────────────────────────

class TestTenant:
    def test_tablename(self):
        assert Tenant.__tablename__ == "tenants"

    def test_columns(self):
        cols = Tenant.__table__.columns
        assert "slug" in cols
        assert "name" in cols
        assert "status" in cols

    def test_default_status(self):
        default = _col_default(Tenant, "status")
        assert default == "active"

    def test_pk(self):
        assert Tenant.__table__.primary_key.columns.keys() == ["slug"]


# ── User ──────────────────────────────────────────────────────────────────────

class TestUser:
    def test_tablename(self):
        assert User.__tablename__ == "users"

    def test_columns(self):
        cols = User.__table__.columns
        assert "id" in cols
        assert "email" in cols
        assert "password_hash" in cols
        assert "role" in cols
        assert "organizer_id" in cols

    def test_email_unique_index(self):
        idx = User.__table__.indexes
        assert any(i.columns.keys() == ["email"] and i.unique for i in idx)

    def test_default_role(self):
        assert _col_default(User, "role") == "organizer"

    def test_organizer_id_nullable(self):
        assert User.__table__.columns["organizer_id"].nullable is True

    def test_id_default_is_uuid4(self):
        uid = _col_default(User, "id")
        assert _valid_uuid(uid)

    def test_last_login_nullable(self):
        assert User.__table__.columns["last_login"].nullable is True


# ── SubscriptionPlan ──────────────────────────────────────────────────────────

class TestSubscriptionPlan:
    def test_tablename(self):
        assert SubscriptionPlan.__tablename__ == "subscription_plans"

    def test_price_cents_not_null(self):
        assert SubscriptionPlan.__table__.columns["price_cents"].nullable is False

    def test_max_events_default(self):
        assert _col_default(SubscriptionPlan, "max_events") == -1

    def test_max_tickets_per_event_default(self):
        assert _col_default(SubscriptionPlan, "max_tickets_per_event") == -1

    def test_active_default(self):
        assert _col_default(SubscriptionPlan, "active") is True

    def test_code_unique_index(self):
        idx = SubscriptionPlan.__table__.indexes
        assert any(i.columns.keys() == ["code"] and i.unique for i in idx)

    def test_features_jsonb(self):
        from sqlalchemy.dialects.postgresql import JSONB
        assert isinstance(SubscriptionPlan.__table__.columns["features"].type, JSONB)


# ── Organizer ─────────────────────────────────────────────────────────────────

class TestOrganizer:
    def test_tablename(self):
        assert Organizer.__tablename__ == "organizers"

    def test_columns(self):
        cols = Organizer.__table__.columns
        assert "id" in cols
        assert "company_name" in cols
        assert "status" in cols
        assert "subscription_status" in cols

    def test_default_status(self):
        assert _col_default(Organizer, "status") == "pending"

    def test_default_subscription_status(self):
        assert _col_default(Organizer, "subscription_status") == "none"

    def test_slug_unique(self):
        assert Organizer.__table__.columns["slug"].unique is True

    def test_user_id_fk(self):
        fks = Organizer.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("user_id" in c for c in cols)

    def test_relationships(self):
        assert hasattr(Organizer, "admin_comments")
        assert hasattr(Organizer, "documents")


class TestOrganizerAdminComment:
    def test_tablename(self):
        assert OrganizerAdminComment.__tablename__ == "organizer_admin_comments"

    def test_organizer_fk(self):
        fks = OrganizerAdminComment.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("organizer_id" in c for c in cols)


class TestOrganizerDocument:
    def test_tablename(self):
        assert OrganizerDocument.__tablename__ == "organizer_documents"


class TestRequiredDocumentSet:
    def test_tablename(self):
        assert RequiredDocumentSet.__tablename__ == "required_document_sets"

    def test_pk_is_org_type(self):
        assert RequiredDocumentSet.__table__.primary_key.columns.keys() == ["org_type"]


class TestDocumentType:
    def test_tablename(self):
        assert DocumentType.__tablename__ == "document_types"

    def test_pk_is_code(self):
        assert DocumentType.__table__.primary_key.columns.keys() == ["code"]


# ── Venue ─────────────────────────────────────────────────────────────────────

class TestVenue:
    def test_tablename(self):
        assert Venue.__tablename__ == "venues"

    def test_columns(self):
        cols = Venue.__table__.columns
        assert "canvas" in cols
        assert "elements" in cols
        assert "localities" in cols
        assert "status" in cols
        assert "is_template" in cols

    def test_defaults(self):
        assert _col_default(Venue, "status") == "draft"
        assert _col_default(Venue, "is_template") is False
        assert _col_default(Venue, "canvas") == {}
        assert _col_default(Venue, "elements") == []
        assert _col_default(Venue, "localities") == []

    def test_unique_constraint(self):
        assert _has_unique_constraint(Venue, "uq_venue_org_slug")


# ── Event ─────────────────────────────────────────────────────────────────────

class TestEvent:
    def test_tablename(self):
        assert Event.__tablename__ == "events"

    def test_columns(self):
        cols = Event.__table__.columns
        for name in ("title", "slug", "category", "status", "pricing_type",
                     "visibility", "base_price_cents", "currency"):
            assert name in cols, f"missing column: {name}"

    def test_defaults(self):
        assert _col_default(Event, "status") == "draft"
        assert _col_default(Event, "pricing_type") == "free"
        assert _col_default(Event, "visibility") == "public"
        assert _col_default(Event, "base_price_cents") == 0
        assert _col_default(Event, "currency") == "USD"
        assert _col_default(Event, "tickets_sold") == 0
        assert _col_default(Event, "is_multi_function") is False
        assert _col_default(Event, "content") == {}
        assert _col_default(Event, "custom_questions") == []

    def test_unique_constraint(self):
        assert _has_unique_constraint(Event, "uq_event_org_slug")

    def foreign_keys(self):
        fks = Event.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("organizer_id" in c for c in cols)
        assert any("venue_id" in c for c in cols)


# ── TicketType ────────────────────────────────────────────────────────────────

class TestTicketType:
    def test_tablename(self):
        assert TicketType.__tablename__ == "ticket_types"

    def test_defaults(self):
        assert _col_default(TicketType, "price_cents") == 0
        assert _col_default(TicketType, "active") is True
        assert _col_default(TicketType, "tickets_sold") == 0
        assert _col_default(TicketType, "sort_order") == 0
        assert _col_default(TicketType, "is_early_bird") is False

    def test_nullable_limits(self):
        assert TicketType.__table__.columns["min_quantity"].nullable is True
        assert TicketType.__table__.columns["exact_quantity"].nullable is True
        assert TicketType.__table__.columns["capacity"].nullable is True

    def test_event_id_fk(self):
        fks = TicketType.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("event_id" in c for c in cols)


# ── TicketOrder ───────────────────────────────────────────────────────────────

class TestTicketOrder:
    def test_tablename(self):
        assert TicketOrder.__tablename__ == "ticket_orders"

    def test_columns(self):
        cols = TicketOrder.__table__.columns
        for name in ("order_number", "status", "payment_method",
                     "quantity_total", "subtotal_cents", "fees_cents",
                     "total_cents"):
            assert name in cols

    def test_defaults(self):
        assert _col_default(TicketOrder, "status") == "pending"
        assert _col_default(TicketOrder, "payment_method") == "stripe"
        assert _col_default(TicketOrder, "quantity_total") == 1
        assert _col_default(TicketOrder, "subtotal_cents") == 0
        assert _col_default(TicketOrder, "fees_cents") == 0
        assert _col_default(TicketOrder, "total_cents") == 0
        assert _col_default(TicketOrder, "discount_total_cents") == 0
        assert _col_default(TicketOrder, "items") == []
        assert _col_default(TicketOrder, "discounts_applied") == []

    def test_order_token_nullable(self):
        assert TicketOrder.__table__.columns["order_token"].nullable is True

    def test_order_number_unique(self):
        assert TicketOrder.__table__.columns["order_number"].unique is True

    def test_relationship_tickets(self):
        assert hasattr(TicketOrder, "tickets")


# ── Ticket ────────────────────────────────────────────────────────────────────

class TestTicket:
    def test_tablename(self):
        assert Ticket.__tablename__ == "tickets"

    def test_defaults(self):
        assert _col_default(Ticket, "status") == "issued"
        assert _col_default(Ticket, "holder") == {}
        assert _col_default(Ticket, "holder_name") == ""
        assert _col_default(Ticket, "holder_email") == ""

    def test_nullable(self):
        assert Ticket.__table__.columns["ticket_type_id"].nullable is True
        assert Ticket.__table__.columns["price_cents"].nullable is True
        assert Ticket.__table__.columns["raffle_number"].nullable is True
        assert Ticket.__table__.columns["seat_id"].nullable is True
        assert Ticket.__table__.columns["qr_token"].nullable is True

    def test_ticket_type_fk(self):
        fks = Ticket.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("ticket_type_id" in c for c in cols)

    def test_relationship_order(self):
        assert hasattr(Ticket, "order")


# ── TicketScan ────────────────────────────────────────────────────────────────

class TestTicketScan:
    def test_tablename(self):
        assert TicketScan.__tablename__ == "ticket_scans"

    def test_ticket_id_nullable(self):
        assert TicketScan.__table__.columns["ticket_id"].nullable is True

    def test_result_not_null(self):
        assert TicketScan.__table__.columns["result"].nullable is False


# ── SeatHold ──────────────────────────────────────────────────────────────────

class TestSeatHold:
    def test_tablename(self):
        assert SeatHold.__tablename__ == "seat_holds"

    def test_default_status(self):
        assert _col_default(SeatHold, "status") == "held"

    def test_function_id_default(self):
        assert _col_default(SeatHold, "function_id") == ""

    def test_not_nullable(self):
        assert SeatHold.__table__.columns["seat_id"].nullable is False
        assert SeatHold.__table__.columns["venue_id"].nullable is False


# ── EventCapacityReservation ──────────────────────────────────────────────────

class TestEventCapacityReservation:
    def test_tablename(self):
        assert EventCapacityReservation.__tablename__ == "event_capacity_reservations"

    def test_default_quantity(self):
        assert _col_default(EventCapacityReservation, "quantity") == 1

    def test_function_id_nullable(self):
        assert EventCapacityReservation.__table__.columns["function_id"].nullable is True


# ── EventSeatAssignment ───────────────────────────────────────────────────────

class TestEventSeatAssignment:
    def test_tablename(self):
        assert EventSeatAssignment.__tablename__ == "event_seat_assignments"

    def test_function_id_default(self):
        assert _col_default(EventSeatAssignment, "function_id") == ""


# ── Microsite ─────────────────────────────────────────────────────────────────

class TestMicrosite:
    def test_tablename(self):
        assert Microsite.__tablename__ == "microsites"

    def test_defaults(self):
        assert _col_default(Microsite, "published") is False
        assert _col_default(Microsite, "branding") == {}
        assert _col_default(Microsite, "content") == {}
        assert _col_default(Microsite, "social_links") == {}
        assert _col_default(Microsite, "sections_enabled") == {}

    def test_organizer_id_unique(self):
        assert Microsite.__table__.columns["organizer_id"].unique is True

    def test_organizer_fk(self):
        fks = Microsite.__table__.foreign_key_constraints
        cols = [set(fk.columns.keys()) for fk in fks]
        assert any("organizer_id" in c for c in cols)


# ── AuditLog ──────────────────────────────────────────────────────────────────

class TestAuditLog:
    def test_tablename(self):
        assert AuditLog.__tablename__ == "audit_log"

    def test_metadata_nullable(self):
        assert AuditLog.__table__.columns["metadata"].nullable is True

    def test_action_not_null(self):
        assert AuditLog.__table__.columns["action"].nullable is False

    def test_created_at_indexed(self):
        idx = AuditLog.__table__.indexes
        assert any("created_at" in i.columns.keys() for i in idx)


# ── BillingIntent ─────────────────────────────────────────────────────────────

class TestBillingIntent:
    def test_tablename(self):
        assert BillingIntent.__tablename__ == "billing_intents"

    def test_default_status(self):
        assert _col_default(BillingIntent, "status") == "pending"


# ── ActivationEvent ───────────────────────────────────────────────────────────

class TestActivationEvent:
    def test_tablename(self):
        assert ActivationEvent.__tablename__ == "activation_events"

    def test_unique_constraint(self):
        assert _has_unique_constraint(ActivationEvent, "uq_activation_org_type")


# ── EventFunction ─────────────────────────────────────────────────────────────

class TestEventFunction:
    def test_tablename(self):
        assert EventFunction.__tablename__ == "event_functions"

    def test_defaults(self):
        assert _col_default(EventFunction, "status") == "active"
        assert _col_default(EventFunction, "kind") == "function"
        assert _col_default(EventFunction, "tickets_sold") == 0
        assert _col_default(EventFunction, "sort_order") == 0

    def test_relationship(self):
        assert hasattr(EventFunction, "ticket_type_overrides")


# ── FunctionTicketType ────────────────────────────────────────────────────────

class TestFunctionTicketType:
    def test_tablename(self):
        assert FunctionTicketType.__tablename__ == "function_ticket_types"

    def test_defaults(self):
        assert _col_default(FunctionTicketType, "active") is True
        assert _col_default(FunctionTicketType, "tickets_sold") == 0

    def test_nullable_overrides(self):
        assert FunctionTicketType.__table__.columns["price_cents_override"].nullable is True
        assert FunctionTicketType.__table__.columns["capacity_override"].nullable is True

    def test_unique_constraint(self):
        assert _has_unique_constraint(FunctionTicketType, "uq_function_ticket_type")


# ── Guest List & Access Codes ─────────────────────────────────────────────────

class TestEventGuestListEntry:
    def test_tablename(self):
        assert EventGuestListEntry.__tablename__ == "event_guest_list_entries"

    def test_nullable_fields(self):
        assert EventGuestListEntry.__table__.columns["email"].nullable is True
        assert EventGuestListEntry.__table__.columns["name"].nullable is True


class TestEventAccessCode:
    def test_tablename(self):
        assert EventAccessCode.__tablename__ == "event_access_codes"

    def test_defaults(self):
        assert _col_default(EventAccessCode, "active") is True
        assert _col_default(EventAccessCode, "uses_count") == 0

    def test_unique_constraint(self):
        assert _has_unique_constraint(EventAccessCode, "uq_accesscode_event_code")


# ── Staff ─────────────────────────────────────────────────────────────────────

class TestStaffMember:
    def test_tablename(self):
        assert StaffMember.__tablename__ == "staff_members"

    def test_defaults(self):
        assert _col_default(StaffMember, "active") is True
        assert _col_default(StaffMember, "roles") == []

    def test_unique_constraint(self):
        assert _has_unique_constraint(StaffMember, "uq_staff_org_email")

    def test_relationship(self):
        assert hasattr(StaffMember, "event_assignments")


class TestStaffEventAssignment:
    def test_tablename(self):
        assert StaffEventAssignment.__tablename__ == "staff_event_assignments"

    def test_unique_constraint(self):
        assert _has_unique_constraint(StaffEventAssignment, "uq_staff_event_assignment")


# ── Season Pass ───────────────────────────────────────────────────────────────

class TestSeasonPass:
    def test_tablename(self):
        assert SeasonPass.__tablename__ == "season_passes"

    def test_defaults(self):
        assert _col_default(SeasonPass, "status") == "active"
        assert _col_default(SeasonPass, "price_cents") == 0
        assert _col_default(SeasonPass, "passes_sold") == 0

    def test_nullable(self):
        assert SeasonPass.__table__.columns["max_passes"].nullable is True
        assert SeasonPass.__table__.columns["description"].nullable is True


class TestSeasonPassPurchase:
    def test_tablename(self):
        assert SeasonPassPurchase.__tablename__ == "season_pass_purchases"

    def test_defaults(self):
        assert _col_default(SeasonPassPurchase, "status") == "pending"
        assert _col_default(SeasonPassPurchase, "credits_used") == 0

    def test_unique_constraints(self):
        assert SeasonPassPurchase.__table__.columns["purchase_token"].unique is True
        assert SeasonPassPurchase.__table__.columns["order_number"].unique is True


class TestSeasonPassRedemption:
    def test_tablename(self):
        assert SeasonPassRedemption.__tablename__ == "season_pass_redemptions"


# ── Model instantiation (limited — SQLAlchemy doesn't apply defaults in Python) ─

class TestInstantiation:
    """Minimal smoke tests: models can be constructed without a DB session."""

    def test_user_with_explicit_id(self):
        uid = _uuid4()
        u = User(id=uid, email="a@b.com", password_hash="hash", role="organizer")
        assert u.id == uid
        assert u.email == "a@b.com"

    def test_organizer_with_explicit_values(self):
        oid = _uuid4()
        o = Organizer(id=oid, user_id=_uuid4(), company_name="T", legal_id="1",
                      org_type="company", email="o@t.com", phone="+1",
                      country="EC", slug="t", status="pending",
                      subscription_status="none")
        assert o.id == oid
        assert o.company_name == "T"
        assert o.status == "pending"

    def test_event_with_explicit_values(self):
        eid = _uuid4()
        e = Event(id=eid, organizer_id=_uuid4(), tenant_slug="t", title="E",
                  slug="e", category="music", status="draft",
                  pricing_type="paid", visibility="public")
        assert e.id == eid
        assert e.title == "E"
        assert e.pricing_type == "paid"

    def test_ticket_order_with_explicit_values(self):
        oid = _uuid4()
        o = TicketOrder(id=oid, order_number="T-1", event_id=_uuid4(),
                        organizer_id=_uuid4(), buyer={"name": "A"},
                        buyer_email="a@b.com", status="pending")
        assert o.id == oid
        assert o.order_number == "T-1"
        assert o.status == "pending"

    def test_ticket_with_explicit_values(self):
        tid = _uuid4()
        t = Ticket(id=tid, order_id=_uuid4(), event_id=_uuid4(),
                   organizer_id=_uuid4(), order_number="T-1",
                   holder={}, holder_name="", holder_email="",
                   status="issued")
        assert t.id == tid
        assert t.status == "issued"

    def test_season_pass_with_explicit_values(self):
        sp = SeasonPass(id=_uuid4(), event_id=_uuid4(), organizer_id=_uuid4(),
                        name="A", credits_total=5, status="active")
        assert sp.name == "A"
        assert sp.credits_total == 5

    def test_season_pass_purchase_with_explicit_values(self):
        spp = SeasonPassPurchase(
            id=_uuid4(), season_pass_id=_uuid4(), event_id=_uuid4(),
            organizer_id=_uuid4(), purchase_token=_uuid4(),
            order_number="SP-1", buyer={}, buyer_email="", credits_total=1,
            status="pending",
        )
        assert spp.credits_total == 1

    def test_staff_member_with_explicit_values(self):
        sm = StaffMember(id=_uuid4(), organizer_id=_uuid4(), name="N",
                         email="e@e.com", password_hash="h", roles=[],
                         active=True)
        assert sm.name == "N"
        assert sm.active is True

    def test_venue_with_explicit_values(self):
        v = Venue(id=_uuid4(), organizer_id=_uuid4(), tenant_slug="t",
                  name="V", slug="v", status="draft", canvas={},
                  elements=[], localities=[])
        assert v.name == "V"
