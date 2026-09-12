"""Publish realtime events to WebSocket clients through the Redis backplane.

Prefer `publish_on_commit` inside request/worker transactions — the event is sent only
after the surrounding transaction commits, so clients never refetch uncommitted state.
"""

import asyncio
from typing import Any

import orjson
from pydantic import BaseModel
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.logging import logger
from app.core.redis import get_redis
from app.core.timeutils import utcnow

CHANNEL_PREFIX = "pytch:ws:"
_PENDING_KEY = "pytch_pending_publish"
_background: set[asyncio.Task] = set()


def _to_jsonable(data: Any) -> Any:
    if isinstance(data, BaseModel):
        return data.model_dump(mode="json")
    if isinstance(data, list):
        return [_to_jsonable(d) for d in data]
    if isinstance(data, dict):
        return {k: _to_jsonable(v) for k, v in data.items()}
    return data


def build_envelope(channel: str, event_name: str, data: Any) -> bytes:
    return orjson.dumps(
        {"type": "event", "channel": channel, "event": event_name, "data": _to_jsonable(data), "ts": utcnow()}
    )


async def publish(channel: str, event_name: str, data: Any) -> None:
    """Publish immediately (use outside transactions, e.g. demo bots / after explicit commit)."""
    try:
        await get_redis().publish(CHANNEL_PREFIX + channel, build_envelope(channel, event_name, data))
    except Exception:  # realtime is best-effort; never break the business transaction
        logger.exception("realtime publish failed channel=%s event=%s", channel, event_name)


def publish_on_commit(db: AsyncSession, channel: str, event_name: str, data: Any) -> None:
    """Queue an event; it is published after `db.commit()` succeeds and dropped on rollback."""
    # serialise now: ORM objects may be expired after commit
    db.sync_session.info.setdefault(_PENDING_KEY, []).append(
        (channel, event_name, _to_jsonable(data))
    )


@event.listens_for(Session, "after_commit")
def _flush_pending(session: Session) -> None:
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    for channel, event_name, data in pending:
        task = loop.create_task(publish(channel, event_name, data))
        _background.add(task)
        task.add_done_callback(_background.discard)


@event.listens_for(Session, "after_rollback")
def _drop_pending(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)


# Channel helpers — keep channel naming in one place.
def user_channel(user_id: Any) -> str:
    return f"user:{user_id}"


def lobby_channel(lobby_id: Any) -> str:
    """Public lobby state (seat updates) — visible to anyone who can see the lobby."""
    return f"lobby:{lobby_id}"


def chat_channel(lobby_id: Any) -> str:
    """Lobby chat — current members only."""
    return f"chat:{lobby_id}"


def unsubscribe_on_commit(db: AsyncSession, user_id: Any, channel: str) -> None:
    """After commit, drop `channel` from every live socket of `user_id` on every instance (e.g. chat of a
    lobby they just left or were removed from)."""
    publish_on_commit(db, f"unsub:{user_id}", "unsubscribe", {"channel": channel})


def pitch_channel(pitch_id: Any) -> str:
    return f"pitch:{pitch_id}"
