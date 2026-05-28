from oaao_orchestrator.quick_punctuate import (
    finalize_polish_output,
    quick_punctuate_transcript,
    sentence_break_score,
)


def test_quick_punctuate_cantonese_multi_question() -> None:
    raw = (
        "我想知道ai入边嘅llm系乜嘢嚟嘅乜嘢叫做kv乜嘢叫做权重"
        "同埋我可以点样去学习呢啲嘢"
    )
    out = quick_punctuate_transcript(raw)
    assert "，同埋" in out
    assert sentence_break_score(out) >= 2
    assert out.endswith("。") or out.endswith("？")


def test_quick_punctuate_repeated_matje() -> None:
    raw = "我想知道 lom 入边嘅 a 系乜嘢机ee 系乜嘢权重系乜嘢"
    out = quick_punctuate_transcript(raw)
    assert "系乜嘢？" in out or "係乜嘢？" in out
    assert sentence_break_score(out) >= 2


def test_finalize_polish_output_rejects_truncated_llm() -> None:
    raw = "我想知道ai入边嘅llm系乜嘢嚟嘅乜嘢叫做kv乜嘢叫做权重同埋我可以点样去学习呢啲嘢"
    llm = "我想知道llm系乜权重点样学习"
    out = finalize_polish_output(llm, raw)
    assert len(out) >= len(raw) * 0.72
    assert sentence_break_score(out) >= 1


def test_finalize_polish_output_punctuates_clean_llm() -> None:
    raw = "hello world"
    llm = "hello world test"
    out = finalize_polish_output(llm, raw)
    assert out.endswith("。")


def test_finalize_polish_output_keeps_short_concise_llm() -> None:
    raw = (
        "我想知道 ai 入边嘅 m 系乜嘢？，嚟 kv 系乜嘢嚟，同埋权众系乜嘢嚟"
        "可唔可以介绍一啲书本俾我学习 ai。"
    )
    llm = (
        "我想了解人工智慧（AI）中的「模型」（Model）究竟是什麼？"
        "「KV Cache」又是什麼概念？另外，「權重」（Weight）是什麼意思？"
        "能否推薦一些相關的書籍供我學習 AI？"
    )
    out = finalize_polish_output(llm, raw)
    assert out == llm
    assert "KV Cache" in out
    assert "入边" not in out


def test_finalize_polish_output_trusts_well_segmented_llm() -> None:
    raw = "我想知道ai入边嘅llm系乜嘢同埋权重"
    llm = "我想知道 AI 入邊嘅 LLM 係乜嘢？權重係乜嘢？"
    out = finalize_polish_output(llm, raw)
    assert out == llm
