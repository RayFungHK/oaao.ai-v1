"""Multimodal task selection helpers — resolved at runtime by the orchestrator."""

from __future__ import annotations

import re

UNDERSTAND_TASKS = frozenset({"x2t_image", "x2t_video", "caption", "describe"})
GENERATE_TASKS = frozenset({"t2i", "t2v"})
EDIT_TASKS = frozenset({"image_edit", "video_edit", "inpaint"})

_VIDEO_HINT_RE = re.compile(
    r"\b(video|animation|animated|clip|movie|mp4|mov|gif)\b|(?:影片|视频|動畫|动画|短片)",
    re.IGNORECASE,
)


def resolve_mm_understand_task(mime: str, *, fallback: str = "x2t_image") -> str:
    """Pick understand task from attachment MIME (image → x2t_image, video → x2t_video)."""
    m = (mime or "").strip().lower()
    if m.startswith("video/"):
        return "x2t_video"
    if m.startswith("image/"):
        return "x2t_image"
    fb = (fallback or "x2t_image").strip()
    return fb if fb in UNDERSTAND_TASKS else "x2t_image"


def resolve_mm_generate_task(prompt: str, *, fallback: str = "t2i") -> str:
    """Pick generate task from user prompt (video intent → t2v, else t2i)."""
    if _VIDEO_HINT_RE.search(prompt or ""):
        return "t2v"
    fb = (fallback or "t2i").strip()
    return fb if fb in GENERATE_TASKS else "t2i"


def resolve_mm_edit_task(mime: str, *, fallback: str = "image_edit") -> str:
    """Pick edit task from source attachment MIME (video → video_edit, image → image_edit)."""
    m = (mime or "").strip().lower()
    if m.startswith("video/"):
        return "video_edit"
    if m.startswith("image/"):
        return "image_edit"
    fb = (fallback or "image_edit").strip()
    return fb if fb in EDIT_TASKS else "image_edit"
