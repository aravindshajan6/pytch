"""Player management: search, detail, moderation, credits adjustments, forced logout, CSV export."""

import csv
import io
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, BadRequest, Conflict, Forbidden, NotFound
from app.core.pagination import Page
from app.core.timeutils import ist_day_bounds, ist_today, utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.models import ApprovalRequest
from app.modules.admin.permissions import SUPPORT_WALLET_CAP_PAISE
from app.modules.admin.schemas import (
    AdminUserDetail,
    AdminUserRow,
    AdminUserStats,
    AdminWalletLine,
    ApprovalPending,
    SetUserStatus,
    WalletAdjust,
)
from app.modules.admin.services.common import (
    booking_row,
    booking_rows_query,
    count,
    csv_cell,
    like_term,
    payment_row,
    payment_rows_query,
    phone_match,
    show_phone,
)
from app.modules.auth import sessions
from app.modules.auth.models import AuthSession
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.payments.models import Payment
from app.modules.platform import service as platform
from app.modules.providers.models import ProviderMember
from app.modules.users.models import User
from app.modules.users.schemas import UserPublic
from app.modules.wallet import service as wallet
from app.modules.wallet.models import WalletTransaction

SUPPORT_DAILY_PER_PLAYER_PAISE = 1_000_00  # ₹1,000 of manual credits per player per IST day (support)
SUPPORT_DAILY_PER_ADMIN_PAISE = 5_000_00  # ₹5,000 granted per support admin per IST day
ADMIN_DAILY_UNAPPROVED_FACTOR = 4  # any admin: unapproved grants/day ≤ 4 × the dual-approval threshold
# ledger kind of manual admin credits/debits (player wallet shows "Adjustment", not "Bonus"/"Spent on a booking");
# rows written before it existed are `bonus` (credits) / `spend` (debits) with ref_type "admin"
ADJUSTMENT_KIND = "adjustment"
_LEGACY_ADMIN_CREDIT_KINDS = ("bonus", ADJUSTMENT_KIND)


async def _provider_member_ids(db: AsyncSession, user_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not user_ids:
        return set()
    rows = await db.scalars(
        select(ProviderMember.user_id).where(ProviderMember.user_id.in_(user_ids), ProviderMember.status == "active")
    )
    return set(rows.all())


def _row(user: User, pii: bool, members: set[uuid.UUID]) -> AdminUserRow:
    stats = user.stats
    return AdminUserRow(
        id=user.id, name=user.name, phone=show_phone(user.phone, pii), status=user.status,  # type: ignore[arg-type]
        home_area=user.home_area, level=stats.level if stats else 1,
        true_skill=round(stats.true_skill, 1) if stats and stats.true_skill is not None else None,
        matches_played=stats.matches_played if stats else 0, wallet_balance_paise=user.wallet_balance_paise,
        is_provider_member=user.id in members, created_at=user.created_at, last_seen_at=user.last_seen_at,
    )


def _search(q: str | None, status: str | None, pii: bool = False):
    stmt = select(User).where(User.is_bot.is_(False))
    if q:
        term = q.strip()
        like = like_term(term)
        conds = [User.name.ilike(like, escape="\\"), phone_match(User.phone, term, pii)]
        try:
            conds.append(User.id == uuid.UUID(term))
        except ValueError:
            pass
        stmt = stmt.where(or_(*conds))
    if status:
        stmt = stmt.where(User.status == status)
    return stmt


async def list_users(db: AsyncSession, ctx: AdminContext, *, q: str | None, status: str | None, limit: int,
                     offset: int) -> Page[AdminUserRow]:
    stmt = _search(q, status, ctx.sees_pii)
    total = await count(db, stmt)
    users = (await db.execute(stmt.order_by(User.created_at.desc(), User.id).limit(limit).offset(offset))) \
        .unique().scalars().all()
    members = await _provider_member_ids(db, [u.id for u in users])
    return Page(items=[_row(u, ctx.sees_pii, members) for u in users], total=total, limit=limit, offset=offset)


async def _get_user(db: AsyncSession, user_id: uuid.UUID, *, for_update: bool = False) -> User:
    stmt = select(User).where(User.id == user_id)
    if for_update:
        stmt = stmt.with_for_update(of=User).execution_options(populate_existing=True)
    user = (await db.execute(stmt)).unique().scalar_one_or_none()
    if user is None:
        raise NotFound("Player not found")
    return user


async def user_detail(db: AsyncSession, ctx: AdminContext, user_id: uuid.UUID) -> AdminUserDetail:
    user = await _get_user(db, user_id)
    pii = ctx.sees_pii
    members = await _provider_member_ids(db, [user.id])
    my_lobbies = select(LobbyMember.lobby_id).where(LobbyMember.user_id == user.id)
    bookings = (
        await db.execute(booking_rows_query().where(Lobby.id.in_(my_lobbies)).order_by(Lobby.start_at.desc()).limit(10))
    ).all()
    payments = (
        await db.execute(payment_rows_query().where(Payment.user_id == user.id)
                         .order_by(Payment.created_at.desc()).limit(10))
    ).all()
    txns = (
        await db.scalars(select(WalletTransaction).where(WalletTransaction.user_id == user.id)
                         .order_by(WalletTransaction.created_at.desc()).limit(20))
    ).all()
    active_sessions = await db.scalar(
        select(func.count()).select_from(AuthSession).where(
            AuthSession.subject_type == "user", AuthSession.subject_id == user.id, AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > utcnow())
    )
    stats = user.stats
    return AdminUserDetail(
        **_row(user, pii, members).model_dump(),
        public=UserPublic.from_user(user),
        status_reason=user.status_reason,
        suspended_until=user.suspended_until,
        stats=AdminUserStats(
            hosted=stats.matches_hosted if stats else 0, subs=stats.subs_made if stats else 0,
            dropouts=stats.dropouts if stats else 0, no_shows=stats.no_shows if stats else 0,
            ratings_received=stats.ratings_received if stats else 0,
        ),
        recent_bookings=[booking_row(r, pii) for r in bookings],
        recent_payments=[payment_row(r, pii) for r in payments],
        wallet=[AdminWalletLine(kind=t.kind, amount_paise=t.amount_paise, note=t.note, created_at=t.created_at)
                for t in txns],
        active_sessions=int(active_sessions or 0),
    )


async def set_status(db: AsyncSession, ctx: AdminContext, user_id: uuid.UUID, body: SetUserStatus) -> AdminUserDetail:
    user = await _get_user(db, user_id, for_update=True)
    if body.status == "suspended":
        if body.until is not None and body.until <= utcnow():
            raise BadRequest("A suspension must end in the future")
    before = {"status": user.status, "status_reason": user.status_reason, "suspended_until": user.suspended_until}
    user.status = body.status
    user.status_reason = None if body.status == "active" else body.reason
    user.suspended_until = body.until if body.status == "suspended" else None
    revoked = 0
    if body.status != "active":
        revoked = await sessions.revoke_all(db, subject_type="user", subject_id=user.id,
                                            reason=f"account_{body.status}")
    after = {"status": user.status, "status_reason": user.status_reason, "suspended_until": user.suspended_until}
    await audit(db, ctx, f"user.{'reinstate' if body.status == 'active' else body.status}",
                f"{user.name}: {before['status']} → {body.status} — {body.reason}", target_type="user",
                target_id=user.id, changes={**_diff(before, after), "reason": body.reason, "sessions_revoked": revoked})
    await db.commit()
    return await user_detail(db, ctx, user.id)


def _diff(before: dict, after: dict) -> dict:
    return {k: [before[k], after[k]] for k in after if before.get(k) != after.get(k)}


class DailyCapReached(AppError):
    code, status_code, message = "LIMIT_REACHED", 409, "Daily credit limit reached"


async def _admin_credits_today(db: AsyncSession, *, user_id: uuid.UUID | None = None,
                               admin_id: uuid.UUID | None = None) -> int:
    """Manual admin credits granted today (IST) to a player / by an admin without a second approval."""
    day_start, _ = ist_day_bounds(ist_today())
    stmt = select(func.coalesce(func.sum(WalletTransaction.amount_paise), 0)).where(
        WalletTransaction.ref_type == "admin", WalletTransaction.kind.in_(_LEGACY_ADMIN_CREDIT_KINDS),
        WalletTransaction.amount_paise > 0, WalletTransaction.created_at >= day_start)
    if user_id is not None:
        stmt = stmt.where(WalletTransaction.user_id == user_id)
    if admin_id is not None:
        stmt = stmt.where(WalletTransaction.ref_id == admin_id)
    return int(await db.scalar(stmt) or 0)


async def lock_player(db: AsyncSession, user_id: uuid.UUID) -> User:
    return await _get_user(db, user_id, for_update=True)


async def apply_wallet_adjust(
    db: AsyncSession, ctx: AdminContext, user: User, amount_paise: int, reason: str, *,
    approval_id: uuid.UUID | None = None, maker_id: uuid.UUID | None = None,
) -> WalletTransaction:
    """Move the credits + audit + notify (no commit). `maker_id` = the admin who asked (approved requests)."""
    before = user.wallet_balance_paise
    note = f"Pytch support: {reason}"
    ref_id = maker_id or ctx.admin.id
    if amount_paise > 0:
        # approved credits are tagged apart so they don't eat into the daily *unapproved* budgets
        ref_type = "admin_approved" if approval_id is not None else "admin"
        txn = await wallet.credit(db, user.id, amount_paise, ADJUSTMENT_KIND, note, ref_type=ref_type, ref_id=ref_id)
    else:
        txn = await wallet.debit(db, user.id, -amount_paise, note, kind=ADJUSTMENT_KIND, ref_type="admin",
                                 ref_id=ref_id)
    changes = {"wallet_balance_paise": [before, txn.balance_after_paise], "amount_paise": amount_paise,
               "reason": reason}
    if approval_id is not None:
        changes["approval_id"] = str(approval_id)
    await audit(db, ctx, "wallet.adjust", f"{'Credited' if amount_paise > 0 else 'Debited'} "
                f"₹{abs(amount_paise) / 100:,.2f} — {user.name}: {reason}"
                + (" (approved request)" if approval_id else ""), target_type="user", target_id=user.id,
                changes=changes)
    if amount_paise > 0:
        from app.modules.notifications.service import notify

        await notify(db, user.id, "wallet_credit", f"₹{amount_paise / 100:,.0f} added to your wallet",
                     reason, {"url": "/app/wallet"})
    return txn


async def adjust_wallet(
    db: AsyncSession, ctx: AdminContext, user_id: uuid.UUID, body: WalletAdjust
) -> AdminUserDetail | ApprovalPending:
    """Grant / deduct credits (SEC2-10).

    * support: ≤ ₹500 per adjustment, and credits ≤ SUPPORT_DAILY_PER_PLAYER_PAISE per player per IST day
      (all manual credits count) and ≤ SUPPORT_DAILY_PER_ADMIN_PAISE per support admin per day → 409 LIMIT_REACHED.
    * any role: a credit that takes the player's manual credits today above `refund_dual_approval_paise`, or the
      admin's own unapproved grants today above ADMIN_DAILY_UNAPPROVED_FACTOR × that threshold, becomes an
      `ApprovalRequest(wallet.adjust)` (202) executed when a *different* admin approves it — so one large credit
      can't be split into several small ones to dodge the second pair of eyes.
    """
    amount = body.amount_paise
    if ctx.admin.role == "support" and abs(amount) > SUPPORT_WALLET_CAP_PAISE:
        raise Forbidden(f"Support can adjust at most ₹{SUPPORT_WALLET_CAP_PAISE // 100} per adjustment",
                        details={"cap_paise": SUPPORT_WALLET_CAP_PAISE})
    if amount > 0:  # serialize this admin's grants for the daily totals
        await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"wallet-adjust:{ctx.admin.id}"))))
    user = await lock_player(db, user_id)  # serializes adjustments to this player
    if amount > 0:
        threshold = await platform.get_setting("refund_dual_approval_paise", db)
        player_today = await _admin_credits_today(db, user_id=user.id)
        mine_today = await _admin_credits_today(db, admin_id=ctx.admin.id)
        if (amount > threshold or player_today + amount > threshold
                or mine_today + amount > threshold * ADMIN_DAILY_UNAPPROVED_FACTOR):
            return await _request_wallet_approval(db, ctx, user, amount, body.reason, threshold)
        if ctx.admin.role == "support":
            if player_today + amount > SUPPORT_DAILY_PER_PLAYER_PAISE:
                raise DailyCapReached(
                    f"This player can get at most ₹{SUPPORT_DAILY_PER_PLAYER_PAISE // 100:,} of manual credits a day "
                    f"(₹{player_today / 100:,.0f} already today) — ask finance",
                    details={"cap_paise": SUPPORT_DAILY_PER_PLAYER_PAISE, "credited_today_paise": player_today})
            if mine_today + amount > SUPPORT_DAILY_PER_ADMIN_PAISE:
                raise DailyCapReached(
                    f"You can grant at most ₹{SUPPORT_DAILY_PER_ADMIN_PAISE // 100:,} of credits a day "
                    f"(₹{mine_today / 100:,.0f} already today) — ask finance",
                    details={"cap_paise": SUPPORT_DAILY_PER_ADMIN_PAISE, "credited_today_paise": mine_today})
    await apply_wallet_adjust(db, ctx, user, amount, body.reason)
    await db.commit()
    return await user_detail(db, ctx, user.id)


async def _request_wallet_approval(
    db: AsyncSession, ctx: AdminContext, user: User, amount: int, reason: str, threshold: int
) -> ApprovalPending:
    pending = await db.scalar(select(func.count()).select_from(ApprovalRequest).where(
        ApprovalRequest.action == "wallet.adjust", ApprovalRequest.target_id == str(user.id),
        ApprovalRequest.status == "pending"))
    if pending:
        raise Conflict("A credit for this player is already awaiting approval")
    approval = ApprovalRequest(
        id=uuid.uuid4(), action="wallet.adjust", target_type="user", target_id=str(user.id),
        payload={"amount_paise": amount, "reason": reason, "direction": "credit", "player_name": user.name,
                 "balance_paise": user.wallet_balance_paise},
        summary=f"Credit ₹{amount / 100:,.2f} to {user.name} — {reason}"[:300],
        status="pending", requested_by_admin_id=ctx.admin.id, created_at=utcnow(),
    )
    db.add(approval)
    await db.flush([approval])
    await audit(db, ctx, "approval.request", f"Requested approval: {approval.summary}", target_type="user",
                target_id=user.id, changes={"approval_id": str(approval.id), "amount_paise": amount, "reason": reason,
                                            "threshold_paise": threshold})
    await db.commit()
    return ApprovalPending(approval_id=approval.id,
                           message="Credits above the threshold need a second admin — request queued")


async def logout_all(db: AsyncSession, ctx: AdminContext, user_id: uuid.UUID) -> int:
    user = await _get_user(db, user_id)
    revoked = await sessions.revoke_all(db, subject_type="user", subject_id=user.id, reason="admin_logout_all")
    await audit(db, ctx, "user.logout_all", f"Signed {user.name} out everywhere", target_type="user",
                target_id=user.id, changes={"sessions_revoked": revoked})
    await db.commit()
    return revoked


async def export_csv(db: AsyncSession, ctx: AdminContext, *, q: str | None, status: str | None) -> str:
    """Full player list (PII) — `data.export` + step-up, and the export itself is audited."""
    stmt = _search(q, status, ctx.sees_pii).order_by(User.created_at)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "name", "phone", "status", "home_area", "wallet_balance_paise", "created_at", "last_seen_at"])
    n = 0
    for user in (await db.execute(stmt)).unique().scalars():
        w.writerow([csv_cell(v) for v in (
            str(user.id), user.name, user.phone, user.status, user.home_area or "", user.wallet_balance_paise,
            user.created_at.isoformat(), user.last_seen_at.isoformat() if user.last_seen_at else "")])
        n += 1
    await audit(db, ctx, "user.export", f"Exported {n} players to CSV", target_type="user",
                changes={"q": q, "status": status, "rows": n})
    await db.commit()
    return buf.getvalue()

