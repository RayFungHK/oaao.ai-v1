"""W7-S1 — Cross-tier contract schema loader.

Lightweight, no hard dependency on jsonschema (so the orchestrator can boot
without the dev tool installed). When `jsonschema` is available, `validate`
performs full Draft-2020-12 validation. Otherwise it falls back to a minimal
structural check (presence of `required` keys at the top level).

Schemas live at `contracts/v<n>/<name>.json` at the repo root.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
_CONTRACTS_DIR = _REPO_ROOT / "contracts"


class ContractSchemaError(Exception):
    """Raised when a schema cannot be loaded."""


class ContractValidationError(Exception):
    """Raised when a payload fails validation against its contract."""


@lru_cache(maxsize=32)
def load_schema(name: str, version: str = "v1") -> dict[str, Any]:
    """Load and cache a schema by short name (without .json)."""
    path = _CONTRACTS_DIR / version / f"{name}.json"
    if not path.exists():
        raise ContractSchemaError(f"schema not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractSchemaError(f"schema {path} is not valid JSON: {exc}") from exc


def list_schemas(version: str = "v1") -> list[str]:
    d = _CONTRACTS_DIR / version
    if not d.exists():
        return []
    return sorted(p.stem for p in d.glob("*.json"))


def validate(payload: Any, schema: dict[str, Any]) -> None:
    """Validate `payload` against `schema`.

    Falls back to a minimal `required` check if jsonschema is not installed —
    runtime callers still get *some* enforcement; CI installs jsonschema for
    full validation.
    """
    try:
        import jsonschema  # type: ignore[import-untyped]
    except ImportError:
        _fallback_validate(payload, schema)
        return
    try:
        jsonschema.validate(payload, schema)
    except jsonschema.ValidationError as exc:
        raise ContractValidationError(str(exc)) from exc


def _fallback_validate(payload: Any, schema: dict[str, Any]) -> None:
    if schema.get("type") == "object":
        if not isinstance(payload, dict):
            raise ContractValidationError(f"expected object, got {type(payload).__name__}")
        for key in schema.get("required", []):
            if key not in payload:
                raise ContractValidationError(f"missing required field: {key}")
