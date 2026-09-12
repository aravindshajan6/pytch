"""Password hashing (argon2id) and policy for admin accounts."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# OWASP 2024+: argon2id, >= 19 MiB memory, t >= 2. We use 64 MiB, t=3, p=4.
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)

# A tiny deny-list; the length rule does most of the work.
_COMMON = {"password", "password123", "admin", "admin123", "qwerty", "letmein", "welcome", "pytch", "football"}

MIN_LENGTH = 12


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# Pre-computed hash used to equalise timing when the account doesn't exist.
DUMMY_HASH = _hasher.hash("pytch-timing-equaliser-not-a-password")


def password_problems(password: str, *, email: str | None = None) -> list[str]:
    """Human-readable reasons a password is rejected (empty list = acceptable)."""
    problems: list[str] = []
    if len(password) < MIN_LENGTH:
        problems.append(f"Use at least {MIN_LENGTH} characters")
    if len(password) > 128:
        problems.append("Use at most 128 characters")
    lowered = password.lower()
    if lowered in _COMMON or any(w in lowered for w in ("password", "qwerty", "123456")):
        problems.append("Avoid common passwords")
    if email and email.split("@")[0].lower() in lowered:
        problems.append("Don't include your email name")
    classes = sum([any(c.islower() for c in password), any(c.isupper() for c in password),
                   any(c.isdigit() for c in password), any(not c.isalnum() for c in password)])
    if classes < 3:
        problems.append("Mix at least three of: lowercase, uppercase, digits, symbols")
    return problems
