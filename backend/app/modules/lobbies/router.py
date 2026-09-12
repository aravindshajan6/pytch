import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import DB, CurrentUser
from app.core.pagination import Page
from app.modules.lobbies import service
from app.modules.lobbies.detail_schemas import LobbyDetail
from app.modules.lobbies.schemas import LobbyMessageOut, LobbySummary, QuickMatchResponse, SendMessageRequest
from app.modules.payments import service as payments
from app.modules.payments.schemas import PaymentIntent, PayRequest
from app.modules.turfs.schemas import Sport

router = APIRouter(prefix="/lobbies", tags=["lobbies"])


@router.get("", response_model=Page[LobbySummary])
async def feed(
    user: CurrentUser,
    db: DB,
    sport: Sport | None = None,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    radius_km: float = Query(15, gt=0, le=200),
    date: date | None = None,
    include_ineligible: bool = False,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> Page[LobbySummary]:
    return await service.feed(
        db, user, sport=sport, lat=lat, lng=lng, radius_km=radius_km, day=date,
        include_ineligible=include_ineligible, limit=limit, offset=offset,
    )


@router.get("/quick-match", response_model=QuickMatchResponse)
async def quick_match(
    user: CurrentUser,
    db: DB,
    sport: Sport | None = None,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
) -> QuickMatchResponse:
    return await service.quick_match(db, user, sport=sport, lat=lat, lng=lng)


@router.get("/mine", response_model=list[LobbySummary])
async def mine(user: CurrentUser, db: DB, scope: Literal["upcoming", "past"] = "upcoming") -> list[LobbySummary]:
    return await service.my_lobbies(db, user, scope)


@router.get("/code/{code}", response_model=LobbyDetail)
async def by_code(code: str, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.get_lobby_by_code(db, code)
    return await service.lobby_detail(db, lobby, user)


@router.get("/{lobby_id}", response_model=LobbyDetail)
async def get_lobby(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.get_visible_lobby(db, lobby_id, user)
    return await service.lobby_detail(db, lobby, user)


@router.post("/{lobby_id}/join", response_model=LobbyDetail)
async def join(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.join_lobby(db, lobby_id, user)
    return await service.lobby_detail(db, lobby, user)


@router.post("/{lobby_id}/leave", response_model=LobbyDetail)
async def leave(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.leave_lobby(db, lobby_id, user)
    return await service.lobby_detail(db, lobby, user)


@router.post("/{lobby_id}/pay", response_model=PaymentIntent)
async def pay(lobby_id: uuid.UUID, body: PayRequest, user: CurrentUser, db: DB) -> PaymentIntent:
    return await payments.pay_for_seat(db, user, lobby_id, use_credits=body.use_credits)


@router.post("/{lobby_id}/cover-remaining", response_model=PaymentIntent)
async def cover_remaining(lobby_id: uuid.UUID, body: PayRequest, user: CurrentUser, db: DB) -> PaymentIntent:
    return await payments.cover_remaining(db, user, lobby_id, use_credits=body.use_credits)


@router.post("/{lobby_id}/balance-teams", response_model=LobbyDetail)
async def balance_teams(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.balance_teams(db, lobby_id, user)
    return await service.lobby_detail(db, lobby, user)


@router.delete("/{lobby_id}/members/{user_id}", response_model=LobbyDetail)
async def remove_member(lobby_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    lobby = await service.remove_unpaid_member(db, lobby_id, user, user_id)
    return await service.lobby_detail(db, lobby, user)


@router.get("/{lobby_id}/messages", response_model=list[LobbyMessageOut])
async def messages(
    lobby_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    before: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
) -> list[LobbyMessageOut]:
    return await service.list_messages(db, lobby_id, user, before=before, limit=limit)


@router.post("/{lobby_id}/messages", response_model=LobbyMessageOut, status_code=201)
async def send_message(lobby_id: uuid.UUID, body: SendMessageRequest, user: CurrentUser, db: DB) -> LobbyMessageOut:
    return await service.send_message(db, lobby_id, user, body.body)
