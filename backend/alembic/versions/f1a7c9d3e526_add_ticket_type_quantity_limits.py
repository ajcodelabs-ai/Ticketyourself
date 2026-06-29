"""add min_quantity / exact_quantity to ticket_types

Revision ID: f1a7c9d3e526
Revises: e91a4c6f2b73
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a7c9d3e526"
down_revision = "e91a4c6f2b73"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ticket_types", sa.Column("min_quantity", sa.Integer(), nullable=True))
    op.add_column("ticket_types", sa.Column("exact_quantity", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ticket_types", "exact_quantity")
    op.drop_column("ticket_types", "min_quantity")
