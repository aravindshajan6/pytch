import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import DB, CurrentUser
from app.core.pagination import Page, PageParams, page_params
from app.modules.highlights import service
from app.modules.highlights.schemas import ClipOut, CreateClipRequest, RecordingOut, ViewsOut
from app.modules.turfs.schemas import Sport

router = APIRouter(prefix="/highlights", tags=["highlights"])


@router.get("/recordings", response_model=list[RecordingOut])
async def my_recordings(db: DB, user: CurrentUser) -> list[RecordingOut]:
    return await service.my_recordings(db, user)


@router.get("/recordings/{recording_id}", response_model=RecordingOut)
async def get_recording(recording_id: uuid.UUID, db: DB, user: CurrentUser) -> RecordingOut:
    return await service.get_recording(db, recording_id, user)


@router.post("/recordings/{recording_id}/clips", response_model=ClipOut, status_code=status.HTTP_201_CREATED)
async def create_clip(recording_id: uuid.UUID, body: CreateClipRequest, db: DB, user: CurrentUser) -> ClipOut:
    return await service.create_clip(db, recording_id, user, body)


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_clip(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    await service.delete_clip(db, clip_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/feed", response_model=Page[ClipOut])
async def feed(
    db: DB,
    user: CurrentUser,
    sort: Literal["trending", "recent"] = "trending",
    sport: Sport | None = None,
    page: PageParams = Depends(page_params),
) -> Page[ClipOut]:
    return await service.feed(db, user, sort=sort, sport=sport, limit=page.limit, offset=page.offset)


@router.get("/users/{user_id}/clips", response_model=list[ClipOut])
async def user_clips(user_id: uuid.UUID, db: DB, user: CurrentUser) -> list[ClipOut]:
    return await service.user_clips(db, user_id, user)


@router.post("/clips/{clip_id}/like", response_model=ClipOut)
async def like(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> ClipOut:
    return await service.like(db, clip_id, user)


@router.delete("/clips/{clip_id}/like", response_model=ClipOut)
async def unlike(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> ClipOut:
    return await service.unlike(db, clip_id, user)


@router.post("/clips/{clip_id}/pin", response_model=ClipOut)
async def pin(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> ClipOut:
    return await service.set_pinned(db, clip_id, user, True)


@router.delete("/clips/{clip_id}/pin", response_model=ClipOut)
async def unpin(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> ClipOut:
    return await service.set_pinned(db, clip_id, user, False)


@router.post("/clips/{clip_id}/view", response_model=ViewsOut)
async def view(clip_id: uuid.UUID, db: DB, user: CurrentUser) -> ViewsOut:
    """Counted once per viewer per clip per day; the owner's own plays don't count."""
    return ViewsOut(views=await service.add_view(db, clip_id, user))
