"""extend plans fees contract publish gates

Revision ID: c6f4a0d3b125
Revises: b5e3f9c2a014
Create Date: 2026-08-08 22:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c6f4a0d3b125"
down_revision: Union[str, Sequence[str], None] = "b5e3f9c2a014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── subscription_plans ────────────────────────────────────────────────────
    op.add_column(
        "subscription_plans",
        sa.Column("max_events_year", sa.Integer(), nullable=False, server_default="-1"),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "includes_marketing",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "allows_paid_events",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "allows_free_events",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column("access_types", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "verification_fee_cents", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "event_fee_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "event_fee_per_ticket_cents",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "event_fee_percent_bps", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "subscription_plans",
        sa.Column(
            "feature_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )

    # Seed sensible defaults for existing plans
    op.execute(
        """
        UPDATE subscription_plans SET verification_fee_cents = 1000
        WHERE code IN ('evento_unico', 'profesional', 'enterprise')
        """
    )
    op.execute(
        """
        UPDATE subscription_plans SET verification_fee_cents = 0
        WHERE code = 'basico'
        """
    )
    op.execute(
        """
        UPDATE subscription_plans SET
            event_fee_enabled = true,
            event_fee_per_ticket_cents = 10,
            event_fee_percent_bps = 50
        WHERE code IN ('profesional', 'enterprise', 'evento_unico')
        """
    )
    op.execute(
        """
        UPDATE subscription_plans SET includes_marketing = true
        WHERE code IN ('profesional', 'enterprise')
        """
    )

    # ── organizers ────────────────────────────────────────────────────────────
    op.add_column(
        "organizers", sa.Column("verification_fee_cents", sa.Integer(), nullable=True)
    )
    op.add_column(
        "organizers",
        sa.Column(
            "verification_fee_status",
            sa.String(length=20),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "organizers",
        sa.Column(
            "contract_status",
            sa.String(length=20),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "organizers",
        sa.Column("contract_external_id", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "organizers",
        sa.Column("contract_signed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── events ────────────────────────────────────────────────────────────────
    op.add_column(
        "events", sa.Column("country_code", sa.String(length=2), nullable=True)
    )
    op.add_column(
        "events",
        sa.Column(
            "pre_event_fee_cents", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "pre_event_fee_status",
            sa.String(length=20),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "events",
        sa.Column("pre_event_fee_paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "pre_event_fee_breakdown",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "pre_event_fee_breakdown")
    op.drop_column("events", "pre_event_fee_paid_at")
    op.drop_column("events", "pre_event_fee_status")
    op.drop_column("events", "pre_event_fee_cents")
    op.drop_column("events", "country_code")

    op.drop_column("organizers", "contract_signed_at")
    op.drop_column("organizers", "contract_external_id")
    op.drop_column("organizers", "contract_status")
    op.drop_column("organizers", "verification_fee_status")
    op.drop_column("organizers", "verification_fee_cents")

    op.drop_column("subscription_plans", "feature_flags")
    op.drop_column("subscription_plans", "event_fee_percent_bps")
    op.drop_column("subscription_plans", "event_fee_per_ticket_cents")
    op.drop_column("subscription_plans", "event_fee_enabled")
    op.drop_column("subscription_plans", "verification_fee_cents")
    op.drop_column("subscription_plans", "access_types")
    op.drop_column("subscription_plans", "allows_free_events")
    op.drop_column("subscription_plans", "allows_paid_events")
    op.drop_column("subscription_plans", "includes_marketing")
    op.drop_column("subscription_plans", "max_events_year")
