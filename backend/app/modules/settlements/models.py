import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class Settlement(TimestampMixin, Base):
    """Periodic payout statement to a provider.

    net = gross − refunds − provider_funded_discounts − commission − gst_on_commission − tcs − tds
    draft → approved (finance, step-up MFA) → paid | failed
    """

    __tablename__ = "settlements"
    __table_args__ = (UniqueConstraint("provider_id", "period_start", "period_end", name="uq_settlements_period"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)  # inclusive (IST dates)
    booking_count: Mapped[int] = mapped_column(Integer, default=0)
    gross_paise: Mapped[int] = mapped_column(Integer, default=0)
    refunds_paise: Mapped[int] = mapped_column(Integer, default=0)
    provider_discounts_paise: Mapped[int] = mapped_column(Integer, default=0)
    adjustments_paise: Mapped[int] = mapped_column(Integer, default=0)  # ± manual (conflict penalties, goodwill)
    commission_bps: Mapped[int] = mapped_column(Integer)
    commission_paise: Mapped[int] = mapped_column(Integer, default=0)
    gst_on_commission_paise: Mapped[int] = mapped_column(Integer, default=0)
    tcs_paise: Mapped[int] = mapped_column(Integer, default=0)
    tds_paise: Mapped[int] = mapped_column(Integer, default=0)
    net_payable_paise: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="draft", server_default="draft", index=True)
    generated_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )  # maker; approver must be a different admin
    payout_method: Mapped[str | None] = mapped_column(String(16))  # razorpay_route | manual_neft
    approved_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payout_ref: Mapped[str | None] = mapped_column(String(80))  # Razorpay transfer id / UTR
    failure_reason: Mapped[str | None] = mapped_column(String(300))

    lines: Mapped[list["SettlementLine"]] = relationship(back_populates="settlement", lazy="selectin")


class SettlementLine(CreatedAtMixin, Base):
    __tablename__ = "settlement_lines"
    __table_args__ = (UniqueConstraint("booking_id", name="uq_settlement_lines_booking"),)  # a booking settles once

    id: Mapped[uuid.UUID] = uuid_pk()
    settlement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("settlements.id", ondelete="CASCADE"), index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"))
    turf_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("turfs.id"))
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    gross_paise: Mapped[int] = mapped_column(Integer)
    refunds_paise: Mapped[int] = mapped_column(Integer, default=0)
    provider_discounts_paise: Mapped[int] = mapped_column(Integer, default=0)
    commission_paise: Mapped[int] = mapped_column(Integer)

    settlement: Mapped[Settlement] = relationship(back_populates="lines")
