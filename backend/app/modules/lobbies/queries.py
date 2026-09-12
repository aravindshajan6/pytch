"""Reusable SQL fragments about lobbies.

Low-level on purpose (imports only models) so turfs/slots can count "games forming here"
without importing the lobbies service.
"""

from datetime import datetime

from sqlalchemy import ColumnElement, func, or_, select

from app.core.constants import ACTIVE_MEMBER_STATUSES
from app.modules.lobbies.models import Lobby, LobbyMember

OPEN_LOBBY_STATUSES = ("forming", "confirmed")


def active_member_count() -> ColumnElement[int]:
    """Correlated scalar subquery: seats taken (joined + paid) in the enclosing `Lobby` row."""
    return (
        select(func.count(LobbyMember.id))
        .where(LobbyMember.lobby_id == Lobby.id, LobbyMember.status.in_(ACTIVE_MEMBER_STATUSES))
        .correlate(Lobby)
        .scalar_subquery()
    )


def joinable_filters(now: datetime) -> list[ColumnElement[bool]]:
    """WHERE clauses for a public lobby a stranger could join right now."""
    return [
        Lobby.visibility == "public",
        Lobby.status.in_(OPEN_LOBBY_STATUSES),
        Lobby.start_at > now,
        active_member_count() < Lobby.total_spots,
        # a forming lobby is only joinable while its payment window is open
        or_(Lobby.status == "confirmed", Lobby.pay_deadline.is_(None), Lobby.pay_deadline > now),
    ]
