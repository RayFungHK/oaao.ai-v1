"""Signed strip action token — mirrors ``ChatStripHash`` (PHP)."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from oaao_orchestrator.run_principal import _b64url_encode, _shared_secret

logger = logging.getLogger(__name__)

_STRIP_VERSION = 1
_DEFAULT_TTL_SEC = 604800


def payload_digest(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def issue_strip_hash(
    *,
    user_id: int,
    conversation_id: int,
    message_id: int,
    action_id: str,
    payload: Any,
    ttl_sec: int = _DEFAULT_TTL_SEC,
) -> str:
    import hmac
    import time

    action_id = str(action_id or "").strip().lower()
    if user_id < 1 or conversation_id < 1 or message_id < 1 or not action_id:
        raise ValueError("strip_hash issue requires user, conversation, message, action_id")

    body_payload: dict[str, Any] = {
        "v": _STRIP_VERSION,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "action_id": action_id,
        "payload_digest": payload_digest(payload),
        "exp": int(time.time()) + max(300, ttl_sec),
    }
    body = _b64url_encode(
        json.dumps(body_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    sig = hmac.new(_shared_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"v{_STRIP_VERSION}.{body}.{sig}"
