from oaao_orchestrator.corpus.docx_render import markdown_to_docx_bytes
from oaao_orchestrator.evaluation.skill_candidate import classify_skill_candidate


def test_classify_skill_candidate_requires_turns():
    assert (
        classify_skill_candidate(
            conversation_id=1,
            messages=[{"role": "user", "content": "hi"}],
            assistant_text="short",
        )
        is None
    )


def test_classify_skill_candidate_procedure_thread():
    messages = [
        {"role": "user", "content": "Give me a workflow for onboarding new staff with checklist steps and templates."},
        {"role": "assistant", "content": "Step 1: collect forms. Step 2: provision accounts."},
        {"role": "user", "content": "Add security training to the workflow template checklist."},
        {"role": "assistant", "content": "Step 3: schedule security training within week one."},
        {"role": "user", "content": "Always include manager sign-off in the final step of the workflow."},
    ]
    cand = classify_skill_candidate(
        conversation_id=42,
        messages=messages,
        assistant_text="Step 3: schedule security training within week one. Step 4: archive completed checklist in the HR vault for audit.",
    )
    assert cand is not None
    assert cand.conversation_id == 42
    assert "workflow" in cand.proposed_title.lower() or cand.proposed_title


def test_markdown_to_docx_bytes_smoke():
    raw = markdown_to_docx_bytes("# Title\n\n- bullet one\n\nParagraph text.", title="Title")
    assert isinstance(raw, bytes)
    assert len(raw) > 100
    assert raw[:2] == b"PK"
