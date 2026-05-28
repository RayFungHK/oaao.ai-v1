"""Corpus structure fingerprints, blueprint, and similarity scoring."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

_MEMBER_MARKER = re.compile(r"【第\s*\d+\s*號行員】")
_FIELD_LABEL_IN_TEXT = re.compile(r"([\u4e00-\u9fff]{2,16}|[A-Za-z][A-Za-z\s]{1,20}?)\s*[：:]\s*")


def _classify_of(seg: dict[str, Any]) -> dict[str, Any]:
    cj = seg.get("classify_json")
    return cj if isinstance(cj, dict) else {}


def fingerprint_from_segments(segments: list[dict[str, Any]]) -> dict[str, Any]:
    kinds: Counter[str] = Counter()
    block_names: Counter[str] = Counter()
    labels: list[str] = []
    seen_labels: set[str] = set()

    for seg in segments:
        if not isinstance(seg, dict):
            continue
        cj = _classify_of(seg)
        kind = str(cj.get("segment_kind") or "document_segment")
        kinds[kind] += 1
        blk = cj.get("block")
        if isinstance(blk, dict):
            name = str(blk.get("name") or "").strip()
            if name:
                block_names[name] += 1
        fields = cj.get("fields")
        if isinstance(fields, list):
            for f in fields:
                if isinstance(f, dict):
                    lab = str(f.get("label") or "").strip()
                    if lab and lab not in seen_labels:
                        seen_labels.add(lab)
                        labels.append(lab)

    return {
        "segment_count": sum(kinds.values()),
        "kind_counts": dict(kinds),
        "block_names": dict(block_names),
        "field_labels": labels[:48],
    }


def _fingerprint_tokens(fp: dict[str, Any]) -> set[str]:
    """Legacy tokens with counts — do not use for cross-source comparison."""
    tokens: set[str] = set()
    for kind, n in (fp.get("kind_counts") or {}).items():
        tokens.add(f"kind:{kind}:{n}")
    for name, n in (fp.get("block_names") or {}).items():
        tokens.add(f"block:{name}:{n}")
    for lab in fp.get("field_labels") or []:
        if isinstance(lab, str) and lab.strip():
            tokens.add(f"label:{lab.strip()}")
    return tokens


def _fingerprint_tokens_shape(fp: dict[str, Any]) -> set[str]:
    """Shape-only tokens (kinds, block names, field labels) — comparable across single files vs corpus."""
    tokens: set[str] = set()
    for kind in (fp.get("kind_counts") or {}).keys():
        if kind:
            tokens.add(f"kind:{kind}")
    for name in (fp.get("block_names") or {}).keys():
        if name:
            tokens.add(f"block:{name}")
    for lab in fp.get("field_labels") or []:
        if isinstance(lab, str) and lab.strip():
            tokens.add(f"label:{lab.strip()}")
    return tokens


def fingerprint_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    ta, tb = _fingerprint_tokens_shape(a), _fingerprint_tokens_shape(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def build_structure_blueprint(segments: list[dict[str, Any]]) -> dict[str, Any]:
    """Razy-like ordered layout from analyzed segments (for generate)."""
    layout: list[dict[str, Any]] = []
    kinds: Counter[str] = Counter()

    for seg in segments:
        if not isinstance(seg, dict):
            continue
        cj = _classify_of(seg)
        kind = str(cj.get("segment_kind") or "document_segment")
        kinds[kind] += 1
        item: dict[str, Any] = {
            "ordinal": int(seg.get("ordinal") if seg.get("ordinal") is not None else len(layout)),
            "segment_kind": kind,
        }
        blk = cj.get("block")
        if isinstance(blk, dict):
            item["block"] = {
                "name": blk.get("name"),
                "id": blk.get("id"),
                "path": blk.get("path"),
            }
            children = blk.get("children")
            if isinstance(children, list) and children:
                item["children"] = [
                    {"name": c.get("name"), "field_count": len(c.get("fields") or [])}
                    for c in children[:6]
                    if isinstance(c, dict)
                ]
        fc = cj.get("field_count")
        if fc:
            item["field_count"] = int(fc) if isinstance(fc, (int, float)) else 0
        layout.append(item)

    dominant = kinds.most_common(1)[0][0] if kinds else "document_segment"
    return {
        "version": 1,
        "dominant_segment_kind": dominant,
        "kind_counts": dict(kinds),
        "layout": layout[:80],
        "instructions": (
            "Generate MUST follow this layout order and segment_kind per section. "
            "Use placeholder entities for the user brief — do not copy analyzed source text verbatim."
        ),
    }


def score_sources_vs_corpus(
    per_source: list[dict[str, Any]],
    corpus_fp: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    per_source items: {source_id, label, fingerprint, segment_count}

    similarity = mean shape similarity to *other* sources (not merged corpus counts).
    Outlier = isolated vs the peer cluster (e.g. one 成員通告 among 行員通告 PDFs).
    corpus_fp is kept for API compatibility but not used for the displayed score.
    """
    del corpus_fp  # peer scoring only; corpus aggregate counts skewed per-file comparison

    peer_rows: list[tuple[dict[str, Any], dict[str, Any]]] = []
    scored: list[dict[str, Any]] = []

    for row in per_source:
        fp = row.get("fingerprint")
        if not isinstance(fp, dict) or int(fp.get("segment_count") or 0) < 1:
            scored.append(
                {
                    **row,
                    "similarity": None,
                    "outlier": False,
                    "reason": "no_segments",
                }
            )
            continue
        peer_rows.append((row, fp))

    n = len(peer_rows)
    peer_means: list[float] = []

    for i, (row, fp) in enumerate(peer_rows):
        if n <= 1:
            peer_mean = 1.0
        else:
            sims = [
                fingerprint_similarity(fp, peer_rows[j][1])
                for j in range(n)
                if j != i
            ]
            peer_mean = sum(sims) / len(sims)
        peer_means.append(peer_mean)
        scored.append(
            {
                **row,
                "similarity": round(peer_mean, 3),
                "outlier": False,
                "reason": "",
            }
        )

    if n < 3:
        return scored

    sorted_pm = sorted(peer_means)
    median = sorted_pm[n // 2]
    floor = max(0.28, median - 0.24)

    for row, peer_mean in zip(scored, peer_means):
        if peer_mean < floor and peer_mean < median * 0.55:
            row["outlier"] = True
            row["reason"] = (
                f"structure similarity {peer_mean:.0%} vs other sources (median {median:.0%}) — "
                "possible wrong upload"
            )

    return scored


def _normalize_text(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _char_trigrams(s: str) -> set[str]:
    s = _normalize_text(s)
    if len(s) < 3:
        return {s} if s else set()
    return {s[i : i + 3] for i in range(len(s) - 2)}


def fingerprint_from_markdown(md: str) -> dict[str, Any]:
    """Heuristic fingerprint of generated markdown for comparison."""
    kinds: Counter[str] = Counter()
    if _MEMBER_MARKER.search(md):
        kinds["template_block"] += len(_MEMBER_MARKER.findall(md))
    labels = []
    seen: set[str] = set()
    for m in _FIELD_LABEL_IN_TEXT.finditer(md):
        lab = (m.group(1) or "").strip()
        if lab and lab not in seen and len(lab) <= 20:
            seen.add(lab)
            labels.append(lab)
    if labels:
        kinds["structured_data"] += 1
    prose_len = len(re.sub(r"【第\s*\d+\s*號行員】|[\u4e00-\u9fff]{2,12}\s*[：:]", "", md))
    if prose_len > 120 and not labels:
        kinds["document_segment"] += 1
    elif prose_len > 80:
        kinds["document_segment"] += 1

    block_names: Counter[str] = Counter()
    if kinds.get("template_block"):
        block_names["member_record"] = kinds["template_block"]

    return {
        "segment_count": max(1, sum(kinds.values())),
        "kind_counts": dict(kinds),
        "block_names": dict(block_names),
        "field_labels": labels[:48],
    }


def compare_generate_to_corpus(
    markdown: str,
    segments: list[dict[str, Any]],
    *,
    blueprint: dict[str, Any] | None = None,
    target_score: float = 0.55,
) -> dict[str, Any]:
    """
    Post-generate validation: structure + text rhythm vs analyzed corpus.
    High score = output aligns with analyzed layout (ideal for style preview).
    """
    corpus_fp = fingerprint_from_segments(segments)
    out_fp = fingerprint_from_markdown(markdown)
    structure_sim = fingerprint_similarity(out_fp, corpus_fp)

    ref_parts: list[str] = []
    for seg in segments[:24]:
        if isinstance(seg, dict):
            t = str(seg.get("text") or "").strip()
            if t:
                ref_parts.append(t[:800])
    ref_text = "\n".join(ref_parts)[:12_000]
    ta = _char_trigrams(ref_text)
    tb = _char_trigrams(markdown)
    if ta and tb:
        text_sim = len(ta & tb) / len(ta | tb)
    else:
        text_sim = 0.0

    layout_match = 1.0
    if blueprint and isinstance(blueprint.get("layout"), list):
        layout = blueprint["layout"]
        dom = str(blueprint.get("dominant_segment_kind") or "")
        if dom == "template_block" and not _MEMBER_MARKER.search(markdown):
            layout_match *= 0.65
        if dom == "structured_data" and len(_FIELD_LABEL_IN_TEXT.findall(markdown)) < 2:
            layout_match *= 0.7
        expected_blocks = sum(
            1 for x in layout if isinstance(x, dict) and x.get("segment_kind") == "template_block"
        )
        found_blocks = len(_MEMBER_MARKER.findall(markdown))
        if expected_blocks >= 2 and found_blocks < expected_blocks // 2:
            layout_match *= 0.6

    score = 0.5 * structure_sim + 0.25 * text_sim + 0.25 * layout_match
    score = max(0.0, min(1.0, score))

    return {
        "score": round(score, 3),
        "structure_similarity": round(structure_sim, 3),
        "text_similarity": round(text_sim, 3),
        "layout_match": round(layout_match, 3),
        "meets_target": score >= target_score,
        "target_score": target_score,
    }
