"""Manual mirroring for venues that also sell on other apps (automatic sync off).

The front desk keeps every app consistent by hand, and Pytch makes sure nothing slips through:

* a Pytch booking takes a slot (held at booking time, before anyone pays) → open "block" task + live alert
  ("New PYTCH booking 7–8 PM · Pitch A — block it on your other apps");
* that booking releases the slot (expired unpaid, cancelled, moved) → if the block was already ticked off, an
  "unblock" task + alert; if it was still open, it's closed as `obsolete` (nothing to undo).

Alerts go to the partner-only realtime channel `venue:<turf_id>` (venue-scoped staff only get their venues).
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.core.timeutils import utcnow
from app.modules.bookings.models import Booking
from app.modules.channels.models import MirrorTask
from app.modules.lobbies.models import Lobby
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.realtime.publisher import publish_on_commit


def venue_channel(turf_id: Any) -> str:
    return f"venue:{turf_id}"


def task_event(task: MirrorTask, *, pitch_name: str, turf_name: str) -> dict[str, Any]:
    return {
        "id": str(task.id), "action": task.action, "status": task.status, "booking_code": task.booking_code,
        "pitch_id": str(task.pitch_id), "pitch_name": pitch_name, "turf_id": str(task.turf_id),
        "turf_name": turf_name, "start_at": task.start_at.isoformat(), "end_at": task.end_at.isoformat(),
    }


async def _context(db: AsyncSession, slot_id: uuid.UUID) -> tuple[Slot, Pitch, Turf] | None:
    """Slot + pitch + venue, only for venues run by a partner (no partner → nobody to alert)."""
    row = (await db.execute(
        select(Slot, Pitch, Turf).join(Pitch, Pitch.id == Slot.pitch_id).join(Turf, Turf.id == Pitch.turf_id)
        .where(Slot.id == slot_id)
    )).first()
    if row is None or row[2].provider_id is None:
        return None
    return row[0], row[1], row[2]


async def _task(db: AsyncSession, lobby_id: uuid.UUID, slot_id: uuid.UUID, action: str) -> MirrorTask | None:
    return await db.scalar(select(MirrorTask).where(
        MirrorTask.lobby_id == lobby_id, MirrorTask.slot_id == slot_id, MirrorTask.action == action
    ).with_for_update())


def _publish(db: AsyncSession, task: MirrorTask, pitch: Pitch, turf: Turf, event: str) -> None:
    publish_on_commit(db, venue_channel(turf.id), event, task_event(task, pitch_name=pitch.name, turf_name=turf.name))


async def slot_taken(db: AsyncSession, *, lobby_id: uuid.UUID, slot_id: uuid.UUID, booking_code: str) -> None:
    """A Pytch booking now holds `slot_id` → ask the front desk to block it elsewhere. Idempotent."""
    ctx = await _context(db, slot_id)
    if ctx is None:
        return
    slot, pitch, turf = ctx
    if slot.end_at <= utcnow() or await _task(db, lobby_id, slot_id, "block") is not None:
        return
    task = MirrorTask(
        id=uuid.uuid4(), provider_id=turf.provider_id, turf_id=turf.id, pitch_id=pitch.id, slot_id=slot.id,
        lobby_id=lobby_id, booking_code=booking_code, action="block", start_at=slot.start_at, end_at=slot.end_at,
        status="open", created_at=utcnow(),
    )
    db.add(task)
    await db.flush([task])
    _publish(db, task, pitch, turf, "mirror.task")


async def slot_released(db: AsyncSession, *, lobby_id: uuid.UUID, slot_id: uuid.UUID, booking_code: str) -> None:
    """The Pytch booking gave `slot_id` back. Blocked elsewhere already → "unblock" task; not yet → nothing to
    undo, so the open block task just closes. Idempotent."""
    ctx = await _context(db, slot_id)
    if ctx is None:
        return
    slot, pitch, turf = ctx
    now = utcnow()
    block = await _task(db, lobby_id, slot_id, "block")
    if block is not None and block.status == "open":
        block.status, block.resolved_at = "obsolete", now
        _publish(db, block, pitch, turf, "mirror.task_closed")
        return
    if slot.end_at <= now or await _task(db, lobby_id, slot_id, "unblock") is not None:
        return
    task = MirrorTask(
        id=uuid.uuid4(), provider_id=turf.provider_id, turf_id=turf.id, pitch_id=pitch.id, slot_id=slot.id,
        lobby_id=lobby_id, booking_code=booking_code, action="unblock", start_at=slot.start_at, end_at=slot.end_at,
        status="open", created_at=now,
    )
    db.add(task)
    await db.flush([task])
    _publish(db, task, pitch, turf, "mirror.task")


async def lobby_slot_and_code(db: AsyncSession, lobby_id: uuid.UUID) -> tuple[uuid.UUID, str] | None:
    row = (await db.execute(
        select(Lobby.slot_id, Booking.code).join(Booking, Booking.id == Lobby.booking_id).where(Lobby.id == lobby_id)
    )).first()
    return (row[0], row[1]) if row else None


# ─────────────────────────── partner-facing ───────────────────────────


async def list_tasks(
    db: AsyncSession, provider_id: uuid.UUID, turf_ids: list[uuid.UUID], *, status: str = "open", limit: int = 100
) -> list[tuple[MirrorTask, str, str, str | None]]:
    """Tasks for these venues; open ones only while the game is still ahead (past games need no mirroring)."""
    from app.modules.users.models import User

    q = (
        select(MirrorTask, Pitch.name, Turf.name, User.name)
        .join(Pitch, Pitch.id == MirrorTask.pitch_id).join(Turf, Turf.id == MirrorTask.turf_id)
        .outerjoin(User, User.id == MirrorTask.resolved_by_user_id)
        .where(MirrorTask.provider_id == provider_id, MirrorTask.turf_id.in_(turf_ids or [uuid.uuid4()]),
               MirrorTask.status == status)
    )
    if status == "open":
        q = q.where(MirrorTask.end_at > utcnow()).order_by(MirrorTask.start_at, MirrorTask.created_at)
    else:
        q = q.order_by(MirrorTask.resolved_at.desc().nulls_last())
    return [tuple(r) for r in (await db.execute(q.limit(limit))).all()]  # type: ignore[misc]


async def set_status(
    db: AsyncSession, provider_id: uuid.UUID, turf_ids: list[uuid.UUID], task_id: uuid.UUID, *,
    done: bool, user_id: uuid.UUID,
) -> tuple[MirrorTask, str, str]:
    task = await db.scalar(select(MirrorTask).where(MirrorTask.id == task_id).with_for_update())
    if task is None or task.provider_id != provider_id or task.turf_id not in turf_ids or task.status == "obsolete":
        raise NotFound("To-do not found")
    task.status = "done" if done else "open"
    task.resolved_at = utcnow() if done else None
    task.resolved_by_user_id = user_id if done else None
    pitch = await db.get(Pitch, task.pitch_id)
    turf = await db.get(Turf, task.turf_id)
    assert pitch is not None and turf is not None
    # other screens of the same venue drop / restore the item without a refetch storm
    _publish(db, task, pitch, turf, "mirror.task_updated")
    return task, pitch.name, turf.name
