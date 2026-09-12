"""Worker job: scan upcoming outdoor games for rain; expire alerts past kickoff."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.weather import service


async def scan_upcoming(db: AsyncSession) -> int:
    expired = await service.expire_past_alerts(db)
    created = await service.scan_lobbies(db)
    await db.commit()
    return expired + created
