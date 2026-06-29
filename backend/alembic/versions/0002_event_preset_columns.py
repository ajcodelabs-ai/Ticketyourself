"""add duration/sales_window preset columns to events

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("duration_preset", sa.String(40), nullable=True))
    op.add_column("events", sa.Column("sales_window_preset_start", sa.String(40), nullable=True))
    op.add_column("events", sa.Column("sales_window_preset_end", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "duration_preset")
    op.drop_column("events", "sales_window_preset_start")
    op.drop_column("events", "sales_window_preset_end")
