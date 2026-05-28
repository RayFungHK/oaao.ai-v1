"""WS-1-S2 — file-backed platform / tenant orientation store."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.scope import (
    KnowledgeScopeRef,
    orientation_storage_slug,
)
from pydantic import ValidationError

logger = logging.getLogger(__name__)


def orientation_store_dir() -> Path:
    raw = (os.environ.get("OAAO_KNOWLEDGE_ORIENTATION_STORE_DIR") or "").strip()
    if raw:
        return Path(raw)
    return Path("/var/www/html/storage/orchestrator-knowledge-orientation")


def _scope_path(ref: KnowledgeScopeRef) -> Path:
    return orientation_store_dir() / f"{orientation_storage_slug(ref)}.json"


def _legacy_workspace_path(workspace_id: int) -> Path:
    return orientation_store_dir() / f"ws_{int(workspace_id)}.json"


def load_orientation_scoped(ref: KnowledgeScopeRef) -> OrientationJsonV1 | None:
    path = _scope_path(ref)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return OrientationJsonV1.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValidationError):
        return None


def load_orientation_platform() -> OrientationJsonV1 | None:
    return load_orientation_scoped(KnowledgeScopeRef(scope="platform"))


def load_orientation_tenant(tenant_id: int) -> OrientationJsonV1 | None:
    if tenant_id < 1:
        return None
    return load_orientation_scoped(KnowledgeScopeRef(scope="tenant", tenant_id=tenant_id))


def load_orientation(workspace_id: int) -> OrientationJsonV1 | None:
    """Legacy — per-workspace file only (pre-tenant migration). Prefer ``load_effective_orientation``."""
    path = _legacy_workspace_path(workspace_id)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return OrientationJsonV1.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValidationError):
        return None


def merge_orientation(
    prior: OrientationJsonV1 | None,
    patch: OrientationJsonV1,
) -> OrientationJsonV1:
    """Union list fields; prefer patch summary when non-empty."""
    if prior is None:
        return patch

    def _uniq(*lists: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for lst in lists:
            for item in lst:
                key = item.strip()
                if not key or key.lower() in seen:
                    continue
                seen.add(key.lower())
                out.append(key)
        return out

    return OrientationJsonV1(
        version=1,
        scope=patch.scope,
        tenant_id=patch.tenant_id,
        workspace_id=patch.workspace_id or prior.workspace_id,
        conversation_id=patch.conversation_id or prior.conversation_id,
        topics=_uniq(prior.topics, patch.topics)[:24],
        entities=_uniq(prior.entities, patch.entities)[:32],
        language=patch.language or prior.language,
        recency_days=patch.recency_days if patch.recency_days is not None else prior.recency_days,
        search_queries_suggested=_uniq(
            prior.search_queries_suggested,
            patch.search_queries_suggested,
        )[:12],
        do_not_search=_uniq(prior.do_not_search, patch.do_not_search)[:24],
        summary=(patch.summary or prior.summary)[:2000],
        updated_at=time.time(),
    )


def merge_orientation_layers(
    platform: OrientationJsonV1 | None,
    tenant: OrientationJsonV1 | None,
) -> OrientationJsonV1 | None:
    """Effective view: platform baseline merged with tenant overlay (tenant wins on conflicts)."""
    if platform is None and tenant is None:
        return None
    if platform is None:
        return tenant
    if tenant is None:
        return platform
    merged = merge_orientation(platform, tenant)
    merged.scope = "tenant"
    merged.tenant_id = tenant.tenant_id
    return merged


def load_effective_orientation(
    *,
    tenant_id: int | None = None,
    workspace_id: int | None = None,
) -> OrientationJsonV1 | None:
    """
    Resolved orientation for search / RAG — platform ⊕ tenant.

    ``workspace_id`` does not select a separate file; legacy ``ws_*.json`` is fallback only
    when no tenant row exists yet.
    """
    platform = load_orientation_platform()
    tenant = load_orientation_tenant(tenant_id) if tenant_id and tenant_id > 0 else None
    effective = merge_orientation_layers(platform, tenant)
    if effective is not None:
        if workspace_id and workspace_id > 0:
            effective.workspace_id = workspace_id
        return effective
    if workspace_id and workspace_id > 0:
        legacy = load_orientation(workspace_id)
        if legacy is not None:
            logger.debug(
                "orientation using legacy ws_%s.json — migrate to tenant_%s",
                workspace_id,
                tenant_id,
            )
            return legacy
    return platform


def save_orientation(orientation: OrientationJsonV1) -> None:
    root = orientation_store_dir()
    root.mkdir(parents=True, exist_ok=True)
    if orientation.scope == "platform":
        ref = KnowledgeScopeRef(scope="platform")
    else:
        if orientation.tenant_id is None or orientation.tenant_id < 1:
            raise ValueError("tenant scope requires tenant_id")
        ref = KnowledgeScopeRef(scope="tenant", tenant_id=orientation.tenant_id)
    payload = orientation.model_dump()
    payload["updated_at"] = time.time()
    _scope_path(ref).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
