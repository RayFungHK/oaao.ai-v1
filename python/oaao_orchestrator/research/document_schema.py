"""Standard Research document schema — markdown frontmatter + metadata."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ArticleMetadata:
    title: str = ""
    authors: list[str] = field(default_factory=list)
    published_at: str = ""
    doi: str = ""
    arxiv_id: str = ""
    source_url: str = ""
    content_url: str = ""
    content_kind: str = ""
    content_hash: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def frontmatter_lines(self) -> list[str]:
        lines = [
            f"title: {_yaml_scalar(self.title)}",
            f"source_url: {_yaml_scalar(self.source_url)}",
        ]
        if self.content_url and self.content_url.strip() != self.source_url.strip():
            lines.append(f"content_url: {_yaml_scalar(self.content_url)}")
        if self.content_kind:
            lines.append(f"content_kind: {_yaml_scalar(self.content_kind)}")
        if self.arxiv_id:
            lines.append(f"arxiv_id: {_yaml_scalar(self.arxiv_id)}")
        if self.authors:
            lines.append(f"authors: {_yaml_list(self.authors)}")
        if self.published_at:
            lines.append(f"published_at: {_yaml_scalar(self.published_at)}")
        if self.doi:
            lines.append(f"doi: {_yaml_scalar(self.doi)}")
        if self.content_hash:
            lines.append(f"content_hash: {_yaml_scalar(self.content_hash)}")
        for key, val in self.extra.items():
            if val is None or val == "":
                continue
            if isinstance(val, (list, dict)):
                try:
                    lines.append(f"{key}: {json.dumps(val, ensure_ascii=False)}")
                except (TypeError, ValueError):
                    continue
            else:
                lines.append(f"{key}: {_yaml_scalar(str(val))}")
        return lines


def _yaml_scalar(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return '""'
    if re.search(r'[:#\[\]{}"\'\\]', s) or s.startswith(("-", "?", "@", "&", "*", "!", "|", ">")):
        return json.dumps(s, ensure_ascii=False)
    return s


def _yaml_list(items: list[str]) -> str:
    clean = [str(x).strip() for x in items if str(x).strip()]
    if not clean:
        return "[]"
    inner = ", ".join(_yaml_scalar(x) for x in clean[:40])
    return f"[{inner}]"


def wrap_standard_markdown(*, meta: ArticleMetadata, body: str) -> str:
    title = (meta.title or "article").strip()
    fm = meta.frontmatter_lines()
    parts = ["---", *fm, "---", "", f"# {title}", "", (body or "").strip(), ""]
    return "\n".join(parts)


def digest_body(body: str) -> str:
    return hashlib.sha256((body or "").encode("utf-8", errors="replace")).hexdigest()


def parse_frontmatter(md: str) -> dict[str, Any]:
    text = md or ""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    block = text[3:end].strip()
    out: dict[str, Any] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()
        if not key:
            continue
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            if inner:
                out[key] = [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()]
            else:
                out[key] = []
        elif val.startswith('"') and val.endswith('"'):
            out[key] = val[1:-1]
        else:
            out[key] = val
    return out
