"""Worker jobs for slots."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.slots.service import generate_slots_for_pitch
from app.modules.turfs.models import Pitch, Turf


async def generate_rolling_slots(db: AsyncSession) -> int:
    """Keep a rolling `slot_horizon_days` window of bookable hours for every active pitch."""
    pitches = (
        (
            await db.execute(
                select(Pitch).join(Turf, Turf.id == Pitch.turf_id).where(
                    Pitch.is_active.is_(True), Turf.is_active.is_(True)
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    created = 0
    for pitch in pitches:
        created += await generate_slots_for_pitch(db, pitch, days=settings.slot_horizon_days)
    await db.commit()
    return created
