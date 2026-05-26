"""Signed run principal — PHP issues at send; Python validates for the whole run."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


def _shared_secret() -> str:
    from oaao_orchestrator._internal_secret import require_internal_secret

    return require_internal_secret()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(seg: str) -> bytes:
    pad = "=" * ((4 - len(seg) % 4) % 4)
    return base64.urlsafe_b64decode(seg + pad)


@dataclass(frozen=True)
class RunPrincipal:
    user_id: int
    conversation_id: int
    assistant_message_id: int
    workspace_id: int | None = None
    tenant_id: int | None = None
    exp: int = 0

    def matches_request(
        self,
        *,
        user_id: str | None,
        conversation_id: str | None,
        assistant_message_id: str | None,
        workspace_id: int | None,
        tenant_id: int | None,
    ) -> bool:
        try:
            uid = int(str(user_id or "").strip() or "0")
            cid = int(str(conversation_id or "").strip() or "0")
            amid = int(str(assistant_message_id or "").strip() or "0")
        except ValueError:
            return False
        if uid != self.user_id or cid != self.conversation_id or amid != self.assistant_message_id:
            return False
        if (
            self.workspace_id is not None
            and workspace_id is not None
            and self.workspace_id != workspace_id
        ):
            return False
        if self.tenant_id is not None and tenant_id is not None and self.tenant_id != tenant_id:  # noqa: SIM103
            return False
        return True


def issue_token(
    *,
    user_id: int,
    conversation_id: int,
    assistant_message_id: int,
    workspace_id: int | None = None,
    tenant_id: int | None = None,
    ttl_sec: int = 7200,
    secret: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "v": 1,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "assistant_message_id": assistant_message_id,
        "exp": int(time.time()) + max(60, ttl_sec),
    }
    if workspace_id is not None and workspace_id > 0:
        payload["workspace_id"] = workspace_id
    if tenant_id is not None and tenant_id > 0:
        payload["tenant_id"] = tenant_id
    body = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    key = (secret or _shared_secret()).encode("utf-8")
    sig = hmac.new(key, body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(token: str, *, secret: str | None = None) -> RunPrincipal | None:
    raw = (token or "").strip()
    if "." not in raw:
        return None
    body, sig = raw.rsplit(".", 1)
    key = (secret or _shared_secret()).encode("utf-8")
    expect = hmac.new(key, body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return None
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    exp = int(payload.get("exp") or 0)
    if exp < int(time.time()):
        return None
    try:
        uid = int(payload.get("user_id") or 0)
        cid = int(payload.get("conversation_id") or 0)
        amid = int(payload.get("assistant_message_id") or 0)
    except (TypeError, ValueError):
        return None
    if uid < 1 or cid < 1 or amid < 1:
        return None
    wid_raw = payload.get("workspace_id")
    tid_raw = payload.get("tenant_id")
    wid = int(wid_raw) if wid_raw is not None else None
    tid = int(tid_raw) if tid_raw is not None else None
    return RunPrincipal(
        user_id=uid,
        conversation_id=cid,
        assistant_message_id=amid,
        workspace_id=wid if wid and wid > 0 else None,
        tenant_id=tid if tid and tid > 0 else None,
        exp=exp,
    )


def require_for_request(req: object) -> RunPrincipal | None:
    token = getattr(req, "run_principal", None)
    if not isinstance(token, str) or not token.strip():
        return None
    principal = verify_token(token)
    if principal is None:
        logger.warning("run_principal: invalid or expired token")
        return None
    if not principal.matches_request(
        user_id=getattr(req, "user_id", None),
        conversation_id=getattr(req, "conversation_id", None),
        assistant_message_id=getattr(req, "assistant_message_id", None),
        workspace_id=getattr(req, "workspace_id", None),
        tenant_id=getattr(req, "tenant_id", None),
    ):
        logger.warning("run_principal: token fields mismatch request payload")
        return None
    return principal
