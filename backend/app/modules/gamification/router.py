from typing import Literal

from fastapi import APIRouter

from app.core.deps import DB, CurrentUser
from app.modules.gamification import progress
from app.modules.gamification.schemas import GamificationMe, LeaderboardOut

router = APIRouter(tags=["gamification"])


@router.get("/gamification/me", response_model=GamificationMe)
async def me(db: DB, user: CurrentUser) -> GamificationMe:
    return await progress.gamification_me(db, user)


@router.get("/leaderboard", response_model=LeaderboardOut)
async def leaderboard(
    db: DB,
    user: CurrentUser,
    metric: Literal["xp", "true_skill"] = "xp",
    period: Literal["week", "all"] = "week",
) -> LeaderboardOut:
    return await progress.leaderboard(db, user, metric, period)
