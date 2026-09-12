"""Schedule the recording pipeline when a recorded match completes (emitter's transaction)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.modules.highlights import service


@on("match.completed")
async def schedule_recording(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.schedule_recording(db, lobby_id)
