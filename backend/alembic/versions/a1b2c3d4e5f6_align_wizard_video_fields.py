"""Align event wizard to TicketShow video model.

Adds event media/metadata fields, guest/access ticket limits.
locality_pricing fees live in JSONB (no column change).

Revision ID: a1b2c3d4e5f6
Revises: c3a9f2e71b04
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a1b2c3d4e5f6"
down_revision = "c3a9f2e71b04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("events", sa.Column("video_url", sa.Text(), nullable=True))
    op.add_column(
        "events",
        sa.Column(
            "keywords",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column("events", sa.Column("small_url", sa.Text(), nullable=True))

    op.add_column(
        "event_guest_list_entries",
        sa.Column("max_tickets", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "event_access_codes",
        sa.Column(
            "max_tickets_per_redemption",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("event_access_codes", "max_tickets_per_redemption")
    op.drop_column("event_guest_list_entries", "max_tickets")
    op.drop_column("events", "small_url")
    op.drop_column("events", "keywords")
    op.drop_column("events", "video_url")
    op.drop_column("events", "priority")
