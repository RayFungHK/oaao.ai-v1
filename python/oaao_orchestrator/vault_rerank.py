"""Passage reranking for Vault RAG — TEI / Jina / Cohere-compatible APIs."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def rerank_enabled() -> bool:
    raw = (os.environ.get("OAAO_VAULT_RAG_RERANK_ENABLED") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _detect_style(base_url: str, explicit: str) -> str:
    if explicit:
        return explicit.lower()
    low = (base_url or "").lower()
    if "jina.ai" in low:
        return "jina"
    if "/rerank" in low:
        return "tei"
    return "tei"


async def rerank_passages(
    query: str,
    passages: list[str],
    rerank_cfg: dict[str, Any] | None,
    *,
    top_n: int = 8,
) -> list[tuple[int, float]]:
    """
    Return (original_index, score) sorted by descending score.
    On failure, returns identity order with descending pseudo-scores.
    """
    if not passages or not query.strip():
        return [(i, 1.0 - i * 0.01) for i in range(len(passages))]
    if not rerank_enabled():
        return [(i, 1.0 - i * 0.01) for i in range(len(passages))]

    cfg = rerank_cfg if isinstance(rerank_cfg, dict) else {}
    bu = str(cfg.get("base_url") or cfg.get("url") or "").strip()
    model = str(cfg.get("model") or "").strip()
    if not bu or not model:
        return [(i, 1.0 - i * 0.01) for i in range(len(passages))]

    api_key = None
    ake = cfg.get("api_key_env")
    if isinstance(ake, str) and ake.strip():
        api_key = os.environ.get(ake.strip())

    style = _detect_style(
        bu, str(cfg.get("api_style") or os.environ.get("OAAO_RERANK_API_STYLE") or "").strip()
    )
    top_n = max(1, min(top_n, len(passages)))

    try:
        if style == "jina":
            scores = await _jina_rerank(
                query, passages, base_url=bu, model=model, api_key=api_key, top_n=top_n
            )
        elif style == "cohere":
            scores = await _cohere_rerank(
                query, passages, base_url=bu, model=model, api_key=api_key, top_n=top_n
            )
        else:
            scores = await _tei_rerank(
                query, passages, base_url=bu, model=model, api_key=api_key, top_n=top_n
            )
        if scores:
            return scores
    except Exception as exc:  # noqa: BLE001
        logger.warning("rerank failed: %s", exc)

    return [(i, 1.0 - i * 0.01) for i in range(len(passages))]


def _auth_headers(api_key: str | None) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    return h


async def _tei_rerank(
    query: str,
    passages: list[str],
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    top_n: int,
) -> list[tuple[int, float]]:
    url = base_url.rstrip("/")
    if not url.endswith("/rerank"):
        url = f"{url}/rerank"
    payload: dict[str, Any] = {"query": query, "texts": passages, "truncate": True}
    if model:
        payload["model"] = model
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key), timeout=45.0)
        r.raise_for_status()
        data = r.json()
    return _parse_index_scores(data, top_n=top_n)


async def _jina_rerank(
    query: str,
    passages: list[str],
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    top_n: int,
) -> list[tuple[int, float]]:
    url = base_url.rstrip("/")
    if not url.endswith("/rerank"):
        url = f"{url}/v1/rerank" if "jina.ai" in url else f"{url}/rerank"
    payload = {"model": model, "query": query, "documents": passages, "top_n": top_n}
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key), timeout=45.0)
        r.raise_for_status()
        data = r.json()
    return _parse_index_scores(data, top_n=top_n)


async def _cohere_rerank(
    query: str,
    passages: list[str],
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    top_n: int,
) -> list[tuple[int, float]]:
    url = base_url.rstrip("/")
    if not url.endswith("/rerank"):
        url = f"{url}/rerank"
    payload = {
        "model": model,
        "query": query,
        "documents": [{"text": p} for p in passages],
        "top_n": top_n,
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key), timeout=45.0)
        r.raise_for_status()
        data = r.json()
    return _parse_index_scores(data, top_n=top_n)


def _parse_index_scores(data: Any, *, top_n: int) -> list[tuple[int, float]]:
    rows: list[tuple[int, float]] = []
    if not isinstance(data, dict):
        return rows
    items = data.get("results") or data.get("data") or data.get("rankings")
    if not isinstance(items, list):
        items = data if isinstance(data, list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        if idx is None:
            idx = item.get("corpus_id")
        score = item.get("relevance_score")
        if score is None:
            score = item.get("score")
        try:
            rows.append((int(idx), float(score)))
        except (TypeError, ValueError):
            continue
    rows.sort(key=lambda x: x[1], reverse=True)
    return rows[:top_n]
