"""Shared types for Research extraction backends."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.research.document_schema import ArticleMetadata


@dataclass
class ExtractResult:
    title: str
    body: str
    metadata: ArticleMetadata
    markdown: str = ""
    content_hash: str = ""

    def __post_init__(self) -> None:
        if not self.markdown and self.body:
            from oaao_orchestrator.research.document_schema import wrap_standard_markdown  # noqa: PLC0415

            self.markdown = wrap_standard_markdown(meta=self.metadata, body=self.body)
        if not self.content_hash and self.body:
            from oaao_orchestrator.research.document_schema import digest_body  # noqa: PLC0415

            self.content_hash = digest_body(self.body)
            self.metadata.content_hash = self.content_hash
