"""Corpus generate preview worker — LLM sample markdown (background job)."""

from __future__ import annotations

from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import generate_preview_markdown


async def run_corpus_generate(payload: dict[str, Any]) -> dict[str, Any]:
    llm_cfg = payload.get("llm_cfg")
    if not isinstance(llm_cfg, dict) or not str(llm_cfg.get("base_url") or "").strip():
        return {
            "ok": False,
            "error": "llm_not_configured",
            "detail": "Configure a Corpus or Planning LLM endpoint (Settings → Endpoints).",
        }

    brief = str(payload.get("brief") or "").strip()
    style = payload.get("style_json")
    if not isinstance(style, dict):
        return {"ok": False, "error": "style_json_required"}
    segments = payload.get("sample_segments")
    if not isinstance(segments, list):
        segments = []

    async with httpx.AsyncClient() as client:
        return await generate_preview_markdown(
            client,
            llm_cfg=llm_cfg,
            brief=brief,
            profile_name=str(payload.get("profile_name") or ""),
            style_json=style,
            sample_segments=segments,
        )
