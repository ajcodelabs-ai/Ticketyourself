"""event iva_percent for SRI electronic invoices

Revision ID: e1a4b7c2d905
Revises: d8f2a1c9e704
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "e1a4b7c2d905"
down_revision = "d8f2a1c9e704"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("iva_percent", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "iva_percent")
