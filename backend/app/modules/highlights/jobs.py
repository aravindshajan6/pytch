"""Worker job: recording pipeline `scheduled → processing → ready`.

The MVP "processing" step assigns demo turf-camera footage from `media/footage` (duration from the
manifest or ffprobe) plus its thumbnail, then notifies the players.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.modules.highlights import service


async def process_recordings(db: AsyncSession) -> int:
    done = 0
    for recording_id in await service.claim_due(db):
        try:
            if await service.finish_recording(db, recording_id):
                done += 1
        except Exception:
            await db.rollback()
            logger.exception("highlights: processing recording %s failed", recording_id)
    return done
