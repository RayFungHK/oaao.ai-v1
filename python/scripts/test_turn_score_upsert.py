#!/usr/bin/env python3
"""Smoke-test turn_score_upsert from orchestrator network."""

from __future__ import annotations

import json
import os
import re
import sys

import httpx

_SECRET_RAW = (os.environ.get("OAAO_ORCH_SHARED_SECRET") or "").strip()
if not _SECRET_RAW:
    raise SystemExit("OAAO_ORCH_SHARED_SECRET must be set; refusing default secret.")
SECRET = _SECRET_RAW
BASE = (os.environ.get("OAAO_CHAT_INTERNAL_BASE_URL") or "http://web/chat/api").rstrip("/")


def main() -> int:
    cid = int(sys.argv[1]) if len(sys.argv) > 1 else 21
    mid = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    body = {
        "conversation_id": cid,
        "assistant_message_id": mid,
        "plugin": "iqs",
        "iqs": 0.85,
        "iqs_dims_json": {
            "clarity": 0.85,
            "specificity": 0.85,
            "actionability": 0.85,
            "context_completeness": 0.85,
        },
        "iqs_reasons_json": {"action": "pass", "source": "test"},
        "scorer_version": "iqs_v2",
    }
    r = httpx.post(
        f"{BASE}/turn_score_upsert",
        headers={"X-OAAO-Internal-Token": SECRET, "Content-Type": "application/json"},
        json=body,
        timeout=15.0,
    )
    print("status", r.status_code, "len", len(r.text))
    ct = r.headers.get("content-type", "")
    if ct.startswith("application/json"):
        try:
            payload = r.json()
        except ValueError:
            print(r.text[:500])
            return 1
        print(json.dumps(payload, indent=2))
        return 0 if payload.get("success") else 1
    for block in re.split(r'<div class="debug">', r.text)[1:4]:
        text = re.sub(r"<[^>]+>", " ", block)
        text = re.sub(r"\s+", " ", text).strip()
        print(text[:500])
        print("---")
    m = re.search(r'class="error-message">([^<]+)', r.text)
    if m:
        print("ERROR:", m.group(1).strip())
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
