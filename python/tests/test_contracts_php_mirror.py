"""W7-S2 — PHP-facing contract fixtures must validate against contracts/v1/*.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from oaao_orchestrator.contracts import ContractValidationError, load_schema, validate

_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "contracts_v1"

try:
    import jsonschema  # noqa: F401

    _HAVE_JSONSCHEMA = True
except ImportError:
    _HAVE_JSONSCHEMA = False

pytestmark = pytest.mark.skipif(
    not _HAVE_JSONSCHEMA,
    reason="jsonschema required for W7-S2 contract gate",
)


@pytest.mark.parametrize(
    ("fixture_name", "schema_name"),
    [
        ("error.min.json", "error"),
        ("chat-run.request.min.json", "chat-run.request"),
        ("vault-job.envelope.min.json", "vault-job.envelope"),
    ],
)
def test_php_mirror_fixture_validates(fixture_name: str, schema_name: str) -> None:
    path = _FIXTURES / fixture_name
    assert path.is_file(), f"missing fixture {path}"
    payload = json.loads(path.read_text(encoding="utf-8"))
    schema = load_schema(schema_name)
    validate(payload, schema)


def test_php_mirror_fixture_rejects_bad_error_code() -> None:
    schema = load_schema("error")
    with pytest.raises(ContractValidationError):
        validate({"ok": False, "error": {"code": "NOT_A_REAL_CODE"}}, schema)
