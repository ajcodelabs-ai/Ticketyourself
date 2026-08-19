"""GIN trigram index on events.title / events.venue_city for fuzzy search

pg_trgm is enabled (migration 0008) and list_public_events already filters
with func.similarity()/ILIKE, but without a trigram index those queries run
a full sequential scan — this makes them index scans instead.

Revision ID: 075cc67fc62b
Revises: 0008
Create Date: 2026-08-19

"""
from alembic import op

revision = "075cc67fc62b"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_title_trgm "
        "ON events USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_venue_city_trgm "
        "ON events USING gin (venue_city gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_events_venue_city_trgm")
    op.execute("DROP INDEX IF EXISTS ix_events_title_trgm")
