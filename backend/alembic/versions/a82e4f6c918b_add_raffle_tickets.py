"""add raffle ticket support for donation events

Revision ID: a82e4f6c918b
Revises: f1a7c9d3e526
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "a82e4f6c918b"
down_revision = "f1a7c9d3e526"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("raffle_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "events",
        sa.Column("raffle_numbers_issued", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("tickets", sa.Column("raffle_number", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("tickets", "raffle_number")
    op.drop_column("events", "raffle_numbers_issued")
    op.drop_column("events", "raffle_enabled")
