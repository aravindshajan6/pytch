import uuid

import orjson
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.errors import AppError
from app.core.security import decode_token
from app.modules.lobbies.models import Lobby, LobbyMember
from app.realtime.manager import manager
from app.realtime.publisher import user_channel

router = APIRouter()

ACTIVE_MEMBER = ("joined", "paid")


async def _can_subscribe(user_id: uuid.UUID, channel: str) -> bool:
    kind, _, raw_id = channel.partition(":")
    try:
        target = uuid.UUID(raw_id)
    except ValueError:
        return False
    if kind == "user":
        return target == user_id
    if kind == "pitch":
        return True
    if kind == "lobby":
        async with SessionLocal() as db:
            lobby = await db.get(Lobby, target)
            if lobby is None:
                return False
            if lobby.visibility == "public":
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


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = "") -> None:
    try:
        user_id = decode_token(token, "access")
    except AppError:
        await ws.close(code=4401, reason="unauthorized")
        return

    await ws.accept()
    manager.subscribe(ws, user_channel(user_id))
    await ws.send_text(orjson.dumps({"type": "hello", "user_id": str(user_id)}).decode())

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = orjson.loads(raw)
            except orjson.JSONDecodeError:
                await ws.send_text('{"type":"error","message":"invalid json"}')
                continue
            op, channel = msg.get("op"), str(msg.get("channel", ""))
            if op == "ping":
                await ws.send_text('{"type":"pong"}')
            elif op == "subscribe":
                if await _can_subscribe(user_id, channel):
                    manager.subscribe(ws, channel)
                else:
                    await ws.send_text(
                        orjson.dumps({"type": "error", "message": f"cannot subscribe to {channel}"}).decode()
                    )
            elif op == "unsubscribe":
                manager.unsubscribe(ws, channel)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)
