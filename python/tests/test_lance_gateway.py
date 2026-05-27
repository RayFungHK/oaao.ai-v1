"""Tests for Lance Gateway unified client."""

from __future__ import annotations

from oaao_orchestrator.media.lance_gateway import (
    GATEWAY_TASK_PATHS,
    build_gateway_body,
    normalize_gateway_response,
)


def test_gateway_task_paths_cover_six_apis() -> None:
    assert set(GATEWAY_TASK_PATHS.keys()) == {
        "t2i",
        "t2v",
        "x2t_image",
        "x2t_video",
        "image_edit",
        "video_edit",
    }
    assert GATEWAY_TASK_PATHS["t2i"] == "/v1/t2i"
    assert GATEWAY_TASK_PATHS["x2t_image"] == "/v1/i2t"


def test_build_gateway_body_t2i_resolution() -> None:
    body = build_gateway_body("t2i", {"prompt": "a cat", "resolution": "2k"})
    assert body["prompt"] == "a cat"
    assert body["resolution"] == "2k"
    assert body["video_width"] == 2048
    assert body["video_height"] == 2048


def test_normalize_gateway_response_output_url() -> None:
    out = normalize_gateway_response(
        "t2i",
        {
            "job_id": "abc",
            "output_url": "http://localhost/files/abc/out.png",
            "artifacts": [{"name": "000000.png", "url": "http://localhost/files/abc/000000.png"}],
        },
    )
    assert out["ok"] is True
    assert out["image_url"] == "http://localhost/files/abc/out.png"
    assert out["job_id"] == "abc"
