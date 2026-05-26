"""Unpack PPTX embedded fonts + cache Google/apt fonts for LibreOffice render and editor @font-face."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from urllib.request import urlopen
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

FONTS_MANIFEST_REL = "materials/fonts/manifest.json"
MEDIA_FONTS_PREFIX = "materials/fonts/"
# Metric-compatible substitutes when the requested filename is missing on disk.
_FONT_BASENAME_ALIASES: dict[str, list[str]] = {
    "arial.ttf": [
        "calibri.ttf",
        "carlito.ttf",
        "liberation-sans.ttf",
        "liberationsans-regular.ttf",
    ],
    "arialbd.ttf": ["calibrib.ttf", "carlito-bold.ttf", "liberation-sans-bold.ttf"],
    "calibri.ttf": ["carlito.ttf", "liberation-sans.ttf", "arial.ttf"],
    "calibrib.ttf": ["carlito-bold.ttf", "liberation-sans-bold.ttf", "arialbd.ttf"],
}
_DML_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

# Stable GitHub raw URLs (ofl). Keys are lowercased typeface names.
_GOOGLE_FONT_TTF: dict[str, str] = {
    "anton": "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
    "plus jakarta sans": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/"
        "PlusJakartaSans%5Bwght%5D.ttf"
    ),
    "azeret mono": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/azeretmono/AzeretMono%5Bwght%5D.ttf"
    ),
    "azeret mono regular": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/azeretmono/AzeretMono%5Bwght%5D.ttf"
    ),
}

# LibreOffice fontconfig aliases (metric-compatible substitutes installed in Docker).
_SYSTEM_TYPEFACE_ALIASES: dict[str, str] = {
    "calibri": "Carlito",
    "calibri light": "Carlito",
    "arial": "Liberation Sans",
    "times new roman": "Liberation Serif",
    "courier new": "Liberation Mono",
}


def pptx_fonts_enabled() -> bool:
    raw = (os.environ.get("OAAO_PPTX_FONTS") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def font_cache_root() -> Path:
    return Path(os.environ.get("OAAO_FONT_CACHE_DIR", "/var/oaao/font-cache"))


def _safe_filename(name: str, ext: str = "ttf") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "font").lower()).strip("-") or "font"
    return f"{slug[:80]}.{ext.lstrip('.')}"


def _deobfuscate_font_data(data: bytes, guid: str) -> bytes:
    hex_str = guid.strip("{}").replace("-", "")
    if len(hex_str) != 32:
        return data
    try:
        guid_bytes = bytes.fromhex(hex_str)
    except ValueError:
        return data
    md5_hash = hashlib.md5(guid_bytes).digest()
    out = bytearray(data)
    for i in range(min(32, len(out))):
        out[i] ^= md5_hash[i]
    return bytes(out)


def _extract_embedded_from_pptx(pptx_path: Path, dest_dir: Path) -> dict[str, Path]:
    """Return typeface -> local ttf/otf path for embedded ppt/fonts/*.fntdata."""
    found: dict[str, Path] = {}
    try:
        with zipfile.ZipFile(pptx_path, "r") as zf:
            font_xml = [n for n in zf.namelist() if re.match(r"ppt/font\d+\.xml$", n)]
            for xml_name in font_xml:
                root = ET.fromstring(zf.read(xml_name))
                typeface = ""
                font_key = ""
                for el in root.iter():
                    if el.tag.endswith("}latin") or el.tag.endswith("}ea"):
                        tf = (el.get("typeface") or "").strip()
                        if tf and not typeface:
                            typeface = tf
                    if el.tag.endswith("}font") and not typeface:
                        typeface = (el.get("typeface") or "").strip()
                    if "fontKey" in el.attrib:
                        font_key = str(el.attrib.get("fontKey") or "")
                m = re.search(r"font(\d+)", xml_name)
                if not m:
                    continue
                fnt_name = f"ppt/fonts/font{m.group(1)}.fntdata"
                if fnt_name not in zf.namelist():
                    continue
                raw = zf.read(fnt_name)
                if font_key:
                    raw = _deobfuscate_font_data(raw, font_key)
                if not typeface:
                    typeface = f"EmbeddedFont{m.group(1)}"
                safe = _safe_filename(typeface, "ttf")
                path = dest_dir / safe
                path.write_bytes(raw)
                found[typeface] = path
    except (OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        logger.warning("pptx_embedded_font_extract_failed path=%s err=%s", pptx_path, exc)
    return found


def _download_google_font(typeface: str, cache_dir: Path) -> Path | None:
    url = _GOOGLE_FONT_TTF.get(typeface.strip().lower())
    if not url:
        return None
    safe = _safe_filename(typeface, "ttf")
    dest = cache_dir / safe
    if dest.is_file() and dest.stat().st_size > 1000:
        return dest
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        with urlopen(url, timeout=60) as resp:
            data = resp.read()
        if len(data) < 1000:
            return None
        dest.write_bytes(data)
        logger.info("pptx_font_downloaded typeface=%s path=%s", typeface, dest)
        return dest
    except Exception as exc:  # noqa: BLE001
        logger.warning("pptx_font_download_failed typeface=%s err=%s", typeface, exc)
        return None


def _resolve_system_font_path(typeface: str) -> Path | None:
    """Locate an already-installed font file via fontconfig (Carlito, Liberation, …)."""
    alias = _SYSTEM_TYPEFACE_ALIASES.get(typeface.strip().lower())
    if not alias:
        return None
    try:
        out = subprocess.run(
            ["fc-match", "-f", "%{file}\n", alias],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        path = (out.stdout or "").strip().split("\n")[0]
        if path and Path(path).is_file():
            return Path(path)
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.debug("fc_match_failed typeface=%s err=%s", alias, exc)
    return None


def ensure_typeface_file(
    typeface: str, cache_dir: Path, pptx_path: Path | None = None
) -> Path | None:
    name = (typeface or "").strip()
    if not name:
        return None

    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / _safe_filename(name, "ttf")
    if cached.is_file():
        return cached

    if pptx_path and pptx_path.is_file():
        embedded = _extract_embedded_from_pptx(pptx_path, cache_dir)
        if name in embedded:
            return embedded[name]
        for key, path in embedded.items():
            if key.lower() == name.lower():
                return path

    downloaded = _download_google_font(name, cache_dir)
    if downloaded is not None:
        return downloaded

    system = _resolve_system_font_path(name)
    if system is not None:
        try:
            shutil.copy2(system, cached)
            return cached
        except OSError as exc:
            logger.warning("pptx_font_system_copy_failed typeface=%s err=%s", name, exc)

    return None


def resolve_font_file_in_asset_dir(asset_dir: Path, rel_path: str) -> tuple[Path | None, str]:
    """Resolve ``materials/fonts/…`` under a template asset dir (case + alias aware)."""
    rel = str(rel_path or "").strip().lstrip("/").replace("\\", "/")
    if not rel.startswith("materials/fonts/"):
        return None, rel
    direct = asset_dir / rel
    if direct.is_file():
        return direct, rel

    fonts_dir = asset_dir / "materials" / "fonts"
    if not fonts_dir.is_dir():
        return None, rel

    base = Path(rel).name
    for entry in fonts_dir.iterdir():
        if entry.is_file() and entry.name.lower() == base.lower():
            return entry, f"{MEDIA_FONTS_PREFIX}{entry.name}"

    for alt in _FONT_BASENAME_ALIASES.get(base.lower(), []):
        for entry in fonts_dir.iterdir():
            if entry.is_file() and entry.name.lower() == alt.lower():
                return entry, f"{MEDIA_FONTS_PREFIX}{entry.name}"

    return None, rel


def verify_font_entries(
    asset_dir: Path | None,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep manifest / deck_style font rows only when a file exists (or alias resolves)."""
    if asset_dir is None:
        return []
    out: list[dict[str, Any]] = []
    for row in entries:
        if not isinstance(row, dict):
            continue
        rel = str(row.get("path") or "").strip()
        if not rel:
            continue
        resolved, canonical = resolve_font_file_in_asset_dir(asset_dir, rel)
        if resolved is None:
            continue
        merged = dict(row)
        merged["path"] = canonical
        out.append(merged)
    return out


def build_font_face_css(
    template_id: str,
    entries: list[dict[str, Any]],
    *,
    asset_dir: Path | None = None,
) -> str:
    """CSS @font-face rules using slide-designer template_font API."""
    tid = re.sub(r"[^a-zA-Z0-9_%-]", "", template_id)
    blocks: list[str] = []
    for row in entries:
        if not isinstance(row, dict):
            continue
        family = str(row.get("family") or row.get("typeface") or "").strip()
        rel = str(row.get("path") or "").strip()
        if not family or not rel:
            continue
        if asset_dir is not None:
            resolved, rel = resolve_font_file_in_asset_dir(asset_dir, rel)
            if resolved is None:
                continue
        q = f"template_id={tid}&path={rel}"
        url = f"/slide-designer/api/template_font?{q}"
        escaped_family = family.replace("\\", "\\\\").replace('"', '\\"')
        blocks.append(
            "@font-face {\n"
            f'  font-family: "{escaped_family}";\n'
            f'  src: url("{url}") format("truetype");\n'
            "  font-weight: normal;\n"
            "  font-style: normal;\n"
            "  font-display: swap;\n"
            "}"
        )
    return "\n".join(blocks)


def build_font_stack_from_entries(entries: list[dict[str, Any]], fallback: str) -> str:
    families: list[str] = []
    seen: set[str] = set()
    for row in entries:
        if not isinstance(row, dict):
            continue
        family = str(row.get("family") or row.get("typeface") or "").strip()
        if not family or family.lower() in seen:
            continue
        seen.add(family.lower())
        escaped = family.replace("\\", "\\\\").replace('"', '\\"')
        families.append(f'"{escaped}"')
    if not families:
        return fallback
    return ", ".join(families + [fallback])  # noqa: RUF005


def write_fontconfig_for_dirs(dirs: list[Path]) -> Path | None:
    valid = [d.resolve() for d in dirs if d.is_dir()]
    if not valid:
        return None
    fd, name = tempfile.mkstemp(prefix="oaao-fonts-", suffix=".conf")
    lines = ['<?xml version="1.0"?>', "<fontconfig>"]
    for d in valid:
        lines.append(f"  <dir>{d}</dir>")
    lines.append("</fontconfig>")
    conf_path = Path(name)
    os.close(fd)
    conf_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return conf_path


def font_dirs_for_render(asset_dir: Path | None) -> list[Path]:
    dirs = [font_cache_root()]
    if asset_dir is not None:
        tpl_fonts = asset_dir / "materials" / "fonts"
        if tpl_fonts.is_dir():
            dirs.append(tpl_fonts)
    return dirs


def apply_pptx_fonts(
    pptx_path: Path,
    asset_dir: Path,
    fonts_meta: dict[str, Any] | None,
    *,
    template_id: str = "",
) -> dict[str, Any] | None:
    """
    Cache fonts globally + copy into template materials/fonts/.
    Updates deck typography font_stack when template_id provided via caller.
    """
    if not pptx_fonts_enabled():
        return None

    used = []
    if isinstance(fonts_meta, dict):
        raw = fonts_meta.get("used_typefaces")
        if isinstance(raw, list):
            used = [str(x).strip() for x in raw if str(x).strip()]

    if not used:
        return None

    cache = font_cache_root()
    tpl_fonts_dir = asset_dir / "materials" / "fonts"
    tpl_fonts_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    for typeface in used:
        src = ensure_typeface_file(typeface, cache, pptx_path=pptx_path)
        if src is None:
            continue
        dest_name = _safe_filename(typeface, src.suffix.lstrip(".") or "ttf")
        dest = tpl_fonts_dir / dest_name
        if not dest.is_file() or dest.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dest)
        entries.append(
            {
                "typeface": typeface,
                "family": typeface,
                "path": f"{MEDIA_FONTS_PREFIX}{dest_name}",
                "cache_key": dest_name,
            }
        )

    if not entries:
        logger.info("pptx_fonts_none_resolved template=%s typefaces=%s", template_id, used)
        return None

    manifest = {
        "version": 1,
        "template_id": template_id,
        "entries": entries,
        "font_face_css": build_font_face_css(template_id, entries, asset_dir=asset_dir),
        "font_stack": build_font_stack_from_entries(
            entries,
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        ),
    }
    manifest_path = asset_dir / FONTS_MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        subprocess.run(
            ["fc-cache", "-f", str(tpl_fonts_dir)], check=False, capture_output=True, timeout=30
        )
        subprocess.run(["fc-cache", "-f", str(cache)], check=False, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        pass

    logger.info("pptx_fonts_ok template=%s count=%s", template_id, len(entries))
    return manifest
