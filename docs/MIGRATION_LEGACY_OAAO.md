# Migration Guide — Legacy **oaao.ai-old** → **oaao.ai-v1**

This document analyses the legacy monorepo (**`../oaao.ai-old/oaao.ai`**, referred to below as **Legacy**) and maps product capabilities to the new distributor (**oaao.ai-v1** / **`backbone/sites/oaaoai`**). It also records the architectural shift **Go + Python → Python-first orchestrator**, with an explicit seam for a future **Go streaming gateway** should you reintroduce it.

Authoritative legacy references:

- `oaao.ai-old/oaao.ai/docs/ARCHITECTURE.md` — full stack narrative (PHP shell / Go hands / Python brain).
- `oaao.ai-old/oaao.ai/gateway/ARCHITECTURE.md` — gateway responsibilities and HTTP catalogue pointers.
- `oaao.ai-old/oaao.ai/proto/hub.proto` — versioned gRPC contract (`CONTRACT_VERSION` 2).
- `oaao.ai-old/oaao.ai/src/llm.js` — browser streaming contract (`/worker/prepare`, `/worker/stream/{fp}`).

---

## 1. Executive summary

| Dimension | Legacy (**oaao.ai-old**) | New (**oaao.ai-v1**) — direction |
|-----------|-------------------------|-------------------------------------|
| Web | Razy PHP modules under `web/sites/oaao/oaao/*` | Razy PHP under `backbone/sites/oaaoai/oaaoai/*` |
| Streaming | **Go gateway** owns SSE + LLM HTTP; **Python sidecar** via **gRPC** | **FastAPI** (`python/oaao_orchestrator`) owns SSE + LLM HTTP for baseline chat |
| Brain | `oaao_brain/` + `sidecar.py` (large surface) | Slim `oaao_orchestrator` + incremental port of pipelines |
| DB | Shared SQLite volume + Postgres migration path + Qdrant + optional Arango | PostgreSQL canonical + adjunct SQLite (chat); DDL for vault already present in v1 installers |
| Frontend | Vite SPA in `oaao.ai-old/oaao.ai/src/` | `core/vite` SPA + workspace chat shell (`chat-panel.js`) |

**Goal:** Preserve **product semantics** (vault, library, RAG, planner, ASR, attachments, quality scores) while **collapsing the streaming tier into Python** for simpler ops, then **optionally** replace the Python streaming hot path with Go behind a **stable internal interface** (Section 6).

---

## 2. Legacy architecture (three tiers)

Legacy docs define a strict split:

| Tier | Role | Key artefacts |
|------|------|----------------|
| **PHP** | Auth, CRUD, validation, authoritative DB state | `web/sites/oaao/oaao/{auth,conversations,vaults,endpoints,chatendpoints,library,i18n,app}` |
| **Go gateway** | SSE, LLM HTTP streaming, worker/stream registries, thin proxies | `gateway/` (`handler_*`, `executor`, `llm`, `stream`, `worker`, optional Redis) |
| **Python** | Pipelines, RAG, grounding, planner, tools, embeddings | `sidecar.py`, `oaao_brain/`, `rag/` shim |

**Browser chat flow (Legacy)** — see `src/llm.js`:

1. `POST {gateway}/worker/prepare` — Python prepares messages + registers worker → returns **`fingerprint`** + **`stream_token`**.
2. `GET {gateway}/worker/stream/{fp}?token=…` — **Go** streams SSE events to the browser.
3. On completion, Go invokes Python **`StreamComplete`** (gRPC) → Python persists assistant content via PHP/backend relay.

**Important invariant:** Legacy **does not** expose Python SSE directly to browsers for chat; Go terminates long-lived HTTP streaming.

---

## 3. Legacy feature inventory (complete checklist)

The following is consolidated from **`docs/ARCHITECTURE.md`**, **`hub.proto` RPC surface**, and **PHP lazy routes**. Use it as a **parity checklist** for v1.

### 3.1 Product surfaces (user-visible)

| Feature | Legacy description | Primary implementation hints |
|---------|-------------------|------------------------------|
| **Chat** | Conversational assistant, endpoint presets | `src/llm.js`, `gateway/internal/handler/handler_chat.go`, Python chat pipelines |
| **Chat endpoints** | single / ToT / DDTree / planner modes | `chatendpoints` PHP module; Python `oaao_chat_endpoint` semantics |
| **RAG over vaults** | Retrieve → optional rerank → generate | `oaao_brain/pipelines/rag/*`, `PrepareStream` payload (`vault_ids`, references) |
| **Web search** | Optional live web snippets (e.g. Tavily) | Pipeline flags / params (`web_search` in prepare body — see bundled SPA) |
| **Deep thinking** | Preserves full judge synthesis vs fast path | ToT / `deep_thinking` params (Legacy SPA + sidecar) |
| **Planner + task list** | Task-list protocol: Plan → execute → ReportResult | gRPC `Plan`, `ReportResult`, `ExecTool`; Go `executor` |
| **Post-turn quality** | IQS / ACCS / `aiqs_v2` SSE frames | Python telemetry pipelines; Go forwards SSE |
| **Library (Soft-RAG)** | Block editor docs, Qdrant `library_{owner}`, delta commits | `library` PHP proxies → Go → Python Library gRPC |
| **Vault (Hard-RAG)** | Documents, containers, embed status, graph mode | `vaults` PHP API; Python embed/search; Qdrant; optional Arango GraphRAG |
| **ASR** | Chunked transcribe + session end | `hub.proto` `ASRTranscribe*` RPCs |
| **Composer attachments** | Upload → inject plaintext into prepare | `POST /library/upload` + `library_chat_attachments` in prepare params (`src/state/index.js`) |
| **Workflow / Corpus / Function** | Extended automation surfaces | `WorkflowExecute`, `CorpusAnalyze`, `FunctionExecute`, etc. in `hub.proto` |
| **Skills search** | Registry-assisted retrieval | `SkillsSearch` RPC |
| **i18n** | Locale packs | `i18n` PHP module |
| **PWA** | Installable shell | `public/`, `sw.js`, manifests (Legacy) |

### 3.2 gRPC Hub service (Legacy contract overview)

From `proto/hub.proto` (`service Hub`), non-exhaustive but migration-relevant:

| Area | RPCs (examples) |
|------|-----------------|
| Task-list chat | `Plan`, `ReportResult`, `ExecTool` |
| Worker streaming | `PrepareStream` (server-streaming events), `StreamComplete`, `StopStream` |
| Ops | `PushConfig`, `Ping` |
| Vault / RAG | `VaultEmbed`, `VaultSearch`, `VaultDelete`, `VaultPurge`, `VaultSummarize` |
| Skills | `SkillsSearch` |
| Workflow / corpus | `WorkflowExecute`, `CorpusAnalyze`, `CorpusGenerate` |
| ASR | `ASRTranscribe`, `ASRTranscribeChunk`, `ASRSessionEnd` |
| Library | `LibraryUploadDocument`, `LibraryCreateDocument`, `LibraryListDocuments`, `LibraryReadDocument`, `LibrarySearch`, `LibraryCommitVersion`, `LibraryCommitDelta`, `LibraryFinalizeToVault`, … |

### 3.3 Legacy PHP HTTP modules (shell)

| Module | Responsibility |
|--------|----------------|
| `auth` | Sessions, users |
| `conversations` | Threads CRUD, share, feedback, `update_last_assistant`, suggestions |
| `endpoints` | LLM endpoint CRUD |
| `chatendpoints` | Chat profile CRUD (`/my` for workspace) |
| `vaults` | Vault/container/document CRUD, upload, RAG status, graph rebuild hooks |
| `library` | Proxies to gateway `/library/*` for DocEdit |
| `i18n` | Language packs |
| `app` | SPA shell |

---

## 4. New (**oaao.ai-v1**) baseline — what exists today

| Area | Status | Notes |
|------|--------|------|
| Auth + PostgreSQL canonical | ✅ | `oaaoai/auth` |
| Endpoints + purposes (admin) | ✅ | `oaaoai/endpoints` |
| Chat completion profiles | ✅ | `oaaoai/chat` + `oaao_chat_endpoint*` |
| Adjunct SQLite chat persistence | ✅ | conversations/messages |
| Orchestrator HTTP | ✅ **partial** | `POST /v1/runs/chat`, `GET /v1/stream` — token-gated SSE |
| Assistant persistence after stream | ✅ **partial** | `POST /chat/api/assistant_patch` |
| SSE via PHP | ❌ **forbidden by design** | See `.cursor/rules/rayfung-razy-stack.mdc` |
| Vault module / Library module | ❌ | DDL pieces exist in installers; no full PHP module parity |
| Task-list Plan/Report | ❌ | No gRPC/executor equivalent yet |
| RAG retrieve in orchestrator | ❌ | Phase vocabulary exists (`PHASE_RAG`); chat path does not retrieve |
| ASR | ❌ | Purpose slot `pa-asr` registered; no service |
| Composer attachments | ❌ | UI stubs disabled (`workspace_panel.tpl`) |

---

## 5. Migration schemes (feature → recommended v1 approach)

For each legacy capability, pick one of:

- **A. PHP-only** — business rules + CRUD; JSON APIs; no streaming.
- **B. Python orchestrator** — streaming + heavy orchestration; PHP persists authoritative rows.
- **C. External service** — Qdrant, Arango, ASR provider; orchestrator calls via drivers.
- **D. Deferred / optional Go gateway** — re-home only transport (SSE + LLM HTTP) behind interface (Section 6).

| Legacy capability | v1 scheme | Steps |
|------------------|-----------|------|
| **Worker prepare + SSE** | **B** now; **D** optional later | Already: PHP resolves endpoint → JSON → FastAPI → SSE. Later: same JSON contract implemented by Go worker behind adapter. |
| **StreamComplete → assistant row** | **A + B** | Today: browser **`assistant_patch`**. Legacy: Go→Python→PHP. Consider server-side finalize RPC when you need tamper-proof persistence without trusting the browser. |
| **ToT / DDTree / planner** | **B** | Port `oaao_brain/pipelines/chat/*` stages incrementally; emit `StreamEnvelope` phases matching legacy SSE event names where feasible. |
| **Task pipeline (Manus-style)** | **B** | See **`backbone/sites/oaaoai/oaaoai/docs/backlog/chat-task-pipeline.md`** — Run Task → Agent → Agent Tasks, single `oaao.stream`, hooks for sandbox/slides/image. |
| **Vault CRUD** | **A** first | Port `vaults` PHP module routes to `oaaoai/vaults` (new module) using existing DDL in v1 installers; keep ACL in PHP. |
| **Embedding / Qdrant** | **C + B** | Background jobs (Python asyncio queue / Celery later): ingest from PHP-uploaded storage paths; update `embed_status` like Legacy. |
| **Library DocEdit** | **B** (or **D**) | Reimplement Library gRPC handlers as FastAPI routers **or** temporary thin proxy to a extracted Python package from Legacy. |
| **RAG probe / rebuild_graph** | **B** | Legacy internal HTTP (`/v1/rebuild_graph`, `/v1/rag_probe`) → FastAPI equivalents + shared secret. |
| **ASR** | **C + B** | New FastAPI routes wrapping Whisper/etc.; PHP saves transcript messages; composer enables mic button. |
| **Web search** | **B** | Port heuristic + Tavily client from Legacy brain into orchestrator hook stage; gate with feature flag. |
| **IQS / ACCS / aiqs_v2** | **B** | Align with existing `python/oaao_orchestrator` post-stream plugin stubs (`iqs`, `accs`). |
| **Redis stream mirror** | **D / infra** | Legacy gateway optional Redis for multi-instance stream registry; v1 in-memory registry → add Redis when scaling horizontally. |

---

## 6. Go + Python → **pure Python**, with a future **Go port**

### 6.1 Why collapse tiers

- Single deployable for orchestration reduces **gRPC + dual HTTP** operational overhead.
- v1 already adopts **FastAPI SSE** (`oaao_orchestrator/app.py`) matching the **forbidden PHP SSE** rule while avoiding Go maintenance for MVP.

### 6.2 Preserve a stable seam for Go (recommended abstraction)

Introduce an internal **transport interface** in Python (conceptual — implement when needed):

```text
StreamingTransport (abstract)
  prepare_run(ctx) -> RunTicket(run_id, stream_token, stream_base_url)
  execute_llm_stream(ctx, messages, ...) -> AsyncIterator[StreamChunk]
  on_complete(ctx, final_text, usage) -> None
```

Implementations:

| Impl | When |
|------|------|
| `FastApiTransport` | **Now** — current `httpx` stream + `StreamSessionRegistry`. |
| `GoGatewayTransport` | **Later** — POST prepare to Go, subscribe SSE from Go, callbacks to Python for `StreamComplete` parity. |

**Rule:** PHP and browser should only depend on **`stream_url` + `run_id` + `token`**, not on whether the executor is Python or Go. Environment switches **`OAAO_STREAMING_BACKEND=python|go`** pick the adapter.

### 6.3 Contract mapping (Legacy → v1 minimal parity)

| Legacy | v1 analogue |
|--------|-------------|
| `PrepareStream` / worker prepare | `POST /v1/runs/chat` (internal auth header) |
| `GET /worker/stream/{fp}?token=` | `GET /v1/stream?run_id=&token=&since_seq=` |
| `StreamComplete` (assistant save) | **`assistant_patch`** (today) — evolve toward signed server callback |
| `Plan` / `ReportResult` task-list | **future** `/v1/runs/plan` loop or reuse `Pipeline` model in Python |
| `VaultSearch` / embed | **future** orchestrator tools calling Qdrant drivers |
| `hub.proto` additive fields | Prefer **JSON envelope versioning** (`prepare_schema_version`) on POST bodies |

---

## 7. Suggested migration phases

### Phase 0 — Contracts frozen

- Document **public** orchestrator URLs (`/v1/runs/chat`, `/v1/stream`) as stable for SPA.
- Keep **secrets** on orchestrator process env (`OPENAI_API_KEY`, optional provider keys).

### Phase 1 — Chat parity (conversation core)

- ✅ Baseline streaming + SQLite messages (done path).
- Add **server-side finalization** option (replace sole reliance on browser `assistant_patch` for high-trust deployments).

### Phase 2 — Attachments + ASR (input modalities)

- Enable composer upload → store blob + metadata (adjunct or canonical per policy).
- Extend prepare payload with `attachment_refs[]`.
- ASR: streaming transcript endpoint → insert user message chunks.

### Phase 3 — Vault + RAG

- Port Legacy vault PHP APIs to `oaaoai/vaults`.
- Implement embedding worker + Qdrant alignment with `oaao_vault_document` statuses.
- Orchestrator: retrieval stage emits `PHASE_RAG` envelopes + citations payload.

### Phase 4 — Library + DocEdit

- Port Library routes (upload, commit delta, finalize_to_vault) — likely as FastAPI modules co-located with orchestrator **or** standalone Python service with shared DB config.

### Phase 5 — Planner / task-list / tools

- Port task-list executor loop from Go **into Python** first (single runtime).
- If latency requires, move **only** `execute_llm_stream` to Go via `GoGatewayTransport`.

### Phase 6 — Hardening

- Redis-backed run registry + SSE replay for multi-instance.
- OTEL parity with Legacy gateway middleware (`gateway/ARCHITECTURE.md` telemetry notes).

---

## 8. Risk register

| Risk | Mitigation |
|------|------------|
| **Brain surface regression** — Legacy `oaao_brain` is huge | Migrate **pipelines as packages** (`pip install -e legacy-brain-extracted`) behind feature flags |
| **Security** — browser-trusted `assistant_patch` | Add HMAC or session-bound server finalize |
| **Scale** — Python SSE single process | Redis registry + sticky sessions or Go transport fallback |
| **Drift** — PHP endpoint rows vs orchestrator | Single resolver (`ChatOrchestratorBootstrap` pattern) + automated smoke |

---

## 9. Quick reference — repo paths

| Concern | Legacy | v1 |
|---------|--------|-----|
| Architecture prose | `oaao.ai-old/oaao.ai/docs/ARCHITECTURE.md` | `.cursor/rules/rayfung-razy-stack.mdc` (streaming rule) |
| Gateway | `oaao.ai-old/oaao.ai/gateway/` | *future optional* |
| Proto | `oaao.ai-old/oaao.ai/proto/hub.proto` | *reference only* |
| Orchestrator | `oaao.ai-old/oaao.ai/sidecar.py` | `python/oaao_orchestrator/` |
| Chat shell API | `oaao.ai-old/oaao.ai/web/.../conversations/` | `oaaoai/chat/.../api/` |
| SPA streaming client | `oaao.ai-old/oaao.ai/src/llm.js` | `oaaoai/chat/.../chat-panel.js` |

---

## 10. Maintenance

Update this document when:

- New orchestrator routes ship (`/v1/*`).
- Vault/Library modules land in v1.
- Go gateway transport adapter is reintroduced.

---

*Generated for **oaao.ai-v1** — Legacy reference root: **`../oaao.ai-old/oaao.ai`**.*
