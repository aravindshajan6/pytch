from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with an env var of the same name."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "PYTCH"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    demo_mode: bool = False  # docker-compose enables it for the local demo stack
    log_level: str = "INFO"

    api_prefix: str = "/api/v1"
    public_web_url: str = "http://localhost:8080"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://localhost:8080"])
    # Only these peers may set X-Real-IP / X-Forwarded-For (the nginx edge on the private Docker network).
    # Narrow it to the proxy's subnet in production.
    trusted_proxy_cidrs: list[str] = Field(default_factory=lambda: [
        "127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])

    database_url: str = "postgresql+asyncpg://pytch:pytch@localhost:5433/pytch"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    redis_url: str = "redis://localhost:6380/0"

    jwt_secret: str = "change-me-in-production-please-32b"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 30

    # Partner (service-provider) portal sessions — same OTP identity as players, separate audience
    partner_access_token_minutes: int = 30
    partner_refresh_token_days: int = 14

    # Admin console — isolated identity, separate signing key, short sessions, mandatory TOTP
    admin_jwt_secret: str = "change-me-admin-secret-must-differ-from-jwt-secret"
    admin_access_token_minutes: int = 15
    admin_session_absolute_hours: int = 12
    admin_session_idle_minutes: int = 15
    admin_step_up_minutes: int = 5  # sensitive actions need a TOTP entered within this window
    admin_max_failed_logins: int = 5
    admin_lockout_minutes: int = 15
    admin_cookie_secure: bool = False  # set true behind HTTPS (production)
    admin_ip_allowlist: list[str] = Field(default_factory=list)  # CIDRs; empty = allow all
    admin_totp_issuer: str = "PYTCH Admin"

    # Field-level encryption (TOTP secrets, feed URLs, webhook secrets). Fernet key, urlsafe base64 32 bytes.
    # Dev default is derived from jwt_secret; ALWAYS set DATA_ENCRYPTION_KEY in production.
    data_encryption_key: str | None = None
    api_key_pepper: str = "change-me-api-key-pepper"

    # Channel sync
    ical_import_interval_minutes: int = 5
    webhook_max_attempts: int = 8

    # Marketplace economics (defaults; runtime-overridable via admin settings)
    default_commission_bps: int = 1000  # 10%
    gst_on_commission_bps: int = 1800  # 18%
    tcs_bps: int = 50  # GST s.52 TCS 0.5% (from 10 Jul 2024)
    tds_194o_bps: int = 10  # 0.1% (s.194-O, from 1 Oct 2024)
    tds_194o_no_pan_bps: int = 500  # 5% when the provider has no PAN
    settlement_hold_hours: int = 24  # a booking becomes payable 24 h after its slot ends
    refund_dual_approval_paise: int = 500000  # refunds above ₹5,000 need a second admin

    otp_ttl_seconds: int = 300
    otp_max_requests: int = 5
    otp_window_seconds: int = 600
    # SMS-bombing / cost controls on top of the per-phone limit
    otp_ip_max_requests: int = 20  # per IP per hour (mobile carriers put many users behind one IP — CGNAT)
    otp_global_max_per_minute: int = 300  # platform-wide circuit breaker for the SMS gateway
    otp_verify_ip_max: int = 30  # verify attempts per IP per 10 min (stops spraying codes across phones)

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

    # service area (Kerala) — bounds public, unauthenticated lookups such as the forecast proxy
    service_lat_min: float = 8.0
    service_lat_max: float = 13.0
    service_lng_min: float = 74.5
    service_lng_max: float = 77.8

    city_center_lat: float = 9.9816
    city_center_lng: float = 76.2999

    @model_validator(mode="after")
    def _refuse_default_secrets_in_production(self) -> "Settings":
        """Fail fast instead of running production with guessable secrets."""
        if self.environment != "production":
            return self
        problems = []
        if self.jwt_secret.startswith("change-me") or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET")
        if self.admin_jwt_secret.startswith("change-me") or len(self.admin_jwt_secret) < 32:
            problems.append("ADMIN_JWT_SECRET")
        if self.admin_jwt_secret == self.jwt_secret:
            problems.append("ADMIN_JWT_SECRET (must differ from JWT_SECRET)")
        if self.api_key_pepper.startswith("change-me"):
            problems.append("API_KEY_PEPPER")
        if not self.data_encryption_key:
            problems.append("DATA_ENCRYPTION_KEY")
        if self.demo_mode:
            problems.append("DEMO_MODE (must be false: demo logins, dev OTP codes and /dev tools)")
        if not self.admin_cookie_secure:
            problems.append("ADMIN_COOKIE_SECURE (must be true: the admin refresh cookie needs HTTPS)")
        bad_origins = [o for o in self.cors_origins
                       if o == "*" or "localhost" in o or "127.0.0.1" in o or o.startswith("http://")]
        if bad_origins:
            problems.append(f"CORS_ORIGINS (https production origins only, got {bad_origins})")
        if problems:
            raise ValueError("Refusing to start in production with unsafe settings: " + ", ".join(problems))
        return self

    @property
    def is_test(self) -> bool:
        return self.environment == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
