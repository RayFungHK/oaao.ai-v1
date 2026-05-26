"""Orchestrator logging — uvicorn does not configure app logger levels by default."""

from __future__ import annotations

import logging
import os


def configure_oaao_logging() -> None:
    level_name = os.environ.get("OAAO_LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    else:
        root.setLevel(level)
    for name in ("oaao_orchestrator", "oaao_orchestrator.live_meeting"):
        logging.getLogger(name).setLevel(level)
