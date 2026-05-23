"""Intent embedding for crystallized skills — bge-m3 when configured, BOW fallback."""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from typing import Any

import httpx

from oaao_orchestrator.vault_graph_rag import (
    _extract_embedding_vector,
    _resolve_secret,
    ensure_url_scheme,
    openai_compat_embeddings_url_from_base,
)

logger = logging.getLogger(__name__)

_BOW_DIM = 256


def _bow_embed(text: str, *, dim: int = _BOW_DIM) -> list[float]:
    vec = [0.0] * dim
    for token in re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", (text or "").lower()):
        vec[hash(token) % dim] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return max(0.0, min(1.0, dot / (na * nb)))


async def embed_intent(text: str, embedding_cfg: dict[str, Any] | None = None) -> list[float]:
    """Embed user intent — OpenAI-compat endpoint when ready, else deterministic BOW."""
    snippet = (text or "").strip()
    if not snippet:
        return _bow_embed("empty")

    cfg = embedding_cfg if isinstance(embedding_cfg, dict) else {}
    base = str(cfg.get("base_url") or os.environ.get("OAAO_EMBEDDING_URL", "")).strip()
    model = str(cfg.get("model") or os.environ.get("OAAO_EMBEDDING_MODEL", "bge-m3")).strip()
    if not base:
        return _bow_embed(snippet)

    url = openai_compat_embeddings_url_from_base(base)
    api_key = _resolve_secret(cfg.get("api_key_env") if isinstance(cfg.get("api_key_env"), str) else None)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body = {"model": model, "input": snippet[:2000]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            resp = await client.post(ensure_url_scheme(url), headers=headers, json=body)
            if resp.status_code >= 400:
                logger.warning("embed_intent http %s", resp.status_code)
                return _bow_embed(snippet)
            vec_raw = _extract_embedding_vector(resp.json())
            if not vec_raw:
                return _bow_embed(snippet)
            return [float(x) for x in vec_raw]
    except Exception:
        logger.warning("embed_intent failed — BOW fallback", exc_info=True)
        return _bow_embed(snippet)


def skill_id_for_run(*, planner_output: dict[str, Any], final_answer: str) -> str:
    payload = f"{planner_output}{final_answer[:200]}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:32]
