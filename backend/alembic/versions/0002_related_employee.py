"""Связанное лицо: клиент, аффилированный с сотрудником банка.

Revision ID: 0002_related_employee
Revises: 0001_initial
Create Date: 2026-10-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_related_employee"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("related_employee_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_related_employee_id", "users", "users", ["related_employee_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_related_employee_id", "users", type_="foreignkey")
    op.drop_column("users", "related_employee_id")
