"""Worker jobs for the lobby lifecycle."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.lobbies import service


async def expire_holds(db: AsyncSession) -> int:
    """Every 15 s: expire unpaid lobbies (refund → credits, slot released), release lapsed unpaid
    seats, and free any orphaned slot holds."""
    expired = await service.expire_due_lobbies(db)
    seats = await service.release_expired_seats(db)
    orphans = await service.release_orphan_holds(db)
    return expired + seats + orphans


async def complete_finished_matches(db: AsyncSession) -> int:
    """Every 60 s: confirmed matches whose slot has ended → completed (emits match.completed)."""
    return await service.complete_due_matches(db)
