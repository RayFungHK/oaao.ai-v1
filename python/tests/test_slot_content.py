"""Tests for per-layout slot markdown merge (no LLM)."""

from __future__ import annotations

from oaao_orchestrator.slide_project.layouts import parse_markdown_body, render_layout_slide
from oaao_orchestrator.slide_project.slot_content import (
    layout_has_slots,
    layout_slot_defs,
    merge_slots_to_markdown,
)
from oaao_orchestrator.slide_project.template_registry import reload_templates


def setup_module() -> None:
    reload_templates()


def test_layouts_declare_slots() -> None:
    assert layout_has_slots("faq_split")
    defs = layout_slot_defs("three_cards")
    assert [d["id"] for d in defs] == ["card_1", "card_2", "card_3"]


def test_merge_faq_split_parses_to_questions_and_answers() -> None:
    md = merge_slots_to_markdown(
        "faq_split",
        {
            "questions": "- Q1?\n- Q2?",
            "answers": "- 答：A1\n- 答：A2",
        },
    )
    parsed = parse_markdown_body(md, "FAQ slide")
    assert len(parsed["bullets"]) >= 4
    html = render_layout_slide(
        spec={"index": 1, "title": "FAQ slide", "layout": "faq_split", "theme": "default"},
        deck_title="Deck",
        content_md=md,
    )
    assert "oaao-faq-grid" in html
    assert "答：" in html or "A1" in html


def test_merge_three_cards_sections() -> None:
    md = merge_slots_to_markdown(
        "three_cards",
        {
            "card_1": "- Alpha\n- Beta",
            "card_2": "### 區塊二\n- Gamma",
            "card_3": "- Delta",
        },
    )
    parsed = parse_markdown_body(md, "Cards")
    assert len(parsed["sections"]) >= 2
    html = render_layout_slide(
        spec={"index": 2, "title": "Cards", "layout": "three_cards", "theme": "default"},
        deck_title="Deck",
        content_md=md,
    )
    assert "oaao-cards" in html


def test_merge_title_content_lead_and_bullets() -> None:
    md = merge_slots_to_markdown(
        "title_content",
        {
            "lead": "This slide introduces the workflow.",
            "bullets": "- Step one\n- Step two\n- Step three",
        },
    )
    parsed = parse_markdown_body(md, "Workflow")
    assert parsed["paragraphs"]
    assert len(parsed["bullets"]) >= 3
