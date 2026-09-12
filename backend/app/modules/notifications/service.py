"""Notification fan-in: persist + push over the user's realtime channel (after commit)."""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationOut
from app.realtime.publisher import publish_on_commit, user_channel


async def notify(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> Notification:
    """Create a notification for one user. Caller commits."""
    notification = Notification(
        id=uuid.uuid4(),
        user_id=user_id,
        type=type,
        title=title[:120],
        body=body[:300],
        data={k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in (data or {}).items()},
        created_at=utcnow(),
    )
    db.add(notification)
    publish_on_commit(
        db, user_channel(user_id), "notification.new", NotificationOut.model_validate(notification)
    )
    return notification


async def notify_many(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID],
    type: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> None:
    for uid in set(user_ids):
        await notify(db, uid, type, title, body, data)
