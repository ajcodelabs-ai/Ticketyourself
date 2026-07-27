"""Add blocks JSONB column to microsites for page-builder layout.

Revision ID: f2b8c4d1e630
Revises: ee8615c95fc2
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "f2b8c4d1e630"
down_revision = "ee8615c95fc2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "microsites",
        sa.Column("blocks", JSONB, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("microsites", "blocks")
