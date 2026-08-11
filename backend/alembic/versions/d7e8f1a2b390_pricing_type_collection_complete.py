"""Complete PRD §4.2.1 collection types: optional donation + ticket fees

Revision ID: d7e8f1a2b390
Revises: c6f4a0d3b125
Create Date: 2026-08-08 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d7e8f1a2b390"
down_revision: Union[str, Sequence[str], None] = "c6f4a0d3b125"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "optional_donation_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "ticket_fees",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "ticket_fees")
    op.drop_column("events", "optional_donation_enabled")
