"""Corpus PDF print fonts — Noto-primary, optional embed, free CSS references (CS-3 CJK).

Templates may declare any ``font-family`` stack or ``@font-face`` rules. We only
attempt to embed files for families referenced in the CSS when embedding is
enabled; resolution order is local corpus dir → cache → Noto catalog → system.
Failed resolution never blocks PDF export — weasyprint falls back to the stack.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from urllib.request import urlopen

from oaao_orchestrator.slide_project.pptx_fonts import (
    ensure_typeface_file,
    font_cache_root,
)

logger = logging.getLogger(__name__)

# Noto-first catalog (primary CJK UI fonts). Other families resolve via corpus dir / fc-match.
_NOTO_FONT_URLS: dict[str, str] = {
    "noto sans tc": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/"
        "NotoSansTC%5Bwght%5D.ttf"
    ),
    "noto sans sc": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/"
        "NotoSansSC%5Bwght%5D.ttf"
    ),
    "noto sans jp": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/"
        "NotoSansJP%5Bwght%5D.ttf"
    ),
    "noto sans kr": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/"
        "NotoSansKR%5Bwght%5D.ttf"
    ),
}

_DEFAULT_PRINT_FONT_STACK = (
    '"Noto Sans TC", "Noto Sans SC", "PingFang TC", "Microsoft JhengHei", sans-serif'
)

_GENERIC_FAMILIES = frozenset(
    {
        "serif",
        "sans-serif",
        "monospace",
        "cursive",
        "fantasy",
        "system-ui",
        "ui-sans-serif",
        "ui-serif",
        "ui-monospace",
        "inherit",
        "initial",
        "unset",
    }
)

_FONT_FAMILY_DECL_RE = re.compile(r"font-family\s*:\s*([^;}{]+)", re.IGNORECASE)
_FONT_FACE_BLOCK_RE = re.compile(r"@font-face\s*\{[^}]*\}", re.IGNORECASE | re.DOTALL)
_FONT_FACE_FAMILY_RE = re.compile(
    r"font-family\s*:\s*(?:\"([^\"]+)\"|'([^']+)'|([^;}\s]+))",
    re.IGNORECASE,
)


def default_print_font_stack() -> str:
    return _DEFAULT_PRINT_FONT_STACK


def embed_mode() -> str:
    """off | noto | all — default noto (lazy Noto embed only, never mandatory)."""
    raw = (os.environ.get("OAAO_CORPUS_PDF_EMBED_FONTS") or "noto").strip().lower()
    if raw in ("0", "false", "no", "off", "none"):
        return "off"
    if raw in ("all", "any", "1", "true", "yes"):
        return "all"
    return "noto"


def _safe_slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-") or "font"


def _corpus_font_dir() -> Path:
    raw = (os.environ.get("OAAO_CORPUS_FONT_DIR") or "").strip()
    if raw:
        return Path(raw)
    return font_cache_root() / "corpus"


def _cache_path_for_family(family: str) -> Path:
    return _corpus_font_dir() / f"{_safe_slug(family)}.ttf"


def _families_already_embedded(css: str) -> set[str]:
    embedded: set[str] = set()
    for block in _FONT_FACE_BLOCK_RE.findall(css or ""):
        for m in _FONT_FACE_FAMILY_RE.finditer(block):
            name = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            if name:
                embedded.add(name.lower())
    return embedded


def parse_font_families_from_css(css: str) -> list[str]:
    """Extract concrete font-family names from CSS (order preserved, deduped)."""
    seen: set[str] = set()
    out: list[str] = []
    for m in _FONT_FAMILY_DECL_RE.finditer(css or ""):
        chunk = m.group(1)
        for part in chunk.split(","):
            name = part.strip().strip('"').strip("'").strip()
            if not name or name.lower() in _GENERIC_FAMILIES:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(name)
    return out


def _download_noto_if_catalogued(family: str, dest: Path) -> Path | None:
    url = _NOTO_FONT_URLS.get(family.strip().lower())
    if not url:
        return None
    if dest.is_file() and dest.stat().st_size > 1000:
        return dest
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(url, timeout=60) as resp:
            data = resp.read()
        if len(data) < 1000:
            return None
        dest.write_bytes(data)
        logger.info("corpus_noto_font_cached family=%s path=%s", family, dest)
        return dest
    except Exception as exc:  # noqa: BLE001
        logger.debug("corpus_noto_font_download_skipped family=%s err=%s", family, exc)
        return None


def resolve_font_file(
    family: str,
    *,
    allow_noto_download: bool = True,
    allow_system: bool = True,
) -> Path | None:
    """Resolve a font file for optional @font-face embed (cache hits reused)."""
    name = (family or "").strip()
    if not name:
        return None

    cache = _cache_path_for_family(name)
    if cache.is_file() and cache.stat().st_size > 1000:
        return cache

    corpus_dir = _corpus_font_dir()
    for candidate in (
        corpus_dir / f"{name}.ttf",
        corpus_dir / f"{name}.otf",
        corpus_dir / f"{_safe_slug(name)}.ttf",
        corpus_dir / f"{_safe_slug(name)}.otf",
    ):
        if candidate.is_file() and candidate.stat().st_size > 1000:
            return candidate

    if allow_noto_download and name.lower() in _NOTO_FONT_URLS:
        cached = _download_noto_if_catalogued(name, cache)
        if cached is not None:
            return cached

    if allow_system:
        via_pptx = ensure_typeface_file(name, _corpus_font_dir())
        if via_pptx is not None and via_pptx.is_file():
            return via_pptx

    return None


def _font_face_block(family: str, path: Path) -> str:
    uri = path.resolve().as_uri()
    escaped = family.replace("\\", "\\\\").replace('"', '\\"')
    return (
        "@font-face {\n"
        f'  font-family: "{escaped}";\n'
        f'  src: url("{uri}") format("truetype");\n'
        "  font-weight: normal;\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "}"
    )


def build_print_font_face_css(css: str, *, extra_families: list[str] | None = None) -> str:
    """Emit @font-face only for referenced families we can resolve (lazy, optional)."""
    mode = embed_mode()
    if mode == "off":
        return ""

    referenced = list(parse_font_families_from_css(css))
    for fam in extra_families or []:
        f = str(fam or "").strip()
        if f and f not in referenced:
            referenced.append(f)

    if not referenced:
        return ""

    already = _families_already_embedded(css)
    blocks: list[str] = []
    for family in referenced:
        if family.lower() in already:
            continue
        is_noto = family.lower().startswith("noto ")
        if mode == "noto" and not is_noto:
            continue
        path = resolve_font_file(
            family,
            allow_noto_download=is_noto or mode == "all",
            allow_system=mode == "all",
        )
        if path is None:
            continue
        blocks.append(_font_face_block(family, path))
        already.add(family.lower())

    return "\n".join(blocks)


def build_cjk_font_face_css() -> str:
    """Backward-compatible alias — embed only Noto families referenced in default stack."""
    return build_print_font_face_css(f"body {{ font-family: {_DEFAULT_PRINT_FONT_STACK}; }}")


def resolve_print_css(template_css: str | None = None) -> str:
    """Merge template CSS with optional lazy @font-face embed (never mandatory)."""
    base = str(template_css or "").strip()
    if not base:
        base = (
            "@page { size: A4; margin: 18mm 16mm; }\n"
            f"body {{ font-family: {_DEFAULT_PRINT_FONT_STACK}; "
            "font-size: 11pt; line-height: 1.45; color: #111; }"
        )
    embed = build_print_font_face_css(base).strip()
    if not embed:
        return base
    return f"{embed}\n\n{base}"
