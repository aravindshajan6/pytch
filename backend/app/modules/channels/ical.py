"""iCalendar (RFC 5545) export builder and import parser.

Export: one VEVENT per occupied slot, stable UID `slot-<id>@pytch.in`, `SUMMARY:Booked` — never any customer data.
Import: VEVENTs overlapping a window (default next 14 days) → `ExternalEvent(ref, start, end, summary)`.
  * TZID-qualified times are honoured; floating times and all-day DATE values are read in venue time (IST);
  * RRULE (+EXDATE/RDATE, RECURRENCE-ID overrides) expanded inside the window, one ref per occurrence;
  * STATUS:CANCELLED and TRANSP:TRANSPARENT (free) events are dropped (→ their blocks get cancelled);
  * our own exported UIDs are ignored (prevents export→import echo loops).
"""

import hashlib
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from dateutil.rrule import rrulestr
from icalendar import Calendar, Event, vRecur

from app.core.timeutils import IST, utcnow

EXPORT_UID_DOMAIN = "pytch.in"
MAX_EVENTS = 2000  # after recurrence expansion
MAX_RRULE_ITERATIONS = 50_000
DEFAULT_TIMED_DURATION = timedelta(hours=1)


class FeedParseError(Exception):
    """The payload isn't a usable iCalendar file (message safe to show)."""


@dataclass(frozen=True)
class ExternalEvent:
    ref: str
    start: datetime  # UTC
    end: datetime  # UTC
    summary: str | None


# ─────────────────────────── export ───────────────────────────


def build_export(*, calendar_name: str, busy: list[tuple[Any, datetime, datetime, datetime | None]]) -> bytes:
    """`busy` = [(slot_id, start_utc, end_utc, last_modified)]. No PII ever goes into the feed."""
    cal = Calendar()
    cal.add("prodid", "-//Pytch//Pitch availability 1.0//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", calendar_name[:120])
    cal.add("x-wr-timezone", "Asia/Kolkata")
    cal.add("refresh-interval", "PT15M", parameters={"VALUE": "DURATION"})
    cal.add("x-published-ttl", "PT15M")
    stamp = utcnow().replace(microsecond=0)
    for slot_id, start, end, modified in busy:
        ev = Event()
        ev.add("uid", f"slot-{slot_id}@{EXPORT_UID_DOMAIN}")
        ev.add("dtstamp", stamp)
        if modified is not None:
            ev.add("last-modified", modified.astimezone(UTC).replace(microsecond=0))
        ev.add("dtstart", start.astimezone(UTC))
        ev.add("dtend", end.astimezone(UTC))
        ev.add("summary", "Booked")
        ev.add("status", "CONFIRMED")
        ev.add("transp", "OPAQUE")
        cal.add_component(ev)
    return cal.to_ical()


# ─────────────────────────── import ───────────────────────────


def _to_utc(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=IST)  # floating time → venue-local
        return value.astimezone(UTC)
    return datetime.combine(value, time.min, tzinfo=IST).astimezone(UTC)  # all-day → IST midnight


def _ref_base(uid: str) -> str:
    return uid if len(uid) <= 160 else "h:" + hashlib.sha256(uid.encode()).hexdigest()[:40]


def _occurrence_ref(base: str, start_utc: datetime) -> str:
    return f"{base}#{start_utc:%Y%m%dT%H%M%SZ}"


def _prop_dt(comp: Any, name: str) -> date | datetime | None:
    prop = comp.get(name)
    return getattr(prop, "dt", None) if prop is not None else None


def _duration(comp: Any, start: date | datetime) -> timedelta:
    end = _prop_dt(comp, "dtend")
    if end is not None:
        if isinstance(start, datetime) != isinstance(end, datetime):
            return timedelta(days=1) if not isinstance(start, datetime) else DEFAULT_TIMED_DURATION
        delta = _to_utc(end) - _to_utc(start)
        return delta if delta > timedelta(0) else DEFAULT_TIMED_DURATION
    dur = comp.get("duration")
    if dur is not None and isinstance(getattr(dur, "dt", None), timedelta) and dur.dt > timedelta(0):
        return dur.dt
    return timedelta(days=1) if not isinstance(start, datetime) else DEFAULT_TIMED_DURATION


def _is_busy(comp: Any) -> bool:
    status = str(comp.get("status") or "").upper()
    transp = str(comp.get("transp") or "").upper()
    return status != "CANCELLED" and transp != "TRANSPARENT"


def _summary(comp: Any) -> str | None:
    raw = comp.get("summary")
    text = str(raw).strip() if raw is not None else ""
    return text[:80] or None


def _date_list(comp: Any, name: str) -> list[date | datetime]:
    prop = comp.get(name)
    if prop is None:
        return []
    items = prop if isinstance(prop, list) else [prop]
    out: list[date | datetime] = []
    for item in items:
        for d in getattr(item, "dts", []) or []:
            out.append(d.dt)
    return out


def _local_naive(value: date | datetime, tz: Any) -> datetime:
    """Wall-clock time in the event's zone (RRULE maths happens in local time, like RFC 5545 says)."""
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(tz).replace(tzinfo=None)
        return value
    return datetime.combine(value, time.min)


def _expand(comp: Any, start: date | datetime, window_start: datetime, window_end: datetime) -> list[datetime]:
    """UTC starts of the occurrences of a recurring event that may overlap the window."""
    tz = start.tzinfo if isinstance(start, datetime) and start.tzinfo is not None else IST
    all_day = not isinstance(start, datetime)
    dtstart = _local_naive(start, tz)
    rule_prop = comp.get("rrule")
    rules = rule_prop if isinstance(rule_prop, list) else [rule_prop]
    duration = _duration(comp, start)
    lo = _local_naive(window_start - duration, tz)
    hi = _local_naive(window_end, tz)
    starts: set[datetime] = set()
    for rule in rules:
        params = dict(rule)
        freq = str((params.get("FREQ") or [""])[0]).upper()
        if freq in ("SECONDLY", "MINUTELY") or not freq:
            continue  # pathological for a booking calendar — ignore rather than burn CPU
        until_values = params.pop("UNTIL", None)
        until: datetime | None = None
        if until_values:
            raw_until = until_values[0]
            until = (_local_naive(raw_until, tz) if isinstance(raw_until, datetime)
                     else datetime.combine(raw_until, time.max))
        try:
            recurrence = rrulestr(vRecur(params).to_ical().decode(), dtstart=dtstart)
        except (ValueError, TypeError):
            continue
        for i, occ in enumerate(recurrence):
            if i >= MAX_RRULE_ITERATIONS or occ > hi or (until is not None and occ > until):
                break
            if occ >= lo:
                starts.add(occ)
    for extra in _date_list(comp, "rdate"):
        naive = _local_naive(extra, tz)
        if lo <= naive <= hi:
            starts.add(naive)
    for excluded in _date_list(comp, "exdate"):
        starts.discard(_local_naive(excluded, tz))
    return sorted(_to_utc(s.replace(tzinfo=tz)) if not all_day else _to_utc(s.date()) for s in starts)


def parse_feed(data: bytes, *, window_start: datetime, window_end: datetime) -> list[ExternalEvent]:
    try:
        cal = Calendar.from_ical(data)
    except (ValueError, IndexError, KeyError, TypeError) as exc:
        raise FeedParseError("This doesn't look like an iCalendar (.ics) file") from exc
    if getattr(cal, "name", None) != "VCALENDAR":
        raise FeedParseError("This doesn't look like an iCalendar (.ics) file")

    masters: dict[str, Any] = {}
    overrides: dict[tuple[str, datetime], Any] = {}
    for comp in cal.walk("VEVENT"):
        start = _prop_dt(comp, "dtstart")
        if start is None:
            continue
        uid = str(comp.get("uid") or "").strip()
        if not uid:
            uid = "gen:" + hashlib.sha256(f"{start}|{comp.get('summary')}".encode()).hexdigest()[:32]
        if uid.lower().endswith("@" + EXPORT_UID_DOMAIN):
            continue
        rid = _prop_dt(comp, "recurrence-id")
        if rid is not None:
            overrides[(uid, _to_utc(rid))] = comp
        else:
            masters[uid] = comp

    out: dict[str, ExternalEvent] = {}

    def emit(ref: str, comp: Any, start_utc: datetime, duration: timedelta) -> None:
        end_utc = start_utc + duration
        if _is_busy(comp) and end_utc > window_start and start_utc < window_end:
            out[ref] = ExternalEvent(ref=ref, start=start_utc, end=end_utc, summary=_summary(comp))

    for uid, comp in masters.items():
        start = _prop_dt(comp, "dtstart")
        assert start is not None
        base = _ref_base(uid)
        duration = _duration(comp, start)
        if comp.get("rrule") is None:
            emit(base, comp, _to_utc(start), duration)
            continue
        for occ_start in _expand(comp, start, window_start, window_end):
            override = overrides.pop((uid, occ_start), None)
            if override is not None:
                o_start = _prop_dt(override, "dtstart") or occ_start
                emit(_occurrence_ref(base, occ_start), override, _to_utc(o_start), _duration(override, o_start))
            else:
                emit(_occurrence_ref(base, occ_start), comp, occ_start, duration)
            if len(out) >= MAX_EVENTS:
                break
    # moved instances whose original time is outside the window (or whose master is missing)
    for (uid, rid_utc), comp in overrides.items():
        start = _prop_dt(comp, "dtstart")
        if start is not None:
            emit(_occurrence_ref(_ref_base(uid), rid_utc), comp, _to_utc(start), _duration(comp, start))
    return sorted(out.values(), key=lambda e: (e.start, e.ref))[:MAX_EVENTS]
