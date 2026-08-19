"""Enable pg_trgm extension for fuzzy event search

Installs the pg_trgm PostgreSQL extension (if not already present) so that
`similarity()` and trigram-based GIN indexes are available. The extension is
idempotent — running this migration on a DB that already has pg_trgm is safe.

The `list_public_events` endpoint probes for the extension at runtime and falls
back to ILIKE when it's absent; this migration makes the full fuzzy-search path
permanent across all environments.

Revision ID: 0008
Revises: b47829e0dcbf
Create Date: 2026-08-19
"""

from alembic import op

revision = "0008"
down_revision = "b47829e0dcbf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    # Dropping the extension is intentionally a no-op: other DB objects
    # (indexes, operators) may depend on it and removal could be destructive.
    # Remove manually if truly needed: DROP EXTENSION pg_trgm CASCADE;
    pass
