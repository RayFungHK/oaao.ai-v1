"""CS-1-S16 — document_type classification + Pydantic extraction schema registry."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from oaao_orchestrator.corpus.llm import _extract_json_object, chat_completion_text

logger = logging.getLogger(__name__)

REGISTRY_VERSION = 1
_REGISTRY_FILENAME = "corpus-schema-registry.json"
_CONTRACTS_SUBDIR = Path("contracts") / "v1"

DocumentTypeId = Literal[
    "hk_member_notice_transfer",
    "hk_member_registry_blocks",
    "general_prose",
    "contract",
    "invoice",
    "unknown",
]

_LAYOUT_BY_TYPE: dict[str, str] = {
    "hk_member_notice_transfer": "table_notice",
    "hk_member_registry_blocks": "member_blocks",
    "general_prose": "prose",
    "contract": "generic",
    "invoice": "generic",
    "unknown": "generic",
}

_MEMBER_BLOCK_RE = re.compile(r"【第\s*\d+\s*號行員】")
_TRANSFER_TITLE_RE = re.compile(r"行員申請轉讓會籍")
_TABLE_HEADER_RE = re.compile(r"編號|轉讓會籍|公佈日期|執行司理")


class RegistryTypeEntry(BaseModel):
    id: str
    label: str
    description: str = ""
    extract_schema: str
    layout_hint: str = "generic"


class SchemaRegistryV1(BaseModel):
    version: int = 1
    types: list[RegistryTypeEntry]


class DocumentClassifyResult(BaseModel):
    document_type: DocumentTypeId
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = ""
    layout_hint: str = "generic"
    method: str = "heuristic"


class NoticeHeaderExtract(BaseModel):
    file_ref: str = ""
    notice_date: str = ""
    salutation: str = ""
    notice_title: str = ""
    intro_paragraph: str = ""


class TableRowExtract(BaseModel):
    id: str
    before: str = ""
    after: str = ""
    introducer: str = ""
    date: str = ""


class HkMemberNoticeTransferExtract(BaseModel):
    notice_header: NoticeHeaderExtract | None = None
    table_rows: list[TableRowExtract] = Field(default_factory=list)


class UnknownSection(BaseModel):
    title: str
    body: str = ""


class UnknownDocumentExtract(BaseModel):
    summary: str = ""
    sections: list[UnknownSection] = Field(default_factory=list)


_EXTRACT_MODELS: dict[str, type[BaseModel]] = {
    "hk_member_notice_transfer": HkMemberNoticeTransferExtract,
    "unknown": UnknownDocumentExtract,
}


def _repo_contracts_dir() -> Path | None:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / _CONTRACTS_SUBDIR
        if (candidate / _REGISTRY_FILENAME).is_file():
            return candidate
    return None


def default_registry_entries() -> list[RegistryTypeEntry]:
    return [
        RegistryTypeEntry(
            id="hk_member_notice_transfer",
            label="HK member transfer table notice",
            description="Letterhead + numbered table rows (membership transfer).",
            extract_schema="corpus-extract-hk_member_notice_transfer.json",
            layout_hint="table_notice",
        ),
        RegistryTypeEntry(
            id="hk_member_registry_blocks",
            label="HK member registry blocks",
            description="Repeating 【第 N 號行員】 field blocks.",
            extract_schema="corpus-extract-unknown.json",
            layout_hint="member_blocks",
        ),
        RegistryTypeEntry(
            id="general_prose",
            label="General prose",
            description="Narrative document without repeating registry blocks.",
            extract_schema="corpus-extract-unknown.json",
            layout_hint="prose",
        ),
        RegistryTypeEntry(
            id="contract",
            label="Contract (placeholder)",
            description="Reserved for CS-1-S17 contract schema.",
            extract_schema="corpus-extract-unknown.json",
            layout_hint="generic",
        ),
        RegistryTypeEntry(
            id="invoice",
            label="Invoice (placeholder)",
            description="Reserved for CS-1-S17 invoice schema.",
            extract_schema="corpus-extract-unknown.json",
            layout_hint="generic",
        ),
        RegistryTypeEntry(
            id="unknown",
            label="Unknown",
            description="Classifier could not map to a supported schema.",
            extract_schema="corpus-extract-unknown.json",
            layout_hint="generic",
        ),
    ]


def load_schema_registry() -> SchemaRegistryV1:
    contracts = _repo_contracts_dir()
    if contracts is not None:
        path = contracts / _REGISTRY_FILENAME
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return SchemaRegistryV1.model_validate(raw)
        except (OSError, json.JSONDecodeError, ValidationError) as exc:
            logger.warning("corpus schema registry load failed %s: %s", path, exc)
    return SchemaRegistryV1(version=REGISTRY_VERSION, types=default_registry_entries())


def get_type_entry(registry: SchemaRegistryV1, document_type: str) -> RegistryTypeEntry | None:
    for entry in registry.types:
        if entry.id == document_type:
            return entry
    return None


def classify_document_heuristic(markdown: str) -> DocumentClassifyResult:
    text = (markdown or "").strip()
    if not text:
        return DocumentClassifyResult(
            document_type="unknown",
            confidence=0.0,
            reason="empty_markdown",
            layout_hint="generic",
            method="heuristic",
        )

    has_transfer = bool(_TRANSFER_TITLE_RE.search(text))
    has_table_hdr = bool(_TABLE_HEADER_RE.search(text))
    row_starts = len(re.findall(r"(?m)^\d{3}(?:\s+|\t)", text))
    member_blocks = len(_MEMBER_BLOCK_RE.findall(text))

    if has_transfer and (has_table_hdr or row_starts >= 2):
        return DocumentClassifyResult(
            document_type="hk_member_notice_transfer",
            confidence=0.82 if row_starts >= 2 else 0.62,
            reason="transfer_title_and_table_signals",
            layout_hint="table_notice",
            method="heuristic",
        )

    if member_blocks >= 2:
        return DocumentClassifyResult(
            document_type="hk_member_registry_blocks",
            confidence=0.78,
            reason="repeated_member_markers",
            layout_hint="member_blocks",
            method="heuristic",
        )

    if len(text) > 400:
        return DocumentClassifyResult(
            document_type="general_prose",
            confidence=0.45,
            reason="long_prose_no_registry_pattern",
            layout_hint="prose",
            method="heuristic",
        )

    return DocumentClassifyResult(
        document_type="unknown",
        confidence=0.35,
        reason="no_supported_pattern",
        layout_hint="generic",
        method="heuristic",
    )


async def classify_document_llm(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any],
    markdown: str,
    profile_name: str = "",
) -> DocumentClassifyResult | None:
    registry = load_schema_registry()
    type_ids = [t.id for t in registry.types]
    sample = (markdown or "")[:12_000]
    system = (
        "You classify business documents for Corpus Studio. "
        "Output ONLY valid JSON matching CorpusDocumentClassifyV1: "
        '{"document_type":"<id>","confidence":0.0-1.0,"reason":"...","layout_hint":"..."} '
        f"document_type MUST be one of: {', '.join(type_ids)}. "
        "Use hk_member_notice_transfer for HK exchange membership transfer TABLE notices. "
        "Use hk_member_registry_blocks for 【第 N 號行員】 repeating blocks. "
        "Use unknown when unsure."
    )
    user = (
        f"Profile: {profile_name or 'Corpus'}\n\n"
        f"Document markdown excerpt:\n{sample}"
    )
    raw = await chat_completion_text(
        client,
        llm_cfg=llm_cfg,
        system=system,
        user=user,
        temperature=0.1,
        timeout_sec=45.0,
    )
    if not raw:
        return None
    parsed = _extract_json_object(raw)
    if not isinstance(parsed, dict):
        return None
    try:
        doc_type = str(parsed.get("document_type") or "unknown").strip()
        if doc_type not in type_ids:
            doc_type = "unknown"
        conf = float(parsed.get("confidence") or 0.5)
        conf = max(0.0, min(1.0, conf))
        layout = str(parsed.get("layout_hint") or _LAYOUT_BY_TYPE.get(doc_type, "generic"))
        return DocumentClassifyResult(
            document_type=doc_type,  # type: ignore[arg-type]
            confidence=conf,
            reason=str(parsed.get("reason") or "")[:500],
            layout_hint=layout,
            method="llm",
        )
    except (TypeError, ValueError, ValidationError):
        return None


async def classify_document(
    *,
    markdown: str,
    llm_cfg: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
    profile_name: str = "",
) -> DocumentClassifyResult:
    heuristic = classify_document_heuristic(markdown)
    use_llm = (
        isinstance(llm_cfg, dict)
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    )
    if not use_llm:
        return heuristic

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient()
    try:
        assert client is not None
        llm_result = await classify_document_llm(
            client,
            llm_cfg=llm_cfg or {},
            markdown=markdown,
            profile_name=profile_name,
        )
    finally:
        if own_client and client is not None:
            await client.aclose()

    if llm_result and llm_result.confidence >= heuristic.confidence - 0.05:
        return llm_result
    return heuristic


def validate_extraction(document_type: str, payload: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """
    Validate extraction JSON against the Pydantic model for ``document_type``.
    Returns (validated_dict, errors).
    """
    model_cls = _EXTRACT_MODELS.get(document_type)
    if model_cls is None:
        return None, [f"no_pydantic_model_for:{document_type}"]
    if not isinstance(payload, dict):
        return None, ["payload_must_be_object"]
    try:
        model = model_cls.model_validate(payload)
        return model.model_dump(exclude_none=True), []
    except ValidationError as exc:
        return None, [e["msg"] for e in exc.errors()][:12]


def attach_document_type_meta(
    meta: dict[str, Any],
    *,
    classification: DocumentClassifyResult,
    registry: SchemaRegistryV1 | None = None,
) -> None:
    reg = registry or load_schema_registry()
    entry = get_type_entry(reg, classification.document_type)
    meta["document_type"] = classification.document_type
    meta["document_type_confidence"] = round(classification.confidence, 3)
    meta["document_type_method"] = classification.method
    meta["document_type_reason"] = classification.reason
    meta["layout_hint"] = classification.layout_hint or _LAYOUT_BY_TYPE.get(
        classification.document_type, "generic"
    )
    if entry:
        meta["extraction_schema_id"] = entry.extract_schema
        meta["document_type_label"] = entry.label
    meta["schema_registry_version"] = reg.version


def registry_type_ids() -> list[str]:
    return [t.id for t in load_schema_registry().types]
