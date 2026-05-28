from __future__ import annotations

from pathlib import Path

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from oaao_orchestrator.live_meeting import hub
from oaao_orchestrator.live_meeting.sse_hub import get_live_stream
from oaao_orchestrator.streaming.events import KIND_LIVE_TRANSCRIPT


@pytest.mark.asyncio
async def test_live_transcript_final_schedules_polish(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    monkeypatch.setenv("OAAO_LIVE_SEGMENT_POLISH", "1")
    polish_mock = AsyncMock(return_value=("你好，世界。", None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)
    monkeypatch.setattr(hub, "_schedule_live_polish", lambda *args, **kwargs: None)

    session = hub.create_session(
        cadence="1v1",
        asr_cfg={"provider": "funasr_nano", "mode": "streaming"},
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id

    await hub._emit_live_transcript(sid, "你好世界", is_final=True, source="test_stream")
    await hub._run_live_polish(sid, 1, "你好世界", "test_stream")

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    status_frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == "status"]
    assert len(frames) == 2
    assert any(env.text == "live_polish_done" for env in status_frames)
    assert frames[0].text == "你好世界"
    assert frames[0].payload.get("polished") is not True
    assert frames[1].text == "你好，世界。"
    assert frames[1].payload.get("polished") is True
    polish_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_live_transcript_partial_skips_polish(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    polish_mock = AsyncMock(return_value=("unused", None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id

    await hub._emit_live_transcript(sid, "你", is_final=False, source="test_stream")

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    assert len(frames) == 1
    assert frames[0].payload.get("is_final") is False
    polish_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_live_polish_rejects_truncated_output(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    raw = "今日我哋講咗好多嘢，包括計劃同埋時間表。" * 3
    polish_mock = AsyncMock(return_value=("系点樣？", None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id

    await hub._run_live_polish(sid, 2, raw, "test_stream")

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    assert len(frames) == 1
    assert frames[0].text == raw
    assert frames[0].payload.get("polished") is True


@pytest.mark.asyncio
async def test_session_transcript_raw_plain_ignores_polished_lines(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id
    raw = "我想知道 ai 入边嘅 llm"
    await hub._emit_live_transcript(sid, raw, is_final=True, source="batch_segment", segment=0)
    await hub._emit_live_transcript(
        sid,
        "我想知道，AI 入邊嘅 LLM。",
        is_final=True,
        source="batch_segment_polish",
        segment=0,
        skip_polish=True,
        polished=True,
        raw_text=raw,
    )
    assert hub._session_transcript_raw_plain(session) == raw


@pytest.mark.asyncio
async def test_resolve_session_raw_plain_prefers_longest_source() -> None:
    runtime = hub._SessionRuntime(
        session=MagicMock(),  # type: ignore[arg-type]
        asr_cfg=None,
        glossary=None,
        live_text_best="我想知道 ai 入边嘅 llm 系讲紧啲乜嘢",
        carry_prompt="又係啲乜嘢嚟",
    )
    session = MagicMock()
    session.transcript_path = Path("/nonexistent/transcript.jsonl")
    assert (
        hub._resolve_session_raw_plain(
            session,
            runtime,
            client_live_text="短句",
        )
        == "我想知道 ai 入边嘅 llm 系讲紧啲乜嘢"
    )


@pytest.mark.asyncio
async def test_note_live_transcript_memory_keeps_longest() -> None:
    runtime = hub._SessionRuntime(session=MagicMock(), asr_cfg=None, glossary=None)  # type: ignore[arg-type]
    hub._note_live_transcript_memory(runtime, "你好")
    hub._note_live_transcript_memory(runtime, "你好世界，今日天氣")
    assert runtime.live_text_best == "你好世界，今日天氣"


@pytest.mark.asyncio
async def test_resolve_session_raw_plain_prefers_carry_longest_line() -> None:
    runtime = hub._SessionRuntime(
        session=MagicMock(),  # type: ignore[arg-type]
        asr_cfg=None,
        glossary=None,
        carry_prompt="短\n我想知道 ai 入边嘅 llm 系讲紧啲乜嘢\n又係",
    )
    session = MagicMock()
    session.transcript_path = Path("/nonexistent/transcript.jsonl")
    assert (
        hub._resolve_session_raw_plain(session, runtime)
        == "我想知道 ai 入边嘅 llm 系讲紧啲乜嘢"
    )


@pytest.mark.asyncio
async def test_batch_segment_runs_when_stream_bridge_active(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    transcribe_mock = AsyncMock(return_value=("batch five second chunk", None))
    monkeypatch.setattr(hub, "transcribe_live_pcm_segment", transcribe_mock)

    session = hub.create_session(
        cadence="1v1",
        asr_cfg={"provider": "funasr_nano", "mode": "streaming", "base_url": "http://live.test"},
        asr_fallback_cfg={
            "provider": "funasr_nano",
            "base_url": "http://batch.test",
            "batch_protocol": "openai_compat",
        },
    )
    sid = session.session_id
    hub._bridges[sid] = object()  # type: ignore[assignment]
    hub._bridge_emit_at[sid] = 1.0

    pcm_path = session.audio_dir / "seg_0001.pcm"
    pcm_path.parent.mkdir(parents=True, exist_ok=True)
    pcm_path.write_bytes(b"\x00" * 32000)

    await hub._process_closed_segment(sid, pcm_path, 1)

    transcribe_mock.assert_awaited_once()
    runtime = hub._runtime[sid]
    assert runtime.batch_asr_by_seg.get(1) == "batch five second chunk"


@pytest.mark.asyncio
async def test_full_session_polish_on_stop(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    raw = "我想知道 ai 入边嘅 llm 系代表乜嘢"
    polished = "我想知道 AI 入邊嘅 LLM 系代表乜嘢？"
    polish_mock = AsyncMock(return_value=(polished, None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)
    monkeypatch.setattr(hub, "polish_transcript_with_live_refs", polish_mock)
    monkeypatch.setattr(hub, "_transcribe_session_pcm_rollup", AsyncMock(return_value=None))

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id
    runtime = hub._runtime[sid]

    await hub._emit_live_transcript(sid, raw, is_final=True, source="batch_segment", segment=0)
    await hub._maybe_full_session_polish_on_stop(sid, session, runtime)

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    assert any(env.text == polished and env.payload.get("full_session_polish") is True for env in frames)
    polish_mock.assert_awaited()


@pytest.mark.asyncio
async def test_full_session_stop_skips_pcm_rollup_when_client_live_present(
    tmp_path: Path, monkeypatch
) -> None:
    """Stop polish uses client live memory only — no slow PCM rollup when live chunks exist."""
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    live_tail = "網站係解釋 AI"
    polished = "網站係解釋 AI？"
    rollup_mock = AsyncMock(return_value="unused batch")
    polish_mock = AsyncMock(return_value=(polished, None))
    monkeypatch.setattr(hub, "_transcribe_session_pcm_rollup", rollup_mock)
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)

    session = hub.create_session(
        cadence="1v1",
        asr_cfg={"provider": "funasr_nano", "mode": "streaming"},
        asr_fallback_cfg={
            "provider": "funasr_nano",
            "base_url": "http://batch.test",
            "batch_protocol": "openai_compat",
        },
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id
    runtime = hub._runtime[sid]
    (session.audio_dir / "seg_000.pcm").write_bytes(b"\x00" * 32000)

    await hub._emit_live_transcript(sid, live_tail, is_final=True, source="funasr_stream", segment=1)
    await hub._maybe_full_session_polish_on_stop(
        sid,
        session,
        runtime,
        client_live_chunks=[live_tail],
    )

    rollup_mock.assert_not_awaited()
    polish_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_full_session_stop_dual_polish_when_client_batch_and_live(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    batch = "呢個網站係解釋 ai 係啲乜嘢嚟"
    live_tail = "AI"
    polished = "呢個網站係解釋 AI 係啲乜嘢嚟？"
    dual_mock = AsyncMock(return_value=(polished, None))
    monkeypatch.setattr(hub, "polish_transcript_with_live_refs", dual_mock)

    session = hub.create_session(
        cadence="1v1",
        asr_cfg={"provider": "funasr_nano", "mode": "streaming"},
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id
    runtime = hub._runtime[sid]

    await hub._maybe_full_session_polish_on_stop(
        sid,
        session,
        runtime,
        client_live_chunks=[live_tail],
        client_batch_chunks=[batch],
    )

    dual_mock.assert_awaited_once()
    _args, kwargs = dual_mock.call_args
    assert kwargs["asr_text"] == batch
    assert live_tail in kwargs["live_chunks"]

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    assert any(env.text == polished and env.payload.get("full_session_polish") is True for env in frames)


@pytest.mark.asyncio
async def test_collect_live_asr_chunks_dedupes_cumulative() -> None:
    runtime = hub._SessionRuntime(
        session=MagicMock(),  # type: ignore[arg-type]
        asr_cfg=None,
        glossary=None,
        live_asr_chunks=["我想", "我想学", "我想学呢啲"],
    )
    session = MagicMock()
    session.transcript_path = Path("/nonexistent/transcript.jsonl")
    chunks = hub._collect_live_asr_chunks(session, runtime, client_live_chunks=["我想学呢啲嘅知識"])
    assert "我想学呢啲嘅知識" in chunks
    assert chunks[-1] == "我想学呢啲嘅知識"


@pytest.mark.asyncio
async def test_full_session_polish_runs_even_when_transcript_already_polished(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    raw = "我想知道 ai 入边嘅 llm 系讲紧啲乜嘢"
    polished = "我想知道 AI 入邊嘅 LLM 系講緊啲乜嘢？"
    polish_mock = AsyncMock(return_value=(polished, None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)
    monkeypatch.setattr(hub, "polish_transcript_with_live_refs", polish_mock)
    monkeypatch.setattr(hub, "_transcribe_session_pcm_rollup", AsyncMock(return_value=None))

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id
    runtime = hub._runtime[sid]

    await hub._emit_live_transcript(sid, raw, is_final=True, source="batch_segment", segment=0)
    await hub._emit_live_transcript(
        sid,
        "我想知道，AI 入邊嘅 LLM 系講緊啲乜嘢。",
        is_final=True,
        source="batch_segment_polish",
        segment=0,
        skip_polish=True,
        polished=True,
        raw_text=raw,
    )
    await hub._maybe_full_session_polish_on_stop(sid, session, runtime)

    stream = get_live_stream(sid)
    frames = [env for _seq, env in stream.snapshot_since(0) if env.kind == KIND_LIVE_TRANSCRIPT]
    assert any(
        env.text == polished and env.payload.get("full_session_polish") is True for env in frames
    )
    polish_mock.assert_awaited()


@pytest.mark.asyncio
async def test_full_session_stop_marks_quick_when_llm_echoes_raw(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    raw = "我想知道 ar 入边嘅 m 权重同埋 kfr 系乜嘢嚟嘅"
    polish_mock = AsyncMock(return_value=(raw, None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)
    monkeypatch.setattr(hub, "polish_transcript_with_live_refs", polish_mock)
    monkeypatch.setattr(hub, "_transcribe_session_pcm_rollup", AsyncMock(return_value=None))

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
        locale="zh-Hant",
    )
    sid = session.session_id
    runtime = hub._runtime[sid]

    stats = await hub._maybe_full_session_polish_on_stop(
        sid,
        session,
        runtime,
        client_live_text=raw,
    )

    assert stats["polish_phase"] == "quick"
    assert stats.get("polish_error") == "polish_no_substantive_change"
    assert polish_mock.await_count >= 2


@pytest.mark.asyncio
async def test_full_session_stop_marks_llm_when_substantive(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    raw = "我想知道 ar 入边嘅 m 权重同埋 kfr 系乜嘢嚟嘅"
    polished = "我想了解 AR 中的 M 權重以及 KFR 是什麼意思？"
    polish_mock = AsyncMock(return_value=(polished, None))
    monkeypatch.setattr(hub, "polish_transcript", polish_mock)
    monkeypatch.setattr(hub, "polish_transcript_with_live_refs", polish_mock)
    monkeypatch.setattr(hub, "_transcribe_session_pcm_rollup", AsyncMock(return_value=None))

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
        locale="zh-Hant",
    )
    sid = session.session_id
    runtime = hub._runtime[sid]

    stats = await hub._maybe_full_session_polish_on_stop(
        sid,
        session,
        runtime,
        client_live_text=raw,
    )

    assert stats["polish_phase"] == "llm"
    assert stats["polished_text"] == polished
    assert stats["polish_quality"] >= 50


@pytest.mark.asyncio
async def test_live_transcript_skips_segment_polish_by_default(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("OAAO_LIVE_MEETING_ROOT", str(tmp_path))
    monkeypatch.delenv("OAAO_LIVE_SEGMENT_POLISH", raising=False)
    scheduled: list[tuple[Any, ...]] = []

    def _capture(*args: Any, **kwargs: Any) -> None:
        scheduled.append((args, kwargs))

    monkeypatch.setattr(hub, "_schedule_live_polish", _capture)

    session = hub.create_session(
        cadence="1v1",
        polish_cfg={"base_url": "http://llm.test", "model": "m"},
    )
    sid = session.session_id

    await hub._emit_live_transcript(sid, "你好世界", is_final=True, source="test_stream")

    assert scheduled == []
