"""WS-1-S8 — merge platform/tenant Knowledge vault into Vault RAG profiles (oaao-level supplement)."""

from __future__ import annotations

import logging
import os
from typing import Any

from oaao_orchestrator.knowledge.promotion import resolve_web_vault_id
from oaao_orchestrator.knowledge.scope import parse_tenant_id

logger = logging.getLogger(__name__)


def knowledge_recall_merge_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_RECALL_MERGE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def recall_merge_opted_out(knowledge: dict[str, Any] | None) -> bool:
    if not isinstance(knowledge, dict):
        return False
    if knowledge.get("merge_recall") is False:
        return True
    if knowledge.get("recall_merge") is False:
        return True
    return False


def knowledge_vault_ids_for_recall(
    *,
    knowledge: dict[str, Any] | None = None,
    tenant_id: int | None = None,
) -> list[int]:
    """Resolve tenant/platform knowledge vault ids (not workspace-scoped picks)."""
    out: list[int] = []
    seen: set[int] = set()
    tid = parse_tenant_id(tenant_id)
    if isinstance(knowledge, dict):
        tid = parse_tenant_id(knowledge.get("tenant_id")) or tid
        profiles = knowledge.get("recall_vault_profiles")
        if isinstance(profiles, list):
            for row in profiles:
                if not isinstance(row, dict):
                    continue
                try:
                    vid = int(row.get("vault_id") or 0)
                except (TypeError, ValueError):
                    continue
                if vid > 0 and vid not in seen:
                    seen.add(vid)
                    out.append(vid)
            if out:
                return out
    for scope in ("tenant", "platform"):
        vid = resolve_web_vault_id(knowledge=knowledge, tenant_id=tid, scope=scope)
        if vid and vid > 0 and vid not in seen:
            seen.add(vid)
            out.append(vid)
    return out


def _profile_vault_id(profile: dict[str, Any]) -> int | None:
    try:
        vid = int(profile.get("vault_id") or 0)
        return vid if vid > 0 else None
    except (TypeError, ValueError):
        return None


def _stub_profile_for_vault(vault_id: int, *, label: str = "oaao_knowledge") -> dict[str, Any] | None:
    """Minimal profile when PHP did not supply ``recall_vault_profiles``."""
    slug = (os.environ.get("OAAO_TENANT_SLUG") or os.environ.get("OAAO_KNOWLEDGE_TENANT_SLUG") or "").strip()
    explicit_col = (os.environ.get("OAAO_KNOWLEDGE_RECALL_QDRANT_COLLECTION") or "").strip()
    if explicit_col:
        qcol = explicit_col
    elif slug:
        qcol = f"{slug}_global"
    else:
        logger.debug("knowledge_recall stub skipped vault_id=%s — no collection hint", vault_id)
        return None
    q_url = (os.environ.get("OAAO_QDRANT_URL") or "http://qdrant:6333").rstrip("/")
    return {
        "vault_id": vault_id,
        "vault_name": label,
        "qdrant_url": q_url,
        "qdrant_collection": qcol,
        "source": "knowledge_recall",
    }


def merge_knowledge_recall_profiles(
    profiles: list[dict[str, Any]] | None,
    *,
    knowledge: dict[str, Any] | None = None,
    tenant_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Append Knowledge bucket vault profiles so Vault RAG searches oaao-level web captures.

    PHP may pass full rows via ``knowledge.recall_vault_profiles``; otherwise stubs use env hints.
    """
    if not knowledge_recall_merge_enabled() or recall_merge_opted_out(knowledge):
        return [p for p in (profiles or []) if isinstance(p, dict)]

    merged: list[dict[str, Any]] = [p for p in (profiles or []) if isinstance(p, dict)]
    present = {_profile_vault_id(p) for p in merged}
    present.discard(None)

    recall_profiles = (
        knowledge.get("recall_vault_profiles") if isinstance(knowledge, dict) else None
    )
    if isinstance(recall_profiles, list) and recall_profiles:
        for row in recall_profiles:
            if not isinstance(row, dict):
                continue
            vid = _profile_vault_id(row)
            if vid is None or vid in present:
                continue
            present.add(vid)
            merged.append(dict(row))
        return merged

    for vid in knowledge_vault_ids_for_recall(knowledge=knowledge, tenant_id=tenant_id):
        if vid in present:
            continue
        stub = _stub_profile_for_vault(vid)
        if stub is None:
            continue
        present.add(vid)
        merged.append(stub)
    if merged and len(merged) > len(profiles or []):
        logger.info(
            "knowledge_recall merged %s profile(s) (total=%s)",
            len(merged) - len(profiles or []),
            len(merged),
        )
    return merged


def build_knowledge_bucket_recall_block(
    *,
    tenant_id: int | None = None,
    limit: int = 6,
) -> str:
    """Text block from recent distilled bucket entries (session supplement before vault promotion)."""
    from oaao_orchestrator.knowledge.distill_worker import list_bucket_assets_for_recall

    rows = list_bucket_assets_for_recall(tenant_id=tenant_id, limit=limit)
    parts: list[str] = []
    for asset in rows:
        meta = asset.meta if isinstance(asset.meta, dict) else {}
        summary = str(meta.get("distilled_summary") or "").strip()
        if not summary:
            continue
        title = asset.query or asset.asset_id
        parts.append(f"### {title}\n{summary[:1200]}")
    if not parts:
        return ""
    return (
        "--- oaao Knowledge bucket (public web, tenant/platform global) ---\n"
        + "\n\n".join(parts)
        + "\n--- end Knowledge bucket ---"
    )


def merge_knowledge_recall_from_request(req: Any) -> list[dict[str, Any]]:
    """Convenience for chat ingress — reads ``vault_retrieval_profiles`` + ``knowledge``."""
    profiles = list(getattr(req, "vault_retrieval_profiles", None) or [])
    knowledge = getattr(req, "knowledge", None)
    tenant_id = getattr(req, "tenant_id", None)
    return merge_knowledge_recall_profiles(
        profiles,
        knowledge=knowledge if isinstance(knowledge, dict) else None,
        tenant_id=parse_tenant_id(tenant_id),
    )
