"""Event venue_layout snapshot + source_venue_id.

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import text

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("source_venue_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("venue_layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    # Backfill snapshots from the live venue for events that already have a link.
    op.execute(
        text(
            """
            UPDATE events e
            SET
                source_venue_id = e.venue_id,
                venue_layout = jsonb_build_object(
                    'canvas', COALESCE(v.canvas, '{}'::jsonb),
                    'elements', COALESCE(v.elements, '[]'::jsonb),
                    'localities', COALESCE(v.localities, '[]'::jsonb),
                    'capacity_calculated', COALESCE(v.capacity_calculated, 0),
                    'snapshotted_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'source_venue_id', e.venue_id
                )
            FROM venues v
            WHERE e.venue_id IS NOT NULL
              AND e.venue_layout IS NULL
              AND v.id = e.venue_id
            """
        )
    )


def downgrade() -> None:
    op.drop_column("events", "venue_layout")
    op.drop_column("events", "source_venue_id")
