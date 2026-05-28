"""Corpus analyze segmentation — Razy Template–like block tree + segment kinds."""

from __future__ import annotations

import re
from typing import Any

_CHUNK_CHARS_DEFAULT = 1800

SEGMENT_KIND_DOCUMENT = "document_segment"
SEGMENT_KIND_TEMPLATE = "template_block"
SEGMENT_KIND_STRUCTURED = "structured_data"

# Label before full-width or ASCII colon (HK forms, registry notices).
_FIELD_LABEL_RE = re.compile(
    r"(?:(?<=^)|(?<=\s)|(?<=[，,;；。.!?\n]))"
    r"([\u4e00-\u9fff]+(?:\s+[\u4e00-\u9fff]+){0,4}"
    r"|[A-Z][A-Za-z0-9\s/（）()\-]{0,24}?)"
    r"\s*[：:]\s*",
)

_MEMBER_RECORD_RE = re.compile(r"【第\s*(\d+)\s*號行員】\s*[:：]?\s*")

# Member-notice rows use zero-padded 3-digit ids (018); avoid matching years (2026 年…).
_TABLE_ROW_START_RE = re.compile(r"(?m)^(?P<id>\d{3})(?:\s+|\t)(?P<rest>.+)$")
_TABLE_ROW_SPLIT_RE = re.compile(r"(?m)(?=^\d{3}(?:\s+|\t))")

_TABLE_HEADER_HINT_RE = re.compile(r"編號|行員名稱|公佈日期|執行司理")

_TEMPLATE_HEADER_RE = re.compile(
    r"(?m)^(?:"
    r"第[一二三四五六七八九十百千\d]+[條节節项項]"
    r"|\d+[\.\)、]"
    r"|Article\s+\d+"
    r"|Section\s+\d+"
    r"|【[^】]{1,48}】"
    r"|\[[^\]]{1,48}\]"
    r")\s*",
    re.IGNORECASE,
)

# Field labels that often repeat per table row / member record.
_RECORD_ANCHOR_LABELS = frozenset(
    {
        "行員名稱",
        "執行司理人",
        "註冊地址",
        "更改行員名稱前行員名稱及執行司理人",
        "更改行員名稱後行員名稱及執行司理人",
    },
)


def _field_label_count(text: str) -> int:
    return len(_FIELD_LABEL_RE.findall(text))


def _normalize_label(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip())


def _parse_structured_fields(block: str) -> list[dict[str, str]]:
    matches = list(_FIELD_LABEL_RE.finditer(block))
    if len(matches) < 2:
        return []

    fields: list[dict[str, str]] = []
    for i, match in enumerate(matches):
        label = _normalize_label(match.group(1))
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(block)
        value = block[start:end].strip().strip("，,;；")
        if label and value:
            fields.append({"label": label, "value": value})
    return fields


def _format_fields_text(fields: list[dict[str, str]], *, title: str = "") -> str:
    lines: list[str] = []
    if title:
        lines.append(title)
    lines.extend(f"{f['label']}：{f['value']}" for f in fields[:32])
    if len(fields) > 32:
        lines.append(f"… +{len(fields) - 32} more fields")
    return "\n".join(lines)


def _classify_excerpt_light(text: str) -> dict[str, Any]:
    sample = text[:800].lower()
    lang = "zh" if re.search(r"[\u4e00-\u9fff]", sample) else "en"
    genre = "technical" if re.search(r"\b(api|function|class|def |import )\b", sample) else "general"
    tone = "formal" if re.search(r"\b(shall|must|therefore|accordingly)\b", sample) else "neutral"
    return {
        "genre": genre,
        "audience": "general",
        "tone": tone,
        "language": lang,
        "domain": "unknown",
    }


def _block_tree_classify(
    block_name: str,
    block_id: str,
    *,
    fields: list[dict[str, str]] | None = None,
    children: list[dict[str, Any]] | None = None,
    parent_path: list[str] | None = None,
    block_text: str = "",
) -> dict[str, Any]:
    """Razy Template–aligned block node (name + id + nested children)."""
    path_parts = list(parent_path or [])
    seg = f"{block_name}[{block_id}]" if block_id else block_name
    path_parts.append(seg)
    base = _classify_excerpt_light(block_text or _format_fields_text(fields or [], title=seg))
    base["segment_kind"] = SEGMENT_KIND_TEMPLATE
    base["template_signal"] = "razy_block"
    flds = fields or []
    ch = children or []
    base["block"] = {
        "name": block_name,
        "id": block_id,
        "path": "/" + "/".join(path_parts),
        "fields": flds[:48],
        "children": ch[:24],
    }
    base["field_count"] = len(flds)
    if flds:
        base["fields"] = flds[:48]
    return base


def _structured_classify(fields: list[dict[str, str]], block: str) -> dict[str, Any]:
    base = _classify_excerpt_light(block)
    base["segment_kind"] = SEGMENT_KIND_STRUCTURED
    base["field_count"] = len(fields)
    base["fields"] = fields[:48]
    return base


def _split_fields_on_record_anchors(fields: list[dict[str, str]]) -> list[list[dict[str, str]]] | None:
    """Split when the same record anchor label appears again (new table row / member)."""
    if len(fields) < 4:
        return None

    groups: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    anchor_hits: dict[str, int] = {}

    for f in fields:
        lab = str(f.get("label") or "")
        val = str(f.get("value") or "")
        if _MEMBER_RECORD_RE.search(val):
            if current:
                groups.append(current)
            current = [f]
            anchor_hits = {}
            continue
        if lab in _RECORD_ANCHOR_LABELS:
            anchor_hits[lab] = anchor_hits.get(lab, 0) + 1
            if anchor_hits[lab] >= 2 and current:
                groups.append(current)
                current = []
                anchor_hits = {lab: 1}
        current.append(f)

    if current:
        groups.append(current)

    if len(groups) < 2:
        return None
    return groups


def _parse_table_row_children(row_body: str) -> list[dict[str, Any]]:
    """Nested blocks inside a table row (cells / multi-line stacks)."""
    fields = _parse_structured_fields(row_body)
    if fields:
        return [{"name": "cell_fields", "fields": fields}]

    lines = [ln.strip() for ln in row_body.splitlines() if ln.strip()]
    if len(lines) >= 2:
        mid = max(1, len(lines) // 2)
        return [
            {"name": "cell_before", "lines": lines[:mid]},
            {"name": "cell_after", "lines": lines[mid:]},
        ]
    if lines:
        return [{"name": "cell", "lines": lines}]
    return []


def _segment_table_rows(span: str, *, parent_path: list[str] | None = None) -> list[tuple[str, dict[str, Any]]] | None:
    if not _TABLE_HEADER_HINT_RE.search(span):
        return None

    chunks = _TABLE_ROW_SPLIT_RE.split(span)
    rows: list[tuple[str, str]] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        m = _TABLE_ROW_START_RE.match(chunk)
        if not m:
            continue
        row_id = m.group("id")
        body = m.group("rest").strip()
        if body:
            rows.append((row_id, body))

    if len(rows) < 2:
        return None

    out: list[tuple[str, dict[str, Any]]] = []
    first_row = _TABLE_ROW_SPLIT_RE.search(span)
    if first_row and first_row.start() > 0:
        preamble = span[: first_row.start()].strip()
        if preamble:
            for chunk in _prose_chunks(preamble, max_chars=_CHUNK_CHARS_DEFAULT):
                out.append(
                    (
                        chunk,
                        _classify_document_chunk(chunk, full_text=span, repeated_skeletons=None),
                    ),
                )

    ppath = list(parent_path or [])
    ppath.append("table")
    for row_id, body in rows:
        children = _parse_table_row_children(body)
        title = f"Row {row_id}"
        text = f"{title}\n{body[:1200]}"
        out.append(
            (
                text,
                _block_tree_classify(
                    "table_row",
                    row_id,
                    children=children,
                    parent_path=ppath,
                    block_text=body,
                ),
            ),
        )
    return out


def _segment_member_records(span: str, *, parent_path: list[str] | None = None) -> list[tuple[str, dict[str, Any]]] | None:
    markers = list(_MEMBER_RECORD_RE.finditer(span))
    if not markers:
        return None

    out: list[tuple[str, dict[str, Any]]] = []
    ppath = list(parent_path or [])
    ppath.append("member_table")

    for i, m in enumerate(markers):
        member_id = m.group(1)
        start = m.end()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(span)
        block_text = span[start:end].strip()
        fields = _parse_structured_fields(block_text)
        children: list[dict[str, Any]] = []
        if fields:
            children.append({"name": "record_fields", "fields": fields})
        title = f"【第 {member_id} 號行員】"
        text = _format_fields_text(fields, title=title) if fields else title
        out.append(
            (
                text,
                _block_tree_classify(
                    "member_record",
                    member_id,
                    fields=fields,
                    children=children,
                    parent_path=ppath,
                    block_text=block_text,
                ),
            ),
        )
    return out if out else None


def _fields_to_block_segments(
    fields: list[dict[str, str]],
    span_text: str,
    *,
    parent_path: list[str] | None = None,
) -> list[tuple[str, dict[str, Any]]] | None:
    member = _segment_member_records(span_text, parent_path=parent_path)
    if member:
        return member

    table = _segment_table_rows(span_text, parent_path=parent_path)
    if table:
        return table

    groups = _split_fields_on_record_anchors(fields)
    if not groups:
        return None

    out: list[tuple[str, dict[str, Any]]] = []
    ppath = list(parent_path or [])
    ppath.append("records")
    for idx, grp in enumerate(groups, start=1):
        row_id = str(idx)
        m = _MEMBER_RECORD_RE.search(" ".join(f["value"] for f in grp))
        if m:
            row_id = m.group(1)
        children = [{"name": "record_fields", "fields": grp}]
        text = _format_fields_text(grp, title=f"Record {row_id}")
        out.append(
            (
                text,
                _block_tree_classify(
                    "record",
                    row_id,
                    fields=grp,
                    children=children,
                    parent_path=ppath,
                    block_text=text,
                ),
            ),
        )
    return out


def _paragraph_skeleton(paragraph: str) -> str:
    s = paragraph.strip()
    if not s:
        return ""
    s = re.sub(r"\d+", "#", s)
    s = re.sub(r"[A-Za-z0-9]{8,}", "#", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s[:240]


def _repeated_paragraph_skeletons(full_text: str, *, min_para_len: int = 48) -> set[str]:
    counts: dict[str, int] = {}
    for para in re.split(r"\n{2,}", full_text):
        para = para.strip()
        if len(para) < min_para_len:
            continue
        sk = _paragraph_skeleton(para)
        if len(sk) < 24:
            continue
        counts[sk] = counts.get(sk, 0) + 1
    return {sk for sk, n in counts.items() if n >= 2}


def _line_duplicate_ratio(text: str) -> float:
    lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) >= 12]
    if len(lines) < 3:
        return 0.0
    seen: dict[str, int] = {}
    dup = 0
    for ln in lines:
        sk = _paragraph_skeleton(ln)
        if not sk:
            continue
        seen[sk] = seen.get(sk, 0) + 1
        if seen[sk] == 2:
            dup += 1
    return dup / max(1, len(lines))


def _is_template_block_chunk(
    chunk: str,
    *,
    repeated_skeletons: set[str],
) -> bool:
    if not chunk.strip():
        return False

    headers = _TEMPLATE_HEADER_RE.findall(chunk)
    if len(headers) >= 2:
        return True

    if _line_duplicate_ratio(chunk) >= 0.34:
        return True

    for para in re.split(r"\n{2,}", chunk):
        para = para.strip()
        if len(para) < 40:
            continue
        sk = _paragraph_skeleton(para)
        if sk and sk in repeated_skeletons:
            return True

    return False


def _classify_document_chunk(
    chunk: str,
    *,
    full_text: str,
    repeated_skeletons: set[str] | None = None,
) -> dict[str, Any]:
    base = _classify_excerpt_light(chunk)
    reps = repeated_skeletons if repeated_skeletons is not None else _repeated_paragraph_skeletons(full_text)
    if _is_template_block_chunk(chunk, repeated_skeletons=reps):
        base["segment_kind"] = SEGMENT_KIND_TEMPLATE
        base["template_signal"] = "repetitive_block"
    else:
        base["segment_kind"] = SEGMENT_KIND_DOCUMENT
    return base


def _group_label_spans(text: str, matches: list[re.Match[str]]) -> list[tuple[int, int, list[dict[str, str]]]]:
    """Merge consecutive label:value runs into one structured block."""
    groups: list[tuple[int, int, list[dict[str, str]]]] = []
    i = 0
    while i < len(matches):
        j = i + 1
        while j < len(matches):
            between = text[matches[j - 1].end() : matches[j].start()]
            if "\n\n" in between or len(between) > 500:
                break
            j += 1
        if j - i < 2:
            i += 1
            continue

        start = matches[i].start()
        end = matches[j - 1].end()
        if j < len(matches):
            end = matches[j].start()
        else:
            tail = text[end:]
            break_at = tail.find("\n\n")
            if break_at != -1:
                end += break_at
            else:
                end = len(text)

        block = text[start:end]
        fields = _parse_structured_fields(block)
        if len(fields) >= 2:
            groups.append((start, end, fields))
        i = j
    return groups


def _prose_chunks(text: str, *, max_chars: int) -> list[str]:
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return []

    parts = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    if not parts:
        parts = [raw]

    out: list[str] = []
    buf = ""
    for part in parts:
        if len(part) > max_chars:
            if buf:
                out.append(buf)
                buf = ""
            for idx in range(0, len(part), max_chars):
                out.append(part[idx : idx + max_chars])
            continue
        candidate = f"{buf}\n\n{part}".strip() if buf else part
        if len(candidate) <= max_chars:
            buf = candidate
        else:
            if buf:
                out.append(buf)
            buf = part
    if buf:
        out.append(buf)
    return out


def _emit_span_segments(
    span: str,
    fields: list[dict[str, str]],
    *,
    full_text: str,
    repeated_sk: set[str],
    max_chars: int,
) -> list[tuple[str, dict[str, Any]]]:
    block_segs = _fields_to_block_segments(fields, span)
    if block_segs:
        return block_segs

    if len(fields) >= 2:
        return [(_format_fields_text(fields), _structured_classify(fields, span))]

    out: list[tuple[str, dict[str, Any]]] = []
    for chunk in _prose_chunks(span, max_chars=max_chars):
        out.append(
            (
                chunk,
                _classify_document_chunk(chunk, full_text=full_text, repeated_skeletons=repeated_sk),
            ),
        )
    return out


def segment_kind_summary(segments: list[dict[str, Any]]) -> dict[str, int]:
    """Count segments by segment_kind (for API / UI)."""
    counts = {
        SEGMENT_KIND_DOCUMENT: 0,
        SEGMENT_KIND_TEMPLATE: 0,
        SEGMENT_KIND_STRUCTURED: 0,
    }
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        cj = seg.get("classify_json")
        kind = ""
        if isinstance(cj, dict):
            kind = str(cj.get("segment_kind") or "")
        if kind not in counts:
            kind = SEGMENT_KIND_DOCUMENT
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def segment_analyze_text(
    text: str,
    *,
    max_chars: int = _CHUNK_CHARS_DEFAULT,
) -> list[tuple[str, dict[str, Any]]]:
    """
    Split source text into (text, classify_json) segments.

    Taxonomy (Razy Template–like):
    - document_segment — narrative prose
    - template_block — repeating rows/sections as ``block`` trees (table_row, member_record, …)
    - structured_data — compact label:value groups without row split
    """
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return []

    repeated_sk = _repeated_paragraph_skeletons(raw)

    # Whole-document member markers (e.g. 【第 100 號行員】 sections).
    doc_members = _segment_member_records(raw)
    if doc_members and len(doc_members) >= 2:
        return doc_members

    matches = list(_FIELD_LABEL_RE.finditer(raw))
    if len(matches) >= 2:
        groups = _group_label_spans(raw, matches)
        if groups:
            segments: list[tuple[str, dict[str, Any]]] = []
            pos = 0
            for start, end, fields in groups:
                if start > pos:
                    gap = raw[pos:start]
                    for chunk in _prose_chunks(gap, max_chars=max_chars):
                        segments.append(
                            (
                                chunk,
                                _classify_document_chunk(
                                    chunk, full_text=raw, repeated_skeletons=repeated_sk
                                ),
                            ),
                        )
                span = raw[start:end]
                segments.extend(
                    _emit_span_segments(
                        span,
                        fields,
                        full_text=raw,
                        repeated_sk=repeated_sk,
                        max_chars=max_chars,
                    ),
                )
                pos = end
            if pos < len(raw):
                tail = raw[pos:]
                tail_fields = _parse_structured_fields(tail)
                segments.extend(
                    _emit_span_segments(
                        tail,
                        tail_fields,
                        full_text=raw,
                        repeated_sk=repeated_sk,
                        max_chars=max_chars,
                    ),
                )
            if segments:
                return segments

    doc_table = _segment_table_rows(raw)
    if doc_table and len(doc_table) >= 2:
        return doc_table

    return [
        (
            chunk,
            _classify_document_chunk(chunk, full_text=raw, repeated_skeletons=repeated_sk),
        )
        for chunk in _prose_chunks(raw, max_chars=max_chars)
    ]
