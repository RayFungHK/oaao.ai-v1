"""Article Research worker — plan → queue → fetch (throttled) → Vault."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from oaao_orchestrator.research.extract import extract_document
from oaao_orchestrator.research.fetch import plan_source_candidates
from oaao_orchestrator.research.fetch_throttle import (
    research_fetch_max_concurrent,
    research_fetch_slot,
)
from oaao_orchestrator.research.match import evaluate_article_match, normalize_match_prompt
from oaao_orchestrator.research.naming import filename_slug, resolve_article_title
from oaao_orchestrator.research.summarize import summarize_markdown

logger = logging.getLogger(__name__)


def _internal_headers() -> dict[str, str]:
    from oaao_orchestrator._internal_secret import require_internal_secret

    secret = require_internal_secret()
    return {
        "X-OAAO-Internal-Token": secret,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _parse_source_config(src: dict[str, Any]) -> dict[str, Any]:
    cfg_raw = src.get("config_json")
    if isinstance(cfg_raw, dict):
        return cfg_raw
    if isinstance(cfg_raw, str) and cfg_raw.strip():
        try:
            dec = json.loads(cfg_raw)
            if isinstance(dec, dict):
                return dec
        except Exception:  # noqa: BLE001
            return {"url": cfg_raw}
    return {}


async def _post_json(
    client: httpx.AsyncClient, url: str, payload: dict[str, Any]
) -> dict[str, Any] | None:
    if not url:
        return None
    try:
        r = await client.post(
            url,
            json=payload,
            headers=_internal_headers(),
            timeout=httpx.Timeout(120.0, connect=15.0),
        )
        if r.status_code >= 400:
            logger.warning("research post %s -> %s %s", url, r.status_code, r.text[:200])
            return None
        data = r.json()
        return data if isinstance(data, dict) else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("research post failed %s: %s", url, exc)
        return None


async def _upload_text(
    client: httpx.AsyncClient,
    *,
    upload_url: str,
    user_id: int,
    vault_id: int,
    container_id: int | None,
    workspace_id: int | None,
    filename: str,
    content: str,
    watch_id: int | None = None,
    canonical_url: str | None = None,
    content_hash: str | None = None,
) -> int | None:
    payload: dict[str, Any] = {
        "user_id": user_id,
        "vault_id": vault_id,
        "container_id": container_id,
        "workspace_id": workspace_id,
        "filename": filename,
        "content": content,
        "mime_type": "text/markdown",
    }
    if watch_id and watch_id > 0:
        payload["watch_id"] = watch_id
    if canonical_url and canonical_url.strip():
        payload["canonical_url"] = canonical_url.strip()
    if content_hash and content_hash.strip():
        payload["content_hash"] = content_hash.strip()
    resp = await _post_json(client, upload_url, payload)
    if not resp or not resp.get("success"):
        return None
    doc_id = resp.get("document_id")
    return int(doc_id) if doc_id is not None else None


async def _ensure_normalized_match_prompt(
    client: httpx.AsyncClient,
    *,
    watch_config: dict[str, Any],
    llm_cfg: dict[str, Any] | None,
    patch_url: str,
    watch_id: int,
) -> str:
    raw = str(watch_config.get("match_prompt") or "").strip()
    if not raw:
        return ""
    norm = str(watch_config.get("match_prompt_normalized") or "").strip()
    if norm:
        return norm
    if not llm_cfg:
        return raw
    normalized = await normalize_match_prompt(client, raw, llm_cfg)
    watch_config["match_prompt_normalized"] = normalized
    if patch_url and watch_id > 0 and normalized:
        await _post_json(
            client,
            patch_url,
            {"watch_id": watch_id, "patch": {"match_prompt_normalized": normalized}},
        )
    return normalized


async def _process_article(
    client: httpx.AsyncClient,
    *,
    url: str,
    title_hint: str,
    known_hashes: dict[str, str | None],
    upload_url: str,
    item_url: str,
    match_notify_url: str,
    watch_id: int,
    run_id: int,
    user_id: int,
    vault_id: int,
    container_id: int | None,
    workspace_id: int | None,
    summary_lang: str,
    llm_cfg: dict[str, Any] | None,
    match_llm_cfg: dict[str, Any] | None = None,
    watch_config: dict[str, Any] | None,
    normalized_match_prompt: str,
    force_refetch: bool = False,
) -> tuple[str, dict[str, Any] | None, dict[str, Any]]:
    """Returns (status, error_dict, meta) where status is done|skipped|failed."""
    meta: dict[str, Any] = {"match_hit": False}
    try:
        async with research_fetch_slot():
            extracted = await extract_document(client, url, title_hint=title_hint)
            title, md, digest = extracted.title, extracted.markdown, extracted.content_hash
        prior = known_hashes.get(url)
        if not force_refetch and prior and digest == prior:
            meta["content_hash"] = digest
            return "skipped", None, meta
        if not md.strip():
            return "failed", {"url": url, "error": "empty_body"}, meta

        title = resolve_article_title(
            title,
            title_hint=title_hint,
            url=url,
            markdown=md,
        )

        summary_result = await summarize_markdown(
            client,
            body_markdown=md,
            language=summary_lang,
            llm_cfg=llm_cfg,
            title=title,
        )
        summary = summary_result.text
        summary_md = "\n".join(
            [
                "---",
                f"title: {title} (summary)",
                f"source_url: {url}",
                f"summary_language: {summary_lang}",
                f"summary_mode: {summary_result.mode}",
                *(
                    [f"summary_fallback_reason: {summary_result.reason}"]
                    if summary_result.reason
                    else []
                ),
                "---",
                "",
                summary.strip(),
                "",
            ]
        )

        base_slug = filename_slug(title, url)
        doc_id = await _upload_text(
            client,
            upload_url=upload_url,
            user_id=user_id,
            vault_id=vault_id,
            container_id=container_id,
            workspace_id=workspace_id,
            filename=f"{base_slug}.md",
            content=md,
            watch_id=watch_id,
            canonical_url=url,
            content_hash=digest,
        )
        sum_doc_id = await _upload_text(
            client,
            upload_url=upload_url,
            user_id=user_id,
            vault_id=vault_id,
            container_id=container_id,
            workspace_id=workspace_id,
            filename=f"{base_slug}_summary.md",
            content=summary_md,
            watch_id=watch_id,
            canonical_url=url,
        )
        if doc_id is None:
            return "failed", {"url": url, "error": "upload_failed"}, meta

        match_result = {"match": False, "confidence": 0.0, "reason": "match_disabled"}
        match_hit = False
        cfg = watch_config if isinstance(watch_config, dict) else {}
        match_llm = match_llm_cfg if isinstance(match_llm_cfg, dict) else llm_cfg
        if normalized_match_prompt and match_llm:
            match_result = await evaluate_article_match(
                client,
                normalized_prompt=normalized_match_prompt,
                title=title,
                body_markdown=md,
                summary_markdown=summary,
                llm_cfg=match_llm,
            )
            try:
                min_conf = float(cfg.get("match_min_confidence") or 0.7)
            except (TypeError, ValueError):
                min_conf = 0.7
            conf = float(match_result.get("confidence") or 0.0)
            match_hit = bool(match_result.get("match")) and conf >= min_conf
            meta["match_hit"] = match_hit
            meta["match_confidence"] = conf

        if item_url:
            await _post_json(
                client,
                item_url,
                {
                    "watch_id": watch_id,
                    "canonical_url": url,
                    "content_hash": digest,
                    "title": title,
                    "document_id": doc_id,
                    "summary_document_id": sum_doc_id,
                    "match_confidence": match_result.get("confidence"),
                    "match_reason": match_result.get("reason"),
                    "match_hit": 1 if match_hit else 0,
                },
            )

        if match_hit and match_notify_url:
            await _post_json(
                client,
                match_notify_url,
                {
                    "watch_id": watch_id,
                    "user_id": user_id,
                    "run_id": run_id,
                    "canonical_url": url,
                    "title": title,
                    "document_id": doc_id,
                    "confidence": match_result.get("confidence"),
                    "reason": match_result.get("reason"),
                },
            )

        known_hashes[url] = digest
        meta["content_hash"] = digest
        return "done", None, meta
    except Exception as exc:  # noqa: BLE001
        logger.warning("research article failed %s: %s", url, exc)
        return "failed", {"url": url, "error": str(exc)[:200]}, meta


def _watch_config_from_job(job: dict[str, Any]) -> dict[str, Any]:
    raw = job.get("watch_config_json")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            dec = json.loads(raw)
            if isinstance(dec, dict):
                return dec
        except json.JSONDecodeError:
            return {}
    return {}


def _known_hashes_from_items(items: Any) -> dict[str, str | None]:
    known: dict[str, str | None] = {}
    if not isinstance(items, list):
        return known
    for row in items:
        if not isinstance(row, dict):
            continue
        u = str(row.get("canonical_url") or "").strip()
        if not u:
            continue
        h = row.get("content_hash")
        known[u] = str(h).strip() if h else None
    return known


def _resolve_match_llm(payload: dict[str, Any]) -> dict[str, Any] | None:
    match_llm = payload.get("match_llm")
    if isinstance(match_llm, dict):
        return match_llm
    summary_llm = payload.get("summary_llm")
    return summary_llm if isinstance(summary_llm, dict) else None


def _refetch_jobs_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build fetch jobs from stored research_item rows (Refetch all)."""
    raw = payload.get("refetch_items")
    if not isinstance(raw, list):
        return []
    jobs: list[dict[str, Any]] = []
    sort_order = 0
    for row in raw:
        if not isinstance(row, dict):
            continue
        url = str(row.get("canonical_url") or "").strip()
        if not url:
            continue
        source_raw = row.get("source_id")
        source_id = int(source_raw) if source_raw not in (None, "", 0) else None
        title = str(row.get("title") or "").strip() or None
        jobs.append(
            {
                "canonical_url": url,
                "title": title,
                "source_id": source_id,
                "sort_order": sort_order,
            },
        )
        sort_order += 1
    return jobs


def _inline_run_job_limit(
    max_new: int, watch_config: dict[str, Any], *, force_refetch: bool
) -> int:
    """Jobs processed inline during /v1/research/run; rest drain via background poll."""
    cap = int(watch_config.get("run_inline_max") or max_new)
    cap = max(1, min(100, cap))
    if force_refetch:
        # Refetch may enqueue hundreds — keep HTTP handler fast; poll workers finish the queue.
        refetch_inline = int(watch_config.get("refetch_inline_max") or cap)
        cap = max(1, min(100, refetch_inline))
    return cap


async def execute_claimed_fetch_job(
    client: httpx.AsyncClient,
    job: dict[str, Any],
    *,
    upload_url: str,
    item_url: str,
    match_notify_url: str,
    llm_cfg: dict[str, Any] | None,
    match_llm_cfg: dict[str, Any] | None = None,
    known_hashes: dict[str, str | None],
) -> tuple[str, dict[str, Any] | None, dict[str, Any]]:
    """Process one claimed job; caller must finish the job row."""
    watch_config = _watch_config_from_job(job)
    normalized_match_prompt = str(
        watch_config.get("match_prompt_normalized") or watch_config.get("match_prompt") or "",
    ).strip()
    container_raw = job.get("watch_container_id")
    container_id = int(container_raw) if container_raw not in (None, "", 0) else None
    workspace_raw = job.get("watch_workspace_id")
    workspace_id = int(workspace_raw) if workspace_raw not in (None, "", 0) else None

    return await _process_article(
        client,
        url=str(job.get("canonical_url") or "").strip(),
        title_hint=str(job.get("title") or "").strip(),
        known_hashes=known_hashes,
        upload_url=upload_url,
        item_url=item_url,
        match_notify_url=match_notify_url,
        watch_id=int(job.get("watch_id") or 0),
        run_id=int(job.get("run_id") or 0),
        user_id=int(job.get("watch_owner_user_id") or 0),
        vault_id=int(job.get("watch_vault_id") or 0),
        container_id=container_id,
        workspace_id=workspace_id,
        summary_lang=str(job.get("watch_summary_language") or "zh-TW"),
        llm_cfg=llm_cfg,
        match_llm_cfg=match_llm_cfg,
        watch_config=watch_config,
        normalized_match_prompt=normalized_match_prompt,
        force_refetch=bool(job.get("force_refetch")),
    )


async def _claim_job(
    client: httpx.AsyncClient,
    claim_url: str,
    *,
    run_id: int,
    watch_id: int,
) -> dict[str, Any] | None:
    resp = await _post_json(client, claim_url, {"run_id": run_id, "watch_id": watch_id})
    if not resp or not resp.get("success"):
        return None
    job = resp.get("job")
    return job if isinstance(job, dict) else None


async def _finish_job(
    client: httpx.AsyncClient,
    finish_url: str,
    *,
    job_id: int,
    status: str,
    error_text: str | None = None,
) -> None:
    payload: dict[str, Any] = {"job_id": job_id, "status": status}
    if error_text:
        payload["error_text"] = error_text
    await _post_json(client, finish_url, payload)


async def process_research_fetch_queue(
    client: httpx.AsyncClient,
    payload: dict[str, Any],
    *,
    max_jobs: int,
) -> dict[str, Any]:
    """Process up to max_jobs queued fetch jobs (bounded concurrency + fetch throttle)."""
    run_id = int(payload.get("run_id") or 0)
    watch = payload.get("watch") if isinstance(payload.get("watch"), dict) else {}
    watch_id = int(watch.get("watch_id") or 0)
    user_id = int(payload.get("user_id") or 0)  # noqa: F841
    vault_id = int(watch.get("vault_id") or 0)  # noqa: F841
    container_raw = watch.get("container_id")
    container_id = int(container_raw) if container_raw not in (None, "", 0) else None  # noqa: F841
    workspace_raw = watch.get("workspace_id")
    workspace_id = int(workspace_raw) if workspace_raw not in (None, "", 0) else None  # noqa: F841
    summary_lang = str(watch.get("summary_language") or "zh-TW")  # noqa: F841
    upload_url = str(payload.get("vault_upload_url") or "").strip()
    item_url = str(payload.get("research_item_url") or "").strip()
    match_notify_url = str(payload.get("match_notify_url") or "").strip()
    claim_url = str(payload.get("fetch_job_claim_url") or "").strip()
    finish_url = str(payload.get("fetch_job_finish_url") or "").strip()
    llm_cfg = payload.get("summary_llm") if isinstance(payload.get("summary_llm"), dict) else None
    match_llm_cfg = _resolve_match_llm(payload)
    watch_config = (
        payload.get("watch_config") if isinstance(payload.get("watch_config"), dict) else {}
    )
    normalized_match_prompt = str(  # noqa: F841
        watch_config.get("match_prompt_normalized") or watch_config.get("match_prompt") or "",
    ).strip()

    stats: dict[str, Any] = {
        "processed": 0,
        "new_docs": 0,
        "skipped": 0,
        "hits": 0,
        "errors": [],
    }

    known_hashes: dict[str, str | None] = {}
    force_refetch = bool(payload.get("force_refetch"))
    if not force_refetch and isinstance(payload.get("known_items"), list):
        for row in payload["known_items"]:
            if not isinstance(row, dict):
                continue
            u = str(row.get("canonical_url") or "").strip()
            if not u:
                continue
            h = row.get("content_hash")
            known_hashes[u] = str(h).strip() if h else None

    processed = 0
    stats_lock = asyncio.Lock()
    hash_lock = asyncio.Lock()
    stop_claiming = asyncio.Event()

    async def _run_one(job: dict[str, Any]) -> None:
        nonlocal processed
        job_id = int(job.get("job_id") or 0)
        url = str(job.get("canonical_url") or "").strip()
        if job_id < 1 or not url:
            if job_id > 0:
                await _finish_job(
                    client, finish_url, job_id=job_id, status="failed", error_text="invalid_job"
                )
            return

        status = "failed"
        err: dict[str, Any] | None = {"url": url, "error": "unknown"}
        meta: dict[str, Any] = {}
        try:
            async with hash_lock:
                job_hashes = dict(known_hashes)
            status, err, meta = await execute_claimed_fetch_job(
                client,
                {**job, "force_refetch": force_refetch},
                upload_url=upload_url,
                item_url=item_url,
                match_notify_url=match_notify_url,
                llm_cfg=llm_cfg,
                match_llm_cfg=match_llm_cfg,
                known_hashes=job_hashes,
            )
            digest = meta.get("content_hash") if isinstance(meta, dict) else None
            if isinstance(digest, str) and digest.strip():
                async with hash_lock:
                    known_hashes[url] = digest.strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("research fetch job %s failed: %s", job_id, exc)
            status = "failed"
            err = {"url": url, "error": str(exc)[:200]}

        await _finish_job(
            client,
            finish_url,
            job_id=job_id,
            status=status,
            error_text=(err or {}).get("error") if err else None,
        )

        async with stats_lock:
            processed += 1
            stats["processed"] += 1
            if status == "done":
                stats["new_docs"] += 1
                if meta.get("match_hit"):
                    stats["hits"] += 1
            elif status == "skipped":
                stats["skipped"] += 1
            elif err:
                stats["errors"].append(err)

    async def _worker() -> None:
        nonlocal processed
        while not stop_claiming.is_set():
            async with stats_lock:
                if processed >= max_jobs:
                    return
            job = await _claim_job(client, claim_url, run_id=run_id, watch_id=watch_id)
            if not job:
                stop_claiming.set()
                return
            await _run_one(job)

    workers = min(max_jobs, research_fetch_max_concurrent())
    await asyncio.gather(*[_worker() for _ in range(max(1, workers))])

    return stats


async def run_research_job(payload: dict[str, Any]) -> dict[str, Any]:
    watch = payload.get("watch") if isinstance(payload.get("watch"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    watch_config = (
        payload.get("watch_config") if isinstance(payload.get("watch_config"), dict) else {}
    )
    run_id = int(payload.get("run_id") or 0)
    watch_id = int(watch.get("watch_id") or 0)
    user_id = int(payload.get("user_id") or 0)
    vault_id = int(watch.get("vault_id") or 0)
    upload_url = str(payload.get("vault_upload_url") or "").strip()
    enqueue_url = str(payload.get("fetch_job_enqueue_url") or "").strip()
    state_patch_url = str(payload.get("source_state_patch_url") or "").strip()
    watch_config_patch_url = str(payload.get("watch_config_patch_url") or "").strip()

    max_new = int(watch_config.get("max_new_per_run") or 20)
    if max_new < 1:
        max_new = 20
    if max_new > 100:
        max_new = 100

    stats: dict[str, Any] = {
        "planned": 0,
        "queued": 0,
        "processed": 0,
        "new_docs": 0,
        "skipped": 0,
        "hits": 0,
        "index_unchanged": 0,
        "errors": [],
    }

    if watch_id < 1 or vault_id < 1 or user_id < 1 or not upload_url:
        return {"ok": False, "error": "invalid_job_payload", "stats": stats}

    known_urls: set[str] = set()
    if isinstance(payload.get("known_urls"), list):
        known_urls = {str(u).strip() for u in payload["known_urls"] if str(u).strip()}

    force_refetch = bool(payload.get("force_refetch"))
    if force_refetch:
        known_urls = set()
        payload["known_items"] = []

    jobs_to_enqueue: list[dict[str, Any]] = []
    sort_order = 0

    async with httpx.AsyncClient() as client:
        await _ensure_normalized_match_prompt(
            client,
            watch_config=watch_config,
            llm_cfg=_resolve_match_llm(payload),
            patch_url=watch_config_patch_url,
            watch_id=watch_id,
        )
        payload["watch_config"] = watch_config

        refetch_jobs = _refetch_jobs_from_payload(payload) if force_refetch else []
        if refetch_jobs:
            jobs_to_enqueue = refetch_jobs
            stats["planned"] = len(refetch_jobs)
            stats["refetch_items"] = len(refetch_jobs)
        else:
            for src in sources:
                if not isinstance(src, dict):
                    continue
                source_id = int(src.get("source_id") or 0)
                kind = str(src.get("kind") or "url")
                cfg = _parse_source_config(src)

                plan = await plan_source_candidates(
                    client,
                    kind=kind,
                    config=cfg,
                    watch_config=watch_config,
                    force_refetch=force_refetch,
                )
                if plan.index_unchanged:
                    stats["index_unchanged"] += 1
                    continue

                if plan.state_patch and source_id > 0 and state_patch_url:
                    await _post_json(
                        client,
                        state_patch_url,
                        {"source_id": source_id, "patch": plan.state_patch},
                    )

                for cand in plan.candidates:
                    u = cand.url.strip()
                    if not u:
                        continue
                    stats["planned"] += 1
                    if u in known_urls and kind not in ("static", "url", "blog"):
                        stats["skipped"] += 1
                        continue
                    jobs_to_enqueue.append(
                        {
                            "canonical_url": u,
                            "title": cand.title,
                            "source_id": source_id if source_id > 0 else None,
                            "sort_order": sort_order,
                        }
                    )
                    sort_order += 1
                    if len(jobs_to_enqueue) >= max_new * 3:
                        break
                if len(jobs_to_enqueue) >= max_new * 3:
                    break

        queue_max = _inline_run_job_limit(max_new, watch_config, force_refetch=force_refetch)

        if run_id > 0 and enqueue_url and jobs_to_enqueue:
            enqueue_body: dict[str, Any] = {
                "run_id": run_id,
                "watch_id": watch_id,
                "jobs": jobs_to_enqueue,
            }
            if force_refetch:
                enqueue_body["force_refetch"] = True
            resp = await _post_json(
                client,
                enqueue_url,
                enqueue_body,
            )
            if resp and resp.get("success"):
                stats["queued"] = int(resp.get("queued") or 0)

        queue_stats = await process_research_fetch_queue(
            client,
            {**payload, "force_refetch": force_refetch},
            max_jobs=queue_max,
        )
        stats["processed"] = queue_stats.get("processed", 0)
        stats["new_docs"] = queue_stats.get("new_docs", 0)
        stats["hits"] = queue_stats.get("hits", 0)
        stats["skipped"] += queue_stats.get("skipped", 0)
        if queue_stats.get("errors"):
            stats["errors"].extend(queue_stats["errors"])
        queued = int(stats.get("queued") or 0)
        processed = int(stats.get("processed") or 0)
        if queued > processed:
            stats["background_queued"] = queued - processed

    stats["fetched"] = stats["planned"]
    return {"ok": True, "stats": stats}
