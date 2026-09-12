from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with an env var of the same name."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "PYTCH"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    demo_mode: bool = True
    log_level: str = "INFO"

    api_prefix: str = "/api/v1"
    public_web_url: str = "http://localhost:8080"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://localhost:8080"])

    database_url: str = "postgresql+asyncpg://pytch:pytch@localhost:5433/pytch"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    redis_url: str = "redis://localhost:6380/0"

    jwt_secret: str = "change-me-in-production-please-32b"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 30

    otp_ttl_seconds: int = 300
    otp_max_requests: int = 5
    otp_window_seconds: int = 600

    # Payments
    payment_provider: Literal["mock", "razorpay"] = "mock"
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    # Business rules
    timezone: str = "Asia/Kolkata"
    split_window_minutes: int = 30
    full_hold_minutes: int = 10
    seat_reservation_minutes: int = 10
    sub_seat_reservation_minutes: int = 5
    sub_discount_pct: int = 20
    sos_window_hours: int = 6
    cancel_cutoff_hours: int = 6
    bench_default_radius_km: float = 5.0
    rain_transfer_cover_paise: int = 20000
    rain_bonus_paise: int = 2500
    rain_transfer_radius_km: float = 10.0
    rating_window_hours: int = 48
    max_pinned_clips: int = 3
    max_clip_seconds: int = 60
    slot_horizon_days: int = 14

    # Weather
    weather_api_url: str = "https://api.open-meteo.com/v1/forecast"
    weather_cache_seconds: int = 1800
    weather_scan_horizon_hours: int = 48
    weather_prob_threshold: int = 60
    weather_mm_threshold: float = 2.0

    media_dir: str = "media"
    media_url_prefix: str = "/media"

    city_center_lat: float = 9.9816
    city_center_lng: float = 76.2999

    @property
    def is_test(self) -> bool:
        return self.environment == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
