"""PCM segment writer — 16 kHz mono s16le under ``session/audio/seg_*.pcm``."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
DEFAULT_SEGMENT_SECONDS = 5


class SegmentWriter:
    """Rotate segment files when a chunk reaches ``segment_seconds`` of audio."""

    def __init__(
        self,
        audio_dir: Path,
        *,
        segment_seconds: int = DEFAULT_SEGMENT_SECONDS,
        on_segment_closed: Callable[[Path, int], None] | None = None,
    ) -> None:
        self._dir = audio_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        self._max_bytes = max(
            SAMPLE_RATE * BYTES_PER_SAMPLE,
            SAMPLE_RATE * BYTES_PER_SAMPLE * max(1, segment_seconds),
        )
        self._index = 0
        self._fh = None
        self._path: Path | None = None
        self._bytes_in_segment = 0
        self._total_bytes = 0
        self._on_segment_closed = on_segment_closed

    @property
    def total_bytes(self) -> int:
        return self._total_bytes

    def _emit_segment_closed(self) -> None:
        if self._on_segment_closed is None or self._path is None or self._bytes_in_segment <= 0:
            return
        try:
            self._on_segment_closed(self._path, self._index)
        except Exception:
            logger.exception("live_meeting on_segment_closed failed path=%s", self._path)

    def _open_next_segment(self) -> None:
        if self._fh is not None:
            self._emit_segment_closed()
            self._fh.close()
            self._fh = None
        self._index += 1
        self._path = self._dir / f"seg_{self._index:04d}.pcm"
        self._fh = self._path.open("ab")
        self._bytes_in_segment = 0
        logger.debug("live_meeting segment_open path=%s", self._path)

    def write_pcm(self, chunk: bytes) -> None:
        if not chunk:
            return
        offset = 0
        while offset < len(chunk):
            if self._fh is None:
                self._open_next_segment()
            assert self._fh is not None
            room = self._max_bytes - self._bytes_in_segment
            if room <= 0:
                self._open_next_segment()
                room = self._max_bytes
            take = min(len(chunk) - offset, room)
            self._fh.write(chunk[offset : offset + take])
            self._bytes_in_segment += take
            self._total_bytes += take
            offset += take
            if self._bytes_in_segment >= self._max_bytes:
                self._open_next_segment()

    def close(self) -> None:
        if self._fh is not None:
            self._emit_segment_closed()
            self._fh.close()
            self._fh = None
        logger.info(
            "live_meeting segments_closed dir=%s segments=%s total_bytes=%s",
            self._dir,
            self._index,
            self._total_bytes,
        )
