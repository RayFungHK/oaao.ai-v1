"""Map vault job wire format to ``contracts/v1/vault-job.envelope.json`` kinds."""

from __future__ import annotations

from typing import Any

_HOOK_TO_KIND: dict[str, str] = {
    "vh.rag.document_embed": "embed",
    "vh.rag.graph_index": "graph_index",
    "vh.rag.audio_asr": "asr",
    "vh.rag.transcript_summary": "transcript_summary",
}


def hook_id_to_kind(hook_id: str) -> str:
    hook = (hook_id or "").strip()
    return _HOOK_TO_KIND.get(hook, hook or "unknown")


def job_dict_to_envelope(job: dict[str, Any]) -> dict[str, Any]:
    """Best-effort envelope for contract validation / debug (does not replace PHP claim wire)."""
    jid = job.get("job_id")
    hook = str(job.get("hook_id") or "")
    payload = job.get("payload")
    return {
        "protocol_version": "1",
        "kind": hook_id_to_kind(hook),
        "job_id": int(jid) if jid is not None else 0,
        "hook_id": hook,
        "payload": payload if isinstance(payload, dict) else {},
    }
