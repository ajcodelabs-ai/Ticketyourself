"""add custom_questions to events (§4.2.8)

Revision ID: b934d7e1a3f0
Revises: a82e4f6c918b
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b934d7e1a3f0"
down_revision = "a82e4f6c918b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "custom_questions", postgresql.JSONB(), nullable=False, server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "custom_questions")
