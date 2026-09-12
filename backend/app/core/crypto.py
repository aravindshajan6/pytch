"""Field-level encryption for secrets stored in the database (TOTP seeds, feed URLs, webhook secrets).

Uses Fernet (AES-128-CBC + HMAC-SHA256). Production must set DATA_ENCRYPTION_KEY
(`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
"""

import base64
import hashlib
import hmac
import secrets
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


@lru_cache
def _fernet() -> Fernet:
    key = settings.data_encryption_key
    if not key:
        if settings.environment == "production":
            raise RuntimeError("DATA_ENCRYPTION_KEY must be set in production")
        key = base64.urlsafe_b64encode(hashlib.sha256(("pytch-dev:" + settings.jwt_secret).encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("cannot decrypt value (wrong DATA_ENCRYPTION_KEY?)") from exc


def keyed_hash(value: str) -> str:
    """Deterministic HMAC-SHA256 (hex) for API keys / recovery codes — lookup without storing plaintext."""
    return hmac.new(settings.api_key_pepper.encode(), value.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sign_payload(secret: str, body: bytes, timestamp: int) -> str:
    """Webhook signature: hex HMAC-SHA256 over `<timestamp>.<body>`."""
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
