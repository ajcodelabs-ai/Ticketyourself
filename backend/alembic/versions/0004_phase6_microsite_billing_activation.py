"""Phase 6 — migrate microsites, billing_intents, activation_events, microsite_assets, event_assets

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-14

All Phase-6 tables are currently empty in PostgreSQL (data still lives in
MongoDB). We drop and recreate billing_intents and activation_events with the
updated schemas, and create the new microsite_assets and event_assets tables.
The microsites table already has the correct schema from migration 0001.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── billing_intents: add plan_id, mode, completed_at; rename stripe_session_id → session_id ──
    # Table is empty in PG (still on MongoDB), so drop + recreate is cleanest.
    op.drop_table("billing_intents")
    op.create_table(
        "billing_intents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("plan_id", sa.String(36), nullable=True),
        sa.Column("plan_code", sa.String(40), nullable=False),
        sa.Column("session_id", sa.String(200), nullable=True),
        sa.Column("mode", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_billing_intents_organizer_id", "billing_intents", ["organizer_id"])
    op.create_index("ix_billing_intents_session_id", "billing_intents", ["session_id"])

    # ── activation_events: add unique constraint (organizer_id, event_type) ──
    # Table is empty in PG, drop + recreate to add the unique constraint.
    op.drop_table("activation_events")
    op.create_table(
        "activation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organizer_id", "event_type", name="uq_activation_org_type"),
    )
    op.create_index("ix_activation_events_organizer_id", "activation_events", ["organizer_id"])

    # ── microsite_assets: new table ─────────────────────────────────────────
    op.create_table(
        "microsite_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("asset_type", sa.String(20), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(200), nullable=True),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_microsite_assets_organizer_id", "microsite_assets", ["organizer_id"])

    # ── event_assets: new table ─────────────────────────────────────────────
    op.create_table(
        "event_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_event_assets_event_id", "event_assets", ["event_id"])


def downgrade() -> None:
    op.drop_table("event_assets")
    op.drop_table("microsite_assets")
    op.drop_table("activation_events")
    op.drop_table("billing_intents")
    # Restore original billing_intents (without plan_id/mode/completed_at)
    op.create_table(
        "billing_intents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("plan_code", sa.String(40), nullable=False),
        sa.Column("stripe_session_id", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "activation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
