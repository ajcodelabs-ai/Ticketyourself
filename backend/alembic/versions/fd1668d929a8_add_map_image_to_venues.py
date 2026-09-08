"""add map image to venues

Revision ID: fd1668d929a8
Revises: ef92fb1127ff
Create Date: 2026-09-08 08:47:54.556272

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd1668d929a8'
down_revision: Union[str, Sequence[str], None] = 'ef92fb1127ff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('venues', sa.Column('map_image_path', sa.Text(), nullable=True))
    op.add_column('venues', sa.Column('map_image_mime', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('venues', 'map_image_mime')
    op.drop_column('venues', 'map_image_path')
