"""Per-instance WebSocket connection registry + Redis pattern-subscription fan-out."""

import asyncio
from collections import defaultdict

import orjson
from fastapi import WebSocket

from app.core.logging import logger
from app.core.redis import get_redis
from app.realtime.publisher import CHANNEL_PREFIX

MAX_CHANNELS_PER_CONNECTION = 50
MAX_CONNECTIONS_PER_USER = 10
SESSION_CHANNEL_PREFIX = "session:"  # internal control channel: a message here closes that session's sockets
UNSUB_CHANNEL_PREFIX = "unsub:"  # internal control channel: `unsub:<user_id>` {"channel": …} drops a subscription


class ConnectionManager:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._by_ws: dict[WebSocket, set[str]] = defaultdict(set)
        self._by_user: dict[str, set[WebSocket]] = defaultdict(set)
        self._task: asyncio.Task | None = None

    # ── lifecycle ──
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._listen_forever(), name="ws-redis-listener")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ── connections ──
    def register(self, ws: WebSocket, user_id: object) -> bool:
        """Track a socket for its user; False when the per-user connection cap is reached."""
        sockets = self._by_user[str(user_id)]
        if len(sockets) >= MAX_CONNECTIONS_PER_USER:
            return False
        sockets.add(ws)
        return True

    # ── subscriptions ──
    def subscribe(self, ws: WebSocket, channel: str) -> bool:
        """False when the connection already holds MAX_CHANNELS_PER_CONNECTION channels."""
        mine = self._by_ws[ws]
        if channel not in mine and len(mine) >= MAX_CHANNELS_PER_CONNECTION:
            return False
        mine.add(channel)
        self._channels[channel].add(ws)
        return True

    def unsubscribe(self, ws: WebSocket, channel: str) -> None:
        self._by_ws.get(ws, set()).discard(channel)
        sockets = self._channels.get(channel)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                self._channels.pop(channel, None)

    def disconnect(self, ws: WebSocket) -> None:
        for channel in list(self._by_ws.pop(ws, set())):
            sockets = self._channels.get(channel)
            if sockets:
                sockets.discard(ws)
                if not sockets:
                    self._channels.pop(channel, None)
        for user, sockets in list(self._by_user.items()):
            sockets.discard(ws)
            if not sockets:
                self._by_user.pop(user, None)

    def _revoke_subscription(self, user_id: str, payload: str | bytes) -> None:
        try:
            target = orjson.loads(payload)["data"]["channel"]
        except (ValueError, KeyError, TypeError):
            return
        for ws in list(self._by_user.get(user_id, ())):
            self.unsubscribe(ws, target)

    @property
    def connection_count(self) -> int:
        return len(self._by_ws)

    # ── fan-out ──
    async def _deliver(self, channel: str, payload: str) -> None:
        if channel.startswith(SESSION_CHANNEL_PREFIX):  # session revoked → drop its live sockets now
            for ws in list(self._channels.get(channel, ())):
                self.disconnect(ws)
                try:
                    await ws.close(code=4401, reason="session ended")
                except Exception:
                    pass
            return
        for ws in list(self._channels.get(channel, ())):
            try:
                await ws.send_text(payload)
            except Exception:
                self.disconnect(ws)

    async def _listen_forever(self) -> None:
        backoff = 1.0
        while True:
            pubsub = get_redis().pubsub()
            try:
                await pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
                logger.info("realtime: listening on redis %s*", CHANNEL_PREFIX)
                backoff = 1.0
                async for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    channel = str(message["channel"])[len(CHANNEL_PREFIX) :]
                    if channel.startswith(UNSUB_CHANNEL_PREFIX):
                        self._revoke_subscription(channel[len(UNSUB_CHANNEL_PREFIX) :], message["data"])
                    elif channel in self._channels:
                        await self._deliver(channel, message["data"])
            except asyncio.CancelledError:
                await pubsub.aclose()
                raise
            except Exception:
                logger.exception("realtime: redis listener crashed; retrying in %.0fs", backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                try:
                    await pubsub.aclose()
                except Exception:
                    pass


manager = ConnectionManager()
