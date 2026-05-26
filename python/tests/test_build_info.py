"""Build info loader tests."""

from __future__ import annotations

import json
from pathlib import Path

from oaao_orchestrator.build_info import load_build_info, version_payload


def test_load_build_info_reads_repo_json(monkeypatch, tmp_path: Path) -> None:
    info_path = tmp_path / "build_info.json"
    info_path.write_text(
        json.dumps(
            {
                "version": "1.2.3",
                "build_id": "abc123",
                "git_sha": "abc123",
                "dirty": False,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("OAAO_BUILD_INFO_PATH", str(info_path))
    load_build_info.cache_clear()
    data = load_build_info()
    assert data["version"] == "1.2.3"
    assert data["build_id"] == "abc123"


def test_version_payload_shape(monkeypatch, tmp_path: Path) -> None:
    info_path = tmp_path / "build_info.json"
    info_path.write_text(json.dumps({"version": "9.9.9", "build_id": "deadbeef"}), encoding="utf-8")
    monkeypatch.setenv("OAAO_BUILD_INFO_PATH", str(info_path))
    load_build_info.cache_clear()
    payload = version_payload()
    assert payload["ok"] is True
    assert payload["version"] == "9.9.9"
    assert payload["build_id"] == "deadbeef"
    assert payload["service"] == "oaao_orchestrator"
