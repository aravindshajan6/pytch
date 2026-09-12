"""Operator CLI (bootstrap only — there is no admin self-signup).

    python -m app.cli create-admin --email ops@pytch.in --name "Ops Lead" --role super_admin [--password …]
    python -m app.cli reset-admin-mfa --email ops@pytch.in
    python -m app.cli list-admins

`create-admin` prints a strong temporary password when none is given; the new admin must change it
and enrol TOTP at first login. Every change is written to the audit log (actor_type=system).
"""

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

import app.db.models  # noqa: F401  (register all mappers)
from app.core.database import SessionLocal, engine
from app.core.errors import AppError
from app.core.redis import close_redis
from app.modules.admin.models import AdminUser
from app.modules.admin.permissions import ROLE_PERMISSIONS
from app.modules.audit import service as audit_service
from app.modules.auth import sessions


def _operator() -> str:
    try:
        return f"cli ({getpass.getuser()})"
    except Exception:
        return "cli"


_ACTOR = _operator()


async def _audit(db, action: str, summary: str, admin: AdminUser, changes: dict | None = None) -> None:
    await audit_service.record(db, actor_type="system", actor_id=None, actor_label=_ACTOR, action=action,
                               summary=summary, target_type="admin", target_id=admin.id, changes=changes)


async def create_admin(email: str, name: str, role: str, password: str | None) -> int:
    from app.modules.admin.services.team import new_admin

    async with SessionLocal() as db:
        try:
            admin, temp = await new_admin(db, email=email, name=name, role=role, password=password, created_by=None)
        except AppError as exc:
            print(f"error: {exc.message} {exc.details or ''}", file=sys.stderr)
            return 1
        await _audit(db, "admin.create", f"Created admin {admin.email} ({admin.role}) via CLI", admin,
                     {"email": [None, admin.email], "role": [None, admin.role]})
        await db.commit()
    print(f"Created {admin.email} ({admin.role}).")
    if password is None:
        print(f"Temporary password (shown once): {temp}")
    print("They must change the password and set up two-factor authentication at first login.")
    return 0


async def reset_admin_mfa(email: str) -> int:
    async with SessionLocal() as db:
        admin = await db.scalar(select(AdminUser).where(AdminUser.email == email.strip().lower()).with_for_update())
        if admin is None:
            print("error: no such admin", file=sys.stderr)
            return 1
        admin.totp_secret_enc = None
        admin.totp_enabled_at = None
        admin.totp_last_step = None
        admin.recovery_code_hashes = []
        revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=admin.id, reason="mfa_reset",
                                            audience="admin")
        await _audit(db, "admin.reset_mfa", f"Reset two-factor authentication for {admin.email} via CLI", admin,
                     {"sessions_revoked": revoked})
        await db.commit()
    print(f"MFA reset for {email}; {revoked} session(s) revoked. They'll enrol again at next login.")
    return 0


async def list_admins() -> int:
    async with SessionLocal() as db:
        admins = (await db.scalars(select(AdminUser).order_by(AdminUser.created_at))).all()
    print(f"{'email':40} {'role':12} {'active':7} {'mfa':5} {'last login'}")
    for a in admins:
        print(f"{a.email:40} {a.role:12} {str(a.is_active):7} {str(a.totp_enabled_at is not None):5} "
              f"{a.last_login_at.isoformat() if a.last_login_at else '-'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="PYTCH operator commands")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="create an admin console account")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--role", required=True, choices=sorted(ROLE_PERMISSIONS))
    p.add_argument("--password", help="omit to generate a strong temporary password")
    p = sub.add_parser("reset-admin-mfa", help="clear an admin's TOTP + recovery codes (re-enrol at next login)")
    p.add_argument("--email", required=True)
    sub.add_parser("list-admins", help="list admin accounts")
    args = parser.parse_args(argv)

    async def run() -> int:
        try:
            if args.cmd == "create-admin":
                return await create_admin(args.email, args.name, args.role, args.password)
            if args.cmd == "reset-admin-mfa":
                return await reset_admin_mfa(args.email)
            return await list_admins()
        finally:
            await close_redis()
            await engine.dispose()

    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
