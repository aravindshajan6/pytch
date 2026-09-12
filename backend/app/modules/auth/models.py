import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, uuid_pk


class AuthSession(CreatedAtMixin, Base):
    """A login session for any audience (app / partner / admin).

    Refresh tokens rotate on every use; presenting an already-rotated refresh token (reuse)
    revokes the whole session. Access tokens carry `sid` and are rejected once revoked.
    """

    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_subject", "subject_type", "subject_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    subject_type: Mapped[str] = mapped_column(String(8))  # user | admin
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    audience: Mapped[str] = mapped_column(String(8))  # app | partner | admin
    current_refresh_jti: Mapped[str] = mapped_column(String(64))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # absolute lifetime
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(60))
    mfa_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # admin step-up
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
