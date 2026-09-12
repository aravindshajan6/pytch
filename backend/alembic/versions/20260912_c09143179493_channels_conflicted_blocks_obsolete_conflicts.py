"""channels: `conflicted` blocks and `obsolete` conflicts (data only)

An imported/pushed booking that could not claim any slot used to be stored as an *active* block holding nothing,
so it was counted and listed as a booking next to the real one. Such blocks are now `conflicted`; open conflicts
whose Pytch booking has since been released close themselves as `obsolete`. Both columns are plain strings, so
this revision only brings existing rows in line.

Revision ID: c09143179493
Revises: 044334a9ff70
Create Date: 2026-09-12 20:30:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'c09143179493'
down_revision: str | None = '044334a9ff70'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE slot_blocks b SET status = 'conflicted', updated_at = now()
        WHERE b.status = 'active' AND b.external_ref IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM slots s WHERE s.block_id = b.id)
        """
    )
    op.execute(
        """
        UPDATE sync_conflicts c
           SET status = 'obsolete', resolved_at = now(),
               resolution_note = 'Auto-closed: the Pytch booking on this slot was released'
        WHERE c.status = 'open' AND c.lobby_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM lobbies l WHERE l.id = c.lobby_id AND l.status IN ('expired', 'cancelled'))
        """
    )


def downgrade() -> None:
    op.execute("UPDATE slot_blocks SET status = 'active' WHERE status = 'conflicted'")
    op.execute("UPDATE sync_conflicts SET status = 'open', resolved_at = NULL, resolution_note = NULL "
               "WHERE status = 'obsolete'")
