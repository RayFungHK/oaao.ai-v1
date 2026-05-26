"""On-disk session layout under ``OAAO_LIVE_MEETING_ROOT``."""

from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def live_meeting_root() -> Path:
    raw = os.environ.get("OAAO_LIVE_MEETING_ROOT", "").strip()
    if raw:
        return Path(raw)
    return Path("/var/www/html/sites/oaaoai/oaaoai/data/live-meeting")


def new_session_id() -> str:
    return f"lm_{secrets.token_hex(12)}"


@dataclass
class LiveMeetingSession:
    session_id: str
    root: Path
    cadence: str = "1v1"
    retention_mode: str = "disk_ttl"
    workspace_id: int | None = None
    user_id: int | None = None
    status: str = "active"
    asr_cfg: dict[str, Any] | None = None

    @property
    def session_dir(self) -> Path:
        return self.root / "sessions" / self.session_id

    @property
    def audio_dir(self) -> Path:
        return self.session_dir / "audio"

    @property
    def meta_path(self) -> Path:
        return self.session_dir / "meta.json"

    @property
    def transcript_path(self) -> Path:
        return self.session_dir / "transcript.jsonl"

    def ensure_dirs(self) -> None:
        self.audio_dir.mkdir(parents=True, exist_ok=True)

    def write_meta(self) -> None:
        payload: dict[str, Any] = {
            "session_id": self.session_id,
            "cadence": self.cadence,
            "retention_mode": self.retention_mode,
            "workspace_id": self.workspace_id,
            "user_id": self.user_id,
            "status": self.status,
            "created_at": int(time.time()),
        }
        if isinstance(self.asr_cfg, dict) and self.asr_cfg:
            payload["asr"] = {
                "purpose_key": self.asr_cfg.get("purpose_key"),
                "model": self.asr_cfg.get("model"),
                "provider": self.asr_cfg.get("provider"),
                "mode": self.asr_cfg.get("mode") or self.asr_cfg.get("asr_mode"),
            }
        self.meta_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @classmethod
    def load(cls, session_id: str, *, root: Path | None = None) -> LiveMeetingSession | None:
        sid = (session_id or "").strip()
        if not sid:
            return None
        base = root or live_meeting_root()
        meta_path = base / "sessions" / sid / "meta.json"
        if not meta_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(meta, dict):
            return None
        return cls(
            session_id=sid,
            root=base,
            cadence=str(meta.get("cadence") or "1v1"),
            retention_mode=str(meta.get("retention_mode") or "disk_ttl"),
            workspace_id=int(meta["workspace_id"])
            if meta.get("workspace_id") is not None
            else None,
            user_id=int(meta["user_id"]) if meta.get("user_id") is not None else None,
            status=str(meta.get("status") or "active"),
        )

    def mark_stopped(self, *, keep_audio: bool) -> None:
        self.status = "stopped"
        if self.meta_path.is_file():
            try:
                meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                meta = {}
        else:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta["status"] = "stopped"
        meta["keep_audio"] = bool(keep_audio)
        meta["stopped_at"] = int(time.time())
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
