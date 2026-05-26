"""W4-S2 — errors module contract tests."""

from __future__ import annotations

import pytest
from oaao_orchestrator.errors import OAAOError, OAAOErrorCode, http_status_for, ws_close_for


def test_codes_are_stable_strings():
    # Stability matters across versions. If you change a value, you have made a
    # breaking API change.
    assert OAAOErrorCode.AUTH_INVALID.value == "OAAO_E_AUTH_INVALID"
    assert OAAOErrorCode.SECRET_MISSING.value == "OAAO_E_SECRET_MISSING"
    assert OAAOErrorCode.RUN_TIMEOUT.value == "OAAO_E_RUN_TIMEOUT"


def test_http_status_defaults():
    assert http_status_for(OAAOErrorCode.AUTH_INVALID) == 401
    assert http_status_for(OAAOErrorCode.RESOURCE_NOT_FOUND) == 404
    assert http_status_for(OAAOErrorCode.RUN_TIMEOUT) == 504
    assert http_status_for(OAAOErrorCode.INPUT_TOO_LARGE) == 413


def test_ws_close_codes():
    assert ws_close_for(OAAOErrorCode.AUTH_INVALID) == 4401
    assert ws_close_for(OAAOErrorCode.RESOURCE_NOT_FOUND) == 4404
    # Not every code maps to a WS close — that's intentional.
    assert ws_close_for(OAAOErrorCode.NOT_IMPLEMENTED) is None


def test_payload_shape_minimal():
    err = OAAOError(OAAOErrorCode.AUTH_INVALID)
    assert err.to_payload() == {
        "ok": False,
        "error": {"code": "OAAO_E_AUTH_INVALID"},
    }


def test_payload_shape_with_detail_and_cause():
    err = OAAOError(
        OAAOErrorCode.UPSTREAM_FAILED,
        detail="provider returned 500",
        cause="connection reset",
    )
    payload = err.to_payload()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "OAAO_E_UPSTREAM_FAILED"
    assert payload["error"]["detail"] == "provider returned 500"
    assert payload["error"]["cause"] == "connection reset"


def test_error_is_exception():
    with pytest.raises(OAAOError) as ei:
        raise OAAOError(OAAOErrorCode.RUN_TIMEOUT, detail="3.0s exceeded")
    assert ei.value.code == OAAOErrorCode.RUN_TIMEOUT
    assert ei.value.http_status == 504


def test_php_mirror_codes_match():
    """W4-S2 cross-language contract — PHP must mirror every Python code."""
    import re
    from pathlib import Path

    php_path = (
        Path(__file__).resolve().parents[2]
        / "backbone"
        / "sites"
        / "oaaoai"
        / "oaaoai"
        / "core"
        / "default"
        / "library"
        / "OaaoErrorCode.php"
    )
    if not php_path.exists():
        pytest.skip("PHP mirror not present in this checkout")
    php_text = php_path.read_text(encoding="utf-8")
    php_codes = set(re.findall(r"'(OAAO_E_[A-Z_]+)'", php_text))
    py_codes = {c.value for c in OAAOErrorCode}
    missing_in_php = py_codes - php_codes
    extra_in_php = php_codes - py_codes
    assert not missing_in_php, f"PHP mirror missing codes: {missing_in_php}"
    assert not extra_in_php, f"PHP mirror has unknown codes: {extra_in_php}"
