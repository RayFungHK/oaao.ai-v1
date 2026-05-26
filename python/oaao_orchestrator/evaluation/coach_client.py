"""E4B coach client for inline IQS / ACCS (Evolution §4–5)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.post_stream_llm import call_uiqe_chat, uiqe_endpoint_ready

logger = logging.getLogger(__name__)

_DEFAULT_POST_COACH_TIMEOUT_S = 90.0
_DEFAULT_INLINE_COACH_TIMEOUT_S = 4.0

_PROMPT_REFS = {
    "iqs": "materials/prompts/evolution/iqs_coach.md",
    "accs": "materials/prompts/evolution/accs_coach.md",
}


class CoachCallError(Exception):
    """Coach HTTP / parse failure — breaker should count this."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


def coach_call_timeout_s(*, inline: bool = False) -> float:
    """Post-stream E4B coach may run 30–90s on large models; inline uses a short budget."""
    if inline:
        raw = os.environ.get("OAAO_IQS_INLINE_COACH_TIMEOUT_S", "").strip()
        if not raw:
            raw = str(_DEFAULT_INLINE_COACH_TIMEOUT_S)
        try:
            return max(1.0, float(raw))
        except ValueError:
            return _DEFAULT_INLINE_COACH_TIMEOUT_S
    raw = os.environ.get("OAAO_COACH_CALL_TIMEOUT_S", "").strip()
    if not raw:
        raw = str(_DEFAULT_POST_COACH_TIMEOUT_S)
    try:
        return max(5.0, float(raw))
    except ValueError:
        return _DEFAULT_POST_COACH_TIMEOUT_S


def inline_iqs_coach_disabled() -> bool:
    """Explicit opt-out only — inline chat uses E4B coach when ``uiqe`` endpoint is configured."""
    return os.environ.get("OAAO_IQS_INLINE_COACH", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    )


def inline_iqs_coach_enabled() -> bool:
    return not inline_iqs_coach_disabled()


def inline_iqs_clarify_enabled() -> bool:
    """When false (default), inline IQS records scores only — never blocks the main LLM."""
    return os.environ.get("OAAO_IQS_INLINE_CLARIFY", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def coach_endpoint_ready(endpoint: dict[str, Any] | None) -> bool:
    return isinstance(endpoint, dict) and uiqe_endpoint_ready(endpoint)


def _materials_root() -> Path:
    import os

    raw = os.environ.get("OAAO_MATERIALS_ROOT", "").strip()
    if raw:
        return Path(raw)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "materials"
        if candidate.is_dir():
            return parent
    return Path("/app")


def _load_prompt(ref: str) -> str:
    root = _materials_root()
    path = root / ref
    if not path.is_file():
        alt = Path(__file__).resolve().parents[2] / ref
        if alt.is_file():
            path = alt
        else:
            raise CoachCallError(f"coach_prompt_missing:{ref}")
    return path.read_text(encoding="utf-8")


def _render(template: str, variables: dict[str, Any]) -> str:
    out = template
    for key, val in variables.items():
        out = out.replace(f"{{{{{key}}}}}", "" if val is None else str(val))
    return out.strip()


def _conversation_excerpt(history: list[Any], *, limit: int = 2400) -> str:
    lines: list[str] = []
    for msg in history[-8:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user")
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:600]}")
    text = "\n".join(lines)
    return text[:limit] if len(text) > limit else text


def _evidence_excerpt(evidence: list[Any], *, limit: int = 3000) -> str:
    if not evidence:
        return "(none)"
    parts: list[str] = []
    for i, item in enumerate(evidence[:8], start=1):  # noqa: B007
        if isinstance(item, dict):
            parts.append(json.dumps(item, ensure_ascii=False)[:500])
        else:
            parts.append(str(item)[:500])
    text = "\n---\n".join(parts)
    return text[:limit] if len(text) > limit else text


def build_iqs_coach_prompt(*, user_message: str, conversation_history: list[Any]) -> str:
    template = _load_prompt(_PROMPT_REFS["iqs"])
    return _render(
        template,
        {
            "user_message": (user_message or "").strip()[:4000],
            "conversation_excerpt": _conversation_excerpt(conversation_history),
        },
    )


def build_accs_coach_prompt(
    *,
    user_message: str,
    llm_output: str,
    evidence: list[Any],
    grounding_context: str = "",
) -> str:
    template = _load_prompt(_PROMPT_REFS["accs"])
    return _render(
        template,
        {
            "user_message": (user_message or "").strip()[:2000],
            "llm_output": (llm_output or "").strip()[:6000],
            "evidence_excerpt": _evidence_excerpt(evidence),
            "grounding_context": (grounding_context or "(none)").strip()[:2000],
        },
    )


async def call_coach_json(
    *,
    endpoint: dict[str, Any],
    prompt: str,
    temperature: float = 0.1,
    timeout_s: float | None = None,
    inline: bool = False,
) -> dict[str, Any]:
    import asyncio

    limit = timeout_s if timeout_s is not None else coach_call_timeout_s(inline=inline)

    async def _post() -> tuple[dict[str, Any] | None, str | None]:
        async with httpx.AsyncClient() as client:
            return await call_uiqe_chat(
                client,
                endpoint_snapshot=endpoint,
                prompt_rendered=prompt,
                temperature=temperature,
            )

    try:
        parsed, err = await asyncio.wait_for(_post(), timeout=limit)
    except TimeoutError as exc:
        raise CoachCallError("coach_timeout") from exc

    if err or not parsed:
        raise CoachCallError(err or "coach_empty_response")
    if not isinstance(parsed, dict):
        raise CoachCallError("coach_invalid_json")
    return parsed


def _clamp01(raw: Any) -> float | None:
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return None


def parse_iqs_coach_response(raw: dict[str, Any]) -> tuple[dict[str, float], list[str]]:
    dims_raw = raw.get("dimensions") if isinstance(raw.get("dimensions"), dict) else raw
    names = ("clarity", "specificity", "actionability", "context_completeness")
    dims: dict[str, float] = {}
    for name in names:
        val = _clamp01(dims_raw.get(name) if isinstance(dims_raw, dict) else None)
        if val is None:
            raise CoachCallError(f"iqs_missing_dimension:{name}")
        dims[name] = val

    questions: list[str] = []
    raw_q = raw.get("clarification_questions")
    if isinstance(raw_q, list):
        for q in raw_q:
            text = str(q or "").strip()
            if text:
                questions.append(text)
    return dims, questions


def enrich_accs_display_factors(factors: dict[str, float]) -> dict[str, float]:
    """Ensure citation_fidelity / source_analysis exist for UI sub-pills."""
    out = dict(factors)
    acc = float(out.get("accuracy") or 0.0)
    ali = float(out.get("alignment") or 0.0)
    if "citation_fidelity" not in out:
        out["citation_fidelity"] = acc if acc > 0 else ali
    if "source_analysis" not in out:
        out["source_analysis"] = ali if ali > 0 else acc
    return out


def parse_accs_coach_response(raw: dict[str, Any]) -> dict[str, float]:
    factors: dict[str, float] = {}
    for name in ("alignment", "accuracy", "hallucination_penalty"):
        val = _clamp01(raw.get(name))
        if val is None and isinstance(raw.get("factors"), dict):
            val = _clamp01(raw["factors"].get(name))
        if val is None:
            raise CoachCallError(f"accs_missing_factor:{name}")
        factors[name] = val
    for optional in ("citation_fidelity", "source_analysis"):
        val = _clamp01(raw.get(optional))
        if val is None and isinstance(raw.get("factors"), dict):
            val = _clamp01(raw["factors"].get(optional))
        if val is not None:
            factors[optional] = val
    return enrich_accs_display_factors(factors)
