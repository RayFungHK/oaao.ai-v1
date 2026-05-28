from oaao_orchestrator.quick_punctuate import load_quick_punctuate_rules, quick_punctuate_transcript


def test_load_quick_punctuate_rules_has_comma_words() -> None:
    rules = load_quick_punctuate_rules()
    words = rules.get("comma_before_words")
    assert isinstance(words, list)
    assert "同埋" in words


def test_quick_punctuate_uses_loaded_rules() -> None:
    raw = "我想知道ai入邊嘅llm系乜嘢同埋权重系啲乜嘢"
    out = quick_punctuate_transcript(raw)
    assert "，同埋" in out
    assert out.endswith("。") or out.endswith("？")
