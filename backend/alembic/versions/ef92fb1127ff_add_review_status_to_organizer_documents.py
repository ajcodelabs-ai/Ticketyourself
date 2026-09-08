"""add review status to organizer_documents

Revision ID: ef92fb1127ff
Revises: a1c9e2f4b806
Create Date: 2026-09-08 07:59:49.303371

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef92fb1127ff'
down_revision: Union[str, Sequence[str], None] = 'a1c9e2f4b806'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'organizer_documents',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
    )
    op.add_column('organizer_documents', sa.Column('review_comment', sa.Text(), nullable=True))
    op.add_column(
        'organizer_documents',
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column('organizer_documents', sa.Column('reviewed_by', sa.String(length=36), nullable=True))


def downgrade() -> None:
    op.drop_column('organizer_documents', 'reviewed_by')
    op.drop_column('organizer_documents', 'reviewed_at')
    op.drop_column('organizer_documents', 'review_comment')
    op.drop_column('organizer_documents', 'status')
