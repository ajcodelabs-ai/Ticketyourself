"""event.suspension_appeal JSONB

Revision ID: d5c2e9f3b721
Revises: c4b1d8e2a610
Create Date: 2026-08-27

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "d5c2e9f3b721"
down_revision = "c4b1d8e2a610"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("suspension_appeal", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "suspension_appeal")
