"""event suspend fields (admin moderation)

Revision ID: c4b1d8e2a610
Revises: b2e8c1d4a907
Create Date: 2026-08-27

"""

from alembic import op
import sqlalchemy as sa

revision = "c4b1d8e2a610"
down_revision = "b2e8c1d4a907"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("status_before_suspend", sa.String(20), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("suspended_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "suspended_reason")
    op.drop_column("events", "suspended_at")
    op.drop_column("events", "status_before_suspend")
