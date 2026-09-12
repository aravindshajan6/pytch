"""Inbox read-side use-cases (list / mark read). Writes live in `service.py` (notify)."""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.core.timeutils import utcnow
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationOut, NotificationPage


async def list_page(
    db: AsyncSession, user_id: uuid.UUID, *, unread_only: bool, limit: int, offset: int
) -> NotificationPage:
    base = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    unread = (
        await db.scalar(
            select(func.count()).where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
        or 0
    )
    rows = await db.scalars(
        base.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).offset(offset)
    )
    return NotificationPage(
        items=[NotificationOut.model_validate(n) for n in rows.all()],
        total=total,
        limit=limit,
        offset=offset,
        unread_count=unread,
    )


async def mark_read(db: AsyncSession, user_id: uuid.UUID, notification_id: uuid.UUID) -> NotificationOut:
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user_id:
        raise NotFound("Notification not found")
    if notification.read_at is None:
        notification.read_at = utcnow()
        await db.commit()
    return NotificationOut.model_validate(notification)


async def mark_all_read(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    await db.commit()
    return int(result.rowcount or 0)
