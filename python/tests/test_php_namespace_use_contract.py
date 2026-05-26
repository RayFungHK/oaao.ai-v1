"""Static contract: Module\\oaao\\* controllers must import oaaoai\\{module}\\* library classes.

Catches mistakes like `UiqePurposeConfig::` without `use oaaoai\\endpoints\\UiqePurposeConfig`
(which PHP resolves as `Module\\oaao\\endpoints\\UiqePurposeConfig` → class not found at runtime).
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OAao = REPO / "backbone" / "sites" / "oaaoai" / "oaaoai"

NS_MODULE = re.compile(r"^\s*namespace\s+Module\\oaao\\([a-z0-9-]+)\s*;", re.M)
NS_OAAOAI = re.compile(r"^\s*namespace\s+oaaoai\\([a-z0-9-]+)\s*;", re.M)
USE_IMPORT = re.compile(r"^\s*use\s+oaaoai\\([a-z0-9-]+)\\([A-Za-z0-9_]+)\s*;", re.M)
CLASS_IN_LIB = re.compile(
    r"^\s*namespace\s+oaaoai\\([a-z0-9-]+)\s*;.*?^\s*(?:final\s+)?class\s+([A-Za-z0-9_]+)\b",
    re.M | re.S,
)
# Unqualified ClassName:: or new ClassName (not preceded by \ or word char)
REF_CLASS = re.compile(r"(?<!\\)(?<![A-Za-z0-9_])([A-Z][A-Za-z0-9_]*)::")
NEW_CLASS = re.compile(r"\bnew\s+([A-Z][A-Za-z0-9_]*)\b")

SKIP_TYPES = frozenset(
    {
        "PDO",
        "DateTime",
        "DateTimeImmutable",
        "Exception",
        "RuntimeException",
        "InvalidArgumentException",
        "JsonException",
        "ArrayObject",
        "stdClass",
        "Controller",
        "Agent",
        "Database",
        "ModuleInfo",
        "XHR",
        "StringUtil",
        "Statement",
    }
)


def _library_classes(mod_dir: Path) -> dict[str, str]:
    """class name -> oaaoai module segment (e.g. endpoints)."""
    lib = mod_dir / "default" / "library"
    if not lib.is_dir():
        return {}
    out: dict[str, str] = {}
    for path in lib.glob("*.php"):
        text = path.read_text(encoding="utf-8", errors="replace")
        m = CLASS_IN_LIB.search(text)
        if m:
            out[m.group(2)] = m.group(1)
    return out


def _module_controllers(mod_dir: Path) -> list[Path]:
    ctrl = mod_dir / "default" / "controller"
    if not ctrl.is_dir():
        return []
    files = []
    for path in ctrl.glob("*.php"):
        if path.name.startswith("_"):
            continue
        files.append(path)
    return files


def _parse_controller(path: Path) -> tuple[str | None, set[str], set[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    mod_m = NS_MODULE.search(text)
    if not mod_m:
        oaao_m = NS_OAAOAI.search(text)
        if oaao_m:
            return oaao_m.group(1), set(), set()  # oaaoai namespace: same-module refs OK
        return None, set(), set()

    mod = mod_m.group(1)
    imported = {cls for m, cls in USE_IMPORT.findall(text)}
    fq_used = set(re.findall(r"\\oaaoai\\[a-z0-9-]+\\([A-Z][A-Za-z0-9_]*)", text))
    refs = set(REF_CLASS.findall(text)) | set(NEW_CLASS.findall(text))
    return mod, imported | fq_used, refs


def test_module_controllers_import_oaaoai_library_classes() -> None:
    violations: list[str] = []

    for mod_dir in sorted(OAao.iterdir()):
        if not mod_dir.is_dir():
            continue
        mod_name = mod_dir.name  # noqa: F841
        lib_classes = _library_classes(mod_dir)
        if not lib_classes:
            continue

        for ctrl in _module_controllers(mod_dir):
            file_mod, imported, refs = _parse_controller(ctrl)
            if file_mod is None:
                continue

            rel = ctrl.relative_to(REPO)
            for cls in sorted(refs):
                if cls in SKIP_TYPES or cls in imported:
                    continue
                lib_mod = lib_classes.get(cls)
                if lib_mod is None:
                    continue
                if lib_mod != file_mod:
                    continue
                violations.append(
                    f"{rel}: uses `{cls}` without `use oaaoai\\{lib_mod}\\{cls}` "
                    f"(namespace Module\\oaao\\{file_mod} would resolve Module\\oaao\\{file_mod}\\{cls})",
                )

    assert not violations, "PHP namespace/use contract violations:\n" + "\n".join(violations)
