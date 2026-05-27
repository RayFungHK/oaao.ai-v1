"""W12-S2 follow-up — serve versioned JSON Schemas from repo ``contracts/v1/``."""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(tags=["contracts"])

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCHEMA_DIR = _REPO_ROOT / "contracts" / "v1"
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")


@router.get("/contracts/v1/{schema_name}")
async def get_contract_schema(schema_name: str) -> JSONResponse:
    name = (schema_name or "").strip()
    if not name or not _NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="invalid_schema_name")
    path = _SCHEMA_DIR / f"{name}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="schema_not_found")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="schema_invalid_json") from exc
    return JSONResponse(content=payload, media_type="application/schema+json")
