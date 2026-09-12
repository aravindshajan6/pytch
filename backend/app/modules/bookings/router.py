import uuid

from fastapi import APIRouter, status

from app.core.deps import DB, CurrentUser
from app.modules.bookings import service
from app.modules.bookings.schemas import BookingOut, CreateBookingRequest
from app.modules.lobbies.detail_schemas import CreateBookingResponse, LobbyDetail

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=CreateBookingResponse, status_code=status.HTTP_201_CREATED)
async def create_booking(body: CreateBookingRequest, user: CurrentUser, db: DB) -> CreateBookingResponse:
    return await service.create_booking(db, user, body)


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(booking_id: uuid.UUID, user: CurrentUser, db: DB) -> BookingOut:
    return await service.get_booking(db, user, booking_id)


@router.post("/{booking_id}/cancel", response_model=LobbyDetail)
async def cancel_booking(booking_id: uuid.UUID, user: CurrentUser, db: DB) -> LobbyDetail:
    return await service.cancel_booking(db, user, booking_id)
