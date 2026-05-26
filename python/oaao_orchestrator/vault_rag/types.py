"""Vault RAG shared types (W7-S2 phase 1)."""
from __future__ import annotations

from dataclasses import dataclass, field
@dataclass
class VaultRagCitation:
    vault_id: int
    document_id: int
    file_name: str = ""
    vault_name: str = ""
    path: str = ""
    segment_types: list[str] = field(default_factory=list)
    chunk_index: int | None = None
    segment_index: int | None = None
    begin_ms: int | None = None
    end_ms: int | None = None
    speaker_id: int | None = None
    speaker_label: str = ""
    excerpt: str = ""
    cite_index: int | None = None


@dataclass
class VaultRagOutcome:
    passage_count: int
    profile_hits: int
    detail_lines: list[str] = field(default_factory=list)
    activity_lines: list[str] = field(default_factory=list)
    citation_refs: list[VaultRagCitation] = field(default_factory=list)
    slide_grounding_brief: str = ""
