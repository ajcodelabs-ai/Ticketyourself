"""add function_id to seat_holds and event_seat_assignments

Multi-función numbered events shared one seat pool across all funciones
(selling seat A1 for the 3pm show also marked it sold for the 8pm show).
This scopes seat holds/assignments per función so each one has its own
independent seat map, using "" (not NULL) as the "no función" sentinel —
PostgreSQL unique indexes treat NULL as distinct-from-itself, which would
silently defeat the existing uq_seat_holds_active race-condition guard for
every non-multi-función event.

Revision ID: c7d8e2a51f90
Revises: b3f2a91c7d44
Create Date: 2026-06-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c7d8e2a51f90"
down_revision = "b3f2a91c7d44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "seat_holds",
        sa.Column("function_id", sa.String(36), nullable=False, server_default=""),
    )
    op.add_column(
        "event_seat_assignments",
        sa.Column("function_id", sa.String(36), nullable=False, server_default=""),
    )
    op.create_index("ix_seat_holds_function_id", "seat_holds", ["function_id"])
    op.create_index(
        "ix_event_seat_assignments_function_id", "event_seat_assignments", ["function_id"]
    )

    op.drop_index("uq_seat_holds_active", table_name="seat_holds")
    op.create_index(
        "uq_seat_holds_active",
        "seat_holds",
        ["event_id", "function_id", "seat_id"],
        unique=True,
        postgresql_where="status = 'held'",
    )


def downgrade() -> None:
    op.drop_index("uq_seat_holds_active", table_name="seat_holds")
    op.create_index(
        "uq_seat_holds_active",
        "seat_holds",
        ["event_id", "seat_id"],
        unique=True,
        postgresql_where="status = 'held'",
    )
    op.drop_index("ix_event_seat_assignments_function_id", table_name="event_seat_assignments")
    op.drop_index("ix_seat_holds_function_id", table_name="seat_holds")
    op.drop_column("event_seat_assignments", "function_id")
    op.drop_column("seat_holds", "function_id")
