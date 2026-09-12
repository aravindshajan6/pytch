import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(String(280))
    position: Mapped[str | None] = mapped_column(String(40))
    dominant_foot: Mapped[str | None] = mapped_column(String(8))
    self_skill_level: Mapped[str | None] = mapped_column(String(16))
    preferred_sports: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), default=list, server_default=text("'{}'")
    )
    home_lat: Mapped[float | None] = mapped_column(Float)
    home_lng: Mapped[float | None] = mapped_column(Float)
    home_area: Mapped[str | None] = mapped_column(String(80))
    wallet_balance_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    stats: Mapped["PlayerStats"] = relationship(
        back_populates="user", uselist=False, lazy="joined", cascade="all, delete-orphan"
    )


class PlayerStats(Base):
    """1:1 with users. Aggregates maintained by ratings/gamification/lobbies."""

    __tablename__ = "player_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # progression
    xp: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    level: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    streak_weeks: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_match_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # participation
    matches_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    matches_hosted: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    subs_made: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    dropouts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    no_shows: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # peer ratings (weighted sums → Bayesian averages)
    ratings_received: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ratings_given: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    distinct_raters: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    weight_sum: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    skill_wsum: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    fair_play_wsum: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    reliability_wsum: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    avg_skill: Mapped[float | None] = mapped_column(Float)
    avg_fair_play: Mapped[float | None] = mapped_column(Float)
    avg_reliability: Mapped[float | None] = mapped_column(Float)
    true_skill: Mapped[float | None] = mapped_column(Float, index=True)
    tier: Mapped[str] = mapped_column(String(16), default="rookie", server_default="rookie")
    is_verified_playmaker: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tag_counts: Mapped[dict[str, int]] = mapped_column(JSONB, default=dict, server_default=text("'{}'"))

    user: Mapped[User] = relationship(back_populates="stats")
