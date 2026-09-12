import uuid
from datetime import date

from fastapi import APIRouter

from app.core.deps import DB
from app.modules.slots import service
from app.modules.turfs.schemas import SlotDetail, SlotOut

router = APIRouter(tags=["slots"])


@router.get("/pitches/{pitch_id}/slots", response_model=list[SlotOut])
async def pitch_slots(pitch_id: uuid.UUID, db: DB, date: date | None = None) -> list[SlotOut]:
    """Slots of one IST calendar day (default: today), with live lobby + weather hints."""
    return await service.list_pitch_slots(db, pitch_id, date)


@router.get("/slots/{slot_id}", response_model=SlotDetail)
async def get_slot(slot_id: uuid.UUID, db: DB) -> SlotDetail:
    return await service.slot_detail(db, slot_id)
