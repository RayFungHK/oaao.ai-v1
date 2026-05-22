"""SD-2 — slide preview pipeline blocks merged into run snapshot."""

from __future__ import annotations

from oaao_orchestrator.agents.slide_pipeline_blocks import build_slide_preview_strip_block
from oaao_orchestrator.tasks.models import AgentResult


def test_build_slide_preview_strip_block_shape() -> None:
    block = build_slide_preview_strip_block(run_task_id="rt-slides")
    assert block["type"] == "slide_preview_strip"
    assert block["zone"] == "after"
    props = block["props"]
    assert isinstance(props, dict)
    slides = props.get("slides")
    assert isinstance(slides, list) and len(slides) >= 2
    assert props.get("material_thumb")


def test_build_slide_preview_strip_block_deck_artifact() -> None:
    manifest = {
        "project_id": "proj-abc",
        "title": "Executive deck",
        "slide_count": 3,
        "pages": [
            {"index": 1, "title": "Cover", "preview_url": "/slide-designer/api/slide_html?project_id=proj-abc&page=1"},
        ],
        "files": [
            {"name": "Executive_deck.pptx", "size_bytes": 787_456},
            {"name": "export_ppt_fix.log"},
        ],
    }
    block = build_slide_preview_strip_block(run_task_id="rt-1", manifest=manifest)
    props = block["props"]
    assert props.get("project_id") == "proj-abc"
    assert props.get("project_title") == "Executive deck"
    assert props.get("slide_count") == 3
    artifact = props.get("deck_artifact")
    assert isinstance(artifact, dict)
    assert artifact.get("filename") == "Executive_deck.pptx"
    assert artifact.get("size_bytes") == 787_456


def test_agent_result_pipeline_blocks_merge_pattern() -> None:
    """Document contract used by run_executor."""
    result = AgentResult(
        success=True,
        artifacts=[{"id": "a1", "name": "deck.pptx"}],
        extra={"pipeline_blocks": [build_slide_preview_strip_block(run_task_id="rt-1")]},
    )
    blocks = result.extra.get("pipeline_blocks")
    assert isinstance(blocks, list) and blocks[0]["type"] == "slide_preview_strip"
