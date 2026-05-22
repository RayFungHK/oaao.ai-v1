"""SD-2 — slide project store layout and phased build."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from oaao_orchestrator.slide_project.store import SlideProjectStore


@pytest.fixture
def store(tmp_path: Path) -> SlideProjectStore:
    return SlideProjectStore(root=tmp_path)


def test_create_project_shell(store: SlideProjectStore) -> None:
    manifest = store.create_project_shell(
        conversation_id="42",
        user_id="7",
        workspace_id=1,
        title="Test deck",
        slide_count=5,
    )
    assert manifest["project_id"].startswith("sp-")
    assert manifest["status"] == "draft"
    path = store.project_dir(manifest["project_id"]) / "project.json"
    assert path.is_file()


def test_build_deck_without_llm(store: SlideProjectStore) -> None:
    manifest = asyncio.run(
        store.build_deck(
            conversation_id="1",
            assistant_message_id="99",
            user_id="2",
            workspace_id=None,
            run_task_id="rt-test",
            messages=[{"role": "user", "content": "Build a short platform overview deck"}],
            llm_url=None,
        )
    )
    assert manifest["status"] == "ready"
    assert manifest["pages"]
    outline = store.project_dir(manifest["project_id"]) / "deck_outline.md"
    assert outline.is_file()
    first_html = store.project_dir(manifest["project_id"]) / "slides/01/slide.html"
    assert first_html.is_file()
