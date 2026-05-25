"""Persist post-stream scores to PHP ``turn_score_upsert`` (internal)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.evaluation.scorer_version import ACCS_SCORER_VERSION, IQS_SCORER_VERSION
from oaao_orchestrator.php_boundary import assert_php_http_allowed, php_chat_api_base
from oaao_orchestrator.post_stream_schemas import AccsScoreResult, IqsScoreResult

logger = logging.getLogger(__name__)

SCORER_VERSION = f"{IQS_SCORER_VERSION}+{ACCS_SCORER_VERSION}"


def _shared_secret() -> str:
    return (os.environ.get("OAAO_ORCH_SHARED_SECRET") or "oaao_dev_shared_secret").strip()


async def upsert_turn_score(
    *,
    plugin_id: str,
    meta: dict[str, Any],
    score: IqsScoreResult | AccsScoreResult,
) -> bool:
    cid = str(meta.get("conversation_id") or "").strip()
    mid = str(meta.get("assistant_message_id") or "").strip()
    if not cid or not mid:
        logger.warning("turn_score_upsert skipped — missing conversation or message id plugin=%s", plugin_id)
        return False

    body: dict[str, Any] = {
        "conversation_id": int(cid) if cid.isdigit() else cid,
        "assistant_message_id": int(mid) if mid.isdigit() else mid,
        "plugin": plugin_id,
        "scorer_version": IQS_SCORER_VERSION if plugin_id == "iqs" else ACCS_SCORER_VERSION,
    }
    if isinstance(score, IqsScoreResult):
        body.update(
            {
                "iqs": score.iqs,
                "iqs_dims_json": score.dimensions,
                "iqs_reasons_json": score.reasons,
            }
        )
    elif isinstance(score, AccsScoreResult):
        body.update(
            {
                "accs": score.accs,
                "accs_dims_json": score.dimensions,
                "accs_reasons_json": score.reasons,
            }
        )

    url = f"{php_chat_api_base()}/turn_score_upsert"
    assert_php_http_allowed(url, context="turn_score_upsert")
    secret = _shared_secret()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            r = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-OAAO-Internal-Token": secret,
                    "X-Requested-With": "XMLHttpRequest",
                },
                json=body,
            )
        if r.status_code >= 400:
            logger.warning(
                "turn_score_upsert HTTP %s plugin=%s conversation_id=%s body=%s",
                r.status_code,
                plugin_id,
                cid,
                r.text[:300],
            )
            return False
        try:
            payload = r.json()
        except ValueError:
            logger.warning(
                "turn_score_upsert non-JSON HTTP %s plugin=%s conversation_id=%s body=%s",
                r.status_code,
                plugin_id,
                cid,
                r.text[:300],
            )
            return False
        if not isinstance(payload, dict) or payload.get("success") is not True:
            logger.warning(
                "turn_score_upsert rejected plugin=%s conversation_id=%s body=%s",
                plugin_id,
                cid,
                r.text[:300],
            )
            return False
        return True
    except httpx.RequestError as exc:
        logger.warning("turn_score_upsert failed plugin=%s: %s", plugin_id, exc)
        return False
