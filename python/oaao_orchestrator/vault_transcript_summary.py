"""Vault hook vh.rag.transcript_summary — LLM summarisation for View Transcript."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.asr_common import ensure_url_scheme, openai_compat_chat_url

logger = logging.getLogger(__name__)


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name.strip())
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


async def process_vault_transcript_summary(
    client: httpx.AsyncClient,
    job: dict[str, Any],
) -> tuple[str, str | None, dict[str, Any]]:
    hook = str(job.get("hook_id") or "")
    if hook != "vh.rag.transcript_summary":
        return "failed", f"unsupported_hook:{hook}", {}

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    if not isinstance(payload, dict):
        return "failed", "missing_payload", {}

    summary_cfg = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    llm = summary_cfg.get("llm") if isinstance(summary_cfg.get("llm"), dict) else {}
    model = str(llm.get("model") or "").strip()
    bu = str(llm.get("base_url") or "").strip()
    url_direct = str(llm.get("url") or "").strip()
    if not model or (not url_direct and not bu):
        return "failed", "summary_missing_llm_binding", {}

    source_text = str(payload.get("source_text") or "").strip()
    if not source_text:
        return "failed", "transcript_not_available", {}

    system_prompt = str(summary_cfg.get("system_prompt") or "").strip()
    if not system_prompt:
        return "failed", "summary_missing_system_prompt", {}

    file_name = str(payload.get("file_name") or "").strip()
    doc_id = payload.get("document_id")
    template_label = str(payload.get("template_label") or "Summary").strip()
    user_content = str(summary_cfg.get("user_content") or "").strip()
    if user_content:
        user_body = user_content
    else:
        user_prefix = str(summary_cfg.get("user_prefix") or "").strip()
        user_body = f"{user_prefix}{source_text[:120000]}".strip() if user_prefix else source_text[:120000]

    api_key = _resolve_secret(llm.get("api_key_env") if isinstance(llm.get("api_key_env"), str) else None)
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_body},
        ],
        "temperature": 0.3,
        "stream": False,
    }

    try:
        r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(180.0, connect=15.0))
        if r.status_code >= 400:
            return "failed", f"summary_llm_http_{r.status_code}:{(r.text or '')[:400]}", {}
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return "failed", str(e)[:4000], {}

    summary_text = ""
    choices = data.get("choices") if isinstance(data, dict) else None
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content")
            if isinstance(content, str):
                summary_text = content.strip()

    if not summary_text:
        return "failed", "empty_summary_from_llm", {}

    finish_extras: dict[str, Any] = {
        "transcript_summary": {
            "status": "completed",
            "template_id": str(payload.get("template_id") or "").strip(),
            "template_label": template_label,
            "template_emoji": str(payload.get("template_emoji") or "").strip(),
            "summary_language": str(payload.get("summary_language") or "auto").strip(),
            "text": summary_text[:500000],
            "purpose_key": llm.get("purpose_key"),
            "model": model,
            "embed_to_rag": bool(payload.get("embed_to_rag")),
            "file_name": file_name,
            "document_id": doc_id,
        },
        "enqueue_document_embed": bool(payload.get("embed_to_rag")),
        "source_text": source_text[:500000],
        "usage": {"char_count": len(summary_text)},
    }

    logger.info(
        "vault_transcript_summary: job=%s doc=%s template=%s chars=%s",
        job.get("job_id"),
        doc_id,
        payload.get("template_id"),
        len(summary_text),
    )
    return "completed", None, finish_extras
