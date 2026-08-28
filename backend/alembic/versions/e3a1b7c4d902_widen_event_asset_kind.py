"""Widen event_assets.kind so ticket design slots fit (ticket_main_background)

Revision ID: e3a1b7c4d902
Revises: d1f4a9c2e836
Create Date: 2026-08-27
"""

import sqlalchemy as sa

from alembic import op

revision = "e3a1b7c4d902"
down_revision = "d1f4a9c2e836"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "event_assets",
        "kind",
        existing_type=sa.String(length=20),
        type_=sa.String(length=40),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "event_assets",
        "kind",
        existing_type=sa.String(length=40),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
