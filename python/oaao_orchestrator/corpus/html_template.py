"""Corpus HTML Template track (CS-1-S12) — print layout + parameters, separate from Markdown."""

from __future__ import annotations

import html
import re
from typing import Any

HTML_TEMPLATE_VERSION = 1
_PARAM_KEY_RE = re.compile(r"[^a-z0-9_]+")

_DEFAULT_PRINT_CSS = """\
@page { size: A4; margin: 18mm 16mm; }
body {
  font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #111;
}
.oaao-corpus-page { max-width: 100%; }
.oaao-corpus-block {
  margin: 0 0 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #e5e7eb;
}
.oaao-corpus-block-title { font-weight: 600; margin-bottom: 0.35rem; }
.oaao-corpus-field { margin: 0.15rem 0; }
.oaao-corpus-field-label { color: #374151; }
.oaao-corpus-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 0.75rem; }
.oaao-corpus-table th, .oaao-corpus-table td {
  border: 1px solid #333;
  padding: 0.35rem 0.45rem;
  vertical-align: top;
  text-align: left;
}
.oaao-corpus-table th { background: #f3f4f6; font-weight: 600; }
.oaao-notice-letterhead { margin-bottom: 1rem; }
.oaao-notice-meta-right { text-align: right; margin: 0.2rem 0; }
.oaao-notice-title { text-align: center; font-size: 13pt; font-weight: 700; text-decoration: underline; margin: 0.75rem 0 0.5rem; }
.oaao-notice-salutation { margin: 0.5rem 0; }
.oaao-notice-intro-text { margin: 0.5rem 0 0.75rem; line-height: 1.5; text-align: justify; }
"""

_FILE_REF_RE = re.compile(r"本函檔號\s*[：:]\s*(\S+)")
_DATE_RE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_SALUTATION_RE = re.compile(r"(致[：:][^\n]+)")
_TITLE_RE = re.compile(r"(行員申請轉讓會籍)")
_INTRO_RE = re.compile(r"(下列[\s\S]+?)(?=\n\s*\d{3}\s|\n編號|$)")

# Default columns for HK exchange-style membership notices (table_row blocks).
_TABLE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("id", "編號"),
    ("before", "轉讓會籍前行員名稱及執行司理人"),
    ("after", "轉讓會籍後行員名稱及執行司理人"),
    ("introducer", "介紹人"),
    ("date", "公佈日期"),
)


def _slug_param_key(label: str, *, used: set[str]) -> str:
    base = _PARAM_KEY_RE.sub("_", (label or "field").strip().lower()).strip("_") or "field"
    key = base[:48]
    n = 2
    while key in used:
        key = f"{base[:44]}_{n}"
        n += 1
    used.add(key)
    return key


def _classify_of(seg: dict[str, Any]) -> dict[str, Any]:
    cj = seg.get("classify_json")
    return cj if isinstance(cj, dict) else {}


def _table_row_from_segment(seg: dict[str, Any]) -> dict[str, str]:
    cj = _classify_of(seg)
    blk = cj.get("block") if isinstance(cj.get("block"), dict) else {}
    row: dict[str, str] = {"id": str(blk.get("id") or "").strip()}
    for ch in blk.get("children") or []:
        if not isinstance(ch, dict):
            continue
        name = str(ch.get("name") or "")
        lines = ch.get("lines")
        text = "\n".join(str(x) for x in lines) if isinstance(lines, list) else ""
        if name == "cell_before":
            row["before"] = text.strip()
        elif name == "cell_after":
            row["after"] = text.strip()
        elif name == "cell":
            row["body"] = text.strip()
        elif name == "cell_fields" and isinstance(ch.get("fields"), list):
            for f in ch["fields"]:
                if not isinstance(f, dict):
                    continue
                lab = str(f.get("label") or "").strip()
                val = str(f.get("value") or "").strip()
                if lab:
                    row[lab] = val
    for f in cj.get("fields") or []:
        if not isinstance(f, dict):
            continue
        lab = str(f.get("label") or "").strip()
        val = str(f.get("value") or "").strip()
        if lab == "編號" and not row.get("id"):
            row["id"] = val
        elif lab and val:
            row[lab] = val
    if not row.get("id") and row.get("編號"):
        row["id"] = row["編號"]
    return row


def _html_table_body(columns: tuple[tuple[str, str], ...], rows: list[dict[str, str]]) -> str:
    head = "".join(f"<th>{html.escape(lab)}</th>" for _key, lab in columns)
    body_rows: list[str] = []
    for row in rows[:64]:
        cells = []
        for key, _lab in columns:
            val = str(row.get(key) or row.get(_lab) or "").strip()
            cells.append(f"<td>{html.escape(val).replace(chr(10), '<br/>')}</td>")
        body_rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table class=\"oaao-corpus-table\"><thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def _segment_ordinal(seg: dict[str, Any]) -> int:
    try:
        return int(seg.get("ordinal") if seg.get("ordinal") is not None else 0)
    except (TypeError, ValueError):
        return 0


def _prose_segments_before_table(
    segments: list[dict[str, Any]],
    table_segs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not table_segs:
        return [
            s
            for s in segments
            if isinstance(s, dict) and str(_classify_of(s).get("segment_kind") or "") == "document_segment"
        ]
    min_ord = min(_segment_ordinal(s) for s in table_segs)
    out: list[dict[str, Any]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        if str(_classify_of(seg).get("segment_kind") or "") != "document_segment":
            continue
        if _segment_ordinal(seg) < min_ord:
            out.append(seg)
    return sorted(out, key=_segment_ordinal)


def _build_notice_letterhead(
    segments: list[dict[str, Any]],
    table_segs: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]], dict[str, str]]:
    """Extract 本函檔號 / 日期 / 致辭 / 標題 / 引言 from document_segment prose before the table."""
    prose_segs = _prose_segments_before_table(segments, table_segs)
    combined = "\n\n".join(str(s.get("text") or "").strip() for s in prose_segs if str(s.get("text") or "").strip())

    defaults: dict[str, str] = {}
    if combined:
        m = _FILE_REF_RE.search(combined)
        if m:
            defaults["file_ref"] = m.group(1).strip()
        dm = _DATE_RE.search(combined)
        if dm:
            defaults["notice_date"] = f"{dm.group(1)} 年 {int(dm.group(2))} 月 {int(dm.group(3))} 日"
        sm = _SALUTATION_RE.search(combined)
        if sm:
            defaults["salutation"] = sm.group(1).strip()
        if _TITLE_RE.search(combined):
            defaults["notice_title"] = "行員申請轉讓會籍"
        im = _INTRO_RE.search(combined)
        if im:
            defaults["intro_paragraph"] = re.sub(r"\s+", " ", im.group(1).strip())
        elif "下列" in combined:
            idx = combined.find("下列")
            defaults["intro_paragraph"] = re.sub(r"\s+", " ", combined[idx:].strip())[:1200]

    param_specs: list[dict[str, Any]] = [
        {"key": "file_ref", "label": "本函檔號", "type": "string", "max_chars": 40},
        {"key": "notice_date", "label": "日期", "type": "string", "max_chars": 40},
        {"key": "salutation", "label": "致", "type": "string", "max_chars": 80},
        {"key": "notice_title", "label": "標題", "type": "string", "max_chars": 80},
        {"key": "intro_paragraph", "label": "引言", "type": "text", "max_chars": 2000},
    ]

    html = (
        '<div class="oaao-notice-letterhead">'
        '<p class="oaao-notice-meta-right">本函檔號：{{ file_ref }}</p>'
        '<p class="oaao-notice-meta-right">{{ notice_date }}</p>'
        '<p class="oaao-notice-salutation">{{ salutation }}</p>'
        '<h2 class="oaao-notice-title">{{ notice_title }}</h2>'
        '<p class="oaao-notice-intro-text">{{ intro_paragraph }}</p>'
        "</div>"
    )
    return html, param_specs, defaults


def _fill_notice_header_html(fragment: str, defaults: dict[str, str], parameters: dict[str, str]) -> str:
    merged = {**defaults, **{k: v for k, v in parameters.items() if v}}
    body = fragment
    for key, val in merged.items():
        safe = html.escape(str(val))
        body = body.replace(f"{{{{ {key} }}}}", safe)
        body = body.replace(f"{{{{{key}}}}}", safe)
    body = re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}", "", body)
    return body


def _build_table_html_template_v1(
    *,
    segments: list[dict[str, Any]],
    profile_name: str = "",
    structure_blueprint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    table_segs = [
        s
        for s in segments
        if isinstance(s, dict)
        and str(_classify_of(s).get("segment_kind") or "") == "template_block"
        and str((_classify_of(s).get("block") or {}).get("name") or "") == "table_row"
    ]
    sample_rows = [_table_row_from_segment(s) for s in table_segs]
    sample_rows = [r for r in sample_rows if any(str(v).strip() for v in r.values())]

    columns = list(_TABLE_COLUMNS)
    letterhead_html, header_params, header_defaults = _build_notice_letterhead(segments, table_segs)
    letterhead_display = _fill_notice_header_html(letterhead_html, header_defaults, {})
    table_html = _html_table_body(tuple(columns), sample_rows)
    html_body = (
        f'<article class="oaao-corpus-page" data-corpus-template-version="{HTML_TEMPLATE_VERSION}">'
        f"{letterhead_display}"
        f"{table_html}</article>"
    )
    parameters: list[dict[str, Any]] = list(header_params)
    parameters.append(
        {
            "key": "brief",
            "label": "Brief (generate or replace table rows)",
            "type": "text",
            "max_chars": 4000,
        },
    )
    return {
        "version": HTML_TEMPLATE_VERSION,
        "layout_type": "table",
        "page_size": "A4",
        "dominant_segment_kind": "template_block",
        "columns": [{"key": k, "label": lab} for k, lab in columns],
        "sample_rows": sample_rows[:64],
        "notice_header": {
            "html": letterhead_html,
            "defaults": header_defaults,
        },
        "parameters": parameters,
        "html_body": html_body,
        "css": _DEFAULT_PRINT_CSS,
        "placeholder_syntax": "{{ key }} + table_rows JSON",
        "table_row_count": len(sample_rows),
        "has_notice_letterhead": bool(header_defaults or letterhead_html),
    }


def build_html_template_v1(
    *,
    segments: list[dict[str, Any]],
    structure_blueprint: dict[str, Any] | None = None,
    profile_name: str = "",
) -> dict[str, Any]:
    """
    Heuristic print template from analyzed segments (template_block fields).
    LLM refinement is optional in a later pass; analyze attaches this to style_json.meta.
    """
    table_segs = [
        s
        for s in segments
        if isinstance(s, dict)
        and str(_classify_of(s).get("segment_kind") or "") == "template_block"
        and str((_classify_of(s).get("block") or {}).get("name") or "") == "table_row"
    ]
    if len(table_segs) >= 2:
        return _build_table_html_template_v1(
            segments=segments,
            profile_name=profile_name,
            structure_blueprint=structure_blueprint,
        )

    parameters: list[dict[str, Any]] = []
    used_keys: set[str] = set()
    label_to_key: dict[str, str] = {}
    blocks_html: list[str] = []
    rendered_block_layouts: set[str] = set()
    template_block_count = 0

    def _field_rows_for_fields(
        fields: list[dict[str, Any]],
        *,
        block_name: str,
        kind: str,
    ) -> list[str]:
        rows: list[str] = []
        for f in fields[:48]:
            if not isinstance(f, dict):
                continue
            lab = str(f.get("label") or "").strip()
            if not lab:
                continue
            if lab not in label_to_key:
                key = _slug_param_key(lab, used=used_keys)
                label_to_key[lab] = key
                parameters.append(
                    {
                        "key": key,
                        "label": lab,
                        "type": "string",
                        "max_chars": 280,
                        "segment_kind": kind,
                        "block_name": block_name,
                    }
                )
            key = label_to_key[lab]
            rows.append(
                f'<div class="oaao-corpus-field">'
                f'<span class="oaao-corpus-field-label">{html.escape(lab)}：</span>'
                f'<span data-oaao-param="{html.escape(key)}">{{{{ {key} }}}}</span>'
                f"</div>"
            )
        return rows

    for seg in segments:
        if not isinstance(seg, dict):
            continue
        cj = _classify_of(seg)
        kind = str(cj.get("segment_kind") or "document_segment")
        blk = cj.get("block") if isinstance(cj.get("block"), dict) else {}
        block_name = str(blk.get("name") or kind)

        if kind == "template_block" or cj.get("fields"):
            template_block_count += 1
            fields = cj.get("fields") if isinstance(cj.get("fields"), list) else blk.get("fields") or []
            if not isinstance(fields, list):
                fields = []
            # Same block shape repeated per source row (e.g. 5× member_record) → one print section.
            layout_sig = block_name + "|" + "|".join(
                str(f.get("label") or "").strip() for f in fields[:48] if isinstance(f, dict)
            )
            if layout_sig in rendered_block_layouts:
                continue
            rendered_block_layouts.add(layout_sig)

            field_rows = _field_rows_for_fields(fields, block_name=block_name, kind=kind)
            if field_rows:
                if block_name == "member_record":
                    title = "行員／成員資料（單筆模板）"
                elif blk.get("id"):
                    title = html.escape(str(blk.get("id")))
                else:
                    title = html.escape(block_name.replace("_", " "))
                blocks_html.append(
                    f'<section class="oaao-corpus-block" data-block="{html.escape(block_name)}">'
                    f'<div class="oaao-corpus-block-title">{title}</div>'
                    + "".join(field_rows)
                    + "</section>"
                )
            continue

        if kind == "document_segment":
            excerpt = str(seg.get("text") or "")[:200].strip()
            if excerpt:
                blocks_html.append(
                    '<section class="oaao-corpus-block oaao-corpus-prose">'
                    f"<p>{html.escape(excerpt)}…</p>"
                    "</section>"
                )

    if not blocks_html:
        blocks_html.append(
            '<section class="oaao-corpus-block">'
            '<p data-oaao-param="body">{{ body }}</p>'
            "</section>"
        )
        if "body" not in used_keys:
            parameters.append(
                {
                    "key": "body",
                    "label": "Body",
                    "type": "string",
                    "max_chars": 8000,
                }
            )

    title = html.escape(profile_name or "Document")
    body_inner = "\n".join(blocks_html)
    html_body = (
        f'<article class="oaao-corpus-page" data-corpus-template-version="{HTML_TEMPLATE_VERSION}">'
        f"<header><h1>{title}</h1></header>\n{body_inner}\n</article>"
    )

    dom = "template_block"
    if structure_blueprint and isinstance(structure_blueprint.get("dominant_segment_kind"), str):
        dom = structure_blueprint["dominant_segment_kind"]

    meta_extra: dict[str, Any] = {}
    if template_block_count > len(rendered_block_layouts):
        meta_extra["collapsed_duplicate_blocks"] = template_block_count - len(rendered_block_layouts)
        meta_extra["template_block_count"] = template_block_count

    return {
        "version": HTML_TEMPLATE_VERSION,
        "page_size": "A4",
        "dominant_segment_kind": dom,
        "parameters": parameters[:120],
        "html_body": html_body,
        "css": _DEFAULT_PRINT_CSS,
        "placeholder_syntax": "{{ key }}",
        **meta_extra,
    }


def attach_html_template_to_style_json(
    style_json: dict[str, Any],
    template: dict[str, Any],
) -> dict[str, Any]:
    meta = style_json.setdefault("meta", {})
    if not isinstance(meta, dict):
        meta = {}
        style_json["meta"] = meta
    meta["html_template"] = template
    meta.setdefault("output_modes", [])
    modes = meta["output_modes"]
    if not isinstance(modes, list):
        modes = []
        meta["output_modes"] = modes
    for m in ("markdown", "html_pdf"):
        if m not in modes:
            modes.append(m)
    meta["markdown"] = {"default_for": ["chat", "editor", "corpus_generate_preview"]}
    meta["html_template_track"] = {"default_for": ["pdf", "office_generate_pdf"]}
    return style_json


def get_html_template_from_style(style_json: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(style_json, dict):
        return None
    meta = style_json.get("meta")
    if not isinstance(meta, dict):
        return None
    tpl = meta.get("html_template")
    return tpl if isinstance(tpl, dict) else None


def _rows_for_table_render(
    template: dict[str, Any],
    parameters: dict[str, str],
) -> list[dict[str, str]]:
    import json

    raw = str(parameters.get("table_rows") or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [r for r in parsed if isinstance(r, dict)]
        except json.JSONDecodeError:
            pass
    sample = template.get("sample_rows")
    if isinstance(sample, list) and sample:
        return [r for r in sample if isinstance(r, dict)]
    return []


def render_html_document(
    template: dict[str, Any],
    parameters: dict[str, str],
) -> str:
    """Fill {{ key }} placeholders in html_body; wrap with css."""
    if str(template.get("layout_type") or "") == "table":
        columns_raw = template.get("columns")
        columns: tuple[tuple[str, str], ...] = _TABLE_COLUMNS
        if isinstance(columns_raw, list) and columns_raw:
            parsed_cols: list[tuple[str, str]] = []
            for c in columns_raw:
                if isinstance(c, dict) and c.get("key"):
                    parsed_cols.append((str(c["key"]), str(c.get("label") or c["key"])))
            if parsed_cols:
                columns = tuple(parsed_cols)
        rows = _rows_for_table_render(template, parameters)
        nh = template.get("notice_header") if isinstance(template.get("notice_header"), dict) else {}
        nh_html = str(nh.get("html") or "")
        nh_defaults = nh.get("defaults") if isinstance(nh.get("defaults"), dict) else {}
        if not nh_html and "oaao-notice-letterhead" in str(template.get("html_body") or ""):
            import re as _re

            m = _re.search(
                r'(<div class="oaao-notice-letterhead">[\s\S]*?</div>)',
                str(template.get("html_body") or ""),
            )
            if m:
                nh_html = m.group(1)
        letterhead = _fill_notice_header_html(nh_html, nh_defaults, parameters) if nh_html else ""
        table_html = _html_table_body(columns, rows)
        body = f'<article class="oaao-corpus-page">{letterhead}{table_html}</article>'
        css = str(template.get("css") or _DEFAULT_PRINT_CSS)
        return (
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>"
            f"<style>{css}</style></head><body>{body}</body></html>"
        )

    body = str(template.get("html_body") or "")
    css = str(template.get("css") or _DEFAULT_PRINT_CSS)
    for key, val in parameters.items():
        safe = html.escape(str(val))
        body = body.replace(f"{{{{ {key} }}}}", safe)
        body = body.replace(f"{{{{{key}}}}}", safe)
    # Unfilled placeholders → empty string
    body = re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}", "", body)
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>"
        f"<style>{css}</style></head><body>{body}</body></html>"
    )


def render_pdf_from_html(html_document: str) -> dict[str, Any]:
    """CS-3-S3 — weasyprint when installed."""
    from oaao_orchestrator.corpus.pdf_render import html_to_pdf_bytes

    pdf, err = html_to_pdf_bytes(html_document)
    if pdf is None:
        detail = "Install weasyprint (pip + system libs) for PDF export."
        if err and err != "pdf_renderer_not_configured":
            detail = err
        return {
            "ok": False,
            "error": err or "pdf_renderer_not_configured",
            "detail": detail,
        }
    import base64

    b64 = base64.standard_b64encode(pdf).decode("ascii")
    return {
        "ok": True,
        "pdf_bytes_b64": b64,
        "pdf_size_bytes": len(pdf),
        "mime": "application/pdf",
    }
