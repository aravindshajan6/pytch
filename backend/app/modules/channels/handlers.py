"""Domain-event subscribers: keep the partner's "block it on your other apps" to-do list in step with Pytch bookings."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.modules.bookings.models import Booking
from app.modules.channels import mirror


@on("booking.created")
async def booking_took_slot(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    found = await mirror.lobby_slot_and_code(db, lobby_id)
    if found:
        await mirror.slot_taken(db, lobby_id=lobby_id, slot_id=found[0], booking_code=found[1])


@on("lobby.expired")
@on("lobby.cancelled")
async def booking_gave_slot_back(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    found = await mirror.lobby_slot_and_code(db, lobby_id)
    if found:
        await mirror.slot_released(db, lobby_id=lobby_id, slot_id=found[0], booking_code=found[1])


@on("lobby.transferred")
async def booking_moved(
    db: AsyncSession, *, lobby_id: uuid.UUID, old_slot_id: uuid.UUID, new_slot_id: uuid.UUID, **_: object
) -> None:
    """Moved indoors: the old venue unblocks, the new venue blocks (each only if it's a partner venue)."""
    found = await mirror.lobby_slot_and_code(db, lobby_id)
    if not found:
        return
    new_code = found[1]
    previous = select(Booking.transferred_from_id).where(Booking.code == new_code).scalar_subquery()
    old_code = await db.scalar(select(Booking.code).where(Booking.id == previous))
    await mirror.slot_released(db, lobby_id=lobby_id, slot_id=old_slot_id, booking_code=old_code or new_code)
    await mirror.slot_taken(db, lobby_id=lobby_id, slot_id=new_slot_id, booking_code=new_code)
