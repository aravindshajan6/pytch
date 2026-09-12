from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.constants import AREAS, RATING_TAGS, SPORTS
from app.core.database import SessionLocal
from app.core.redis import get_redis

router = APIRouter(tags=["meta"])


@router.get("/health")
async def health() -> dict:
    db_ok = redis_ok = False
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    try:
        redis_ok = bool(await get_redis().ping())
    except Exception:
        pass
    return {"status": "ok" if db_ok and redis_ok else "degraded", "db": db_ok, "redis": redis_ok}


@router.get("/meta")
async def meta() -> dict:
    return {
        "app_name": settings.app_name,
        "demo_mode": settings.demo_mode,
        "payment_provider": settings.payment_provider,
        "razorpay_key_id": settings.razorpay_key_id if settings.payment_provider == "razorpay" else None,
        "split_window_minutes": settings.split_window_minutes,
        "full_hold_minutes": settings.full_hold_minutes,
        "seat_reservation_minutes": settings.seat_reservation_minutes,
        "sub_discount_pct": settings.sub_discount_pct,
        "sos_window_hours": settings.sos_window_hours,
        "bench_default_radius_km": settings.bench_default_radius_km,
        "rain_transfer_cover_paise": settings.rain_transfer_cover_paise,
        "rain_bonus_paise": settings.rain_bonus_paise,
        "rating_window_hours": settings.rating_window_hours,
        "max_pinned_clips": settings.max_pinned_clips,
        "max_clip_seconds": settings.max_clip_seconds,
        "sports": SPORTS,
        "areas": AREAS,
        "rating_tags": RATING_TAGS,
        "city_center": {"lat": settings.city_center_lat, "lng": settings.city_center_lng},
    }
