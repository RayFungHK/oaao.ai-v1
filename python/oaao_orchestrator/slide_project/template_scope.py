"""Slide template visibility — global, tenant, personal."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

TemplateScopeLevel = Literal["global", "tenant", "personal"]

SCOPES: frozenset[str] = frozenset({"global", "tenant", "personal"})


@dataclass(frozen=True)
class TemplateScopeContext:
    user_id: int
    tenant_id: int | None = None
    is_platform_operator: bool = False
    is_tenant_admin: bool = False

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> TemplateScopeContext:
        if not isinstance(raw, dict):
            return cls(user_id=0)
        uid = int(raw.get("user_id") or 0)
        tid_raw = raw.get("tenant_id")
        tid = int(tid_raw) if tid_raw is not None and str(tid_raw).strip().isdigit() else None
        if tid is not None and tid < 1:
            tid = None
        return cls(
            user_id=max(0, uid),
            tenant_id=tid,
            is_platform_operator=bool(raw.get("is_platform_operator")),
            is_tenant_admin=bool(raw.get("is_tenant_admin")),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "tenant_id": self.tenant_id,
            "is_platform_operator": self.is_platform_operator,
            "is_tenant_admin": self.is_tenant_admin,
        }


def normalize_scope(
    raw: str | None, *, default: TemplateScopeLevel = "personal"
) -> TemplateScopeLevel:
    s = (raw or "").strip().lower()
    if s in SCOPES:
        return s  # type: ignore[return-value]
    return default


def can_write_scope(ctx: TemplateScopeContext, scope: TemplateScopeLevel) -> bool:
    if scope == "global":
        return ctx.is_platform_operator
    if scope == "tenant":
        return (
            ctx.is_tenant_admin
            and ctx.tenant_id is not None
            and ctx.tenant_id > 0
            and ctx.user_id > 0
        )
    return ctx.user_id > 0


def partition_ids(
    ctx: TemplateScopeContext,
    scope: TemplateScopeLevel,
) -> tuple[TemplateScopeLevel, int | None, int | None]:
    if scope == "global":
        return "global", None, None
    if scope == "tenant":
        return "tenant", ctx.tenant_id, None
    return "personal", ctx.tenant_id, ctx.user_id


def can_read_template(ctx: TemplateScopeContext, row: dict[str, Any]) -> bool:
    scope = normalize_scope(str(row.get("scope") or "personal"))
    status = str(row.get("status") or "draft")
    owner = int(row.get("owner_user_id") or row.get("created_by") or 0)
    tid = row.get("tenant_id")
    row_tid = int(tid) if tid is not None and str(tid).strip().isdigit() else None

    if scope == "global":
        if status == "published":
            return True
        return ctx.is_platform_operator or owner == ctx.user_id

    if scope == "tenant":
        if row_tid is None or ctx.tenant_id is None or row_tid != ctx.tenant_id:
            return False
        if status == "published":
            return True
        return owner == ctx.user_id or ctx.is_platform_operator

    if owner != ctx.user_id:  # noqa: SIM103
        return False
    return True
