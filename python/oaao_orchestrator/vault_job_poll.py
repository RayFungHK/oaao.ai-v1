"""Poll PHP vault ingest queue (`vault_job_claim` / `vault_job_finish`) from the orchestrator process."""

from __future__ import annotations

import asyncio
import json as json_lib
import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from oaao_orchestrator.php_boundary import assert_php_http_allowed, vault_job_claim_via_postgres
from oaao_orchestrator.vault_audio_asr import process_vault_audio_asr
from oaao_orchestrator.vault_document_embed import process_vault_document_embed
from oaao_orchestrator.vault_graph_index import process_vault_graph_index
from oaao_orchestrator.vault_transcript_summary import process_vault_transcript_summary

logger = logging.getLogger(__name__)

_CONNECT_WARN_EVERY = 60
_CONNECT_INFO_GRACE = (
    12  # Compose boot: log DNS failures to `web` at INFO before escalating to WARNING
)
_HTML_BODY_SNIP_LEN = 600


def _vault_poll_headers(secret: str) -> dict[str, str]:
    """Encourage PHP/Razy JSON paths; bearer stays on X-OAAO-Internal-Token."""
    return {
        "X-OAAO-Internal-Token": secret,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
    }


def _html_diag_sample(body: str) -> str:
    """Compact hint when Apache/Razy serves HTML instead of JSON."""
    bits: list[str] = []
    m = re.search(r"<title>\s*(.+?)\s*</title>", body, re.I | re.DOTALL)
    if m:
        bits.append(re.sub(r"\s+", " ", m.group(1).strip())[:160])
    m2 = re.search(r"<pre[^>]*>\s*(.+?)\s*</pre>", body, re.I | re.DOTALL)
    if m2:
        bits.append(re.sub(r"\s+", " ", m2.group(1).strip())[:400])
    if len(bits) < 2:
        m3 = re.search(r"class=\"debug\"", body, re.I)
        if m3:
            tail = body[m3.start() : m3.start() + 2600]
            plain = re.sub(r"<[^>]+>", " ", tail)
            plain = re.sub(r"\s+", " ", plain).strip()[:520]
            if plain:
                bits.append(plain)
    if bits:
        return " | ".join(bits)
    return body.replace("\n", " ")[:_HTML_BODY_SNIP_LEN]


def _stub_finish_payload(job_id: int) -> dict[str, Any]:
    mode = (os.environ.get("OAAO_VAULT_JOB_STUB_MODE") or "fail").strip().lower()
    if mode == "complete":
        return {"job_id": job_id, "status": "completed"}
    return {"job_id": job_id, "status": "failed", "error": "orchestrator_stub_no_processing"}


def _is_compose_web_boot_wait(host: str, err: BaseException) -> bool:
    """True when orchestrator likely started before the Compose `web` service joined DNS."""
    if host != "web":
        return False
    msg = str(err).lower()
    return (
        "name or service not known" in msg
        or "nodename nor servname" in msg
        or "temporary failure in name resolution" in msg
        or "getaddrinfo failed" in msg
    )


def _vault_job_worker_count() -> int:
    raw = (os.environ.get("OAAO_VAULT_JOB_WORKERS") or "3").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 3
    return max(1, min(8, n))


async def _claim_vault_job(
    client: httpx.AsyncClient,
    *,
    claim_url: str,
    hdr: dict[str, str],
    use_pg_claim: bool,
    connect_fail_seq: list[int],
    host: str,
    interval: float,
) -> dict[str, Any] | None:
    if use_pg_claim:
        from oaao_orchestrator.vault_job_pg import claim_next_job

        return await asyncio.to_thread(claim_next_job)

    assert_php_http_allowed(claim_url, context="vault_job_claim")
    r = await client.post(
        claim_url,
        headers=hdr,
        json={},
    )
    if r.status_code >= 400:
        logger.warning("vault_job_poll: claim HTTP %s — %s", r.status_code, r.text[:500])
        await asyncio.sleep(interval)
        return None

    try:
        envelope = r.json()
    except (json_lib.JSONDecodeError, ValueError):
        ct = (r.headers.get("content-type") or "").split(";")[0].strip()
        raw = r.text or ""
        if (
            "html" in ct.lower()
            or raw.lstrip().lower().startswith("<!doctype html")
            or "<html" in raw[:60].lower()
        ):
            logger.warning(
                "vault_job_poll: claim returned HTML (%s), not JSON — hitting Razy PHP error/HTML page. "
                "Common causes: wrong URL (different app on port), Apache/Razy bootstrap failure, "
                "or subdirectory install mismatch. hint=%s",
                r.url,
                _html_diag_sample(raw),
            )
        else:
            logger.warning(
                "vault_job_poll: claim response not JSON (status=%s content-type=%r body=%r)",
                r.status_code,
                ct,
                raw.replace("\n", " ")[:480],
            )
        await asyncio.sleep(interval)
        return None

    if connect_fail_seq[0] > 0:
        logger.info(
            "vault_job_poll: PHP vault API reachable after %s connect attempt(s)",
            connect_fail_seq[0],
        )
    connect_fail_seq[0] = 0

    if isinstance(envelope, dict):
        data = envelope.get("data")
        if isinstance(data, dict):
            job = data.get("job")
            if isinstance(job, dict):
                return job
    return None


async def _process_claimed_vault_job(
    client: httpx.AsyncClient,
    job: dict[str, Any],
    *,
    finish_url: str,
    hdr: dict[str, str],
) -> None:
    jid_raw = job.get("job_id")
    jid = int(jid_raw) if jid_raw is not None else 0
    hook = str(job.get("hook_id") or "")
    path = str(job.get("absolute_path") or "")

    logger.info(
        "vault_job_poll: claimed job_id=%s hook=%s path=%s",
        jid,
        hook,
        path,
    )

    if hook == "vh.rag.document_embed":
        st, ferr, extras = await process_vault_document_embed(client, job)
        finish_body: dict[str, Any] = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "document_embed_failed")[:4000]
    elif hook == "vh.rag.graph_index":
        st, ferr, extras = await process_vault_graph_index(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "graph_index_failed")[:4000]
    elif hook == "vh.rag.audio_asr":
        st, ferr, extras = await process_vault_audio_asr(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "audio_asr_failed")[:4000]
    elif hook == "vh.rag.transcript_summary":
        st, ferr, extras = await process_vault_transcript_summary(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "transcript_summary_failed")[:4000]
    else:
        finish_body = _stub_finish_payload(jid)

    assert_php_http_allowed(finish_url, context="vault_job_finish")
    fr = await client.post(
        finish_url,
        headers=hdr,
        json=finish_body,
    )
    if fr.status_code >= 400:
        logger.warning(
            "vault_job_poll: finish HTTP %s — %s",
            fr.status_code,
            fr.text[:500],
        )


async def _vault_job_worker_loop(
    worker_id: int,
    client: httpx.AsyncClient,
    *,
    claim_url: str,
    finish_url: str,
    hdr: dict[str, str],
    use_pg_claim: bool,
    host: str,
    interval: float,
    connect_fail_seq: list[int],
) -> None:
    del worker_id
    while True:
        try:
            job = await _claim_vault_job(
                client,
                claim_url=claim_url,
                hdr=hdr,
                use_pg_claim=use_pg_claim,
                connect_fail_seq=connect_fail_seq,
                host=host,
                interval=interval,
            )
            if not job:
                await asyncio.sleep(interval)
                continue
            await _process_claimed_vault_job(
                client,
                job,
                finish_url=finish_url,
                hdr=hdr,
            )
            await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            raise
        except httpx.RequestError as e:
            connect_fail_seq[0] += 1
            seq = connect_fail_seq[0]
            if _is_compose_web_boot_wait(host, e) and seq <= _CONNECT_INFO_GRACE:
                logger.info(
                    "vault_job_poll: waiting for Compose `web` service (%s): %s [attempt %s/%s]",
                    claim_url,
                    e,
                    seq,
                    _CONNECT_INFO_GRACE,
                )
            elif seq == 1 or seq % _CONNECT_WARN_EVERY == 0:
                logger.warning(
                    "vault_job_poll: cannot reach PHP vault API (%s): %s. "
                    "If `web`/`orchestrator` hostnames fail, set OAAO_VAULT_JOB_POLL_BASE_URL to a reachable URL "
                    "(Compose: http://web/vault/api; host talking to mapped port: http://localhost:8080/vault/api). "
                    "[%s]",
                    claim_url,
                    e,
                    f"repeat x{seq}" if seq > 1 else "first failure",
                )
            await asyncio.sleep(interval)
        except Exception:
            logger.exception("vault_job_poll: worker error")
            await asyncio.sleep(interval)


async def vault_job_poll_loop() -> None:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    if not base:
        logger.info("vault_job_poll: OAAO_VAULT_JOB_POLL_BASE_URL unset — background poll disabled")
        return

    from oaao_orchestrator._internal_secret import require_internal_secret

    secret = require_internal_secret()
    interval = float(os.environ.get("OAAO_VAULT_JOB_POLL_INTERVAL_SEC", "4"))
    claim_url = f"{base}/vault_job_claim"
    finish_url = f"{base}/vault_job_finish"

    try:
        parsed = urlparse(base)
        host = (parsed.hostname or "").strip() or "?"
    except Exception:  # noqa: BLE001
        host = "?"

    logger.info("vault_job_poll: enabled (%s)", claim_url)
    worker_count = _vault_job_worker_count()
    logger.info("vault_job_poll: workers=%s", worker_count)
    hdr = _vault_poll_headers(secret)
    if host == "web":
        logger.info(
            "vault_job_poll: hostname `web` only resolves inside Compose with the `web` service up "
            "(`docker compose up -d` — not `docker compose run` / not the host)."
        )
    if host == "localhost" or host == "127.0.0.1":
        logger.warning(
            "vault_job_poll: base URL hostname is %s — inside the orchestrator container that is THIS container, "
            "not Apache; use http://web/vault/api (Compose) or host.docker.internal:<OAAO_WEB_PORT>/vault/api (Desktop).",
            host,
        )

    connect_fail_seq: list[int] = [0]
    reclaim_url = f"{base}/vault_job_reclaim_orphans"

    use_pg_claim = vault_job_claim_via_postgres()
    if use_pg_claim:
        try:
            from oaao_orchestrator.vault_job_pg import (
                claim_next_job,
                reclaim_orphan_running_jobs,
            )

            reclaim_orphan_running_jobs()
            logger.info("vault_job_poll: claim mode=postgres (finish still via PHP)")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "vault_job_poll: postgres claim unavailable, falling back to PHP HTTP: %s", exc
            )
            use_pg_claim = False

    async with httpx.AsyncClient(timeout=60.0) as client:
        if not use_pg_claim:
            try:
                assert_php_http_allowed(reclaim_url, context="vault_job_reclaim_orphans")
                rr = await client.post(reclaim_url, headers=hdr, json={})
                if rr.status_code < 400:
                    body = rr.json() if rr.content else {}
                    data = body.get("data") if isinstance(body, dict) else None
                    count = int(data.get("count", 0)) if isinstance(data, dict) else 0
                    if count > 0:
                        logger.info(
                            "vault_job_poll: reclaimed %s orphaned running job(s) on startup", count
                        )
                else:
                    logger.warning(
                        "vault_job_poll: orphan reclaim HTTP %s — %s",
                        rr.status_code,
                        rr.text[:400],
                    )
            except httpx.RequestError as e:
                logger.info("vault_job_poll: orphan reclaim skipped (PHP not reachable yet): %s", e)

        workers = [
            asyncio.create_task(
                _vault_job_worker_loop(
                    i,
                    client,
                    claim_url=claim_url,
                    finish_url=finish_url,
                    hdr=hdr,
                    use_pg_claim=use_pg_claim,
                    host=host,
                    interval=interval,
                    connect_fail_seq=connect_fail_seq,
                )
            )
            for i in range(worker_count)
        ]
        try:
            await asyncio.gather(*workers)
        except asyncio.CancelledError:
            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            raise
