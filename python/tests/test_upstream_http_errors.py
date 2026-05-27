"""Upstream HTTP error summarization for SSE clients."""

from oaao_orchestrator.chat_helpers import upstream_http_error_payload


def test_cloudflare_502_html_is_summarized() -> None:
    raw = """<!DOCTYPE html><html><head><title>rayfung.hk | 502: Bad gateway</title></head><body>cloudflare</body></html>"""
    out = upstream_http_error_payload(
        502,
        raw,
        endpoint_base_url="http://gemma-4-26b-a4b-it.rayfung.hk",
        endpoint_ref="Gemma 4 26B",
        endpoint_model="google/gemma-4-26B-A4B-it",
    )
    assert "502" in out["body"]
    assert "Cloudflare" in out["body"]
    assert "Gemma 4 26B" in out["body"]
    assert "<!DOCTYPE" not in out["body"]
    assert out.get("endpoint_host") == "gemma-4-26b-a4b-it.rayfung.hk"


def test_json_error_body_preserved_sanitized() -> None:
    out = upstream_http_error_payload(400, '{"error":"bad model"}')
    assert "bad model" in out["body"]
