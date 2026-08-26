"""Platform settings: global pre-event fee switch.

Revision ID: c8a1e4f2b017
Revises: 075cc67fc62b
Create Date: 2026-08-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c8a1e4f2b017"
down_revision = "075cc67fc62b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
    op.execute(
        """
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES (
            'pre_event_fee_required',
            '{"enabled": false}'::jsonb,
            NOW()
        )
        """
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
