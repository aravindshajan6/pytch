""""Ready to Sub" live bench + SOS dispatch (FEATURE_ANALYSIS §4).

* Bench: a solo player goes live with a location, radius, sports and a duration (auto-off).
* SOS: created automatically when a paid member drops out of a confirmed match within
  `sos_window_hours` of kickoff (reason `dropout`, merged into an open SOS), or manually by the host.
* Dispatch: active benchers whose radius covers the venue, playing that sport, not in the lobby and
  eligible for its skill gate → `SOSDispatch` row + notification + `sos.new` on their user channel.
* Accept: row-locks the SOS, reserves a discounted `sub` seat (5 min) via the lobbies service.
"""

import hashlib
import math
import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.geo import haversine_km, haversine_sql
from app.core.ratelimit import enforce
from app.core.timeutils import to_ist, utcnow
from app.modules.bench.models import BenchStatus, SOSDispatch, SOSRequest
from app.modules.bench.schemas import BenchNearby, BenchStatusOut, BenchUpdate, Blip, CreateSOSRequest, SOSRequestOut
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.platform import service as platform
from app.modules.users.models import PlayerStats, User
from app.realtime.publisher import lobby_channel, publish_on_commit, user_channel

ACTIVE = ("joined", "paid")
DEFAULT_DURATION_MINUTES = 120
MAX_BLIPS = 30
BLIP_FUZZ_M = 300
CELL_BLIP_FUZZ_M = 450  # radar blips sit anywhere in (roughly) the bencher's grid cell
GRID_DEG = 0.01  # ~1.1 km — /bench/nearby never resolves a bencher more finely than this cell
SNAP_MARGIN_KM = 1.0  # > half the cell diagonal
NEARBY_RADII_KM = (2.0, 5.0, 10.0, 15.0)
NEARBY_EXACT_UPTO = 3
NEARBY_BUCKETS = (4, 10, 20, 50)
NEARBY_RATE = (30, 60)  # per user: requests per seconds (the radar polls every 20 s)
NEARBY_RATE_HOURLY = (400, 3600)
SOS_LOBBY_STATUSES = ("confirmed",)


class SOSClosed(AppError):
    code, status_code, message = "SOS_CLOSED", 409, "This SOS has already been filled or expired"


class NotEligible(AppError):
    code, status_code, message = "NOT_ELIGIBLE", 403, "You're not eligible for this match"


class LobbyClosed(AppError):
    code, status_code, message = "LOBBY_CLOSED", 409, "SOS is only available for confirmed upcoming matches"


class InvalidBench(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid bench settings"


# ───────────────────────────── helpers ─────────────────────────────
def discount_for(share_paise: int, pct: int | None = None) -> int:
    """Sub discount such that the sub pays whole rupees (price rounded up, so the discount never exceeds `pct`)."""
    pct = settings.sub_discount_pct if pct is None else pct
    price = share_paise - share_paise * pct // 100
    whole_rupees = -(-price // 100) * 100
    return max(share_paise - whole_rupees, 0)


def is_bench_live(bench: BenchStatus | None, now: datetime | None = None) -> bool:
    if bench is None or not bench.is_active or bench.lat is None or bench.lng is None:
        return False
    return bench.active_until is None or bench.active_until > (now or utcnow())


def fuzz_point(user_id: uuid.UUID, lat: float, lng: float, *, salt: str = "", radius_m: float = BLIP_FUZZ_M):
    """Deterministic (per user, per salt) offset of up to ±radius_m on each axis — stable between polls,
    never the exact location."""
    digest = hashlib.sha256(f"{user_id}:{salt}".encode()).digest()
    dx = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF * 2 - 1) * radius_m
    dy = (int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF * 2 - 1) * radius_m
    # keep a minimum displacement so a blip is never exactly on the player
    if abs(dx) < 60 and abs(dy) < 60:
        dx = math.copysign(60 + abs(dx), dx or 1)
    d_lat = dy / 111_320.0
    d_lng = dx / (111_320.0 * max(0.2, math.cos(math.radians(lat))))
    return round(lat + d_lat, 5), round(lng + d_lng, 5)


def _members_active(lobby: Lobby) -> list[LobbyMember]:
    return [m for m in lobby.members if m.status in ACTIVE]


def spots_left(lobby: Lobby) -> int:
    return max(0, lobby.total_spots - len(_members_active(lobby)))


def _sub_seats_taken(lobby: Lobby, sos_id: uuid.UUID) -> int:
    return sum(1 for m in lobby.members if m.sos_id == sos_id and m.status in ACTIVE)


def _origin_for(user: User, bench: BenchStatus | None) -> tuple[float, float] | None:
    if is_bench_live(bench):
        return bench.lat, bench.lng  # type: ignore[union-attr,return-value]
    if user.home_lat is not None and user.home_lng is not None:
        return user.home_lat, user.home_lng
    if bench is not None and bench.lat is not None and bench.lng is not None:
        return bench.lat, bench.lng
    return None


async def _bench_row(db: AsyncSession, user_id: uuid.UUID, *, for_update: bool = False) -> BenchStatus | None:
    query = select(BenchStatus).where(BenchStatus.user_id == user_id)
    if for_update:
        query = query.with_for_update(of=BenchStatus)
    return await db.scalar(query)


async def _subs_made(db: AsyncSession, user_id: uuid.UUID) -> int:
    return int(await db.scalar(select(PlayerStats.subs_made).where(PlayerStats.user_id == user_id)) or 0)


def _bench_out(bench: BenchStatus | None, user: User, subs_made: int) -> BenchStatusOut:
    live = is_bench_live(bench)
    if bench is None:
        return BenchStatusOut(
            is_active=False,
            lat=user.home_lat,
            lng=user.home_lng,
            radius_km=settings.bench_default_radius_km,
            sports=list(user.preferred_sports or ["football"]),  # type: ignore[arg-type]
            active_until=None,
            subs_made=subs_made,
        )
    return BenchStatusOut(
        is_active=live,
        lat=bench.lat,
        lng=bench.lng,
        radius_km=bench.radius_km,
        sports=list(bench.sports or []),  # type: ignore[arg-type]
        active_until=bench.active_until if live else None,
        subs_made=subs_made,
    )


# ───────────────────────────── bench ─────────────────────────────
async def get_bench(db: AsyncSession, user: User) -> BenchStatusOut:
    bench = await _bench_row(db, user.id)
    return _bench_out(bench, user, await _subs_made(db, user.id))


async def activate_bench(
    db: AsyncSession,
    user: User,
    *,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    sports: Sequence[str] | None = None,
    duration_minutes: int | None = None,
) -> BenchStatus:
    """Go live (or extend). Caller commits."""
    bench = await _bench_row(db, user.id, for_update=True)
    if bench is None:
        await db.execute(insert(BenchStatus).values(user_id=user.id).on_conflict_do_nothing())
        bench = await _bench_row(db, user.id, for_update=True)
    assert bench is not None
    now = utcnow()
    lat = lat if lat is not None else (bench.lat if bench.lat is not None else user.home_lat)
    lng = lng if lng is not None else (bench.lng if bench.lng is not None else user.home_lng)
    if lat is None or lng is None:
        raise InvalidBench("Share your location (or set a home area) to go live on the bench")
    bench.lat, bench.lng = lat, lng
    bench.radius_km = radius_km or bench.radius_km or settings.bench_default_radius_km
    chosen = list(sports) if sports else list(bench.sports or []) or list(user.preferred_sports or []) or ["football"]
    bench.sports = chosen
    bench.is_active = True
    bench.active_until = now + timedelta(minutes=duration_minutes or DEFAULT_DURATION_MINUTES)
    bench.updated_at = now
    return bench


async def update_bench(db: AsyncSession, user: User, body: BenchUpdate) -> BenchStatusOut:
    if body.is_active:
        bench = await activate_bench(
            db, user, lat=body.lat, lng=body.lng, radius_km=body.radius_km, sports=body.sports,
            duration_minutes=body.duration_minutes,
        )
    else:
        bench = await _bench_row(db, user.id, for_update=True)
        if bench is None:
            await db.execute(insert(BenchStatus).values(user_id=user.id).on_conflict_do_nothing())
            bench = await _bench_row(db, user.id, for_update=True)
        assert bench is not None
        bench.is_active = False
        bench.active_until = None
        if body.lat is not None and body.lng is not None:
            bench.lat, bench.lng = body.lat, body.lng
        if body.radius_km is not None:
            bench.radius_km = body.radius_km
        if body.sports is not None:
            bench.sports = list(body.sports)
        bench.updated_at = utcnow()
    await db.commit()
    return _bench_out(bench, user, await _subs_made(db, user.id))


def snap(lat: float, lng: float, step: float = GRID_DEG) -> tuple[float, float]:
    """Centre of the ~1.1 km grid cell containing the point."""
    return round(math.floor(lat / step) * step + step / 2, 5), round(math.floor(lng / step) * step + step / 2, 5)


def clamp_radius(radius_km: float) -> float:
    """Smallest allowed radius ≥ the requested one (so arbitrary radii can't be bisected)."""
    return next((r for r in NEARBY_RADII_KM if r >= radius_km - 1e-9), NEARBY_RADII_KM[-1])


def bucket_count(n: int) -> int:
    """Exact up to NEARBY_EXACT_UPTO, then the floor of a bucket (4, 10, 20, 50 → "4+", "10+", …)."""
    if n <= NEARBY_EXACT_UPTO:
        return n
    return max(b for b in NEARBY_BUCKETS if b <= n)


async def nearby(
    db: AsyncSession,
    user: User,
    *,
    lat: float | None,
    lng: float | None,
    sport: str | None,
    radius_km: float,
) -> BenchNearby:
    """"N players on the bench near here" + radar blips, without leaking anyone's location (SEC2-03).

    * The query centre is snapped to the ~1.1 km grid and the radius to NEARBY_RADII_KM.
    * Benchers are counted by the centre of their grid cell, never their exact position, so repeated
      queries (moving centres / radii) can at best recover the cell (~1 km), not the player.
    * `count` is exact up to 3, then a bucket floor (4 = "4–9", 10 = "10–19", 20 = "20–49", 50 = "50+");
      `blips` has at most `count` entries, each placed at a per-bencher, per-IST-day stable point in that
      cell (stable so it can't be averaged out by polling).
    * Rate-limited per user.
    """
    await enforce(f"bench-nearby:{user.id}", *NEARBY_RATE, "Too many radar refreshes — try again in a minute")
    await enforce(f"bench-nearby-h:{user.id}", *NEARBY_RATE_HOURLY, "Too many radar refreshes — try again later")
    if lat is None or lng is None:
        origin = _origin_for(user, await _bench_row(db, user.id))
        lat, lng = origin if origin else (settings.city_center_lat, settings.city_center_lng)
    lat, lng = snap(lat, lng)
    radius_km = clamp_radius(radius_km)
    now = utcnow()
    distance = haversine_sql(BenchStatus.lat, BenchStatus.lng, lat, lng)
    query = select(BenchStatus.user_id, BenchStatus.lat, BenchStatus.lng).where(
        BenchStatus.is_active.is_(True),
        BenchStatus.lat.is_not(None),
        BenchStatus.lng.is_not(None),
        (BenchStatus.active_until.is_(None)) | (BenchStatus.active_until > now),
        BenchStatus.user_id != user.id,
        distance <= radius_km + SNAP_MARGIN_KM,  # coarse prefilter; the decision uses the snapped cell below
    )
    if sport:
        query = query.where(BenchStatus.sports.any(sport))
    cells = []
    for uid, blat, blng in (await db.execute(query)).all():
        clat, clng = snap(blat, blng)
        d = haversine_km(lat, lng, clat, clng)
        if d <= radius_km:
            cells.append((d, str(uid), uid, clat, clng))
    cells.sort()
    count = bucket_count(len(cells))
    salt = f"bench:{to_ist(now).date().isoformat()}"
    blips = [Blip(lat=p[0], lng=p[1]) for p in (fuzz_point(uid, clat, clng, salt=salt, radius_m=CELL_BLIP_FUZZ_M)
                                                for _, _, uid, clat, clng in cells[:min(count, MAX_BLIPS)])]
    return BenchNearby(count=count, blips=blips)


# ───────────────────────────── SOS read models ─────────────────────────────
async def sos_outs(
    db: AsyncSession, sos_list: Sequence[SOSRequest], *, origin: tuple[float, float] | None = None,
    distances: dict[uuid.UUID, float] | None = None,
) -> list[SOSRequestOut]:
    """Batch-build `SOSRequest` payloads. Distance = from `origin` (or per-SOS override)."""
    if not sos_list:
        return []
    from app.modules.lobbies.service import lobby_summaries

    lat, lng = origin if origin else (None, None)
    lobbies = [s.lobby for s in sos_list]
    summaries = await lobby_summaries(db, lobbies, lat=lat, lng=lng)
    by_lobby = {s.id: s for s in summaries}
    out = []
    for sos in sos_list:
        turf = sos.lobby.turf
        if distances and sos.id in distances:
            dist: float | None = distances[sos.id]
        elif origin:
            dist = haversine_km(origin[0], origin[1], turf.lat, turf.lng)
        else:
            dist = None
        out.append(
            SOSRequestOut(
                id=sos.id,
                lobby=by_lobby[sos.lobby_id],
                reason=sos.reason,  # type: ignore[arg-type]
                spots_needed=sos.spots_needed,
                spots_filled=sos.spots_filled,
                discount_pct=sos.discount_pct,
                original_share_paise=sos.original_share_paise,
                discounted_share_paise=sos.discounted_share_paise,
                status=sos.status,  # type: ignore[arg-type]
                expires_at=sos.expires_at,
                distance_km=round(dist, 2) if dist is not None else None,
                created_at=sos.created_at,
            )
        )
    return out


async def sos_out(
    db: AsyncSession, sos: SOSRequest, *, origin: tuple[float, float] | None = None, distance_km: float | None = None
) -> SOSRequestOut:
    distances = {sos.id: distance_km} if distance_km is not None else None
    return (await sos_outs(db, [sos], origin=origin, distances=distances))[0]


async def open_sos_for_lobby(db: AsyncSession, lobby_id: uuid.UUID, viewer: User | None) -> SOSRequestOut | None:
    sos = await db.scalar(
        select(SOSRequest)
        .where(SOSRequest.lobby_id == lobby_id, SOSRequest.status == "open", SOSRequest.expires_at > utcnow())
        .order_by(SOSRequest.created_at.desc())
        .limit(1)
    )
    if sos is None:
        return None
    origin = _origin_for(viewer, await _bench_row(db, viewer.id)) if viewer else None
    return await sos_out(db, sos, origin=origin)


def _is_joinable(sos: SOSRequest, now: datetime) -> bool:
    lobby = sos.lobby
    return (
        sos.status == "open"
        and sos.expires_at > now
        and lobby.status in SOS_LOBBY_STATUSES
        and lobby.start_at > now
        and _sub_seats_taken(lobby, sos.id) < sos.spots_needed
        and sos.spots_filled < sos.spots_needed
    )


async def sos_feed(db: AsyncSession, user: User) -> list[SOSRequestOut]:
    """Open SOS near my bench (or home) for my sports + any SOS I was dispatched to; minus declined."""
    now = utcnow()
    bench = await _bench_row(db, user.id)
    origin = _origin_for(user, bench)
    radius = (bench.radius_km if bench else None) or settings.bench_default_radius_km
    sports = list((bench.sports if bench and bench.sports else None) or user.preferred_sports or ["football"])

    dispatch_rows = (
        await db.execute(select(SOSDispatch.sos_id, SOSDispatch.response).where(SOSDispatch.user_id == user.id))
    ).all()
    declined = {sid for sid, resp in dispatch_rows if resp == "declined"}
    dispatched = {sid for sid, resp in dispatch_rows if resp != "declined"}

    candidates = (
        await db.scalars(
            select(SOSRequest)
            .join(Lobby, Lobby.id == SOSRequest.lobby_id)
            .where(
                SOSRequest.status == "open",
                SOSRequest.expires_at > now,
                Lobby.start_at > now,
                Lobby.status.in_(SOS_LOBBY_STATUSES),
            )
            .order_by(Lobby.start_at)
        )
    ).unique().all()

    picked: list[SOSRequest] = []
    for sos in candidates:
        if sos.id in declined or not _is_joinable(sos, now):
            continue
        lobby = sos.lobby
        if lobby.host_id == user.id or any(m.user_id == user.id for m in _members_active(lobby)):
            continue
        if sos.id not in dispatched:
            if origin is None or lobby.sport not in sports:
                continue
            if haversine_km(origin[0], origin[1], lobby.turf.lat, lobby.turf.lng) > radius:
                continue
        picked.append(sos)
    outs = await sos_outs(db, picked, origin=origin)
    outs.sort(key=lambda s: (s.lobby.start_at, s.distance_km if s.distance_km is not None else 1e9))
    return outs


# ───────────────────────────── SOS creation + dispatch ─────────────────────────────
async def _dispatch(
    db: AsyncSession, sos: SOSRequest, *, force_user_ids: Iterable[uuid.UUID] = ()
) -> list[uuid.UUID]:
    """Notify active benchers in range (plus `force_user_ids`). Skips already-dispatched users. Caller commits."""
    from app.modules.lobbies.service import eligibility

    lobby = sos.lobby
    now = utcnow()
    turf = lobby.turf
    distance = haversine_sql(BenchStatus.lat, BenchStatus.lng, turf.lat, turf.lng)
    rows = (
        await db.execute(
            select(BenchStatus.user_id, distance.label("d")).where(
                BenchStatus.is_active.is_(True),
                BenchStatus.lat.is_not(None),
                BenchStatus.lng.is_not(None),
                (BenchStatus.active_until.is_(None)) | (BenchStatus.active_until > now),
                BenchStatus.sports.any(lobby.sport),
                distance <= BenchStatus.radius_km,
            )
        )
    ).all()
    candidates: dict[uuid.UUID, float | None] = {uid: float(d) for uid, d in rows}
    for uid in force_user_ids:
        candidates.setdefault(uid, None)
    taken = {m.user_id for m in _members_active(lobby)} | {lobby.host_id}
    already = set(
        (await db.scalars(select(SOSDispatch.user_id).where(SOSDispatch.sos_id == sos.id))).all()
    )
    forced = set(force_user_ids)
    ids = [uid for uid in candidates if uid not in taken and uid not in already]
    if not ids:
        return []
    users = (await db.scalars(select(User).where(User.id.in_(ids)))).unique().all()
    benches = {
        b.user_id: b for b in (await db.scalars(select(BenchStatus).where(BenchStatus.user_id.in_(ids)))).unique().all()
    }

    targets: list[tuple[User, float | None]] = []
    for user in users:
        if user.is_bot and user.id not in forced:
            continue
        if not eligibility(user, lobby).can_join:
            continue
        dist = candidates[user.id]
        if dist is None:
            origin = _origin_for(user, benches.get(user.id))
            dist = haversine_km(origin[0], origin[1], turf.lat, turf.lng) if origin else None
        targets.append((user, dist))
    if not targets:
        return []

    kickoff = to_ist(lobby.start_at).strftime("%-I:%M %p").replace(":00 ", " ")
    price = sos.discounted_share_paise // 100
    remaining = max(1, sos.spots_needed - sos.spots_filled)
    spot_word = "spot" if remaining == 1 else "spots"
    base = await sos_out(db, sos)
    for user, dist in targets:
        db.add(SOSDispatch(id=uuid.uuid4(), sos_id=sos.id, user_id=user.id, distance_km=dist, notified_at=now))
        away = f" · {dist:.1f} km away" if dist is not None else ""
        await notify(
            db, user.id, "sos",
            f"🚨 SOS · {remaining} {spot_word} at {turf.name}",
            f"{lobby.title} kicks off at {kickoff}{away}. Jump in for ₹{price} ({sos.discount_pct}% off).",
            {"sos_id": sos.id, "lobby_id": lobby.id, "url": "/app/bench"},
        )
        rounded = round(dist, 2) if dist is not None else None
        payload = base.model_copy(
            update={"distance_km": rounded, "lobby": base.lobby.model_copy(update={"distance_km": rounded})}
        )
        publish_on_commit(db, user_channel(user.id), "sos.new", payload)
    return [u.id for u, _ in targets]


async def create_or_merge_sos(
    db: AsyncSession,
    lobby: Lobby,
    *,
    reason: str,
    spots: int,
    created_by_id: uuid.UUID | None,
    merge: str = "add",
    force_user_ids: Iterable[uuid.UUID] = (),
) -> tuple[SOSRequest, list[uuid.UUID]]:
    """Open an SOS for `lobby` (or grow the open one) and dispatch it. Caller commits.

    merge="add": spots_needed += spots (dropouts); merge="set": open spots become `spots` (manual).
    """
    now = utcnow()
    existing = await db.scalar(
        select(SOSRequest)
        .where(SOSRequest.lobby_id == lobby.id, SOSRequest.status == "open")
        .order_by(SOSRequest.created_at.desc())
        .limit(1)
        .with_for_update(of=SOSRequest)
    )
    if existing is not None and existing.expires_at > now:
        sos = existing
        if merge == "add":
            sos.spots_needed += spots
        else:
            sos.spots_needed = max(sos.spots_needed, sos.spots_filled + spots)
        sos.original_share_paise = lobby.share_paise
        sos.discounted_share_paise = lobby.share_paise - discount_for(lobby.share_paise, sos.discount_pct)
    else:
        if existing is not None:
            existing.status = "expired"
        pct = await platform.get_setting("sub_discount_pct", db)
        sos = SOSRequest(
            id=uuid.uuid4(),
            lobby_id=lobby.id,
            created_by_id=created_by_id,
            reason=reason,
            spots_needed=spots,
            spots_filled=0,
            discount_pct=pct,
            original_share_paise=lobby.share_paise,
            discounted_share_paise=lobby.share_paise - discount_for(lobby.share_paise, pct),
            status="open",
            expires_at=lobby.start_at,
            created_at=now,
        )
        sos.lobby = lobby
        db.add(sos)
        await db.flush([sos])
    notified = await _dispatch(db, sos, force_user_ids=force_user_ids)
    _publish_sos_update(db, lobby.id)
    return sos, notified


def _publish_sos_update(db: AsyncSession, lobby_id: uuid.UUID) -> None:
    payload = {"lobby_id": str(lobby_id), "reason": "sos", "actor": None}
    publish_on_commit(db, lobby_channel(lobby_id), "lobby.updated", payload)


async def _post(db: AsyncSession, lobby_id: uuid.UUID, body: str) -> None:
    from app.modules.lobbies.service import post_system_message

    await post_system_message(db, lobby_id, body)


def _bench_phrase(n: int) -> str:
    if n == 0:
        return "SOS is live — no one on the bench nearby yet, share the invite link too"
    # same buckets as the radar (exact up to NEARBY_EXACT_UPTO): exact counts would reveal who's benched nearby
    label = f"{bucket_count(n)}+ players" if n > NEARBY_EXACT_UPTO else f"{n} player{'s' if n != 1 else ''}"
    return f"SOS sent to {label} on the bench"


async def create_manual_sos(db: AsyncSession, user: User, body: CreateSOSRequest) -> SOSRequestOut:
    from app.modules.lobbies.service import get_lobby

    lobby = await get_lobby(db, body.lobby_id, for_update=True)  # lock order: lobby → SOS (as in capture)
    if lobby.host_id != user.id:
        raise Forbidden("Only the host can send an SOS")
    if lobby.status not in SOS_LOBBY_STATUSES or lobby.start_at <= utcnow():
        raise LobbyClosed()
    left = spots_left(lobby)
    if body.spots > left:
        raise InvalidBench(
            f"Only {left} spot{'s' if left != 1 else ''} open in this match", details={"spots_left": left}
        )
    sos, notified = await create_or_merge_sos(
        db, lobby, reason="manual", spots=body.spots, created_by_id=user.id, merge="set"
    )
    await _post(db, lobby.id, f"🚨 Host called for {body.spots} sub{'s' if body.spots != 1 else ''}. "
                              f"{_bench_phrase(len(notified))}.")
    await db.commit()
    origin = _origin_for(user, await _bench_row(db, user.id))
    return await sos_out(db, sos, origin=origin)


async def _lock_sos(db: AsyncSession, sos_id: uuid.UUID) -> SOSRequest:
    await db.flush()  # populate_existing below must never discard the caller's pending changes
    sos = await db.scalar(
        select(SOSRequest)
        .where(SOSRequest.id == sos_id)
        .with_for_update(of=SOSRequest)
        .execution_options(populate_existing=True)
    )
    if sos is None:
        raise NotFound("SOS not found")
    return sos


async def _record_response(db: AsyncSession, sos_id: uuid.UUID, user_id: uuid.UUID, response: str) -> None:
    now = utcnow()
    stmt = insert(SOSDispatch).values(
        id=uuid.uuid4(), sos_id=sos_id, user_id=user_id, notified_at=now, response=response, responded_at=now
    )
    await db.execute(
        stmt.on_conflict_do_update(
            constraint="uq_sos_dispatches_sos_user", set_={"response": response, "responded_at": now}
        )
    )


async def accept_sos(db: AsyncSession, sos_id: uuid.UUID, user: User):
    from app.modules.lobbies import service as lobbies
    from app.modules.lobbies.detail_schemas import AcceptSOSResponse

    sos_row = await db.get(SOSRequest, sos_id)
    if sos_row is None:
        raise NotFound("SOS not found")
    lobby = await lobbies.get_lobby(db, sos_row.lobby_id, for_update=True)  # lock order: lobby → SOS
    sos = await _lock_sos(db, sos_id)
    now = utcnow()
    if (
        sos.status != "open"
        or sos.expires_at <= now
        or lobby.status not in SOS_LOBBY_STATUSES
        or lobby.start_at <= now
        or _sub_seats_taken(lobby, sos.id) >= sos.spots_needed
        or sos.spots_filled >= sos.spots_needed
    ):
        raise SOSClosed()
    elig = lobbies.eligibility(user, lobby)
    if not elig.can_join:
        raise NotEligible(details={"reasons": elig.reasons})
    discount = discount_for(lobby.share_paise, sos.discount_pct)
    await lobbies.add_sub_member(db, lobby, user, sos_id=sos.id, discount_paise=discount)
    await _record_response(db, sos.id, user.id, "accepted")
    await db.commit()
    await db.refresh(lobby, attribute_names=["members"])
    return AcceptSOSResponse(lobby=await lobbies.lobby_detail(db, lobby, user))


async def decline_sos(db: AsyncSession, sos_id: uuid.UUID, user: User) -> None:
    sos = await db.get(SOSRequest, sos_id)
    if sos is None:
        raise NotFound("SOS not found")
    await _record_response(db, sos.id, user.id, "declined")
    await db.commit()


# ───────────────────────────── lifecycle (handlers / jobs) ─────────────────────────────
async def _publish_closed(db: AsyncSession, sos: SOSRequest) -> None:
    user_ids = (await db.scalars(select(SOSDispatch.user_id).where(SOSDispatch.sos_id == sos.id))).all()
    for uid in set(user_ids):
        publish_on_commit(db, user_channel(uid), "sos.closed", {"sos_id": str(sos.id)})


async def on_member_dropped(
    db: AsyncSession, lobby_id: uuid.UUID, user_id: uuid.UUID, hours_to_kickoff: float, was_paid: bool
) -> SOSRequest | None:
    if not was_paid or hours_to_kickoff is None or hours_to_kickoff <= 0:
        return None
    if hours_to_kickoff > await platform.get_setting("sos_window_hours", db):
        return None
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None or lobby.status != "confirmed" or lobby.start_at <= utcnow():
        return None
    sos, notified = await create_or_merge_sos(db, lobby, reason="dropout", spots=1, created_by_id=None)
    dropout = await db.get(User, user_id)
    who = dropout.name.split()[0] if dropout else "A player"
    await _post(db, lobby.id, f"🚨 {who} dropped out. {_bench_phrase(len(notified))} "
                              f"({sos.discount_pct}% off the share).")
    return sos


async def on_sub_paid(db: AsyncSession, lobby_id: uuid.UUID, user_id: uuid.UUID, sos_id: uuid.UUID | None) -> None:
    if sos_id is None:
        return
    sos = await _lock_sos(db, sos_id)
    sos.spots_filled = min(sos.spots_needed, sos.spots_filled + 1)
    if sos.status == "open" and sos.spots_filled >= sos.spots_needed:
        sos.status = "filled"
        await _publish_closed(db, sos)
    lobby = sos.lobby
    sub = await db.get(User, user_id)
    name = sub.name if sub else "A bench player"
    await notify(
        db, lobby.host_id, "sub_found", f"🦸 Sub found for {lobby.title}",
        f"{name} answered the SOS and paid. You're back to full strength.",
        {"lobby_id": lobby.id, "sos_id": sos.id, "url": f"/app/lobby/{lobby.id}"},
    )
    _publish_sos_update(db, lobby.id)


async def cancel_open_sos(db: AsyncSession, lobby_id: uuid.UUID) -> int:
    items = (
        await db.scalars(
            select(SOSRequest)
            .where(SOSRequest.lobby_id == lobby_id, SOSRequest.status == "open")
            .with_for_update(of=SOSRequest)
        )
    ).unique().all()
    for sos in items:
        sos.status = "cancelled"
        await _publish_closed(db, sos)
    return len(items)


async def expire_stale(db: AsyncSession) -> int:
    now = utcnow()
    benches = (
        await db.scalars(
            select(BenchStatus)
            .where(
                BenchStatus.is_active.is_(True),
                BenchStatus.active_until.is_not(None),
                BenchStatus.active_until <= now,
            )
            .with_for_update(of=BenchStatus, skip_locked=True)
        )
    ).unique().all()
    for bench in benches:
        bench.is_active = False
        bench.updated_at = now
    stale = (
        await db.scalars(
            select(SOSRequest)
            .where(SOSRequest.status == "open", SOSRequest.expires_at <= now)
            .with_for_update(of=SOSRequest, skip_locked=True)
        )
    ).unique().all()
    for sos in stale:
        sos.status = "expired"
        await _publish_closed(db, sos)
    return len(benches) + len(stale)
