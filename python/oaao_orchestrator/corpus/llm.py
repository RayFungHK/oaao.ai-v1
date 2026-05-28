"""Corpus Studio — OpenAI-compatible LLM helpers (style learn + generate preview)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

# Used in build_generate_context (member-record markers in source text).
_RE_MEMBER_MARKER = re.compile(r"【第\s*\d+\s*號行員】")

import httpx

from oaao_orchestrator.asr_common import _resolve_secret, openai_compat_chat_url

logger = logging.getLogger(__name__)

_STYLE_JSON_KEYS = frozenset(
    {
        "version",
        "structure",
        "lexicon",
        "formatting",
        "tone",
        "dos",
        "donts",
        "meta",
    },
)


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


def _extract_json_array(text: str) -> list[Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        dec = json.loads(raw)
        if isinstance(dec, list):
            return dec
        if isinstance(dec, dict) and isinstance(dec.get("rows"), list):
            return dec["rows"]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return None
    try:
        dec = json.loads(m.group(0))
        return dec if isinstance(dec, list) else None
    except json.JSONDecodeError:
        return None


async def chat_completion_text(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    system: str,
    user: str,
    temperature: float = 0.3,
    timeout_sec: float = 120.0,
) -> str | None:
    if not llm_cfg or not isinstance(llm_cfg, dict):
        return None
    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        return None

    api_key = _resolve_secret(
        llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None
    )
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
        "temperature": max(0.0, min(1.5, float(temperature))),
        "stream": False,
    }

    try:
        r = await client.post(
            url,
            headers=headers,
            json=body,
            timeout=httpx.Timeout(max(15.0, float(timeout_sec)), connect=15.0),
        )
        if r.status_code >= 400:
            logger.warning("corpus llm http %s", r.status_code)
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
        return content.strip() if isinstance(content, str) and content.strip() else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("corpus llm failed: %s", exc)
        return None


def _normalize_style_json(raw: dict[str, Any], *, segment_count: int) -> dict[str, Any]:
    out: dict[str, Any] = {
        "version": int(raw.get("version") or 1),
        "structure": raw.get("structure") if isinstance(raw.get("structure"), dict) else {},
        "lexicon": raw.get("lexicon") if isinstance(raw.get("lexicon"), dict) else {},
        "formatting": raw.get("formatting") if isinstance(raw.get("formatting"), dict) else {},
        "tone": str(raw.get("tone") or "neutral"),
        "dos": raw.get("dos") if isinstance(raw.get("dos"), list) else [],
        "donts": raw.get("donts") if isinstance(raw.get("donts"), list) else [],
        "meta": raw.get("meta") if isinstance(raw.get("meta"), dict) else {},
    }
    meta = out["meta"]
    if not isinstance(meta, dict):
        meta = {}
        out["meta"] = meta
    meta["segment_count"] = segment_count
    if "style_confidence" in raw:
        try:
            meta["style_confidence"] = max(0.0, min(1.0, float(raw["style_confidence"])))
        except (TypeError, ValueError):
            pass
    elif "style_confidence" in meta:
        try:
            meta["style_confidence"] = max(0.0, min(1.0, float(meta["style_confidence"])))
        except (TypeError, ValueError):
            pass
    if "style_source" not in meta:
        meta["style_source"] = "llm"
    return out


def merge_style_json(
    heuristic: dict[str, Any],
    llm_style: dict[str, Any] | None,
    *,
    segment_count: int,
) -> dict[str, Any]:
    """Prefer LLM fields when present; keep heuristic meta fallbacks."""
    base = _normalize_style_json(heuristic, segment_count=segment_count)
    if not llm_style:
        meta = base.setdefault("meta", {})
        if isinstance(meta, dict):
            meta.setdefault("style_source", "heuristic")
        return base

    llm = _normalize_style_json(llm_style, segment_count=segment_count)
    for key in _STYLE_JSON_KEYS:
        val = llm.get(key)
        if val is None:
            continue
        if key == "meta" and isinstance(val, dict):
            merged = dict(base.get("meta") or {})
            merged.update(val)
            merged["segment_count"] = segment_count
            merged["style_source"] = "llm"
            base["meta"] = merged
        elif key in ("dos", "donts") and isinstance(val, list) and val:
            base[key] = val
        elif key == "tone" and str(val).strip():
            base["tone"] = str(val).strip()
        elif isinstance(val, dict) and val:
            base[key] = val
        elif isinstance(val, (str, int, float)) and str(val).strip():
            base[key] = val
    return base


def sample_segments_for_llm(
    segments: list[dict[str, Any]],
    *,
    max_segments: int = 24,
    max_chars: int = 24_000,
) -> list[dict[str, Any]]:
    """Stratified sample: structured_data → template_block → document_segment."""
    structured: list[dict[str, Any]] = []
    template: list[dict[str, Any]] = []
    document: list[dict[str, Any]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        cj = seg.get("classify_json")
        kind = ""
        if isinstance(cj, dict):
            kind = str(cj.get("segment_kind") or "")
        if kind == "structured_data":
            structured.append(seg)
        elif kind == "template_block":
            template.append(seg)
        else:
            document.append(seg)
    ordered = structured + template + document
    out: list[dict[str, Any]] = []
    used = 0
    for seg in ordered:
        if len(out) >= max_segments:
            break
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        if used + len(text) > max_chars and out:
            break
        out.append(seg)
        used += len(text)
    return out


_NARRATIVE_BRIEF_RE = re.compile(
    r"通知|公告|函|書信|郵件|paragraph|段落|段|說明|更新|上線|memo|letter|notice|正式|公司",
    re.IGNORECASE,
)
_STRUCTURED_BRIEF_RE = re.compile(
    r"表格|table|列表|多筆|多個行員|member|template\s*block|欄位清單|field\s*list|registry",
    re.IGNORECASE,
)


def infer_generate_output_mode(brief: str) -> str:
    """``narrative`` = flowing document; ``structured`` = explicit forms/tables in brief."""
    b = (brief or "").strip()
    if not b:
        return "narrative"
    wants_structured = bool(_STRUCTURED_BRIEF_RE.search(b))
    wants_narrative = bool(_NARRATIVE_BRIEF_RE.search(b))
    if wants_structured and not wants_narrative:
        return "structured"
    return "narrative"


def _style_json_for_generate(style_json: dict[str, Any], mode: str) -> dict[str, Any]:
    """Narrative previews: tone/lexicon only — drop structure cues that invite registry blocks."""
    if mode != "narrative":
        return style_json
    slim: dict[str, Any] = {"version": style_json.get("version", 1)}
    for key in ("tone", "dos", "donts", "lexicon", "formatting"):
        if key in style_json:
            slim[key] = style_json[key]
    meta = style_json.get("meta")
    if isinstance(meta, dict):
        slim["meta"] = {"style_source": meta.get("style_source")}
    return slim


def _generate_looks_like_registry_stitch(md: str) -> bool:
    if _RE_MEMBER_MARKER.search(md) or re.search(r"【第\s*\d+", md):
        return True
    if re.search(r"(實體細節|Entity\s*Details|程序說明|號行員)", md, re.I):
        return True
    if len(re.findall(r"[\u4e00-\u9fff]{2,16}\s*[：:]\s*\S", md)) >= 3:
        return True
    return False


def build_generate_context(
    sample_segments: list[dict[str, Any]],
    *,
    prose_max_chars: int = 480,
    output_mode: str = "narrative",
    brief: str = "",
) -> str:
    """
    Compact digest for preview generation — structure/tone hints only.

    Avoids pasting template_block / structured_data verbatim (which makes the model
    stitch disjoint 【第 N 號行員】 rows instead of writing one cohesive document).
    """
    kinds: dict[str, int] = {
        "document_segment": 0,
        "template_block": 0,
        "structured_data": 0,
    }
    block_names: dict[str, int] = {}
    field_labels: list[str] = []
    seen_labels: set[str] = set()
    prose_sample = ""

    for seg in sample_segments:
        if not isinstance(seg, dict):
            continue
        cj = seg.get("classify_json")
        if not isinstance(cj, dict):
            cj = {}
        kind = str(cj.get("segment_kind") or "document_segment")
        if kind not in kinds:
            kind = "document_segment"
        kinds[kind] += 1

        if kind == "template_block":
            blk = cj.get("block")
            if isinstance(blk, dict):
                name = str(blk.get("name") or "block").strip() or "block"
                block_names[name] = block_names.get(name, 0) + 1
            continue

        if kind == "structured_data":
            fields = cj.get("fields")
            if isinstance(fields, list):
                for f in fields:
                    if not isinstance(f, dict):
                        continue
                    lab = str(f.get("label") or "").strip()
                    if lab and lab not in seen_labels:
                        seen_labels.add(lab)
                        field_labels.append(lab)
            continue

        if kind == "document_segment" and not prose_sample:
            text = str(seg.get("text") or "").strip()
            if text and not _RE_MEMBER_MARKER.search(text):
                prose_sample = text[:prose_max_chars]

    mode = output_mode if output_mode in ("narrative", "structured") else infer_generate_output_mode(brief)

    if mode == "narrative":
        lines = [
            "Output mode: narrative_document (match brief — NOT a source reprint).",
            (
                f"- analyzed sources included {kinds['template_block']} template blocks and "
                f"{kinds['structured_data']} field groups — ignore their layout for this output."
            ),
        ]
        if prose_sample:
            lines.append(f"- tone/rhythm only (paraphrase):\n{prose_sample[:prose_max_chars]}")
        lines.extend(
            [
                "FORBIDDEN: 【第 N 號行員】, 行員名稱：, 註冊地址：, fax/phone label lines, "
                "section headings like 實體細節/程序說明/Entity Details, field bullet lists.",
                "REQUIRED: plain paragraphs (and brief sign-off if appropriate) exactly as the user brief asks.",
            ]
        )
        return "\n".join(lines)

    lines = [
        "Output mode: structured_document (brief allows forms/tables).",
        (
            f"- segments: document={kinds['document_segment']}, "
            f"template_block={kinds['template_block']}, "
            f"structured_data={kinds['structured_data']}"
        ),
    ]
    if block_names:
        parts = [f"{name}×{count}" for name, count in sorted(block_names.items())]
        lines.append(f"- repeating block layout (Razy-style): {', '.join(parts)}")
    if field_labels:
        lines.append(f"- typical field labels: {', '.join(field_labels[:14])}")
    if prose_sample:
        lines.append(f"- prose rhythm sample (paraphrase; do not copy facts):\n{prose_sample}")
    lines.append(
        "- Still write ONE intentional document for the brief — do not paste unrelated source rows."
    )
    return "\n".join(lines)


async def refine_segment_kinds_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    segments: list[dict[str, Any]],
) -> None:
    """
    Optional LLM pass: refine segment_kind on non-structured segments (mutates classify_json).
    """
    if not llm_cfg or not segments:
        return

    from oaao_orchestrator.corpus.segmenting import SEGMENT_KIND_STRUCTURED

    candidates: list[tuple[int, str, str]] = []
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict):
            continue
        cj = seg.get("classify_json")
        if not isinstance(cj, dict):
            cj = {}
            seg["classify_json"] = cj
        if str(cj.get("segment_kind") or "") == SEGMENT_KIND_STRUCTURED:
            continue
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        hint = str(cj.get("segment_kind") or "document_segment")
        candidates.append((i, text[:1800], hint))
        if len(candidates) >= 36:
            break

    if not candidates:
        return

    lines = [
        f'{idx + 1}. [{hint}] {text[:1200].replace(chr(10), " ")}'
        for idx, (_, text, hint) in enumerate(candidates)
    ]
    system = (
        "Classify each numbered excerpt into exactly one segment_kind:\n"
        "- document_segment: narrative prose, letter intro, explanations\n"
        "- template_block: one row/record in a table or repeating Razy-style block "
        "(member_record, table_row — often tagged in excerpt). Prefer template_block "
        "when the excerpt is a single numbered row or 【第 N 號行員】 record.\n"
        "- structured_data: only compact label:value groups that are NOT a table row\n"
        "Output ONLY JSON: "
        '{"segments":[{"n":1,"segment_kind":"document_segment"},...]} '
        "n is 1-based index matching the list order."
    )
    user = "Excerpts:\n" + "\n".join(lines)
    raw = await chat_completion_text(client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.1)
    if not raw:
        return
    parsed = _extract_json_object(raw)
    if not parsed:
        return
    rows = parsed.get("segments")
    if not isinstance(rows, list):
        return
    allowed = frozenset({"document_segment", "template_block", "structured_data"})
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            n = int(row.get("n") or 0)
        except (TypeError, ValueError):
            continue
        if n < 1 or n > len(candidates):
            continue
        kind = str(row.get("segment_kind") or "").strip()
        if kind not in allowed:
            continue
        seg_i, _, _ = candidates[n - 1]
        cj = segments[seg_i].get("classify_json")
        if isinstance(cj, dict) and str(cj.get("segment_kind") or "") != SEGMENT_KIND_STRUCTURED:
            cj["segment_kind"] = kind
            cj["kind_source"] = "llm"


async def extract_style_json_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    profile_name: str,
    segments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    sampled = sample_segments_for_llm(segments)
    if not sampled:
        return None

    lines: list[str] = []
    for i, seg in enumerate(sampled, start=1):
        text = str(seg.get("text") or "").strip()
        cj = seg.get("classify_json")
        kind = ""
        if isinstance(cj, dict):
            kind = str(cj.get("segment_kind") or cj.get("genre") or "")
        block = cj.get("block") if isinstance(cj.get("block"), dict) else {}
        block_path = str(block.get("path") or block.get("name") or "")
        prefix = f"[{kind}"
        if block_path:
            prefix += f" {block_path}"
        prefix += "] "
        lines.append(f"### Excerpt {i}\n{prefix}{text[:2000]}")

    system = (
        "You extract a writing style profile from source excerpts for a Corpus Studio profile. "
        "Excerpts use segment_kind (Razy Template–like): document_segment (prose), "
        "template_block (table_row / member_record blocks with optional block.path), "
        "structured_data (flat label:value). Learn repeating block layout from "
        "template_block rows; nested cell patterns from block.children when present.\n"
        "Output ONLY valid JSON matching this schema:\n"
        '{"version":1,"structure":{"sections":[],"heading_style":""},'
        '"lexicon":{"preferred_terms":[],"avoid_terms":[]},'
        '"formatting":{"list_style":"","citation_style":""},'
        '"tone":"","dos":[],"donts":[],"meta":{"style_confidence":0.0}}}\n'
        "style_confidence is 0-1 (how consistent/clear the style signal is). "
        "Use the same language as the dominant source language. "
        "dos/donts are short imperative strings for writers."
    )
    user = (
        f"Profile name: {profile_name or 'Corpus'}\n\n"
        "Source excerpts:\n\n"
        + "\n\n".join(lines)
    )
    raw = await chat_completion_text(client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.2)
    if not raw:
        return None
    parsed = _extract_json_object(raw)
    if not parsed:
        return None
    return _normalize_style_json(parsed, segment_count=len(segments))


async def generate_preview_markdown(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    brief: str,
    profile_name: str,
    style_json: dict[str, Any],
    sample_segments: list[dict[str, Any]],
) -> dict[str, Any]:
    from oaao_orchestrator.corpus.structure import (
        build_structure_blueprint,
        compare_generate_to_corpus,
    )

    brief = (brief or "").strip()
    if not brief:
        return {"ok": False, "error": "brief_required"}

    meta = style_json.get("meta") if isinstance(style_json.get("meta"), dict) else {}
    blueprint = meta.get("structure_blueprint") if isinstance(meta, dict) else None
    if not isinstance(blueprint, dict) or not blueprint.get("layout"):
        blueprint = build_structure_blueprint(sample_segments)

    style_block = json.dumps(style_json, ensure_ascii=False, indent=2)[:5000]
    blueprint_block = json.dumps(blueprint, ensure_ascii=False, indent=2)[:6000]
    dom = str(blueprint.get("dominant_segment_kind") or "document_segment")

    system = (
        "You write a sample document for the user brief that MUST follow structure_blueprint "
        "(same segment_kind sequence, block types, and field-layout patterns as the analyzed corpus). "
        "Fulfill the brief with NEW placeholder names/facts — do not copy analyzed source text. "
        "Apply style_json for tone, lexicon, and formatting. "
        "One intentional document — sections in blueprint order. Output markdown only."
    )

    user = (
        f"Profile: {profile_name or 'Corpus'}\n\n"
        f"User brief:\n{brief}\n\n"
        f"Dominant analyzed structure: {dom}\n\n"
        f"structure_blueprint (MUST follow):\n{blueprint_block}\n\n"
        f"style_json:\n{style_block}\n"
    )

    md = await chat_completion_text(
        client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.35, timeout_sec=90.0
    )
    if not md:
        return {"ok": False, "error": "generate_failed", "detail": "LLM unavailable or empty response"}

    similarity = compare_generate_to_corpus(md, sample_segments, blueprint=blueprint)
    if not similarity.get("meets_target") and float(similarity.get("score", 0)) < 0.45:
        retry_user = (
            user
            + "\n\nRETRY: Previous draft had low structure similarity to the analyzed corpus. "
            f"Scores: {similarity}. Follow structure_blueprint layout more closely "
            "(same block types and label：value patterns) while still using brief content."
        )
        md2 = await chat_completion_text(
            client,
            llm_cfg=llm_cfg,
            system=system,
            user=retry_user,
            temperature=0.3,
            timeout_sec=75.0,
        )
        if md2:
            sim2 = compare_generate_to_corpus(md2, sample_segments, blueprint=blueprint)
            if sim2.get("score", 0) >= similarity.get("score", 0):
                md = md2
                similarity = sim2

    return {
        "ok": True,
        "markdown": md,
        "brief": brief,
        "similarity": similarity,
        "structure_blueprint": blueprint,
    }


async def fill_table_rows_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    brief: str,
    profile_name: str,
    template: dict[str, Any],
) -> list[dict[str, Any]]:
    """Generate table rows JSON for layout_type=table templates."""
    brief = (brief or "").strip()
    if not brief or not llm_cfg or not llm_cfg.get("base_url") or not llm_cfg.get("model"):
        return []

    columns = template.get("columns") if isinstance(template.get("columns"), list) else []
    sample = template.get("sample_rows") if isinstance(template.get("sample_rows"), list) else []
    system = (
        "You generate rows for a formal membership notice TABLE. "
        "Output ONLY valid JSON array of row objects. Each object uses column keys: "
        "id, before, after, introducer, date (strings). "
        "Match the style of sample_rows. Use Traditional Chinese where appropriate. "
        "Do not copy sample_rows verbatim unless the brief asks to keep them."
    )
    user = (
        f"Profile: {profile_name or 'Corpus'}\n\n"
        f"Brief:\n{brief}\n\n"
        f"columns:\n{json.dumps(columns, ensure_ascii=False)[:2000]}\n\n"
        f"sample_rows (style reference):\n{json.dumps(sample[:3], ensure_ascii=False)[:4000]}\n"
    )
    raw = await chat_completion_text(
        client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.3, timeout_sec=60.0
    )
    if not raw:
        return []
    parsed = _extract_json_array(raw)
    if isinstance(parsed, list):
        return [r for r in parsed if isinstance(r, dict)][:32]
    return []


async def fill_template_parameters_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any] | None,
    brief: str,
    profile_name: str,
    template: dict[str, Any],
) -> dict[str, str]:
    """Map user brief → template parameter keys (HTML track)."""
    brief = (brief or "").strip()
    if str(template.get("layout_type") or "") == "table":
        header_out: dict[str, str] = {}
        nh = template.get("notice_header") if isinstance(template.get("notice_header"), dict) else {}
        header_params = [
            p
            for p in (template.get("parameters") or [])
            if isinstance(p, dict) and str(p.get("key") or "") in ("file_ref", "notice_date", "salutation", "notice_title", "intro_paragraph")
        ]
        if header_params and brief:
            spec = json.dumps(header_params, ensure_ascii=False)[:3000]
            defaults = nh.get("defaults") if isinstance(nh.get("defaults"), dict) else {}
            system_h = (
                "You update formal notice letterhead fields from the user brief. "
                "Output ONLY valid JSON object with keys from the schema. Traditional Chinese."
            )
            user_h = (
                f"Brief:\n{brief}\n\nschema:\n{spec}\n\n"
                f"current defaults:\n{json.dumps(defaults, ensure_ascii=False)[:2000]}\n"
            )
            raw_h = await chat_completion_text(
                client, llm_cfg=llm_cfg, system=system_h, user=user_h, temperature=0.2, timeout_sec=45.0
            )
            parsed_h = _extract_json_object(raw_h or "")
            if isinstance(parsed_h, dict):
                for p in header_params:
                    k = str(p.get("key") or "")
                    if k and k in parsed_h:
                        header_out[k] = str(parsed_h[k]).strip()[:2000]
        rows = await fill_table_rows_llm(
            client,
            llm_cfg=llm_cfg,
            brief=brief,
            profile_name=profile_name,
            template=template,
        )
        out: dict[str, str] = {**header_out}
        if rows:
            out["table_rows"] = json.dumps(rows, ensure_ascii=False)
        return out

    params_spec = template.get("parameters")
    if not isinstance(params_spec, list) or not params_spec:
        return {}
    keys: list[dict[str, str]] = []
    for p in params_spec[:80]:
        if not isinstance(p, dict):
            continue
        key = str(p.get("key") or "").strip()
        if not key:
            continue
        keys.append(
            {
                "key": key,
                "label": str(p.get("label") or key),
                "max_chars": str(int(p.get("max_chars") or 280)),
            }
        )
    if not keys or not brief:
        return {}

    if not llm_cfg or not llm_cfg.get("base_url") or not llm_cfg.get("model"):
        return {}

    spec = json.dumps(keys, ensure_ascii=False, indent=2)[:4000]
    system = (
        "You fill HTML template parameters from the user brief. "
        "Output ONLY valid JSON object: keys are parameter keys, values are short strings. "
        "Use the user language. Do not invent keys outside the list."
    )
    user = (
        f"Profile: {profile_name or 'Corpus'}\n\n"
        f"Brief:\n{brief}\n\n"
        f"parameters schema:\n{spec}\n"
    )
    raw = await chat_completion_text(
        client, llm_cfg=llm_cfg, system=system, user=user, temperature=0.25, timeout_sec=45.0
    )
    if not raw:
        return {}
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        return {}
    allowed = {k["key"] for k in keys}
    out: dict[str, str] = {}
    for k, v in parsed.items():
        sk = str(k).strip()
        if sk not in allowed:
            continue
        out[sk] = str(v).strip()[:400]
    return out
