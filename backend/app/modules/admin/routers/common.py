from typing import Annotated, Any

from fastapi import Depends

from app.modules.admin.deps import AdminContext, require_perm


def Perm(*perms: str, step_up: bool | None = None) -> Any:  # noqa: N802 — reads like a type in signatures
    """`ctx: Perm("payments.refund")` — RBAC (+ automatic step-up for sensitive permissions)."""
    return Annotated[AdminContext, Depends(require_perm(*perms, step_up=step_up))]
