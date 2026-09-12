import asyncio
import time
import uuid

import orjson
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.deps import authenticate_user, ensure_user_active
from app.core.errors import AppError
from app.core.security import decode_claims
from app.modules.auth.sessions import is_revoked
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.providers.models import Provider, ProviderMember
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User
from app.realtime.manager import SESSION_CHANNEL_PREFIX, manager
from app.realtime.publisher import user_channel

router = APIRouter()

ACTIVE_MEMBER = ("joined", "paid")
WS_AUDIENCES = ("app", "partner")
SUBPROTOCOL = "pytch.v1"
REVALIDATE_SECONDS = 30  # fallback re-check of session/account (the session channel closes sockets instantly)
MSG_BURST, MSG_WINDOW = 20, 10.0  # inbound message rate limit per connection


async def _authenticate_full(token: str) -> tuple[uuid.UUID, str, uuid.UUID | None] | None:
    """Player (`app`) or venue-partner (`partner`) access token → (user id, audience, session id). Revoked
    sessions and suspended accounts are refused."""
    if not token:
        return None
    async with SessionLocal() as db:
        for audience in WS_AUDIENCES:
            try:
                user = await authenticate_user(db, token, audience)  # type: ignore[arg-type]
                sid = decode_claims(token, "access", audience=audience).get("sid")  # type: ignore[arg-type]
            except AppError:
                continue
            return user.id, audience, sid
    return None


async def _authenticate(token: str) -> tuple[uuid.UUID, str] | None:
    auth = await _authenticate_full(token)
    return (auth[0], auth[1]) if auth else None


def _token_from_handshake(ws: WebSocket) -> str:
    """Browsers send the token as the 2nd WebSocket subprotocol (`pytch.v1, <jwt>`) — headers never reach
    access logs, unlike `?token=` query strings. Native clients may send `Authorization: Bearer`."""
    offered = [p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    if len(offered) >= 2 and offered[0] == SUBPROTOCOL:
        return offered[1]
    auth = ws.headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


async def _still_valid(user_id: uuid.UUID, sid: uuid.UUID | None) -> bool:
    if sid is not None and await is_revoked(sid):
        return False
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None:
            return False
        try:
            ensure_user_active(user)
        except AppError:
            return False
    return True


async def _partner_can_watch_pitch(user_id: uuid.UUID, pitch_id: uuid.UUID) -> bool:
    """Active member of the (approved) provider that owns the pitch's venue, within their venue scope."""
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(ProviderMember.turf_ids, Turf.id)
                .select_from(Pitch)
                .join(Turf, Turf.id == Pitch.turf_id)
                .join(Provider, Provider.id == Turf.provider_id)
                .join(ProviderMember, ProviderMember.provider_id == Provider.id)
                .where(
                    Pitch.id == pitch_id,
                    Provider.status == "approved",
                    ProviderMember.user_id == user_id,
                    ProviderMember.status == "active",
                )
            )
        ).all()
    return any(scope is None or str(turf_id) in {str(t) for t in scope} for scope, turf_id in rows)


async def _can_subscribe(user_id: uuid.UUID, channel: str, audience: str = "app") -> bool:
    kind, _, raw_id = channel.partition(":")
    try:
        target = uuid.UUID(raw_id)
    except ValueError:
        return False
    if kind == "user":
        return target == user_id
    if audience == "partner":  # venue staff: only live availability of their own pitches
        return kind == "pitch" and await _partner_can_watch_pitch(user_id, target)
    if kind == "pitch":  # live availability of a real, bookable pitch
        async with SessionLocal() as db:
            return bool(await db.scalar(select(Pitch.id).where(Pitch.id == target, Pitch.is_active.is_(True))))
    if kind in ("lobby", "chat"):  # lobby state: public lobbies open to all; chat: current members only
        async with SessionLocal() as db:
            lobby = await db.get(Lobby, target)
            if lobby is None:
                return False
            if kind == "lobby" and lobby.visibility == "public":
                return True
            member = await db.scalar(
                select(LobbyMember.id).where(
                    LobbyMember.lobby_id == target,
                    LobbyMember.user_id == user_id,
                    LobbyMember.status.in_(ACTIVE_MEMBER),
                )
            )
            return member is not None
    return False


async def _watchdog(ws: WebSocket, user_id: uuid.UUID, sid: uuid.UUID | None) -> None:
    """Close the socket once its session is revoked or the account is suspended (fallback to the push)."""
    try:
        while True:
            await asyncio.sleep(REVALIDATE_SECONDS)
            if not await _still_valid(user_id, sid):
                manager.disconnect(ws)
                await ws.close(code=4401, reason="session ended")
                return
    except (asyncio.CancelledError, RuntimeError):
        return


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    token = _token_from_handshake(ws)
    auth = await _authenticate_full(token)
    offered = ws.headers.get("sec-websocket-protocol", "")
    subprotocol = SUBPROTOCOL if SUBPROTOCOL in offered else None
    # Refusals are sent as close codes after the handshake (a pre-accept close is just HTTP 403, which
    # browsers report as 1006 → the client can't tell "log in again" (4401) from "slow down" (4429)).
    if auth is None:
        if subprotocol is None:  # not our client (e.g. a stale `?token=` build) → plain 403
            await ws.close(code=4401, reason="unauthorized")
            return
        await ws.accept(subprotocol=subprotocol)
        await ws.close(code=4401, reason="unauthorized")
        return
    user_id, audience, sid = auth
    if not manager.register(ws, user_id):
        await ws.accept(subprotocol=subprotocol)
        await ws.close(code=4429, reason="too many connections")
        return

    watchdog: asyncio.Task | None = None
    try:  # registered from here on: every exit path must unregister (finally)
        await ws.accept(subprotocol=subprotocol)
        manager.subscribe(ws, user_channel(user_id))
        if sid is not None:
            manager.subscribe(ws, f"{SESSION_CHANNEL_PREFIX}{sid}")
        await ws.send_text(orjson.dumps({"type": "hello", "user_id": str(user_id)}).decode())
        watchdog = asyncio.create_task(_watchdog(ws, user_id, sid))
        window_start, count = time.monotonic(), 0
        while True:
            raw = await ws.receive_text()
            now = time.monotonic()
            if now - window_start > MSG_WINDOW:
                window_start, count = now, 0
            count += 1
            if count > MSG_BURST:
                await ws.close(code=4429, reason="slow down")
                break
            if sid is not None and await is_revoked(sid):
                await ws.close(code=4401, reason="session ended")
                break
            try:
                msg = orjson.loads(raw)
            except orjson.JSONDecodeError:
                await ws.send_text('{"type":"error","message":"invalid json"}')
                continue
            op, channel = msg.get("op"), str(msg.get("channel", ""))
            if op == "ping":
                await ws.send_text('{"type":"pong"}')
            elif op == "subscribe":
                if channel.startswith(SESSION_CHANNEL_PREFIX):
                    await ws.send_text('{"type":"error","message":"cannot subscribe to that channel"}')
                elif await _can_subscribe(user_id, channel, audience):
                    if not manager.subscribe(ws, channel):
                        await ws.send_text('{"type":"error","message":"subscription limit reached"}')
                else:
                    await ws.send_text(
                        orjson.dumps({"type": "error", "message": f"cannot subscribe to {channel}"}).decode()
                    )
            elif op == "unsubscribe" and not channel.startswith(SESSION_CHANNEL_PREFIX):
                manager.unsubscribe(ws, channel)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if watchdog is not None:
            watchdog.cancel()
        manager.disconnect(ws)
