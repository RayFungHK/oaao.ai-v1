"""Tests for CP2 PPTX materials unpack."""

from __future__ import annotations

import json
from pathlib import Path

from oaao_orchestrator.slide_project.pptx_materials import (
    MANIFEST_REL,
    build_materials_manifest,
    pptx_materials_enabled,
)


def test_pptx_materials_enabled_default() -> None:
    assert pptx_materials_enabled() is True


def test_build_materials_manifest_monochrome_sample() -> None:
    pptx = (
        Path(__file__).resolve().parents[2]
        / "docker/data/slide-templates/custom/personal/2/import_40951d37ada0aa0c_c1cb5a78/source.pptx"
    )
    if not pptx.is_file():
        return

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        asset = Path(tmp)
        manifest = build_materials_manifest(pptx, asset)
        assert manifest is not None
        assert (asset / MANIFEST_REL).is_file()
        slides = manifest.get("slides")
        assert isinstance(slides, list) and len(slides) >= 1
        media_dir = asset / "materials" / "media"
        assert media_dir.is_dir()
        assert any(media_dir.iterdir())
        orphans = manifest.get("orphan_media")
        assert isinstance(orphans, list)
        loaded = json.loads((asset / MANIFEST_REL).read_text(encoding="utf-8"))
        assert loaded["version"] == 1
