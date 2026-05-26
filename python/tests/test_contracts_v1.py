"""W7-S1 — Cross-tier contract schema tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from oaao_orchestrator.contracts import (
    ContractValidationError,
    list_schemas,
    load_schema,
    validate,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]

try:
    import jsonschema

    _HAVE_JSONSCHEMA = True
except ImportError:
    _HAVE_JSONSCHEMA = False

_requires_jsonschema = pytest.mark.skipif(
    not _HAVE_JSONSCHEMA,
    reason="jsonschema not installed — fallback validator only checks 'required'",
)


def test_v1_schemas_present():
    names = list_schemas("v1")
    assert "error" in names
    assert "chat-run.request" in names
    assert "vault-job.envelope" in names


def test_every_schema_parses_as_draft_2020_12():
    for name in list_schemas("v1"):
        schema = load_schema(name)
        assert schema["$schema"].endswith("/draft/2020-12/schema"), name
        assert schema.get("$id", "").startswith("https://oaao.ai/schemas/v1/"), name


def test_error_envelope_validates_for_well_formed_payload():
    schema = load_schema("error")
    validate(
        {"ok": False, "error": {"code": "OAAO_E_AUTH_INVALID", "detail": "bad token"}},
        schema,
    )


@_requires_jsonschema
def test_error_envelope_rejects_missing_code():
    schema = load_schema("error")
    with pytest.raises(ContractValidationError):
        validate({"ok": False, "error": {}}, schema)


def test_chat_run_request_minimum():
    schema = load_schema("chat-run.request")
    validate(
        {
            "protocol_version": "1",
            "endpoint": {"base_url": "https://api.example.com", "model": "gpt-x"},
            "user_message": "hello",
        },
        schema,
    )


@_requires_jsonschema
def test_chat_run_request_rejects_unknown_protocol_version():
    schema = load_schema("chat-run.request")
    with pytest.raises(ContractValidationError):
        validate(
            {
                "protocol_version": "999",
                "endpoint": {"base_url": "https://api.example.com", "model": "gpt-x"},
                "user_message": "hi",
            },
            schema,
        )


def test_vault_job_envelope_accepts_known_kinds():
    schema = load_schema("vault-job.envelope")
    validate(
        {
            "protocol_version": "1",
            "job_id": "j-1",
            "kind": "embed",
            "status": "pending",
        },
        schema,
    )


@_requires_jsonschema
def test_vault_job_envelope_rejects_unknown_kind():
    schema = load_schema("vault-job.envelope")
    with pytest.raises(ContractValidationError):
        validate(
            {
                "protocol_version": "1",
                "job_id": "j-1",
                "kind": "totally-new-kind",
                "status": "pending",
            },
            schema,
        )


def test_error_code_list_matches_python_enum():
    """Cross-tier guard — every code in `errors.py` must be expressible via the
    error envelope schema (i.e. match the pattern)."""
    import re

    from oaao_orchestrator.errors import OAAOErrorCode

    schema = load_schema("error")
    pattern = schema["properties"]["error"]["properties"]["code"]["pattern"]
    regex = re.compile(pattern)
    for code in OAAOErrorCode:
        assert regex.match(code.value), f"{code.value} fails contract pattern"


def test_php_mirror_reads_same_json_files():
    """W7-S1 — PHP backbone must be able to load v1/error.json from disk."""
    path = _REPO_ROOT / "contracts" / "v1" / "error.json"
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["$id"].endswith("/v1/error.json")
