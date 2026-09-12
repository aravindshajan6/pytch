"""Import every model so SQLAlchemy's mapper registry and Alembic see the full schema."""

from app.db.base import Base
from app.modules.admin.models import AdminUser
from app.modules.audit.models import AuditLog
from app.modules.auth.models import AuthSession
from app.modules.bench.models import BenchStatus, SOSDispatch, SOSRequest
from app.modules.bookings.models import Booking
from app.modules.channels.models import (
    ChannelFeed,
    MirrorTask,
    ProviderApiKey,
    ProviderWebhook,
    SlotBlock,
    SyncConflict,
    WebhookDelivery,
)
from app.modules.coupons.models import Coupon, CouponRedemption
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.highlights.models import Clip, ClipLike, Recording
from app.modules.lobbies.models import Lobby, LobbyMember, LobbyMessage
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment, WebhookEvent
from app.modules.platform.models import AppSetting, Broadcast, SportCatalog
from app.modules.providers.models import Provider, ProviderMember
from app.modules.ratings.models import MatchRating
from app.modules.settlements.models import Settlement, SettlementLine
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import PlayerStats, User
from app.modules.wallet.models import WalletTransaction
from app.modules.weather.models import WeatherAlert

__all__ = [
    "AdminUser",
    "AppSetting",
    "AuditLog",
    "AuthSession",
    "Base",
    "Broadcast",
    "ChannelFeed",
    "MirrorTask",
    "Coupon",
    "CouponRedemption",
    "Provider",
    "ProviderApiKey",
    "ProviderMember",
    "ProviderWebhook",
    "Settlement",
    "SettlementLine",
    "SlotBlock",
    "SportCatalog",
    "SyncConflict",
    "WebhookDelivery",
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
