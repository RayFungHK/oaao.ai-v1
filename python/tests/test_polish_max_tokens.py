from oaao_orchestrator.asr_common import (
    _polish_output_hard_cap,
    _resolve_polish_max_output_tokens,
    _trim_polish_user_content,
    estimate_text_tokens,
)
from oaao_orchestrator.llm_model_info import suggested_max_output_tokens


def test_polish_max_output_tokens_caps_at_256_by_default() -> None:
    assert _resolve_polish_max_output_tokens(950, {}) == 256


def test_polish_max_output_tokens_scales_for_short_text() -> None:
    assert _resolve_polish_max_output_tokens(40, {}) == 136


def test_polish_max_output_tokens_honours_cfg_up_to_hard_cap() -> None:
    assert _resolve_polish_max_output_tokens(950, {"max_output_tokens": 768}) == 256


def test_polish_max_output_tokens_endpoint_1024_capped_for_voice_polish() -> None:
    assert _resolve_polish_max_output_tokens(78, {"max_output_tokens": 1024}) == 256


def test_polish_max_output_tokens_respects_context_budget() -> None:
    assert _resolve_polish_max_output_tokens(
        950, {}, prompt_tokens=900, context_len=1024
    ) == 76


def test_polish_max_output_tokens_cfg_capped_by_context() -> None:
    assert _resolve_polish_max_output_tokens(
        950, {"max_output_tokens": 768}, prompt_tokens=200, context_len=1024
    ) == 256


def test_polish_output_hard_cap_default() -> None:
    assert _polish_output_hard_cap() == 256


def test_estimate_text_tokens_conservative() -> None:
    assert estimate_text_tokens("abcd") == 2
    assert estimate_text_tokens("你好世界") == 2


def test_trim_polish_user_content_keeps_tail() -> None:
    head = "task instruction: "
    tail = "x" * 400
    trimmed = _trim_polish_user_content(head + tail, max_chars=220)
    assert trimmed.endswith("x" * 220)
    assert len(trimmed) <= 220


def test_trim_polish_user_content_passthrough_when_short() -> None:
    msg = "task: \"hello\""
    assert _trim_polish_user_content(msg, max_chars=2048) == msg


def test_suggested_max_output_tokens_for_small_model() -> None:
    assert suggested_max_output_tokens(1024) == 358
