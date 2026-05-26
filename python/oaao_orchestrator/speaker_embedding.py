"""Extract L2-normalized speaker voiceprint embeddings from audio segments (ffmpeg + numpy)."""

from __future__ import annotations

import asyncio
import logging
import struct
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

EMBED_DIM = 128
SAMPLE_RATE = 16_000
MIN_CLIP_MS = 800
MAX_CLIP_MS = 15_000
MAX_CLIPS_PER_SPEAKER = 3


async def _ffmpeg_extract_pcm(
    audio_path: Path,
    *,
    begin_ms: int,
    end_ms: int,
) -> bytes | None:
    begin = max(0, begin_ms) / 1000.0
    end = max(begin + 0.2, end_ms / 1000.0)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{begin:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(audio_path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "s16le",
        "pipe:1",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        if proc.returncode != 0 or not out:
            if err:
                logger.debug("ffmpeg clip failed: %s", err[:200])
            return None
        return out
    except (FileNotFoundError, OSError) as e:
        logger.warning("ffmpeg unavailable for speaker embedding: %s", e)
        return None


def _pcm_to_float32(pcm: bytes) -> np.ndarray:
    count = len(pcm) // 2
    if count < 1:
        return np.zeros(0, dtype=np.float32)
    samples = struct.unpack(f"<{count}h", pcm[: count * 2])
    arr = np.asarray(samples, dtype=np.float32) / 32768.0
    return arr


def _mel_filterbank(n_fft: int, n_mels: int, sample_rate: int) -> np.ndarray:
    """Simple triangular mel filterbank (HTK-style approximation)."""
    fmin = 0.0
    fmax = sample_rate / 2.0

    def hz_to_mel(hz: float) -> float:
        return 2595.0 * np.log10(1.0 + hz / 700.0)

    def mel_to_hz(mel: float) -> float:
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

    mels = np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), n_mels + 2)
    hz = mel_to_hz(mels)
    bins = np.floor((n_fft + 1) * hz / sample_rate).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float64)
    for i in range(n_mels):
        left, center, right = bins[i], bins[i + 1], bins[i + 2]
        if center <= left:
            center = left + 1
        if right <= center:
            right = center + 1
        for j in range(left, center):
            if 0 <= j < fb.shape[1]:
                fb[i, j] = (j - left) / max(center - left, 1)
        for j in range(center, right):
            if 0 <= j < fb.shape[1]:
                fb[i, j] = (right - j) / max(right - center, 1)
    return fb


def compute_embedding_from_pcm(pcm: bytes) -> list[float] | None:
    """Log-mel + coarse spectral stats → fixed-size voiceprint vector."""
    samples = _pcm_to_float32(pcm)
    if samples.size < SAMPLE_RATE // 4:
        return None

    frame_len = 400
    hop = 160
    n_fft = 512
    n_mels = 64
    frames: list[np.ndarray] = []
    window = np.hanning(frame_len).astype(np.float32)

    for start in range(0, samples.size - frame_len, hop):
        chunk = samples[start : start + frame_len] * window
        spec = np.fft.rfft(chunk, n=n_fft)
        power = (spec.real**2 + spec.imag**2).astype(np.float64)
        frames.append(power)

    if not frames:
        return None

    power_stack = np.stack(frames, axis=0).astype(np.float64)
    mel_fb = _mel_filterbank(n_fft, n_mels, SAMPLE_RATE)
    mel = np.maximum(power_stack @ mel_fb.T, 1e-10)
    log_mel = np.log(mel)
    mel_mean = log_mel.mean(axis=0)
    mel_std = log_mel.std(axis=0)

    # Spectral centroid / rolloff / zero-crossing rate summaries.
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / SAMPLE_RATE)
    centroids: list[float] = []
    zcrs: list[float] = []
    for frame in frames:
        total = frame.sum()
        if total <= 0:
            continue
        centroids.append(float((freqs * frame).sum() / total))
        zcrs.append(float(np.mean(np.abs(np.diff(np.sign(samples[:frame_len])))) / 2.0))

    stats = np.asarray(
        [
            float(np.mean(centroids)) if centroids else 0.0,
            float(np.std(centroids)) if centroids else 0.0,
            float(np.mean(zcrs)) if zcrs else 0.0,
            float(log_mel.mean()),
            float(log_mel.std()),
        ],
        dtype=np.float64,
    )

    vec = np.concatenate([mel_mean, mel_std, stats])
    if vec.size < EMBED_DIM:  # noqa: SIM108
        vec = np.pad(vec, (0, EMBED_DIM - vec.size))
    else:
        vec = vec[:EMBED_DIM]

    norm = float(np.linalg.norm(vec))
    if norm <= 1e-9:
        return None
    vec = (vec / norm).astype(np.float64)

    return [round(float(x), 6) for x in vec.tolist()]


def _pick_clips_for_speaker(
    segments: list[dict[str, Any]], speaker_id: int
) -> list[tuple[int, int]]:
    """Return up to N (begin_ms, end_ms) clips, preferring longer utterances."""
    clips: list[tuple[int, int, int]] = []
    for seg in segments:
        if int(seg.get("speaker_id", -1)) != speaker_id:
            continue
        begin = max(0, int(seg.get("begin_ms") or 0))
        end = max(begin + MIN_CLIP_MS, int(seg.get("end_ms") or begin + MIN_CLIP_MS))
        dur = min(MAX_CLIP_MS, end - begin)
        if dur < MIN_CLIP_MS:
            continue
        clips.append((dur, begin, begin + dur))

    clips.sort(key=lambda x: x[0], reverse=True)
    return [(b, e) for _, b, e in clips[:MAX_CLIPS_PER_SPEAKER]]


async def extract_speaker_embeddings(
    audio_path: str | Path,
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Build one embedding per distinct speaker_id in segments.

    Returns [{speaker_id, embedding: [float, ...]}, ...].
    """
    path = Path(audio_path)
    if not path.is_file() or not segments:
        return []

    speaker_ids = sorted({int(s.get("speaker_id", 0)) for s in segments if isinstance(s, dict)})
    out: list[dict[str, Any]] = []

    for sid in speaker_ids:
        clips = _pick_clips_for_speaker(segments, sid)
        if not clips:
            continue

        vectors: list[np.ndarray] = []
        for begin_ms, end_ms in clips:
            pcm = await _ffmpeg_extract_pcm(path, begin_ms=begin_ms, end_ms=end_ms)
            if pcm is None:
                continue
            emb = compute_embedding_from_pcm(pcm)
            if emb is None:
                continue
            vectors.append(np.asarray(emb, dtype=np.float64))

        if not vectors:
            continue

        mean_vec = np.mean(np.stack(vectors, axis=0), axis=0)
        norm = float(np.linalg.norm(mean_vec))
        if norm <= 1e-9:
            continue
        mean_vec = mean_vec / norm
        out.append(
            {
                "speaker_id": sid,
                "embedding": [round(float(x), 6) for x in mean_vec.tolist()],
            }
        )

    return out
