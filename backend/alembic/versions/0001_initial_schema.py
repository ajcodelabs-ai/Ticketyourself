"""initial schema — full TYS PostgreSQL schema

Revision ID: 0001
Revises:
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Order number sequence ─────────────────────────────────────────────────
    op.execute("CREATE SEQUENCE IF NOT EXISTS ticket_order_seq START 1")

    # ── tenants ───────────────────────────────────────────────────────────────
    op.create_table(
        "tenants",
        sa.Column("slug", sa.String(60), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="organizer"),
        sa.Column("organizer_id", sa.String(36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # ── subscription_plans ────────────────────────────────────────────────────
    op.create_table(
        "subscription_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("price_cents", sa.Integer, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="usd"),
        sa.Column("billing_period", sa.String(20), nullable=False),
        sa.Column("features", JSONB, nullable=False, server_default="[]"),
        sa.Column("max_events", sa.Integer, nullable=False, server_default="-1"),
        sa.Column("max_tickets_per_event", sa.Integer, nullable=False, server_default="-1"),
        sa.Column("includes_numbered", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("includes_ai_design", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("includes_custom_domain", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("stripe_price_id", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_subscription_plans_code", "subscription_plans", ["code"])

    # ── organizers ────────────────────────────────────────────────────────────
    op.create_table(
        "organizers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("company_name", sa.String(120), nullable=False),
        sa.Column("legal_id", sa.String(40), nullable=False),
        sa.Column("org_type", sa.String(20), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("country", sa.String(40), nullable=False),
        sa.Column("slug", sa.String(60), sa.ForeignKey("tenants.slug"), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("rejection_reason", sa.Text, nullable=True),
        sa.Column("plan_id", sa.String(36), sa.ForeignKey("subscription_plans.id"), nullable=True),
        sa.Column("plan_code", sa.String(40), nullable=True),
        sa.Column("subscription_status", sa.String(20), nullable=False, server_default="none"),
        sa.Column("stripe_customer_id", sa.String(100), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(100), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(36), nullable=True),
    )
    op.create_index("ix_organizers_user_id", "organizers", ["user_id"])
    op.create_index("ix_organizers_slug", "organizers", ["slug"])

    # ── organizer_admin_comments ──────────────────────────────────────────────
    op.create_table(
        "organizer_admin_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organizer_id",
            sa.String(36),
            sa.ForeignKey("organizers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("admin_id", sa.String(36), nullable=False),
        sa.Column("admin_email", sa.String(254), nullable=True),
        sa.Column("comment", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_admin_comments_organizer", "organizer_admin_comments", ["organizer_id"])

    # ── organizer_documents ───────────────────────────────────────────────────
    op.create_table(
        "organizer_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organizer_id",
            sa.String(36),
            sa.ForeignKey("organizers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("doc_type", sa.String(30), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("file_path", sa.Text, nullable=True),
        sa.Column("is_demo", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_org_documents_organizer", "organizer_documents", ["organizer_id"])

    # ── venues ────────────────────────────────────────────────────────────────
    op.create_table(
        "venues",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("tenant_slug", sa.String(60), sa.ForeignKey("tenants.slug"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("type", sa.String(40), nullable=True),
        sa.Column("canvas", JSONB, nullable=False, server_default="{}"),
        sa.Column("elements", JSONB, nullable=False, server_default="[]"),
        sa.Column("localities", JSONB, nullable=False, server_default="[]"),
        sa.Column("capacity_calculated", sa.Integer, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("is_template", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organizer_id", "slug", name="uq_venue_org_slug"),
    )
    op.create_index("ix_venues_organizer", "venues", ["organizer_id"])

    # ── events ────────────────────────────────────────────────────────────────
    op.create_table(
        "events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("tenant_slug", sa.String(60), sa.ForeignKey("tenants.slug"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("short_description", sa.String(500), nullable=True),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("pricing_type", sa.String(20), nullable=False, server_default="free"),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="public"),
        sa.Column("venue_name", sa.String(200), nullable=True),
        sa.Column("venue_address", sa.String(300), nullable=True),
        sa.Column("venue_city", sa.String(100), nullable=True),
        sa.Column("venue_country", sa.String(100), nullable=True),
        sa.Column("location_lat", sa.Float, nullable=True),
        sa.Column("location_lng", sa.Float, nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(50), nullable=True),
        sa.Column("sales_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sales_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("venue_id", sa.String(36), sa.ForeignKey("venues.id"), nullable=True),
        sa.Column("venue_slug", sa.String(120), nullable=True),
        sa.Column("locality_pricing", JSONB, nullable=False, server_default="[]"),
        sa.Column("seat_holds_window_minutes", sa.Integer, nullable=True, server_default="10"),
        sa.Column("base_price_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("tickets_sold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("poster_url", sa.Text, nullable=True),
        sa.Column("banner_url", sa.Text, nullable=True),
        sa.Column("gallery_urls", JSONB, nullable=False, server_default="[]"),
        sa.Column("payment_methods", JSONB, nullable=False, server_default='{"stripe":{"enabled":true},"transfer":{"enabled":false},"cash":{"enabled":false}}'),
        sa.Column("discounts", JSONB, nullable=False, server_default="{}"),
        sa.Column("access_params", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organizer_id", "slug", name="uq_event_org_slug"),
    )
    op.create_index("ix_events_organizer", "events", ["organizer_id"])
    op.create_index("ix_events_status", "events", ["status"])

    # ── ticket_types ──────────────────────────────────────────────────────────
    op.create_table(
        "ticket_types",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="usd"),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("tickets_sold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("venue_locality_id", sa.String(36), nullable=True),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_ticket_types_event", "ticket_types", ["event_id"])

    # ── ticket_orders ─────────────────────────────────────────────────────────
    op.create_table(
        "ticket_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("order_number", sa.String(20), nullable=False, unique=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("buyer_name", sa.String(140), nullable=False),
        sa.Column("buyer_email", sa.String(254), nullable=False),
        sa.Column("buyer_phone", sa.String(40), nullable=True),
        sa.Column("buyer_document_id", sa.String(40), nullable=True),
        sa.Column("buyer_document_type", sa.String(20), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("payment_method", sa.String(20), nullable=False, server_default="stripe"),
        sa.Column("quantity_total", sa.Integer, nullable=False, server_default="1"),
        sa.Column("subtotal_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("platform_fee_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="usd"),
        sa.Column("stripe_session_id", sa.String(200), nullable=True),
        sa.Column("stripe_payment_intent_id", sa.String(200), nullable=True),
        sa.Column("manual_payment_instructions", JSONB, nullable=True),
        sa.Column("manual_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("manual_confirmed_by", sa.String(36), nullable=True),
        sa.Column("manual_rejection_reason", sa.Text, nullable=True),
        sa.Column("seat_assignments", JSONB, nullable=False, server_default="[]"),
        sa.Column("items", JSONB, nullable=False, server_default="[]"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_orders_event", "ticket_orders", ["event_id"])
    op.create_index("ix_orders_organizer", "ticket_orders", ["organizer_id"])
    op.create_index("ix_orders_buyer_email", "ticket_orders", ["buyer_email"])
    op.create_index("ix_orders_status", "ticket_orders", ["status"])

    # ── tickets ───────────────────────────────────────────────────────────────
    op.create_table(
        "tickets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("ticket_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("ticket_type_id", sa.String(36), sa.ForeignKey("ticket_types.id"), nullable=True),
        sa.Column("order_number", sa.String(20), nullable=False),
        sa.Column("ticket_number", sa.String(30), nullable=False),
        sa.Column("holder_name", sa.String(140), nullable=False),
        sa.Column("holder_email", sa.String(254), nullable=False),
        sa.Column("seat_label", sa.String(20), nullable=True),
        sa.Column("locality_name", sa.String(100), nullable=True),
        sa.Column("locality_id", sa.String(36), nullable=True),
        sa.Column("qr_token", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="issued"),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_tickets_order", "tickets", ["order_id"])
    op.create_index("ix_tickets_event", "tickets", ["event_id"])

    # ── ticket_scans ──────────────────────────────────────────────────────────
    op.create_table(
        "ticket_scans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ticket_id", sa.String(36), sa.ForeignKey("tickets.id"), nullable=False),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column(
            "scanned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("scanned_by", sa.String(100), nullable=True),
    )
    op.create_index("ix_scans_ticket", "ticket_scans", ["ticket_id"])

    # ── seat_holds ────────────────────────────────────────────────────────────
    op.create_table(
        "seat_holds",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("venue_id", sa.String(36), sa.ForeignKey("venues.id"), nullable=False),
        sa.Column("seat_id", sa.String(200), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("session_token", sa.String(200), nullable=True),
        sa.Column("buyer_email", sa.String(254), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="held"),
        sa.Column(
            "held_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_seat_holds_event", "seat_holds", ["event_id"])

    # ── event_capacity_reservations ───────────────────────────────────────────
    op.create_table(
        "event_capacity_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_capacity_res_event", "event_capacity_reservations", ["event_id"])
    op.create_index("ix_capacity_res_order", "event_capacity_reservations", ["order_id"])

    # ── event_seat_assignments ────────────────────────────────────────────────
    op.create_table(
        "event_seat_assignments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("venue_id", sa.String(36), sa.ForeignKey("venues.id"), nullable=False),
        sa.Column("seat_id", sa.String(200), nullable=False),
        sa.Column("ticket_id", sa.String(36), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=False),
        sa.Column("holder_email", sa.String(254), nullable=True),
        sa.Column("locality_id", sa.String(36), nullable=True),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_seat_assignments_event", "event_seat_assignments", ["event_id"])

    # ── microsites ────────────────────────────────────────────────────────────
    op.create_table(
        "microsites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False, unique=True),
        sa.Column("slug", sa.String(60), sa.ForeignKey("tenants.slug"), nullable=False, unique=True),
        sa.Column("template", sa.String(40), nullable=True),
        sa.Column("branding", JSONB, nullable=False, server_default="{}"),
        sa.Column("content", JSONB, nullable=False, server_default="{}"),
        sa.Column("social_links", JSONB, nullable=False, server_default="{}"),
        sa.Column("sections_enabled", JSONB, nullable=False, server_default="{}"),
        sa.Column("published", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── audit_log ─────────────────────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_user_id", sa.String(36), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_log_actor", "audit_log", ["actor_user_id"])

    # ── billing_intents ───────────────────────────────────────────────────────
    op.create_table(
        "billing_intents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("plan_code", sa.String(40), nullable=False),
        sa.Column("stripe_session_id", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── activation_events ─────────────────────────────────────────────────────
    op.create_table(
        "activation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_activation_events_organizer", "activation_events", ["organizer_id"])


def downgrade() -> None:
    op.drop_table("activation_events")
    op.drop_table("billing_intents")
    op.drop_table("audit_log")
    op.drop_table("microsites")
    op.drop_table("event_seat_assignments")
    op.drop_table("event_capacity_reservations")
    op.drop_table("seat_holds")
    op.drop_table("ticket_scans")
    op.drop_table("tickets")
    op.drop_table("ticket_orders")
    op.drop_table("ticket_types")
    op.drop_table("events")
    op.drop_table("venues")
    op.drop_table("organizer_documents")
    op.drop_table("organizer_admin_comments")
    op.drop_table("organizers")
    op.drop_table("subscription_plans")
    op.drop_table("users")
    op.drop_table("tenants")
    op.execute("DROP SEQUENCE IF EXISTS ticket_order_seq")
