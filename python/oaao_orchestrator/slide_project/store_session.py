"""Slide build session — outline / markdown / HTML / export phases (W9-S2 split)."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html
from oaao_orchestrator.slide_project.llm import (
    generate_deck_outline,
    generate_slide_html,
    generate_slide_markdown,
)
from oaao_orchestrator.slide_project.store import (
    SlideProjectStore,
    _download_api_path,
    _env_int,
    _fallback_slide_html,
    _persist_slide_html,
    _slide_html_api_path,
)

logger = logging.getLogger(__name__)

@dataclass
class SlideBuildSession:
    store: SlideProjectStore
    manifest: dict[str, Any]
    conversation_id: str | None
    run_task_id: str
    deck_title: str = ""
    slide_count: int = 10
    slides_spec: list[dict[str, Any]] = field(default_factory=list)
    deck_style: dict[str, Any] = field(default_factory=dict)
    outline_body: str = ""
    pages: list[dict[str, Any]] = field(default_factory=list)
    log_lines: list[str] = field(default_factory=list)

    @property
    def project_id(self) -> str:
        return str(self.manifest["project_id"])

    @property
    def proj_dir(self) -> Path:
        return self.store.project_dir(self.project_id)

    def template_asset_dir(self) -> Path | None:
        tid = str(self.manifest.get("template_id") or "").strip()
        if not tid:
            return None
        from oaao_orchestrator.slide_project.custom_templates import (
            resolve_template_asset_dir,
        )

        return resolve_template_asset_dir(tid)

    async def phase_outline(
        self,
        *,
        messages: list[dict[str, Any]],
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
        vault_grounding: str | None = None,
        on_outline_progress: Any = None,
    ) -> None:
        target_count = _env_int("OAAO_SLIDE_OUTLINE_COUNT", 10)
        outline_path = self.proj_dir / "deck_outline.md"
        prior_outline = outline_path.read_text(encoding="utf-8") if outline_path.is_file() else None

        preset_id = str(self.manifest.get("template_id") or "").strip()
        preset: dict[str, Any] | None = None
        tpl_pages: list[dict[str, Any]] = []
        if preset_id:
            from oaao_orchestrator.slide_project.custom_templates import (
                load_custom_template_by_id,
            )
            from oaao_orchestrator.slide_project.template_pages import (
                load_template_pages,
            )

            preset = load_custom_template_by_id(preset_id)
            tpl_pages = load_template_pages(preset) if isinstance(preset, dict) else []

        if preset_id and tpl_pages:
            from oaao_orchestrator.slide_project.fanout import (
                detect_slide_page_count,
            )
            from oaao_orchestrator.slide_project.teaching_intent import (
                wants_handbook_teaching_outline,
            )
            from oaao_orchestrator.slide_project.template_pages import (
                apply_template_pages_to_slides,
                build_template_outline_context,
                slides_spec_from_template_pages,
            )

            want = detect_slide_page_count(messages)
            page_count = max(3, min(want, len(tpl_pages), 20))
            label = str((preset or {}).get("label") or "").strip()

            if wants_handbook_teaching_outline(messages):
                tpl_ctx = build_template_outline_context(
                    tpl_pages, template_label=label, max_pages=page_count
                )
                outline = await generate_deck_outline(
                    url=llm_url,
                    api_key=llm_api_key,
                    model=llm_model,
                    messages=messages,
                    slide_count=page_count,
                    resume_outline=prior_outline,
                    template_context=tpl_ctx,
                    template_teaching=True,
                    vault_grounding=vault_grounding,
                )
                llm_slides = list(outline.get("slides") or [])
                micro = None
                page_picks: dict[int, int] = {}
                if isinstance(preset, dict):
                    from oaao_orchestrator.slide_project.template_micro_skills import (
                        load_micro_skills_from_template,
                        plan_template_page_picks,
                    )

                    micro = load_micro_skills_from_template(preset)
                    if micro and llm_url and llm_model:
                        page_picks = await plan_template_page_picks(
                            llm_slides,
                            tpl_pages,
                            micro,
                            url=llm_url,
                            api_key=llm_api_key,
                            model=llm_model,
                        )
                self.slides_spec = apply_template_pages_to_slides(
                    llm_slides,
                    tpl_pages,
                    page_picks=page_picks or None,
                    template_micro_skills=micro,
                )
                from oaao_orchestrator.slide_project.template_pages import (
                    attach_master_preview_url,
                )

                for row in self.slides_spec:
                    if isinstance(row, dict) and preset_id:
                        row["template_id"] = preset_id
                        attach_master_preview_url(row, preset_id)
                self.deck_title = str(outline.get("title") or label or "Presentation")
                self.slide_count = len(self.slides_spec) or page_count
                self.log_lines.append(
                    f"[outline] template_teaching_hybrid={preset_id} "
                    f"pages={self.slide_count}/{len(tpl_pages)}"
                )
            else:
                self.slides_spec = slides_spec_from_template_pages(
                    tpl_pages, want, template_id=preset_id
                )
                self.deck_title = label or str(self.manifest.get("title") or "Presentation")
                self.slide_count = len(self.slides_spec) or want
                self.log_lines.append(
                    f"[outline] template_first={preset_id} pages={self.slide_count}/{len(tpl_pages)}"
                )
        else:
            outline = await generate_deck_outline(
                url=llm_url,
                api_key=llm_api_key,
                model=llm_model,
                messages=messages,
                slide_count=int(self.manifest.get("slide_count") or target_count),
                resume_outline=prior_outline,
                vault_grounding=vault_grounding,
            )
            self.deck_title = str(
                outline.get("title") or self.manifest.get("title") or "Presentation"
            )
            self.slide_count = int(outline.get("slide_count") or target_count)
            from oaao_orchestrator.slide_project.layout_plan import (
                diversify_slide_layouts,
            )

            self.slides_spec = diversify_slide_layouts(list(outline.get("slides") or []))

            if preset_id and tpl_pages:
                from oaao_orchestrator.slide_project.template_micro_skills import (
                    load_micro_skills_from_template,
                )
                from oaao_orchestrator.slide_project.template_pages import (
                    apply_template_pages_to_slides,
                )

                micro = (
                    load_micro_skills_from_template(preset) if isinstance(preset, dict) else None
                )
                self.slides_spec = apply_template_pages_to_slides(
                    self.slides_spec,
                    tpl_pages,
                    template_micro_skills=micro,
                )
                self.log_lines.append(
                    f"[outline] template_pages={preset_id} ({len(tpl_pages)} slides)"
                )

        from oaao_orchestrator.slide_project.outline_markdown import (
            format_deck_outline_markdown,
            format_slide_outline_lines,
        )

        outline_lines = [f"# {self.deck_title}", "", "## Outline", ""]

        async def _emit_outline_progress() -> None:
            self.outline_body = "\n".join(outline_lines).rstrip() + "\n"
            if on_outline_progress is not None:
                await on_outline_progress(self.outline_body)

        await _emit_outline_progress()
        for spec in sorted(self.slides_spec, key=lambda s: int(s.get("index") or 0)):
            if not isinstance(spec, dict):
                continue
            outline_lines.extend(format_slide_outline_lines(spec))
            await _emit_outline_progress()
        self.outline_body = format_deck_outline_markdown(
            self.deck_title,
            self.slides_spec,
        )
        outline_path.write_text(self.outline_body, encoding="utf-8")
        if on_outline_progress is not None:
            await on_outline_progress(self.outline_body)

        self.manifest["title"] = self.deck_title
        self.manifest["slide_count"] = self.slide_count
        self.manifest["slides_spec"] = self.slides_spec
        self.manifest["status"] = "outlined"
        self.store._write_manifest(self.project_id, self.manifest)

        if not self.log_lines:
            self.log_lines = [
                f"ubuntu@sandbox:~$ slide-designer --project {self.project_id}",
                "[INFO] SD-3 HTML sandbox self-eval",
            ]

    async def phase_deck_style(
        self,
        *,
        messages: list[dict[str, Any]],
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
        force: bool = False,
    ) -> None:
        """Art-direction pass — one locked palette + layout rules for the whole deck."""
        if not self.slides_spec:
            await self.phase_outline(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
            )

        from oaao_orchestrator.slide_project.custom_templates import (
            load_custom_template_by_id,
        )
        from oaao_orchestrator.slide_project.deck_style import (
            apply_deck_style_to_slides,
            generate_deck_style,
            load_deck_style,
            normalize_deck_style,
            save_deck_style,
        )

        preset_id = str(self.manifest.get("template_id") or "").strip()
        preset = load_custom_template_by_id(preset_id) if preset_id else None
        if isinstance(preset, dict) and isinstance(preset.get("deck_style"), dict):
            self.deck_style = normalize_deck_style(preset["deck_style"])
            save_deck_style(self.proj_dir, self.deck_style)
            self.slides_spec = apply_deck_style_to_slides(self.slides_spec, self.deck_style)
            from oaao_orchestrator.slide_project.template_pages import (
                apply_template_pages_to_slides,
                load_template_pages,
            )

            tpl_pages = load_template_pages(preset)
            if tpl_pages:
                from oaao_orchestrator.slide_project.template_micro_skills import (
                    load_micro_skills_from_template,
                )

                micro = load_micro_skills_from_template(preset)
                self.slides_spec = apply_template_pages_to_slides(
                    self.slides_spec,
                    tpl_pages,
                    template_micro_skills=micro,
                )
            self.manifest["deck_style"] = self.deck_style
            from oaao_orchestrator.slide_project.template_registry import (
                export_catalog_snapshot,
            )

            self.manifest["template_catalog"] = export_catalog_snapshot()
            self.manifest["status"] = "styled"
            self.store._write_manifest(self.project_id, self.manifest)
            self.log_lines.append(f"[style] preset template={preset_id}")
            return

        style_path = self.proj_dir / "deck_style.json"
        if not force and style_path.is_file():
            self.deck_style = load_deck_style(self.proj_dir)
        else:
            self.deck_style = await generate_deck_style(
                url=llm_url,
                api_key=llm_api_key,
                model=llm_model,
                messages=messages,
                deck_title=self.deck_title,
                slides_spec=self.slides_spec,
            )
            save_deck_style(self.proj_dir, self.deck_style)

        self.slides_spec = apply_deck_style_to_slides(self.slides_spec, self.deck_style)
        save_deck_style(self.proj_dir, self.deck_style)

        self.manifest["slides_spec"] = self.slides_spec
        from oaao_orchestrator.slide_project.template_registry import (
            export_catalog_snapshot,
        )

        self.manifest["deck_style"] = self.deck_style
        self.manifest["template_catalog"] = export_catalog_snapshot()
        self.manifest["status"] = "styled"
        self.store._write_manifest(self.project_id, self.manifest)
        self.log_lines.append(f"[style] deck_theme={self.deck_style.get('deck_theme', 'default')}")

    async def phase_markdown(
        self,
        *,
        messages: list[dict[str, Any]],
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
        vault_grounding: str | None = None,
    ) -> None:
        md_max = _env_int("OAAO_SLIDE_MD_MAX", 8)
        if not self.slides_spec:
            await self.phase_outline(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
                vault_grounding=vault_grounding,
            )
        if not self.deck_style:
            await self.phase_deck_style(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
            )
        for spec in self.slides_spec[:md_max]:
            idx = int(spec["index"])
            slide_dir = self.proj_dir / f"slides/{idx:02d}"
            slide_dir.mkdir(parents=True, exist_ok=True)
            content_md = await generate_slide_markdown(
                url=llm_url,
                api_key=llm_api_key,
                model=llm_model,
                deck_title=self.deck_title,
                slide=spec,
                messages=messages,
                outline_excerpt=self.outline_body,
                deck_style=self.deck_style,
                slide_dir=slide_dir,
                vault_grounding=vault_grounding,
            )
            (slide_dir / "content.md").write_text(content_md, encoding="utf-8")

    async def phase_html(
        self,
        *,
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
    ) -> None:
        html_max = _env_int("OAAO_SLIDE_HTML_MAX", 4)
        html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
        cid = str(self.conversation_id).strip() if self.conversation_id else ""
        self.pages = []
        html_built = 0
        for spec in self.slides_spec:
            if html_built >= html_max:
                break
            idx = int(spec["index"])
            slide_dir = self.proj_dir / f"slides/{idx:02d}"
            content_path = slide_dir / "content.md"
            if not content_path.is_file():
                continue
            content_md = content_path.read_text(encoding="utf-8")
            rel = f"slides/{idx:02d}/slide.html"
            slide_path = self.proj_dir / rel
            slots_path = slide_dir / "slots.json"
            from oaao_orchestrator.slide_project.pptx_master import (
                slide_html_stale_vs_slots,
            )

            if slide_path.is_file() and slide_html_stale_vs_slots(slide_path, slots_path):
                slide_path.unlink(missing_ok=True)
            errors: list[str] = []
            html = ""
            for attempt in range(1, html_retries + 1):
                html = await generate_slide_html(
                    url=llm_url,
                    api_key=llm_api_key,
                    model=llm_model,
                    deck_title=self.deck_title,
                    slide=spec,
                    content_md=content_md,
                    prior_errors=errors or None,
                    slide_count=self.slide_count,
                    deck_style=self.deck_style,
                    project_dir=self.proj_dir,
                    template_asset_dir=self.template_asset_dir(),
                )
                ok, errors = validate_slide_html(html)
                self.log_lines.append(
                    f"[slide {idx:02d}] attempt {attempt}: "
                    + ("PASS" if ok else "FAIL " + "; ".join(errors[:3]))
                )
                if ok:
                    break
            if not html or errors:
                html = _fallback_slide_html(
                    title=str(spec.get("title") or f"Slide {idx}"),
                    subtitle=content_md[:180].replace("\n", " "),
                    theme=str(spec.get("theme") or "default"),
                    spec=spec,
                    content_md=content_md,
                    deck_title=self.deck_title,
                    slide_count=self.slide_count,
                    deck_style=self.deck_style,
                    project_dir=self.proj_dir,
                )
                self.log_lines.append(f"[slide {idx:02d}] fallback template applied")

            _persist_slide_html(slide_path, html)
            self.pages.append(
                {
                    "index": idx,
                    "title": str(spec.get("title") or f"Slide {idx}"),
                    "html_path": rel,
                    "preview_url": _slide_html_api_path(self.project_id, idx, cid or None),
                    "theme": str(spec.get("theme") or "default"),
                    "has_markdown": True,
                    "has_html": True,
                }
            )
            html_built += 1

    def hydrate_from_disk(self) -> None:
        from oaao_orchestrator.slide_project.deck_style import load_deck_style

        loaded = self.store.load_manifest(self.project_id)
        if isinstance(loaded, dict):
            self.manifest = loaded
        self.slides_spec = [
            s for s in (self.manifest.get("slides_spec") or []) if isinstance(s, dict)
        ]
        self.deck_title = str(self.manifest.get("title") or self.deck_title or "Presentation")
        self.slide_count = int(self.manifest.get("slide_count") or self.slide_count or 10)
        self.deck_style = load_deck_style(self.proj_dir)
        self.pages = [p for p in (self.manifest.get("pages") or []) if isinstance(p, dict)]
        outline_path = self.proj_dir / "deck_outline.md"
        if outline_path.is_file():
            self.outline_body = outline_path.read_text(encoding="utf-8")

    async def phase_single_page(
        self,
        slide_index: int,
        *,
        messages: list[dict[str, Any]],
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
        on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        vault_grounding: str | None = None,
    ) -> dict[str, Any] | None:
        """SD-4 — build markdown + HTML for one slide index."""
        self.hydrate_from_disk()
        spec = next(
            (s for s in self.slides_spec if int(s.get("index") or 0) == slide_index),
            None,
        )
        if spec is None:
            spec = {
                "index": slide_index,
                "title": f"Slide {slide_index}",
                "theme": "default",
            }
        if not self.outline_body:
            await self.phase_outline(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
                vault_grounding=vault_grounding,
            )
            self.hydrate_from_disk()

        idx = int(spec["index"])
        slide_dir = self.proj_dir / f"slides/{idx:02d}"
        slide_dir.mkdir(parents=True, exist_ok=True)
        content_path = slide_dir / "content.md"
        html_path = slide_dir / "slide.html"
        cid = str(self.conversation_id).strip() if self.conversation_id else ""
        rel = f"slides/{idx:02d}/slide.html"

        if self.manifest.get("force_page_rebuild") and html_path.is_file():
            html_path.unlink(missing_ok=True)
            if content_path.is_file():
                content_path.unlink(missing_ok=True)

        slots_path = slide_dir / "slots.json"
        from oaao_orchestrator.slide_project.pptx_master import (
            slide_html_stale_vs_slots,
        )

        if html_path.is_file() and not slide_html_stale_vs_slots(html_path, slots_path):
            page_entry = {
                "index": idx,
                "title": str(spec.get("title") or f"Slide {idx}"),
                "html_path": rel,
                "preview_url": _slide_html_api_path(self.project_id, idx, cid or None),
                "theme": str(spec.get("theme") or "default"),
                "has_markdown": content_path.is_file(),
                "has_html": True,
            }
            await self.store.merge_manifest_page(self.project_id, page_entry)
            self.hydrate_from_disk()
            if on_progress is not None:
                await on_progress(
                    {
                        "phase": "ready",
                        "slide_index": idx,
                        "slide_count": self.slide_count,
                        "title": page_entry["title"],
                        "preview_url": page_entry.get("preview_url"),
                        "building": False,
                    }
                )
            return page_entry
        if html_path.is_file():
            html_path.unlink(missing_ok=True)

        if content_path.is_file():
            page_entry = await self.phase_html_for_slide(
                idx,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
            )
            if on_progress is not None and isinstance(page_entry, dict):
                await on_progress(
                    {
                        "phase": "ready",
                        "slide_index": idx,
                        "slide_count": self.slide_count,
                        "title": str(page_entry.get("title") or f"Slide {idx}"),
                        "preview_url": page_entry.get("preview_url"),
                        "building": False,
                    }
                )
            return page_entry

        if not self.deck_style:
            await self.phase_deck_style(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
            )
        content_md = await generate_slide_markdown(
            url=llm_url,
            api_key=llm_api_key,
            model=llm_model,
            deck_title=self.deck_title,
            slide=spec,
            messages=messages,
            outline_excerpt=self.outline_body,
            deck_style=self.deck_style,
            slide_dir=slide_dir,
            vault_grounding=vault_grounding,
        )
        (slide_dir / "content.md").write_text(content_md, encoding="utf-8")

        if on_progress is not None:
            snippet = content_md.strip().replace("\r\n", "\n")
            if len(snippet) > 480:
                snippet = snippet[:480] + "…"
            await on_progress(
                {
                    "phase": "markdown",
                    "slide_index": idx,
                    "slide_count": self.slide_count,
                    "title": str(spec.get("title") or f"Slide {idx}"),
                    "snippet": snippet,
                    "building": True,
                }
            )

        html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
        cid = str(self.conversation_id).strip() if self.conversation_id else ""
        rel = f"slides/{idx:02d}/slide.html"
        if on_progress is not None:
            await on_progress(
                {
                    "phase": "html",
                    "slide_index": idx,
                    "slide_count": self.slide_count,
                    "title": str(spec.get("title") or f"Slide {idx}"),
                    "building": True,
                }
            )

        errors: list[str] = []
        html = ""
        for attempt in range(1, html_retries + 1):
            html = await generate_slide_html(
                url=llm_url,
                api_key=llm_api_key,
                model=llm_model,
                deck_title=self.deck_title,
                slide=spec,
                content_md=content_md,
                prior_errors=errors or None,
                slide_count=self.slide_count,
                deck_style=self.deck_style,
                project_dir=self.proj_dir,
                template_asset_dir=self.template_asset_dir(),
            )
            ok, errors = validate_slide_html(html)
            self.log_lines.append(
                f"[slide {idx:02d}] attempt {attempt}: "
                + ("PASS" if ok else "FAIL " + "; ".join(errors[:3]))
            )
            if ok:
                break
        if not html or errors:
            html = _fallback_slide_html(
                title=str(spec.get("title") or f"Slide {idx}"),
                subtitle=content_md[:180].replace("\n", " "),
                theme=str(spec.get("theme") or "default"),
                spec=spec,
                content_md=content_md,
                deck_title=self.deck_title,
                slide_count=self.slide_count,
                deck_style=self.deck_style,
                project_dir=self.proj_dir,
            )

        slide_path = self.proj_dir / rel
        _persist_slide_html(slide_path, html)
        page_entry = {
            "index": idx,
            "title": str(spec.get("title") or f"Slide {idx}"),
            "html_path": rel,
            "preview_url": _slide_html_api_path(self.project_id, idx, cid or None),
            "theme": str(spec.get("theme") or "default"),
            "has_markdown": True,
            "has_html": True,
        }
        await self.store.merge_manifest_page(self.project_id, page_entry)
        self.hydrate_from_disk()

        if on_progress is not None:
            await on_progress(
                {
                    "phase": "ready",
                    "slide_index": idx,
                    "slide_count": self.slide_count,
                    "title": page_entry["title"],
                    "preview_url": page_entry.get("preview_url"),
                    "building": False,
                }
            )

        return page_entry

    async def phase_html_for_slide(
        self,
        slide_index: int,
        *,
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
    ) -> dict[str, Any] | None:
        """Build HTML for one slide when markdown already exists (SD-5 continue)."""
        self.hydrate_from_disk()
        spec = next(
            (s for s in self.slides_spec if int(s.get("index") or 0) == slide_index),
            None,
        )
        if spec is None:
            return None
        idx = int(spec["index"])
        slide_dir = self.proj_dir / f"slides/{idx:02d}"
        content_path = slide_dir / "content.md"
        if not content_path.is_file():
            return None
        content_md = content_path.read_text(encoding="utf-8")
        html_retries = _env_int("OAAO_SLIDE_HTML_RETRIES", 3)
        cid = str(self.conversation_id).strip() if self.conversation_id else ""
        rel = f"slides/{idx:02d}/slide.html"
        errors: list[str] = []
        html = ""
        for attempt in range(1, html_retries + 1):
            html = await generate_slide_html(
                url=llm_url,
                api_key=llm_api_key,
                model=llm_model,
                deck_title=self.deck_title,
                slide=spec,
                content_md=content_md,
                prior_errors=errors or None,
                slide_count=self.slide_count,
                deck_style=self.deck_style,
                project_dir=self.proj_dir,
                template_asset_dir=self.template_asset_dir(),
            )
            ok, errors = validate_slide_html(html)
            self.log_lines.append(
                f"[slide {idx:02d}] continue html attempt {attempt}: "
                + ("PASS" if ok else "FAIL " + "; ".join(errors[:3]))
            )
            if ok:
                break
        if not html or errors:
            html = _fallback_slide_html(
                title=str(spec.get("title") or f"Slide {idx}"),
                subtitle=content_md[:180].replace("\n", " "),
                theme=str(spec.get("theme") or "default"),
                spec=spec,
                content_md=content_md,
                deck_title=self.deck_title,
                slide_count=self.slide_count,
                deck_style=self.deck_style,
                project_dir=self.proj_dir,
            )
        slide_path = self.proj_dir / rel
        _persist_slide_html(slide_path, html)
        page_entry = {
            "index": idx,
            "title": str(spec.get("title") or f"Slide {idx}"),
            "html_path": rel,
            "preview_url": _slide_html_api_path(self.project_id, idx, cid or None),
            "theme": str(spec.get("theme") or "default"),
            "has_markdown": True,
            "has_html": True,
        }
        await self.store.merge_manifest_page(self.project_id, page_entry)
        self.hydrate_from_disk()
        return page_entry

    async def phase_continue(
        self,
        *,
        messages: list[dict[str, Any]],
        llm_url: str | None,
        llm_api_key: str | None,
        llm_model: str | None,
        vault_grounding: str | None = None,
    ) -> None:
        """SD-5 — fill missing slide markdown/HTML on an existing project, then export."""
        self.hydrate_from_disk()
        if not self.slides_spec:
            await self.phase_outline(
                messages=messages,
                llm_url=llm_url,
                llm_api_key=llm_api_key,
                llm_model=llm_model,
                vault_grounding=vault_grounding,
            )
            self.hydrate_from_disk()
        for spec in self.slides_spec:
            idx = int(spec.get("index") or 0)
            if idx < 1:
                continue
            slide_dir = self.proj_dir / f"slides/{idx:02d}"
            content_path = slide_dir / "content.md"
            html_path = slide_dir / "slide.html"
            if not content_path.is_file():
                await self.phase_single_page(
                    idx,
                    messages=messages,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                    vault_grounding=vault_grounding,
                )
            elif not html_path.is_file():
                await self.phase_html_for_slide(
                    idx,
                    llm_url=llm_url,
                    llm_api_key=llm_api_key,
                    llm_model=llm_model,
                )
            else:
                from oaao_orchestrator.slide_project.pptx_master import (
                    slide_html_stale_vs_slots,
                )

                slots_path = slide_dir / "slots.json"
                if slide_html_stale_vs_slots(html_path, slots_path):
                    html_path.unlink(missing_ok=True)
                    await self.phase_html_for_slide(
                        idx,
                        llm_url=llm_url,
                        llm_api_key=llm_api_key,
                        llm_model=llm_model,
                    )
        await self.phase_export_from_disk()

    async def phase_export_from_disk(self) -> dict[str, Any]:
        """Collect pages written by parallel workers, then export."""
        self.hydrate_from_disk()
        cid = str(self.conversation_id).strip() if self.conversation_id else ""
        rebuilt: list[dict[str, Any]] = []
        for spec in self.slides_spec:
            idx = int(spec.get("index") or 0)
            if idx < 1:
                continue
            rel = f"slides/{idx:02d}/slide.html"
            if not (self.proj_dir / rel).is_file():
                continue
            rebuilt.append(
                {
                    "index": idx,
                    "title": str(spec.get("title") or f"Slide {idx}"),
                    "html_path": rel,
                    "preview_url": _slide_html_api_path(self.project_id, idx, cid or None),
                    "theme": str(spec.get("theme") or "default"),
                    "has_markdown": True,
                    "has_html": True,
                }
            )
        self.pages = rebuilt
        return await self.phase_export()

    async def phase_export(self) -> dict[str, Any]:
        pptx_name = SlideProjectStore._safe_export_name(self.deck_title) + ".pptx"
        pptx_bytes: bytes | None = None
        export_mode = "stub"
        try:
            from oaao_orchestrator.slide_project.pptx_export import (
                build_project_pptx,
            )

            template_src: Path | None = None
            asset = self.template_asset_dir()
            if asset is not None:
                candidate = asset / "source.pptx"
                if candidate.is_file():
                    template_src = candidate
            from oaao_orchestrator.slide_project.async_bridge import (
                run_soffice_job,
            )

            pptx_bytes = await run_soffice_job(
                build_project_pptx,
                project_dir=self.proj_dir,
                deck_title=self.deck_title,
                pages=self.pages,
                slides_spec=self.slides_spec,
                template_source_pptx=template_src,
            )
            if pptx_bytes and len(pptx_bytes) > 2000:
                export_mode = "pptx"
        except Exception:
            logger.exception("pptx_export_build_failed project=%s", self.project_id)

        if not pptx_bytes or len(pptx_bytes) < 2000:
            pptx_bytes = SlideProjectStore._build_pptx_stub(
                self.project_id, self.deck_title, self.pages
            )
            self.log_lines.append(
                f"[WARN] {pptx_name} fallback stub ({len(pptx_bytes)} bytes); "
                "set OAAO_PPTX_EXPORT=1 and ensure LibreOffice in orchestrator."
            )
        else:
            self.log_lines.append(
                f"[INFO] Wrote {pptx_name} ({len(pptx_bytes)} bytes) mode={export_mode}."
            )

        (self.proj_dir / pptx_name).write_bytes(pptx_bytes)

        log_name = "export_ppt_fix.log"
        log_body = "\n".join(self.log_lines) + "\n"
        (self.proj_dir / log_name).write_text(log_body, encoding="utf-8")

        files = [
            {
                "id": f"file-pptx-{self.run_task_id}",
                "name": pptx_name,
                "category": "document",
                "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "size_bytes": len(pptx_bytes),
                "uri": _download_api_path(self.project_id, pptx_name),
            },
            {
                "id": f"file-outline-{self.run_task_id}",
                "name": "deck_outline.md",
                "category": "document",
                "mime": "text/markdown",
                "size_bytes": len(self.outline_body.encode("utf-8")),
                "uri": _download_api_path(self.project_id, "deck_outline.md"),
            },
            {
                "id": f"file-log-{self.run_task_id}",
                "name": log_name,
                "category": "code",
                "mime": "text/plain",
                "size_bytes": len(log_body.encode("utf-8")),
                "uri": _download_api_path(self.project_id, log_name),
            },
        ]

        self.manifest.update(
            {
                "title": self.deck_title,
                "slide_count": self.slide_count,
                "status": "ready",
                "pages": self.pages,
                "files": files,
            }
        )
        self.store._write_manifest(self.project_id, self.manifest)
        return self.manifest
