"""CS-3-S3 — HTML → PDF via weasyprint (optional dependency)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_WEASYPRINT: Any = None
_WEASYPRINT_ERR: str | None = None


def _load_weasyprint() -> tuple[Any, str | None]:
    global _WEASYPRINT, _WEASYPRINT_ERR
    if _WEASYPRINT is not None:
        return _WEASYPRINT, None
    if _WEASYPRINT_ERR is not None:
        return None, _WEASYPRINT_ERR
    try:
        from weasyprint import HTML  # noqa: PLC0415

        _WEASYPRINT = HTML
        return _WEASYPRINT, None
    except ImportError as exc:
        _WEASYPRINT_ERR = f"weasyprint_not_installed:{exc}"
        logger.warning("weasyprint unavailable: %s", exc)
        return None, _WEASYPRINT_ERR
    except Exception as exc:  # noqa: BLE001
        _WEASYPRINT_ERR = str(exc)
        logger.warning("weasyprint load failed: %s", exc)
        return None, _WEASYPRINT_ERR


def html_to_pdf_bytes(html_document: str) -> tuple[bytes | None, str | None]:
    """Return (pdf_bytes, error_code). error_code is None on success."""
    HTML, err = _load_weasyprint()
    if HTML is None:
        code = "pdf_renderer_not_configured"
        if err and err.startswith("weasyprint_not_installed"):
            return None, code
        return None, err or code
    try:
        pdf = HTML(string=html_document).write_pdf()
        if not pdf:
            return None, "pdf_empty"
        return pdf, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("weasyprint write_pdf failed: %s", exc)
        return None, f"pdf_render_failed:{exc.__class__.__name__}"
