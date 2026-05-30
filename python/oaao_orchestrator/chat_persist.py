"""Persist assistant message to adjunct SQLite — avoids browser round-trip per stream."""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from datetime import UTC, datetime
from typing import Any

from oaao_orchestrator.php_boundary import chat_persist_enabled, sqlite_adjunct_path
from oaao_orchestrator.run_principal import RunPrincipal

logger = logging.getLogger(__name__)

_MAX_CONTENT = 128_000


def _merge_meta_dict(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge patch onto existing; deep-merge orchestrator_prompt_debug."""
    merged = dict(existing)
    for key, value in patch.items():
        if not isinstance(key, str) or not key:
            continue
        if (
            key == "orchestrator_prompt_debug"
            and isinstance(merged.get(key), dict)
            and isinstance(value, dict)
        ):
            debug = dict(merged[key])
            debug.update(value)
            merged[key] = debug
        else:
            merged[key] = value
    return merged


def persist_assistant_message(
    *,
    principal: RunPrincipal,
    content: str,
    meta: dict[str, Any] | None,
    append: bool = False,
) -> bool:
    if not chat_persist_enabled():
        return False
    path = sqlite_adjunct_path()
    if not path or not os.path.isfile(path):
        logger.debug("chat_persist: sqlite adjunct missing at %s", path)
        return False
    chunk = content if len(content) <= _MAX_CONTENT else content[:_MAX_CONTENT]
    meta_json: str | None = None
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
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
            body = chunk
            if append:
                cur.execute(
                    "SELECT content FROM oaao_message WHERE id = ? AND conversation_id = ? AND role = 'assistant'",
                    (principal.assistant_message_id, principal.conversation_id),
                )
                prefix_row = cur.fetchone()
                prefix = ""
                if prefix_row and prefix_row[0]:
                    prefix = str(prefix_row[0])
                if prefix and chunk:
                    body = prefix + chunk
                elif prefix:
                    body = prefix
                if len(body) > _MAX_CONTENT:
                    body = body[-_MAX_CONTENT:]

            if meta is not None:
                existing_meta: dict[str, Any] = {}
                cur.execute(
                    "SELECT meta_json FROM oaao_message WHERE id = ? AND conversation_id = ? AND role = 'assistant'",
                    (principal.assistant_message_id, principal.conversation_id),
                )
                meta_row = cur.fetchone()
                if meta_row and meta_row[0]:
                    try:
                        decoded = json.loads(str(meta_row[0]))
                        if isinstance(decoded, dict):
                            existing_meta = decoded
                    except (TypeError, ValueError, json.JSONDecodeError):
                        existing_meta = {}
                merged_meta = _merge_meta_dict(existing_meta, meta)
                try:
                    meta_json = json.dumps(merged_meta, ensure_ascii=False, separators=(",", ":"))
                except (TypeError, ValueError):
                    meta_json = None
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


def merge_assistant_meta(
    *,
    principal: RunPrincipal,
    patch: dict[str, Any],
) -> bool:
    """Shallow-merge top-level meta keys; deep-merge orchestrator_prompt_debug."""
    if not chat_persist_enabled() or not patch:
        return False
    path = sqlite_adjunct_path()
    if not path or not os.path.isfile(path):
        return False
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
                "SELECT meta_json FROM oaao_message WHERE id = ? AND conversation_id = ? AND role = 'assistant'",
                (principal.assistant_message_id, principal.conversation_id),
            )
            row = cur.fetchone()
            if row is None:
                return False
            meta: dict[str, Any] = {}
            raw = row[0]
            if raw:
                try:
                    decoded = json.loads(str(raw))
                    if isinstance(decoded, dict):
                        meta = decoded
                except (TypeError, ValueError, json.JSONDecodeError):
                    meta = {}
            meta = _merge_meta_dict(meta, patch)
            meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
            cur.execute(
                "UPDATE oaao_message SET meta_json = ? WHERE id = ? AND conversation_id = ?",
                (meta_json, principal.assistant_message_id, principal.conversation_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()
    except sqlite3.Error as exc:
        logger.warning("chat_persist: merge meta failed: %s", exc)
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
    title = re.sub(r"\s+", " ", raw.strip()).strip("\"'''`")  # noqa: B005
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
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    cur.execute(
        "UPDATE oaao_conversation SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (title, now, conversation_id, user_id),
    )
