"""add subevento support: event_functions.kind + events.multi_function_mode

"Evento con Subeventos" (PDF §4.2.3) reuses EventFunction (capacity/pricing/
seat isolation already built for Multifunción) rather than a parallel model.
`kind` distinguishes a función (same show repeated, blocked from overlapping
a sibling in the same venue) from a subevent (independent add-on — sala VIP,
cena, meet & greet — allowed to run concurrently with the main event).
`multi_function_mode` on Event drives wording in the wizard/public pages and
the default `kind` for new funciones created under that event.

Revision ID: d4e6f3b8a219
Revises: c7d8e2a51f90
Create Date: 2026-06-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d4e6f3b8a219"
down_revision = "c7d8e2a51f90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_functions",
        sa.Column("kind", sa.String(20), nullable=False, server_default="function"),
    )
    op.add_column(
        "events",
        sa.Column("multi_function_mode", sa.String(20), nullable=False, server_default="function"),
    )


def downgrade() -> None:
    op.drop_column("events", "multi_function_mode")
    op.drop_column("event_functions", "kind")
