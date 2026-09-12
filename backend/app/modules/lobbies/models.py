import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class Lobby(TimestampMixin, Base):
    """The match room: members, payments progress, chat, teams."""

    __tablename__ = "lobbies"
    __table_args__ = (Index("ix_lobbies_visibility_status_start", "visibility", "status", "start_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), unique=True
    )
    slot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("slots.id"), index=True)
    pitch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pitches.id"), index=True)
    turf_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("turfs.id"), index=True)
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    sport: Mapped[str] = mapped_column(String(16), index=True)
    format: Mapped[str] = mapped_column(String(16))
    mode: Mapped[str] = mapped_column(String(8))  # split | full
    visibility: Mapped[str] = mapped_column(String(8))  # public | private
    # forming | confirmed | completed | expired | cancelled
    status: Mapped[str] = mapped_column(String(12), default="forming")
    total_spots: Mapped[int] = mapped_column(Integer)
    share_paise: Mapped[int] = mapped_column(Integer)
    pay_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    min_true_skill: Mapped[float | None] = mapped_column(Float)
    verified_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    recorded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    members: Mapped[list["LobbyMember"]] = relationship(
        back_populates="lobby", lazy="selectin", order_by="LobbyMember.joined_at"
    )
    host = relationship("User", lazy="joined", foreign_keys=[host_id])
    booking = relationship("Booking", lazy="joined", foreign_keys=[booking_id])
    pitch = relationship("Pitch", lazy="joined", foreign_keys=[pitch_id])
    turf = relationship("Turf", lazy="joined", foreign_keys=[turf_id])


class LobbyMember(Base):
    __tablename__ = "lobby_members"
    __table_args__ = (UniqueConstraint("lobby_id", "user_id", name="uq_lobby_members_lobby_user"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(8))  # host | player | sub
    status: Mapped[str] = mapped_column(String(8), default="joined")  # joined | paid | left | removed
    team: Mapped[str | None] = mapped_column(String(1))
    share_paise: Mapped[int] = mapped_column(Integer)  # owed for this seat, after discount
    paid_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    discount_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # dropout rule: credit received when a sub took over this seat
    compensated_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reserved_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sos_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sos_requests.id", ondelete="SET NULL", use_alter=True)
    )
    attended: Mapped[bool | None] = mapped_column(Boolean)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lobby: Mapped[Lobby] = relationship(back_populates="members")
    user = relationship("User", lazy="joined")


class LobbyMessage(CreatedAtMixin, Base):
    __tablename__ = "lobby_messages"
    __table_args__ = (Index("ix_lobby_messages_lobby_created", "lobby_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(8), default="chat")  # chat | system
    body: Mapped[str] = mapped_column(String(500))

    user = relationship("User", lazy="joined")
