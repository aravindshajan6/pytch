"""Peer-verified "True Skill" ratings (FEATURE_ANALYSIS §2).

Aggregation, per dimension (skill / fair play / reliability) — weighted Bayesian mean:

    avg = (PRIOR_MEAN·PRIOR_WEIGHT + Σ wᵢ·scoreᵢ) / (PRIOR_WEIGHT + Σ wᵢ)

* Rater weight   wᵢ = 0.5 + 0.5·credibility(rater), credibility ∈ [0, 1] grows with the rater's own
  ratings count (received, then given) and verified status.
* Outlier damping: once the ratee has ≥ 5 ratings, a rating with any score deviating > 2 from the
  ratee's current mean on that dimension is weighted × 0.5 (limits revenge ratings / friend-boosting).
  `PlayerStats` keeps a single weight sum, so damping applies to the rating as a whole.
* True Skill (0–100) = ((0.6·skill + 0.2·fair + 0.2·rel) − 1) / 4 · 100, shrunk toward 50 by
  confidence min(1, n/10).
* No-show: when a 2nd teammate reports `showed_up=false` for the same match, `no_shows += 1` once and a
  synthetic 1-star reliability rating is applied (neutral contributions keep skill/fair play unchanged).
* Tiers: rookie (< 3 ratings) → regular (< 55) → skilled (55–70) → elite (≥ 70).
* Verified Playmaker: ≥ 8 ratings from ≥ 5 distinct raters, all three averages ≥ 4.0, ≤ 1 no-show —
  re-evaluated on every rating (awarded and revoked).
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import RATING_TAGS
from app.core.errors import AppError, NotFound
from app.core.timeutils import to_ist, utcnow
from app.modules.gamification import service as gamification
from app.modules.gamification.catalog import XP
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.ratings.models import MatchRating
from app.modules.ratings.schemas import (
    HistoryPoint,
    PendingRating,
    RatingSummary,
    SubmitRatingsRequest,
    SubmitRatingsResponse,
    TagCount,
    VerifiedCriterion,
    VerifiedProgress,
)
from app.modules.users.models import PlayerStats, User
from app.modules.users.schemas import UserPublic

# ───────────────────────────── tunables ─────────────────────────────
PRIOR_MEAN = 3.0
PRIOR_WEIGHT = 4.0
OUTLIER_MIN_RATINGS = 5
OUTLIER_DELTA = 2.0
OUTLIER_FACTOR = 0.5
CONFIDENCE_RATINGS = 10
NO_SHOW_REPORTS = 2
SYNTHETIC_NO_SHOW_WEIGHT = 1.0

VERIFIED_MIN_RATINGS = 8
VERIFIED_MIN_RATERS = 5
VERIFIED_MIN_AVG = 4.0
VERIFIED_MAX_NO_SHOWS = 1

FAIR_PLAY_ACE_AVG = 4.7
FAIR_PLAY_ACE_RATINGS = 10
CRITIC_RATINGS_GIVEN = 20

VERIFIED_XP_REASON = "Became a Verified Playmaker"


# ───────────────────────────── errors ─────────────────────────────
class RatingWindowClosed(AppError):
    code, status_code, message = "RATING_WINDOW_CLOSED", 409, "The rating window for this match is closed"


class NotMember(AppError):
    code, status_code, message = "NOT_MEMBER", 403, "Only players from this match can rate it"


class InvalidRating(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid rating"


# ───────────────────────────── pure maths ─────────────────────────────
def bayesian_mean(weighted_sum: float, weight_sum: float) -> float:
    return (PRIOR_MEAN * PRIOR_WEIGHT + weighted_sum) / (PRIOR_WEIGHT + weight_sum)


def credibility(ratings_received: int, ratings_given: int, is_verified: bool) -> float:
    """0..1 — established, experienced and verified raters count more."""
    score = (
        0.5 * min(1.0, ratings_received / CONFIDENCE_RATINGS)
        + 0.2 * min(1.0, ratings_given / CONFIDENCE_RATINGS)
        + (0.3 if is_verified else 0.0)
    )
    return max(0.0, min(1.0, score))


def rater_weight(cred: float) -> float:
    return 0.5 + 0.5 * cred


def weight_for_stats(rater: PlayerStats) -> float:
    return rater_weight(
        credibility(rater.ratings_received or 0, rater.ratings_given or 0, bool(rater.is_verified_playmaker))
    )


def is_outlier(ratee: PlayerStats, skill: int, fair_play: int, reliability: int) -> bool:
    if (ratee.ratings_received or 0) < OUTLIER_MIN_RATINGS:
        return False
    pairs = ((ratee.avg_skill, skill), (ratee.avg_fair_play, fair_play), (ratee.avg_reliability, reliability))
    return any(mean is not None and abs(score - mean) > OUTLIER_DELTA for mean, score in pairs)


def true_skill_from(skill: float, fair_play: float, reliability: float, n: int) -> float:
    raw = ((0.6 * skill + 0.2 * fair_play + 0.2 * reliability) - 1.0) / 4.0 * 100.0
    confidence = min(1.0, n / CONFIDENCE_RATINGS)
    value = 50.0 + (raw - 50.0) * confidence
    return max(0.0, min(100.0, value))


def tier_for(true_skill: float | None, n: int) -> str:
    if n < 3 or true_skill is None:
        return "rookie"
    if true_skill < 55:
        return "regular"
    if true_skill < 70:
        return "skilled"
    return "elite"


def recompute(stats: PlayerStats) -> None:
    """Derive averages / True Skill / tier from the weighted sums."""
    weight_sum = stats.weight_sum or 0.0
    if (stats.ratings_received or 0) <= 0 and weight_sum <= 0:
        stats.avg_skill = stats.avg_fair_play = stats.avg_reliability = stats.true_skill = None
        stats.tier = "rookie"
        return
    stats.avg_skill = bayesian_mean(stats.skill_wsum or 0.0, weight_sum)
    stats.avg_fair_play = bayesian_mean(stats.fair_play_wsum or 0.0, weight_sum)
    stats.avg_reliability = bayesian_mean(stats.reliability_wsum or 0.0, weight_sum)
    n = stats.ratings_received or 0
    stats.true_skill = round(true_skill_from(stats.avg_skill, stats.avg_fair_play, stats.avg_reliability, n), 2)
    stats.tier = tier_for(stats.true_skill, n)


def apply_rating(stats: PlayerStats, skill: float, fair_play: float, reliability: float, weight: float) -> None:
    stats.weight_sum = (stats.weight_sum or 0.0) + weight
    stats.skill_wsum = (stats.skill_wsum or 0.0) + weight * skill
    stats.fair_play_wsum = (stats.fair_play_wsum or 0.0) + weight * fair_play
    stats.reliability_wsum = (stats.reliability_wsum or 0.0) + weight * reliability
    stats.ratings_received = (stats.ratings_received or 0) + 1
    recompute(stats)


def apply_no_show(stats: PlayerStats) -> None:
    """Synthetic 1-star reliability. Skill / fair-play get their current mean (neutral), so only
    reliability moves. Doesn't count toward `ratings_received`."""
    w = SYNTHETIC_NO_SHOW_WEIGHT
    cur_skill = bayesian_mean(stats.skill_wsum or 0.0, stats.weight_sum or 0.0)
    cur_fair = bayesian_mean(stats.fair_play_wsum or 0.0, stats.weight_sum or 0.0)
    stats.weight_sum = (stats.weight_sum or 0.0) + w
    stats.skill_wsum = (stats.skill_wsum or 0.0) + w * cur_skill
    stats.fair_play_wsum = (stats.fair_play_wsum or 0.0) + w * cur_fair
    stats.reliability_wsum = (stats.reliability_wsum or 0.0) + w * 1.0
    stats.no_shows = (stats.no_shows or 0) + 1
    recompute(stats)


def verified_criteria(stats: PlayerStats) -> list[VerifiedCriterion]:
    def avg(v: float | None) -> float:
        return round(v, 2) if v is not None else 0.0

    n, raters, no_shows = stats.ratings_received or 0, stats.distinct_raters or 0, stats.no_shows or 0
    return [
        VerifiedCriterion(
            key="ratings", label=f"{VERIFIED_MIN_RATINGS}+ peer ratings", current=n,
            target=VERIFIED_MIN_RATINGS, met=n >= VERIFIED_MIN_RATINGS,
        ),
        VerifiedCriterion(
            key="distinct_raters", label=f"Rated by {VERIFIED_MIN_RATERS}+ different teammates", current=raters,
            target=VERIFIED_MIN_RATERS, met=raters >= VERIFIED_MIN_RATERS,
        ),
        VerifiedCriterion(
            key="skill", label="Skill rating 4.0 or higher", current=avg(stats.avg_skill),
            target=VERIFIED_MIN_AVG, met=(stats.avg_skill or 0) >= VERIFIED_MIN_AVG,
        ),
        VerifiedCriterion(
            key="fair_play", label="Fair play rating 4.0 or higher", current=avg(stats.avg_fair_play),
            target=VERIFIED_MIN_AVG, met=(stats.avg_fair_play or 0) >= VERIFIED_MIN_AVG,
        ),
        VerifiedCriterion(
            key="reliability", label="Reliability rating 4.0 or higher", current=avg(stats.avg_reliability),
            target=VERIFIED_MIN_AVG, met=(stats.avg_reliability or 0) >= VERIFIED_MIN_AVG,
        ),
        VerifiedCriterion(
            key="no_shows", label="No more than 1 no-show", current=no_shows,
            target=VERIFIED_MAX_NO_SHOWS, met=no_shows <= VERIFIED_MAX_NO_SHOWS,
        ),
    ]


def is_verified_eligible(stats: PlayerStats) -> bool:
    return all(c.met for c in verified_criteria(stats))


def top_tags(tag_counts: dict[str, int] | None, limit: int = 5) -> list[TagCount]:
    items = sorted((tag_counts or {}).items(), key=lambda kv: (-kv[1], kv[0]))
    return [TagCount(tag=t, count=c) for t, c in items[:limit] if c > 0]


def rating_closes_at(lobby: Lobby) -> datetime:
    return (lobby.completed_at or lobby.end_at) + timedelta(hours=settings.rating_window_hours)


# ───────────────────────────── side-effectful helpers ─────────────────────────────
async def evaluate_verified(db: AsyncSession, stats: PlayerStats) -> None:
    """Award or revoke Verified Playmaker. Caller holds the stats row lock and commits."""
    eligible = is_verified_eligible(stats)
    user_id = stats.user_id
    if eligible and not stats.is_verified_playmaker:
        stats.is_verified_playmaker = True
        stats.verified_at = utcnow()
        await gamification.award_badge(db, user_id, "verified_playmaker")
        already_rewarded = await db.scalar(
            select(XpEvent.id).where(XpEvent.user_id == user_id, XpEvent.reason == VERIFIED_XP_REASON).limit(1)
        )
        if already_rewarded is None:
            await gamification.award_xp(db, user_id, XP.VERIFIED_PLAYMAKER, VERIFIED_XP_REASON)
        await notify(
            db, user_id, "verified_playmaker", "You're a Verified Playmaker ✅",
            "Your teammates vouched for your skill, fair play and reliability. Wear the badge with pride.",
            {"url": "/app/profile"},
        )
    elif not eligible and stats.is_verified_playmaker:
        stats.is_verified_playmaker = False
        stats.verified_at = None
        await db.execute(
            delete(UserBadge).where(UserBadge.user_id == user_id, UserBadge.badge_code == "verified_playmaker")
        )
        await notify(
            db, user_id, "verified_playmaker", "Verified Playmaker status paused",
            "Your recent ratings dipped below the bar. Keep playing fair — you can win it back.",
            {"url": "/app/profile"},
        )


async def _maybe_fair_play_ace(db: AsyncSession, stats: PlayerStats) -> None:
    if (stats.ratings_received or 0) >= FAIR_PLAY_ACE_RATINGS and (stats.avg_fair_play or 0) >= FAIR_PLAY_ACE_AVG:
        await gamification.award_badge(db, stats.user_id, "fair_play_ace")


# ───────────────────────────── use-cases ─────────────────────────────
async def pending_ratings(db: AsyncSession, user: User) -> list[PendingRating]:
    now = utcnow()
    window_start = now - timedelta(hours=settings.rating_window_hours)
    lobbies = (
        await db.scalars(
            select(Lobby)
            .join(LobbyMember, LobbyMember.lobby_id == Lobby.id)
            .where(
                LobbyMember.user_id == user.id,
                LobbyMember.status == "paid",
                Lobby.status == "completed",
                func.coalesce(Lobby.completed_at, Lobby.end_at) > window_start,
            )
            .order_by(Lobby.start_at.desc())
        )
    ).unique().all()
    if not lobbies:
        return []
    rated_rows = await db.execute(
        select(MatchRating.lobby_id, MatchRating.ratee_id).where(
            MatchRating.rater_id == user.id, MatchRating.lobby_id.in_([lb.id for lb in lobbies])
        )
    )
    rated: set[tuple[uuid.UUID, uuid.UUID]] = {(lid, rid) for lid, rid in rated_rows.all()}
    out: list[PendingRating] = []
    for lobby in lobbies:
        closes_at = rating_closes_at(lobby)
        if closes_at <= now:
            continue
        teammates = [
            UserPublic.from_user(m.user)
            for m in lobby.members
            if m.status == "paid" and m.user_id != user.id and (lobby.id, m.user_id) not in rated
        ]
        if not teammates:
            continue
        out.append(
            PendingRating(
                lobby_id=lobby.id,
                title=lobby.title,
                sport=lobby.sport,  # type: ignore[arg-type]
                turf_name=lobby.turf.name,
                start_at=lobby.start_at,
                closes_at=closes_at,
                teammates=teammates,
            )
        )
    return out


def _clean_tags(tags: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in tags:
        tag = tag.strip()
        if tag not in RATING_TAGS:
            raise InvalidRating(f"Unknown tag “{tag}”", details={"allowed": RATING_TAGS})
        if tag not in seen:
            seen.append(tag)
    return seen[:3]


async def submit_ratings(
    db: AsyncSession, lobby_id: uuid.UUID, rater: User, payload: SubmitRatingsRequest
) -> SubmitRatingsResponse:
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None:
        raise NotFound("Match not found")
    paid_ids = {m.user_id for m in lobby.members if m.status == "paid"}
    if rater.id not in paid_ids:
        raise NotMember()
    if lobby.status != "completed":
        raise RatingWindowClosed("Ratings open once the match is completed")
    if utcnow() > rating_closes_at(lobby):
        raise RatingWindowClosed()

    seen: set[uuid.UUID] = set()
    cleaned: list[tuple] = []
    for item in payload.ratings:
        if item.ratee_id == rater.id:
            raise InvalidRating("You can't rate yourself")
        if item.ratee_id not in paid_ids:
            raise InvalidRating(
                "You can only rate players who played this match", details={"ratee_id": str(item.ratee_id)}
            )
        if item.ratee_id in seen:
            raise InvalidRating("Each teammate can only be rated once per submission")
        seen.add(item.ratee_id)
        cleaned.append((item, _clean_tags(item.tags)))

    # Deterministic lock order (rater + ratees) → no deadlocks between concurrent submissions.
    stats: dict[uuid.UUID, PlayerStats] = {}
    for uid in sorted({rater.id, *seen}):
        stats[uid] = await gamification.get_stats_for_update(db, uid)

    already = set(
        (
            await db.scalars(
                select(MatchRating.ratee_id).where(
                    MatchRating.lobby_id == lobby.id,
                    MatchRating.rater_id == rater.id,
                    MatchRating.ratee_id.in_(seen),
                )
            )
        ).all()
    )
    previous_raters = set(
        (
            await db.scalars(
                select(distinct(MatchRating.ratee_id)).where(
                    MatchRating.rater_id == rater.id, MatchRating.ratee_id.in_(seen)
                )
            )
        ).all()
    )

    rater_stats = stats[rater.id]
    base_weight = weight_for_stats(rater_stats)
    members_by_user = {m.user_id: m for m in lobby.members}
    now = utcnow()
    submitted = 0

    for item, tags in cleaned:
        if item.ratee_id in already:
            continue  # idempotent per (match, rater, ratee)
        ratee = stats[item.ratee_id]
        outlier = is_outlier(ratee, item.skill, item.fair_play, item.reliability)
        weight = base_weight * (OUTLIER_FACTOR if outlier else 1.0)
        if item.showed_up:
            apply_rating(ratee, item.skill, item.fair_play, item.reliability, weight)
        else:
            # A no-show can't be judged on skill/fair play: feed the current means (neutral) so only
            # reliability moves, whatever placeholder scores the client sent.
            apply_rating(
                ratee,
                bayesian_mean(ratee.skill_wsum or 0.0, ratee.weight_sum or 0.0),
                bayesian_mean(ratee.fair_play_wsum or 0.0, ratee.weight_sum or 0.0),
                1,
                weight,
            )
        if item.ratee_id not in previous_raters:
            ratee.distinct_raters = (ratee.distinct_raters or 0) + 1
        if tags:
            counts = dict(ratee.tag_counts or {})
            for tag in tags:
                counts[tag] = int(counts.get(tag, 0)) + 1
            ratee.tag_counts = counts

        rating = MatchRating(
            id=uuid.uuid4(),
            lobby_id=lobby.id,
            rater_id=rater.id,
            ratee_id=item.ratee_id,
            skill=item.skill,
            fair_play=item.fair_play,
            reliability=item.reliability,
            showed_up=item.showed_up,
            tags=tags,
            weight=round(weight, 4),
            created_at=now,
        )
        db.add(rating)

        if not item.showed_up:
            await db.flush([rating])
            reports = await db.scalar(
                select(func.count()).select_from(MatchRating).where(
                    MatchRating.lobby_id == lobby.id,
                    MatchRating.ratee_id == item.ratee_id,
                    MatchRating.showed_up.is_(False),
                )
            )
            if reports == NO_SHOW_REPORTS:  # exactly when the threshold is crossed → once per match
                apply_no_show(ratee)
                member = members_by_user.get(item.ratee_id)
                if member is not None:
                    member.attended = False

        rating.true_skill_after = ratee.true_skill
        await evaluate_verified(db, ratee)
        await _maybe_fair_play_ace(db, ratee)
        submitted += 1

    xp_awarded = 0
    if submitted:
        rater_stats.ratings_given = (rater_stats.ratings_given or 0) + submitted
        xp_awarded = submitted * XP.RATING_GIVEN
        noun = "teammate" if submitted == 1 else "teammates"
        await gamification.award_xp(db, rater.id, xp_awarded, f"Rated {submitted} {noun}", lobby.id)
        if rater_stats.ratings_given >= CRITIC_RATINGS_GIVEN:
            await gamification.award_badge(db, rater.id, "critic")
    await db.commit()
    return SubmitRatingsResponse(submitted=submitted, xp_awarded=xp_awarded)


async def rating_summary(db: AsyncSession, user: User) -> RatingSummary:
    stats = await db.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id))
    if stats is None:
        stats = PlayerStats(user_id=user.id, ratings_received=0, distinct_raters=0, no_shows=0, tier="rookie",
                            is_verified_playmaker=False, tag_counts={})
    rows = await db.execute(
        select(MatchRating.created_at, MatchRating.true_skill_after)
        .where(MatchRating.ratee_id == user.id, MatchRating.true_skill_after.is_not(None))
        .order_by(MatchRating.created_at)
    )
    daily: dict = {}
    for created_at, value in rows.all():
        daily[to_ist(created_at).date()] = value  # ordered → last value of the day wins
    history = [HistoryPoint(date=d, true_skill=round(v, 1)) for d, v in daily.items()]

    criteria = verified_criteria(stats)

    def r2(v: float | None) -> float | None:
        return round(v, 2) if v is not None else None

    return RatingSummary(
        ratings_received=stats.ratings_received or 0,
        distinct_raters=stats.distinct_raters or 0,
        avg_skill=r2(stats.avg_skill),
        avg_fair_play=r2(stats.avg_fair_play),
        avg_reliability=r2(stats.avg_reliability),
        true_skill=round(stats.true_skill, 1) if stats.true_skill is not None else None,
        tier=stats.tier or "rookie",  # type: ignore[arg-type]
        is_verified_playmaker=bool(stats.is_verified_playmaker),
        top_tags=top_tags(stats.tag_counts),
        history=history,
        verified_progress=VerifiedProgress(eligible=all(c.met for c in criteria), criteria=criteria),
    )


async def send_rating_requests(db: AsyncSession, lobby_id: uuid.UUID) -> int:
    """`match.completed` → ask every paid member to rate their squad. Caller commits."""
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None:
        return 0
    paid = [m.user_id for m in lobby.members if m.status == "paid"]
    if len(paid) < 2:
        return 0
    others = len(paid) - 1
    for uid in paid:
        await notify(
            db, uid, "rating_request", "Rate your squad ⭐",
            f"How did “{lobby.title}” go? Rate your {others} teammates within {settings.rating_window_hours} h "
            f"(+{XP.RATING_GIVEN} XP each).",
            {"lobby_id": lobby.id, "url": f"/app/rate/{lobby.id}"},
        )
    return len(paid)
