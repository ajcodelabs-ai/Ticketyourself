"""add document_types

Revision ID: 9a87c580fb0b
Revises: 9b413cbef299
Create Date: 2026-06-24 03:58:33.522416

"""
from alembic import op
import sqlalchemy as sa

revision = "9a87c580fb0b"
down_revision = "9b413cbef299"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_types",
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("code"),
    )


def downgrade() -> None:
    op.drop_table("document_types")
