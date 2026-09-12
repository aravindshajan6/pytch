import secrets

# No 0/O/1/I/L to keep codes readable when shared over WhatsApp.
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def short_code(length: int = 6) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def booking_code() -> str:
    return f"PY-{short_code(6)}"


def otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"
