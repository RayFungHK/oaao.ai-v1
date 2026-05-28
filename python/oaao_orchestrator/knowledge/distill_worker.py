"""WS-1-S9 — classify + distill Knowledge bucket entries for efficient RAG / training."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import _extract_json_object, chat_completion_text
from oaao_orchestrator.knowledge.asset_models import WebKnowledgeAssetV1
from oaao_orchestrator.knowledge.asset_store import (
    list_platform_assets,
    list_tenant_assets,
    load_asset,
    save_asset,
)
from oaao_orchestrator.knowledge.scope import parse_tenant_id

logger = logging.getLogger(__name__)

_CLASSIFY_SYSTEM = """You classify a web knowledge capture for oaao.ai global Knowledge buckets.
Return ONLY JSON:
{
  "topics": ["2-6 short topic tags"],
  "entities": ["named entities"],
  "bucket_lane": "reference|news|regulation|product|other",
  "quality": "high|medium|low"
}
Use only evidence from the snippets; do not invent facts."""

_DISTILL_SYSTEM = """You distill web search snippets into a compact reference block for RAG and training.
Return ONLY JSON:
{
  "distilled_summary": "3-8 sentences, factual, cite sources by title when useful",
  "key_facts": ["bullet facts"],
  "training_hint": "one line on what LoRA/patch should learn from this capture"
}
Neutral public information only; no private user data."""


def _resolve_llm_cfg(
    knowledge: dict[str, Any] | None,
    purpose_key: str,
) -> dict[str, Any] | None:
    if not isinstance(knowledge, dict):
        return None
    for key in (purpose_key, purpose_key.replace(".", "_")):
        raw = knowledge.get(key)
        if isinstance(raw, dict) and raw.get("base_url") and raw.get("model"):
            return raw
    return None


def _hits_blob(asset: WebKnowledgeAssetV1) -> str:
    lines = [f"query: {asset.query}", f"topics: {', '.join(asset.orientation_topics[:8])}"]
    for idx, hit in enumerate(asset.hits[:8], start=1):
        lines.append(f"[{idx}] {hit.title} | {hit.url}")
        if hit.snippet:
            lines.append(hit.snippet[:400])
    return "\n".join(lines)[:6000]


async def classify_and_distill_asset(
    asset_id: str,
    *,
    knowledge: dict[str, Any] | None = None,
    classify_llm_cfg: dict[str, Any] | None = None,
    distill_llm_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Update asset.meta with classification + distilled_summary."""
    asset = load_asset(asset_id)
    if asset is None:
        return {"ok": False, "reason": "asset_not_found"}

    classify_cfg = classify_llm_cfg or _resolve_llm_cfg(knowledge, "knowledge.classify")
    distill_cfg = distill_llm_cfg or _resolve_llm_cfg(knowledge, "knowledge.distill")
    if not classify_cfg and not distill_cfg:
        return {"ok": False, "reason": "no_llm_cfg"}

    meta = dict(asset.meta or {})
    blob = _hits_blob(asset)

    async with httpx.AsyncClient() as client:
        if classify_cfg and not meta.get("classified_at"):
            raw_c = await chat_completion_text(
                client,
                llm_cfg=classify_cfg,
                system=_CLASSIFY_SYSTEM,
                user=blob,
                temperature=0.1,
                timeout_sec=45.0,
            )
            parsed_c = _extract_json_object(raw_c or "")
            if isinstance(parsed_c, dict):
                meta["classified_topics"] = [
                    str(x).strip() for x in (parsed_c.get("topics") or []) if str(x).strip()
                ][:12]
                meta["classified_entities"] = [
                    str(x).strip() for x in (parsed_c.get("entities") or []) if str(x).strip()
                ][:16]
                meta["bucket_lane"] = str(parsed_c.get("bucket_lane") or "other")[:32]
                meta["quality"] = str(parsed_c.get("quality") or "medium")[:16]
                meta["classified_at"] = time.time()
                if meta["classified_topics"]:
                    merged_topics = list(asset.orientation_topics)
                    for t in meta["classified_topics"]:
                        if t not in merged_topics:
                            merged_topics.append(t)
                    asset.orientation_topics = merged_topics[:24]

        if distill_cfg and not meta.get("distilled_at"):
            raw_d = await chat_completion_text(
                client,
                llm_cfg=distill_cfg,
                system=_DISTILL_SYSTEM,
                user=blob,
                temperature=0.2,
                timeout_sec=60.0,
            )
            parsed_d = _extract_json_object(raw_d or "")
            if isinstance(parsed_d, dict):
                summary = str(parsed_d.get("distilled_summary") or "").strip()
                if summary:
                    meta["distilled_summary"] = summary[:4000]
                facts = parsed_d.get("key_facts")
                if isinstance(facts, list):
                    meta["key_facts"] = [str(x).strip() for x in facts if str(x).strip()][:12]
                hint = str(parsed_d.get("training_hint") or "").strip()
                if hint:
                    meta["training_hint"] = hint[:500]
                meta["distilled_at"] = time.time()

    asset.meta = meta
    save_asset(asset)
    return {
        "ok": True,
        "asset_id": asset_id,
        "classified": bool(meta.get("classified_at")),
        "distilled": bool(meta.get("distilled_at")),
        "bucket_lane": meta.get("bucket_lane"),
    }


async def classify_distill_pending_assets(
    *,
    tenant_id: int | None = None,
    knowledge: dict[str, Any] | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Batch classify/distill assets missing ``distilled_at`` in tenant (+ platform) catalogs."""
    cap = max(1, min(int(limit), 50))
    rows: list[WebKnowledgeAssetV1] = []
    tid = parse_tenant_id(tenant_id)
    if tid:
        rows.extend(list_tenant_assets(tid, limit=cap))
    rows.extend(list_platform_assets(limit=cap))
    pending = [
        a
        for a in rows
        if isinstance(a.meta, dict) and not a.meta.get("distilled_at")
    ][:cap]

    processed: list[dict[str, Any]] = []
    for asset in pending:
        out = await classify_and_distill_asset(
            asset.asset_id,
            knowledge=knowledge,
        )
        processed.append(out)

    return {
        "ok": True,
        "pending": len(pending),
        "processed": len(processed),
        "results": processed,
    }


def classify_distill_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_CLASSIFY_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def schedule_classify_distill_asset(
    asset_id: str,
    *,
    knowledge: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget S9 after web capture or refresh."""

    async def _run() -> None:
        try:
            await classify_and_distill_asset(asset_id, knowledge=knowledge)
        except Exception:
            logger.exception("classify_distill failed asset_id=%s", asset_id)

    if classify_distill_enabled():
        asyncio.create_task(_run())  # noqa: RUF006


def list_bucket_assets_for_recall(
    *,
    tenant_id: int | None = None,
    limit: int = 12,
) -> list[WebKnowledgeAssetV1]:
    """Recent catalog entries with distilled summaries for recall API."""
    cap = max(1, min(limit, 40))
    out: list[WebKnowledgeAssetV1] = []
    tid = parse_tenant_id(tenant_id)
    if tid:
        out.extend(list_tenant_assets(tid, limit=cap))
    out.extend(list_platform_assets(limit=cap))
    out.sort(key=lambda a: float(a.created_at or 0), reverse=True)
    seen: set[str] = set()
    deduped: list[WebKnowledgeAssetV1] = []
    for row in out:
        if row.asset_id in seen:
            continue
        seen.add(row.asset_id)
        deduped.append(row)
        if len(deduped) >= cap:
            break
    return deduped
