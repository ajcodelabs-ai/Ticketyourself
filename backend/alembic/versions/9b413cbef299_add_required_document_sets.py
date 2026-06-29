"""add required_document_sets

Revision ID: 9b413cbef299
Revises: 0007
Create Date: 2026-06-24 03:23:44.021324

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "9b413cbef299"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "required_document_sets",
        sa.Column("org_type", sa.String(length=20), nullable=False),
        sa.Column("doc_types", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("org_type"),
    )


def downgrade() -> None:
    op.drop_table("required_document_sets")
