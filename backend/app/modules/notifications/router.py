import uuid

from fastapi import APIRouter, Query

from app.core.deps import DB, CurrentUser
from app.modules.notifications import inbox
from app.modules.notifications.schemas import NotificationOut, NotificationPage

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationPage)
async def list_notifications(
    db: DB,
    user: CurrentUser,
    unread_only: bool = False,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> NotificationPage:
    return await inbox.list_page(db, user.id, unread_only=unread_only, limit=limit, offset=offset)


@router.post("/read-all")
async def read_all(db: DB, user: CurrentUser) -> dict:
    return {"updated": await inbox.mark_all_read(db, user.id)}


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def read_one(notification_id: uuid.UUID, db: DB, user: CurrentUser) -> NotificationOut:
    return await inbox.mark_read(db, user.id, notification_id)
