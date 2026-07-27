"""Add microsite SEO field and revision history table.

Revision ID: c3a9f2e71b04
Revises: f2b8c4d1e630
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c3a9f2e71b04"
down_revision = "f2b8c4d1e630"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "microsites",
        sa.Column("seo", JSONB, nullable=False, server_default="{}"),
    )
    op.create_table(
        "microsite_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "microsite_id",
            sa.String(36),
            sa.ForeignKey("microsites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_microsite_revisions_microsite_id", "microsite_revisions", ["microsite_id"])


def downgrade() -> None:
    op.drop_index("ix_microsite_revisions_microsite_id", table_name="microsite_revisions")
    op.drop_table("microsite_revisions")
    op.drop_column("microsites", "seo")
