"""Built-in FunASR sidecar — compose ensure, health poll, smoke test."""

from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import struct
import subprocess
import time
from typing import Any

import httpx

from oaao_orchestrator.asr_funasr import funasr_transcribe_url
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def funasr_base_url() -> str:
    env = _env("OAAO_FUNASR_BASE_URL", "http://funasr:8765")
    return ensure_url_scheme(env.rstrip("/"))


def compose_enabled() -> bool:
    return _truthy(_env("OAAO_FUNASR_COMPOSE_ENABLED"))


def compose_project_dir() -> str:
    return _env("OAAO_COMPOSE_PROJECT_DIR", "/compose")


def compose_project_name() -> str:
    return _env("OAAO_COMPOSE_PROJECT_NAME", "oaaoai-v1")


def docker_socket_path() -> str:
    return _env("OAAO_DOCKER_SOCKET", "/var/run/docker.sock")


def _docker_env() -> dict[str, str]:
    return {**os.environ, "DOCKER_HOST": f"unix://{docker_socket_path()}"}


def minimal_wav_bytes(duration_sec: float = 2.0, sample_rate: int = 8000) -> bytes:
    """Tiny mono PCM WAV for adapter smoke transcribe (≥2s so stub diarization emits sentences)."""
    n_samples = max(1, int(sample_rate * duration_sec))
    pcm = b"\x00\x00" * n_samples
    byte_rate = sample_rate * 2
    block_align = 2
    data_size = len(pcm)
    riff_size = 36 + data_size
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", riff_size))
    buf.write(b"WAVEfmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, block_align, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


async def fetch_health(client: httpx.AsyncClient, base_url: str) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/health"
    try:
        res = await client.get(url)
        if res.status_code >= 400:
            return {"ok": False, "status_code": res.status_code, "error": res.text[:240]}
        body = res.json()
        if not isinstance(body, dict):
            return {"ok": False, "error": "invalid_health_json"}
        return {"ok": str(body.get("status", "")).lower() == "ok", "body": body}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def run_smoke_test(client: httpx.AsyncClient, base_url: str) -> dict[str, Any]:
    health = await fetch_health(client, base_url)
    if not health.get("ok"):
        return {"ok": False, "phase": "health", "health": health}

    transcribe_url = funasr_transcribe_url(base_url)
    wav = minimal_wav_bytes()
    files = {"file": ("smoke.wav", wav, "audio/wav")}
    data = {"diarization_enabled": "true", "speaker_count": "2"}
    try:
        res = await client.post(transcribe_url, files=files, data=data)
        if res.status_code >= 400:
            return {
                "ok": False,
                "phase": "transcribe",
                "status_code": res.status_code,
                "error": res.text[:240],
                "health": health,
            }
        body = res.json()
        if not isinstance(body, dict):
            return {"ok": False, "phase": "transcribe", "error": "invalid_transcribe_json", "health": health}
        transcripts = (
            body.get("output", {}).get("transcripts")
            if isinstance(body.get("output"), dict)
            else None
        )
        sentences = None
        if isinstance(transcripts, list) and transcripts and isinstance(transcripts[0], dict):
            sentences = transcripts[0].get("sentences")
        if not isinstance(sentences, list) or len(sentences) < 1:
            return {"ok": False, "phase": "transcribe", "error": "missing_sentences", "health": health}
        return {
            "ok": True,
            "phase": "ready",
            "health": health,
            "adapter_mode": body.get("adapter_mode") or health.get("body", {}).get("mode"),
            "sentence_count": len(sentences),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "phase": "transcribe", "error": str(exc), "health": health}


def _compose_file_args(project_dir: str) -> tuple[str, list[str]]:
    compose_file = os.path.join(project_dir, "docker-compose.yml")
    extra: list[str] = []
    for candidate in (
        os.path.join(project_dir, ".env"),
        os.path.join(project_dir, "docker", "env"),
    ):
        if os.path.isfile(candidate):
            extra.extend(["--env-file", candidate])
            break
    return compose_file, extra


def _has_docker_compose_v2(docker_bin: str, env: dict[str, str]) -> bool:
    probe = subprocess.run(
        [docker_bin, "compose", "version"],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    return probe.returncode == 0


def _try_start_stopped_funasr() -> dict[str, Any]:
    docker_bin = shutil.which("docker")
    if not docker_bin or not os.path.exists(docker_socket_path()):
        return {"attempted": False, "skipped": True, "reason": "docker_unavailable"}

    project = compose_project_name()
    env = _docker_env()
    list_proc = subprocess.run(
        [docker_bin, "ps", "-a", "--filter", f"name={project}-funasr", "--format", "{{.Names}}"],
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    names = [ln.strip() for ln in (list_proc.stdout or "").splitlines() if ln.strip()]
    if not names:
        return {"attempted": False, "skipped": True, "reason": "no_existing_container"}

    started: list[str] = []
    running: list[str] = []
    errors: list[str] = []
    for name in names:
        state_proc = subprocess.run(
            [docker_bin, "inspect", "-f", "{{.State.Running}}", name],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if (state_proc.stdout or "").strip().lower() == "true":
            running.append(name)
            continue
        proc = subprocess.run(
            [docker_bin, "start", name],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode == 0:
            started.append(name)
        else:
            err = (proc.stderr or proc.stdout or "").strip()
            if err:
                errors.append(err[-200:])

    if running:
        return {"attempted": True, "ok": True, "method": "already_running", "running": running}
    if started:
        return {"attempted": True, "ok": True, "method": "docker_start", "started": started}
    return {
        "attempted": True,
        "ok": False,
        "method": "docker_start",
        "error": errors[-1] if errors else "docker_start_failed",
    }


def _compose_up_sync(funasr_env: dict[str, str] | None = None, *, force_recreate: bool = False) -> dict[str, Any]:
    if not compose_enabled():
        return {"attempted": False, "skipped": True, "reason": "compose_disabled"}
    sock = docker_socket_path()
    if not os.path.exists(sock):
        return {"attempted": False, "skipped": True, "reason": "docker_socket_missing", "socket": sock}

    project_dir = compose_project_dir()
    compose_file, env_file_args = _compose_file_args(project_dir)
    if not os.path.isfile(compose_file):
        return {"attempted": False, "skipped": True, "reason": "compose_file_missing", "path": compose_file}

    docker_bin = shutil.which("docker")
    docker_compose_bin = shutil.which("docker-compose")
    if not docker_bin and not docker_compose_bin:
        return {"attempted": False, "skipped": True, "reason": "docker_cli_missing"}

    env = _docker_env()
    if funasr_env:
        env = {**env, **funasr_env}
    project = compose_project_name()
    cmd: list[str]
    method = "unknown"
    if docker_bin and _has_docker_compose_v2(docker_bin, env):
        cmd = [
            docker_bin,
            "compose",
            "-p",
            project,
            *env_file_args,
            "-f",
            compose_file,
            "--profile",
            "funasr",
            "up",
            "-d",
            "--build",
        ]
        if force_recreate:
            cmd.append("--force-recreate")
        cmd.append("funasr")
        method = "docker_compose_v2"
    elif docker_compose_bin:
        env = {**env, "COMPOSE_PROFILES": "funasr"}
        cmd = [
            docker_compose_bin,
            "-p",
            project,
            *env_file_args,
            "-f",
            compose_file,
            "up",
            "-d",
            "--build",
        ]
        if force_recreate:
            cmd.append("--force-recreate")
        cmd.append("funasr")
        method = "docker_compose_v1"
    else:
        return {
            "attempted": False,
            "skipped": True,
            "reason": "compose_plugin_missing",
            "hint": "Install docker-compose in the orchestrator image or run: docker compose --profile funasr up -d funasr",
        }

    started = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            cwd=project_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=int(_env("OAAO_FUNASR_COMPOSE_TIMEOUT_SEC", "600") or "600"),
            check=False,
        )
        elapsed = round(time.monotonic() - started, 2)
        tail_out = (proc.stdout or "")[-1200:]
        tail_err = (proc.stderr or "")[-1200:]
        return {
            "attempted": True,
            "ok": proc.returncode == 0,
            "method": method,
            "returncode": proc.returncode,
            "elapsed_sec": elapsed,
            "stdout_tail": tail_out,
            "stderr_tail": tail_err,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "attempted": True,
            "ok": False,
            "method": method,
            "error": "compose_timeout",
            "stdout_tail": (exc.stdout or b"")[-800:].decode(errors="replace") if exc.stdout else "",
            "stderr_tail": (exc.stderr or b"")[-800:].decode(errors="replace") if exc.stderr else "",
        }
    except Exception as exc:  # noqa: BLE001
        return {"attempted": True, "ok": False, "method": method, "error": str(exc)}


async def poll_until_ready(
    client: httpx.AsyncClient,
    base_url: str,
    *,
    timeout_sec: float = 180.0,
    interval_sec: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + max(5.0, timeout_sec)
    last_health: dict[str, Any] = {"ok": False, "error": "not_started"}
    while time.monotonic() < deadline:
        last_health = await fetch_health(client, base_url)
        if last_health.get("ok"):
            smoke = await run_smoke_test(client, base_url)
            return smoke
        await asyncio.sleep(interval_sec)
    return {"ok": False, "phase": "timeout", "health": last_health}


def _ensure_failure_message(
    *,
    compose_result: dict[str, Any] | None,
    start_result: dict[str, Any] | None,
    poll: dict[str, Any],
) -> str:
    if poll.get("ok"):
        return "FunASR ready"

    smoke_phase = str(poll.get("phase") or "")
    if smoke_phase == "timeout":
        health_err = ""
        health = poll.get("health")
        if isinstance(health, dict):
            health_err = str(health.get("error") or health.get("status_code") or "").strip()
        base = "FunASR did not become ready in time"
        if health_err:
            return f"{base} ({health_err})"
        return base

    if smoke_phase in {"health", "transcribe"}:
        err = str(poll.get("error") or "").strip()
        return f"FunASR smoke test failed{f': {err}' if err else ''}"

    if compose_result and compose_result.get("attempted") and not compose_result.get("ok"):
        detail = str(compose_result.get("stderr_tail") or compose_result.get("error") or "").strip()
        if detail:
            return f"FunASR image/service start failed: {detail[-240:]}"
        return "FunASR image/service start failed"

    return "FunASR is not ready"


async def ensure_funasr(
    *,
    pull: bool = True,
    funasr_env: dict[str, str] | None = None,
    recreate: bool = False,
) -> dict[str, Any]:
    """
    Ensure built-in FunASR is reachable and passes smoke test.

    When compose is enabled, tries docker start on existing container, then compose up.
    Optional ``funasr_env`` overrides FUNASR_* compose variables for compose up.
    Set ``recreate=True`` only when adapter mode or SPK model changed (``--force-recreate``).
    """
    base = funasr_base_url()
    compose_result: dict[str, Any] | None = None
    start_result: dict[str, Any] | None = None
    env_clean: dict[str, str] | None = None
    if funasr_env:
        env_clean = {str(k): str(v) for k, v in funasr_env.items() if str(k).strip() and str(v).strip() != ""}
        if "FUNASR_ADAPTER_MODE" in funasr_env:
            env_clean["FUNASR_ADAPTER_MODE"] = str(funasr_env["FUNASR_ADAPTER_MODE"]).strip().lower() or "stub"
    force_recreate = recreate

    if pull and compose_enabled():
        if not force_recreate:
            start_result = await asyncio.to_thread(_try_start_stopped_funasr)
        if force_recreate or not start_result or not start_result.get("ok"):
            compose_result = await asyncio.to_thread(
                _compose_up_sync,
                env_clean,
                force_recreate=force_recreate,
            )

    timeout = float(_env("OAAO_FUNASR_ENSURE_TIMEOUT_SEC", "180") or "180")
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=8.0)) as client:
        poll = await poll_until_ready(client, base, timeout_sec=timeout)

    out: dict[str, Any] = {
        "base_url": base,
        "start": start_result,
        "compose": compose_result,
        "funasr_env": env_clean,
        "ready": bool(poll.get("ok")),
        "smoke": poll,
        "message": _ensure_failure_message(compose_result=compose_result, start_result=start_result, poll=poll),
    }
    return out


async def funasr_status() -> dict[str, Any]:
    base = funasr_base_url()
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
        health = await fetch_health(client, base)
        smoke = await run_smoke_test(client, base) if health.get("ok") else {"ok": False, "phase": "health", "health": health}
    return {"base_url": base, "ready": bool(smoke.get("ok")), "health": health, "smoke": smoke}
