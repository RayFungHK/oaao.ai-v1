from __future__ import annotations

from pathlib import Path

from oaao_orchestrator.live_meeting.audio_store import SegmentWriter


def test_segment_writer_invokes_close_callback(tmp_path: Path) -> None:
    audio_dir = tmp_path / "audio"
    closed: list[tuple[Path, int]] = []

    def _on_closed(path: Path, index: int) -> None:
        closed.append((path, index))

    writer = SegmentWriter(audio_dir, segment_seconds=1, on_segment_closed=_on_closed)
    chunk = b"\x00\x01" * (16_000 * 2)
    writer.write_pcm(chunk)
    writer.write_pcm(chunk)
    writer.close()
    assert len(closed) >= 1
    assert closed[0][0].name.startswith("seg_")


def test_segment_writer_rotates_files(tmp_path: Path) -> None:
    audio_dir = tmp_path / "audio"
    writer = SegmentWriter(audio_dir, segment_seconds=1)
    chunk = b"\x00\x01" * (16_000 * 2)
    writer.write_pcm(chunk)
    writer.write_pcm(chunk)
    writer.close()
    files = sorted(audio_dir.glob("seg_*.pcm"))
    assert len(files) >= 2
    assert sum(f.stat().st_size for f in files) >= len(chunk) * 2
