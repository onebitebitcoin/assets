"""Add last_source column to assets

Revision ID: 001_add_last_source
Revises:
Create Date: 2025-01-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '001_add_last_source'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_source', sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('assets', schema=None) as batch_op:
        batch_op.drop_column('last_source')
