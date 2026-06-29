"""add season_passes, season_pass_purchases, season_pass_redemptions

Abono de Temporada (PDF §4.2.3): the buyer prepays for N credits once, then
redeems each credit later against a specific función of the same event — "no
se bloquea un asiento, solo se precompra." A new model (not reusing
EventFunction) since this is a genuinely new concept: a purchasable product
spanning many future redemptions, with its own guest-access token.

Revision ID: e91a4c6f2b73
Revises: d4e6f3b8a219
Create Date: 2026-06-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e91a4c6f2b73"
down_revision = "d4e6f3b8a219"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "season_passes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "event_id", sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("credits_total", sa.Integer, nullable=False),
        sa.Column("max_passes", sa.Integer, nullable=True),
        sa.Column("passes_sold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("redemption_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redemption_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_season_passes_event_id", "season_passes", ["event_id"])
    op.create_index("ix_season_passes_organizer_id", "season_passes", ["organizer_id"])

    op.create_table(
        "season_pass_purchases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "season_pass_id", sa.String(36),
            sa.ForeignKey("season_passes.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("purchase_token", sa.String(36), nullable=False, unique=True),
        sa.Column("order_number", sa.String(20), nullable=False, unique=True),
        sa.Column("buyer", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("buyer_email", sa.String(254), nullable=False),
        sa.Column("credits_total", sa.Integer, nullable=False),
        sa.Column("credits_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("subtotal_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fees_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("payment_method", sa.String(20), nullable=False, server_default="stripe"),
        sa.Column("stripe_session_id", sa.String(200), nullable=True),
        sa.Column("manual_payment_info", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_season_pass_purchases_season_pass_id", "season_pass_purchases", ["season_pass_id"])
    op.create_index("ix_season_pass_purchases_event_id", "season_pass_purchases", ["event_id"])
    op.create_index("ix_season_pass_purchases_organizer_id", "season_pass_purchases", ["organizer_id"])
    op.create_index("ix_season_pass_purchases_purchase_token", "season_pass_purchases", ["purchase_token"])
    op.create_index("ix_season_pass_purchases_buyer_email", "season_pass_purchases", ["buyer_email"])

    op.create_table(
        "season_pass_redemptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "season_pass_purchase_id", sa.String(36),
            sa.ForeignKey("season_pass_purchases.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("function_id", sa.String(36), sa.ForeignKey("event_functions.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("ticket_orders.id"), nullable=False),
        sa.Column(
            "redeemed_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_season_pass_redemptions_purchase_id", "season_pass_redemptions",
        ["season_pass_purchase_id"],
    )
    op.create_index("ix_season_pass_redemptions_function_id", "season_pass_redemptions", ["function_id"])


def downgrade() -> None:
    op.drop_table("season_pass_redemptions")
    op.drop_table("season_pass_purchases")
    op.drop_table("season_passes")
