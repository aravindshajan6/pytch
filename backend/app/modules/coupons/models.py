import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class Coupon(TimestampMixin, Base):
    """Promo code applied to a player's payment (their share). Redemption row-locks the coupon."""

    __tablename__ = "coupons"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(24), unique=True, index=True)  # upper-case
    description: Mapped[str] = mapped_column(String(200))
    discount_type: Mapped[str] = mapped_column(String(8))  # percent | flat
    percent_off: Mapped[int | None] = mapped_column(Integer)  # 1..100 (percent)
    amount_off_paise: Mapped[int | None] = mapped_column(Integer)  # flat
    max_discount_paise: Mapped[int | None] = mapped_column(Integer)  # cap for percent
    min_amount_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    usage_limit_total: Mapped[int | None] = mapped_column(Integer)
    usage_limit_per_user: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    used_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    first_booking_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    sports: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list, server_default=text("'{}'"))
    turf_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), default=list, server_default=text("'{}'")
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE")
    )  # provider-scoped coupon (and provider-funded if funded_by=provider)
    # who absorbs the discount: platform | provider | shared
    funded_by: Mapped[str] = mapped_column(String(10), default="platform", server_default="platform")
    provider_share_pct: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # for funded_by=shared
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )


class CouponRedemption(CreatedAtMixin, Base):
    __tablename__ = "coupon_redemptions"
    __table_args__ = (UniqueConstraint("payment_id", name="uq_coupon_redemptions_payment"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    coupon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id", ondelete="CASCADE"))
    lobby_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="SET NULL")
    )
    discount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="applied", server_default="applied")  # applied|reversed
