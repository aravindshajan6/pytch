"""Import every model so SQLAlchemy's mapper registry and Alembic see the full schema."""

from app.db.base import Base
from app.modules.bench.models import BenchStatus, SOSDispatch, SOSRequest
from app.modules.bookings.models import Booking
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.highlights.models import Clip, ClipLike, Recording
from app.modules.lobbies.models import Lobby, LobbyMember, LobbyMessage
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment, WebhookEvent
from app.modules.ratings.models import MatchRating
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import PlayerStats, User
from app.modules.wallet.models import WalletTransaction
from app.modules.weather.models import WeatherAlert

__all__ = [
    "Base",
    "BenchStatus",
    "Booking",
    "Clip",
    "ClipLike",
    "Lobby",
    "LobbyMember",
    "LobbyMessage",
    "MatchRating",
    "Notification",
    "Payment",
    "Pitch",
    "PlayerStats",
    "Recording",
    "SOSDispatch",
    "SOSRequest",
    "Slot",
    "Turf",
    "User",
    "UserBadge",
    "WalletTransaction",
    "WeatherAlert",
    "WebhookEvent",
    "XpEvent",
]
