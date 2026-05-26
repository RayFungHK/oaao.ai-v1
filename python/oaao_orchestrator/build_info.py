"""Single source for oaao.ai-v1 version + build metadata (shared with PHP shell)."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

_DEFAULT: dict[str, object] = {
    "version": "0.0.0",
    "build_id": "unknown",
    "built_at": "",
    "git_sha": "",
    "git_branch": "",
    "dirty": False,
    "component": "oaaoai-v1",
}


def _candidate_paths() -> list[Path]:
    env_path = os.environ.get("OAAO_BUILD_INFO_PATH", "").strip()
    paths: list[Path] = []
    if env_path:
        paths.append(Path(env_path))
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    paths.extend(
        [
            repo_root / "build" / "oaao_build_info.json",
            repo_root / "backbone" / "config" / "oaaoai" / "build_info.json",
            Path("/var/www/html/config/oaaoai/build_info.json"),
        ]
    )
    return paths


@lru_cache(maxsize=1)
def load_build_info() -> dict[str, object]:
    """Load build metadata JSON; env overrides win over file fields."""
    data = dict(_DEFAULT)
    for path in _candidate_paths():
        try:
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                if text.startswith("\ufeff"):
                    text = text[1:]
                raw = json.loads(text)
                if isinstance(raw, dict):
                    data.update(raw)
                    break
        except Exception:  # noqa: BLE001
            continue
    version = os.environ.get("OAAO_VERSION", "").strip()
    if version:
        data["version"] = version
    build_id = os.environ.get("OAAO_BUILD_ID", "").strip()
    if build_id:
        data["build_id"] = build_id
    git_sha = os.environ.get("OAAO_GIT_SHA", "").strip()
    if git_sha:
        data["git_sha"] = git_sha
    return data


def version_payload(*, service: str = "oaao_orchestrator") -> dict[str, object]:
    info = load_build_info()
    return {
        "ok": True,
        "service": service,
        "version": str(info.get("version") or _DEFAULT["version"]),
        "build_id": str(info.get("build_id") or _DEFAULT["build_id"]),
        "built_at": str(info.get("built_at") or ""),
        "git_sha": str(info.get("git_sha") or ""),
        "git_branch": str(info.get("git_branch") or ""),
        "dirty": bool(info.get("dirty")),
        "component": str(info.get("component") or "oaaoai-v1"),
    }
