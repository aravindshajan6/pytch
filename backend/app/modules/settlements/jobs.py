"""Worker job: weekly (per provider cycle) settlement drafts. Idempotent — bookings settle once and a
period's existing draft is only extended with newly eligible bookings."""

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.core.timeutils import ist_day_bounds, ist_today, utcnow
from app.modules.admin.auditing import audit
from app.modules.providers.models import Provider
from app.modules.settlements.service import generate_for_provider

LOOKBACK_PERIODS = 4
_BIWEEKLY_ANCHOR = date(2026, 1, 5)  # a Monday
_MAX_SLOT_HOURS = 6  # a slot starting on the last day may end the next morning


def closed_periods(cycle: str, today: date, n: int = LOOKBACK_PERIODS) -> list[tuple[date, date]]:
    """The last `n` complete periods (IST dates, inclusive) for a settlement cycle, newest first."""
    monday = today - timedelta(days=today.weekday())
    if cycle == "monthly":
        out, first = [], today.replace(day=1)
        for _ in range(n):
            end = first - timedelta(days=1)
            start = end.replace(day=1)
            out.append((start, end))
            first = start
        return out
    if cycle == "biweekly":
        current = _BIWEEKLY_ANCHOR + timedelta(days=((monday - _BIWEEKLY_ANCHOR).days // 14) * 14)
        return [(current - timedelta(days=14 * k), current - timedelta(days=14 * (k - 1) + 1)) for k in range(1, n + 1)]
    return [(monday - timedelta(days=7 * k), monday - timedelta(days=7 * (k - 1) + 1)) for k in range(1, n + 1)]


def period_closed(period_end: date, now: datetime) -> bool:
    _, end_utc = ist_day_bounds(period_end)
    return end_utc + timedelta(hours=settings.settlement_hold_hours + _MAX_SLOT_HOURS) <= now


async def auto_generate_drafts(db: AsyncSession) -> int:
    """Create/extend draft settlements for every approved provider's recently closed periods."""
    now, today = utcnow(), ist_today()
    providers = (await db.execute(
        select(Provider.id, Provider.name, Provider.settlement_cycle).where(Provider.status == "approved"))).all()
    created = 0
    for provider_id, name, cycle in providers:
        for start, end in closed_periods(cycle or "weekly", today):
            if not period_closed(end, now):
                continue
            try:
                settlement, added = await generate_for_provider(db, provider_id, start, end, generated_by=None)
                if settlement is not None and added:
                    await audit(db, None, "settlement.generate",
                                f"Auto draft {start}–{end} for {name}: +{added} bookings",
                                target_type="settlement", target_id=settlement.id,
                                changes={"provider_id": str(provider_id), "lines_added": added})
                    created += 1
                await db.commit()
            except Exception:
                await db.rollback()
                logger.exception("settlement draft for provider %s %s..%s failed", provider_id, start, end)
    return created
