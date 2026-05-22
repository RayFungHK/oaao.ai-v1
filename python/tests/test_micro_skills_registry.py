"""Micro skills registry — bound template + catalog."""

from __future__ import annotations

from oaao_orchestrator.micro_skills.bound_template import (
    bound_template_skill_id,
    skill_entry_from_template_row,
)
from oaao_orchestrator.micro_skills.registry import catalog_from_request


def test_bound_template_skill_id() -> None:
    assert bound_template_skill_id("import_abc") == "bound_template:import_abc"


def test_skill_entry_from_template_row() -> None:
    ent = skill_entry_from_template_row(
        {
            "template_id": "teaching_blue",
            "label": "Teaching Blue",
            "status": "published",
            "micro_skills": {"agent_brief": "Use callout masters for pillars."},
        },
    )
    assert ent is not None
    assert ent.kind == "bound_template"
    assert ent.bind_ref == "teaching_blue"


def test_catalog_from_request() -> None:
    req = type(
        "R",
        (),
        {
            "skills_catalog": [
                {
                    "skill_id": "conversation:abc",
                    "kind": "conversation",
                    "title": "Vol3 outline",
                    "summary": "Handbook vol3 slide mapping",
                },
            ],
        },
    )()
    cat = catalog_from_request(req)
    assert len(cat) == 1
    assert cat[0].skill_id == "conversation:abc"
