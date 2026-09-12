from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings

IST = ZoneInfo(settings.timezone)


def utcnow() -> datetime:
    return datetime.now(UTC)


def to_ist(dt: datetime) -> datetime:
    return dt.astimezone(IST)


def ist_today() -> date:
    return utcnow().astimezone(IST).date()


def ist_day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC [start, end) of a calendar day in IST."""
    start = datetime.combine(day, time.min, tzinfo=IST)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


def iso_week_key(dt: datetime) -> str:
    y, w, _ = to_ist(dt).isocalendar()
    return f"{y}-W{w:02d}"
