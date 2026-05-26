"""Process ephemeral chat attachments before LLM — extract text, vision images, inline audio ASR."""

from __future__ import annotations

import base64
import logging
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.asr_common import run_asr_pipeline_on_file
from oaao_orchestrator.vault_document_extract import build_embedding_pieces, extract_text_segments

logger = logging.getLogger(__name__)

_ATTACHMENT_INLINE_CITATIONS = (
    "When a sentence uses an attached file excerpt below, add citation marker(s) at the end "
    "of that sentence using the exact keys shown (e.g. [A1], [A2]). "
    "Use only keys that appear in the attachment excerpts. Do not invent keys. "
    "If your answer relies on attached content, include at least one such marker."
)


@dataclass
class AttachmentCitation:
    cite_key: str
    attachment_id: int = 0
    file_name: str = ""
    mime_type: str = ""
    excerpt: str = ""


def _endpoint_supports_vision(endpoint: dict[str, Any]) -> bool:
    caps = endpoint.get("capabilities")
    if isinstance(caps, dict) and caps.get("supports_vision") is True:
        return True
    model = str(endpoint.get("model") or "").lower()
    for hint in ("gpt-4o", "gpt-4.1", "gpt-5", "claude-3", "gemini", "vision", "vl-"):
        if hint in model:
            return True
    return False


def _image_data_url(path: str, mime: str) -> str | None:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        raw = p.read_bytes()
        if len(raw) > 12_000_000:
            return None
        mt = mime if mime.startswith("image/") else (mimetypes.guess_type(path)[0] or "image/png")
        b64 = base64.standard_b64encode(raw).decode("ascii")
        return f"data:{mt};base64,{b64}"
    except OSError:
        return None


def _excerpt_from_text(text: str, *, limit: int = 280) -> str:
    raw = (text or "").replace("\r\n", "\n")
    lines = raw.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return ""
    flat = re.sub(r"\s+", " ", "\n".join(lines).strip())
    if not flat:
        return ""
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


async def process_chat_attachments(
    client: httpx.AsyncClient,
    messages: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    *,
    endpoint: dict[str, Any],
    asr_cfg: dict[str, Any] | None = None,
    polish_cfg: dict[str, Any] | None = None,
    glossary: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Augment messages with attachment context. Returns (messages, pipeline_fragment).
    """
    if not attachments:
        return messages, {}

    numbered_blocks: list[str] = []
    attachment_citations: list[AttachmentCitation] = []
    image_urls: list[str] = []
    file_names: list[str] = []
    audio_done = 0
    cite_serial = 0

    for att in attachments:
        if not isinstance(att, dict):
            continue
        path = str(att.get("absolute_path") or att.get("path") or "").strip()
        mime = str(att.get("mime_type") or att.get("mime") or "").strip().lower()
        fname = str(att.get("file_name") or att.get("name") or Path(path).name or "file")
        if fname:
            file_names.append(fname)
        try:
            aid = int(att.get("id") or 0)
        except (TypeError, ValueError):
            aid = 0
        if not path:
            continue

        if mime.startswith("audio/"):
            text, _meta = await run_asr_pipeline_on_file(
                client,
                audio_path=path,
                asr_cfg=asr_cfg,
                polish_cfg=polish_cfg,
                glossary=glossary,
                polish_enabled=True,
            )
            if text:
                cite_serial += 1
                key = f"A{cite_serial}"
                numbered_blocks.append(f"[{key}] {fname} · audio\n{text.strip()[:32000]}")
                attachment_citations.append(
                    AttachmentCitation(
                        cite_key=key,
                        attachment_id=aid,
                        file_name=fname,
                        mime_type=mime,
                        excerpt=_excerpt_from_text(text),
                    )
                )
                audio_done += 1
            continue

        if mime.startswith("image/"):
            if _endpoint_supports_vision(endpoint):
                url = _image_data_url(path, mime)
                if url:
                    image_urls.append(url)
                    continue
            try:
                import pytesseract
                from PIL import Image

                ocr = pytesseract.image_to_string(Image.open(path), lang="eng+chi_tra")
                if (ocr or "").strip():
                    cite_serial += 1
                    key = f"A{cite_serial}"
                    body = ocr.strip()[:24000]
                    numbered_blocks.append(f"[{key}] {fname} · image OCR\n{body}")
                    attachment_citations.append(
                        AttachmentCitation(
                            cite_key=key,
                            attachment_id=aid,
                            file_name=fname,
                            mime_type=mime,
                            excerpt=_excerpt_from_text(body),
                        )
                    )
            except Exception as e:  # noqa: BLE001
                logger.info("chat_attachments: image OCR skip %s — %s", fname, e)
            continue

        p = Path(path)
        segs = extract_text_segments(p, mime)
        body = ""
        if segs:
            pieces = build_embedding_pieces(segs, chunk_size=2800, overlap=260, max_chunks=12)
            body = "\n\n".join(t for t, _ in pieces[:8]).strip()[:32000]
        else:
            try:
                flat = p.read_text(encoding="utf-8", errors="replace")
                if flat.strip():
                    body = flat.strip()[:32000]
            except OSError:
                body = ""
        if body:
            cite_serial += 1
            key = f"A{cite_serial}"
            body = body.strip()
            numbered_blocks.append(f"[{key}] {fname}\n{body}")
            attachment_citations.append(
                AttachmentCitation(
                    cite_key=key,
                    attachment_id=aid,
                    file_name=fname,
                    mime_type=mime,
                    excerpt=_excerpt_from_text(body),
                )
            )

    out_msgs = list(messages)
    if numbered_blocks:
        block = "\n\n---\n\n".join(numbered_blocks)
        sys = (
            "The user attached files for this turn only (not in vault). Use excerpts below when relevant.\n\n"
            + _ATTACHMENT_INLINE_CITATIONS
            + "\n\n"
            + block
        )
        out_msgs.insert(0, {"role": "system", "content": sys})

    if image_urls and out_msgs:
        for i in range(len(out_msgs) - 1, -1, -1):
            m = out_msgs[i]
            if str(m.get("role") or "").lower() != "user":
                continue
            prev = m.get("content")
            parts: list[dict[str, Any]] = []
            if isinstance(prev, str) and prev.strip():
                parts.append({"type": "text", "text": prev})
            elif isinstance(prev, list):
                parts.extend(x for x in prev if isinstance(x, dict))
            for url in image_urls[:4]:
                parts.append({"type": "image_url", "image_url": {"url": url}})
            if parts:
                out_msgs[i] = {**m, "content": parts}
            break

    rail_detail = file_names[:8] if file_names else [f"{len(attachments)} file(s)"]
    blocks: list[dict[str, Any]] = []
    if attachment_citations:
        blocks.append(
            {
                "type": "attachment_citations",
                "zone": "inline",
                "props": {
                    "inline": True,
                    "references": [
                        {
                            "cite_key": c.cite_key,
                            "attachment_id": c.attachment_id,
                            "file_name": c.file_name,
                            "mime_type": c.mime_type,
                            "excerpt": c.excerpt,
                        }
                        for c in attachment_citations
                    ],
                },
            }
        )
    pipeline = {
        "milestone": {
            "steps": [
                {
                    "title": "Attachments",
                    "description": "Extract text / vision / ASR for this turn.",
                    "state": "completed",
                    "rail": {
                        "badge": f"Attachments · {len(attachments)}",
                        "detail_lines": rail_detail,
                    },
                },
            ],
        },
        "blocks": blocks,
    }
    return out_msgs, pipeline
