"""organizer.verificante JSONB for Verificante KYC (Ecuador persona natural)

Revision ID: f9c3b1a8d704
Revises: e1a4b7c2d905
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f9c3b1a8d704"
down_revision: Union[str, Sequence[str], None] = "e1a4b7c2d905"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("organizers")}
    if "kyc_check" in cols and "verificante" not in cols:
        op.alter_column(
            "organizers",
            "kyc_check",
            new_column_name="verificante",
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            existing_nullable=True,
        )
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
    op.execute("DROP INDEX IF EXISTS ix_organizers_verificante_verification_id")
    op.drop_column("organizers", "verificante")
