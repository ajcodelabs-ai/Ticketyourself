"""add event guest list entries and access codes

Revision ID: 964b92c085da
Revises: 9a87c580fb0b
Create Date: 2026-06-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "964b92c085da"
down_revision = "9a87c580fb0b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_guest_list_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "event_id", sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("cedula", sa.String(40), nullable=True),
        sa.Column("name", sa.String(140), nullable=True),
        sa.Column("notes", sa.String(300), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_event_guest_list_entries_event_id", "event_guest_list_entries", ["event_id"]
    )
    op.create_index(
        "ix_event_guest_list_entries_organizer_id", "event_guest_list_entries", ["organizer_id"]
    )

    op.create_table(
        "event_access_codes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "event_id", sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("organizer_id", sa.String(36), sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("max_uses", sa.Integer, nullable=True),
        sa.Column("uses_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("event_id", "code", name="uq_accesscode_event_code"),
    )
    op.create_index(
        "ix_event_access_codes_event_id", "event_access_codes", ["event_id"]
    )
    op.create_index(
        "ix_event_access_codes_organizer_id", "event_access_codes", ["organizer_id"]
    )


def downgrade() -> None:
    op.drop_table("event_access_codes")
    op.drop_table("event_guest_list_entries")
