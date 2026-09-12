"""Admin accounts (team). Shared with the CLI (`python -m app.cli`)."""

import asyncio
import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.core.passwords import hash_password, password_problems
from app.core.timeutils import utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.errors import LastSuperAdmin
from app.modules.admin.models import AdminUser
from app.modules.admin.permissions import ROLE_PERMISSIONS
from app.modules.admin.schemas import (
    AdminAccountOut,
    CreateAdminRequest,
    CreatedAdmin,
    ResetPasswordResult,
    UpdateAdminRequest,
)
from app.modules.auth import sessions

_ALPHABETS = ("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_=+?")


def temporary_password(length: int = 20) -> str:
    """Strong random password satisfying the policy (all four character classes)."""
    while True:
        chars = [secrets.choice(a) for a in _ALPHABETS]
        pool = "".join(_ALPHABETS)
        chars += [secrets.choice(pool) for _ in range(length - len(chars))]
        secrets.SystemRandom().shuffle(chars)
        pw = "".join(chars)
        if not password_problems(pw):
            return pw


def account_out(a: AdminUser) -> AdminAccountOut:
    return AdminAccountOut(
        id=a.id, email=a.email, name=a.name, role=a.role,  # type: ignore[arg-type]
        is_active=a.is_active, mfa_enrolled=a.totp_enabled_at is not None, last_login_at=a.last_login_at,
        locked=a.locked_until is not None and a.locked_until > utcnow(), created_at=a.created_at,
    )


async def new_admin(
    db: AsyncSession, *, email: str, name: str, role: str, password: str | None, created_by: uuid.UUID | None
) -> tuple[AdminUser, str]:
    """Create an admin with a temporary password (must change at first login; MFA enrollment forced).
    Caller audits and commits."""
    if role not in ROLE_PERMISSIONS:
        raise Conflict(f"Unknown role {role}")
    email = email.strip().lower()
    temp = password or temporary_password()
    problems = password_problems(temp, email=email)
    if problems:
        from app.modules.admin.errors import PasswordPolicy

        raise PasswordPolicy(problems[0], details={"problems": problems})
    now = utcnow()
    admin = AdminUser(
        id=uuid.uuid4(), email=email, name=name.strip(), role=role, is_active=True,
        password_hash=await asyncio.to_thread(hash_password, temp), must_change_password=True,
        recovery_code_hashes=[], failed_logins=0, created_by_id=created_by, created_at=now, updated_at=now,
    )
    db.add(admin)
    try:
        await db.flush([admin])
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("An admin with this email already exists") from exc
    return admin, temp


async def list_team(db: AsyncSession) -> list[AdminAccountOut]:
    return [account_out(a) for a in (await db.scalars(select(AdminUser).order_by(AdminUser.created_at))).all()]


async def create(db: AsyncSession, ctx: AdminContext, body: CreateAdminRequest) -> CreatedAdmin:
    admin, temp = await new_admin(db, email=body.email, name=body.name, role=body.role, password=None,
                                  created_by=ctx.admin.id)
    await audit(db, ctx, "admin.create", f"Created admin {admin.email} ({admin.role})", target_type="admin",
                target_id=admin.id, changes={"email": [None, admin.email], "role": [None, admin.role]})
    await db.commit()
    return CreatedAdmin(admin=account_out(admin), temporary_password=temp)


async def _lock(db: AsyncSession, admin_id: uuid.UUID) -> AdminUser:
    admin = await db.scalar(select(AdminUser).where(AdminUser.id == admin_id).with_for_update()
                            .execution_options(populate_existing=True))
    if admin is None:
        raise NotFound("Admin not found")
    return admin


async def _other_active_supers(db: AsyncSession, admin_id: uuid.UUID) -> int:
    # lock every super_admin row so two concurrent demotions can't both pass the check
    rows = (await db.scalars(select(AdminUser.id).where(AdminUser.role == "super_admin",
                                                        AdminUser.is_active.is_(True)).with_for_update())).all()
    return len([r for r in rows if r != admin_id])


async def update(db: AsyncSession, ctx: AdminContext, admin_id: uuid.UUID, body: UpdateAdminRequest) -> AdminAccountOut:
    if admin_id == ctx.admin.id:
        raise Forbidden("You can't change your own role or deactivate yourself")
    target = await _lock(db, admin_id)
    patch = body.model_dump(exclude_unset=True, exclude_none=True)
    loses_super = target.role == "super_admin" and target.is_active and (
        patch.get("role", "super_admin") != "super_admin" or patch.get("is_active") is False)
    if loses_super and await _other_active_supers(db, target.id) == 0:
        raise LastSuperAdmin()
    before = {"role": target.role, "is_active": target.is_active}
    for k, v in patch.items():
        setattr(target, k, v)
    revoked = 0
    if before != {"role": target.role, "is_active": target.is_active}:
        revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=target.id, reason="admin_updated",
                                            audience="admin")
    changes = {k: [before[k], getattr(target, k)] for k in before if before[k] != getattr(target, k)}
    if changes:
        await audit(db, ctx, "admin.update", f"Updated admin {target.email}", target_type="admin",
                    target_id=target.id, changes={**changes, "sessions_revoked": revoked})
    await db.commit()
    return account_out(target)


async def reset_mfa(db: AsyncSession, ctx: AdminContext, admin_id: uuid.UUID) -> AdminAccountOut:
    if admin_id == ctx.admin.id:
        raise Forbidden("Another admin must reset your two-factor authentication")
    target = await _lock(db, admin_id)
    target.totp_secret_enc = None
    target.totp_enabled_at = None
    target.totp_last_step = None
    target.recovery_code_hashes = []
    revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=target.id, reason="mfa_reset",
                                        audience="admin")
    await audit(db, ctx, "admin.reset_mfa", f"Reset two-factor authentication for {target.email}",
                target_type="admin", target_id=target.id, changes={"sessions_revoked": revoked})
    await db.commit()
    return account_out(target)


async def reset_password(db: AsyncSession, ctx: AdminContext, admin_id: uuid.UUID) -> ResetPasswordResult:
    """Super admin only (never on yourself): a new temporary password, shown once. The admin must change it at
    the next sign-in (their authenticator stays enrolled — "Reset two-factor" is separate); every session is
    revoked and a lockout is cleared."""
    if ctx.admin.role != "super_admin":
        raise Forbidden("Only a super admin can reset another admin's password")
    if admin_id == ctx.admin.id:
        raise Forbidden("Change your own password in My account")
    target = await _lock(db, admin_id)
    temp = temporary_password()
    target.password_hash = await asyncio.to_thread(hash_password, temp)
    target.must_change_password = True
    target.failed_logins = 0
    target.locked_until = None
    revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=target.id, reason="password_reset",
                                        audience="admin")
    await audit(db, ctx, "admin.reset_password", f"Reset the password of {target.email} (temporary password issued)",
                target_type="admin", target_id=target.id,
                changes={"must_change_password": True, "sessions_revoked": revoked})
    await db.commit()
    return ResetPasswordResult(admin=account_out(target), temporary_password=temp, sessions_revoked=revoked)


async def revoke_sessions(db: AsyncSession, ctx: AdminContext, admin_id: uuid.UUID) -> int:
    target = await _lock(db, admin_id)
    revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=target.id, reason="revoked_by_admin",
                                        audience="admin",
                                        except_session=ctx.session.id if target.id == ctx.admin.id else None)
    await audit(db, ctx, "admin.revoke_sessions", f"Revoked {revoked} session(s) of {target.email}",
                target_type="admin", target_id=target.id, changes={"sessions_revoked": revoked})
    await db.commit()
    return revoked


async def count_admins(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count()).select_from(AdminUser)) or 0)
