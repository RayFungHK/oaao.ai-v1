"""Template page → deck slide matching."""

from __future__ import annotations

from oaao_orchestrator.slide_project.template_pages import (
    _pick_template_page_for_slide,
    apply_template_pages_to_slides,
)


def test_pick_avoids_agenda_template_for_regulatory_title() -> None:
    pages = [
        {
            "index": 1,
            "layout": "pptx_master",
            "geometry_slots": [{"slot_id": "title", "text": "FASHION"}],
        },
        {
            "index": 2,
            "layout": "pptx_master",
            "geometry_slots": [
                {"slot_id": "slot_2", "text": "About Today Agenda"},
                {"slot_id": "callout_2", "text": "Creative Process"},
                {"slot_id": "callout_3", "text": "Lorem ipsum"},
            ],
        },
        {
            "index": 3,
            "layout": "pptx_master",
            "geometry_slots": [{"slot_id": "body", "text": "Section body"}],
        },
    ]
    spec = {"index": 2, "title": "合規核心目標", "outline_bullets": ["降低風險", "提升透明度"]}
    picked = _pick_template_page_for_slide(spec, pages, {1})
    assert picked is not None
    assert int(picked["index"]) != 2


def test_apply_uses_content_match_not_deck_index() -> None:
    slides = [
        {"index": 2, "title": "合規管理的三大支柱", "outline_bullets": ["政策", "流程", "監控"]}
    ]
    pages = [
        {
            "index": 1,
            "layout": "pptx_master",
            "geometry_slots": [{"slot_id": "title", "text": "FASHION"}],
            "master_path": "masters/01.html",
        },
        {
            "index": 2,
            "layout": "pptx_master",
            "geometry_slots": [
                {"slot_id": "title", "text": "About Today Agenda"},
                {"slot_id": "callout", "text": "Creative"},
                {"slot_id": "callout_2", "text": "Process"},
                {"slot_id": "callout_3", "text": "Future"},
            ],
            "master_path": "masters/02.html",
        },
        {
            "index": 3,
            "layout": "pptx_master",
            "geometry_slots": [
                {"slot_id": "title", "text": "Section"},
                {"slot_id": "callout", "text": "A"},
                {"slot_id": "callout_2", "text": "B"},
                {"slot_id": "callout_3", "text": "C"},
            ],
            "master_path": "masters/03.html",
        },
    ]
    out = apply_template_pages_to_slides(slides, pages)
    assert int(out[0].get("template_page_index") or 0) != 2


def test_apply_template_pages_does_not_copy_fashion_seeds() -> None:
    slides = [{"index": 1, "title": "Intro"}, {"index": 2, "title": "Goals"}]
    pages = [
        {
            "index": 1,
            "layout": "pptx_master",
            "geometry_slots": [{"slot_id": "title", "text": "A"}],
            "slot_seeds": {"title": "FASHION"},
            "master_path": "masters/01.html",
        },
        {
            "index": 2,
            "layout": "pptx_master",
            "geometry_slots": [{"slot_id": "body", "text": "B"}],
            "slot_seeds": {"body": "MONOCHROME"},
            "master_path": "masters/02.html",
        },
    ]
    out = apply_template_pages_to_slides(slides, pages)
    for row in out:
        assert "slot_seeds" not in row or not row.get("slot_seeds")
