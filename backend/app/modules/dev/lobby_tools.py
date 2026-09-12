"""Demo controls for lobbies (mounted under /dev with the demo-mode guard).

Bots go through the real services, so every notification, realtime event and domain event fires
exactly as it would for humans.
"""

import asyncio
import random
import uuid

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import AREAS
from app.core.database import SessionLocal
from app.core.deps import DB, CurrentUser
from app.core.errors import AppError, Conflict, NotFound
from app.core.logging import logger
from app.core.timeutils import utcnow
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.detail_schemas import LobbyDetail
from app.modules.lobbies.errors import LobbyClosed, LobbyFull
from app.modules.lobbies.models import Lobby
from app.modules.payments import service as payments
from app.modules.payments.models import Payment
from app.modules.users.models import PlayerStats, User

router = APIRouter()

BOT_PHONE_PREFIX = "+91000000"  # +910000000001 …
BOT_NAMES = [
    "Arun Mohan", "Anand Nair", "Rahul Pillai", "Vishnu Kurup", "Nikhil Varma", "Abhijith Das",
    "Sreejith Kumar", "Aswin Thomas", "Jithin Joseph", "Akhil Mathew", "Midhun Raj", "Faris Rahman",
    "Shibin Ashraf", "Gokul Krishnan", "Aby George", "Ebin Varghese", "Harikrishnan S", "Nidhin Paul",
    "Sharath Chandran", "Adarsh Unni", "Ameen Muhammed", "Basil Joy", "Deepak Raveendran", "Anoop Sebastian",
]
POSITIONS = {"football": ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"]}
JOIN_TO_PAY_SECONDS = 0.8
BETWEEN_BOTS_SECONDS = 1.5
_background: set[asyncio.Task] = set()


def _tier(true_skill: float, ratings: int) -> str:
    if ratings < 3:
        return "rookie"
    return "elite" if true_skill >= 70 else "skilled" if true_skill >= 55 else "regular"


def _fit_bot_to_gates(stats: PlayerStats, lobby: Lobby) -> None:
    """Demo convenience: make sure a bot passes the lobby's skill / verified gates."""
    if lobby.min_true_skill is not None and (stats.true_skill or 0) < lobby.min_true_skill:
        stats.true_skill = round(min(99.0, lobby.min_true_skill + random.uniform(0, 8)), 1)
    if lobby.verified_only:
        stats.is_verified_playmaker = True
        stats.ratings_received = max(stats.ratings_received or 0, 8)
    stats.tier = _tier(stats.true_skill or 50, stats.ratings_received or 0)


async def _ensure_bots(db: AsyncSession, lobby: Lobby, count: int) -> list[uuid.UUID]:
    """Reuse bots not already in the lobby; create more (with varied stats) if needed. Commits."""
    taken = {m.user_id for m in lobby.members}
    existing = (
        await db.execute(select(User).where(User.is_bot.is_(True)).order_by(User.phone))
    ).unique().scalars().all()
    chosen = [u for u in existing if u.id not in taken][:count]
    next_index = int(await db.scalar(select(func.count()).select_from(User).where(User.is_bot.is_(True))) or 0) + 1
    now = utcnow()
    while len(chosen) < count:
        phone = f"{BOT_PHONE_PREFIX}{next_index:04d}"
        next_index += 1
        if await db.scalar(select(User.id).where(User.phone == phone)):
            continue
        area = random.choice(AREAS)
        true_skill = round(random.uniform(40, 80), 1)
        ratings = random.randint(3, 30)
        bot = User(
            id=uuid.uuid4(), phone=phone, name=BOT_NAMES[(next_index - 2) % len(BOT_NAMES)],
            preferred_sports=[lobby.sport], home_area=area["name"],
            home_lat=area["lat"] + random.uniform(-0.01, 0.01), home_lng=area["lng"] + random.uniform(-0.01, 0.01),
            position=random.choice(POSITIONS.get(lobby.sport, ["All-rounder"])),
            wallet_balance_paise=0, onboarded=True, is_bot=True, created_at=now, updated_at=now,
        )
        bot.stats = PlayerStats(
            user_id=bot.id, true_skill=true_skill, ratings_received=ratings, distinct_raters=min(ratings, 12),
            tier=_tier(true_skill, ratings), xp=random.randint(100, 2500), level=random.randint(2, 9),
            matches_played=random.randint(3, 60), tag_counts={},
        )
        db.add(bot)
        chosen.append(bot)
    for bot in chosen:
        _fit_bot_to_gates(bot.stats, lobby)
    await db.commit()
    return [b.id for b in chosen]


async def _bot_join_and_pay(lobby_id: uuid.UUID, bot_id: uuid.UUID) -> bool:
    """One bot: join, pause, pay (mock provider, captured immediately). False → stop filling."""
    async with SessionLocal() as db:
        bot = await db.get(User, bot_id)
        try:
            await lobbies.join_lobby(db, lobby_id, bot, invited=True)  # type: ignore[arg-type]  # host asked
        except (LobbyFull, LobbyClosed):
            return False
        except AppError as exc:
            logger.info("dev fill: bot %s could not join: %s", bot_id, exc.message)
            return True
    await asyncio.sleep(JOIN_TO_PAY_SECONDS)
    async with SessionLocal() as db:
        bot = await db.get(User, bot_id)
        try:
            intent = await payments.pay_for_seat(db, bot, lobby_id, use_credits=True, provider="mock")  # type: ignore[arg-type]
            if intent.status == "created":
                payment = await db.get(Payment, intent.payment_id)
                await payments.capture(db, payment, provider_payment_id=f"mock_pay_{uuid.uuid4().hex[:20]}")  # type: ignore[arg-type]
                await db.commit()
        except AppError as exc:
            logger.info("dev fill: bot %s could not pay: %s", bot_id, exc.message)
    return True


async def fill_worker(lobby_id: uuid.UUID, bot_ids: list[uuid.UUID]) -> None:
    for i, bot_id in enumerate(bot_ids):
        if i:
            await asyncio.sleep(BETWEEN_BOTS_SECONDS)
        try:
            if not await _bot_join_and_pay(lobby_id, bot_id):
                break
        except Exception:
            logger.exception("dev fill: bot %s crashed", bot_id)


async def _hosted_lobby(db: AsyncSession, lobby_id: uuid.UUID, user: User) -> Lobby:
    """Demo tools act on the caller's own match only (a stranger gets the same 404 as a missing match)."""
    lobby = await lobbies.get_lobby(db, lobby_id)
    if lobby.host_id != user.id:
        raise NotFound("Match not found")
    return lobby


@router.post("/lobbies/{lobby_id}/fill")
async def fill(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> dict:
    """Bots join and pay one by one (~1.5 s apart) — watch the split payment complete live. Host only."""
    lobby = await _hosted_lobby(db, lobby_id, user)
    lobbies.ensure_open_for_seats(lobby, utcnow())
    needed = lobbies.spots_left(lobby)
    if needed <= 0:
        raise LobbyFull()
    bot_ids = await _ensure_bots(db, lobby, needed)
    task = asyncio.create_task(fill_worker(lobby.id, bot_ids), name=f"dev-fill-{lobby.id}")
    _background.add(task)
    task.add_done_callback(_background.discard)
    return {"ok": True}


@router.post("/lobbies/{lobby_id}/complete", response_model=LobbyDetail)
async def complete(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    """Fast-forward: mark the match completed now and run the post-match pipeline. Host only."""
    lobby = await _hosted_lobby(db, lobby_id, user)
    await lobbies.complete_match(db, lobby)
    await db.commit()
    lobby = await lobbies.get_lobby(db, lobby_id, refresh=True)
    return await lobbies.lobby_detail(db, lobby, user)


@router.post("/lobbies/{lobby_id}/dropout", response_model=LobbyDetail)
async def dropout(lobby_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    """A random paid non-host member drops out through the real leave path (→ SOS to the bench). Host only."""
    lobby = await _hosted_lobby(db, lobby_id, user)
    candidates = [m for m in lobbies.active_members(lobby) if m.status == "paid" and m.role != "host"]
    if not candidates:
        raise Conflict("No paid players (other than the host) to drop out")
    victim = random.choice(candidates)
    hours = (lobby.start_at - utcnow()).total_seconds() / 3600
    if hours > 6:  # demo: pretend it's a late drop so the automatic SOS kicks in
        hours = round(random.uniform(1.5, 5.5), 2)
    victim_user = await db.get(User, victim.user_id)
    await lobbies.leave_lobby(db, lobby.id, victim_user, hours_to_kickoff=hours)  # type: ignore[arg-type]
    lobby = await lobbies.get_lobby(db, lobby_id, refresh=True)
    return await lobbies.lobby_detail(db, lobby, user)
