"""CS-2-S5 — Library editor selection AI transform."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import chat_completion_text

logger = logging.getLogger(__name__)

_ACTION_PROMPTS: dict[str, str] = {
    "improve-writing": "Rewrite the selection for clarity and flow. Keep meaning; return only the rewritten text.",
    "proofread": "Fix spelling and grammar. Return only the corrected text.",
    "make-shorter": "Make the selection shorter while preserving meaning. Return only the condensed text.",
    "make-longer": "Expand the selection with useful detail. Return only the expanded text.",
    "summarize": "Summarize the selection. Return only the summary.",
    "explain": "Explain the selection in simpler terms. Return only the explanation.",
    "continue-writing": "Continue writing naturally from the selection. Return only the continuation.",
}


def _action_prompt(action: str) -> str:
    key = (action or "improve-writing").strip().lower()
    return _ACTION_PROMPTS.get(key, _ACTION_PROMPTS["improve-writing"])


def _corpus_style_hint(style: Any) -> str:
    if not isinstance(style, dict):
        return ""
    tone = style.get("tone")
    if isinstance(tone, dict):
        parts = [str(v) for v in tone.values() if v]
        if parts:
            return " Match corpus tone: " + "; ".join(parts[:6]) + "."
    if isinstance(tone, str) and tone.strip():
        return f" Match corpus tone: {tone.strip()}."
    return ""


async def run_library_ai_transform(payload: dict[str, Any]) -> dict[str, Any]:
    selection = str(payload.get("selection_text") or "").strip()
    if not selection:
        return {"ok": False, "error": "selection_text_required"}

    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if not llm_cfg or not str(llm_cfg.get("base_url") or "").strip() or not str(llm_cfg.get("model") or "").strip():
        return {"ok": False, "error": "llm_not_configured"}

    action = str(payload.get("action") or "improve-writing").strip().lower()
    title = str(payload.get("title") or "").strip()
    style_hint = _corpus_style_hint(payload.get("corpus_style"))

    system = (
        "You are a document editor assistant. "
        "Return plain text only — no markdown fences, no commentary."
        + style_hint
    )
    user = f"Document title: {title or 'Untitled'}\n\nSelection:\n{selection}\n\nInstruction: {_action_prompt(action)}"

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.35,
            )
    except Exception as exc:
        logger.exception("library_ai_transform_failed action=%s", action)
        return {"ok": False, "error": str(exc) or "transform_failed"}

    out = (text or "").strip()
    if not out:
        return {"ok": False, "error": "empty_model_response"}

    return {
        "ok": True,
        "mode": "replace-selection",
        "text": out,
        "action": action,
    }
