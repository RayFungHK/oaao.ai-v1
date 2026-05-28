"""CS-AUDIT-3 — plan.json keyword routing removed."""

from __future__ import annotations

from oaao_orchestrator.slide_project.layout_plan import diversify_slide_layouts
from oaao_orchestrator.slide_project.template_registry import title_hint_layout


def test_title_hint_layout_always_none():
    assert title_hint_layout("FAQ 常見問題") is None
    assert title_hint_layout("案例實戰") is None


def test_diversify_uses_rotation_not_keywords():
    spec = [{"index": 1, "title": "FAQ 問答"}, {"index": 2, "title": "案例"}]
    out = diversify_slide_layouts(spec)
    assert out[0]["layout"] == "title_hero"
    assert out[1]["layout"] != out[0]["layout"]
