"""CS-1-S18 — schema-driven html_template from Pass A/B extraction JSON."""

from __future__ import annotations

import html
import json
from typing import Any

from oaao_orchestrator.corpus.html_template import (
    HTML_TEMPLATE_VERSION,
    _DEFAULT_PRINT_CSS,
    _fill_notice_header_html,
    _html_table_body,
    render_html_document,
)

# Schema-driven column labels (corpus-extract-hk_member_notice_transfer.json).
_HK_TRANSFER_COLUMNS: tuple[tuple[str, str], ...] = (
    ("id", "編號"),
    ("before", "轉讓會籍前行員名稱及執行司理人"),
    ("after", "轉讓會籍後行員名稱及執行司理人"),
    ("introducer", "介紹人"),
    ("date", "公佈日期"),
)

_NOTICE_HEADER_SPECS: tuple[tuple[str, str, str, int], ...] = (
    ("file_ref", "本函檔號", "string", 40),
    ("notice_date", "日期", "string", 40),
    ("salutation", "致", "string", 80),
    ("notice_title", "標題", "string", 80),
    ("intro_paragraph", "引言", "text", 2000),
)

_NOTICE_LETTERHEAD_HTML = (
    '<div class="oaao-notice-letterhead">'
    '<p class="oaao-notice-meta-right">本函檔號：{{ file_ref }}</p>'
    '<p class="oaao-notice-meta-right">{{ notice_date }}</p>'
    '<p class="oaao-notice-salutation">{{ salutation }}</p>'
    '<h2 class="oaao-notice-title">{{ notice_title }}</h2>'
    '<p class="oaao-notice-intro-text">{{ intro_paragraph }}</p>'
    "</div>"
)


def _header_defaults_from_extraction(header: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, _label, _typ, _max in _NOTICE_HEADER_SPECS:
        val = header.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()
    return out


def build_html_template_from_extraction(
    *,
    document_type: str,
    extraction: dict[str, Any],
    profile_name: str = "",
) -> dict[str, Any] | None:
    """Build print template from validated extraction — no segment regex."""
    if not isinstance(extraction, dict) or not extraction:
        return None

    if document_type == "hk_member_notice_transfer":
        return _template_hk_member_notice_transfer(extraction, profile_name=profile_name)

    if document_type in ("unknown", "general_prose", "contract", "invoice", "hk_member_registry_blocks"):
        return _template_prose_sections(extraction, profile_name=profile_name, document_type=document_type)

    return None


def _template_hk_member_notice_transfer(
    extraction: dict[str, Any],
    *,
    profile_name: str = "",
) -> dict[str, Any]:
    header_raw = extraction.get("notice_header")
    header = header_raw if isinstance(header_raw, dict) else {}
    defaults = _header_defaults_from_extraction(header)

    rows_raw = extraction.get("table_rows")
    sample_rows: list[dict[str, str]] = []
    if isinstance(rows_raw, list):
        for row in rows_raw:
            if not isinstance(row, dict):
                continue
            cleaned = {k: str(v).strip() for k, v in row.items() if str(v).strip()}
            if cleaned.get("id") or len(cleaned) > 1:
                sample_rows.append(cleaned)

    columns = list(_HK_TRANSFER_COLUMNS)
    letterhead_display = _fill_notice_header_html(_NOTICE_LETTERHEAD_HTML, defaults, {})
    table_html = _html_table_body(tuple(columns), sample_rows)
    html_body = (
        f'<article class="oaao-corpus-page" data-corpus-template-version="{HTML_TEMPLATE_VERSION}" '
        f'data-template-source="extraction" data-document-type="hk_member_notice_transfer">'
        f"{letterhead_display}{table_html}</article>"
    )

    parameters: list[dict[str, Any]] = [
        {"key": key, "label": label, "type": typ, "max_chars": mx}
        for key, label, typ, mx in _NOTICE_HEADER_SPECS
    ]
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
        "template_source": "extraction",
        "document_type": "hk_member_notice_transfer",
        "dominant_segment_kind": "template_block",
        "columns": [{"key": k, "label": lab} for k, lab in columns],
        "sample_rows": sample_rows[:64],
        "notice_header": {
            "html": _NOTICE_LETTERHEAD_HTML,
            "defaults": defaults,
        },
        "parameters": parameters,
        "html_body": html_body,
        "css": _DEFAULT_PRINT_CSS,
        "placeholder_syntax": "{{ key }} + table_rows JSON",
        "table_row_count": len(sample_rows),
        "has_notice_letterhead": bool(defaults),
    }


def _template_prose_sections(
    extraction: dict[str, Any],
    *,
    profile_name: str = "",
    document_type: str = "unknown",
) -> dict[str, Any]:
    sections_raw = extraction.get("sections")
    sections: list[dict[str, str]] = []
    if isinstance(sections_raw, list):
        for sec in sections_raw[:32]:
            if not isinstance(sec, dict):
                continue
            title = str(sec.get("title") or "Section").strip() or "Section"
            body = str(sec.get("body") or "").strip()
            sections.append({"title": title, "body": body})

    parameters: list[dict[str, Any]] = []
    blocks_html: list[str] = []
    for i, sec in enumerate(sections):
        key = f"section_{i + 1}_body"
        parameters.append(
            {
                "key": key,
                "label": sec["title"][:120],
                "type": "text",
                "max_chars": 8000,
                "section_title": sec["title"],
            }
        )
        title_esc = html.escape(sec["title"])
        blocks_html.append(
            f'<section class="oaao-corpus-block" data-section="{i + 1}">'
            f'<div class="oaao-corpus-block-title">{title_esc}</div>'
            f'<div data-oaao-param="{key}">{{{{ {key} }}}}</div>'
            f"</section>"
        )

    if not blocks_html:
        summary = str(extraction.get("summary") or "").strip()
        parameters.append({"key": "body", "label": "Body", "type": "text", "max_chars": 8000})
        body_default = summary
        blocks_html.append(
            '<section class="oaao-corpus-block">'
            f'<p data-oaao-param="body">{html.escape(body_default[:500])}</p>'
            "</section>"
        )
    else:
        body_default = ""

    title = html.escape(profile_name or "Document")
    html_body = (
        f'<article class="oaao-corpus-page" data-corpus-template-version="{HTML_TEMPLATE_VERSION}" '
        f'data-template-source="extraction" data-document-type="{html.escape(document_type)}">'
        f"<header><h1>{title}</h1></header>\n"
        + "\n".join(blocks_html)
        + "\n</article>"
    )

    return {
        "version": HTML_TEMPLATE_VERSION,
        "page_size": "A4",
        "layout_type": "prose",
        "template_source": "extraction",
        "document_type": document_type,
        "dominant_segment_kind": "document_segment",
        "parameters": parameters[:120],
        "html_body": html_body,
        "css": _DEFAULT_PRINT_CSS,
        "placeholder_syntax": "{{ key }}",
        "section_count": len(sections),
        "summary_preview": str(extraction.get("summary") or "")[:400],
    }


def render_html_from_extraction_template(
    template: dict[str, Any],
    parameters: dict[str, str] | None = None,
) -> str:
    """Render filled HTML using extraction-driven template defaults."""
    params = dict(parameters or {})
    if str(template.get("layout_type") or "") == "prose":
        for spec in template.get("parameters") or []:
            if not isinstance(spec, dict):
                continue
            key = str(spec.get("key") or "")
            if not key or key in params:
                continue
            # Pre-fill section bodies from sample when generating preview
            sec_title = spec.get("section_title")
            if sec_title and isinstance(sec_title, str):
                for sec in template.get("sections") or []:
                    if isinstance(sec, dict) and sec.get("title") == sec_title and sec.get("body"):
                        params[key] = str(sec["body"])
                        break
    return render_html_document(template, params)


def extraction_template_golden_fixtures() -> dict[str, dict[str, Any]]:
    """Three layout fixtures for regression (CS-1-S18 DoD)."""
    return {
        "hk_transfer": {
            "document_type": "hk_member_notice_transfer",
            "extraction": {
                "notice_header": {
                    "file_ref": "MEN-1",
                    "notice_date": "2024 年 3 月 15 日",
                    "notice_title": "行員申請轉讓會籍",
                    "intro_paragraph": "下列為轉讓詳情。",
                },
                "table_rows": [
                    {"id": "018", "before": "A", "after": "B", "introducer": "C", "date": "2024-01-01"},
                    {"id": "019", "before": "D", "after": "E"},
                ],
            },
        },
        "general_prose": {
            "document_type": "general_prose",
            "extraction": {
                "summary": "Policy overview document.",
                "sections": [
                    {"title": "Purpose", "body": "Define scope."},
                    {"title": "Scope", "body": "All staff."},
                ],
            },
        },
        "unknown_minimal": {
            "document_type": "unknown",
            "extraction": {
                "summary": "Unclassified one-page memo.",
                "sections": [],
            },
        },
    }
