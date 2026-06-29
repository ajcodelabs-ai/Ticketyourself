"""add ticket_design / courtesy_ticket_design to events (M4)

Revision ID: c41f8b62d9a7
Revises: b934d7e1a3f0
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c41f8b62d9a7"
down_revision = "b934d7e1a3f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("ticket_design", postgresql.JSONB(), nullable=True))
    op.add_column(
        "events", sa.Column("courtesy_ticket_design", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "courtesy_ticket_design")
    op.drop_column("events", "ticket_design")
