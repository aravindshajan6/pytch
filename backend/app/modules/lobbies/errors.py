"""Lobby/membership/payment-window errors (contract codes)."""

from app.core.errors import AppError, Forbidden


class LobbyFull(AppError):
    code, status_code, message = "LOBBY_FULL", 409, "This match is full"


class LobbyClosed(AppError):
    code, status_code, message = "LOBBY_CLOSED", 409, "This match is no longer open"


class AlreadyMember(AppError):
    code, status_code, message = "ALREADY_MEMBER", 409, "You're already in this match"


class NotMember(AppError):
    code, status_code, message = "NOT_MEMBER", 403, "You're not in this match"


class NotEligible(AppError):
    code, status_code, message = "NOT_ELIGIBLE", 403, "You don't meet this match's requirements"


class PaymentWindowClosed(AppError):
    code, status_code, message = "PAYMENT_WINDOW_CLOSED", 409, "The payment window for this seat has closed"


class AlreadyPaid(AppError):
    code, status_code, message = "ALREADY_PAID", 409, "This seat is already paid for"


class TooLate(AppError):
    code, status_code, message = "TOO_LATE", 409, "Too close to kick-off to cancel"


class NotHost(Forbidden):
    message = "Only the host can do that"
