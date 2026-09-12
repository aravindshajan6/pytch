import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class AdminUser(TimestampMixin, Base):
    """Admin console identity — deliberately separate from player/partner `users`.

    No self-signup: created via `python -m app.cli create-admin`. Password (argon2id) + mandatory TOTP.
    """

    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)  # stored lower-case
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20))  # super_admin | ops | finance | support | marketing | read_only
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    password_hash: Mapped[str] = mapped_column(String(255))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # MFA
    totp_secret_enc: Mapped[str | None] = mapped_column(String(512))  # Fernet-encrypted base32 seed
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_step: Mapped[int | None] = mapped_column(Integer)  # replay protection
    recovery_code_hashes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), default=list, server_default=text("'{}'")
    )
    # Lockout
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_ip: Mapped[str | None] = mapped_column(String(64))
    # the sign-in before `last_login_*` — what "Previous sign-in" shows (the current one is always "now")
    previous_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    previous_login_ip: Mapped[str | None] = mapped_column(String(64))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )


class ApprovalRequest(CreatedAtMixin, Base):
    """Maker–checker: a sensitive action requested by one admin and executed only after a *different*
    admin approves (large refunds, provider bank-detail changes, bulk refunds)."""

    __tablename__ = "approval_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    action: Mapped[str] = mapped_column(String(40), index=True)  # payment.refund | provider.bank_change | …
    target_type: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    summary: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending", index=True)
    # pending | approved (executed) | rejected | failed
    requested_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    requested_by_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL")
    )
    decided_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(String(300))
    result: Mapped[dict | None] = mapped_column(JSONB)
