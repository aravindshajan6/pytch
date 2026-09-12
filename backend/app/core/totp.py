"""TOTP (RFC 6238) MFA helpers + one-time recovery codes."""

import secrets
import time

import pyotp

from app.core.config import settings
from app.core.crypto import keyed_hash

STEP = 30
VALID_WINDOW = 1  # accept ±1 step (≈ ±30 s clock skew)


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret, interval=STEP).provisioning_uri(name=account, issuer_name=settings.admin_totp_issuer)


def verify(secret: str, code: str, *, last_used_step: int | None = None) -> int | None:
    """Return the matched time-step (store it to block replay) or None if invalid/replayed."""
    code = code.strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return None
    totp = pyotp.TOTP(secret, interval=STEP)
    now_step = int(time.time()) // STEP
    for offset in range(-VALID_WINDOW, VALID_WINDOW + 1):
        step = now_step + offset
        if secrets.compare_digest(totp.at(step * STEP), code):
            if last_used_step is not None and step <= last_used_step:
                return None  # replay of an already-used code
            return step
    return None


def new_recovery_codes(n: int = 10) -> list[str]:
    """Plaintext codes shown once, e.g. 'K7QX-2MPD-9TRF'."""
    alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
    return ["-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)) for _ in range(n)]


def hash_recovery_code(code: str) -> str:
    return keyed_hash("recovery:" + code.strip().upper().replace(" ", ""))
