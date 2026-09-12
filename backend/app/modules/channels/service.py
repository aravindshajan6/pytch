"""Multi-channel consistency core.

The `slots` table is the single source of truth. Every occupation — Pytch holds/bookings, walk-ins, phone and
other-app bookings, maintenance, iCal imports, Channel-API pushes — takes the same row lock on `slots`, so two
channels can never both win a slot inside Pytch. When an *external* system (iCal/API) reports a booking over a
slot Pytch has already sold, we never override it ("first confirmed wins"): a `SyncConflict` is recorded and the
venue owner + ops are alerted.

Locking: user-facing paths lock all covered slots in ONE statement with `FOR UPDATE SKIP LOCKED`; any row we
couldn't lock is being checked out by another transaction → `409 SLOT_LOCKED` (same fail-fast semantics as
`FOR UPDATE NOWAIT`, but we can tell the client exactly which slots).
"""

import hashlib
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

import orjson
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt
from app.core.errors import AppError, NotFound
from app.core.logging import logger
from app.core.redis import get_redis
from app.core.timeutils import IST, ist_day_bounds, ist_today, to_ist, utcnow
from app.modules.audit import service as audit
from app.modules.channels import fetch, ical
from app.modules.channels.models import ChannelFeed, ProviderWebhook, SlotBlock, SyncConflict, WebhookDelivery
from app.modules.channels.schemas import (
    BulkBlockRequest,
    BulkBlockResult,
    BulkSkipped,
    CreateBlockRequest,
    SlotBlockOut,
    UpdateBlockRequest,
)
from app.modules.lobbies.models import Lobby
from app.modules.notifications.service import notify_many
from app.modules.providers.service import owner_user_ids
from app.modules.slots import service as slots_service
from app.modules.slots.models import Slot
from app.modules.slots.service import SlotLocked, SlotUnavailable
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User

MAX_BLOCK_HOURS = 24
MAX_DAYS_AHEAD = 62
IMPORT_WINDOW_DAYS = 14
MAX_BULK_SLOTS = 3000
FEED_FAILURES_BEFORE_ERROR = 3
WEBHOOK_EVENTS = ("slot.booked", "slot.released", "slot.blocked", "block.cancelled")

SOURCE_LABELS = {
    "walk_in": "Walk-in",
    "phone": "Phone",
    "playo": "Playo",
    "hudle": "Hudle",
    "khelomore": "KheloMore",
    "other_app": "Other app",
    "ical": "Calendar",
    "api": "Channel API",
    "maintenance": "Maintenance",
    "pytch": "Pytch",
}


# a block that holds (or may again hold) slots: `conflicted` = external booking that couldn't claim any slot yet
LIVE_BLOCK_STATUSES = ("active", "conflicted")


SKIP_LABELS = {"past": "Already over", "locked": "Being booked right now", "held": "Pytch player paying",
               "booked": "Pytch booking", "blocked": "Blocked"}


def block_label(kind: str, source: str) -> str:
    """"Walk-in booking" / "Maintenance" / "Playo block" — what a block is, in words."""
    if source == "maintenance":
        return "Maintenance"
    return f"{SOURCE_LABELS.get(source, source)} {'booking' if kind == 'booking' else 'block'}"


class BlockInvalid(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid block"


@dataclass(frozen=True)
class Actor:
    """Who performed a channel mutation (for audit + `created_by_user_id`)."""

    type: str  # provider | api_key | system
    id: uuid.UUID | None
    label: str
    user_id: uuid.UUID | None = None


SYSTEM_ACTOR = Actor("system", None, "channel-sync")


def when_label(start: datetime, end: datetime) -> str:
    s, e = to_ist(start), to_ist(end)
    fmt = "%-I:%M %p"
    return f"{s:%a %-d %b}, {s.strftime(fmt)}–{e.strftime(fmt)}"


# ─────────────────────────── slot helpers ───────────────────────────


async def ensure_slots_until(db: AsyncSession, pitch: Pitch, until: datetime) -> None:
    """Materialise hourly slots beyond the rolling horizon when a block reaches further out."""
    days = (to_ist(until).date() - ist_today()).days + 1
    if days > settings.slot_horizon_days:
        await slots_service.generate_slots_for_pitch(db, pitch, days=min(days, MAX_DAYS_AHEAD + 1))
        await db.flush()


async def covered_slots(db: AsyncSession, pitch_id: uuid.UUID, start: datetime, end: datetime) -> list[Slot]:
    """Slots of a pitch overlapping [start, end) — current DB state (a long-lived session may hold stale rows)."""
    rows = await db.execute(
        select(Slot)
        .where(Slot.pitch_id == pitch_id, Slot.start_at < end, Slot.end_at > start)
        .order_by(Slot.start_at)
        .execution_options(populate_existing=True)
    )
    return list(rows.unique().scalars().all())


async def lock_slots(db: AsyncSession, slot_ids: list[uuid.UUID]) -> list[Slot]:
    """Row-lock every slot in one statement; raise `SlotLocked` naming any slot another transaction holds."""
    if not slot_ids:
        return []
    await db.flush()
    rows = await db.execute(
        select(Slot)
        .where(Slot.id.in_(slot_ids))
        .order_by(Slot.start_at)
        .with_for_update(skip_locked=True, of=Slot)
        .execution_options(populate_existing=True)
    )
    locked = list(rows.unique().scalars().all())
    missing = set(slot_ids) - {s.id for s in locked}
    if missing:
        raise SlotLocked(details={"slot_ids": sorted(str(m) for m in missing)})
    return locked


async def _lock_block_slots(db: AsyncSession, block_id: uuid.UUID) -> list[Slot]:
    """Blocking row lock on the slots of a block (internal transitions must not fail fast)."""
    await db.flush()
    rows = await db.execute(
        select(Slot)
        .where(Slot.block_id == block_id)
        .order_by(Slot.start_at)
        .with_for_update(of=Slot)
        .execution_options(populate_existing=True)
    )
    return list(rows.unique().scalars().all())


# ─────────────────────────── serialisation ───────────────────────────


async def block_outs(db: AsyncSession, blocks: list[SlotBlock]) -> list[SlotBlockOut]:
    pitch_ids = {b.pitch_id for b in blocks}
    user_ids = {b.created_by_user_id for b in blocks if b.created_by_user_id}
    pitches = {
        p.id: p for p in (await db.execute(select(Pitch).where(Pitch.id.in_(pitch_ids)))).unique().scalars().all()
    } if pitch_ids else {}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()) if user_ids else {}
    out = []
    for b in blocks:
        pitch = pitches.get(b.pitch_id)
        out.append(
            SlotBlockOut(
                id=b.id,
                pitch_id=b.pitch_id,
                pitch_name=pitch.name if pitch else "",
                turf_name=pitch.turf.name if pitch else "",
                start_at=b.start_at,
                end_at=b.end_at,
                kind=b.kind,  # type: ignore[arg-type]
                source=b.source,  # type: ignore[arg-type]
                status=b.status,  # type: ignore[arg-type]
                customer_name=b.customer_name,
                customer_phone=b.customer_phone,
                amount_paise=b.amount_paise,
                payment_mode=b.payment_mode,  # type: ignore[arg-type]
                notes=b.notes,
                external_ref=b.external_ref,
                created_by_name=names.get(b.created_by_user_id) if b.created_by_user_id else None,
                created_at=b.created_at,
            )
        )
    return out


async def block_out(db: AsyncSession, block: SlotBlock) -> SlotBlockOut:
    return (await block_outs(db, [block]))[0]


# ─────────────────────────── webhooks (enqueue) ───────────────────────────


async def enqueue_event(
    db: AsyncSession,
    provider_id: uuid.UUID,
    event: str,
    *,
    pitch_id: uuid.UUID,
    start_at: datetime,
    end_at: datetime,
    status: str,
) -> int:
    """Queue one signed delivery per subscribed webhook. Payload carries no PII. Caller commits."""
    hooks = (
        await db.scalars(
            select(ProviderWebhook.id).where(
                ProviderWebhook.provider_id == provider_id,
                ProviderWebhook.is_active.is_(True),
                ProviderWebhook.events.contains([event]),
            )
        )
    ).all()
    if not hooks:
        return 0
    now = utcnow()
    payload = {
        "id": f"evt_{uuid.uuid4().hex}",
        "event": event,
        "occurred_at": now.isoformat(),
        "pitch_id": str(pitch_id),
        "start_at": start_at.astimezone(UTC).isoformat(),
        "end_at": end_at.astimezone(UTC).isoformat(),
        "status": status,
    }
    for hook_id in hooks:
        db.add(WebhookDelivery(id=uuid.uuid4(), webhook_id=hook_id, event=event, payload=payload, status="pending",
                               attempts=0, next_attempt_at=now))
    return len(hooks)


async def _provider_of_slot(db: AsyncSession, slot: Slot) -> uuid.UUID | None:
    pitch = slot.__dict__.get("pitch")
    turf = pitch.__dict__.get("turf") if pitch is not None else None
    if turf is not None:
        return turf.provider_id
    return await db.scalar(
        select(Turf.provider_id).join(Pitch, Pitch.turf_id == Turf.id).where(Pitch.id == slot.pitch_id)
    )


async def close_obsolete_conflicts(db: AsyncSession, *where: object, note: str) -> int:
    """Auto-close open conflicts that no longer describe a clash (status `obsolete`): the Pytch booking was released,
    the booking holding the slot was cancelled, or the external booking / its feed is gone. Caller commits."""
    result = await db.execute(
        update(SyncConflict)
        .where(SyncConflict.status == "open", *where)  # type: ignore[arg-type]
        .values(status="obsolete", resolution_note=note[:500], resolved_at=utcnow())
        .execution_options(synchronize_session="fetch")
    )
    return max(result.rowcount or 0, 0)  # type: ignore[attr-defined]


async def on_slot_changed(db: AsyncSession, slot: Slot, event: str) -> None:
    """Hook called by `slots.service` on hold/book/release of any slot."""
    if event == "slot.released":  # the Pytch game/hold is gone → nothing is double booked any more
        await close_obsolete_conflicts(db, SyncConflict.slot_id == slot.id, SyncConflict.lobby_id.is_not(None),
                                       note="Auto-closed: the Pytch booking on this slot was released")
    provider_id = await _provider_of_slot(db, slot)
    if provider_id is None:
        return
    await enqueue_event(db, provider_id, event, pitch_id=slot.pitch_id, start_at=slot.start_at, end_at=slot.end_at,
                        status=slot.status)


# ─────────────────────────── manual blocks (partner portal) ───────────────────────────


def validate_range(pitch: Pitch, start: datetime, end: datetime, now: datetime) -> None:
    if not pitch.is_active:
        raise BlockInvalid("This pitch is switched off")
    if end - start > timedelta(hours=MAX_BLOCK_HOURS):
        raise BlockInvalid("One block can cover at most 24 hours — use bulk block for longer periods")
    if end <= now:
        raise BlockInvalid("That time has already passed")
    if start > now + timedelta(days=MAX_DAYS_AHEAD):
        raise BlockInvalid(f"Blocks can be at most {MAX_DAYS_AHEAD} days ahead")


async def _new_block(db: AsyncSession, **fields: object) -> SlotBlock:
    block = SlotBlock(id=uuid.uuid4(), status="active", **fields)
    db.add(block)
    await db.flush([block])
    return block


async def create_block(
    db: AsyncSession, *, provider_id: uuid.UUID, pitch: Pitch, req: CreateBlockRequest, actor: Actor
) -> SlotBlock:
    """Occupy [start, end) on one pitch. Every covered slot must be available (never overrides)."""
    now = utcnow()
    validate_range(pitch, req.start_at, req.end_at, now)
    await ensure_slots_until(db, pitch, req.end_at)
    candidates = [s for s in await covered_slots(db, pitch.id, req.start_at, req.end_at) if s.end_at > now]
    if not candidates:
        raise BlockInvalid("There are no bookable hours in that range")
    locked = await lock_slots(db, [s.id for s in candidates])
    busy = [s for s in locked if s.status != "available"]
    if busy:
        raise SlotUnavailable("Some of those hours are already taken",
                              details={"slot_ids": [str(s.id) for s in busy]})
    block = await _new_block(
        db, provider_id=provider_id, pitch_id=pitch.id, start_at=req.start_at, end_at=req.end_at, kind=req.kind,
        source=req.source, customer_name=req.customer_name, customer_phone=req.customer_phone,
        amount_paise=req.amount_paise, payment_mode=req.payment_mode, notes=req.notes,
        created_by_user_id=actor.user_id,
    )
    for s in locked:
        await slots_service.block_slot(db, s, block.id)
    await enqueue_event(db, provider_id, "slot.blocked", pitch_id=pitch.id, start_at=block.start_at,
                        end_at=block.end_at, status="blocked")
    await audit.record(
        db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action="block.create",
        target_type="slot_block", target_id=block.id,
        summary=f"{SOURCE_LABELS[req.source]} {req.kind} on {pitch.name} · {pitch.turf.name}, "
                f"{when_label(req.start_at, req.end_at)}",
        changes={"pitch_id": str(pitch.id), "source": req.source, "kind": req.kind, "slots": len(locked),
                 "start_at": req.start_at, "end_at": req.end_at, "amount_paise": req.amount_paise},
    )
    await db.commit()
    return block


async def update_block(db: AsyncSession, *, block: SlotBlock, req: UpdateBlockRequest, actor: Actor) -> SlotBlock:
    if block.status != "active":
        raise BlockInvalid("This block was cancelled" if block.status == "cancelled"
                           else "This imported booking isn't holding any slot — resolve its conflict instead")
    fields = req.model_dump(exclude_unset=True)
    if "amount_paise" in fields and fields["amount_paise"] is None:
        fields.pop("amount_paise")
    before = {k: getattr(block, k) for k in fields}
    for k, v in fields.items():
        setattr(block, k, v)
    changes = audit.diff(before, fields)
    if changes:
        # customer details are the venue's own data, but keep them out of the tamper-proof log
        redacted = {k: (["…", "…"] if k in ("customer_name", "customer_phone", "notes") else v)
                    for k, v in changes.items()}
        await audit.record(db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label,
                           action="block.update", target_type="slot_block", target_id=block.id,
                           summary=f"Edited {SOURCE_LABELS.get(block.source, block.source)} block", changes=redacted)
    await db.commit()
    return block


async def cancel_block_rows(db: AsyncSession, block: SlotBlock) -> int:
    """Release the block's slots + mark cancelled + webhook + close the conflicts it was part of. Caller commits."""
    slots = await _lock_block_slots(db, block.id)
    for s in slots:
        await slots_service.unblock_slot(db, s)
    block.status = "cancelled"
    block.cancelled_at = utcnow()
    if slots:  # a conflicted block never occupied anything → nothing to announce
        await enqueue_event(db, block.provider_id, "block.cancelled", pitch_id=block.pitch_id,
                            start_at=block.start_at, end_at=block.end_at, status="available")
        await close_obsolete_conflicts(
            db, SyncConflict.slot_id.in_([s.id for s in slots]), SyncConflict.lobby_id.is_(None),
            note=f"Auto-closed: the {SOURCE_LABELS.get(block.source, block.source)} booking holding this slot was "
                 "cancelled")
    if block.external_ref:  # this block was the external side of a clash
        await close_obsolete_conflicts(
            db, SyncConflict.provider_id == block.provider_id, SyncConflict.source == block.source,
            SyncConflict.external_ref == block.external_ref,
            note=f"Auto-closed: the {SOURCE_LABELS.get(block.source, block.source)} booking was removed")
    return len(slots)


async def cancel_block(db: AsyncSession, *, block: SlotBlock, actor: Actor, reason: str = "cancelled") -> None:
    if block.status == "cancelled":
        return
    released = await cancel_block_rows(db, block)
    await audit.record(db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action="block.cancel",
                       target_type="slot_block", target_id=block.id,
                       summary=f"Cancelled {SOURCE_LABELS.get(block.source, block.source)} block "
                               f"({when_label(block.start_at, block.end_at)}) — {reason}"[:300],
                       changes={"released_slots": released})
    await db.commit()


def _parse_hhmm(value: str) -> time | None:
    if value == "24:00":
        return None
    h, m = value.split(":")
    return time(int(h), int(m))


async def bulk_block(
    db: AsyncSession, *, provider_id: uuid.UUID, pitches: list[Pitch], req: BulkBlockRequest, actor: Actor
) -> BulkBlockResult:
    """Recurring blocks (e.g. maintenance every Monday 06–08). Occupied/locked/past slots are skipped, never
    overridden. Each contiguous run of free slots in a window becomes one block."""
    now = utcnow()
    if req.date_to > ist_today() + timedelta(days=MAX_DAYS_AHEAD):
        raise BlockInvalid(f"Blocks can be at most {MAX_DAYS_AHEAD} days ahead")
    t_from, t_to = _parse_hhmm(req.time_from), _parse_hhmm(req.time_to)
    assert t_from is not None
    weekdays = set(req.weekdays)
    windows: dict[tuple[uuid.UUID, date], tuple[datetime, datetime]] = {}
    day = req.date_from
    while day <= req.date_to:
        if day.weekday() in weekdays:
            w_start = datetime.combine(day, t_from, tzinfo=IST).astimezone(UTC)
            w_end = (datetime.combine(day, t_to, tzinfo=IST) if t_to else
                     datetime.combine(day + timedelta(days=1), time.min, tzinfo=IST)).astimezone(UTC)
            for p in pitches:
                windows[(p.id, day)] = (w_start, w_end)
        day += timedelta(days=1)
    if not windows:
        return BulkBlockResult(created=0, slots=0, skipped=[])

    range_start, _ = ist_day_bounds(req.date_from)
    _, range_end = ist_day_bounds(req.date_to)
    for p in pitches:
        if not p.is_active:
            raise BlockInvalid(f"{p.name} is switched off")
        await ensure_slots_until(db, p, range_end - timedelta(minutes=1))
    rows = await db.execute(
        select(Slot)
        .where(Slot.pitch_id.in_([p.id for p in pitches]), Slot.start_at >= range_start, Slot.start_at < range_end)
        .order_by(Slot.pitch_id, Slot.start_at)
    )
    by_window: dict[tuple[uuid.UUID, date], list[Slot]] = defaultdict(list)
    for s in rows.unique().scalars().all():
        key = (s.pitch_id, to_ist(s.start_at).date())
        w = windows.get(key)
        if w and s.start_at < w[1] and s.end_at > w[0]:
            by_window[key].append(s)
    total = sum(len(v) for v in by_window.values())
    if total > MAX_BULK_SLOTS:
        raise BlockInvalid(f"That covers {total} hours — split it into smaller ranges (max {MAX_BULK_SLOTS})")

    skipped: list[BulkSkipped] = []
    future_ids: list[uuid.UUID] = []
    for group in by_window.values():
        for s in group:
            if s.end_at <= now:
                skipped.append(BulkSkipped(slot_id=s.id, start_at=s.start_at, reason="past", label=SKIP_LABELS["past"]))
            else:
                future_ids.append(s.id)
    locked_rows = []
    if future_ids:
        await db.flush()
        locked_rows = list(
            (
                await db.execute(
                    select(Slot)
                    .where(Slot.id.in_(future_ids))
                    .with_for_update(skip_locked=True, of=Slot)
                    .execution_options(populate_existing=True)
                )
            ).unique().scalars().all()
        )
    locked = {s.id: s for s in locked_rows}
    holder_ids = {s.block_id for s in locked_rows if s.status == "blocked" and s.block_id}
    holders: dict[uuid.UUID, SlotBlock] = {}
    if holder_ids:  # say *what* is in the way ("Walk-in booking"), not just "blocked"
        holders = {b.id: b for b in (await db.scalars(select(SlotBlock).where(SlotBlock.id.in_(holder_ids)))).all()}

    def skip_label(row: Slot | None) -> str:
        if row is None or row.status != "blocked":
            return SKIP_LABELS["locked" if row is None else row.status]
        b = holders.get(row.block_id)  # type: ignore[arg-type]
        return block_label(b.kind, b.source) if b else "Blocked"

    created = 0
    covered = 0

    async def flush_run(run: list[Slot]) -> None:
        nonlocal created, covered
        if not run:
            return
        block = await _new_block(
            db, provider_id=provider_id, pitch_id=run[0].pitch_id, start_at=run[0].start_at,
            end_at=run[-1].end_at, kind=req.kind, source=req.source, notes=req.notes, amount_paise=0,
            created_by_user_id=actor.user_id,
        )
        for slot in run:
            await slots_service.block_slot(db, slot, block.id)
        await enqueue_event(db, provider_id, "slot.blocked", pitch_id=block.pitch_id, start_at=block.start_at,
                            end_at=block.end_at, status="blocked")
        created += 1
        covered += len(run)

    for key in sorted(by_window, key=lambda k: (str(k[0]), k[1])):
        run: list[Slot] = []
        for s in by_window[key]:
            if s.end_at <= now:
                continue
            row = locked.get(s.id)
            if row is None or row.status != "available":
                reason = "locked" if row is None else row.status
                skipped.append(BulkSkipped(slot_id=s.id, start_at=s.start_at, reason=reason, label=skip_label(row)))
                await flush_run(run)
                run = []
            elif run and run[-1].end_at != row.start_at:
                await flush_run(run)
                run = [row]
            else:
                run.append(row)
        await flush_run(run)

    await audit.record(
        db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action="block.bulk_create",
        target_type="provider", target_id=provider_id,
        summary=f"Bulk {SOURCE_LABELS[req.source]} {req.kind}: {created} blocks ({covered} hours), "
                f"{len(skipped)} hours skipped ({req.date_from}–{req.date_to} {req.time_from}–{req.time_to})",
        changes={"pitch_ids": [str(p.id) for p in pitches], "weekdays": sorted(weekdays), "created": created,
                 "slots": covered, "skipped": len(skipped)},
    )
    await db.commit()
    skipped.sort(key=lambda k: k.start_at)
    return BulkBlockResult(created=created, slots=covered, skipped=skipped)


# ─────────────────────────── external bookings (iCal / Channel API) ───────────────────────────


@dataclass
class SyncResult:
    block: SlotBlock | None
    outcome: str  # created | updated | unchanged | conflict
    conflict_slot_ids: list[uuid.UUID] = field(default_factory=list)
    conflict_ids: list[uuid.UUID] = field(default_factory=list)


async def _record_conflict(
    db: AsyncSession,
    *,
    provider_id: uuid.UUID,
    pitch: Pitch,
    slot: Slot,
    source: str,
    external_ref: str | None,
    start: datetime,
    end: datetime,
    feed_id: uuid.UUID | None,
) -> SyncConflict | None:
    """Surface (never silently resolve) an external booking over occupied inventory. Deduplicated per slot+ref
    (an auto-closed `obsolete` one doesn't count: the slot was freed and has been taken again since)."""
    dup = await db.scalar(
        select(SyncConflict).where(
            SyncConflict.provider_id == provider_id,
            SyncConflict.slot_id == slot.id,
            SyncConflict.source == source,
            SyncConflict.external_ref == external_ref,
            SyncConflict.status != "obsolete",
        ).order_by(SyncConflict.created_at.desc()).limit(1)
    )
    if dup is not None:
        return dup if dup.status == "open" else None
    lobby = None
    if slot.booking_id is not None:
        lobby = (await db.execute(select(Lobby).where(Lobby.booking_id == slot.booking_id))).unique().scalar()
    other = await db.get(SlotBlock, slot.block_id) if lobby is None and slot.block_id is not None else None
    if lobby is not None:
        what = f"Pytch game “{lobby.title}”"
        if lobby.status in ("confirmed", "completed"):
            kept = "Pytch kept the confirmed Pytch game (its players have paid)"
        else:
            kept = "The Pytch game still holds the slot while its players pay (it's released if they don't)"
    elif other is not None:
        what = f"a {block_label(other.kind, other.source).lower()}"
        kept = f"The {block_label(other.kind, other.source).lower()} logged first keeps the slot"
    else:
        what = "an existing booking"
        kept = "The booking made first keeps the slot"
    summary = f"{SOURCE_LABELS.get(source, source)} booking {when_label(start, end)} overlaps {what}"[:300]
    conflict = SyncConflict(
        id=uuid.uuid4(), provider_id=provider_id, pitch_id=pitch.id, slot_id=slot.id,
        lobby_id=lobby.id if lobby else None, source=source, feed_id=feed_id, external_ref=external_ref,
        external_start_at=start, external_end_at=end, summary=summary, status="open",
    )
    db.add(conflict)
    await db.flush([conflict])
    owners = await owner_user_ids(db, provider_id)
    await notify_many(
        db, owners, "sync_conflict", "Double booking detected ⚠️",
        f"{summary} at {pitch.turf.name}. {kept} — resolve it in Channels."[:500],
        {"url": "/partner/channels", "conflict_id": conflict.id},
    )
    await audit.record(
        db, actor_type="system", actor_id=None, actor_label="channel-sync", action="channel.conflict",
        target_type="sync_conflict", target_id=conflict.id, summary=summary,
        changes={"provider_id": str(provider_id), "pitch_id": str(pitch.id), "slot_id": str(slot.id),
                 "source": source, "lobby_id": str(lobby.id) if lobby else None},
    )
    return conflict


async def sync_external_block(
    db: AsyncSession,
    *,
    provider_id: uuid.UUID,
    pitch: Pitch,
    source: str,
    external_ref: str,
    start: datetime,
    end: datetime,
    customer_name: str | None = None,
    feed_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    strict: bool = False,
) -> SyncResult:
    """Idempotent upsert of an externally-sourced booking keyed by (provider, source, external_ref).

    * unchanged event → no writes;
    * moved/resized → slots no longer covered are released, new ones claimed;
    * a covered slot occupied by Pytch (held/booked) or another block → `SyncConflict` (+ alerts), never overridden.
      An event that ends up holding no slot at all is stored as `conflicted` (not a booking: never counted or
      listed as one); a later sync claims the slots if they free up.
    * `strict` (Channel API): nothing is applied when anything is taken and no conflict is recorded — the write is
      simply rejected (caller answers 409), so nothing was double booked.
    Raises `SlotLocked` when a needed slot is mid-checkout elsewhere (caller retries later). Caller commits.
    """
    now = utcnow()
    existing = (
        await db.execute(
            select(SlotBlock)
            .where(SlotBlock.provider_id == provider_id, SlotBlock.source == source,
                   SlotBlock.external_ref == external_ref)
            .with_for_update()
        )
    ).scalar_one_or_none()
    own_id = existing.id if existing is not None else None
    desired = [s for s in await covered_slots(db, pitch.id, start, end) if s.end_at > now]
    desired_ids = {s.id for s in desired}
    current: list[Slot] = []
    if existing is not None:
        current = [s for s in (await db.execute(select(Slot).where(Slot.block_id == existing.id)
                                                .execution_options(populate_existing=True))).unique()
                   .scalars().all()]
    foreign = [s for s in desired if s.status != "available" and (s.block_id is None or s.block_id != own_id)]
    to_claim = [s for s in desired if s.status == "available"]
    to_release = [s for s in current if s.id not in desired_ids and s.end_at > now]
    same_shape = (
        existing is not None and existing.status in LIVE_BLOCK_STATUSES and existing.pitch_id == pitch.id
        and existing.start_at == start and existing.end_at == end
    )

    async def conflicts_for(slots: list[Slot]) -> list[uuid.UUID]:
        ids = []
        for s in slots:
            c = await _record_conflict(db, provider_id=provider_id, pitch=pitch, slot=s, source=source,
                                       external_ref=external_ref, start=start, end=end, feed_id=feed_id)
            if c is not None:
                ids.append(c.id)
        return ids

    if strict and foreign:
        return SyncResult(existing, "conflict", [s.id for s in foreign])
    if same_shape and not to_claim and not to_release:
        assert existing is not None
        if customer_name != existing.customer_name:
            existing.customer_name = customer_name
        conflict_ids = await conflicts_for(foreign)
        return SyncResult(existing, "conflict" if foreign else "unchanged", [s.id for s in foreign], conflict_ids)

    locked = {s.id: s for s in await lock_slots(db, [s.id for s in to_claim + to_release])}
    # re-check under the lock: a slot may have been taken since we looked
    raced = [locked[s.id] for s in to_claim if locked[s.id].status != "available"]
    if strict and raced:
        return SyncResult(existing, "conflict", [s.id for s in raced])

    if existing is None:
        block = await _new_block(
            db, provider_id=provider_id, pitch_id=pitch.id, start_at=start, end_at=end, kind="booking",
            source=source, customer_name=customer_name, external_ref=external_ref, feed_id=feed_id,
            api_key_id=api_key_id, amount_paise=0,
        )
        outcome = "created"
    else:
        block = existing
        outcome = "updated"
        if block.status == "cancelled":
            outcome = "created"
        block.cancelled_at = None
        block.pitch_id, block.start_at, block.end_at = pitch.id, start, end
        block.customer_name = customer_name
        if feed_id is not None:
            block.feed_id = feed_id
        if api_key_id is not None:
            block.api_key_id = api_key_id
    released = claimed = 0
    for s in to_release:
        row = locked[s.id]
        if row.block_id == block.id:
            await slots_service.unblock_slot(db, row)
            released += 1
    for s in to_claim:
        row = locked[s.id]
        if row.status == "available":
            await slots_service.block_slot(db, row, block.id)
            claimed += 1
    released_ids = {s.id for s in to_release}
    kept = sum(1 for s in current if s.id not in released_ids)  # still covered, or already played
    block.status = "active" if kept + claimed else "conflicted"
    all_foreign = foreign + raced
    conflict_ids = await conflicts_for(all_foreign)
    if claimed or released:
        await enqueue_event(db, provider_id, "slot.blocked", pitch_id=pitch.id, start_at=start, end_at=end,
                            status="blocked")
    if block.status == "conflicted":
        outcome = "conflict"
    return SyncResult(block, outcome, [s.id for s in all_foreign], conflict_ids)


# ─────────────────────────── iCal feed import ───────────────────────────

_FULL_SYNC_KEY = "pytch:feed-full:"
FULL_SYNC_EVERY_SECONDS = 6 * 3600  # re-read without ETag periodically: the 14-day window moves


def feed_ref(feed_id: uuid.UUID, event_ref: str) -> str:
    """External refs are namespaced per feed (the same calendar may be imported onto two pitches)."""
    return f"f{feed_id.hex[:8]}:{event_ref}"[:200]


async def _mark_feed_failure(db: AsyncSession, feed: ChannelFeed, message: str, now: datetime) -> None:
    feed.consecutive_failures = (feed.consecutive_failures or 0) + 1
    feed.last_error = message[:300]
    feed.last_synced_at = now
    if feed.consecutive_failures >= FEED_FAILURES_BEFORE_ERROR and feed.last_status != "error":
        feed.last_status = "error"
        owners = await owner_user_ids(db, feed.provider_id)
        await notify_many(db, owners, "channel_feed_error", "Calendar sync is failing",
                          f"“{feed.name}” couldn't be read {feed.consecutive_failures} times in a row: {message}"[:300],
                          {"url": "/partner/channels", "feed_id": feed.id})
        await audit.record(db, actor_type="system", actor_id=None, actor_label="channel-sync",
                           action="channel.feed_error", target_type="channel_feed", target_id=feed.id,
                           summary=f"Feed “{feed.name}” failing: {message}"[:300],
                           changes={"provider_id": str(feed.provider_id), "failures": feed.consecutive_failures})


def _feed_error_message(exc: Exception) -> str:
    if isinstance(exc, AppError):
        return exc.message
    return str(exc) or type(exc).__name__


async def sync_feed(db: AsyncSession, feed: ChannelFeed, *, body: bytes | None = None,
                    etag: str | None = None) -> ChannelFeed:
    """Poll one feed and reconcile its blocks. Never raises for upstream problems (recorded on the feed).
    Commits."""
    now = utcnow()
    redis = get_redis()
    try:
        if body is None:
            use_etag = feed.etag if (feed.last_status == "ok" and await redis.exists(_FULL_SYNC_KEY + str(feed.id))) \
                else None
            result = await fetch.safe_get(decrypt(feed.url_enc), etag=use_etag)
            if result.not_modified:
                feed.last_synced_at, feed.last_status, feed.last_error = now, "ok", None
                feed.consecutive_failures = 0
                await db.commit()
                return feed
            body, etag = result.body, result.etag
        events = ical.parse_feed(body, window_start=now, window_end=now + timedelta(days=IMPORT_WINDOW_DAYS))
    except (fetch.UnsafeUrl, fetch.FetchError, ical.FeedParseError, ValueError) as exc:
        await _mark_feed_failure(db, feed, _feed_error_message(exc), now)
        await db.commit()
        return feed

    pitch = await db.get(Pitch, feed.pitch_id)
    if pitch is None:
        return feed
    seen: set[str] = set()
    for ev in events:
        ref = feed_ref(feed.id, ev.ref)
        seen.add(ref)
        try:
            async with db.begin_nested():
                await sync_external_block(
                    db, provider_id=feed.provider_id, pitch=pitch, source=feed.source, external_ref=ref,
                    start=ev.start, end=ev.end, customer_name=ev.summary, feed_id=feed.id,
                )
        except SlotLocked:
            continue  # mid-checkout elsewhere — next poll retries
    stale_q = select(SlotBlock).where(
        SlotBlock.feed_id == feed.id, SlotBlock.status.in_(LIVE_BLOCK_STATUSES), SlotBlock.end_at > now
    )
    if seen:
        stale_q = stale_q.where(SlotBlock.external_ref.not_in(seen))
    for block in (await db.scalars(stale_q)).all():
        await cancel_block_rows(db, block)  # removed / cancelled upstream
    feed.etag = etag[:200] if etag else None
    feed.last_synced_at, feed.last_status, feed.last_error = now, "ok", None
    feed.consecutive_failures = 0
    feed.last_event_count = len(events)
    await db.commit()
    await redis.set(_FULL_SYNC_KEY + str(feed.id), "1", ex=FULL_SYNC_EVERY_SECONDS)
    return feed


# ─────────────────────────── iCal export ───────────────────────────


async def export_calendar(db: AsyncSession, token: str) -> tuple[bytes, str]:
    """Public, token-addressed busy feed of one pitch. Returns (ics bytes, etag). No PII."""
    if not token:
        raise NotFound("Calendar not found")
    pitch = (await db.execute(select(Pitch).where(Pitch.ical_export_token == token))).unique().scalar_one_or_none()
    if pitch is None:
        raise NotFound("Calendar not found")
    now = utcnow()
    rows = (
        await db.execute(
            select(Slot.id, Slot.start_at, Slot.end_at, Slot.updated_at)
            .where(Slot.pitch_id == pitch.id, Slot.status.in_(("held", "booked", "blocked")),
                   Slot.end_at > now - timedelta(days=1), Slot.start_at < now + timedelta(days=MAX_DAYS_AHEAD))
            .order_by(Slot.start_at)
        )
    ).all()
    busy = [(r[0], r[1], r[2], r[3]) for r in rows]
    fingerprint = hashlib.sha256(orjson.dumps([[str(r[0]), r[1], r[2]] for r in busy])).hexdigest()[:32]
    body = ical.build_export(calendar_name=f"{pitch.name} · {pitch.turf.name} (Pytch)", busy=busy)
    return body, f'"{fingerprint}"'


def log_job_error(what: str, exc: BaseException) -> None:
    logger.warning("channels: %s failed: %s", what, exc, exc_info=exc)
