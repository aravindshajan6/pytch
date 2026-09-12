"""Venue discovery: search/list with distance, aggregated pitch facts and live "games forming" counts."""

import uuid
from collections.abc import Sequence
from typing import Literal

from sqlalchemy import exists, func, or_, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.constants import SPORTS
from app.core.errors import NotFound
from app.core.geo import haversine_km, haversine_sql
from app.core.pagination import Page
from app.core.timeutils import utcnow
from app.modules.lobbies.models import Lobby
from app.modules.lobbies.queries import joinable_filters
from app.modules.turfs.models import Pitch, Turf
from app.modules.turfs.schemas import PitchOut, TurfDetail, TurfSummary

TurfSort = Literal["distance", "price", "rating"]
_SPORT_ORDER = {s["key"]: i for i, s in enumerate(SPORTS)}


def pitch_out(pitch: Pitch) -> PitchOut:
    return PitchOut.model_validate(pitch)


def _active_pitches(turf: Turf) -> list[Pitch]:
    return [p for p in turf.pitches if p.is_active]


def _distance(turf: Turf, lat: float | None, lng: float | None) -> float | None:
    if lat is None or lng is None:
        return None
    return round(haversine_km(lat, lng, turf.lat, turf.lng), 2)


async def open_lobby_counts(db: AsyncSession, turf_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Joinable public lobbies per turf — one grouped query for a whole page."""
    if not turf_ids:
        return {}
    rows = await db.execute(
        select(Lobby.turf_id, func.count(Lobby.id))
        .where(Lobby.turf_id.in_(turf_ids), *joinable_filters(utcnow()))
        .group_by(Lobby.turf_id)
    )
    return {turf_id: count for turf_id, count in rows.all()}


def _summary(turf: Turf, *, open_count: int, lat: float | None, lng: float | None) -> TurfSummary:
    pitches = _active_pitches(turf)
    sports = sorted({p.sport for p in pitches}, key=lambda s: _SPORT_ORDER.get(s, 99))
    return TurfSummary(
        id=turf.id,
        slug=turf.slug,
        name=turf.name,
        area=turf.area,
        address=turf.address,
        lat=turf.lat,
        lng=turf.lng,
        cover_url=turf.cover_url,
        sports=sports,  # type: ignore[arg-type]
        has_indoor=any(p.is_indoor for p in pitches),
        has_outdoor=any(not p.is_indoor for p in pitches),
        has_camera=any(p.has_camera for p in pitches),
        amenities=list(turf.amenities or []),
        min_price_per_hour_paise=min((p.price_per_hour_paise for p in pitches), default=0),
        rating_avg=round(turf.rating_avg or 0.0, 1),
        rating_count=turf.rating_count or 0,
        distance_km=_distance(turf, lat, lng),
        open_lobbies_count=open_count,
    )


async def _ensure_pitches(db: AsyncSession, turfs: Sequence[Turf]) -> None:
    """`Turf.pitches` isn't eager-loaded when the turf arrives through `Slot.pitch.turf` (loader
    cycles stop there) — batch-load it in one query instead of lazy-loading per turf."""
    missing = [t for t in turfs if "pitches" in sa_inspect(t).unloaded]
    if not missing:
        return
    rows = (
        (await db.execute(select(Pitch).where(Pitch.turf_id.in_([t.id for t in missing])).order_by(Pitch.name)))
        .unique()
        .scalars()
        .all()
    )
    by_turf: dict[uuid.UUID, list[Pitch]] = {}
    for p in rows:
        by_turf.setdefault(p.turf_id, []).append(p)
    for t in missing:
        set_committed_value(t, "pitches", by_turf.get(t.id, []))


async def turf_summaries(
    db: AsyncSession, turfs: Sequence[Turf], *, lat: float | None = None, lng: float | None = None
) -> list[TurfSummary]:
    await _ensure_pitches(db, turfs)
    counts = await open_lobby_counts(db, [t.id for t in turfs])
    return [_summary(t, open_count=counts.get(t.id, 0), lat=lat, lng=lng) for t in turfs]


async def turf_summary(
    db: AsyncSession, turf: Turf, *, lat: float | None = None, lng: float | None = None
) -> TurfSummary:
    return (await turf_summaries(db, [turf], lat=lat, lng=lng))[0]


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_turfs(
    db: AsyncSession,
    *,
    lat: float | None,
    lng: float | None,
    radius_km: float,
    sport: str | None,
    indoor: bool | None,
    has_camera: bool | None,
    q: str | None,
    sort: TurfSort,
    limit: int,
    offset: int,
) -> Page[TurfSummary]:
    # A venue matches when at least one active pitch satisfies every pitch-level filter.
    pitch_conditions = [Pitch.turf_id == Turf.id, Pitch.is_active.is_(True)]
    if sport:
        pitch_conditions.append(Pitch.sport == sport)
    if indoor is not None:
        pitch_conditions.append(Pitch.is_indoor.is_(indoor))
    if has_camera:
        pitch_conditions.append(Pitch.has_camera.is_(True))

    stmt = select(Turf).where(Turf.is_active.is_(True), exists(select(Pitch.id).where(*pitch_conditions)))
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(Turf.name.ilike(like, escape="\\"), Turf.area.ilike(like, escape="\\"),
                Turf.address.ilike(like, escape="\\"))
        )

    located = lat is not None and lng is not None
    distance = haversine_sql(Turf.lat, Turf.lng, lat, lng) if located else None  # type: ignore[arg-type]
    if distance is not None and radius_km:
        stmt = stmt.where(distance <= radius_km)

    total = int(await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)

    min_price = (
        select(func.min(Pitch.price_per_hour_paise))
        .where(Pitch.turf_id == Turf.id, Pitch.is_active.is_(True))
        .correlate(Turf)
        .scalar_subquery()
    )
    if sort == "price":
        order = [min_price.asc(), Turf.rating_avg.desc()]
    elif sort == "distance" and distance is not None:
        order = [distance.asc()]
    else:  # rating, or distance requested without a location
        order = [Turf.rating_avg.desc(), Turf.rating_count.desc()]
    stmt = stmt.order_by(*order, Turf.name, Turf.id).limit(limit).offset(offset)

    turfs = (await db.execute(stmt)).unique().scalars().all()
    items = await turf_summaries(db, turfs, lat=lat, lng=lng)
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_turf_by_slug(db: AsyncSession, slug: str) -> Turf:
    turf = (await db.execute(select(Turf).where(Turf.slug == slug, Turf.is_active.is_(True)))).unique().scalar()
    if turf is None:
        raise NotFound("Turf not found")
    return turf


async def turf_detail(
    db: AsyncSession, slug: str, *, lat: float | None = None, lng: float | None = None
) -> TurfDetail:
    turf = await get_turf_by_slug(db, slug)
    summary = await turf_summary(db, turf, lat=lat, lng=lng)  # also guarantees turf.pitches is loaded
    return TurfDetail(
        **summary.model_dump(),
        description=turf.description or "",
        photos=list(turf.photos or []),
        phone=turf.phone,
        open_time=turf.open_time.strftime("%H:%M"),
        close_time=turf.close_time.strftime("%H:%M"),
        pitches=[pitch_out(p) for p in _active_pitches(turf)],
    )
