"""Per-instance WebSocket connection registry + Redis pattern-subscription fan-out."""

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from app.core.logging import logger
from app.core.redis import get_redis
from app.realtime.publisher import CHANNEL_PREFIX


class ConnectionManager:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
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

    # ── subscriptions ──
    def subscribe(self, ws: WebSocket, channel: str) -> None:
        self._channels[channel].add(ws)

    def unsubscribe(self, ws: WebSocket, channel: str) -> None:
        sockets = self._channels.get(channel)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                self._channels.pop(channel, None)

    def disconnect(self, ws: WebSocket) -> None:
        for channel in list(self._channels):
            self.unsubscribe(ws, channel)

    @property
    def connection_count(self) -> int:
        return len({ws for sockets in self._channels.values() for ws in sockets})

    # ── fan-out ──
    async def _deliver(self, channel: str, payload: str) -> None:
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
                    if channel in self._channels:
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
