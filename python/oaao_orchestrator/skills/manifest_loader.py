"""Load dynamic skill manifests from JSON (Phase 9 Skills Manager)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def load_skills_manifest() -> list[dict[str, Any]]:
    raw = (os.environ.get("OAAO_SKILLS_MANIFEST_JSON") or "").strip()
    path = (os.environ.get("OAAO_SKILLS_MANIFEST_PATH") or "").strip()
    if not raw and path and os.path.isfile(path):
        raw = open(path, encoding="utf-8").read()  # noqa: SIM115
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("invalid OAAO_SKILLS_MANIFEST")
        return []
    skills = (
        data if isinstance(data, list) else data.get("skills") if isinstance(data, dict) else None
    )
    if not isinstance(skills, list):
        return []
    return [s for s in skills if isinstance(s, dict)]
