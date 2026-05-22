from __future__ import annotations

from pydantic import BaseModel, Field, PositiveInt


class EndpointSnapshot(BaseModel):
    """Resolved upstream binding — mirrors DB ``oaao_endpoint`` row subset (no secrets in plaintext logs)."""

    endpoint_ref: str = ""
    base_url: str | None = None
    model: str | None = None
    api_key_env: str | None = Field(default=None, description="Env var name holding secret ref")


class QueueJobPayload(BaseModel):
    """Single queued unit — executed by worker pool after LLM stream ends."""

    plugin_id: str
    prompt_material_ref: str = ""
    endpoint: EndpointSnapshot = Field(default_factory=EndpointSnapshot)
    plugin_ctx_meta: dict = Field(default_factory=dict)


class QueuePoolSettings(BaseModel):
    """Loaded from JSON — one pool isolates worker concurrency & polling."""

    pool_id: str = "default_post_stream"
    worker_number: PositiveInt = Field(default=2, description="Concurrent asyncio/RQ workers for this pool")
    poll_interval_seconds: PositiveFloat = Field(default=0.25)
    purpose_id: str = "default_chat"
    mode_id: str = Field(default="default", description="Mode hooks unrelated to queue — copied into PluginContext")
    prompt_bundle_ref: str = ""
    endpoint: EndpointSnapshot = Field(default_factory=EndpointSnapshot)
    plugins_after_stream: list[str] = Field(
        default_factory=lambda: ["iqs", "accs"],
        description="Ordered plugin_ids registered in plugins/registry.py",
    )
