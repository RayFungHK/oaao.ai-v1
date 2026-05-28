from pathlib import Path

from oaao_orchestrator.polish_prompt import (
    DEFAULT_TEMPLATE_REF,
    load_template_body,
    render_polish_user_message,
    render_template_text,
    resolve_template_path,
)


def test_resolve_template_path_finds_baked_in_asr_polish() -> None:
    path = resolve_template_path(DEFAULT_TEMPLATE_REF)
    assert path is not None
    assert path.name == "asr_polish.md"
    assert path.is_file()


def test_render_polish_user_message_matches_proven_chat_prompt() -> None:
    msg = render_polish_user_message(
        locale="zh-Hant",
        style="formal",
        raw="我想知道 ai 入面嘅 m 系乜嘢",
    )
    assert "ASR polish expert" in msg
    assert "formal style" in msg
    assert "zh-Hant" in msg
    assert "Return only the polished text" in msg
    assert "我想知道 ai 入面嘅 m 系乜嘢" in msg


def test_render_template_text_substitutes_variables() -> None:
    out = render_template_text("Hello {{name}}!", {"name": "Ray"})
    assert out == "Hello Ray!"


def test_load_template_body_fallback_when_missing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_POLISH_TEMPLATES_DIR", str(tmp_path))
    body = load_template_body(ref="nonexistent.md")
    assert "{{style}}" in body
    assert "ASR polish expert" in body
