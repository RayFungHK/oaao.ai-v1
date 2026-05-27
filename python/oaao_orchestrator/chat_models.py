"""W5-S1 phase 8 — Chat ingress Pydantic models.

Extracted from ``app.py`` so ``routes/chat.py`` and ``run_executor.py`` can
import them without re-importing from ``app.py`` (which previously caused a
lazy import cycle inside ``execute_chat_run``).

Models:
- ``ChatProfilePayload`` — chat profile descriptor forwarded by PHP.
- ``VaultSourceRef`` — structured vault retrieval scope from the chat composer.
- ``ChatRunRequest`` — full ingress payload for ``/v1/runs/chat``.

Re-exported from ``oaao_orchestrator.app`` for back-compat.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from oaao_orchestrator.routes._shared_models import EndpointPayload


class ChatProfilePayload(BaseModel):
    id: int = 0
    name: str = ""
    type: str = "single"


class VaultSourceRef(BaseModel):
    """Structured chat retrieval scope forwarded from SPA ({@code vault_source_refs})."""

    kind: Literal["vault", "folder", "document"]
    id: int = Field(ge=1)
    vault_id: int = Field(ge=1)
    name: str = ""


class ChatRunRequest(BaseModel):
    """
    Ingress from PHP — mirrors ``RunContext`` + resolved rows (no plaintext API keys).

    **Bootstrap contract:** all MDM for this run must arrive in this payload; the sidecar must not
    call PHP for vault profiles, endpoints, or scope during execution (see ``php_boundary``).
    """

    conversation_id: str | None = None
    user_id: str | None = None
    purpose_id: str = "chat"
    mode_id: str = "default"
    planner_mode_id: str = Field(
        default="default",
        description="Planner expansion mode — default | tot | ddtree (distinct from desk/default UI mode_id).",
    )
    messages: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = 0.7
    max_tokens: int | None = Field(
        default=None,
        ge=1,
        le=128_000,
        description="Chat completion max_tokens — from profile/endpoint config_json or OAAO_CHAT_MAX_TOKENS.",
    )
    endpoint: EndpointPayload
    chat_profile: ChatProfilePayload = Field(default_factory=ChatProfilePayload)
    assistant_message_id: str | None = None
    vault_source_ids: list[int] = Field(default_factory=list)
    vault_source_refs: list[VaultSourceRef] = Field(default_factory=list)
    vault_auto_rag: bool = False
    workspace_id: int | None = None
    vault_retrieval_profiles: list[dict[str, Any]] = Field(default_factory=list)
    vault_scope_documents: dict[str, list[int]] = Field(
        default_factory=dict,
        description="Per-vault document id allow-list from chat composer refs (string vault_id keys).",
    )
    vault_document_catalog: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description='Citation labels keyed "{vault_id}:{document_id}" — file_name, vault_name, path.',
    )
    vault_rag: dict[str, Any] | None = Field(
        default=None,
        description="Retrieval tuning from Settings → RAG (qdrant_limit, min_score, boosts, …).",
    )
    tenant_id: int | None = None
    endpoint_id: int | None = Field(default=None, ge=1)
    chat_endpoint_id: int | None = Field(default=None, ge=1)
    purpose_key: str | None = None
    embedding: dict[str, Any] | None = None
    rerank: dict[str, Any] | None = None
    chat_attachments: list[dict[str, Any]] = Field(default_factory=list)
    asr: dict[str, Any] | None = None
    polish: dict[str, Any] | None = None
    glossary: dict[str, Any] | None = None
    uiqe: dict[str, Any] | None = Field(
        default=None,
        description="Resolved uiqe.* purpose for post-stream IQS/ACCS workers.",
    )
    planner: dict[str, Any] | None = Field(
        default=None,
        description="Resolved planning.* purpose for task planner LLM (Settings → Task planner).",
    )
    allowed_agents: list[str] = Field(
        default_factory=list,
        description="Agent kinds permitted this run (sandbox_code, slides, …) — drives planner abilities.",
    )
    agent_catalog: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Planner hints per agent_kind from PHP PlannerAgentRegister (name, description, planner_hint).",
    )
    run_planner_mode: str | None = Field(
        default=None,
        description="llm | stub — from Settings → Task planner (planning.* meta); env fallback when omitted.",
    )
    slide_designer: dict[str, Any] | None = Field(
        default=None,
        description="Slide project storage root, resume/continuation — from PHP send.",
    )
    conversation_materials: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Recent slide projects + file materials for planner context (SD-5).",
    )
    conversation_material_grounding: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Prior-turn material bodies (vault RAG brief, deck_outline.md, …) for regenerate/retry.",
    )
    reuse_grounding_message_id: int | None = Field(
        default=None,
        description="Assistant message id — load materials indexed from that turn (retry/regenerate).",
    )
    skills_catalog: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Micro skills catalog — bound_template, conversation, … from PHP MicroSkillCatalog.",
    )
    tool_servers: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Registered OpenAPI tool servers from PHP tool_server.register.",
    )
    hot_plug_skills: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Admin hot-plug skills manifest from PHP SkillsManifestStorage.",
    )
    openai_tools: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Pre-resolved OpenAI tools[] merged at LLM stream time.",
    )
    run_principal: str | None = Field(
        default=None,
        description="HMAC-signed run identity from PHP send — validates user/conversation/message for the whole run.",
    )
    user_personalization: dict[str, Any] | None = Field(
        default=None,
        description="User profile, knowledge, timezone, and region from Preferences → Personalization.",
    )
    mm_understand: dict[str, Any] | None = Field(
        default=None,
        description="Resolved mm.understand.* purpose for attachment vision / caption.",
    )
    mm_generate: dict[str, Any] | None = Field(
        default=None,
        description="Resolved mm.generate.* purpose for image/video generation agents.",
    )
    mm_edit: dict[str, Any] | None = Field(
        default=None,
        description="Resolved mm.edit.* purpose for image/video edit agents.",
    )
    is_new_conversation: bool = Field(
        default=False,
        description="True when PHP just created this conversation row — enables auto-title.",
    )
