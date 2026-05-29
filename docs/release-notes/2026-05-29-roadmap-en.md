# OAAO.ai roadmap — late May 2026

**What shipped since 27 May 2026** (and what is landing next). This is the first **What's New** entry for the workspace.

## Shipped in the repo

### Chat & orchestration

- **Web search routing** — purpose-aware LLM routing, SearXNG integration, composer **Force web search** toggle, and locale-aware search filters.
- **Composer UX** — multi-line input, **pipeline / planner steps** toggle, planner mode drop-up (Default / ToT / DDTree), and **credits** surfaced on send.
- **Context window** — **context usage** API + ring in the composer (segment breakdown, optional **CIT/CMT compact** when the thread is nearly full).
- **Voice** — live + batch ASR on the composer with stop-time LLM polish.

### Vault, library & content

- **Vault phase 2** — ingest progress over SSE, HTML split pipeline, graph transcript fixes, card layout and job backpressure restored.
- **Library workspace** — dedicated **Library** rail page, block editor shell, **@library** attach in chat (soft-RAG; distinct from vault auto-source).
- **Corpus / slide** — web-to-slide pipeline fixes; slide-designer autoload aligned with Razy module libraries.

### Platform & settings

- **Per-tenant storage** — local / S3 / GCS / HF backends and migration UI in admin settings.
- **Endpoints** — CLI **export/import** for endpoint rows and purpose settings.
- **Admin** — user usage overview; notification dropdown styling.
- **Ops** — Redis canary checks, orchestrator health gating, Windows PowerShell monitor for dev.
- **Release notes (PLAT-1)** — platform CMS schema + APIs; workspace **What's New** dialog (this post).

### Docs & epics

- **Content Studio** epics updated: **Calendar agent** (rail), **Todo agent** (header), **ERP business workspace** north-star design.

## In progress (working tree — not all merged yet)

- **Inference control v2** — composer **Off / Auto / Manual**; baseline from system + user prefs; planner **`inference_delta`** per turn; bounded merge; optional ACCS feedback behind env flag. See `docs/design/chat-inference-auto-tune.md`.
- **Personalization wizard** — random theme → three LLM style options → fine-tune and save default params (preferences language drives copy).
- **Todo module** — header todos panel, thread chips, orchestrator candidate streams.
- **Library editor** — block editor interaction pass, convert/upload API, orchestrator convert route.
- **Composer polish** — context ring placement in feature toggles (not the extra toolbar strip); inference panel compact typography.

## Roadmap (next)

| Theme | Direction |
| ----- | --------- |
| **Content Studio** | Corpus schema-driven extraction (CS-1), Library hard-RAG + Save to Vault, Office Agent artifacts |
| **Agents** | Calendar + Todo E2E from chat chips to workspace records |
| **Platform** | Published release notes fan-out + read state on the notification bell |
| **Inference** | Stable auto-tune without ACCS as the primary driver; purpose-specific baselines in Settings |
| **Enterprise** | ERP business workspace modules (see `docs/design/erp-business-workspace.md`) |

## How to try

1. Hard-refresh the workspace after deploy (shell ESM cache rev bumps with chat/core assets).
2. Open **Settings → Endpoints** and **Preferences** for locale, inference, and personalization.
3. Start a chat thread — enable **web search** or **pipeline steps** from the composer toolbar when you need them.

Questions or regressions: note your **build_id** from the workspace footer / `GET /api/build_info` when filing issues.
