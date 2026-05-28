"""CS-1-S17 — two-stage schema extraction (Pass A structure + Pass B clean/validate)."""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from oaao_orchestrator.corpus.llm import _extract_json_object, chat_completion_text
from oaao_orchestrator.corpus.schema_registry import (
    DocumentTypeId,
    SchemaRegistryV1,
    get_type_entry,
    load_schema_registry,
    validate_extraction,
)

logger = logging.getLogger(__name__)

_FILE_REF_RE = re.compile(r"本函檔號\s*[：:]\s*(\S+)")
_DATE_RE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_SALUTATION_RE = re.compile(r"(致[：:][^\n]+)")
_TITLE_RE = re.compile(r"(行員申請轉讓會籍)")
_INTRO_RE = re.compile(r"(下列[\s\S]+?)(?=\n\s*\d{3}\s|\n編號|$)")
_TABLE_ROW_START_RE = re.compile(r"(?m)^(?P<id>\d{3})(?:\s+|\t)(?P<rest>.+)$")
_TABLE_ROW_SPLIT_RE = re.compile(r"(?m)(?=^\d{3}(?:\s+|\t))")
_MEMBER_BLOCK_RE = re.compile(r"【第\s*(\d+)\s*號行員】")
_HEADING_MD_RE = re.compile(r"^(#{1,3})\s+(.+)$", re.MULTILINE)


class ExtractionBlock(BaseModel):
    name: str
    start_char: int = 0
    end_char: int = 0
    kind: str = "section"


class ExtractionResult(BaseModel):
    document_type: DocumentTypeId
    extraction: dict[str, Any] | None = None
    validation_errors: list[str] = Field(default_factory=list)
    partial: bool = False
    pass_a_method: Literal["heuristic", "llm", "skipped"] = "heuristic"
    pass_b_applied: bool = False
    blocks: list[ExtractionBlock] = Field(default_factory=list)


def _collapse_ws(text: str, *, max_len: int = 8000) -> str:
    out = re.sub(r"[ \t]+", " ", (text or "").strip())
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out[:max_len]


def _parse_table_rows(markdown: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for chunk in _TABLE_ROW_SPLIT_RE.split(markdown):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = _TABLE_ROW_START_RE.match(chunk)
        if not m:
            continue
        row_id = m.group("id").strip()
        body = m.group("rest").strip()
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        row: dict[str, str] = {"id": row_id}
        if len(lines) >= 2:
            row["before"] = lines[0]
            row["after"] = lines[1]
            if len(lines) >= 3:
                row["introducer"] = lines[2]
            if len(lines) >= 4:
                row["date"] = lines[3]
        elif lines:
            row["before"] = lines[0]
        rows.append(row)
    return rows


def _extract_hk_transfer_heuristic(markdown: str) -> tuple[dict[str, Any], list[ExtractionBlock]]:
    text = (markdown or "").strip()
    blocks: list[ExtractionBlock] = []
    header: dict[str, str] = {}

    m = _FILE_REF_RE.search(text)
    if m:
        header["file_ref"] = m.group(1).strip()
    dm = _DATE_RE.search(text)
    if dm:
        header["notice_date"] = f"{dm.group(1)} 年 {int(dm.group(2))} 月 {int(dm.group(3))} 日"
    sm = _SALUTATION_RE.search(text)
    if sm:
        header["salutation"] = sm.group(1).strip()
    if _TITLE_RE.search(text):
        header["notice_title"] = "行員申請轉讓會籍"
    im = _INTRO_RE.search(text)
    if im:
        header["intro_paragraph"] = _collapse_ws(im.group(1), max_len=4000)
    elif "下列" in text:
        idx = text.find("下列")
        header["intro_paragraph"] = _collapse_ws(text[idx:], max_len=4000)

    first_row = _TABLE_ROW_SPLIT_RE.search(text)
    if first_row and first_row.start() > 0:
        blocks.append(
            ExtractionBlock(
                name="notice_header",
                start_char=0,
                end_char=first_row.start(),
                kind="letterhead",
            )
        )
        blocks.append(
            ExtractionBlock(
                name="table_body",
                start_char=first_row.start(),
                end_char=len(text),
                kind="table",
            )
        )
    elif header:
        blocks.append(ExtractionBlock(name="notice_header", start_char=0, end_char=len(text), kind="letterhead"))

    table_rows = _parse_table_rows(text)
    payload: dict[str, Any] = {}
    if header:
        payload["notice_header"] = header
    if table_rows:
        payload["table_rows"] = table_rows
    return payload, blocks


def _extract_member_blocks_heuristic(markdown: str) -> tuple[dict[str, Any], list[ExtractionBlock]]:
    text = (markdown or "").strip()
    parts = _MEMBER_BLOCK_RE.split(text)
    markers = _MEMBER_BLOCK_RE.findall(text)
    sections: list[dict[str, str]] = []
    blocks: list[ExtractionBlock] = []
    cursor = 0
    for idx, body in enumerate(parts):
        chunk = body.strip()
        if not chunk and idx == 0:
            continue
        title = f"【第 {markers[idx - 1]} 號行員】" if idx > 0 and idx - 1 < len(markers) else f"Section {idx + 1}"
        if idx > 0:
            m = _MEMBER_BLOCK_RE.search(text[cursor:])
            start = cursor + (m.start() if m else 0)
            end = start + len(title) + len(chunk)
            blocks.append(ExtractionBlock(name=title, start_char=start, end_char=end, kind="member_block"))
            cursor = end
        sections.append({"title": title, "body": _collapse_ws(chunk, max_len=8000)})
    if not sections:
        return {"summary": _collapse_ws(text[:8000]), "sections": []}, blocks
    return {"summary": f"{len(sections)} member blocks", "sections": sections[:32]}, blocks


def _extract_prose_heuristic(markdown: str) -> tuple[dict[str, Any], list[ExtractionBlock]]:
    text = (markdown or "").strip()
    if not text:
        return {"summary": "", "sections": []}, []

    headings = list(_HEADING_MD_RE.finditer(text))
    sections: list[dict[str, str]] = []
    blocks: list[ExtractionBlock] = []

    if headings:
        for i, hm in enumerate(headings):
            title = hm.group(2).strip()
            start = hm.start()
            end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
            body = text[hm.end() : end].strip()
            sections.append({"title": title, "body": _collapse_ws(body, max_len=8000)})
            blocks.append(
                ExtractionBlock(name=title, start_char=start, end_char=end, kind="section"),
            )
    else:
        paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
        for i, para in enumerate(paras[:32]):
            title = para.split("\n", 1)[0][:120]
            sections.append({"title": title, "body": _collapse_ws(para, max_len=8000)})
            blocks.append(ExtractionBlock(name=f"section_{i + 1}", kind="section"))

    summary = _collapse_ws(text[:1200], max_len=8000)
    return {"summary": summary, "sections": sections}, blocks


def extract_pass_a_heuristic(
    *,
    markdown: str,
    document_type: str,
) -> tuple[dict[str, Any], list[ExtractionBlock]]:
    if document_type == "hk_member_notice_transfer":
        return _extract_hk_transfer_heuristic(markdown)
    if document_type == "hk_member_registry_blocks":
        return _extract_member_blocks_heuristic(markdown)
    if document_type in ("general_prose", "contract", "invoice", "unknown"):
        return _extract_prose_heuristic(markdown)
    return _extract_prose_heuristic(markdown)


async def extract_pass_a_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any],
    markdown: str,
    document_type: str,
    registry: SchemaRegistryV1 | None = None,
) -> dict[str, Any] | None:
    reg = registry or load_schema_registry()
    entry = get_type_entry(reg, document_type)
    schema_id = entry.extract_schema if entry else "corpus-extract-unknown.json"
    sample = (markdown or "")[:14_000]
    system = (
        "You extract structured JSON for Corpus Studio Pass A. "
        f"document_type={document_type}; schema={schema_id}. "
        "Output ONLY valid JSON matching the schema — no markdown fences."
    )
    user = f"Document markdown:\n{sample}"
    raw = await chat_completion_text(
        client,
        llm_cfg=llm_cfg,
        system=system,
        user=user,
        temperature=0.1,
        timeout_sec=60.0,
    )
    if not raw:
        return None
    parsed = _extract_json_object(raw)
    return parsed if isinstance(parsed, dict) else None


def extract_pass_b(
    *,
    document_type: str,
    raw: dict[str, Any],
) -> dict[str, Any]:
    """Normalize strings, dedupe rows, trim letterhead fields."""
    out = dict(raw)

    header = out.get("notice_header")
    if isinstance(header, dict):
        cleaned: dict[str, str] = {}
        for key, val in header.items():
            if isinstance(val, str) and val.strip():
                cleaned[key] = _collapse_ws(val, max_len=4000 if key == "intro_paragraph" else 200)
        out["notice_header"] = cleaned

    rows = out.get("table_rows")
    if isinstance(rows, list):
        seen: set[str] = set()
        cleaned_rows: list[dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_id = str(row.get("id") or "").strip()
            if not row_id or row_id in seen:
                continue
            seen.add(row_id)
            cleaned_rows.append(
                {
                    k: _collapse_ws(str(v), max_len=500)
                    for k, v in row.items()
                    if isinstance(v, str) and str(v).strip()
                }
            )
            if "id" not in cleaned_rows[-1]:
                cleaned_rows[-1]["id"] = row_id
        out["table_rows"] = cleaned_rows[:64]

    if document_type in ("unknown", "general_prose", "contract", "invoice", "hk_member_registry_blocks"):
        summary = out.get("summary")
        if isinstance(summary, str):
            out["summary"] = _collapse_ws(summary, max_len=8000)
        sections = out.get("sections")
        if isinstance(sections, list):
            cleaned_sections: list[dict[str, str]] = []
            for sec in sections:
                if not isinstance(sec, dict):
                    continue
                title = _collapse_ws(str(sec.get("title") or "Section"), max_len=200)
                body = _collapse_ws(str(sec.get("body") or ""), max_len=8000)
                if title or body:
                    cleaned_sections.append({"title": title or "Section", "body": body})
            out["sections"] = cleaned_sections[:32]

    return out


async def run_two_stage_extraction(
    *,
    markdown: str,
    document_type: str,
    llm_cfg: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
) -> ExtractionResult:
    """
    Pass A: block boundaries + structured JSON.
    Pass B: clean + validate; partial on validation failure with readable errors.
    """
    doc_type: DocumentTypeId = document_type if document_type in {
        "hk_member_notice_transfer",
        "hk_member_registry_blocks",
        "general_prose",
        "contract",
        "invoice",
        "unknown",
    } else "unknown"

    heuristic_raw, blocks = extract_pass_a_heuristic(markdown=markdown, document_type=doc_type)
    pass_a_method: Literal["heuristic", "llm", "skipped"] = "heuristic"
    raw = heuristic_raw

    use_llm = (
        isinstance(llm_cfg, dict)
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    )
    if use_llm:
        own_client = client is None
        if own_client:
            client = httpx.AsyncClient()
        try:
            assert client is not None
            llm_raw = await extract_pass_a_llm(
                client,
                llm_cfg=llm_cfg or {},
                markdown=markdown,
                document_type=doc_type,
            )
            if isinstance(llm_raw, dict) and llm_raw:
                raw = llm_raw
                pass_a_method = "llm"
        except Exception as exc:  # noqa: BLE001
            logger.warning("corpus extract_pass_a llm failed: %s", exc)
        finally:
            if own_client and client is not None:
                await client.aclose()

    cleaned = extract_pass_b(document_type=doc_type, raw=raw)
    validated, errors = validate_extraction(doc_type, cleaned)

    if validated is not None:
        return ExtractionResult(
            document_type=doc_type,
            extraction=validated,
            validation_errors=[],
            partial=False,
            pass_a_method=pass_a_method,
            pass_b_applied=True,
            blocks=blocks,
        )

    # Keep cleaned payload for partial UI even when strict validation fails.
    partial_payload = cleaned if cleaned else None
    if partial_payload is None and heuristic_raw:
        partial_payload = extract_pass_b(document_type=doc_type, raw=heuristic_raw)
        validated_fallback, _ = validate_extraction(doc_type, partial_payload)
        if validated_fallback is not None:
            return ExtractionResult(
                document_type=doc_type,
                extraction=validated_fallback,
                validation_errors=errors,
                partial=True,
                pass_a_method="heuristic",
                pass_b_applied=True,
                blocks=blocks,
            )

    return ExtractionResult(
        document_type=doc_type,
        extraction=partial_payload,
        validation_errors=errors or ["validation_failed"],
        partial=True,
        pass_a_method=pass_a_method,
        pass_b_applied=True,
        blocks=blocks,
    )


def attach_extraction_meta(meta: dict[str, Any], result: ExtractionResult) -> None:
    meta["extraction_version"] = 1
    meta["extraction_pass_a_method"] = result.pass_a_method
    meta["extraction_pass_b_applied"] = result.pass_b_applied
    meta["extraction_partial"] = result.partial
    if result.extraction is not None:
        meta["extraction"] = result.extraction
    if result.validation_errors:
        meta["extraction_errors"] = result.validation_errors[:12]
    if result.blocks:
        meta["extraction_blocks"] = [b.model_dump() for b in result.blocks[:48]]
