import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Provider(TimestampMixin, Base):
    """A service-provider business (turf / court operator) that owns one or more venues (`turfs`)."""

    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120))  # display / brand name
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    legal_name: Mapped[str | None] = mapped_column(String(160))
    gstin: Mapped[str | None] = mapped_column(String(15))
    pan_last4: Mapped[str | None] = mapped_column(String(4))
    pan_enc: Mapped[str | None] = mapped_column(String(512))  # Fernet-encrypted full PAN (TDS 194-O)
    # individual | proprietorship | partnership | llp | company
    entity_type: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str] = mapped_column(String(80))
    contact_phone: Mapped[str] = mapped_column(String(20))
    contact_email: Mapped[str | None] = mapped_column(String(160))
    city: Mapped[str] = mapped_column(String(60), default="Kochi", server_default="Kochi")
    address: Mapped[str | None] = mapped_column(String(255))
    # pending → approved | rejected ; approved ↔ suspended
    status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending", index=True)
    status_reason: Mapped[str | None] = mapped_column(String(300))
    commission_bps: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    settlement_cycle: Mapped[str] = mapped_column(String(10), default="weekly", server_default="weekly")
    # Payout destination (never store full account numbers)
    bank_account_name: Mapped[str | None] = mapped_column(String(120))
    bank_account_last4: Mapped[str | None] = mapped_column(String(4))
    bank_ifsc: Mapped[str | None] = mapped_column(String(11))
    razorpay_account_id: Mapped[str | None] = mapped_column(String(40))  # Razorpay Route linked account
    kyc_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # e.g. while a bank-detail change awaits a second admin
    payouts_on_hold: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    reviewed_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    application: Mapped[dict] = mapped_column(JSONB, default=dict)  # venues/pitches submitted at signup
    notes: Mapped[str | None] = mapped_column(Text)  # internal (admin-only)

    members: Mapped[list["ProviderMember"]] = relationship(back_populates="provider", lazy="selectin")


class ProviderMember(TimestampMixin, Base):
    """A player-account (users row) acting for a provider in the partner portal."""

    __tablename__ = "provider_members"
    __table_args__ = (UniqueConstraint("provider_id", "user_id", name="uq_provider_members_provider_user"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    invited_phone: Mapped[str | None] = mapped_column(String(20))  # pending invite before first login
    role: Mapped[str] = mapped_column(String(10))  # owner | manager | staff
    status: Mapped[str] = mapped_column(String(10), default="active", server_default="active")  # invited|active|removed
    turf_ids: Mapped[list | None] = mapped_column(JSONB)  # optional venue scoping for staff (null = all)

    provider: Mapped[Provider] = relationship(back_populates="members", lazy="joined")
    user = relationship("User", lazy="joined")
