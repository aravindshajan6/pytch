import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Applied by the migration (and by tests after create_all): the table is append-only.
AUDIT_APPEND_ONLY_DDL = [
    """
    CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    """,
    "DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;",
    """
    CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
    """,
]


class AuditLog(Base):
    """Tamper-evident log: rows are hash-chained (hash = sha256(prev_hash + canonical row)) and the
    table rejects UPDATE/DELETE at the database level."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_actor", "actor_type", "actor_id"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_type: Mapped[str] = mapped_column(String(10))  # admin | provider | system | user | api_key
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_label: Mapped[str] = mapped_column(String(160))  # e.g. "ops@pytch.in (ops)"
    action: Mapped[str] = mapped_column(String(60), index=True)  # e.g. "coupon.create"
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(300))
    changes: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"field": [old, new]} or payload
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), unique=True)
