"""seat_holds: partial unique index + pgbouncer-safe constraints

Adds a PARTIAL unique index on (event_id, seat_id) WHERE status = 'held'.
This is the database-level guarantee that eliminates the race condition where
two concurrent sessions could both pass the application-level availability
check and both successfully insert a hold for the same seat.

PostgreSQL enforces partial unique indexes atomically: the second INSERT will
block until the first transaction commits, then fail with UniqueViolationError,
which the service layer converts into a 409 response.

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-15
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Partial unique index: only one active hold per (event, seat) pair.
    # Historical rows with status='converted' or 'released' are excluded,
    # so the audit trail is preserved without conflicting with new holds.
    op.create_index(
        "uq_seat_holds_active",
        "seat_holds",
        ["event_id", "seat_id"],
        unique=True,
        postgresql_where="status = 'held'",
    )


def downgrade() -> None:
    op.drop_index("uq_seat_holds_active", table_name="seat_holds")
