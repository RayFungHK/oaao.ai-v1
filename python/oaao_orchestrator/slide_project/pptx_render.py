"""PPTX → PNG via headless LibreOffice (PDF) + poppler pdftoppm."""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_SOFFICE_CANDIDATES = (
    "soffice",
    "libreoffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
)


def _soffice_binary() -> str | None:
    override = (os.environ.get("OAAO_SOFFICE_PATH") or "").strip()
    if override and Path(override).is_file():
        return override
    for name in _SOFFICE_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
        if Path(name).is_file():
            return name
    return None


def _pdftoppm_binary() -> str | None:
    override = (os.environ.get("OAAO_PDFTOPPM_PATH") or "").strip()
    if override and Path(override).is_file():
        return override
    return shutil.which("pdftoppm")


def pptx_render_available() -> bool:
    if (os.environ.get("OAAO_PPTX_RENDER_DISABLE") or "").strip().lower() in ("1", "true", "yes"):
        return False
    return _soffice_binary() is not None and _pdftoppm_binary() is not None


def render_pptx_to_pngs(
    pptx_path: Path,
    out_dir: Path,
    *,
    max_slides: int | None = None,
    dpi: int | None = None,
    timeout_s: float | None = None,
    asset_dir: Path | None = None,
) -> list[Path]:
    """
    Render each slide to ``{out_dir}/{index:02d}.png`` (1-based index).
    Returns empty list when tools are missing or conversion fails.
    """
    pptx_path = pptx_path.resolve()
    if not pptx_path.is_file():
        return []

    if not pptx_render_available():
        logger.info("pptx_render_skipped tools_unavailable path=%s", pptx_path)
        return []

    max_n = max_slides if max_slides is not None else _env_int("OAAO_PPTX_RENDER_MAX_SLIDES", 30)
    max_n = max(1, min(max_n, 30))
    dpi_val = dpi if dpi is not None else _env_int("OAAO_PPTX_RENDER_DPI", 150)
    timeout = timeout_s if timeout_s is not None else float(_env_int("OAAO_PPTX_RENDER_TIMEOUT_S", 180))

    out_dir.mkdir(parents=True, exist_ok=True)
    soffice = _soffice_binary()
    pdftoppm = _pdftoppm_binary()
    if not soffice or not pdftoppm:
        return []

    env = os.environ.copy()
    env.setdefault("HOME", "/tmp")
    env.setdefault("TMPDIR", "/tmp")

    if asset_dir is not None:
        try:
            from oaao_orchestrator.slide_project.pptx_fonts import (  # noqa: PLC0415
                font_dirs_for_render,
                write_fontconfig_for_dirs,
            )

            conf = write_fontconfig_for_dirs(font_dirs_for_render(asset_dir))
            if conf is not None:
                env["FONTCONFIG_FILE"] = str(conf)
        except Exception:  # noqa: BLE001
            logger.exception("pptx_render_fontconfig_failed path=%s", pptx_path)

    with tempfile.TemporaryDirectory(prefix="oaao-pptx-render-") as tmp:
        tmp_path = Path(tmp)
        pdf_path = tmp_path / f"{pptx_path.stem}.pdf"
        try:
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--nologo",
                    "--nofirststartwizard",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(tmp_path),
                    str(pptx_path),
                ],
                check=True,
                capture_output=True,
                timeout=timeout,
                env=env,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("pptx_render_soffice_failed path=%s err=%s", pptx_path, exc)
            return []

        if not pdf_path.is_file():
            pdfs = sorted(tmp_path.glob("*.pdf"))
            if not pdfs:
                logger.warning("pptx_render_no_pdf path=%s", pptx_path)
                return []
            pdf_path = pdfs[0]

        prefix = tmp_path / "slide"
        try:
            subprocess.run(
                [pdftoppm, "-png", "-r", str(dpi_val), str(pdf_path), str(prefix)],
                check=True,
                capture_output=True,
                timeout=timeout,
                env=env,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("pptx_render_pdftoppm_failed path=%s err=%s", pptx_path, exc)
            return []

        raw_pngs = sorted(tmp_path.glob("slide*.png"), key=_slide_png_sort_key)
        if not raw_pngs:
            raw_pngs = sorted(tmp_path.glob("*.png"), key=_slide_png_sort_key)

        written: list[Path] = []
        for i, src in enumerate(raw_pngs[:max_n], start=1):
            dest = out_dir / f"{i:02d}.png"
            shutil.copy2(src, dest)
            written.append(dest)

        if written:
            logger.info("pptx_render_ok path=%s slides=%s", pptx_path, len(written))
        return written


def _slide_png_sort_key(path: Path) -> tuple[int, str]:
    m = re.search(r"(\d+)", path.stem)
    return (int(m.group(1)) if m else 0, path.name)


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default
