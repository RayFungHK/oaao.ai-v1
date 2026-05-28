from oaao_orchestrator.quick_punctuate import quick_punctuate_transcript


def test_quick_punctuate_adds_comma_and_period() -> None:
    raw = "我想知道ai入邊嘅llm系乜嘢同埋权重系啲乜嘢"
    out = quick_punctuate_transcript(raw)
    assert "，同埋" in out
    assert out.endswith("。") or out.endswith("？")


def test_quick_punctuate_preserves_existing_punctuation() -> None:
    raw = "你好，世界。"
    assert quick_punctuate_transcript(raw) == raw
