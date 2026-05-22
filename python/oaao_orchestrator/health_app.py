"""Minimal FastAPI app for CI smoke (/health only)."""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="oaao orchestrator health", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, bool | str]:
    return {"ok": True, "service": "oaao_orchestrator"}
