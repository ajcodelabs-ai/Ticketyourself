"""Rename organizers.kyc_check → verificante (idempotent)

Revision ID: a1c9e2f4b806
Revises: f9c3b1a8d704
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1c9e2f4b806"
down_revision: Union[str, Sequence[str], None] = "f9c3b1a8d704"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("organizers")}
    if "kyc_check" in cols and "verificante" not in cols:
        op.execute("ALTER TABLE organizers RENAME COLUMN kyc_check TO verificante")
    elif "verificante" not in cols:
        op.add_column(
            "organizers",
            sa.Column(
                "verificante",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
        )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_organizers_verificante_verification_id "
        "ON organizers ((verificante->>'verification_id'))"
    )


def downgrade() -> None:
    pass
