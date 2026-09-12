import uuid

from fastapi import APIRouter

from app.core.deps import DB, CurrentUser
from app.modules.users import service
from app.modules.users.profile_schemas import PlayerProfile
from app.modules.users.schemas import UserMe, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
async def me(user: CurrentUser) -> UserMe:
    return UserMe.from_user(user)


@router.patch("/me", response_model=UserMe)
async def update_me(body: UserUpdate, user: CurrentUser, db: DB) -> UserMe:
    return await service.update_me(db, user, body)


@router.get("/me/profile", response_model=PlayerProfile)
async def my_profile(user: CurrentUser, db: DB) -> PlayerProfile:
    return await service.player_profile(db, user.id, user)


@router.get("/{user_id}", response_model=PlayerProfile)
async def profile(user_id: uuid.UUID, user: CurrentUser, db: DB) -> PlayerProfile:
    return await service.player_profile(db, user_id, user)
