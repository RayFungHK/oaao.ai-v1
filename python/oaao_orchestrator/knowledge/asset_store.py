"""WS-1-S4 — platform / tenant web knowledge asset file store."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

from oaao_orchestrator.knowledge.asset_models import WebKnowledgeAssetV1, WebKnowledgeHitV1
from oaao_orchestrator.knowledge.scope import (
    KnowledgeScopeRef,
    asset_storage_dir_name,
    scope_ref_from_request,
)
from pydantic import ValidationError

logger = logging.getLogger(__name__)


def asset_store_dir() -> Path:
    raw = (os.environ.get("OAAO_KNOWLEDGE_ASSET_STORE_DIR") or "").strip()
    if raw:
        return Path(raw)
    return Path("/var/www/html/storage/orchestrator-knowledge-assets")


def _catalog_dir(ref: KnowledgeScopeRef) -> Path:
    return asset_store_dir() / asset_storage_dir_name(ref)


def _asset_path(ref: KnowledgeScopeRef, asset_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in asset_id.strip())
    return _catalog_dir(ref) / f"{safe}.json"


def _find_asset_path(asset_id: str) -> Path | None:
    root = asset_store_dir()
    if not root.is_dir():
        return None
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in asset_id.strip())
    direct = root / f"{safe}.json"
    if direct.is_file():
        return direct
    for path in root.rglob(f"{safe}.json"):
        if path.is_file():
            return path
    return None


def content_hash_for_hits(hits: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        parts.append(f"{h.get('url','')}|{h.get('title','')}|{h.get('snippet','')[:200]}")
    blob = "\n".join(sorted(parts))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def load_asset(asset_id: str) -> WebKnowledgeAssetV1 | None:
    path = _find_asset_path(asset_id)
    if path is None:
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return WebKnowledgeAssetV1.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValidationError):
        return None


def save_asset(asset: WebKnowledgeAssetV1) -> None:
    if asset.scope == "platform":
        ref = KnowledgeScopeRef(scope="platform")
    else:
        if asset.tenant_id is None or asset.tenant_id < 1:
            raise ValueError("tenant asset requires tenant_id")
        ref = KnowledgeScopeRef(scope="tenant", tenant_id=asset.tenant_id)
    catalog = _catalog_dir(ref)
    catalog.mkdir(parents=True, exist_ok=True)
    payload = asset.model_dump()
    payload["created_at"] = asset.created_at or time.time()
    _asset_path(ref, asset.asset_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _iter_catalog(ref: KnowledgeScopeRef) -> list[Path]:
    catalog = _catalog_dir(ref)
    if not catalog.is_dir():
        return []
    return sorted(catalog.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)


def list_scoped_assets(ref: KnowledgeScopeRef, *, limit: int = 50) -> list[WebKnowledgeAssetV1]:
    out: list[WebKnowledgeAssetV1] = []
    for path in _iter_catalog(ref):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            out.append(WebKnowledgeAssetV1.model_validate(raw))
        except (OSError, json.JSONDecodeError, ValidationError):
            continue
        if len(out) >= limit:
            break
    return out


def list_tenant_assets(tenant_id: int, *, limit: int = 50) -> list[WebKnowledgeAssetV1]:
    if tenant_id < 1:
        return []
    return list_scoped_assets(KnowledgeScopeRef(scope="tenant", tenant_id=tenant_id), limit=limit)


def list_platform_assets(*, limit: int = 50) -> list[WebKnowledgeAssetV1]:
    return list_scoped_assets(KnowledgeScopeRef(scope="platform"), limit=limit)


def list_workspace_assets(workspace_id: int, *, limit: int = 50) -> list[WebKnowledgeAssetV1]:
    """Filter tenant/platform catalog by contributing workspace (attribution)."""
    out: list[WebKnowledgeAssetV1] = []
    root = asset_store_dir()
    if not root.is_dir():
        return []
    for path in sorted(root.rglob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            row = WebKnowledgeAssetV1.model_validate(raw)
        except (OSError, json.JSONDecodeError, ValidationError):
            continue
        if row.workspace_id != workspace_id:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


def _find_dedupe_asset(ref: KnowledgeScopeRef, content_hash: str) -> WebKnowledgeAssetV1 | None:
    for row in list_scoped_assets(ref, limit=100):
        if row.content_hash == content_hash:
            return row
    return None


async def persist_web_search_capture(
    *,
    scope_ref: KnowledgeScopeRef | None = None,
    req: Any | None = None,
    tenant_id: int | None = None,
    workspace_id: int | None = None,
    conversation_id: str | None = None,
    run_id: str | None = None,
    search_plan: dict[str, Any] | None = None,
    hits: list[dict[str, Any]],
    orientation_topics: list[str] | None = None,
    tier: str = "tenant",
) -> WebKnowledgeAssetV1 | None:
    """Write web search results to the **tenant** (or platform) catalog."""
    if not hits:
        return None
    if scope_ref is None and req is not None:
        scope_ref = scope_ref_from_request(req)
    if scope_ref is None:
        if tenant_id and tenant_id > 0:
            scope_ref = KnowledgeScopeRef(
                scope="tenant",
                tenant_id=tenant_id,
                workspace_id=workspace_id,
            )
        else:
            logger.debug("web_knowledge_asset skipped — no tenant/platform scope")
            return None

    if os.environ.get("OAAO_KNOWLEDGE_ASSET_PERSIST", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return None

    ch = content_hash_for_hits(hits)
    existing = _find_dedupe_asset(scope_ref, ch)
    if existing is not None:
        logger.info(
            "web_knowledge_asset dedupe scope=%s tenant_id=%s hash=%s",
            scope_ref.scope,
            scope_ref.tenant_id,
            ch,
        )
        return existing

    plan_method = str((search_plan or {}).get("method") or "")
    queries = search_plan.get("queries") if isinstance(search_plan, dict) else None
    query = ""
    if isinstance(queries, list) and queries:
        first = queries[0]
        if isinstance(first, dict):
            query = str(first.get("q") or "")

    valid_tiers = ("session", "tenant", "vault", "evolution", "crystallized", "workspace")
    asset_tier = tier if tier in valid_tiers else "tenant"
    if asset_tier == "workspace":
        asset_tier = "tenant"

    asset = WebKnowledgeAssetV1(
        asset_id=f"wk_{uuid.uuid4().hex[:20]}",
        scope=scope_ref.scope,
        tenant_id=scope_ref.tenant_id,
        workspace_id=scope_ref.workspace_id or workspace_id,
        conversation_id=conversation_id,
        run_id=run_id,
        tier=asset_tier,  # type: ignore[arg-type]
        content_hash=ch,
        query=query,
        plan_method=plan_method,
        hits=[
            WebKnowledgeHitV1(
                title=str(h.get("title") or ""),
                url=str(h.get("url") or ""),
                snippet=str(h.get("snippet") or "")[:500],
                provider=str(h.get("provider") or "searxng"),
                plan_query=str(h.get("plan_query") or ""),
                plan_reason=str(h.get("plan_reason") or ""),
            )
            for h in hits
            if isinstance(h, dict)
        ],
        orientation_topics=list(orientation_topics or [])[:24],
        meta={"hit_count": len(hits), "scope": scope_ref.scope},
    )
    try:
        save_asset(asset)
    except OSError:
        logger.warning("web_knowledge_asset save failed", exc_info=True)
        return None
    logger.info(
        "web_knowledge_asset saved asset_id=%s scope=%s tenant_id=%s hits=%s",
        asset.asset_id,
        scope_ref.scope,
        scope_ref.tenant_id,
        len(hits),
    )
    return asset
