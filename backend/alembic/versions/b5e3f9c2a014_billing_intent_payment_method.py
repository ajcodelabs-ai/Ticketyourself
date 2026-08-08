"""billing intent payment_method

Revision ID: b5e3f9c2a014
Revises: a4d2e8a1b903
Create Date: 2026-08-08 14:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5e3f9c2a014"
down_revision: Union[str, Sequence[str], None] = "a4d2e8a1b903"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "billing_intents",
        sa.Column(
            "payment_method",
            sa.String(length=20),
            nullable=False,
            server_default="stripe",
        ),
    )


def downgrade() -> None:
    op.drop_column("billing_intents", "payment_method")
