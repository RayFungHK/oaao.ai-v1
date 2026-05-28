from oaao_orchestrator.corpus.xlsx_render import markdown_to_xlsx_bytes, table_data_to_xlsx_bytes
from oaao_orchestrator.evaluation.calendar_event_candidate import classify_calendar_event_candidate
from oaao_orchestrator.evaluation.skill_upgrade import pick_skill_upgrade_candidate
from oaao_orchestrator.micro_skills.apply import inject_applied_micro_skills
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def test_pick_skill_upgrade_at_threshold(monkeypatch):
    monkeypatch.setenv("OAAO_SKILL_UPGRADE_USAGE_THRESHOLD", "3")
    cand = pick_skill_upgrade_candidate(
        conversation_id=1,
        skill_rows=[{"skill_id": "conversation:x", "title": "T", "usage_count": 3, "version": 1}],
    )
    assert cand is not None
    assert cand.skill_id == "conversation:x"
    payload = cand.to_dict()
    assert "v2" in payload["proposed_title"].lower()


def test_inject_applied_micro_skills():
    req = type(
        "R",
        (),
        {
            "skills_catalog": [
                {
                    "skill_id": "conversation:test",
                    "kind": "conversation",
                    "title": "Onboard",
                    "summary": "HR onboarding",
                    "payload": {"agent_brief": "Always collect ID before provisioning."},
                    "preview_markdown": "# Onboard",
                    "status": "published",
                }
            ]
        },
    )()
    plan = RunPlan(
        tasks=[RunTaskSpec(id="rt-llm-stream", title="Compose", type=RunTaskType.LLM_STREAM)],
        apply_skill_ids=["conversation:test"],
    )
    messages = [{"role": "user", "content": "hi"}]
    applied = inject_applied_micro_skills(messages, req=req, plan=plan)
    assert applied == ["conversation:test"]
    assert any(
        m.get("role") == "system" and "conversation:test" in str(m.get("content") or "")
        for m in messages
    )


def test_classify_calendar_event_candidate_meeting():
    messages = [
        {"role": "user", "content": "Schedule a team meeting on 2026-06-15 at 14:00 location: Room 3A"},
    ]
    cand = classify_calendar_event_candidate(
        conversation_id=9,
        messages=messages,
        assistant_text="Confirmed — I'll block 2026-06-15 at 14:00 for the team meeting in Room 3A.",
    )
    assert cand is not None
    assert cand.conversation_id == 9
    assert "2026" in cand.start_at


def test_markdown_to_xlsx_bytes_smoke():
    md = "| Name | Qty |\n| --- | --- |\n| Widget | 2 |\n"
    raw = markdown_to_xlsx_bytes(md, title="Orders")
    assert isinstance(raw, bytes)
    assert len(raw) > 100
    assert raw[:2] == b"PK"


def test_table_data_to_xlsx_bytes_smoke():
    raw = table_data_to_xlsx_bytes(
        columns=[("name", "Name"), ("qty", "Qty")],
        rows=[{"name": "A", "qty": "1"}],
        title="T",
    )
    assert raw[:2] == b"PK"


def test_corpus_font_parse_and_embed_off(monkeypatch):
    from oaao_orchestrator.corpus.cjk_fonts import (
        build_print_font_face_css,
        embed_mode,
        parse_font_families_from_css,
        resolve_print_css,
    )

    monkeypatch.setenv("OAAO_CORPUS_PDF_EMBED_FONTS", "off")
    css = 'body { font-family: "Custom Corp", "Noto Sans TC", sans-serif; }'
    assert parse_font_families_from_css(css) == ["Custom Corp", "Noto Sans TC"]
    assert build_print_font_face_css(css) == ""
    assert resolve_print_css(css) == css
    assert embed_mode() == "off"
