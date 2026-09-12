"""Demo controls (only when DEMO_MODE=true). Split by owner to avoid edit conflicts."""

from fastapi import APIRouter, Depends

from app.core.deps import require_demo_mode
from app.modules.dev.community_tools import router as community_router
from app.modules.dev.lobby_tools import router as lobby_router

router = APIRouter(prefix="/dev", tags=["dev"], dependencies=[Depends(require_demo_mode)])
router.include_router(lobby_router)
router.include_router(community_router)
