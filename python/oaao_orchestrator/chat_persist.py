"""Persist assistant message to adjunct SQLite — avoids browser round-trip per stream."""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

from oaao_orchestrator.php_boundary import chat_persist_enabled, sqlite_adjunct_path
from oaao_orchestrator.run_principal import RunPrincipal

logger = logging.getLogger(__name__)

_MAX_CONTENT = 128_000


def persist_assistant_message(
    *,
    principal: RunPrincipal,
    content: str,
    meta: dict[str, Any] | None,
) -> bool:
    if not chat_persist_enabled():
        return False
    path = sqlite_adjunct_path()
    if not path or not os.path.isfile(path):
        logger.debug("chat_persist: sqlite adjunct missing at %s", path)
        return False
    body = content if len(content) <= _MAX_CONTENT else content[:_MAX_CONTENT]
    meta_json: str | None = None
    if meta:
        try:
            meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            meta_json = None
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn = sqlite3.connect(path, timeout=12.0)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id FROM oaao_conversation WHERE id = ? AND user_id = ?",
                (principal.conversation_id, principal.user_id),
            )
            if cur.fetchone() is None:
                return False
            cur.execute(
                "SELECT id FROM oaao_message WHERE id = ? AND conversation_id = ? AND role = 'assistant'",
                (principal.assistant_message_id, principal.conversation_id),
            )
            if cur.fetchone() is None:
                return False
            if meta_json is not None:
                cur.execute(
                    "UPDATE oaao_message SET content = ?, meta_json = ? WHERE id = ? AND conversation_id = ?",
                    (body, meta_json, principal.assistant_message_id, principal.conversation_id),
                )
            else:
                cur.execute(
                    "UPDATE oaao_message SET content = ? WHERE id = ? AND conversation_id = ?",
                    (body, principal.assistant_message_id, principal.conversation_id),
                )
            _maybe_update_conversation_title(
                cur,
                conversation_id=principal.conversation_id,
                user_id=principal.user_id,
                meta=meta,
            )
            cur.execute(
                "UPDATE oaao_conversation SET updated_at = ? WHERE id = ?",
                (now, principal.conversation_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()
    except sqlite3.Error as exc:
        logger.warning("chat_persist: sqlite failed: %s", exc)
        return False


def _maybe_update_conversation_title(
    cur: sqlite3.Cursor,
    *,
    conversation_id: int,
    user_id: int,
    meta: dict[str, Any] | None,
) -> None:
    if not meta or not isinstance(meta, dict):
        return
    raw = meta.get("conversation_title")
    if not isinstance(raw, str):
        return
    title = re.sub(r"\s+", " ", raw.strip()).strip("\"'""''`")
    if not title or title.lower() in ("", "new chat", "new conversation"):
        return
    if len(title) > 80:
        title = title[:80].rstrip()
    cur.execute(
        "SELECT title FROM oaao_conversation WHERE id = ? AND user_id = ?",
        (conversation_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        return
    cur_title = str(row[0] or "").strip()
    if cur_title and cur_title.lower() not in ("", "new chat", "new conversation"):
        return
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    cur.execute(
        "UPDATE oaao_conversation SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (title, now, conversation_id, user_id),
    )
