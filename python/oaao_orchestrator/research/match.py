"""LLM match prompt normalization and article relevance scoring."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.asr_common import _resolve_secret, openai_compat_chat_url

logger = logging.getLogger(__name__)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        dec = json.loads(raw)
        return dec if isinstance(dec, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        dec = json.loads(m.group(0))
        return dec if isinstance(dec, dict) else None
    except json.JSONDecodeError:
        return None


async def _chat_json(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any],
    system: str,
    user: str,
    temperature: float = 0.2,
) -> dict[str, Any] | None:
    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        return None

    api_key = _resolve_secret(llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None)
    url = openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "stream": False,
    }

    try:
        r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0))
        if r.status_code >= 400:
            logger.warning("research match llm http %s", r.status_code)
            return None
        data = r.json()
        if not isinstance(data, dict):
            return None
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(msg, dict):
            return None
        content = msg.get("content")
        if not isinstance(content, str):
            return None
        return _extract_json_object(content)
    except Exception as exc:  # noqa: BLE001
        logger.warning("research match llm failed: %s", exc)
        return None


async def normalize_match_prompt(
    client: httpx.AsyncClient,
    raw_prompt: str,
    llm_cfg: dict[str, Any] | None,
) -> str:
    """Turn user criteria into a stable evaluation rubric for downstream matching."""
    text = (raw_prompt or "").strip()
    if not text:
        return ""
    if not llm_cfg or not isinstance(llm_cfg, dict):
        return text

    system = (
        "You normalize article-watch match criteria for an automated research pipeline. "
        "Output ONLY valid JSON: "
        '{"normalized_prompt":"...", "criteria_bullets":["..."]}. '
        "The normalized_prompt must be self-contained, unambiguous, and usable to judge "
        "whether an article satisfies the user's intent. Keep the user's language."
    )
    user = f"User criteria (raw):\n{text}"
    parsed = await _chat_json(client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.1)
    if parsed:
        norm = parsed.get("normalized_prompt")
        if isinstance(norm, str) and norm.strip():
            return norm.strip()
    return text


async def evaluate_article_match(
    client: httpx.AsyncClient,
    *,
    normalized_prompt: str,
    title: str,
    body_markdown: str,
    summary_markdown: str,
    llm_cfg: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Score whether an article meets normalized criteria.

    Returns: {match: bool, confidence: float 0..1, reason: str}
    """
    prompt = (normalized_prompt or "").strip()
    if not prompt or not llm_cfg or not isinstance(llm_cfg, dict):
        return {"match": False, "confidence": 0.0, "reason": "match_disabled"}

    clipped_body = (body_markdown or "")[:16000]
    clipped_summary = (summary_markdown or "")[:8000]
    system = (
        "You judge whether a fetched article satisfies watch criteria. "
        "Output ONLY valid JSON with keys: match (boolean), confidence (number 0 to 1), "
        "reason (short string in the user's language). "
        "confidence reflects how clearly the article meets ALL important parts of the criteria. "
        "Be conservative: generic or tangential articles should score low."
    )
    user = (
        f"Criteria:\n{prompt}\n\n"
        f"Title: {title or '(untitled)'}\n\n"
        f"Summary:\n{clipped_summary}\n\n"
        f"Article excerpt:\n{clipped_body}"
    )
    parsed = await _chat_json(client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.1)
    if not parsed:
        return {"match": False, "confidence": 0.0, "reason": "llm_unavailable"}

    match = bool(parsed.get("match"))
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    reason = str(parsed.get("reason") or "").strip()[:500]
    if not reason:
        reason = "matched" if match else "not matched"

    return {"match": match, "confidence": confidence, "reason": reason}
