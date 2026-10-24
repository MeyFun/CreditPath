"""Основание полномочий заявителя и документ-доверенность.

Revision ID: 0003_authority
Revises: 0002_related_employee
Create Date: 2026-10-24
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_authority"
down_revision: Union[str, None] = "0002_related_employee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("authority_basis", sa.String(length=20), nullable=True))
    op.add_column("applications", sa.Column("authority_document_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("applications", "authority_document_id")
    op.drop_column("applications", "authority_basis")
