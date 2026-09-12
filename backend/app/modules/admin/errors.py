"""Admin-console error codes (`AdminErrorCode` in frontend/src/types/admin.ts)."""

from app.core.errors import AppError


class InvalidCredentials(AppError):
    code, status_code, message = "INVALID_CREDENTIALS", 401, "Email or password is incorrect"


class AccountLocked(AppError):
    code, status_code, message = "ACCOUNT_LOCKED", 423, "Too many failed attempts — try again later"


class InvalidMfaCode(AppError):
    code, status_code, message = "INVALID_MFA_CODE", 401, "That code is incorrect or was already used"


class CsrfFailed(AppError):
    code, status_code, message = "CSRF_FAILED", 403, "Security check failed — reload the page and try again"


class PasswordPolicy(AppError):
    code, status_code, message = "PASSWORD_POLICY", 400, "Choose a stronger password"


class PasswordChangeRequired(AppError):
    code, status_code, message = "PASSWORD_POLICY", 403, "Change your temporary password to continue"


class SelfApproval(AppError):
    code, status_code, message = "SELF_APPROVAL", 403, "A different admin must approve this"


class LastSuperAdmin(AppError):
    code, status_code, message = "LAST_SUPER_ADMIN", 409, "At least one active super admin must remain"
