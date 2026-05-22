"""Rich deck_outline.md (Manus-style per-slide scripts)."""

from __future__ import annotations

from oaao_orchestrator.slide_project.outline_markdown import (
    format_deck_outline_markdown,
    merge_manus_scripts_into_slides,
    parse_manus_presentation_slides,
)


def test_parse_manus_presentation_slides() -> None:
    text = """# 1 - 開場

各位好，今天我們談合規。

# 2 - 議程

接下來依序說明三個主題。
"""
    got = parse_manus_presentation_slides(text)
    assert 1 in got and "開場" in got[1]["title"]
    assert "各位好" in got[1]["script"]
    assert 2 in got and "議程" in got[2]["title"]


def test_format_deck_outline_includes_script() -> None:
    md = format_deck_outline_markdown(
        "Handbook Vol.3",
        [
            {
                "index": 1,
                "title": "概覽",
                "slide_script": "各位，本卷重點在於法規遵循的三個層次。",
                "outline_bullets": ["定義", "範圍"],
                "layout": "pptx_master",
            },
        ],
    )
    assert "### Slide 1: 概覽" in md
    assert "各位，本卷重點" in md
    assert "**重點**" in md
    assert "- 定義" in md
    assert "`layout: pptx_master`" in md


def test_merge_manus_scripts_into_slides() -> None:
    slides = [{"index": 1, "title": "Slide 1", "theme": "default"}]
    manus = {1: {"title": "開場", "script": "完整講稿段落。"}}
    merged = merge_manus_scripts_into_slides(slides, manus)
    assert merged[0]["slide_script"] == "完整講稿段落。"
