"""Ratings reacts to the match lifecycle (runs inside the emitter's transaction — never commits)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.modules.ratings import service


@on("match.completed")
async def open_rating_window(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.send_rating_requests(db, lobby_id)
