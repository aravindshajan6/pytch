import uuid

from fastapi import APIRouter

from app.core.deps import DB, CurrentUser
from app.modules.ratings import service
from app.modules.ratings.schemas import PendingRating, RatingSummary, SubmitRatingsRequest, SubmitRatingsResponse

router = APIRouter(prefix="/ratings", tags=["ratings"])


@router.get("/pending", response_model=list[PendingRating])
async def pending(db: DB, user: CurrentUser) -> list[PendingRating]:
    return await service.pending_ratings(db, user)


@router.post("/lobbies/{lobby_id}", response_model=SubmitRatingsResponse)
async def submit(lobby_id: uuid.UUID, body: SubmitRatingsRequest, db: DB, user: CurrentUser) -> SubmitRatingsResponse:
    return await service.submit_ratings(db, lobby_id, user, body)


@router.get("/me", response_model=RatingSummary)
async def me(db: DB, user: CurrentUser) -> RatingSummary:
    return await service.rating_summary(db, user)
