"""Least-privilege RBAC for the admin console.

Endpoints declare what they need with `Depends(require_perm("payments.refund", step_up=True))`.
`step_up=True` additionally requires a TOTP entered within ADMIN_STEP_UP_MINUTES.
"""

from typing import Literal

AdminRole = Literal["super_admin", "ops", "finance", "support", "marketing", "read_only"]

PERMISSIONS: dict[str, str] = {
    "analytics.view": "View dashboards and reports",
    "users.view": "View players",
    "users.manage": "Suspend / ban / reinstate players",
    "wallet.adjust": "Grant or deduct Pytch Credits",
    "providers.view": "View service providers",
    "providers.manage": "Approve, reject, suspend providers; set commission",
    "venues.view": "View venues and pitches",
    "venues.manage": "Edit, feature, activate/deactivate venues",
    "bookings.view": "View bookings and lobbies",
    "bookings.manage": "Force-cancel bookings with refunds",
    "payments.view": "View payments, webhooks, reconciliation",
    "payments.refund": "Issue refunds",
    "payouts.view": "View settlements",
    "payouts.manage": "Generate, approve and pay settlements",
    "coupons.view": "View coupons",
    "coupons.manage": "Create / edit / disable coupons",
    "catalog.manage": "Manage sports & formats catalog",
    "broadcast.send": "Send announcements to players",
    "settings.view": "View platform settings",
    "settings.manage": "Change platform settings and kill switches",
    "audit.view": "View and verify the audit log",
    "admins.manage": "Manage admin accounts and their sessions",
    "approvals.decide": "Approve / reject maker–checker requests (another admin's refund, bank change)",
    "data.export": "Export data (CSV)",
}

_ALL = set(PERMISSIONS)

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "super_admin": _ALL,
    "ops": {
        "analytics.view", "users.view", "users.manage", "providers.view", "providers.manage", "venues.view",
        "venues.manage", "bookings.view", "bookings.manage", "coupons.view", "coupons.manage", "catalog.manage",
        "broadcast.send", "settings.view", "payments.view", "payouts.view", "audit.view",
    },
    "finance": {
        "analytics.view", "users.view", "providers.view", "venues.view", "bookings.view", "payments.view",
        "payments.refund", "payouts.view", "payouts.manage", "coupons.view", "wallet.adjust", "settings.view",
        "audit.view", "approvals.decide", "data.export",
    },
    "marketing": {
        "analytics.view", "coupons.view", "coupons.manage", "broadcast.send", "venues.view", "providers.view",
    },
    "read_only": {
        "analytics.view", "users.view", "providers.view", "venues.view", "bookings.view", "payments.view",
        "payouts.view", "coupons.view", "settings.view", "audit.view",
    },
    "support": {
        "users.view", "providers.view", "venues.view", "bookings.view", "payments.view", "coupons.view",
        "wallet.adjust",  # capped at SUPPORT_WALLET_CAP_PAISE per adjustment
    },
}

SUPPORT_WALLET_CAP_PAISE = 50000  # ₹500

# Actions that always need a fresh TOTP (step-up), regardless of role
APPROVALS_PERMISSION = "approvals.decide"  # finance/super_admin decide maker–checker requests

STEP_UP_ACTIONS = {
    "payments.refund", "payouts.manage", "wallet.adjust", "admins.manage", "settings.manage",
    "users.manage", "providers.manage", "bookings.manage", "approvals.decide", "data.export",
}


def has_perm(role: str, perm: str) -> bool:
    return perm in ROLE_PERMISSIONS.get(role, set())


def perms_for(role: str) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role, set()))
