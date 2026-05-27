"""Phase 2 — template page plan from PPTX profile."""

from __future__ import annotations

from oaao_orchestrator.slide_project.template_pages import (
    apply_template_pages_to_slides,
    build_page_plan_row,
    build_template_pages,
    slot_seeds_for_layout,
)
from oaao_orchestrator.slide_project.template_registry import reload_templates


def setup_module() -> None:
    reload_templates()


def test_build_page_plan_row_faq_via_llm_layout() -> None:
    prof = {
        "index": 3,
        "title_guess": "常見問題",
        "text_sample": "- 什麼時候用？\n- 答：依流程檢查",
        "bullet_count": 2,
        "has_table": False,
    }
    row = build_page_plan_row(
        prof,
        index=3,
        total=5,
        llm_row={"layout": "faq_split"},
    )
    assert row["layout"] == "faq_split"


def test_build_template_pages_has_slot_seeds() -> None:
    profile = {
        "slides": [
            {
                "index": 1,
                "title_guess": "封面",
                "text_sample": "副標題\n開場重點",
                "bullet_count": 0,
                "has_table": False,
            },
            {
                "index": 2,
                "title_guess": "FAQ",
                "text_sample": "- Q1?\n- 答：A1",
                "bullet_count": 2,
                "has_table": False,
            },
        ]
    }
    pages = build_template_pages(
        profile,
        llm_pages=[{"index": 2, "layout": "faq_split"}],
    )
    assert len(pages) == 2
    assert pages[0]["layout"] == "title_hero"
    assert pages[1]["layout"] == "faq_split"
    assert "questions" in pages[1]["slot_seeds"]


def test_apply_template_pages_locks_layout() -> None:
    outline = [
        {"index": 1, "title": "Intro", "theme": "default"},
        {"index": 2, "title": "FAQ", "theme": "default"},
    ]
    tpl = build_template_pages(
        {
            "slides": [
                {"index": 1, "title_guess": "Intro", "text_sample": "x", "bullet_count": 1},
                {
                    "index": 2,
                    "title_guess": "FAQ 常見問題",
                    "text_sample": "- Q\n- 答：A",
                    "bullet_count": 2,
                },
            ]
        },
        llm_pages=[{"index": 2, "layout": "faq_split"}],
    )
    out = apply_template_pages_to_slides(outline, tpl)
    assert out[1]["layout"] == "faq_split"
    assert out[1].get("layout_locked") is True
    assert isinstance(out[1].get("slot_seeds"), dict)


def test_slot_seeds_three_cards() -> None:
    prof = {
        "title_guess": "架構",
        "text_sample": "- a\n- b\n- c\n- d\n- e\n- f",
        "bullet_count": 6,
    }
    seeds = slot_seeds_for_layout("three_cards", prof)
    assert "card_1" in seeds and "card_3" in seeds
