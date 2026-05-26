"""Shared ASR helpers — ffmpeg normalize, OpenAI-compatible transcription, glossary-aware polish."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def glossary_prompt_string(glossary: dict[str, Any] | None, *, max_chars: int = 800) -> str:
    """Build Whisper-style prompt / hotword hint from merged glossary terms."""
    if not glossary or not isinstance(glossary, dict):
        return ""
    terms = glossary.get("terms")
    if not isinstance(terms, list):
        return ""
    parts: list[str] = []
    for raw in terms:
        if not isinstance(raw, dict):
            continue
        term = str(raw.get("term") or "").strip()
        if not term:
            continue
        aliases = raw.get("aliases")
        if isinstance(aliases, list):
            alias_s = ", ".join(str(a).strip() for a in aliases if str(a).strip())
            parts.append(f"{term} ({alias_s})" if alias_s else term)
        else:
            parts.append(term)
        if len(", ".join(parts)) >= max_chars:
            break
    out = ", ".join(parts)
    return out[:max_chars]


def openai_compat_transcriptions_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url.rstrip("/"))
    if bu.endswith("/audio/transcriptions"):
        return bu
    if bu.endswith("/v1"):
        return f"{bu}/audio/transcriptions"
    return f"{bu}/v1/audio/transcriptions"


def openai_compat_chat_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url.rstrip("/"))
    if bu.endswith("/chat/completions"):
        return bu
    if bu.endswith("/v1"):
        return f"{bu}/chat/completions"
    return f"{bu}/v1/chat/completions"


BATCH_PROTOCOL_OPENAI = "openai_compat"
BATCH_PROTOCOL_JSON = "json_transcribe"


def resolve_batch_protocol(asr_cfg: dict[str, Any] | None) -> str:
    """HTTP batch transcribe adapter — independent of live streaming provider."""
    if not isinstance(asr_cfg, dict):
        return BATCH_PROTOCOL_OPENAI
    explicit = str(
        asr_cfg.get("batch_protocol") or asr_cfg.get("transcribe_protocol") or ""
    ).strip().lower()
    if explicit in (BATCH_PROTOCOL_OPENAI, BATCH_PROTOCOL_JSON, "json", "nano_transcribe"):
        return BATCH_PROTOCOL_JSON if explicit in (BATCH_PROTOCOL_JSON, "json", "nano_transcribe") else BATCH_PROTOCOL_OPENAI
    provider = str(asr_cfg.get("provider") or "").strip().lower()
    if provider in ("funasr_nano", "funasr-nano", "funasr_nano_remote"):
        return BATCH_PROTOCOL_JSON
    return BATCH_PROTOCOL_OPENAI


def resolve_batch_http_base(asr_cfg: dict[str, Any]) -> str:
    """HTTP(S) base for batch transcribe — skips WebSocket stream URLs."""
    for key in ("funasr_base_url", "funasr_live_base_url", "base_url"):
        bu = str(asr_cfg.get(key) or "").strip()
        low = bu.lower()
        if low.startswith(("ws://", "wss://")):
            continue
        if bu and not bu.endswith("/audio/transcriptions"):
            return ensure_url_scheme(bu.rstrip("/"))
    return ""


def json_transcribe_url(base_url: str) -> str:
    bu = base_url.rstrip("/")
    if bu.endswith("/transcribe"):
        return bu
    return f"{bu}/transcribe"


def _extract_json_transcribe_text(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    for key in ("text", "transcript", "result", "output"):
        raw = body.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    data = body.get("data")
    if isinstance(data, dict):
        for key in ("text", "transcript"):
            raw = data.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()
    return None


async def transcribe_json_base64_file(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any],
) -> tuple[str | None, str | None]:
    """POST ``/transcribe`` with ``{input: base64, language, itn}`` — FunASR Nano–compatible, provider-agnostic."""
    path = Path(audio_path)
    if not path.is_file():
        return None, "audio_file_missing"

    base = resolve_batch_http_base(asr_cfg)
    if not base:
        return None, "asr_endpoint_missing"

    url = json_transcribe_url(base)
    language = str(asr_cfg.get("language") or "中文").strip() or "中文"
    itn = bool(asr_cfg.get("itn", asr_cfg.get("enable_itn", True)))

    try:
        raw_bytes = path.read_bytes()
    except OSError as exc:
        return None, str(exc)[:200]

    if len(raw_bytes) < 44:
        return None, "audio_too_short"

    b64 = base64.b64encode(raw_bytes).decode("ascii")
    payload = {"input": b64, "language": language, "itn": itn}

    try:
        file_size = len(raw_bytes)
        timeout_read = max(60.0, min(300.0, 30.0 + file_size / (256 * 1024)))
        r = await client.post(
            url,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=httpx.Timeout(timeout_read, connect=20.0),
        )
        if r.status_code >= 400:
            return None, f"json_transcribe_http_{r.status_code}:{r.text[:300]}"
        try:
            body = r.json()
        except ValueError:
            return None, "json_transcribe_invalid_json"
        text = _extract_json_transcribe_text(body)
        if text:
            return text, None
        return None, "json_transcribe_empty_response"
    except Exception as exc:  # noqa: BLE001
        logger.warning("transcribe_json_base64_file failed url=%s: %s", url, exc)
        return None, str(exc)[:400]


def has_batch_transcribe_config(asr_cfg: dict[str, Any] | None) -> bool:
    if not isinstance(asr_cfg, dict):
        return False
    if resolve_batch_http_base(asr_cfg):
        return True
    bu = str(asr_cfg.get("base_url") or asr_cfg.get("url") or "").strip()
    return bool(bu) and resolve_batch_protocol(asr_cfg) == BATCH_PROTOCOL_OPENAI


def _asr_max_upload_bytes() -> int:
    """ASR providers (OpenAI Whisper, Qwen ASR, …) commonly cap uploads at ~25 MiB."""
    raw = _env("OAAO_ASR_MAX_UPLOAD_MB", "24")
    try:
        mb = float(raw)
    except ValueError:
        mb = 24.0
    mb = max(1.0, min(mb, 100.0))
    return int(mb * 1024 * 1024)


# mono 16 kHz PCM s16le bytes per second (ffmpeg segment target format)
_WAV_MONO16K_BPS = 16000 * 2


def _audio_mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".opus": "audio/opus",
    }.get(ext, "application/octet-stream")


def _format_asr_http_error(status: int, body: str) -> str:
    low = body.lower()
    if status == 400 and ("file size" in low or "filesize" in low or "too large" in low):
        max_mb = _asr_max_upload_bytes() / (1024 * 1024)
        return f"asr_file_too_large (endpoint limit; chunks use ≤{max_mb:.0f} MiB)"
    return f"asr_http_{status}:{body[:300]}"


async def ffprobe_duration_sec(src_path: str) -> float | None:
    """Return media duration in seconds via ffprobe, or None."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(src_path),
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return None
        txt = (out or b"").decode(errors="replace").strip()
        if not txt:
            return None
        dur = float(txt)
        return dur if dur > 0 else None
    except (FileNotFoundError, ValueError, OSError):
        return None


def _env_float(name: str, default: str) -> float:
    raw = _env(name, default)
    try:
        v = float(raw)
    except ValueError:
        v = float(default)
    return v


def _resolve_chunk_buffers(asr_cfg: dict[str, Any] | None) -> tuple[float, float]:
    """
    Seconds of audio to include before/after each chunk core window (context overlap).

    Settings: purpose meta_json → job payload, or ``OAAO_ASR_CHUNK_BUFFER_SEC`` (symmetric default).
    """
    default_sym = max(0.0, min(120.0, _env_float("OAAO_ASR_CHUNK_BUFFER_SEC", "3")))
    cfg = asr_cfg if isinstance(asr_cfg, dict) else {}

    sym = cfg.get("chunk_buffer_sec", cfg.get("asr_chunk_buffer_sec", cfg.get("chunk_pad_sec")))
    if sym is not None:
        try:
            b = max(0.0, min(120.0, float(sym)))
        except (TypeError, ValueError):
            b = default_sym
        return b, b

    def _side(key: str, fallback: float) -> float:
        if key not in cfg or cfg.get(key) is None:
            return fallback
        try:
            return max(0.0, min(120.0, float(cfg[key])))
        except (TypeError, ValueError):
            return fallback

    before = _side("chunk_buffer_before_sec", default_sym)
    before = _side("chunk_pad_before_sec", before)
    before = _side("asr_chunk_buffer_before_sec", before)
    after = _side("chunk_buffer_after_sec", default_sym)
    after = _side("chunk_pad_after_sec", after)
    after = _side("asr_chunk_buffer_after_sec", after)
    return before, after


def _core_segment_seconds(max_upload_bytes: int, buffer_before: float, buffer_after: float) -> float:
    """Core window length so padded extract (core + buffers) stays under upload cap."""
    max_dur = max_upload_bytes / _WAV_MONO16K_BPS
    pad = buffer_before + buffer_after
    if pad >= max_dur * 0.5:
        return max(30.0, max_dur * 0.45)
    core = max_dur * 0.85 - pad
    return max(60.0, core)


def _merge_transcription_prompts(
    glossary: dict[str, Any] | None,
    *,
    carry_prompt: str | None,
    max_chars: int = 800,
) -> str:
    parts: list[str] = []
    gp = glossary_prompt_string(glossary)
    if gp:
        parts.append(gp)
    if carry_prompt:
        tail = carry_prompt.strip()
        if tail:
            parts.append(tail[-400:])
    out = " ".join(parts).strip()
    return out[:max_chars]


async def ffmpeg_extract_wav_clip(
    src_path: str,
    *,
    start_sec: float,
    duration_sec: float,
    out_path: str,
) -> bool:
    if duration_sec <= 0.05:
        return False
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, start_sec):.3f}",
        "-i",
        str(src_path),
        "-t",
        f"{duration_sec:.3f}",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        out_path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "ffmpeg clip failed rc=%s: %s",
                proc.returncode,
                (err or b"")[:300].decode(errors="replace"),
            )
            return False
        return Path(out_path).is_file() and Path(out_path).stat().st_size > 44
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg clip error: %s", e)
        return False


async def ffmpeg_segment_wav_mono16k(
    src_path: str,
    max_upload_bytes: int,
    *,
    buffer_before_sec: float = 0.0,
    buffer_after_sec: float = 0.0,
) -> tuple[list[str], str | None]:
    """
    Split source audio into mono 16 kHz WAV segments each ≤ max_upload_bytes (approx).

    When buffer_* > 0, each segment includes pad audio before/after the core window so ASR
    sees cross-chunk context (merged transcript strips duplicate overlap heuristically).

    Returns (sorted chunk paths, temp directory to remove when done).
    """
    src = Path(src_path)
    if not src.is_file():
        return [], None

    total_dur = await ffprobe_duration_sec(str(src))
    if total_dur is None or total_dur <= 0:
        total_dur = None

    core_seg_time = _core_segment_seconds(max_upload_bytes, buffer_before_sec, buffer_after_sec)
    use_pad = buffer_before_sec > 0 or buffer_after_sec > 0

    out_dir = tempfile.mkdtemp(prefix="oaao_asr_chunks_")

    if not use_pad:
        pattern = str(Path(out_dir) / "chunk_%03d.wav")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "segment",
            "-segment_time",
            f"{core_seg_time:.3f}",
            "-reset_timestamps",
            "1",
            pattern,
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    "ffmpeg segment failed rc=%s: %s",
                    proc.returncode,
                    (err or b"")[:400].decode(errors="replace"),
                )
                _cleanup_chunk_dir(out_dir)
                return [], None
            chunks = sorted(str(p) for p in Path(out_dir).glob("chunk_*.wav") if p.is_file())
            if not chunks:
                _cleanup_chunk_dir(out_dir)
                return [], None
            return chunks, out_dir
        except Exception as e:  # noqa: BLE001
            logger.warning("ffmpeg segment error: %s", e)
            _cleanup_chunk_dir(out_dir)
            return [], None

    # Padded windows: [core_start - pad_before, core_end + pad_after] clipped to file duration.
    dur = total_dur if total_dur is not None else core_seg_time * 4
    chunks: list[str] = []
    core_start = 0.0
    idx = 0
    try:
        while core_start < dur - 0.05:
            core_end = min(dur, core_start + core_seg_time)
            extract_start = max(0.0, core_start - buffer_before_sec)
            extract_end = min(dur, core_end + buffer_after_sec)
            extract_dur = extract_end - extract_start
            est_bytes = int(extract_dur * _WAV_MONO16K_BPS)
            if est_bytes > max_upload_bytes and extract_dur > 0:
                extract_dur = max(30.0, (max_upload_bytes / _WAV_MONO16K_BPS) * 0.92)
                extract_end = min(dur, extract_start + extract_dur)

            out_path = str(Path(out_dir) / f"chunk_{idx:03d}.wav")
            ok = await ffmpeg_extract_wav_clip(
                str(src),
                start_sec=extract_start,
                duration_sec=extract_end - extract_start,
                out_path=out_path,
            )
            if not ok:
                break
            if Path(out_path).stat().st_size > max_upload_bytes:
                Path(out_path).unlink(missing_ok=True)
                break
            chunks.append(out_path)
            idx += 1
            if core_end >= dur - 0.05:
                break
            core_start = core_end

        if not chunks:
            _cleanup_chunk_dir(out_dir)
            return [], None
        return chunks, out_dir
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg padded segment error: %s", e)
        _cleanup_chunk_dir(out_dir)
        return [], None


def _cleanup_chunk_dir(chunk_dir: str | None, extra_paths: list[str] | None = None) -> None:
    if extra_paths:
        for p in extra_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
    if not chunk_dir:
        return
    try:
        for p in Path(chunk_dir).glob("*"):
            p.unlink(missing_ok=True)
        Path(chunk_dir).rmdir()
    except OSError:
        pass


async def ffmpeg_to_wav_mono16k(src_path: str) -> str | None:
    """Convert audio file to mono 16 kHz WAV; returns temp path or None."""
    src = Path(src_path)
    if not src.is_file():
        return None
    fd, out = tempfile.mkstemp(suffix=".wav", prefix="oaao_asr_")
    os.close(fd)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        out,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning("ffmpeg failed rc=%s: %s", proc.returncode, (err or b"")[:400].decode(errors="replace"))
            Path(out).unlink(missing_ok=True)
            return None
        return out
    except FileNotFoundError:
        logger.warning("ffmpeg not found — install ffmpeg in orchestrator image")
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("ffmpeg error: %s", e)
        Path(out).unlink(missing_ok=True)
        return None


def _merge_chunk_transcripts(parts: list[str], buffer_before: float, buffer_after: float) -> str:
    """Join chunk transcripts; trim duplicate suffix/prefix when padded overlap was used."""
    cleaned = [p.strip() for p in parts if p and p.strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1 or (buffer_before <= 0 and buffer_after <= 0):
        return "\n\n".join(cleaned)

    merged = cleaned[0]
    for nxt in cleaned[1:]:
        prev = merged
        best = 0
        max_k = min(len(prev), len(nxt), 400)
        for k in range(max_k, 19, -1):
            if prev[-k:].strip().lower() == nxt[:k].strip().lower():
                best = k
                break
        if best > 0:
            merged = prev + nxt[best:].lstrip()
        else:
            merged = prev.rstrip() + "\n\n" + nxt.lstrip()
    return merged.strip()


async def transcribe_audio_file(
    client: httpx.AsyncClient,
    *,
    wav_or_audio_path: str,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
    carry_prompt: str | None = None,
) -> tuple[str | None, str | None]:
    """OpenAI-compatible multipart or JSON/base64 batch transcribe. Returns (text, error)."""
    if resolve_batch_protocol(asr_cfg) == BATCH_PROTOCOL_JSON:
        return await transcribe_json_base64_file(
            client,
            audio_path=wav_or_audio_path,
            asr_cfg=asr_cfg,
        )

    bu = str(asr_cfg.get("base_url") or "").strip()
    url_direct = str(asr_cfg.get("url") or "").strip()
    model = str(asr_cfg.get("model") or "").strip()
    if not model:
        return None, "asr_model_missing"
    if not url_direct and not bu:
        return None, "asr_endpoint_missing"

    api_key = _resolve_secret(asr_cfg.get("api_key_env") if isinstance(asr_cfg.get("api_key_env"), str) else None)
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_transcriptions_url(bu)
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    prompt = _merge_transcription_prompts(glossary, carry_prompt=carry_prompt)
    path = Path(wav_or_audio_path)
    if not path.is_file():
        return None, "audio_file_missing"

    data: dict[str, str] = {"model": model}
    if prompt:
        data["prompt"] = prompt

    try:
        file_size = path.stat().st_size
        timeout_read = max(180.0, min(900.0, 60.0 + file_size / (512 * 1024)))
        mime = _audio_mime_for_path(path)
        with path.open("rb") as fh:
            files = {"file": (path.name, fh, mime)}
            r = await client.post(
                url,
                headers=headers,
                data=data,
                files=files,
                timeout=httpx.Timeout(timeout_read, connect=15.0),
            )
        if r.status_code >= 400:
            return None, _format_asr_http_error(r.status_code, r.text[:400])
        body = r.json()
        if isinstance(body, dict):
            txt = body.get("text")
            if isinstance(txt, str) and txt.strip():
                return txt.strip(), None
        return None, "asr_empty_response"
    except Exception as e:  # noqa: BLE001
        return None, str(e)[:400]


async def transcribe_audio_auto(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    """
    Transcribe one file; split into ASR-sized WAV chunks when over {@see _asr_max_upload_bytes}.

    Returns (text, error, extra_meta).
    """
    extra: dict[str, Any] = {"chunked": False, "chunk_count": 0}
    src = Path(audio_path)
    if not src.is_file():
        return None, "audio_file_missing", extra

    max_b = _asr_max_upload_bytes()
    buf_before, buf_after = _resolve_chunk_buffers(asr_cfg)
    wav_path: str | None = None
    chunk_dir: str | None = None
    try:
        src_size = src.stat().st_size
        dur = await ffprobe_duration_sec(audio_path)
        est_wav_bytes = int(dur * _WAV_MONO16K_BPS) if dur else None
        need_chunk = src_size > max_b or (est_wav_bytes is not None and est_wav_bytes > max_b)

        if not need_chunk:
            wav_path = await ffmpeg_to_wav_mono16k(audio_path)
            transcribe_path = wav_path or audio_path
            if Path(transcribe_path).stat().st_size > max_b:
                need_chunk = True
            else:
                text, err = await transcribe_audio_file(
                    client,
                    wav_or_audio_path=transcribe_path,
                    asr_cfg=asr_cfg,
                    glossary=glossary,
                )
                return text, err, extra

        # Long audio — segment from source (avoid one oversized upload / temp WAV).
        chunks, chunk_dir = await ffmpeg_segment_wav_mono16k(
            audio_path,
            max_b,
            buffer_before_sec=buf_before,
            buffer_after_sec=buf_after,
        )
        if not chunks:
            return None, "asr_audio_too_large_segment_failed", extra

        extra["chunked"] = True
        extra["chunk_count"] = len(chunks)
        if buf_before > 0 or buf_after > 0:
            extra["chunk_buffer_before_sec"] = buf_before
            extra["chunk_buffer_after_sec"] = buf_after
        parts: list[str] = []
        carry: str | None = None
        for idx, chunk in enumerate(chunks):
            text, err = await transcribe_audio_file(
                client,
                wav_or_audio_path=chunk,
                asr_cfg=asr_cfg,
                glossary=glossary if idx == 0 else None,
                carry_prompt=carry if idx > 0 else None,
            )
            if not text:
                return None, err or f"transcription_failed_chunk_{idx + 1}", extra
            piece = text.strip()
            parts.append(piece)
            carry = piece[-400:] if piece else carry

        merged = _merge_chunk_transcripts(parts, buf_before, buf_after)
        if not merged:
            return None, "asr_empty_response", extra
        return merged, None, extra
    finally:
        if wav_path and wav_path != audio_path:
            Path(wav_path).unlink(missing_ok=True)
        _cleanup_chunk_dir(chunk_dir)


async def polish_transcript(
    client: httpx.AsyncClient,
    *,
    raw_text: str,
    polish_cfg: dict[str, Any],
    glossary: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """LLM polish pass for ASR output. Returns (polished, error)."""
    raw = (raw_text or "").strip()
    if not raw:
        return None, "empty_transcript"

    bu = str(polish_cfg.get("base_url") or "").strip()
    url_direct = str(polish_cfg.get("url") or "").strip()
    model = str(polish_cfg.get("model") or "").strip()
    if not model or (not url_direct and not bu):
        return raw, None

    api_key = _resolve_secret(polish_cfg.get("api_key_env") if isinstance(polish_cfg.get("api_key_env"), str) else None)
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    gloss_blob = ""
    if glossary:
        try:
            gloss_blob = json.dumps(glossary, ensure_ascii=False)[:6000]
        except (TypeError, ValueError):
            gloss_blob = ""

    system = (
        "You polish speech-to-text transcripts. Fix punctuation and spacing; apply glossary terms "
        "when the audio likely meant them. Do not add facts or change meaning. Return only the polished text."
    )
    user_parts = [f"Transcript:\n{raw}"]
    if gloss_blob:
        user_parts.append(f"Glossary JSON:\n{gloss_blob}")

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(user_parts)},
        ],
        "temperature": 0.2,
        "stream": False,
    }
    try:
        r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0))
        if r.status_code >= 400:
            return raw, f"polish_http_{r.status_code}"
        data = r.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str) and c.strip():
                    return c.strip(), None
        return raw, None
    except Exception as e:  # noqa: BLE001
        return raw, str(e)[:200]


async def run_asr_pipeline_on_file(
    client: httpx.AsyncClient,
    *,
    audio_path: str,
    asr_cfg: dict[str, Any] | None,
    polish_cfg: dict[str, Any] | None,
    glossary: dict[str, Any] | None = None,
    polish_enabled: bool = True,
) -> tuple[str | None, dict[str, Any]]:
    """
    ffmpeg → ASR → optional polish.

    Returns (final_text, meta dict with raw_text, polished flag, errors).
    """
    meta: dict[str, Any] = {"raw_text": "", "polished": False}
    if not asr_cfg or not isinstance(asr_cfg, dict):
        return None, {**meta, "error": "asr_config_missing"}

    try:
        from oaao_orchestrator.asr_funasr import is_speaker_mode, transcribe_funasr_speaker

        if is_speaker_mode(asr_cfg):
            raw, err, speaker_extra = await transcribe_funasr_speaker(
                client,
                audio_path=audio_path,
                asr_cfg=asr_cfg,
                glossary=glossary,
            )
            meta.update(speaker_extra)
            meta["chunked"] = False
            meta["chunk_count"] = 0
            if not raw:
                return None, {**meta, "error": err or "transcription_failed"}
            meta["raw_text"] = raw
            # Speaker Mode: skip LLM polish to preserve segment boundaries (P0).
            return raw, meta

        raw, err, asr_extra = await transcribe_audio_auto(
            client,
            audio_path=audio_path,
            asr_cfg=asr_cfg,
            glossary=glossary,
        )
        if asr_extra.get("chunked"):
            meta["chunked"] = True
            meta["chunk_count"] = asr_extra.get("chunk_count", 0)
            if asr_extra.get("chunk_buffer_before_sec") is not None:
                meta["chunk_buffer_before_sec"] = asr_extra.get("chunk_buffer_before_sec")
            if asr_extra.get("chunk_buffer_after_sec") is not None:
                meta["chunk_buffer_after_sec"] = asr_extra.get("chunk_buffer_after_sec")
        if not raw:
            return None, {**meta, "error": err or "transcription_failed"}
        meta["raw_text"] = raw

        final = raw
        if polish_enabled and polish_cfg and isinstance(polish_cfg, dict):
            polished, perr = await polish_transcript(
                client,
                raw_text=raw,
                polish_cfg=polish_cfg,
                glossary=glossary,
            )
            if polished:
                final = polished
                meta["polished"] = polished != raw
            if perr:
                meta["polish_error"] = perr

        return final, meta
    except Exception as e:  # noqa: BLE001
        logger.warning("run_asr_pipeline_on_file: %s", e)
        return None, {**meta, "error": str(e)[:400]}
