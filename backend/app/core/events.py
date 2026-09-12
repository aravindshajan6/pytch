"""In-process domain event bus.

Modules react to each other's lifecycle without importing each other:

    # publisher (e.g. lobbies/service.py)
    await emit(db, "match.completed", lobby_id=lobby.id)

    # subscriber (e.g. ratings/handlers.py)
    @on("match.completed")
    async def open_rating_window(db: AsyncSession, *, lobby_id: uuid.UUID) -> None: ...

Handlers run inline, in the caller's session/transaction (the caller commits), in registration order.
A failing handler raises — keep handlers small and idempotent.

Handler modules must be imported for registration; see `app.modules.register_event_handlers`.

Event catalogue (payload kwargs):
    lobby.confirmed   lobby_id
    match.completed   lobby_id
    member.dropped    lobby_id, user_id, member_id, hours_to_kickoff: float, was_paid: bool
    sub.paid          lobby_id, user_id, member_id, sos_id: UUID | None
    lobby.cancelled   lobby_id
    lobby.expired     lobby_id
    lobby.transferred lobby_id, old_slot_id, new_slot_id
"""

from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger

Handler = Callable[..., Awaitable[None]]
_handlers: dict[str, list[Handler]] = defaultdict(list)


def on(event: str) -> Callable[[Handler], Handler]:
    def decorator(fn: Handler) -> Handler:
        if fn not in _handlers[event]:
            _handlers[event].append(fn)
        return fn

    return decorator


async def emit(db: AsyncSession, event: str, **payload: Any) -> None:
    for handler in _handlers.get(event, []):
        logger.debug("event %s -> %s.%s", event, handler.__module__, handler.__name__)
        await handler(db, **payload)
