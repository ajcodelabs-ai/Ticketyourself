"""Phase 8 — guest mode, multi-function, ticket types v2, staff

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-15

Changes:
  events          + is_multi_function, ticket_delivery_mode/hours/at
  ticket_types    + sale_start/end, max_per_buyer, is_early_bird, early_bird_closes_at
  ticket_orders   + order_token (guest link), function_id, tickets_sent_at
  tickets         + function_id, price_cents
  NEW: event_functions, function_ticket_types, staff_members, staff_event_assignments
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── events: multi-function & ticket delivery ──────────────────────────────
    op.add_column("events", sa.Column(
        "is_multi_function", sa.Boolean, nullable=False, server_default="false"
    ))
    op.add_column("events", sa.Column(
        "ticket_delivery_mode", sa.String(20), nullable=False, server_default="al_momento"
    ))
    # ticket_delivery_mode values: al_momento | horas_antes | fecha_especifica | manual
    op.add_column("events", sa.Column("ticket_delivery_hours", sa.Integer, nullable=True))
    op.add_column("events", sa.Column("ticket_delivery_at", sa.DateTime(timezone=True), nullable=True))

    # ── ticket_types: sale windows, buyer limits, early bird ─────────────────
    op.add_column("ticket_types", sa.Column("sale_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ticket_types", sa.Column("sale_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ticket_types", sa.Column("max_per_buyer", sa.Integer, nullable=True))
    op.add_column("ticket_types", sa.Column(
        "is_early_bird", sa.Boolean, nullable=False, server_default="false"
    ))
    op.add_column("ticket_types", sa.Column("early_bird_closes_at", sa.DateTime(timezone=True), nullable=True))

    # ── ticket_orders: guest token, function link, delivery tracking ──────────
    op.add_column("ticket_orders", sa.Column("order_token", sa.String(36), nullable=True))
    op.create_index("ix_ticket_orders_order_token", "ticket_orders", ["order_token"], unique=True)
    # function_id added after event_functions table is created (below)
    op.add_column("ticket_orders", sa.Column("tickets_sent_at", sa.DateTime(timezone=True), nullable=True))

    # ── tickets: function link, captured price ────────────────────────────────
    op.add_column("ticket_orders", sa.Column("function_id", sa.String(36), nullable=True))
    op.add_column("tickets", sa.Column("function_id", sa.String(36), nullable=True))
    op.add_column("tickets", sa.Column(
        "price_cents", sa.Integer, nullable=True,
    ))

    # ── event_functions ───────────────────────────────────────────────────────
    op.create_table(
        "event_functions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "event_id", sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(50), nullable=True),
        # Optional per-function venue (overrides the event-level venue)
        sa.Column("venue_id", sa.String(36), sa.ForeignKey("venues.id"), nullable=True),
        sa.Column("venue_name", sa.String(200), nullable=True),
        sa.Column("venue_address", sa.String(300), nullable=True),
        sa.Column("venue_city", sa.String(100), nullable=True),
        sa.Column("venue_country", sa.String(100), nullable=True),
        # [{locality_id, price_cents, max_tickets_per_purchase}] — overrides event-level if set
        sa.Column("locality_pricing", JSONB, nullable=False, server_default="[]"),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("tickets_sold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        # active | cancelled | soldout
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_event_functions_event_id", "event_functions", ["event_id"])
    op.create_index("ix_event_functions_organizer_id", "event_functions", ["organizer_id"])

    # ── function_ticket_types: per-function price/capacity overrides ──────────
    op.create_table(
        "function_ticket_types",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "function_id", sa.String(36),
            sa.ForeignKey("event_functions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "ticket_type_id", sa.String(36),
            sa.ForeignKey("ticket_types.id", ondelete="CASCADE"), nullable=False,
        ),
        # If null, inherits from ticket_type
        sa.Column("price_cents_override", sa.Integer, nullable=True),
        sa.Column("capacity_override", sa.Integer, nullable=True),
        sa.Column("tickets_sold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.UniqueConstraint("function_id", "ticket_type_id", name="uq_function_ticket_type"),
    )
    op.create_index("ix_function_ticket_types_function_id", "function_ticket_types", ["function_id"])

    # ── staff_members ─────────────────────────────────────────────────────────
    op.create_table(
        "staff_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organizer_id", sa.String(36),
            sa.ForeignKey("organizers.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("name", sa.String(140), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        # ["scanner", "cajero", "admin_evento"] — can have multiple
        sa.Column("roles", JSONB, nullable=False, server_default="[]"),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organizer_id", "email", name="uq_staff_org_email"),
    )
    op.create_index("ix_staff_members_organizer_id", "staff_members", ["organizer_id"])

    # ── staff_event_assignments ───────────────────────────────────────────────
    op.create_table(
        "staff_event_assignments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "staff_id", sa.String(36),
            sa.ForeignKey("staff_members.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column(
            "assigned_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("staff_id", "event_id", name="uq_staff_event_assignment"),
    )
    op.create_index("ix_staff_event_assignments_staff_id", "staff_event_assignments", ["staff_id"])
    op.create_index("ix_staff_event_assignments_event_id", "staff_event_assignments", ["event_id"])


def downgrade() -> None:
    op.drop_table("staff_event_assignments")
    op.drop_table("staff_members")
    op.drop_table("function_ticket_types")
    op.drop_table("event_functions")

    op.drop_column("tickets", "price_cents")
    op.drop_column("tickets", "function_id")
    op.drop_column("ticket_orders", "function_id")
    op.drop_column("ticket_orders", "tickets_sent_at")
    op.drop_index("ix_ticket_orders_order_token", table_name="ticket_orders")
    op.drop_column("ticket_orders", "order_token")

    op.drop_column("ticket_types", "early_bird_closes_at")
    op.drop_column("ticket_types", "is_early_bird")
    op.drop_column("ticket_types", "max_per_buyer")
    op.drop_column("ticket_types", "sale_end")
    op.drop_column("ticket_types", "sale_start")

    op.drop_column("events", "ticket_delivery_at")
    op.drop_column("events", "ticket_delivery_hours")
    op.drop_column("events", "ticket_delivery_mode")
    op.drop_column("events", "is_multi_function")
