"""Template micro skills — normalize + page picks."""

from __future__ import annotations

from oaao_orchestrator.slide_project.template_micro_skills import (
    micro_skills_prompt_block,
    normalize_micro_skills,
)
from oaao_orchestrator.slide_project.template_pages import apply_template_pages_to_slides


def test_normalize_micro_skills_minimal() -> None:
    raw = {
        "agent_brief": "Use callout masters for three-pillar teaching slides.",
        "pages": [{"index": 3, "layout_role": "callouts", "use_when": "three parallel pillars"}],
        "typography": {"font_stack": "Noto Sans TC, sans-serif", "rules": ["Title ≤ 36 chars CJK"]},
        "colors": {"palette": {"accent": "#2563eb"}, "contrast_rules": ["Body on light bg"]},
        "material_rules": ["Map outline bullets to callout slots left-to-right"],
    }
    out = normalize_micro_skills(raw)
    assert out is not None
    assert "callout" in out["agent_brief"]
    assert out["pages"][0]["index"] == 3
    block = micro_skills_prompt_block(out)
    assert "micro skills" in block.lower()
    assert "p3" in block


def test_apply_respects_page_picks() -> None:
    slides = [{"index": 1, "title": "三大支柱"}]
    pages = [
        {"index": 1, "layout": "pptx_master", "geometry_slots": [{"slot_id": "title"}]},
        {"index": 2, "layout": "pptx_master", "geometry_slots": [{"slot_id": "callout_1"}]},
    ]
    out = apply_template_pages_to_slides(slides, pages, page_picks={1: 2})
    assert int(out[0].get("template_page_index") or 0) == 2
