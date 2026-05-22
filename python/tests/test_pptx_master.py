"""Phase 3 — PPTX geometry + positioned master HTML."""

from __future__ import annotations

import json
from pathlib import Path

from oaao_orchestrator.slide_project.pptx_master import (
    _ensure_pptx_decor_in_html,
    build_master_html,
    fill_master_html,
    geometry_slots_typography_css,
    render_pptx_master_slide,
    _slot_content_html,
)
from oaao_orchestrator.slide_project.template_pages import build_page_plan_row
from oaao_orchestrator.slide_project.template_slot_plan import is_placeholder_text


def test_slot_content_html_bullets() -> None:
    html = _slot_content_html("- One\n- Two")
    assert "<ul" in html and "One" in html and "Two" in html


def test_geometry_typography_css_uses_pptx_metadata() -> None:
    geom = [
        {
            "slot_id": "title",
            "left_pct": 5.0,
            "top_pct": 8.0,
            "width_pct": 60.0,
            "height_pct": 18.0,
            "font_pt": 28,
            "font_weight": 700,
            "color": "#112233",
            "role": "title",
        },
    ]
    css = geometry_slots_typography_css(geom)
    assert "28.0pt" in css
    assert "#112233" in css
    assert "font-weight: 700" in css


def test_build_master_has_positioned_slots() -> None:
    geom = [
        {
            "slot_id": "title",
            "left_pct": 5.0,
            "top_pct": 8.0,
            "width_pct": 90.0,
            "height_pct": 12.0,
            "text": "Hello",
        },
        {
            "slot_id": "body",
            "left_pct": 5.0,
            "top_pct": 25.0,
            "width_pct": 90.0,
            "height_pct": 60.0,
            "text": "- a\n- b",
        },
    ]
    doc = build_master_html(geom, title="T", slot_values={"title": "Hi", "body": "- x\n- y"})
    assert "data-slot-id=\"title\"" in doc
    assert "oaao-pptx-slot" in doc
    assert "oaao-slide-topbar" not in doc
    assert "flex-direction: column" not in doc or "display: block" in doc
    assert "left:5%" in doc or "left:5.0%" in doc
    assert "Hi" in doc
    assert "x" in doc


def test_build_page_plan_uses_pptx_master_when_geometry() -> None:
    prof = {
        "index": 2,
        "title_guess": "FAQ",
        "text_sample": "- Q?\n- 答：A",
        "bullet_count": 2,
        "geometry_slots": [
            {
                "slot_id": "questions",
                "left_pct": 5,
                "top_pct": 20,
                "width_pct": 40,
                "height_pct": 50,
                "text": "- Q?",
            },
            {
                "slot_id": "answers",
                "left_pct": 50,
                "top_pct": 20,
                "width_pct": 45,
                "height_pct": 50,
                "text": "- 答：A",
            },
        ],
    }
    row = build_page_plan_row(prof, index=2, total=3)
    assert row["layout"] == "pptx_master"
    assert "questions" in row["slot_seeds"]


def test_is_placeholder_text_catches_business_template_copy() -> None:
    assert is_placeholder_text("Your Company")
    assert is_placeholder_text("Business Plan Presentation")
    assert is_placeholder_text("Mauris ut lacus. Fusce vel dui.")


def test_fill_master_clears_unfilled_template_placeholders() -> None:
    master = (
        '<div class="oaao-slide-canvas">'
        '<div class="oaao-pptx-slot" data-slot-id="title">'
        '<div class="oaao-pptx-slot-inner"><p>About Today Agenda</p></div></div>'
        '<div class="oaao-pptx-slot" data-slot-id="body">'
        '<div class="oaao-pptx-slot-inner"><p>MONOCHROME</p></div></div>'
        "</div>"
    )
    filled = fill_master_html(master, {"title": "合規核心目標"})
    assert "About Today Agenda" not in filled
    assert "合規核心目標" in filled
    assert "MONOCHROME" not in filled


def test_ensure_pptx_decor_injects_when_only_css_rule_present(tmp_path: Path) -> None:
    (tmp_path / "render").mkdir()
    (tmp_path / "render" / "01.png").write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82",
    )
    html = (
        '<html><body><div class="oaao-slide-canvas oaao-layout-pptx_master">'
        "<style>.oaao-pptx-decor { z-index: 0; }</style>"
        "</div></body></html>"
    )
    spec = {"index": 1, "template_id": "import_test"}
    out = _ensure_pptx_decor_in_html(html, spec, template_asset_dir=tmp_path)
    assert '<div class="oaao-pptx-decor"' in out
    assert "template_render" in out


def test_render_pptx_master_strips_decor_when_slots_filled(tmp_path: Path) -> None:
    (tmp_path / "render").mkdir()
    (tmp_path / "render" / "01.png").write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82",
    )
    master = (
        '<div class="oaao-slide-canvas oaao-layout-pptx_master">'
        '<div class="oaao-pptx-decor" aria-hidden="true"><img src="/t.png" alt="" /></div>'
        '<div class="oaao-pptx-slot" data-slot-id="title">'
        '<div class="oaao-pptx-slot-inner"><p>MONOCHROME</p></div></div>'
        "</div>"
    )
    geom = [
        {
            "slot_id": "title",
            "left_pct": 5.0,
            "top_pct": 8.0,
            "width_pct": 90.0,
            "height_pct": 12.0,
            "text": "MONOCHROME",
        },
    ]
    slide_dir = tmp_path / "slides" / "01"
    slide_dir.mkdir(parents=True)
    (slide_dir / "slots.json").write_text(
        json.dumps({"layout": "pptx_master", "slots": {"title": "合規核心"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    html = render_pptx_master_slide(
        spec={"index": 1, "template_id": "t1", "geometry_slots": geom, "master_path": "m.html"},
        deck_title="Deck",
        content_md="",
        master_html=master,
        project_dir=tmp_path,
        template_asset_dir=tmp_path,
    )
    assert "oaao-pptx-decor" not in html
    assert "合規核心" in html
    assert "MONOCHROME" not in html


def test_render_pptx_master_uses_slots_json_from_project_root(tmp_path: Path) -> None:
    slide_dir = tmp_path / "slides" / "01"
    slide_dir.mkdir(parents=True)
    (slide_dir / "slots.json").write_text(
        json.dumps(
            {
                "layout": "pptx_master",
                "slots": {"title": "法規合規管理概論", "body": "- 重點一"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    geom = [
        {
            "slot_id": "title",
            "left_pct": 5.0,
            "top_pct": 8.0,
            "width_pct": 90.0,
            "height_pct": 12.0,
            "text": "Your Company",
        },
        {
            "slot_id": "body",
            "left_pct": 5.0,
            "top_pct": 25.0,
            "width_pct": 90.0,
            "height_pct": 60.0,
            "text": "Business Plan Presentation",
        },
    ]
    doc = build_master_html(geom, title="T")
    html = render_pptx_master_slide(
        spec={
            "index": 1,
            "title": "法規合規管理概論",
            "geometry_slots": geom,
            "slot_seeds": {"title": "Your Company", "body": "Crafting the Future"},
        },
        deck_title="Handbook",
        content_md="- outline body",
        master_html=doc,
        project_dir=tmp_path,
    )
    assert "法規合規管理概論" in html
    assert "Your Company" not in html
    assert "Business Plan" not in html
