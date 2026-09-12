import uuid

from sqlalchemy import Boolean, Float, ForeignKey, SmallInteger, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, uuid_pk


class MatchRating(CreatedAtMixin, Base):
    """Anonymous peer rating. Rater identity is never exposed through the API."""

    __tablename__ = "match_ratings"
    __table_args__ = (
        UniqueConstraint("lobby_id", "rater_id", "ratee_id", name="uq_match_ratings_triplet"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"), index=True
    )
    rater_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    ratee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    skill: Mapped[int] = mapped_column(SmallInteger)
    fair_play: Mapped[int] = mapped_column(SmallInteger)
    reliability: Mapped[int] = mapped_column(SmallInteger)
    showed_up: Mapped[bool] = mapped_column(Boolean, default=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list, server_default=text("'{}'"))
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    true_skill_after: Mapped[float | None] = mapped_column(Float)  # ratee snapshot → history chart
