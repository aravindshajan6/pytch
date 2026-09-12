from fastapi import APIRouter

from app.core.deps import DB, CurrentUser
from app.modules.wallet import service
from app.modules.wallet.schemas import WalletOut, WalletTxnOut

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("", response_model=WalletOut)
async def get_wallet(user: CurrentUser, db: DB) -> WalletOut:
    """Balance + the 50 most recent ledger entries."""
    rows = await service.recent_transactions(db, user.id, limit=50)
    credited, spent = await service.lifetime_totals(db, user.id)
    return WalletOut(
        balance_paise=await service.get_balance(db, user.id),
        total_credited_paise=credited,
        total_spent_paise=spent,
        transactions=[WalletTxnOut.model_validate(t) for t in rows],
    )
