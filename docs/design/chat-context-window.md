# Chat context window (CIT/CMT + usage panel)

| Field | Value |
|-------|--------|
| **Status** | v1 — shipped in chat thread toolbar |
| **Related** | `fork_cit_cmt.py`, `conversation_fork.php`, `ChatHistorySettings` |

## UX

- **Ring button** on the in-thread toolbar (`data-oaao-chat="context-usage-trigger"`) — Cursor-style circular gauge.
- **Dialog** — segment bar + per-bucket token rows (system, tools, rules, skills, MCP, subagents, summarized, conversation).
- **Compact thread (CIT/CMT)** — `POST /chat/api/conversation_compact` supersedes older turns (`meta_json.prompt_superseded`) and inserts a handoff assistant row; `buildPromptMessagesFromDb` skips superseded rows.

## APIs

| Method | Path | Notes |
|--------|------|--------|
| GET | `/chat/api/context_usage?conversation_id=&chat_endpoint_id=` | Estimates usage vs model cap |
| POST | `/chat/api/conversation_compact` | In-thread compaction |

## Module autoload (Razy)

Full reference: **[razy-module-autoload.md](./razy-module-autoload.md)**.

- FQCN `oaaoai\chat\ChatContextUsage` → `oaaoai/chat/default/library/ChatContextUsage.php` via **ModuleScanner** (module must be **Loaded**; declare cross-module deps in `package.php` `require`, e.g. `oaaoai/endpoints`).
- Chat API closures: use `use oaaoai\chat\…` only — **do not** `require_once` library files. Modules with closure-only APIs (e.g. slide-designer) use `library/_bootstrap.php` instead — see linked doc §4–5.
- `dirname(__DIR__, N)` from `controller/api/` (N≈4 to `oaaoai/`) **≠** from `library/` (N≈3 to `oaaoai/`, N≈7 to repo root). Repo assets: `Oaaoai\Core\OaaoRepoPaths::root()` or `OAAO_REPO_ROOT`.

## Shipped (v1.2)

- **Auto-compact before `send`** when projected usage ≥ threshold (`limits_json.chat.auto_compact_threshold_pct` or `OAAO_CHAT_AUTO_COMPACT_THRESHOLD_PCT`, default 82%), using endpoint `max_model_len` + output `max_tokens` reserve.
- **Live overhead segments** from skills manifest, micro-skills catalog, tool servers (MCP split), planner agent catalog, personalization/rules.
- **Per-model heuristic tokenizer** (`ChatTokenEstimator`) on `context_usage` + compact paths.
- **`auto_compact_applied`** on `POST chat/api/send` → composer toast.
- **Usage ring** — 14px control in **composer extra toolbar** (below input card), not thread header.

## Follow-ups

- True tokenizer (tiktoken / provider APIs) — see `docs/backlog/chat-context-tokenizer.md`.
