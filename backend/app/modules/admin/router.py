"""Admin console API — `/api/v1/admin` (separate origin, admin signing key, see docs/PORTALS_CONTRACT.md §Admin).

Every business endpoint depends on `require_perm(...)` (RBAC + automatic step-up for sensitive
permissions); every mutation writes a hash-chained audit entry in its own transaction.
Security headers for these responses are added by `admin.security_headers.AdminSecurityHeaders`.
"""

from fastapi import APIRouter

from app.modules.admin.routers import analytics, auth, finance, payments, platform, providers, users

router = APIRouter(prefix="/admin")
for sub in (auth, analytics, users, providers, payments, finance, platform):
    router.include_router(sub.router)
