import uuid
from datetime import datetime
from typing import Any

from app.core.pagination import Page
from app.core.schemas import Schema


class NotificationOut(Schema):
    id: uuid.UUID
    type: str
    title: str
    body: str
    data: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


class NotificationPage(Page[NotificationOut]):
    unread_count: int
