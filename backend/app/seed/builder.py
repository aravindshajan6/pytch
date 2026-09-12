"""Demo world builder.

Historical rows (past matches, ratings, XP, recordings) are inserted directly with the ORM so their
timestamps can live in the past — but every state-machine invariant is kept: past slots are `booked`
by `completed` bookings/lobbies whose members are `paid` with matching `payments`; upcoming forming
split lobbies hold their slot until the pay deadline; full-mode hosts are reimbursed per joiner, etc.

Ratings are replayed chronologically through the real aggregation maths (`ratings.service`), so every
`match_ratings.weight` / `true_skill_after` and every `player_stats` aggregate is exactly what the live
system would have produced.
"""

import copy
import math
import random
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import booking_code, short_code
from app.core.config import settings
from app.core.constants import AREAS
from app.core.logging import logger
from app.core.timeutils import IST, ist_today, to_ist, utcnow
from app.modules.bench.models import BenchStatus
from app.modules.bookings.models import Booking
from app.modules.gamification.catalog import XP, level_for_xp
from app.modules.gamification.handlers import next_streak
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.highlights.models import Clip, ClipLike, Recording
from app.modules.lobbies.models import Lobby, LobbyMember, LobbyMessage
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment
from app.modules.ratings import service as ratings
from app.modules.ratings.models import MatchRating
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import PlayerStats, User
from app.modules.wallet.models import WalletTransaction
from app.seed.data import ARCHETYPES, CLIP_TAGS, PLAYERS, POSITION_TAGS, VENUES, PlayerSpec, unsplash

DEMO_PHONE = "+919999900001"
DIYA_PHONE = "+919999900002"
DEMO_LEVEL = (3.45, 4.0, 4.1)  # "true" skill / fair play / reliability the demo user's teammates perceive
DEMO_TRUE_SKILL = (60.0, 65.0)
AREA_COORDS = {a["name"]: (a["lat"], a["lng"]) for a in AREAS}


# ───────────────────────────── in-memory rating replay ─────────────────────────────
@dataclass
class SimStats:
    """Duck-typed stand-in for PlayerStats used by the rating maths during replay."""

    user_id: uuid.UUID
    ratings_received: int = 0
    ratings_given: int = 0
    distinct_raters: int = 0
    weight_sum: float = 0.0
    skill_wsum: float = 0.0
    fair_play_wsum: float = 0.0
    reliability_wsum: float = 0.0
    avg_skill: float | None = None
    avg_fair_play: float | None = None
    avg_reliability: float | None = None
    true_skill: float | None = None
    tier: str = "rookie"
    is_verified_playmaker: bool = False
    no_shows: int = 0
    tag_counts: dict[str, int] = field(default_factory=dict)


SIM_FIELDS = [
    "ratings_received", "ratings_given", "distinct_raters", "weight_sum", "skill_wsum", "fair_play_wsum",
    "reliability_wsum", "avg_skill", "avg_fair_play", "avg_reliability", "true_skill", "tier",
    "is_verified_playmaker", "no_shows", "tag_counts",
]


@dataclass
class RatingEvent:
    at: datetime
    lobby_id: uuid.UUID
    rater_id: uuid.UUID
    ratee_id: uuid.UUID
    skill: int
    fair_play: int
    reliability: int
    tags: list[str]
    weight: float = 1.0
    true_skill_after: float | None = None


@dataclass
class MatchPlan:
    key: str
    pitch_key: str
    start: datetime
    host_id: uuid.UUID
    participants: list[uuid.UUID]
    title: str
    total_spots: int
    recorded: bool = False
    pending_for_demo: bool = False
    lobby: Lobby | None = None


def replay(baseline: dict[uuid.UUID, SimStats], events: list[RatingEvent]) -> dict[uuid.UUID, SimStats]:
    stats = copy.deepcopy(baseline)
    pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for ev in sorted(events, key=lambda e: e.at):
        rater, ratee = stats[ev.rater_id], stats[ev.ratee_id]
        outlier = ratings.is_outlier(ratee, ev.skill, ev.fair_play, ev.reliability)
        ev.weight = round(ratings.weight_for_stats(rater) * (ratings.OUTLIER_FACTOR if outlier else 1.0), 4)
        ratings.apply_rating(ratee, ev.skill, ev.fair_play, ev.reliability, ev.weight)
        if (ev.rater_id, ev.ratee_id) not in pairs:
            pairs.add((ev.rater_id, ev.ratee_id))
            ratee.distinct_raters += 1
        for tag in ev.tags:
            ratee.tag_counts[tag] = ratee.tag_counts.get(tag, 0) + 1
        rater.ratings_given += 1
        ev.true_skill_after = ratee.true_skill
        ratee.is_verified_playmaker = ratings.is_verified_eligible(ratee)  # type: ignore[arg-type]
    return stats


# ───────────────────────────── seeder ─────────────────────────────
class Seeder:
    def __init__(self, db: AsyncSession, *, seed: int = 20260912) -> None:
        self.db = db
        self.rng = random.Random(seed)
        self.now = utcnow()
        self.today = ist_today()
        self.turfs: dict[str, Turf] = {}
        self.pitches: dict[str, Pitch] = {}
        self.users: dict[str, User] = {}  # by name
        self.specs: dict[uuid.UUID, PlayerSpec] = {}
        self.levels: dict[uuid.UUID, tuple[float, float, float]] = {}
        self.baseline: dict[uuid.UUID, SimStats] = {}
        self.counters: dict[uuid.UUID, dict[str, Any]] = defaultdict(dict)
        self.xp: list[XpEvent] = []
        self.ledger: dict[uuid.UUID, list[tuple[datetime, int, str, str, uuid.UUID | None]]] = defaultdict(list)
        self.badges: dict[uuid.UUID, dict[str, datetime]] = defaultdict(dict)
        self.played: dict[uuid.UUID, list[datetime]] = defaultdict(list)
        self.hosted: dict[uuid.UUID, int] = defaultdict(int)
        self.past: list[MatchPlan] = []
        self.final_stats: dict[uuid.UUID, SimStats] = {}
        self.storm_lobby: Lobby | None = None
        self.demo: User
        self.diya: User

    # ── helpers ──
    def at_ist(self, day: date, hour: int, minute: int = 0) -> datetime:
        return datetime.combine(day, time(hour % 24, minute), tzinfo=IST).astimezone(UTC)

    def jitter(self, lat: float, lng: float, spread: float = 0.008) -> tuple[float, float]:
        return round(lat + self.rng.uniform(-spread, spread), 5), round(lng + self.rng.uniform(-spread, spread), 5)

    def uid(self, name: str) -> uuid.UUID:
        return self.users[name].id

    def xp_event(self, user_id: uuid.UUID, amount: int, reason: str, at: datetime, ref: uuid.UUID | None = None):
        self.xp.append(XpEvent(id=uuid.uuid4(), user_id=user_id, amount=amount, reason=reason[:80], ref_id=ref,
                               created_at=at))

    def badge(self, user_id: uuid.UUID, code: str, at: datetime) -> None:
        current = self.badges[user_id].get(code)
        if current is None or at < current:
            self.badges[user_id][code] = at

    async def unique_codes(self) -> tuple[str, str]:
        while True:
            lobby_code, bcode = short_code(6), booking_code()
            clash = await self.db.scalar(select(Lobby.id).where(Lobby.code == lobby_code))
            clash = clash or await self.db.scalar(select(Booking.id).where(Booking.code == bcode))
            if not clash:
                return lobby_code, bcode

    # ── 1. venues + slots ──
    async def venues(self) -> None:
        for spec in VENUES:
            turf = Turf(
                id=uuid.uuid4(), slug=spec.slug, name=spec.name, description=spec.description, area=spec.area,
                address=spec.address, lat=spec.lat, lng=spec.lng, phone=spec.phone, cover_url=unsplash(spec.cover),
                photos=[unsplash(p) for p in (spec.cover, *spec.photos)], amenities=list(spec.amenities),
                open_time=time(spec.open_hour), close_time=time(spec.close_hour % 24), rating_avg=spec.rating,
                rating_count=spec.rating_count, is_active=True,
            )
            self.db.add(turf)
            self.turfs[spec.slug] = turf
            for p in spec.pitches:
                pitch = Pitch(
                    id=uuid.uuid4(), name=p.name, sport=p.sport, format=p.format, capacity=p.capacity,
                    is_indoor=p.indoor, has_camera=p.camera_fee > 0, camera_price_paise=p.camera_fee * 100,
                    price_per_hour_paise=p.price * 100, peak_price_per_hour_paise=p.peak * 100, is_active=True,
                )
                pitch.turf = turf
                self.db.add(pitch)
                self.pitches[p.key] = pitch
        await self.db.flush()

    async def slots(self) -> int:
        from app.modules.slots.service import generate_slots_for_pitch

        total = 0
        for pitch in self.pitches.values():
            total += await generate_slots_for_pitch(self.db, pitch, days=settings.slot_horizon_days)
        await self.db.flush()
        return total

    def slot_price(self, pitch: Pitch, start: datetime) -> tuple[int, bool]:
        local = to_ist(start)
        peak = local.weekday() >= 5 or 17 <= local.hour < 22
        return (pitch.peak_price_per_hour_paise if peak else pitch.price_per_hour_paise), peak

    async def slot_at(self, pitch: Pitch, start: datetime) -> Slot:
        slot = await self.db.scalar(select(Slot).where(Slot.pitch_id == pitch.id, Slot.start_at == start))
        if slot is None:
            price, peak = self.slot_price(pitch, start)
            slot = Slot(id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
                        price_paise=price, is_peak=peak, status="available")
            self.db.add(slot)
            await self.db.flush([slot])
        return slot

    # ── 2. people ──
    def baseline_stats(self, user_id: uuid.UUID, archetype: str, position: str | None) -> SimStats:
        a = ARCHETYPES[archetype]
        rng = self.rng
        s = SimStats(user_id=user_id)
        n = rng.randint(*a["n"])
        if n:
            weight = n * rng.uniform(0.7, 0.9)
            targets = [rng.uniform(*a[k]) for k in ("skill", "fair", "rel")]
            s.weight_sum = weight
            s.skill_wsum, s.fair_play_wsum, s.reliability_wsum = (t * (ratings.PRIOR_WEIGHT + weight)
                                                                   - ratings.PRIOR_MEAN * ratings.PRIOR_WEIGHT
                                                                   for t in targets)
            s.ratings_received = n
            s.distinct_raters = min(n, rng.randint(*a["raters"]))
            tags = POSITION_TAGS.get(position, POSITION_TAGS[None])
            for _ in range(int(n * rng.uniform(0.5, 1.1))):
                tag = rng.choice(tags)
                s.tag_counts[tag] = s.tag_counts.get(tag, 0) + 1
            self.levels[user_id] = (targets[0] + 0.05, targets[1] + 0.05, targets[2] + 0.05)
        else:
            self.levels[user_id] = (rng.uniform(*a["skill"]), rng.uniform(*a["fair"]), rng.uniform(*a["rel"]))
        s.no_shows = rng.randint(*a["no_shows"])
        s.ratings_given = rng.randint(*a["played"]) * rng.randint(1, 3) // 2
        ratings.recompute(s)  # type: ignore[arg-type]
        s.is_verified_playmaker = ratings.is_verified_eligible(s)  # type: ignore[arg-type]
        return s

    def make_user(self, name: str, phone: str, area: str, *, sports: list[str], position: str | None,
                  skill_level: str | None, foot: str | None, bio: str | None) -> User:
        lat, lng = self.jitter(*AREA_COORDS[area])
        user = User(
            id=uuid.uuid4(), phone=phone, name=name, bio=bio, position=position, dominant_foot=foot,
            self_skill_level=skill_level, preferred_sports=sports, home_lat=lat, home_lng=lng, home_area=area,
            wallet_balance_paise=0, onboarded=True, is_bot=False,
            last_seen_at=self.now - timedelta(minutes=self.rng.randint(5, 3000)),
            created_at=self.now - timedelta(days=self.rng.randint(40, 300)),
        )
        user.stats = PlayerStats(user_id=user.id)
        self.db.add(user)
        self.users[name] = user
        return user

    async def people(self) -> None:
        rng = self.rng
        self.demo = self.make_user(
            "Arjun Menon", DEMO_PHONE, "Kakkanad", sports=["football"], position="Midfielder",
            skill_level="intermediate", foot="right",
            bio="Weekend midfielder, weekday product manager. Always up for 5s.",
        )
        self.demo.home_lat, self.demo.home_lng = AREA_COORDS["Kakkanad"]
        self.demo.created_at = self.now - timedelta(days=24)
        self.baseline[self.demo.id] = SimStats(user_id=self.demo.id)
        self.levels[self.demo.id] = DEMO_LEVEL
        self.counters[self.demo.id] = {"played": 0, "hosted": 0, "subs": 0, "dropouts": 0, "streak": 0,
                                       "last": None, "xp": 0}

        self.diya = self.make_user(
            "Diya Nair", DIYA_PHONE, "Edappally", sports=["badminton", "pickleball", "football"], position="Winger",
            skill_level="advanced", foot="left", bio="Smash first, ask questions later 🏸",
        )
        self.baseline[self.diya.id] = self.baseline_stats(self.diya.id, "skilled", None)
        self.counters[self.diya.id] = {"played": 9, "hosted": 3, "subs": 1, "dropouts": 0, "streak": 2,
                                       "last": self.now - timedelta(days=4), "xp": 1350}

        for i, spec in enumerate(PLAYERS):
            user = self.make_user(
                spec.name, f"+9197{i + 10:02d}{rng.randint(100000, 999999)}", spec.area, sports=list(spec.sports),
                position=spec.position, skill_level=spec.skill_level, foot=spec.foot, bio=spec.bio,
            )
            self.specs[user.id] = spec
            self.baseline[user.id] = self.baseline_stats(user.id, spec.archetype, spec.position)
            a = ARCHETYPES[spec.archetype]
            played = rng.randint(*a["played"])
            self.counters[user.id] = {
                "played": played, "hosted": rng.randint(*a["hosted"]), "subs": rng.randint(*a["subs"]),
                "dropouts": rng.randint(0, 2) if spec.archetype != "verified" else 0,
                "streak": rng.randint(0, 6) if played > 3 else rng.randint(0, 1),
                "last": self.now - timedelta(days=rng.randint(8, 16), hours=rng.randint(0, 12)),
                "xp": rng.randint(*a["xp"]),
            }
        await self.db.flush()

    # ── 3. matches (shared by past & upcoming) ──
    def payment(self, member: LobbyMember, lobby: Lobby, purpose: str, amount: int, at: datetime) -> Payment:
        return Payment(
            id=uuid.uuid4(), user_id=member.user_id, lobby_id=lobby.id, booking_id=lobby.booking_id,
            member_id=member.id, purpose=purpose, provider="mock", amount_paise=amount, credits_applied_paise=0,
            payable_paise=amount, status="paid", provider_order_id=f"mock_order_{uuid.uuid4().hex[:16]}",
            provider_payment_id=f"mock_pay_{uuid.uuid4().hex[:16]}", meta={"seed": True}, paid_at=at,
            created_at=at - timedelta(seconds=40), updated_at=at,
        )

    async def build_match(
        self,
        *,
        pitch_key: str,
        start: datetime,
        host_id: uuid.UUID,
        members: list[tuple[uuid.UUID, str]],  # (user_id, "paid" | "joined") — host first
        title: str,
        mode: str,
        status: str,  # forming | confirmed | completed
        total_spots: int,
        visibility: str = "public",
        recorded: bool = False,
        min_true_skill: float | None = None,
        verified_only: bool = False,
        notes: str | None = None,
        created_at: datetime | None = None,
        pay_deadline: datetime | None = None,
    ) -> Lobby:
        pitch = self.pitches[pitch_key]
        turf = pitch.turf
        slot = await self.slot_at(pitch, start)
        camera = pitch.camera_price_paise if recorded else 0
        total = slot.price_paise + camera
        share = math.ceil(total / total_spots / 100) * 100
        created_at = created_at or (start - timedelta(days=self.rng.randint(1, 3), hours=self.rng.randint(0, 8)))
        confirmed_at = None if status == "forming" else created_at + timedelta(minutes=self.rng.randint(3, 25))
        lobby_code, bcode = await self.unique_codes()
        booking = Booking(
            id=uuid.uuid4(), code=bcode, slot_id=slot.id, host_id=host_id, mode=mode,
            status={"forming": "pending_payment", "confirmed": "confirmed", "completed": "completed"}[status],
            pitch_fee_paise=slot.price_paise, recording_fee_paise=camera, total_paise=total, recorded=recorded,
            expires_at=pay_deadline if status == "forming" else None, confirmed_at=confirmed_at,
            created_at=created_at, updated_at=confirmed_at or created_at,
        )
        lobby = Lobby(
            id=uuid.uuid4(), code=lobby_code, booking_id=booking.id, slot_id=slot.id, pitch_id=pitch.id,
            turf_id=turf.id, host_id=host_id, title=title, sport=pitch.sport, format=pitch.format, mode=mode,
            visibility=visibility, status=status, total_spots=total_spots, share_paise=share,
            pay_deadline=pay_deadline if status == "forming" else None, start_at=slot.start_at, end_at=slot.end_at,
            min_true_skill=min_true_skill, verified_only=verified_only, recorded=recorded, notes=notes,
            confirmed_at=confirmed_at,
            completed_at=slot.end_at + timedelta(minutes=self.rng.randint(2, 9)) if status == "completed" else None,
            created_at=created_at, updated_at=confirmed_at or created_at,
        )
        self.db.add(booking)
        await self.db.flush([booking])
        self.db.add(lobby)
        await self.db.flush([lobby])
        if status == "forming":
            slot.status, slot.held_until, slot.held_by_id = "held", pay_deadline, host_id
        else:
            slot.status, slot.held_until, slot.held_by_id = "booked", None, None
        slot.booking_id = booking.id

        names = {u.id: u.name for u in self.users.values()}
        payments: list[Payment] = []
        # joins spread between creation and confirmation (split) / now (forming, full-mode joiners)
        horizon = confirmed_at if (confirmed_at and mode == "split") else min(self.now, start)
        span = max(timedelta(seconds=60), (horizon - created_at) * 0.9)
        for i, (user_id, state) in enumerate(members):
            is_host = user_id == host_id
            owed = total if (is_host and mode == "full") else share
            joined_at = created_at + span * (i / max(1, len(members)))
            paid = state == "paid"
            paid_at = None
            if paid:
                paid_at = min(joined_at + timedelta(seconds=self.rng.randint(30, 150)), horizon)
            member = LobbyMember(
                id=uuid.uuid4(), lobby_id=lobby.id, user_id=user_id, role="host" if is_host else "player",
                status=state, team=None, share_paise=owed, paid_paise=owed if paid else 0, discount_paise=0,
                compensated_paise=0, joined_at=joined_at, paid_at=paid_at,
                reserved_until=None if paid else min(pay_deadline or self.now, self.now + timedelta(minutes=7)),
            )
            self.db.add(member)
            if paid:
                purpose = "full" if (is_host and mode == "full") else "share"
                payments.append(self.payment(member, lobby, purpose, owed, paid_at))  # type: ignore[arg-type]
                if mode == "full" and not is_host:
                    self.ledger[host_id].append(
                        (paid_at, owed, "reimbursement", f"{names.get(user_id, 'A player')} paid for {title}",  # type: ignore[arg-type]
                         lobby.id)
                    )
        await self.db.flush()
        self.db.add_all(payments)
        if confirmed_at:
            self.hosted[host_id] += 1
            self.xp_event(host_id, XP.MATCH_HOSTED, f"Hosted {title}", confirmed_at, lobby.id)
        await self.db.refresh(lobby, attribute_names=["members"])
        return lobby

    # ── 4. past matches + ratings ──
    def football_pool(self, exclude: set[uuid.UUID], *, rookies: bool = False) -> list[uuid.UUID]:
        """Community footballers (rookies stay out of rated matches so they remain rookies)."""
        return [
            uid for uid, spec in self.specs.items()
            if "football" in spec.sports and uid not in exclude and (rookies or spec.archetype != "rookie")
        ]

    def plan_past(self) -> list[MatchPlan]:
        rng = self.rng
        demo = self.demo.id
        # most recent completed match (≤ 24 h ago) → pending ratings for the demo user
        recent = self.at_ist(self.today, 20)
        if recent + timedelta(minutes=75) > self.now:
            recent = self.at_ist(self.today - timedelta(days=1), 20)
        specs = [
            ("p1", "itr-1", 9, 20, "Nikhil Varghese", 10, True, "Infopark After-Hours"),
            ("p2", "bwa-a", 7, 21, None, 10, True, "Thursday Night Fives"),
            ("p3", "ppt-5s", 5, 19, "Rahul Nair", 10, True, "Friday Floodlights"),
            ("p4", "mls-5s", 4, 6, "Sandeep Kurup", 10, False, "Early Kick Club"),
            ("p5", "kkd-7s", 3, 19, None, 12, False, "Sunset Sevens"),  # ≥ 48 h ago → rating window closed
            ("c1", "nf-5s", 6, 21, "Sachin Babu", 10, False, "Kaloor Late Show"),
            ("c2", "arh-7s", 4, 18, "Adarsh Menon", 14, False, "Riverside Sevens"),
        ]
        plans: list[MatchPlan] = []
        for key, pitch_key, days_ago, hour, host_name, spots, recorded, title in specs:
            start = self.at_ist(self.today - timedelta(days=days_ago), hour)
            with_demo = key.startswith("p")
            host = demo if host_name is None else self.uid(host_name)
            base = [demo] if with_demo else []
            if host not in base:
                base.append(host)
            others = rng.sample(self.football_pool(set(base)), spots - len(base))
            participants = [host] + [u for u in base + others if u != host]
            plans.append(MatchPlan(key, pitch_key, start, host, participants, title, spots, recorded))
        host6 = self.uid("Vishnu Prasad")
        others6 = rng.sample(self.football_pool({demo, host6}), 8)
        plans.append(MatchPlan("p6", "egf-open", recent, host6, [host6, demo, *others6], "Weekend Warriors Warm-up",
                               10, False, pending_for_demo=True))
        # a badminton doubles night for Diya's crew
        badminton = [self.diya.id, self.uid("Sreelakshmi Pillai"), self.uid("Devika Suresh"), self.uid("Neethu Paul")]
        plans.append(MatchPlan("c3", "tph-bad1", self.at_ist(self.today - timedelta(days=1), 19), self.diya.id,
                               badminton, "Shuttle Smash Doubles", 4))
        return sorted(plans, key=lambda p: p.start)

    def rating_events(self, rng: random.Random) -> list[RatingEvent]:
        demo = self.demo.id
        events: list[RatingEvent] = []

        def score(level: float) -> int:
            return max(1, min(5, round(rng.gauss(level, 0.7))))

        def tags_for(uid: uuid.UUID) -> list[str]:
            spec = self.specs.get(uid)
            pos = spec.position if spec else ("Midfielder" if uid == demo else None)
            if rng.random() > 0.65:
                return []
            pool = POSITION_TAGS.get(pos, POSITION_TAGS[None])
            return rng.sample(pool, rng.randint(1, 2))

        for plan in self.past:
            lobby = plan.lobby
            assert lobby is not None
            end = lobby.end_at
            latest = min(end + timedelta(hours=20), self.now - timedelta(minutes=10))
            parts = plan.participants
            demo_raters: set[uuid.UUID] = set()
            if demo in parts:
                pool = [p for p in parts if p != demo]
                demo_raters = set(rng.sample(pool, 2 if plan.pending_for_demo else 3))
            for rater in parts:
                if rater == demo and plan.pending_for_demo:
                    continue
                pool = [p for p in parts if p not in (rater, demo)]
                if not pool:
                    continue
                k = 4 if rater == demo else rng.randint(min(2, len(pool)), min(4, len(pool)))
                targets = rng.sample(pool, min(k, len(pool)))
                if rater in demo_raters:
                    targets.append(demo)
                span = max(60, int((latest - end).total_seconds()) - 900)
                at = end + timedelta(seconds=900 + rng.randint(0, span))
                for j, ratee in enumerate(targets):
                    lvl = self.levels[ratee]
                    events.append(
                        RatingEvent(at + timedelta(seconds=j * 7), lobby.id, rater, ratee, score(lvl[0]),
                                    score(lvl[1]), score(lvl[2]), tags_for(ratee))
                    )
        return events

    async def past_matches(self) -> None:
        self.past = self.plan_past()
        for plan in self.past:
            members = [(uid, "paid") for uid in plan.participants]
            plan.lobby = await self.build_match(
                pitch_key=plan.pitch_key, start=plan.start, host_id=plan.host_id, members=members, title=plan.title,
                mode="split", status="completed", total_spots=plan.total_spots, recorded=plan.recorded,
            )
            lobby = plan.lobby
            for uid in plan.participants:
                self.played[uid].append(lobby.start_at)
                self.xp_event(uid, XP.MATCH_PLAYED, f"Played {lobby.title}", lobby.completed_at, lobby.id)  # type: ignore[arg-type]
            self.db.add(LobbyMessage(id=uuid.uuid4(), lobby_id=lobby.id, user_id=None, kind="system",
                                     body="✅ All paid — match confirmed. See you on the pitch!",
                                     created_at=lobby.confirmed_at))
            self.db.add(LobbyMessage(id=uuid.uuid4(), lobby_id=lobby.id, user_id=None, kind="system",
                                     body="🏁 Full time! Rate your teammates within 48 h.",
                                     created_at=lobby.completed_at))

        # replay ratings with the first RNG seed that lands the demo user in the target True Skill band
        chosen: tuple[list[RatingEvent], dict[uuid.UUID, SimStats]] | None = None
        for attempt in range(400):
            events = self.rating_events(random.Random(1000 + attempt))
            final = replay(self.baseline, events)
            ts = final[self.demo.id].true_skill or 0
            if DEMO_TRUE_SKILL[0] <= ts <= DEMO_TRUE_SKILL[1]:
                chosen = (events, final)
                break
        if chosen is None:  # pragma: no cover — extremely unlikely
            chosen = (events, final)
            logger.warning("seed: demo True Skill landed at %.1f", final[self.demo.id].true_skill or 0)
        events, final = chosen
        self.final_stats = final
        for ev in events:
            self.db.add(MatchRating(
                id=uuid.uuid4(), lobby_id=ev.lobby_id, rater_id=ev.rater_id, ratee_id=ev.ratee_id, skill=ev.skill,
                fair_play=ev.fair_play, reliability=ev.reliability, showed_up=True, tags=ev.tags, weight=ev.weight,
                true_skill_after=ev.true_skill_after, created_at=ev.at,
            ))
        submissions: dict[tuple[uuid.UUID, uuid.UUID], list[RatingEvent]] = defaultdict(list)
        for ev in events:
            submissions[(ev.lobby_id, ev.rater_id)].append(ev)
        for (lobby_id, rater_id), evs in submissions.items():
            n = len(evs)
            self.xp_event(rater_id, XP.RATING_GIVEN * n, f"Rated {n} teammate{'s' if n != 1 else ''}",
                          max(e.at for e in evs), lobby_id)
        logger.info("seed: %d ratings replayed; demo True Skill %.1f", len(events), final[self.demo.id].true_skill or 0)

    # ── 5. recordings + clips ──
    async def highlights(self) -> None:
        from app.modules.highlights.service import footage_library

        library = list(footage_library())
        if not library:
            logger.warning("seed: no demo footage found in %s/footage — skipping recordings", settings.media_dir)
            return
        rng = self.rng
        demo = self.demo.id
        recorded = [p for p in self.past if p.recorded and p.lobby is not None]
        everyone = [u.id for u in self.users.values()]
        demo_clip_titles = iter(["Solo run from halfway", "Top-bins volley 🚀", "Nutmeg of the week"])
        other_titles = iter(["One-touch team goal", "Keeper says no!", "Last-ditch block", "Panenka penalty",
                             "Rabona assist 😮", "Double save scramble", "Worldie from the corner"])
        demo_clip_no = 0
        likes: list[ClipLike] = []
        for i, plan in enumerate(recorded[:3]):
            lobby = plan.lobby
            assert lobby is not None
            item = library[i % len(library)]
            duration = float(item.get("duration_s") or 45.0)
            ready_at = lobby.completed_at + timedelta(minutes=rng.randint(2, 6))  # type: ignore[operator]
            recording = Recording(
                id=uuid.uuid4(), lobby_id=lobby.id, pitch_id=lobby.pitch_id, status="ready",
                video_url=f"{settings.media_url_prefix}/footage/{item['file']}",
                thumbnail_url=f"{settings.media_url_prefix}/thumbs/{item['thumbnail']}" if item.get("thumbnail")
                else None,
                duration_s=duration, process_after=lobby.completed_at + timedelta(seconds=20),  # type: ignore[operator]
                ready_at=ready_at, created_at=lobby.completed_at,
            )
            self.db.add(recording)
            self.db.add(Notification(
                id=uuid.uuid4(), user_id=demo, type="recording_ready", title="🎬 Your match footage is ready",
                body=f"Relive “{lobby.title}” — clip your best moments and pin them to your profile.",
                data={"recording_id": str(recording.id), "lobby_id": str(lobby.id),
                      "url": f"/app/highlights/recordings/{recording.id}"},
                read_at=ready_at + timedelta(hours=2), created_at=ready_at,
            ))
            owners = [demo] + rng.sample([p for p in plan.participants if p != demo], 2)
            for j, owner in enumerate(owners):
                length = rng.uniform(5, 14)
                start_s = round(rng.uniform(0, max(0.0, duration - length - 0.5)), 1)
                end_s = round(min(duration, start_s + length), 1)
                is_demo = owner == demo
                title = next(demo_clip_titles) if is_demo else next(other_titles)
                created = ready_at + timedelta(hours=rng.uniform(0.5, 9))
                pinned = (is_demo and demo_clip_no < 2) or (not is_demo and j == 1)
                likers = rng.sample([u for u in everyone if u != owner], rng.randint(4, 17))
                clip = Clip(
                    id=uuid.uuid4(), recording_id=recording.id, user_id=owner, title=title, start_s=start_s,
                    end_s=end_s, tags=rng.sample(CLIP_TAGS, rng.randint(1, 2)), is_pinned=pinned,
                    likes_count=len(likers), views=rng.randint(len(likers) * 4, 520), created_at=created,
                )
                self.db.add(clip)
                likes += [
                    ClipLike(clip_id=clip.id, user_id=u, created_at=created + timedelta(minutes=rng.randint(5, 900)))
                    for u in likers
                ]
                self.xp_event(owner, XP.CLIP_CREATED, f"Clipped “{title}”", created, clip.id)
                if pinned:
                    self.badge(owner, "highlight_reel", created + timedelta(minutes=2))
                if is_demo:
                    demo_clip_no += 1
        await self.db.flush()  # clips first — clip_likes has no ORM relationship to order the inserts
        self.db.add_all(likes)
        await self.db.flush()

    # ── 6. upcoming lobbies ──
    def upcoming_start(self, day_offset: int, hour: int, *, min_lead: timedelta = timedelta(hours=2)) -> datetime:
        start = self.at_ist(self.today + timedelta(days=day_offset), hour)
        while start < self.now + min_lead:
            start += timedelta(days=1)
        return start

    async def upcoming(self) -> None:
        rng = self.rng
        demo, diya = self.demo.id, self.diya.id
        u = self.uid
        verified = [uid for uid, s in self.final_stats.items() if s.is_verified_playmaker and uid in self.specs]
        if not verified:  # pragma: no cover — archetypes guarantee a few
            verified = sorted(self.specs, key=lambda x: -(self.final_stats[x].true_skill or 0))[:4]
        strong = [uid for uid, s in self.final_stats.items()
                  if (s.true_skill or 0) >= 60 and uid in self.specs and "football" in self.specs[uid].sports]

        def pick(pool: list[uuid.UUID], k: int, exclude: set[uuid.UUID]) -> list[uuid.UUID]:
            pool = [p for p in pool if p not in exclude]
            return rng.sample(pool, min(k, len(pool)))

        # ⛈️ storm demo — the demo user hosts a full split 5s tomorrow evening on an OUTDOOR camera-less slot
        storm_mates = pick(self.football_pool({demo}), 9, {demo})
        storm_start = self.at_ist(self.today + timedelta(days=1), 19)
        storm_created = self.now - timedelta(hours=5)
        storm = await self.build_match(
            pitch_key="bwa-a", start=storm_start, host_id=demo,
            members=[(demo, "paid")] + [(m, "paid") for m in storm_mates],
            title="Sunday Night Fives", mode="split", status="confirmed", total_spots=10, visibility="public",
            notes="Bring both kits (white/dark). Parking behind the hub.", created_at=storm_created,
        )
        self.storm_lobby = storm
        self.db.add(LobbyMessage(id=uuid.uuid4(), lobby_id=storm.id, user_id=None, kind="system",
                                 body="✅ All 10 paid — match confirmed!", created_at=storm.confirmed_at))
        chat = [(storm_mates[0], "Who's bringing the ball?"), (demo, "Got two, relax 😄"),
                (storm_mates[1], "Forecast says rain tomorrow evening… 👀")]
        for k, (sender, body) in enumerate(chat):
            self.db.add(LobbyMessage(id=uuid.uuid4(), lobby_id=storm.id, user_id=sender, kind="chat", body=body,
                                     created_at=storm.confirmed_at + timedelta(minutes=10 + k * 7)))  # type: ignore[operator]

        # forming split lobbies with a live payment window (20–28 min left)
        forming = [
            ("nf-5s", 0, 19, "Kaloor Friday-ish Fives", u("Muhammed Shafeeq"), 22, 4, 2),
            ("egf-open", 1, 7, "Sunrise Scrimmage", u("Amal Jose"), 27, 3, 1),
            ("hk-5s", 2, 18, "Fort Kochi Sundowner", u("Irfan Ali"), 25, 5, 2),
        ]
        for pitch_key, day, hour, title, host, minutes_left, paid_others, joined in forming:
            start = self.upcoming_start(day, hour, min_lead=timedelta(hours=1))
            deadline = self.now + timedelta(minutes=minutes_left)
            mates = pick(self.football_pool({host, demo}), paid_others + joined, {host, demo})
            members = [(host, "paid")] + [(m, "paid") for m in mates[:paid_others]]
            members += [(m, "joined") for m in mates[paid_others:]]
            await self.build_match(
                pitch_key=pitch_key, start=start, host_id=host, members=members, title=title, mode="split",
                status="forming", total_spots=10,
                created_at=deadline - timedelta(minutes=settings.split_window_minutes),
                pay_deadline=deadline, notes="Split evenly — pay your share within 30 minutes to lock the pitch.",
            )

        # confirmed full-mode open matches with spots left
        sandeep, nikhil, gokul = u("Sandeep Kurup"), u("Nikhil Varghese"), u("Gokul Das")
        confirmed = [
            dict(pitch_key="mls-7s", day=1, hour=20, title="Seaside Sevens", host=sandeep, spots=14,
                 mates=pick(self.football_pool({demo, sandeep}), 7, set()) + [demo],
                 notes="All levels. Bibs provided."),
            dict(pitch_key="itr-2", day=2, hour=20, title="Verified Only · Infopark Elite", host=verified[0],
                 spots=10, mates=pick(verified, 4, {verified[0]}), verified_only=True,
                 notes="Verified Playmakers only — high tempo."),
            dict(pitch_key="ppt-5s", day=3, hour=19, title="Skill 60+ Panampilly Session", host=nikhil,
                 spots=10, mates=pick(strong, 5, {nikhil, demo}), min_true_skill=60.0,
                 notes="True Skill 60+ so the game stays sharp."),
            dict(pitch_key="kcc-5s", day=4, hour=18, title="Campus Kickabout", host=gokul, spots=10,
                 mates=pick(self.football_pool({demo, gokul}, rookies=True), 4, set()),
                 notes="Chill game, newbies welcome."),
            dict(pitch_key="tph-bad1", day=1, hour=18, title="Doubles Night 🏸", host=diya, spots=4,
                 mates=[u("Sreelakshmi Pillai"), u("Devika Suresh")],
                 notes="Intermediate+ doubles, feathers provided."),
            dict(pitch_key="arh-nets", day=2, hour=17, title="Net Session · Pace & Spin", host=u("Varun Mathew"),
                 spots=6, mates=[u("Shyam Sundar"), u("Adarsh Menon"), self.uid("Rohit Chandran")],
                 notes="Bowling machine booked for the first 30 min."),
            dict(pitch_key="mls-pb", day=4, hour=7, title="Sunrise Pickleball", host=u("Meera Nambiar"), spots=4,
                 mates=[u("Aswathy Krishnan")], notes="Paddles available at the counter."),
        ]
        for spec in confirmed:
            start = self.upcoming_start(spec["day"], spec["hour"])
            members = [(spec["host"], "paid")] + [(m, "paid") for m in spec["mates"] if m != spec["host"]]
            lobby = await self.build_match(
                pitch_key=spec["pitch_key"], start=start, host_id=spec["host"], members=members, title=spec["title"],
                mode="full", status="confirmed", total_spots=spec["spots"],
                min_true_skill=spec.get("min_true_skill"), verified_only=spec.get("verified_only", False),
                notes=spec.get("notes"), created_at=self.now - timedelta(hours=rng.randint(6, 30)),
            )
            if demo in spec["mates"]:
                self.db.add(Notification(
                    id=uuid.uuid4(), user_id=spec["host"], type="member_joined", title="New player joined",
                    body=f"Arjun joined {lobby.title}.",
                    data={"lobby_id": str(lobby.id), "url": f"/app/lobby/{lobby.id}"},
                    created_at=self.now - timedelta(hours=2),
                ))
        await self.db.flush()

    # ── 7. bench ──
    async def benches(self) -> None:
        rng = self.rng
        for uid, spec in self.specs.items():
            if not spec.bench:
                continue
            user = next(x for x in self.users.values() if x.id == uid)
            lat, lng = self.jitter(user.home_lat, user.home_lng, 0.01)  # type: ignore[arg-type]
            self.db.add(BenchStatus(
                user_id=uid, is_active=True, lat=lat, lng=lng, radius_km=float(rng.choice([5, 6, 8, 10])),
                sports=[s for s in spec.sports if s in ("football", "cricket", "badminton", "pickleball")],
                active_until=self.now + timedelta(minutes=rng.randint(150, 240)),
                updated_at=self.now - timedelta(minutes=rng.randint(2, 40)),
            ))
        self.db.add(BenchStatus(user_id=self.diya.id, is_active=False, lat=self.diya.home_lat, lng=self.diya.home_lng,
                                radius_km=5.0, sports=["badminton", "football"], active_until=None,
                                updated_at=self.now - timedelta(days=2)))
        await self.db.flush()

    # ── 8. stats, XP, badges, wallets ──
    async def finalize(self) -> None:
        rng = self.rng
        stats_rows = {
            s.user_id: s
            for s in (await self.db.scalars(select(PlayerStats).where(
                PlayerStats.user_id.in_([u.id for u in self.users.values()])))).all()
        }
        # legacy XP for pre-seed history
        for user in self.users.values():
            c = self.counters[user.id]
            if c.get("xp"):
                self.xp_event(user.id, c["xp"], "Season 1 progress", user.created_at + timedelta(days=3))
        xp_totals: dict[uuid.UUID, int] = defaultdict(int)
        for ev in self.xp:
            xp_totals[ev.user_id] += ev.amount
        self.db.add_all(self.xp)

        for user in self.users.values():
            stats = stats_rows[user.id]
            sim = self.final_stats.get(user.id) or self.baseline[user.id]
            for name in SIM_FIELDS:
                setattr(stats, name, copy.deepcopy(getattr(sim, name)))
            c = self.counters[user.id]
            matches = sorted(self.played[user.id])
            stats.matches_played = c["played"] + len(matches)
            stats.matches_hosted = c["hosted"] + self.hosted[user.id]
            stats.subs_made = c["subs"]
            stats.dropouts = c["dropouts"]
            stats.streak_weeks = c["streak"]
            stats.last_match_at = c["last"]
            for kickoff in matches:
                stats.streak_weeks = next_streak(stats, kickoff)
                if stats.last_match_at is None or kickoff > stats.last_match_at:
                    stats.last_match_at = kickoff
            stats.xp = xp_totals[user.id]
            stats.level = level_for_xp(stats.xp)
            stats.verified_at = (self.now - timedelta(days=rng.randint(2, 40))) if stats.is_verified_playmaker else None

            # badges consistent with the counters
            since = user.created_at
            thresholds = [(1, "first_whistle"), (3, "hat_trick"), (10, "regular"), (50, "veteran")]
            for n, code in thresholds:
                if stats.matches_played >= n:
                    idx = n - 1 - c["played"]
                    at = matches[idx] + timedelta(hours=1) if 0 <= idx < len(matches) else since + timedelta(days=n)
                    self.badge(user.id, code, min(at, self.now))
            if stats.matches_hosted >= 5:
                self.badge(user.id, "squad_leader", since + timedelta(days=20))
            if stats.subs_made >= 1:
                self.badge(user.id, "hero_sub", since + timedelta(days=12))
            if stats.subs_made >= 5:
                self.badge(user.id, "super_sub", since + timedelta(days=30))
            if stats.is_verified_playmaker:
                self.badge(user.id, "verified_playmaker", stats.verified_at)  # type: ignore[arg-type]
            if (stats.ratings_received or 0) >= 10 and (stats.avg_fair_play or 0) >= 4.7:
                self.badge(user.id, "fair_play_ace", self.now - timedelta(days=3))
            if (stats.ratings_given or 0) >= 20:
                self.badge(user.id, "critic", self.now - timedelta(days=2))
            if stats.streak_weeks >= 4:
                self.badge(user.id, "on_fire", self.now - timedelta(days=6))
            for kickoff in matches:
                hour = to_ist(kickoff).hour
                if hour >= 21:
                    self.badge(user.id, "night_owl", kickoff + timedelta(hours=1))
                if hour < 7:
                    self.badge(user.id, "early_bird", kickoff + timedelta(hours=1))

        for user_id, codes in self.badges.items():
            for code, at in codes.items():
                self.db.add(UserBadge(user_id=user_id, badge_code=code, awarded_at=at))

        # wallet ledgers (reimbursements etc.), chronological, with running balances
        for user_id, entries in self.ledger.items():
            user = next(x for x in self.users.values() if x.id == user_id)
            balance = user.wallet_balance_paise
            for at, amount, kind, note, ref in sorted(entries, key=lambda e: e[0]):
                balance += amount
                self.db.add(WalletTransaction(
                    id=uuid.uuid4(), user_id=user_id, amount_paise=amount, kind=kind, note=note[:200],
                    balance_after_paise=balance, ref_type="lobby" if ref else None, ref_id=ref, created_at=at,
                ))
            user.wallet_balance_paise = balance
        await self.db.flush()

    # ── 9. notifications for the demo accounts ──
    async def notifications(self) -> None:
        demo = self.demo.id
        pending = next(p for p in self.past if p.pending_for_demo).lobby
        assert pending is not None
        storm = self.storm_lobby
        items = [
            ("rating_request", "Rate your squad ⭐",
             f"How did “{pending.title}” go? Rate your 9 teammates within 48 h (+15 XP each).",
             {"lobby_id": str(pending.id), "url": f"/app/rate/{pending.id}"}, pending.completed_at, None),
            ("lobby_confirmed", "Game on! ✅",
             f"{storm.title} is confirmed — all 10 paid. Kick-off {to_ist(storm.start_at).strftime('%a %-I %p')}.",
             {"lobby_id": str(storm.id), "url": f"/app/lobby/{storm.id}"}, storm.confirmed_at, None),
            ("badge_earned", "📝 Scout unlocked", "Rate 20 teammates",
             {"badge_code": "critic", "url": "/app/profile"}, self.now - timedelta(days=2), True),
            ("level_up", f"Level {level_for_xp(sum(e.amount for e in self.xp if e.user_id == demo))} unlocked!",
             "Keep playing to climb the leaderboard.", {"url": "/app/profile"}, self.now - timedelta(days=2, hours=1),
             True),
        ]
        for type_, title, body, data, at, read in items:
            self.db.add(Notification(
                id=uuid.uuid4(), user_id=demo, type=type_, title=title, body=body, data=data, created_at=at,
                read_at=(at + timedelta(minutes=30)) if read else None,
            ))
        self.db.add(Notification(
            id=uuid.uuid4(), user_id=self.diya.id, type="lobby_confirmed", title="Game on! ✅",
            body="Doubles Night 🏸 is confirmed. Two more players can still join.",
            data={"url": "/app/matches"}, created_at=self.now - timedelta(hours=6),
        ))
        await self.db.flush()

    async def welcome_credits(self) -> None:
        from app.modules.notifications.service import notify
        from app.modules.wallet.service import credit

        await credit(self.db, self.demo.id, 50000, "bonus", "Welcome to Pytch — ₹500 on us")
        await notify(self.db, self.demo.id, "wallet_credit", "₹500 Pytch Credits added 🎁",
                     "Welcome bonus — use it on your next match.", {"url": "/app/wallet"})
        await credit(self.db, self.diya.id, 20000, "bonus", "Welcome to Pytch — ₹200 on us")

    # ── orchestration ──
    async def run(self) -> dict[str, int]:
        await self.venues()
        slots = await self.slots()
        await self.people()
        await self.past_matches()
        await self.highlights()
        await self.upcoming()
        await self.benches()
        await self.finalize()
        await self.notifications()
        await self.welcome_credits()
        await self.db.commit()
        return {
            "venues": len(self.turfs), "pitches": len(self.pitches), "slots": slots, "players": len(self.users),
            "past_matches": len(self.past),
        }
