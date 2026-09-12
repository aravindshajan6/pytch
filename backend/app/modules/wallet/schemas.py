import uuid
from datetime import datetime
from typing import Literal

from app.core.schemas import Schema

WalletTxnKind = Literal["refund", "rain_check", "reimbursement", "dropout_credit", "spend", "bonus"]


class WalletTxnOut(Schema):
    id: uuid.UUID
    amount_paise: int
    kind: WalletTxnKind
    note: str
    balance_after_paise: int
    ref_type: str | None
    ref_id: uuid.UUID | None
    created_at: datetime


class WalletOut(Schema):
    balance_paise: int
    transactions: list[WalletTxnOut]
