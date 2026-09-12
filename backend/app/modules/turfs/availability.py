"""Can players see / book this venue right now? One definition shared by discovery, slots and bookings.

A pitch takes new Pytch bookings only when the pitch and its venue are active, the venue's partner (if any)
is approved — suspended/pending partners stop taking bookings — and its sport is enabled in the catalog.
Existing matches are unaffected: these checks gate *new* bookings and discovery only.
"""

from sqlalchemy import ColumnElement, and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.turfs.models import Pitch, Turf


def venue_open_clause() -> ColumnElement[bool]:
    """SQL: the venue is listed (active, and its partner — if it has one — is approved)."""
    from app.modules.providers.models import Provider

    partner_ok = exists(select(Provider.id).where(Provider.id == Turf.provider_id, Provider.status == "approved"))
    return and_(Turf.is_active.is_(True), or_(Turf.provider_id.is_(None), partner_ok))


async def active_sport_keys() -> set[str]:
    from app.modules.platform.service import meta_sports

    return {s["key"] for s in await meta_sports()}


async def pitch_bookable(db: AsyncSession, pitch: Pitch) -> bool:
    if not pitch.is_active or pitch.sport not in await active_sport_keys():
        return False
    return bool(await db.scalar(select(Turf.id).where(Turf.id == pitch.turf_id, venue_open_clause())))
