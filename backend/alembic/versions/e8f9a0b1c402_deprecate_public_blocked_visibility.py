"""Deprecate public_blocked visibility (PRD §4.2.2 TACHAR)

Revision ID: e8f9a0b1c402
Revises: d7e8f1a2b390
Create Date: 2026-08-08 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e8f9a0b1c402"
down_revision: Union[str, Sequence[str], None] = "d7e8f1a2b390"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PRD: "Público bloqueado" struck — gates live on access_type (lista/código).
    op.execute(
        "UPDATE events SET visibility = 'public' WHERE visibility = 'public_blocked'"
    )
    # link_only was a confused hybrid of visibility+access; treat as open purchase.
    op.execute(
        """
        UPDATE events
        SET access_params = jsonb_set(
            COALESCE(access_params, '{}'::jsonb),
            '{access_type}',
            '"open"'
        )
        WHERE access_params->>'access_type' = 'link_only'
        """
    )


def downgrade() -> None:
    # Irreversible data normalization — no-op.
    pass
