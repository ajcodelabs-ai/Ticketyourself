"""strip stale `visibility` key from events.access_params (dup of events.visibility)

Revision ID: d3e9a1f5b274
Revises: c41f8b62d9a7
Create Date: 2026-06-29
"""
from alembic import op

revision = "d3e9a1f5b274"
down_revision = "c41f8b62d9a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `visibility` was duplicated inside access_params (JSONB) and kept in
    # sync by hand from the frontend. The real source of truth has always
    # been the top-level `events.visibility` column — drop the stale copy.
    op.execute("UPDATE events SET access_params = access_params - 'visibility'")


def downgrade() -> None:
    op.execute(
        "UPDATE events SET access_params = access_params || "
        "jsonb_build_object('visibility', visibility) "
        "WHERE access_params IS NOT NULL"
    )
