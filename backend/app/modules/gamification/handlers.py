"""XP, stats, streaks and badges driven by the match lifecycle.

Runs inside the emitter's transaction (never commits). Each reward is guarded by an `XpEvent`
(user, ref_id, reason prefix) so a re-emitted event can't double-count.
"""

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import on
from app.core.timeutils import iso_week_key, to_ist
from app.modules.gamification.catalog import XP
from app.modules.gamification.models import XpEvent
from app.modules.gamification.service import award_badge, award_xp, get_stats_for_update
from app.modules.lobbies.models import Lobby
from app.modules.users.models import PlayerStats

HOSTED_PREFIX = "Hosted"
PLAYED_PREFIX = "Played"
SUB_PREFIX = "Hero sub"

PLAY_BADGES = ((1, "first_whistle"), (3, "hat_trick"), (10, "regular"), (50, "veteran"))
SQUAD_LEADER_HOSTED = 5
ON_FIRE_STREAK = 4
SUPER_SUB_COUNT = 5
DROPOUT_WINDOW_HOURS = 24


async def _already_rewarded(db: AsyncSession, user_id: uuid.UUID, ref_id: uuid.UUID, prefix: str) -> bool:
    await db.flush()  # autoflush is off: make XP granted earlier in this transaction visible
    found = await db.scalar(
        select(XpEvent.id)
        .where(XpEvent.user_id == user_id, XpEvent.ref_id == ref_id, XpEvent.reason.startswith(prefix))
        .limit(1)
    )
    return found is not None


def next_streak(stats: PlayerStats, kickoff) -> int:
    """Weekly streak: consecutive ISO weeks (IST) with at least one match."""
    current = stats.streak_weeks or 0
    if stats.last_match_at is None:
        return 1
    this_week, last_week = iso_week_key(kickoff), iso_week_key(kickoff - timedelta(days=7))
    previous = iso_week_key(stats.last_match_at)
    if previous == this_week:
        return max(current, 1)
    if previous == last_week:
        return current + 1
    if stats.last_match_at > kickoff:  # an older match completing late never breaks the streak
        return max(current, 1)
    return 1


@on("lobby.confirmed")
async def reward_host(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None or await _already_rewarded(db, lobby.host_id, lobby.id, HOSTED_PREFIX):
        return
    stats = await get_stats_for_update(db, lobby.host_id)
    stats.matches_hosted = (stats.matches_hosted or 0) + 1
    await award_xp(db, lobby.host_id, XP.MATCH_HOSTED, f"{HOSTED_PREFIX} {lobby.title}", lobby.id)
    if stats.matches_hosted >= SQUAD_LEADER_HOSTED:
        await award_badge(db, lobby.host_id, "squad_leader")


@on("match.completed")
async def reward_players(db: AsyncSession, *, lobby_id: uuid.UUID, **_: object) -> None:
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None:
        return
    kickoff = lobby.start_at
    hour_ist = to_ist(kickoff).hour
    for user_id in sorted({m.user_id for m in lobby.members if m.status == "paid"}):
        if await _already_rewarded(db, user_id, lobby.id, PLAYED_PREFIX):
            continue
        stats = await get_stats_for_update(db, user_id)
        stats.matches_played = (stats.matches_played or 0) + 1
        stats.streak_weeks = next_streak(stats, kickoff)
        if stats.last_match_at is None or kickoff > stats.last_match_at:
            stats.last_match_at = kickoff
        await award_xp(db, user_id, XP.MATCH_PLAYED, f"{PLAYED_PREFIX} {lobby.title}", lobby.id)

        for threshold, code in PLAY_BADGES:
            if stats.matches_played >= threshold:
                await award_badge(db, user_id, code)
        if (stats.matches_hosted or 0) >= SQUAD_LEADER_HOSTED:
            await award_badge(db, user_id, "squad_leader")
        if hour_ist >= 21:
            await award_badge(db, user_id, "night_owl")
        if hour_ist < 7:
            await award_badge(db, user_id, "early_bird")
        if stats.streak_weeks >= ON_FIRE_STREAK:
            await award_badge(db, user_id, "on_fire")


@on("member.dropped")
async def count_dropout(
    db: AsyncSession, *, user_id: uuid.UUID, hours_to_kickoff: float, **_: object
) -> None:
    if hours_to_kickoff is None or hours_to_kickoff > DROPOUT_WINDOW_HOURS:
        return
    stats = await get_stats_for_update(db, user_id)
    stats.dropouts = (stats.dropouts or 0) + 1


@on("sub.paid")
async def reward_sub(db: AsyncSession, *, lobby_id: uuid.UUID, user_id: uuid.UUID, **_: object) -> None:
    if await _already_rewarded(db, user_id, lobby_id, SUB_PREFIX):
        return
    lobby = await db.get(Lobby, lobby_id)
    stats = await get_stats_for_update(db, user_id)
    stats.subs_made = (stats.subs_made or 0) + 1
    title = lobby.title if lobby else "a match"
    await award_xp(db, user_id, XP.HERO_SUB, f"{SUB_PREFIX} — {title}", lobby_id)
    await award_badge(db, user_id, "hero_sub")
    if stats.subs_made >= SUPER_SUB_COUNT:
        await award_badge(db, user_id, "super_sub")
