"""WS-1-S4 / WS-1-S7 — ACCS gate, Vault ingest, evolution_patches for web knowledge."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from oaao_orchestrator.evaluation.accs import THRESHOLD_SHIP, score_accs
from oaao_orchestrator.evaluation.evolution_store import record_evolution_patch
from oaao_orchestrator.knowledge.asset_models import WebKnowledgeAssetV1
from oaao_orchestrator.knowledge.asset_store import load_asset, save_asset
from oaao_orchestrator.knowledge.vault_client import upload_text_document

logger = logging.getLogger(__name__)


def promotion_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_PROMOTION_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def vault_ingest_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_VAULT_INGEST", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def accs_min_for_promotion() -> float:
    raw = (os.environ.get("OAAO_KNOWLEDGE_ACCS_MIN") or "").strip()
    if raw:
        try:
            return max(0.0, min(1.0, float(raw)))
        except ValueError:
            pass
    return THRESHOLD_SHIP


def resolve_web_vault_id(
    *,
    knowledge: dict[str, Any] | None = None,
    tenant_id: int | None = None,
    scope: str = "tenant",
) -> int | None:
    """Tenant knowledge vault first, then platform — Settings → Knowledge preferred over env."""
    if isinstance(knowledge, dict):
        refresh = knowledge.get("refresh")
        if isinstance(refresh, dict):
            if scope == "platform":
                raw = refresh.get("platform_vault_id")
            else:
                raw = refresh.get("tenant_vault_id") or refresh.get("web_vault_id")
            if raw is not None:
                try:
                    vid = int(raw)
                    if vid > 0:
                        return vid
                except (TypeError, ValueError):
                    pass
        for key in (
            "tenant_vault_id",
            "web_vault_id",
            "vault_id",
            "platform_vault_id",
        ):
            raw = knowledge.get(key)
            if raw is not None:
                try:
                    vid = int(raw)
                    if vid > 0:
                        if key == "platform_vault_id" and scope != "platform":
                            continue
                        if key == "tenant_vault_id" and scope == "platform":
                            continue
                        return vid
                except (TypeError, ValueError):
                    pass
    if scope == "platform":
        for env_key in ("OAAO_KNOWLEDGE_PLATFORM_VAULT_ID", "OAAO_KNOWLEDGE_WEB_VAULT_ID"):
            raw_env = (os.environ.get(env_key) or "").strip()
            if raw_env:
                try:
                    vid = int(raw_env)
                    if vid > 0:
                        return vid
                except ValueError:
                    pass
    else:
        _ = tenant_id
        for env_key in ("OAAO_KNOWLEDGE_TENANT_VAULT_ID", "OAAO_KNOWLEDGE_WEB_VAULT_ID"):
            raw_env = (os.environ.get(env_key) or "").strip()
            if raw_env:
                try:
                    vid = int(raw_env)
                    if vid > 0:
                        return vid
                except ValueError:
                    pass
    return None


def hits_to_evidence(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in hits:
        if not isinstance(row, dict):
            continue
        snippet = str(row.get("snippet") or "").strip()
        title = str(row.get("title") or "").strip()
        url = str(row.get("url") or "").strip()
        if not snippet and not title:
            continue
        out.append(
            {
                "file_name": title or url[:120] or "web",
                "excerpt": snippet[:800],
                "url": url,
                "source": "web_search",
            }
        )
    return out


def build_vault_markdown(asset: WebKnowledgeAssetV1) -> str:
    lines = [
        "# Web search knowledge capture",
        "",
        f"- **Asset ID:** `{asset.asset_id}`",
        f"- **Workspace:** {asset.workspace_id}",
        f"- **Query:** {asset.query or '(none)'}",
        f"- **Plan method:** {asset.plan_method or 'unknown'}",
        f"- **Content hash:** `{asset.content_hash}`",
        "",
    ]
    if asset.orientation_topics:
        lines.append("## Topics")
        for topic in asset.orientation_topics[:12]:
            lines.append(f"- {topic}")
        lines.append("")
    lines.append("## Sources")
    for idx, hit in enumerate(asset.hits, start=1):
        lines.append(f"### [{idx}] {hit.title or 'Untitled'}")
        if hit.url:
            lines.append(f"- URL: {hit.url}")
        if hit.plan_query:
            lines.append(f"- Plan query: {hit.plan_query}")
        lines.append("")
        if hit.snippet:
            lines.append(hit.snippet)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def web_knowledge_asset_id_from_pipeline(
    pipeline_snap: dict[str, Any] | None,
) -> str | None:
    if not isinstance(pipeline_snap, dict):
        return None
    for block in pipeline_snap.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if block.get("kind") == "web_search" or block.get("type") == "web_search":
            props = block.get("props") if isinstance(block.get("props"), dict) else block
            aid = str((props or {}).get("asset_id") or "").strip()
            if aid:
                return aid
    vr = pipeline_snap.get("web_search")
    if isinstance(vr, dict):
        aid = str(vr.get("asset_id") or "").strip()
        if aid:
            return aid
    return None


def web_search_evidence_from_pipeline(
    pipeline_snap: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not isinstance(pipeline_snap, dict):
        return []
    hits = pipeline_snap.get("web_search_hits")
    if isinstance(hits, list):
        return hits_to_evidence(hits)
    for block in pipeline_snap.get("blocks") or []:
        if not isinstance(block, dict) or block.get("kind") != "web_search":
            continue
        props = block.get("props")
        if isinstance(props, dict) and isinstance(props.get("hits"), list):
            return hits_to_evidence(props["hits"])
    return []


@dataclass
class PromotionResult:
    promoted: bool
    accs_score: float = 0.0
    vault_document_id: int | None = None
    evolution_patch_id: str | None = None
    reason: str = ""


async def promote_web_knowledge_asset(
    asset_id: str,
    *,
    user_id: int | None = None,
    knowledge: dict[str, Any] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
    assistant_text: str | None = None,
    workspace_id: int | None = None,
) -> PromotionResult:
    """
    ACCS gate → Vault markdown ingest → ``evolution_patches`` few-shot row.

    Idempotent when ``promoted_to_vault_id`` is already set.
    """
    if not promotion_enabled():
        return PromotionResult(promoted=False, reason="promotion_disabled")

    asset = load_asset(asset_id)
    if asset is None:
        return PromotionResult(promoted=False, reason="asset_not_found")

    if asset.promoted_to_vault_id and asset.promoted_to_vault_id > 0:
        return PromotionResult(
            promoted=True,
            accs_score=float(asset.accs_score or 0),
            vault_document_id=asset.promoted_to_vault_id,
            evolution_patch_id=asset.evolution_patch_id,
            reason="already_promoted",
        )

    digest = build_vault_markdown(asset)
    evidence = hits_to_evidence([h.model_dump() for h in asset.hits])
    llm_output = (assistant_text or "").strip() or digest
    user_msg = (asset.query or "").strip() or "web search knowledge capture"

    accs = await score_accs(
        user_message=user_msg,
        llm_output=llm_output,
        evidence=evidence,
        coach_endpoint=coach_endpoint,
        grounding_context=f"Web search asset {asset.asset_id}; {len(evidence)} snippets.",
    )
    asset.accs_score = round(float(accs.score), 4)
    meta = dict(asset.meta or {})
    meta["accs_action"] = accs.action
    meta["accs_source"] = accs.source
    asset.meta = meta
    save_asset(asset)

    gate = accs_min_for_promotion()
    if accs.skipped:
        return PromotionResult(
            promoted=False,
            accs_score=float(accs.score),
            reason="accs_skipped",
        )
    if float(accs.score) < gate:
        logger.info(
            "web_knowledge_promotion blocked asset_id=%s accs=%.3f gate=%.3f",
            asset_id,
            accs.score,
            gate,
        )
        return PromotionResult(
            promoted=False,
            accs_score=float(accs.score),
            reason="accs_below_gate",
        )

    vault_id = resolve_web_vault_id(
        knowledge=knowledge,
        tenant_id=asset.tenant_id,
        scope=asset.scope,
    )
    doc_id: int | None = None
    if vault_ingest_enabled() and vault_id and user_id and user_id > 0:
        first_url = ""
        if asset.hits and asset.hits[0].url:
            first_url = asset.hits[0].url
        safe_name = f"web-search-{asset.content_hash[:12] or asset.asset_id[-12:]}.md"
        async with httpx.AsyncClient() as client:
            resp = await upload_text_document(
                client,
                user_id=int(user_id),
                vault_id=int(vault_id),
                filename=safe_name,
                content=digest,
                workspace_id=asset.workspace_id,
                asset_id=asset.asset_id,
                content_hash=asset.content_hash,
                canonical_url=first_url or None,
            )
        if resp and resp.get("success"):
            raw_doc = resp.get("document_id")
            try:
                doc_id = int(raw_doc) if raw_doc is not None else None
            except (TypeError, ValueError):
                doc_id = None
            if doc_id and doc_id > 0:
                asset.tier = "vault"
                asset.promoted_to_vault_id = doc_id
                logger.info(
                    "web_knowledge_vault_ingest asset_id=%s document_id=%s vault_id=%s",
                    asset_id,
                    doc_id,
                    vault_id,
                )
        else:
            logger.warning(
                "web_knowledge_vault_ingest failed asset_id=%s vault_id=%s",
                asset_id,
                vault_id,
            )
    elif vault_ingest_enabled() and not vault_id:
        logger.info(
            "web_knowledge_vault_ingest skipped — set OAAO_KNOWLEDGE_WEB_VAULT_ID or knowledge.web_vault_id"
        )

    patch_id = f"wk-patch-{asset.asset_id}"
    snippet_rows = [
        {
            "title": h.title,
            "url": h.url,
            "snippet": h.snippet[:300],
            "plan_query": h.plan_query,
        }
        for h in asset.hits[:8]
    ]
    patch_doc = {
        "patch_id": patch_id,
        "type": "web_search_fewshot",
        "status": "candidate",
        "scope": asset.scope,
        "asset_id": asset.asset_id,
        "tenant_id": asset.tenant_id,
        "workspace_id": asset.workspace_id,
        "query": asset.query,
        "content_hash": asset.content_hash,
        "accs_score": float(accs.score),
        "vault_document_id": doc_id,
        "snippets": snippet_rows,
        "diff": json.dumps(
            {"query": asset.query, "top_snippets": snippet_rows[:3]},
            ensure_ascii=False,
        )[:4000],
        "tool_chain": ["web_search", "vault_ingest" if doc_id else "workspace_asset"],
        "auto_generated": True,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    await record_evolution_patch(patch_doc)
    asset.tier = "evolution" if doc_id else asset.tier
    asset.evolution_patch_id = patch_id
    save_asset(asset)

    return PromotionResult(
        promoted=True,
        accs_score=float(accs.score),
        vault_document_id=doc_id,
        evolution_patch_id=patch_id,
        reason="promoted",
    )


def schedule_web_knowledge_promotion(
    *,
    asset_id: str,
    user_id: int | None,
    knowledge: dict[str, Any] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
    workspace_id: int | None = None,
    assistant_text: str | None = None,
) -> None:
    """Fire-and-forget promotion after web search or post-stream."""

    async def _run() -> None:
        try:
            await promote_web_knowledge_asset(
                asset_id,
                user_id=user_id,
                knowledge=knowledge,
                coach_endpoint=coach_endpoint,
                assistant_text=assistant_text,
                workspace_id=workspace_id,
            )
        except Exception:
            logger.exception("web_knowledge_promotion failed asset_id=%s", asset_id)

    asyncio.create_task(_run())  # noqa: RUF006


def coach_endpoint_from_request(req: Any) -> dict[str, Any] | None:
    """Reuse UIQE / chat coach binding for ACCS when available."""
    uiqe = getattr(req, "uiqe", None)
    if isinstance(uiqe, dict) and uiqe.get("base_url") and uiqe.get("model"):
        return uiqe
    ep = getattr(req, "endpoint", None)
    if ep is not None and getattr(ep, "base_url", None) and getattr(ep, "model", None):
        return {
            "base_url": str(getattr(ep, "base_url", "") or ""),
            "model": str(getattr(ep, "model", "") or ""),
            "api_key_env": getattr(ep, "api_key_env", None),
        }
    return None


def resolve_user_id(req: Any) -> int | None:
    raw = getattr(req, "user_id", None)
    if raw is None:
        return None
    try:
        uid = int(str(raw).strip())
        return uid if uid > 0 else None
    except (TypeError, ValueError):
        return None
