"""add function_id to event_capacity_reservations

Revision ID: b3f2a91c7d44
Revises: 964b92c085da
Create Date: 2026-06-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "b3f2a91c7d44"
down_revision = "964b92c085da"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_capacity_reservations",
        sa.Column(
            "function_id", sa.String(36),
            sa.ForeignKey("event_functions.id"), nullable=True,
        ),
    )
    op.create_index(
        "ix_event_capacity_reservations_function_id",
        "event_capacity_reservations", ["function_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_event_capacity_reservations_function_id",
        table_name="event_capacity_reservations",
    )
    op.drop_column("event_capacity_reservations", "function_id")
