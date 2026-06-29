"""Phase 5 — redesign ticket_orders, tickets, ticket_scans + add missing cols

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-14

All six Phase-5 tables (ticket_orders, tickets, ticket_scans, seat_holds,
event_capacity_reservations, event_seat_assignments) are currently empty
(orders still live in MongoDB). We drop them and recreate with the new schema
rather than a series of ALTER TABLE operations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop in reverse FK order
    op.drop_table("ticket_scans")
    op.drop_table("event_seat_assignments")
    op.drop_table("seat_holds")
    op.drop_table("event_capacity_reservations")
    op.drop_table("tickets")
    op.drop_table("ticket_orders")

    # ── ticket_orders ────────────────────────────────────────────────────────
    op.create_table(
        "ticket_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("order_number", sa.String(20), unique=True, nullable=False),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("tenant_slug", sa.String(100), nullable=True),
        sa.Column("buyer", JSONB, nullable=False, server_default="{}"),
        sa.Column("buyer_email", sa.String(254), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("payment_method", sa.String(20), nullable=False, server_default="stripe"),
        sa.Column("quantity_total", sa.Integer, nullable=False, server_default="1"),
        sa.Column("subtotal_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fees_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="usd"),
        sa.Column("donation_amount_cents", sa.Integer, nullable=True),
        sa.Column("discount_total_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("discounts_applied", JSONB, nullable=False, server_default="[]"),
        sa.Column("stripe_session_id", sa.String(200), nullable=True),
        sa.Column("stripe_payment_intent_id", sa.String(200), nullable=True),
        sa.Column("manual_payment_info", JSONB, nullable=True),
        sa.Column("items", JSONB, nullable=False, server_default="[]"),
        sa.Column("seat_ids", JSONB, nullable=True),
        sa.Column("seat_holds_session_token", sa.String(200), nullable=True),
        sa.Column("seat_assignments", JSONB, nullable=False, server_default="[]"),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refund_reason", sa.Text, nullable=True),
    )
    op.create_index("ix_ticket_orders_event_id", "ticket_orders", ["event_id"])
    op.create_index("ix_ticket_orders_organizer_id", "ticket_orders", ["organizer_id"])
    op.create_index("ix_ticket_orders_buyer_email", "ticket_orders", ["buyer_email"])

    # ── tickets ──────────────────────────────────────────────────────────────
    op.create_table(
        "tickets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("ticket_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("ticket_type_id", sa.String(36), sa.ForeignKey("ticket_types.id"), nullable=True),
        sa.Column("tenant_slug", sa.String(100), nullable=True),
        sa.Column("order_number", sa.String(20), nullable=False),
        sa.Column("ticket_number", sa.String(30), nullable=True),
        sa.Column("holder", JSONB, nullable=False, server_default="{}"),
        sa.Column("holder_name", sa.String(140), nullable=False, server_default=""),
        sa.Column("holder_email", sa.String(254), nullable=False, server_default=""),
        sa.Column("qr_token", sa.Text, nullable=True),
        sa.Column("seat_id", sa.String(200), nullable=True),
        sa.Column("seat_label", sa.String(100), nullable=True),
        sa.Column("locality_name", sa.String(100), nullable=True),
        sa.Column("locality_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="issued"),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by", sa.String(100), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_tickets_order_id", "tickets", ["order_id"])
    op.create_index("ix_tickets_event_id", "tickets", ["event_id"])

    # ── ticket_scans ─────────────────────────────────────────────────────────
    op.create_table(
        "ticket_scans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ticket_id", sa.String(36), sa.ForeignKey("tickets.id"), nullable=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scanned_by", sa.String(100), nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("holder_name", sa.String(200), nullable=True),
        sa.Column("seat_label", sa.String(100), nullable=True),
    )
    op.create_index("ix_ticket_scans_ticket_id", "ticket_scans", ["ticket_id"])
    op.create_index("ix_ticket_scans_event_id", "ticket_scans", ["event_id"])

    # ── seat_holds ───────────────────────────────────────────────────────────
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
        sa.Column("held_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_seat_holds_event_id", "seat_holds", ["event_id"])

    # ── event_capacity_reservations ──────────────────────────────────────────
    op.create_table(
        "event_capacity_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_event_capacity_reservations_event_id", "event_capacity_reservations", ["event_id"])
    op.create_index("ix_event_capacity_reservations_order_id", "event_capacity_reservations", ["order_id"])

    # ── event_seat_assignments ───────────────────────────────────────────────
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
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_event_seat_assignments_event_id", "event_seat_assignments", ["event_id"])


def downgrade() -> None:
    op.drop_table("event_seat_assignments")
    op.drop_table("seat_holds")
    op.drop_table("event_capacity_reservations")
    op.drop_table("ticket_scans")
    op.drop_table("tickets")
    op.drop_table("ticket_orders")
    # Note: recreating the old schema on downgrade is not worth implementing.
    # To roll back, restore from backup or re-run migration 0001.
