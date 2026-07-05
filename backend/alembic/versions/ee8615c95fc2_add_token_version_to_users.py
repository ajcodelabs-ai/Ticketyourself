"""add token_version to users

Revision ID: ee8615c95fc2
Revises: aa86f1f4a997
Create Date: 2026-07-02 17:36:15.354294

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ee8615c95fc2'
down_revision: Union[str, Sequence[str], None] = 'aa86f1f4a997'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('token_version', sa.Integer(), nullable=True))
    op.execute("UPDATE users SET token_version = 0 WHERE token_version IS NULL")
    op.alter_column('users', 'token_version', nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'token_version')
