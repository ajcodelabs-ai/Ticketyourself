"""grandfather already-approved organizers past new publish gates

Revision ID: b47829e0dcbf
Revises: e8f9a0b1c402
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "b47829e0dcbf"
down_revision: Union[str, Sequence[str], None] = "e8f9a0b1c402"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Organizers approved before contract_status/verification_fee_status
    # existed were never asked to sign a contract or pay a verification fee.
    # Without this, the new publish gate in routers/events.py
    # (_require_organizer_can_publish) blocks every one of them the next
    # time they try to publish, since both columns default to 'none'.
    op.execute(
        """
        UPDATE organizers
        SET contract_status = 'signed',
            verification_fee_status = 'waived'
        WHERE status = 'approved'
          AND contract_status = 'none'
          AND verification_fee_status = 'none'
        """
    )


def downgrade() -> None:
    # Data-only backfill; reverting would re-block already-grandfathered
    # organizers, so there's nothing safe to undo here.
    pass
