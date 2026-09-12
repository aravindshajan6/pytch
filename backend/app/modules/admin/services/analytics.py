"""Marketplace analytics (research §6). Everything aggregates in Postgres — one query per metric
family using `FILTER` to split the current window [now−N, now) from the previous one [now−2N, now−N).

Definitions (also returned as `Kpi.hint`)
    gmv                  Σ booking total of confirmed + completed bookings, by kickoff in the window
    net_revenue          commission on those − platform-funded coupon discounts − rain-check bonuses
    take_rate            net_revenue ÷ gmv
    avg_fill_rate        avg paid seats ÷ spots of public lobbies (not cancelled)
    split_completion     split lobbies that confirmed ÷ split lobbies created (excl. cancelled while forming)
    cancellation_rate    confirmed matches later cancelled ÷ confirmed matches
    refunds              credits refunded (lobby refunds, rain-checks, admin) + admin refunds to source
    active_players       distinct players with a paid seat in a completed match
    sos_fill_rate        SOS requests filled ÷ raised
    weather_saves        weather alerts resolved by transfer or rain-check
    coupon_spend         Σ applied coupon discounts (all funders)
    credits_outstanding  Σ wallet balances of real players (liability, bots excluded); previous = balance at the
                         window start
    overbooking_rate     channel sync conflicts ÷ bookings
"""

from datetime import date, timedelta
from typing import Any

from sqlalchemy import BigInteger, Date, Float, and_, case, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import BadRequest
from app.core.timeutils import ist_day_bounds, ist_today, utcnow
from app.modules.admin.schemas import (
    AnalyticsOverview,
    Cohort,
    CohortTable,
    Heatmap,
    HeatmapCell,
    Kpi,
    SeriesPoint,
    SportMix,
    SportMixRow,
    TimeSeries,
    VenueAnalyticsRow,
)
from app.modules.bench.models import SOSRequest
from app.modules.bookings.models import Booking
from app.modules.channels.models import SyncConflict
from app.modules.coupons.models import Coupon, CouponRedemption
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.payments.models import Payment
from app.modules.platform import service as platform
from app.modules.providers.models import Provider
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User
from app.modules.wallet.models import WalletTransaction
from app.modules.weather.models import WeatherAlert

RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90}
CONFIRMED = ("confirmed", "completed")


def _windows(range_: str):
    n = RANGE_DAYS.get(range_)
    if n is None:
        raise BadRequest("range must be 7d, 30d or 90d")
    now = utcnow()
    return n, now, now - timedelta(days=n), now - timedelta(days=2 * n)


def _num(v: Any) -> float:
    return float(v or 0)


def _pct(num: float, den: float) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


def _local(col):
    return func.timezone(settings.timezone, col)


async def _commission_bps_default(db: AsyncSession) -> int:
    return int(await platform.get_setting("default_commission_bps", db))


def _commission_expr(default_bps: int):
    bps = func.coalesce(Provider.commission_bps, default_bps)
    return (cast(Booking.pitch_fee_paise, BigInteger) * bps + 5000) // 10000


def _platform_share_expr():
    """Platform-funded part of a redemption's discount."""
    pct = case((Coupon.funded_by == "platform", 100), (Coupon.funded_by == "shared", 100 - Coupon.provider_share_pct),
               else_=0)
    return cast(CouponRedemption.discount_paise, BigInteger) * pct // 100


# ═══════════════════════════ overview ═══════════════════════════


async def overview(db: AsyncSession, range_: str) -> AnalyticsOverview:
    n, now, c0, p0 = _windows(range_)
    default_bps = await _commission_bps_default(db)

    # bookings: GMV, count, commission (by kickoff)
    cur = Lobby.start_at >= c0
    b = (await db.execute(
        select(
            func.sum(Booking.total_paise).filter(cur), func.sum(Booking.total_paise).filter(~cur),
            func.count().filter(cur), func.count().filter(~cur),
            func.sum(_commission_expr(default_bps)).filter(cur), func.sum(_commission_expr(default_bps)).filter(~cur),
        )
        .select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id).join(Turf, Turf.id == Lobby.turf_id)
        .outerjoin(Provider, Provider.id == Turf.provider_id)
        .where(Booking.status.in_(CONFIRMED), Lobby.start_at >= p0, Lobby.start_at < now)
    )).one()
    gmv, gmv_p, bookings, bookings_p, comm, comm_p = (_num(x) for x in b)

    # lobbies: completed, fill rate (public), cancellation after confirmation
    paid_sq = (select(LobbyMember.lobby_id, func.count().label("paid")).where(LobbyMember.status == "paid")
               .group_by(LobbyMember.lobby_id).subquery())
    fill = func.least(cast(func.coalesce(paid_sq.c.paid, 0), Float) / func.nullif(Lobby.total_spots, 0), 1.0)
    public_ok = and_(Lobby.visibility == "public", Lobby.status != "cancelled")
    confirmed_ever = Lobby.confirmed_at.is_not(None)
    lo = (await db.execute(
        select(
            func.count().filter(and_(cur, Lobby.status == "completed")),
            func.count().filter(and_(~cur, Lobby.status == "completed")),
            func.avg(fill).filter(and_(cur, public_ok)), func.avg(fill).filter(and_(~cur, public_ok)),
            func.count().filter(and_(cur, confirmed_ever)), func.count().filter(and_(~cur, confirmed_ever)),
            func.count().filter(and_(cur, confirmed_ever, Lobby.status == "cancelled")),
            func.count().filter(and_(~cur, confirmed_ever, Lobby.status == "cancelled")),
        )
        .select_from(Lobby).outerjoin(paid_sq, paid_sq.c.lobby_id == Lobby.id)
        .where(Lobby.start_at >= p0, Lobby.start_at < now)
    )).one()
    completed, completed_p, fill_c, fill_p, conf, conf_p, canc, canc_p = (_num(x) for x in lo)

    # split completion (by creation)
    cur_created = Lobby.created_at >= c0
    counted = and_(Lobby.mode == "split", ~and_(Lobby.status == "cancelled", Lobby.confirmed_at.is_(None)))
    sp = (await db.execute(
        select(
            func.count().filter(and_(cur_created, counted)), func.count().filter(and_(~cur_created, counted)),
            func.count().filter(and_(cur_created, counted, confirmed_ever)),
            func.count().filter(and_(~cur_created, counted, confirmed_ever)),
        ).select_from(Lobby).where(Lobby.created_at >= p0, Lobby.created_at < now)
    )).one()
    split_all, split_all_p, split_ok, split_ok_p = (_num(x) for x in sp)

    # wallet: refunds to credits, rain bonuses, net movement since c0 (for credits outstanding)
    wcur = WalletTransaction.created_at >= c0
    is_refund = and_(WalletTransaction.kind.in_(("refund", "rain_check")),
                     ~WalletTransaction.note.like("Credits returned%"))
    is_rain_bonus = and_(WalletTransaction.kind == "bonus", WalletTransaction.ref_type == "lobby")
    w = (await db.execute(
        select(
            func.sum(WalletTransaction.amount_paise).filter(and_(wcur, is_refund)),
            func.sum(WalletTransaction.amount_paise).filter(and_(~wcur, is_refund)),
            func.sum(WalletTransaction.amount_paise).filter(and_(wcur, is_rain_bonus)),
            func.sum(WalletTransaction.amount_paise).filter(and_(~wcur, is_rain_bonus)),
            func.sum(WalletTransaction.amount_paise).filter(wcur),
        ).where(WalletTransaction.created_at >= p0, WalletTransaction.created_at < now)
    )).one()
    ref_credits, ref_credits_p, rain, rain_p, wallet_delta = (_num(x) for x in w)
    src = func.coalesce(Payment.meta["refunded_source_paise"].as_integer(), 0)
    ps = (await db.execute(
        select(func.sum(src).filter(Payment.refunded_at >= c0), func.sum(src).filter(Payment.refunded_at < c0))
        .where(Payment.refunded_at >= p0, Payment.refunded_at < now)
    )).one()
    ref_src, ref_src_p = (_num(x) for x in ps)

    # coupons
    rcur = CouponRedemption.created_at >= c0
    applied = CouponRedemption.status == "applied"
    cp = (await db.execute(
        select(
            func.sum(CouponRedemption.discount_paise).filter(and_(rcur, applied)),
            func.sum(CouponRedemption.discount_paise).filter(and_(~rcur, applied)),
            func.sum(_platform_share_expr()).filter(and_(rcur, applied)),
            func.sum(_platform_share_expr()).filter(and_(~rcur, applied)),
        ).select_from(CouponRedemption).join(Coupon, Coupon.id == CouponRedemption.coupon_id)
        .where(CouponRedemption.created_at >= p0, CouponRedemption.created_at < now)
    )).one()
    coupon_spend, coupon_spend_p, plat_disc, plat_disc_p = (_num(x) for x in cp)

    # players
    ucur = User.created_at >= c0
    nu = (await db.execute(
        select(func.count().filter(ucur), func.count().filter(~ucur))
        .where(User.is_bot.is_(False), User.created_at >= p0, User.created_at < now)
    )).one()
    new_players, new_players_p = (_num(x) for x in nu)
    ap = (await db.execute(
        select(func.count(func.distinct(LobbyMember.user_id)).filter(cur),
               func.count(func.distinct(LobbyMember.user_id)).filter(~cur))
        .select_from(LobbyMember).join(Lobby, Lobby.id == LobbyMember.lobby_id)
        .where(LobbyMember.status == "paid", Lobby.status == "completed", Lobby.start_at >= p0, Lobby.start_at < now)
    )).one()
    active, active_p = (_num(x) for x in ap)

    # SOS + weather + conflicts
    scur = SOSRequest.created_at >= c0
    so = (await db.execute(
        select(func.count().filter(scur), func.count().filter(~scur),
               func.count().filter(and_(scur, SOSRequest.status == "filled")),
               func.count().filter(and_(~scur, SOSRequest.status == "filled")))
        .where(SOSRequest.created_at >= p0, SOSRequest.created_at < now)
    )).one()
    sos, sos_p, sos_filled, sos_filled_p = (_num(x) for x in so)
    wacur = WeatherAlert.created_at >= c0
    saved = WeatherAlert.status.in_(("transferred", "rain_checked"))
    wa = (await db.execute(
        select(func.count().filter(and_(wacur, saved)), func.count().filter(and_(~wacur, saved)))
        .where(WeatherAlert.created_at >= p0, WeatherAlert.created_at < now)
    )).one()
    weather, weather_p = (_num(x) for x in wa)
    sccur = SyncConflict.created_at >= c0
    cf = (await db.execute(
        select(func.count().filter(sccur), func.count().filter(~sccur))
        .where(SyncConflict.created_at >= p0, SyncConflict.created_at < now)
    )).one()
    conflicts, conflicts_p = (_num(x) for x in cf)

    # the liability is what real players hold — bot/demo wallets are excluded (and so is their movement)
    outstanding = _num(await db.scalar(select(func.sum(User.wallet_balance_paise)).where(User.is_bot.is_(False))))
    bot_delta = _num(await db.scalar(
        select(func.sum(WalletTransaction.amount_paise))
        .join(User, User.id == WalletTransaction.user_id)
        .where(User.is_bot.is_(True), WalletTransaction.created_at >= c0, WalletTransaction.created_at < now)
    ))
    outstanding_p = outstanding - (wallet_delta - bot_delta)

    net = comm - plat_disc - rain
    net_p = comm_p - plat_disc_p - rain_p

    def kpi(key, label, value, previous, unit, hint) -> Kpi:
        return Kpi(key=key, label=label, value=round(value, 1), previous=round(previous, 1), unit=unit, hint=hint)

    kpis = [
        kpi("gmv", "GMV", gmv, gmv_p, "paise", "Σ total of confirmed + completed bookings, by kickoff"),
        kpi("net_revenue", "Net revenue", net, net_p, "paise",
            "Commission − platform-funded coupon discounts − rain-check bonuses"),
        kpi("take_rate", "Take rate", _pct(net, gmv), _pct(net_p, gmv_p), "pct", "Net revenue ÷ GMV"),
        kpi("bookings", "Bookings", bookings, bookings_p, "count", "Confirmed + completed bookings, by kickoff"),
        kpi("completed_matches", "Matches played", completed, completed_p, "count", "Lobbies completed"),
        kpi("avg_fill_rate", "Open-game fill rate", _pct(_num(fill_c), 1), _pct(_num(fill_p), 1), "pct",
            "Average paid seats ÷ spots across public lobbies"),
        kpi("split_completion_rate", "Split completion", _pct(split_ok, split_all), _pct(split_ok_p, split_all_p),
            "pct", "Split lobbies that confirmed ÷ split lobbies created (excl. cancelled while forming)"),
        kpi("cancellation_rate", "Cancellation rate", _pct(canc, conf), _pct(canc_p, conf_p), "pct",
            "Confirmed matches later cancelled ÷ confirmed matches"),
        kpi("refunds", "Refunds", ref_credits + ref_src, ref_credits_p + ref_src_p, "paise",
            "Refunds as credits (incl. rain-checks) + admin refunds to the original payment method"),
        kpi("new_players", "New players", new_players, new_players_p, "count", "Accounts created"),
        kpi("active_players", "Active players", active, active_p, "count",
            "Distinct players with a paid seat in a completed match"),
        kpi("sos_fill_rate", "SOS fill rate", _pct(sos_filled, sos), _pct(sos_filled_p, sos_p), "pct",
            "SOS requests filled ÷ raised"),
        kpi("weather_saves", "Weather saves", weather, weather_p, "count",
            "Rain alerts resolved by an indoor transfer or a rain-check"),
        kpi("coupon_spend", "Coupon spend", coupon_spend, coupon_spend_p, "paise",
            "Σ coupon discounts applied (all funders)"),
        kpi("credits_outstanding", "Credits outstanding", outstanding, outstanding_p, "paise",
            "Σ players’ wallet balances (bots excluded) — a liability (previous = balance at the start of the window)"),
        kpi("overbooking_rate", "Overbooking rate", _pct(conflicts, bookings), _pct(conflicts_p, bookings_p), "pct",
            "Channel sync conflicts ÷ bookings"),
    ]
    return AnalyticsOverview(range=range_, kpis=kpis)  # type: ignore[arg-type]


# ═══════════════════════════ time series ═══════════════════════════

TIMESERIES_METRICS = ("gmv", "bookings", "new_players", "net_revenue", "active_players")


def _buckets(n: int, granularity: str) -> tuple[list[date], list[date]]:
    today = ist_today()
    if granularity == "day":
        cur = [today - timedelta(days=n - 1 - i) for i in range(n)]
        return cur, [d - timedelta(days=n) for d in cur]
    first = today - timedelta(days=n - 1)
    start = first - timedelta(days=first.weekday())
    last = today - timedelta(days=today.weekday())
    cur = []
    while start <= last:
        cur.append(start)
        start += timedelta(days=7)
    return cur, [d - timedelta(days=7 * len(cur)) for d in cur]


async def _series(db: AsyncSession, metric: str, granularity: str, lo, hi) -> dict[date, float]:
    def bucket(col):
        return cast(func.date_trunc(granularity, _local(col)), Date).label("b")

    async def rows(stmt) -> dict[date, float]:
        return {d: _num(v) for d, v in (await db.execute(stmt)).all()}

    booked = and_(Booking.status.in_(CONFIRMED), Lobby.start_at >= lo, Lobby.start_at < hi)
    if metric in ("gmv", "bookings", "net_revenue"):
        b = bucket(Lobby.start_at)
        value = {"gmv": func.sum(Booking.total_paise), "bookings": func.count()}.get(
            metric, func.sum(_commission_expr(await _commission_bps_default(db))))
        out = await rows(
            select(b, value).select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id)
            .join(Turf, Turf.id == Lobby.turf_id).outerjoin(Provider, Provider.id == Turf.provider_id)
            .where(booked).group_by(b)
        )
        if metric != "net_revenue":
            return out
        rb = bucket(CouponRedemption.created_at)
        disc = await rows(
            select(rb, func.sum(_platform_share_expr())).select_from(CouponRedemption)
            .join(Coupon, Coupon.id == CouponRedemption.coupon_id)
            .where(CouponRedemption.status == "applied", CouponRedemption.created_at >= lo,
                   CouponRedemption.created_at < hi).group_by(rb)
        )
        wb = bucket(WalletTransaction.created_at)
        bonus = await rows(
            select(wb, func.sum(WalletTransaction.amount_paise))
            .where(WalletTransaction.kind == "bonus", WalletTransaction.ref_type == "lobby",
                   WalletTransaction.created_at >= lo, WalletTransaction.created_at < hi).group_by(wb)
        )
        for d in set(out) | set(disc) | set(bonus):
            out[d] = out.get(d, 0) - disc.get(d, 0) - bonus.get(d, 0)
        return out
    if metric == "new_players":
        b = bucket(User.created_at)
        return await rows(select(b, func.count()).where(User.is_bot.is_(False), User.created_at >= lo,
                                                        User.created_at < hi).group_by(b))
    b = bucket(Lobby.start_at)
    return await rows(
        select(b, func.count(func.distinct(LobbyMember.user_id))).select_from(LobbyMember)
        .join(Lobby, Lobby.id == LobbyMember.lobby_id)
        .where(LobbyMember.status == "paid", Lobby.status == "completed", Lobby.start_at >= lo, Lobby.start_at < hi)
        .group_by(b)
    )


async def timeseries(db: AsyncSession, metric: str, range_: str, granularity: str) -> TimeSeries:
    if metric not in TIMESERIES_METRICS:
        raise BadRequest(f"metric must be one of {', '.join(TIMESERIES_METRICS)}")
    if granularity not in ("day", "week"):
        raise BadRequest("granularity must be day or week")
    n, now, _, _ = _windows(range_)
    cur, prev = _buckets(n, granularity)
    lo = ist_day_bounds(prev[0])[0]
    values = await _series(db, metric, granularity, lo, now)
    return TimeSeries(
        metric=metric, granularity=granularity,  # type: ignore[arg-type]
        points=[SeriesPoint(date=d, value=values.get(d, 0)) for d in cur],
        previous=[SeriesPoint(date=d, value=values.get(d, 0)) for d in prev],
    )


# ═══════════════════════════ cohorts ═══════════════════════════

_COHORT_SQL = text("""
WITH plays AS (
    SELECT DISTINCT m.user_id, date_trunc('week', timezone(:tz, l.start_at))::date AS wk
    FROM lobby_members m JOIN lobbies l ON l.id = m.lobby_id
    WHERE m.status = 'paid' AND l.status = 'completed'
), firsts AS (
    SELECT user_id, min(wk) AS cohort FROM plays GROUP BY user_id
)
SELECT f.cohort, (p.wk - f.cohort) / 7 AS idx, count(DISTINCT p.user_id) AS n
FROM firsts f JOIN plays p ON p.user_id = f.user_id
WHERE f.cohort >= :since AND p.wk - f.cohort BETWEEN 0 AND :max_days
GROUP BY f.cohort, idx
ORDER BY f.cohort, idx
""")


async def cohorts(db: AsyncSession, *, weeks: int = 8, horizon: int = 8) -> CohortTable:
    today = ist_today()
    this_week = today - timedelta(days=today.weekday())
    since = this_week - timedelta(days=7 * (weeks - 1))
    rows = (await db.execute(_COHORT_SQL, {"tz": settings.timezone, "since": since, "max_days": 7 * horizon})).all()
    table: dict[date, dict[int, int]] = {}
    for cohort, idx, n in rows:
        table.setdefault(cohort, {})[int(idx)] = int(n)
    out = []
    for i in range(weeks):
        week = since + timedelta(days=7 * i)
        counts = table.get(week, {})
        size = counts.get(0, 0)
        retention: list[float | None] = []
        for k in range(horizon + 1):
            if week + timedelta(days=7 * k) > this_week:
                retention.append(None)
            else:
                retention.append(_pct(counts.get(k, 0), size) if size else None)
        out.append(Cohort(week=week, size=size, retention=retention))
    return CohortTable(cohorts=out)


# ═══════════════════════════ venues / heatmap / sports ═══════════════════════════


async def venues(db: AsyncSession, range_: str) -> list[VenueAnalyticsRow]:
    _, now, c0, _ = _windows(range_)
    turfs = (await db.execute(
        select(Turf.id, Turf.name, Provider.name).outerjoin(Provider, Provider.id == Turf.provider_id)
        .order_by(Turf.name)
    )).all()
    booked = dict((t, (int(n), int(g))) for t, n, g in (await db.execute(
        select(Lobby.turf_id, func.count(), func.coalesce(func.sum(Booking.total_paise), 0))
        .select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id)
        .where(Booking.status.in_(CONFIRMED), Lobby.start_at >= c0, Lobby.start_at < now).group_by(Lobby.turf_id)
    )).all())
    cancel = {t: (int(c), int(a)) for t, c, a in (await db.execute(
        select(Lobby.turf_id, func.count().filter(Lobby.status == "cancelled"), func.count())
        .where(Lobby.confirmed_at.is_not(None), Lobby.start_at >= c0, Lobby.start_at < now).group_by(Lobby.turf_id)
    )).all()}
    occ = {t: (int(o), int(a)) for t, o, a in (await db.execute(
        select(Pitch.turf_id, func.count().filter(Slot.status.in_(("booked", "blocked"))), func.count())
        .select_from(Slot).join(Pitch, Pitch.id == Slot.pitch_id)
        .where(Slot.start_at >= c0, Slot.start_at < now).group_by(Pitch.turf_id)
    )).all()}
    conflicts = dict((await db.execute(
        select(Pitch.turf_id, func.count()).select_from(SyncConflict).join(Pitch, Pitch.id == SyncConflict.pitch_id)
        .where(SyncConflict.created_at >= c0, SyncConflict.created_at < now).group_by(Pitch.turf_id)
    )).all())
    out = [
        VenueAnalyticsRow(
            turf_id=tid, turf_name=name, provider_name=provider, bookings=booked.get(tid, (0, 0))[0],
            gmv_paise=booked.get(tid, (0, 0))[1], occupancy_pct=_pct(*occ.get(tid, (0, 0))),
            cancellation_pct=_pct(*cancel.get(tid, (0, 0))), conflicts=int(conflicts.get(tid, 0)),
        )
        for tid, name, provider in turfs
    ]
    return sorted(out, key=lambda r: (-r.gmv_paise, r.turf_name))


async def heatmap(db: AsyncSession, range_: str) -> Heatmap:
    _, now, c0, _ = _windows(range_)
    local = _local(Lobby.start_at)
    wd = (func.extract("isodow", local) - 1).label("wd")
    hr = func.extract("hour", local).label("hr")
    rows = (await db.execute(
        select(wd, hr, func.count()).select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id)
        .where(Booking.status.in_(CONFIRMED), Lobby.start_at >= c0, Lobby.start_at < now).group_by(wd, hr)
    )).all()
    return Heatmap(cells=[HeatmapCell(weekday=int(w), hour=int(h), bookings=int(n)) for w, h, n in rows])


async def sports(db: AsyncSession, range_: str) -> SportMix:
    _, now, c0, _ = _windows(range_)
    rows = (await db.execute(
        select(Lobby.sport, func.count(), func.coalesce(func.sum(Booking.total_paise), 0))
        .select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id)
        .where(Booking.status.in_(CONFIRMED), Lobby.start_at >= c0, Lobby.start_at < now)
        .group_by(Lobby.sport).order_by(func.count().desc())
    )).all()
    return SportMix(rows=[SportMixRow(sport=s, bookings=int(n), gmv_paise=int(g)) for s, n, g in rows])

