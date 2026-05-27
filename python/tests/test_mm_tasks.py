"""Tests for multimodal task resolution."""

from oaao_orchestrator.media.mm_tasks import (
    resolve_mm_edit_task,
    resolve_mm_generate_task,
    resolve_mm_understand_task,
)


def test_resolve_mm_understand_task_image():
    assert resolve_mm_understand_task("image/png") == "x2t_image"
    assert resolve_mm_understand_task("IMAGE/JPEG") == "x2t_image"


def test_resolve_mm_understand_task_video():
    assert resolve_mm_understand_task("video/mp4") == "x2t_video"


def test_resolve_mm_understand_task_fallback():
    assert resolve_mm_understand_task("application/pdf", fallback="x2t_video") == "x2t_video"
    assert resolve_mm_understand_task("", fallback="x2t_image") == "x2t_image"
    assert resolve_mm_understand_task("text/plain", fallback="invalid") == "x2t_image"


def test_resolve_mm_generate_task_image_default():
    assert resolve_mm_generate_task("draw a cat") == "t2i"


def test_resolve_mm_generate_task_video_hint():
    assert resolve_mm_generate_task("generate a short video of waves") == "t2v"
    assert resolve_mm_generate_task("幫我生成一段動畫") == "t2v"


def test_resolve_mm_generate_task_fallback():
    assert resolve_mm_generate_task("", fallback="t2v") == "t2v"
    assert resolve_mm_generate_task("hello", fallback="invalid") == "t2i"


def test_resolve_mm_edit_task_by_mime():
    assert resolve_mm_edit_task("image/png") == "image_edit"
    assert resolve_mm_edit_task("video/mp4") == "video_edit"


def test_resolve_mm_edit_task_fallback():
    assert resolve_mm_edit_task("application/pdf", fallback="video_edit") == "video_edit"
    assert resolve_mm_edit_task("", fallback="invalid") == "image_edit"
