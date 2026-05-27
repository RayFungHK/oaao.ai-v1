"""
On-disk slide projects under OAAO_SLIDE_PROJECT_ROOT (mirrors PHP SlideProjectStorage).

SD-2: project layout, outline + per-slide content.md via LLM.
SD-3: sandbox HTML self-eval + export artifacts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_manifest_locks: dict[str, asyncio.Lock] = {}
from urllib.parse import urlencode  # noqa: E402

from oaao_orchestrator.slide_project.canvas import (  # noqa: E402
    normalize_slide_html,
)
from oaao_orchestrator.slide_project.html_sandbox import validate_slide_html  # noqa: E402
from oaao_orchestrator.slide_project.llm import (  # noqa: E402
    generate_deck_outline,
    generate_slide_html,
    generate_slide_markdown,
)

logger = logging.getLogger(__name__)

_PROJECT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def storage_root() -> Path:
    env = (os.environ.get("OAAO_SLIDE_PROJECT_ROOT") or "").strip()
    if env:
        return Path(env)
    data = (os.environ.get("OAAO_AUTH_SQLITE_PATH") or "").strip()
    if data:
        return Path(data).parent / "slide-projects"
    return Path("/tmp/oaao-slide-projects")


def _safe_project_id(project_id: str) -> str:
    pid = re.sub(r"[^a-zA-Z0-9_-]", "", project_id or "")
    if not pid or not _PROJECT_ID_RE.match(pid):
        raise ValueError("invalid project_id")
    return pid


def _slide_html_api_path(project_id: str, page: int, conversation_id: str | None) -> str:
    q: dict[str, str | int] = {"project_id": project_id, "page": max(1, page)}
    if conversation_id and str(conversation_id).strip().isdigit():
        q["conversation_id"] = int(str(conversation_id).strip())
    return "/slide-designer/api/slide_html?" + urlencode(q)


def _download_api_path(project_id: str, file_name: str) -> str:
    return "/slide-designer/api/download?" + urlencode(
        {"project_id": project_id, "file": file_name}
    )


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _slide_html_body_extra(theme: str) -> str:
    if theme == "platform_layers":
        return (
            '<motion.div class="layers">'
            '<motion.div class="layer">對話層</motion.div>'
            '<motion.div class="layer">知識層</motion.div>'
            '<motion.div class="layer">工作層</motion.div>'
            "</motion.div>"
        ).replace("motion.", "")
    return "<ul><li>答案是否可信？</li><li>能否被管理？</li><li>能否被稽核？</li></ul>"


def _fallback_slide_html(
    *,
    title: str,
    subtitle: str,
    theme: str,
    spec: dict[str, Any] | None = None,
    content_md: str = "",
    deck_title: str = "",
    slide_count: int = 10,
    deck_style: dict[str, Any] | None = None,
    project_dir: Path | None = None,
) -> str:
    from oaao_orchestrator.slide_project.layouts import render_layout_slide

    slide_spec: dict[str, Any] = dict(spec) if isinstance(spec, dict) else {}
    if "title" not in slide_spec:
        slide_spec["title"] = title
    if "theme" not in slide_spec:
        slide_spec["theme"] = theme
    md = content_md.strip() or f"- {_strip_md_line(subtitle)}\n"
    return render_layout_slide(
        spec=slide_spec,
        deck_title=deck_title or title,
        content_md=md,
        slide_count=slide_count,
        deck_style=deck_style,
        project_dir=project_dir,
    )


def _strip_md_line(text: str) -> str:
    return text.replace("\n", " ").strip()[:200]


def _persist_slide_html(path: Path, html: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalize_slide_html(html), encoding="utf-8")


class SlideProjectStore:
    """Create / resume slide projects on shared disk."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or storage_root()

    def project_dir(self, project_id: str) -> Path:
        return self._root / _safe_project_id(project_id)

    def load_manifest(self, project_id: str) -> dict[str, Any] | None:
        path = self.project_dir(project_id) / "project.json"
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        return data if isinstance(data, dict) else None

    async def merge_manifest_page(self, project_id: str, page: dict[str, Any]) -> None:
        """Thread-safe page upsert for SD-4 parallel slide workers."""
        lock = _manifest_locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            manifest = self.load_manifest(project_id) or {"project_id": project_id}
            pages = [
                p
                for p in (manifest.get("pages") or [])
                if isinstance(p, dict) and int(p.get("index") or 0) != int(page.get("index") or 0)
            ]
            pages.append(page)
            pages.sort(key=lambda p: int(p.get("index") or 0))
            manifest["pages"] = pages
            manifest["status"] = "generating"
            self._write_manifest(project_id, manifest)

    def create_project_shell(
        self,
        *,
        conversation_id: str | None,
        user_id: str | None,
        workspace_id: int | None,
        title: str | None = None,
        slide_count: int = 10,
        template_id: str | None = None,
    ) -> dict[str, Any]:
        project_id = f"sp-{uuid.uuid4().hex[:12]}"
        deck_title = (title or "Slide project").strip() or "Slide project"
        cid = str(conversation_id).strip() if conversation_id else ""
        proj_dir = self.project_dir(project_id)
        proj_dir.mkdir(parents=True, exist_ok=True)

        manifest: dict[str, Any] = {
            "project_id": project_id,
            "title": deck_title,
            "slide_count": max(3, min(slide_count, 20)),
            "status": "draft",
            "conversation_id": int(cid) if cid.isdigit() else None,
            "assistant_message_id": None,
            "user_id": int(user_id) if user_id and str(user_id).strip().isdigit() else None,
            "workspace_id": workspace_id,
            "pages": [],
            "files": [],
        }
        tid = str(template_id or "").strip()
        if tid:
            manifest["template_id"] = tid
            manifest["force_page_rebuild"] = True
        self._write_manifest(project_id, manifest)
        return manifest

    def _write_manifest(self, project_id: str, manifest: dict[str, Any]) -> None:
        path = self.project_dir(project_id) / "project.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _safe_export_name(title: str) -> str:
        base = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", title.strip())[:48].strip("_")
        return base or "deck"

    @staticmethod
    def _build_pptx_stub(project_id: str, title: str, pages: list[dict[str, Any]]) -> bytes:
        summary = f"{title} ({len(pages)} HTML slides) — project {project_id}\n"
        return b"PK\x03\x04" + summary.encode("utf-8")

    async def open_build_session(
        self,
        *,
        conversation_id: str | None,
        assistant_message_id: str | None,
        user_id: str | None,
        workspace_id: int | None,
        run_task_id: str,
        resume_project_id: str | None = None,
        title: str | None = None,
        template_id: str | None = None,
    ) -> SlideBuildSession:
        target_count = _env_int("OAAO_SLIDE_OUTLINE_COUNT", 10)
        manifest: dict[str, Any] | None = None
        resume_id = (resume_project_id or "").strip()
        if resume_id:
            try:
                manifest = self.load_manifest(resume_id)
            except ValueError:
                manifest = None
        if manifest is None:
            manifest = self.create_project_shell(
                conversation_id=conversation_id,
                user_id=user_id,
                workspace_id=workspace_id,
                title=title,
                slide_count=target_count,
                template_id=template_id,
            )
        manifest["status"] = "generating"
        manifest["run_task_id"] = run_task_id
        if assistant_message_id and str(assistant_message_id).strip().isdigit():
            manifest["assistant_message_id"] = int(str(assistant_message_id).strip())
        self._write_manifest(str(manifest["project_id"]), manifest)
        return SlideBuildSession(
            store=self,
            manifest=manifest,
            conversation_id=conversation_id,
            run_task_id=run_task_id,
        )

    async def build_deck(
        self,
        *,
        conversation_id: str | None,
        assistant_message_id: str | None,
        user_id: str | None,
        workspace_id: int | None,
        run_task_id: str,
        messages: list[dict[str, Any]] | None = None,
        llm_url: str | None = None,
        llm_api_key: str | None = None,
        llm_model: str | None = None,
        resume_project_id: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        """SD-2 + SD-3: all phases in one call."""
        session = await self.open_build_session(
            conversation_id=conversation_id,
            assistant_message_id=assistant_message_id,
            user_id=user_id,
            workspace_id=workspace_id,
            run_task_id=run_task_id,
            resume_project_id=resume_project_id,
            title=title,
        )
        await session.phase_outline(
            messages=messages or [],
            llm_url=llm_url,
            llm_api_key=llm_api_key,
            llm_model=llm_model,
        )
        await session.phase_markdown(
            messages=messages or [],
            llm_url=llm_url,
            llm_api_key=llm_api_key,
            llm_model=llm_model,
        )
        await session.phase_html(
            llm_url=llm_url,
            llm_api_key=llm_api_key,
            llm_model=llm_model,
        )
        return await session.phase_export()

    def build_stub_deck(
        self,
        *,
        conversation_id: str | None,
        assistant_message_id: str | None,
        user_id: str | None,
        workspace_id: int | None,
        run_task_id: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        """Sync wrapper for legacy callers."""
        import asyncio

        return asyncio.run(
            self.build_deck(
                conversation_id=conversation_id,
                assistant_message_id=assistant_message_id,
                user_id=user_id,
                workspace_id=workspace_id,
                run_task_id=run_task_id,
                title=title,
                messages=[],
            )
        )


from oaao_orchestrator.slide_project.store_session import SlideBuildSession
