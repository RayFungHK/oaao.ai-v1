"""Pydantic models for post-stream worker LLM JSON output."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class IqsScoreResult(BaseModel):
    """Input Quality Score — dimensions 0–1, overall iqs 0–1."""

    iqs: float = Field(ge=0.0, le=1.0)
    dimensions: dict[str, float] = Field(default_factory=dict)
    reasons: dict[str, str] = Field(default_factory=dict)

    @field_validator("dimensions")
    @classmethod
    def _clamp_dims(cls, v: dict[str, float]) -> dict[str, float]:
        out: dict[str, float] = {}
        for k, raw in v.items():
            try:
                out[str(k)] = max(0.0, min(1.0, float(raw)))
            except (TypeError, ValueError):
                continue
        return out


class AccsScoreResult(BaseModel):
    """Answer / completion coherence score."""

    accs: float = Field(ge=0.0, le=1.0)
    dimensions: dict[str, float] = Field(default_factory=dict)
    reasons: dict[str, str] = Field(default_factory=dict)

    @field_validator("dimensions")
    @classmethod
    def _clamp_dims(cls, v: dict[str, float]) -> dict[str, float]:
        out: dict[str, float] = {}
        for k, raw in v.items():
            try:
                out[str(k)] = max(0.0, min(1.0, float(raw)))
            except (TypeError, ValueError):
                continue
        return out


def parse_plugin_score(plugin_id: str, raw: Any) -> IqsScoreResult | AccsScoreResult | None:
    if not isinstance(raw, dict):
        return None
    try:
        if plugin_id == "iqs":
            return IqsScoreResult.model_validate(raw)
        if plugin_id == "accs":
            return AccsScoreResult.model_validate(raw)
    except Exception:  # noqa: BLE001
        return None
    return None
