"""Worker job: auto-off stale benchers and expire SOS past kickoff.

Unpaid sub seats past `reserved_until` are released by the lobbies hold-expiry job.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.bench import service


async def expire_bench_and_sos(db: AsyncSession) -> int:
    processed = await service.expire_stale(db)
    await db.commit()
    return processed
