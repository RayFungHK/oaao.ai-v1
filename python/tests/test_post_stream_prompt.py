from __future__ import annotations

from pathlib import Path

from oaao_orchestrator.post_stream_prompt import (
    build_prompt_variables,
    prompt_ref_for_plugin,
    render_worker_prompt,
    resolve_prompt_path,
)


def test_prompt_ref_for_plugin() -> None:
    assert prompt_ref_for_plugin("iqs").endswith("iqs.md")
    assert prompt_ref_for_plugin("accs").endswith("accs.md")


def test_render_worker_prompt_substitutes_vars(tmp_path: Path, monkeypatch) -> None:
    md = tmp_path / "iqs.md"
    md.write_text("conv={{conversation_id}} mats={{materials_count}}", encoding="utf-8")
    out = render_worker_prompt(
        md,
        build_prompt_variables({"conversation_id": "42", "materials_count": 3}),
    )
    assert "conv=42" in out
    assert "mats=3" in out


def test_resolve_prompt_path_repo_materials(monkeypatch) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("OAAO_MATERIALS_ROOT", str(repo_root))
    p = resolve_prompt_path("materials/prompts/workers/iqs.md")
    assert p is not None and p.is_file()
