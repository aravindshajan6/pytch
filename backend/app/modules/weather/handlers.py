"""Close open weather alerts when a lobby dies (runs in the emitter's transaction)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.modules.weather import service


@on("lobby.cancelled")
async def close_on_cancel(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.close_open_alerts(db, lobby_id)


@on("lobby.expired")
async def close_on_expire(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.close_open_alerts(db, lobby_id)
