"""Extract vault / RAG evidence and grounding context for ACCS scoring."""

from __future__ import annotations

import json
import re
from typing import Any

_VAULT_ACTIVITY_RE = re.compile(r"^vault_rag\s·", re.IGNORECASE)

_USER_EXISTENCE_RE = re.compile(
    r"(有没有|有沒有|是否有|是否存在|找不到|查不到|"
    r"沒有相關|没有相关|沒有.*[?？吗嗎]|没有.*[?？吗嗎]|"
    r"is there|are there|any .+ in|not in|no .+ in|cannot find|can't find)",
    re.IGNORECASE,
)

_ASSISTANT_NEGATIVE_EVIDENCE_RE = re.compile(
    r"(没有|沒有|并未|並未|未找到|未检索|未檢索|不在|不包含|找不到|查不到|"
    r"no matching|not found|does not contain|did not find|not in the|"
    r"no relevant|no direct|absent from|zero hits)",
    re.IGNORECASE,
)

_ASSISTANT_SCOPE_ANALYSIS_RE = re.compile(
    r"(检索|檢索|vault|知識庫|文档|文檔|资料|資料|excerpt|passage|source|引用|"
    r"instead|而是|实际|實際|contains|包含|related to|相关|相關)",
    re.IGNORECASE,
)


def evidence_from_pipeline_snap(pipeline_snap: dict[str, Any] | None) -> list[Any]:
    """Passages / citation excerpts available for ACCS coach + heuristic."""
    if not isinstance(pipeline_snap, dict):
        return []
    out: list[Any] = []
    seen: set[str] = set()

    vr = pipeline_snap.get("vault_rag")
    if isinstance(vr, dict):
        raw = vr.get("passages") or []
        if isinstance(raw, list):
            for item in raw:
                key = json.dumps(item, ensure_ascii=False, sort_keys=True)[:400]
                if key not in seen:
                    seen.add(key)
                    out.append(item)

    for block in pipeline_snap.get("blocks") or []:
        if not isinstance(block, dict) or block.get("type") != "rag_citations":
            continue
        props = block.get("props")
        if not isinstance(props, dict):
            continue
        refs = props.get("references")
        if not isinstance(refs, list):
            continue
        for ref in refs[:12]:
            if not isinstance(ref, dict):
                continue
            excerpt = str(ref.get("excerpt") or "").strip()
            if not excerpt:
                continue
            row = {
                "file_name": str(ref.get("file_name") or "").strip(),
                "excerpt": excerpt[:800],
            }
            key = json.dumps(row, ensure_ascii=False, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
    return out


def vault_grounding_context_text(pipeline_snap: dict[str, Any] | None) -> str:
    """Human-readable vault retrieval summary for ACCS coach."""
    if not isinstance(pipeline_snap, dict):
        return "(no vault grounding metadata)"

    vr = pipeline_snap.get("vault_rag")
    passage_count = 0
    profile_hits = 0
    if isinstance(vr, dict):
        try:
            passage_count = int(vr.get("passage_count") or 0)
        except (TypeError, ValueError):
            passage_count = 0
        try:
            profile_hits = int(vr.get("profile_hits") or 0)
        except (TypeError, ValueError):
            profile_hits = 0

    activity_lines: list[str] = []
    activity = pipeline_snap.get("activity")
    if isinstance(activity, dict):
        for ln in activity.get("lines") or []:
            text = str(ln or "").strip()
            if text and _VAULT_ACTIVITY_RE.search(text):
                activity_lines.append(text)

    if passage_count > 0:
        mode = "retrieved_passages"
    elif any("zero_hits" in ln for ln in activity_lines):
        mode = "zero_hits"
    elif any("off_topic" in ln for ln in activity_lines):
        mode = "off_topic_hits"
    else:
        mode = "unknown"

    parts = [
        f"retrieval_mode: {mode}",
        f"passage_count: {passage_count}",
        f"profile_hits: {profile_hits}",
    ]
    if activity_lines:
        parts.append("activity: " + " | ".join(activity_lines[:3]))
    return "\n".join(parts)


def looks_like_valid_vault_negative_answer(
    *,
    user_message: str,
    llm_output: str,
    evidence: list[Any],
) -> bool:
    """
    User asked whether something exists in Vault/sources; assistant correctly reports absence
    while staying scoped to retrieved evidence (not hallucinating missing papers).
    """
    um = (user_message or "").strip()
    out = (llm_output or "").strip()
    if not um or not out:
        return False
    if not evidence:
        return False
    if not _USER_EXISTENCE_RE.search(um):
        return False
    if not _ASSISTANT_NEGATIVE_EVIDENCE_RE.search(out):
        return False
    return bool(_ASSISTANT_SCOPE_ANALYSIS_RE.search(out))
