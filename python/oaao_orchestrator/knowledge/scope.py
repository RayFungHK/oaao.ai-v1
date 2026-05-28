"""Knowledge plane scope — platform / tenant global assets (workspace = attribution only)."""

from __future__ import annotations

import os
from typing import Any, Literal

from pydantic import BaseModel, Field

KnowledgeScope = Literal["platform", "tenant"]


class KnowledgeScopeRef(BaseModel):
    """Primary persistence key for orientation + web assets."""

    scope: KnowledgeScope = "tenant"
    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(
        default=None,
        ge=1,
        description="Optional — last contributing workspace (not the catalog partition).",
    )


def parse_tenant_id(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        tid = int(raw)
        return tid if tid > 0 else None
    except (TypeError, ValueError):
        return None


def parse_workspace_id(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        wid = int(raw)
        return wid if wid > 0 else None
    except (TypeError, ValueError):
        return None


def scope_ref_from_request(req: Any) -> KnowledgeScopeRef | None:
    """Resolve write scope — platform evolution catalog (tenant id is attribution only)."""
    workspace_id = parse_workspace_id(getattr(req, "workspace_id", None))
    knowledge = getattr(req, "knowledge", None)
    if isinstance(knowledge, dict):
        forced = str(knowledge.get("scope") or "").strip().lower()
        if forced == "tenant":
            kt = parse_tenant_id(knowledge.get("tenant_id")) or parse_tenant_id(
                getattr(req, "tenant_id", None)
            )
            if kt:
                return KnowledgeScopeRef(scope="tenant", tenant_id=kt, workspace_id=workspace_id)
        if forced == "platform" or forced == "":
            if platform_knowledge_enabled():
                return KnowledgeScopeRef(scope="platform", workspace_id=workspace_id)
    if platform_knowledge_enabled():
        return KnowledgeScopeRef(scope="platform", workspace_id=workspace_id)
    tenant_id = parse_tenant_id(getattr(req, "tenant_id", None))
    if tenant_id:
        return KnowledgeScopeRef(scope="tenant", tenant_id=tenant_id, workspace_id=workspace_id)
    return None


def platform_knowledge_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_PLATFORM_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def orientation_storage_slug(ref: KnowledgeScopeRef) -> str:
    if ref.scope == "platform":
        return "platform"
    assert ref.tenant_id is not None
    return f"tenant_{ref.tenant_id}"


def asset_storage_dir_name(ref: KnowledgeScopeRef) -> str:
    return orientation_storage_slug(ref)
