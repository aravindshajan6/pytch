"""Bench reacts to lobby lifecycle (runs inside the emitter's transaction — never commits)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.modules.bench import service


@on("member.dropped")
async def auto_sos(
    db: AsyncSession,
    *,
    lobby_id: uuid.UUID,
    user_id: uuid.UUID,
    hours_to_kickoff: float,
    was_paid: bool,
    **_: object,
) -> None:
    await service.on_member_dropped(db, lobby_id, user_id, hours_to_kickoff, was_paid)


@on("sub.paid")
async def sub_paid(
    db: AsyncSession, *, lobby_id: uuid.UUID, user_id: uuid.UUID, sos_id: uuid.UUID | None = None, **_: object
) -> None:
    await service.on_sub_paid(db, lobby_id, user_id, sos_id)


@on("lobby.cancelled")
async def cancel_on_lobby_cancelled(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.cancel_open_sos(db, lobby_id)


@on("lobby.expired")
async def cancel_on_lobby_expired(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    await service.cancel_open_sos(db, lobby_id)
