"""admin: remember the previous sign-in (`admin_users.previous_login_at/ip`)

"Previous sign-in" in the console used to show the sign-in that had just happened, because `last_login_at`
is overwritten when the session opens. The value before the overwrite is now kept in its own columns.

Revision ID: 5b7e1d2a9c40
Revises: c09143179493
Create Date: 2026-09-12 22:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '5b7e1d2a9c40'
down_revision: str | None = 'c09143179493'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('admin_users', sa.Column('previous_login_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('admin_users', sa.Column('previous_login_ip', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('admin_users', 'previous_login_ip')
    op.drop_column('admin_users', 'previous_login_at')
