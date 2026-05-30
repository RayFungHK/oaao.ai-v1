# Chat modular architecture — PHP admin · Python worker · UI shell

> **Audience:** Every agent touching chat send, orchestrator runs, module hooks, or chat UI.  
> **Read first**, then drill into linked packs.

| Topic | Document |
|-------|----------|
| Module boundaries & sprint backlog | [sprint-module-boundary-charter.md](./sprint-module-boundary-charter.md) |
| PHP send hook phases | [chat-send-pipeline.md](./chat-send-pipeline.md) |
| Boot registries & per-module inventory | [module-hooks-registry.md](./module-hooks-registry.md) |
| Six UI areas + `ui_stage` SSE | [chat-ui-areas.md](./chat-ui-areas.md) |
| Calendar / Todo productivity | [productivity-agents.md](./productivity-agents.md) |

---

## 1. Why modularize (模組化目的)

The chat surface is a **pipeline product**, not a monolith controller. Modularization exists so that:

1. **Each module owns its domain** — vault SQL stays in vault, todo SQL in todo, calendar classifiers in calendar's registry + Python worker. Chat is the **orchestrator of hooks**, not the owner of every table.
2. **PHP plans once per send** — a single `ChatRunRequest` JSON is the work sheet. Python must not call back to PHP for MDM mid-run (`php_boundary.py`).
3. **UI consumes footprints, not text** — the SPA mounts module chrome in **fixed areas** (`task`, `message`, `agent`, `info`, `state`, `strip`) driven by SSE + `meta_json`, never client-side regex on assistant prose.
4. **Registries scale without editing `send.php`** — new modules emit `{hook}.register` at boot and `chat.send.{phase}` at send time.
5. **Async work is explicit** — IQS/ACCS and productivity (calendar/todo) run **after** `system/end`, matching user expectation that chips and scores appear when the reply is already readable.

**Anti-goals:** cross-module `require`, foreign SQL, inline classifiers in finalize, ad-hoc divs in `chat-panel.js` for one module.

---

## 2. Three-layer runtime model

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (UI shell)                                              │
│  SSE stream_url + run_id + assistant_message_id + run_principal  │
│  Six areas per assistant row — see chat-ui-areas.md              │
└────────────────────────────▲────────────────────────────────────┘
                             │ JSON + SSE
┌────────────────────────────┴────────────────────────────────────┐
│  PHP = administrator (POST /chat/api/send)                       │
│  ChatSendPipeline → mergePayloadFragment → ChatRunRequest        │
│  Registries: planner_agent, post_turn_action, chat_pipeline, …   │
└────────────────────────────▲────────────────────────────────────┘
                             │ POST /v1/runs/chat
┌────────────────────────────┴────────────────────────────────────┐
│  Python = worker (orchestrator)                                  │
│  Stream: task → agent → message → info/state/strip (ui_stage)    │
│  Background: post_stream_worker, post_turn_action_worker         │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Role | Must not |
|-------|------|----------|
| **PHP** | Auth, payload assembly, persist, return footprint | Run LLM classifiers inline in send |
| **Python** | Execute work sheet, stream, async attach | Query PHP DB for scope mid-run |
| **UI** | Render areas from SSE/meta | Infer calendar/todo from message text |

---

## 3. End-to-end pipelines (two timelines)

### 3.1 PHP send pipeline (every POST)

Documented in [chat-send-pipeline.md](./chat-send-pipeline.md).

```
gate → prepare → message → scope → persist → conversation_settle
     → orchestrator_ready (bind → agents → core → slide → payload → personalize → finalize)
     → run_start → respond
```

**Key payload fragments merged on send (2026-05-29):**

| Fragment key | Source | Purpose |
|--------------|--------|---------|
| `allowed_agents` | chat / AGENTS | Dispatchable planner runners only (excludes `intent_only`) |
| `agent_catalog` | `PlannerAgentRegister::catalogForAllowed()` | Planner hints for dispatchable agents |
| `planner_intent_catalog` | `PlannerAgentRegister::catalogForIntentHints()` | Calendar/todo intent hints — **not** runnable tasks |
| `planner_prompt_block` | `PlannerPromptRegister` (P1) | Numbered planner injection lines |
| `post_turn_actions[]` | `PostTurnActionRegister::forOrchestrator()` | Async workers after `system/end` |
| `open_todo_items` | `api('todo')->openItemsForConversation()` | Todo resolve classifier context |
| vault scope | `api('vault')->scope*` / `VaultSendOrchestratorPayload` | RAG profiles, document catalog |

### 3.2 Orchestrator stream pipeline (one run)

After PHP POSTs the run, Python streams phases in **product order**. The UI maps them to chat areas:

| Stream order | `phase` / event | Chat area | Notes |
|:------------:|-----------------|-----------|-------|
| 1 | `task` start/status/end | **`task`** | Planner checklist, agent ask |
| 2 | `agent` / `rag` / … progress | **`agent`** | Pipeline blocks (`chat_pipeline.register`) |
| 3 | `llm` delta | **`message`** | Assistant markdown body |
| 4 | `system` run_end / metrics | **`state`** | tok/s, duration (also `ui_stage` target) |
| 5 | post_stream_worker | **`info`** | IQS / ACCS pills |
| 6 | post_turn_action_worker | **`strip`** | Calendar/todo chips (+ `ui_stage strip`) |

**`ui_stage` (canonical, migrating):** `phase=ui`, `kind=stage`, `payload.area ∈ {strip, info, state}`.  
Router: `applyUiStageEnvelope()` in `chat-panel.js`.  
Emitter: `oaao_orchestrator.streaming.ui_stage_stream.emit_ui_stage()`.

Legacy **`system/status`** events (`calendar_event_suggested`, turn-score poll) remain during migration — see [chat-ui-areas.md §8](./chat-ui-areas.md#8-sse-ui_stage-contract-pipeline-order).

---

## 4. Module participation matrix (target)

| Module | Agent task? | Async after `system/end`? | PHP send stage | UI area | Registry hooks |
|--------|:-----------:|:-------------------------:|----------------|---------|----------------|
| **Chat** | — | — | all phases | `message`, shell | hosts registries |
| **Planner** | dispatches | — | `agents` | `task` | `planner_agent`, `pa-planning` |
| **Calendar** | **No** (`intent_only`) | **Yes** | — | **`strip`** | `planner_agent`, `post_turn_action`, `pa-productivity-calendar` |
| **Todo** | **No** (`intent_only`) | **Yes** | personalize via API | **`strip`** | `planner_agent`, `post_turn_action`, `pa-productivity-todo` |
| **Slide designer** | **Yes** | No | prepare, orch | **`agent`** | `planner_agent`, `chat_pipeline` |
| **Vault** | via `vault_rag` | No | prepare, orch | **`agent`** | vault hooks, `chat_pipeline` |
| **Web search** | **No** (prepare flag) | No | `prepare` | composer | `enable_web_search` |
| **Office** | task action only | No | TBD corpus listener | `agent` / task | `office_generate` |
| **IQS/ACCS** | No | Yes | — | **`info`** | `uiqe.*` purpose |
| **Skills** | No | post-stream | — | **`strip`** / composer | micro_skill |

Full charter: [sprint-module-boundary-charter.md §2](./sprint-module-boundary-charter.md#2-module-interaction-matrix-target).

---

## 5. Chat UI hard shell (summary)

Each assistant turn = one `.oaao-chat-assistant-row` with **six canonical areas**:

```
identity → task → agent(before) → message → agent(after) → info → state → strip → toolbar
```

**Stable selectors:** `data-oaao-chat-area="task|message|agent-before|agent-after|strip|info|state"`  
**Shell rev:** `OAAO_CHAT_SHELL_ASSET_REV` / `OAAO_SHELL_ESM_V` = `20260529-ui-areas-v150`

| Area | Host / API | Module rule |
|------|------------|-------------|
| `strip` | `[data-oaao-chat-area="strip"]`, `mountProductivityChip` | Ephemeral — detach after user action |
| `info` | `[data-oaao-chat-area="info"]`, `applyAssistantTurnScoreToRow` | Always show when scores exist |
| `state` | `[data-oaao-chat-area="state"]`, `applyAssistantRunSummaryToRow` | Run telemetry |

**Do not** patch `chat-panel.js` render for one module — register `chat_pipeline.register` or emit `ui_stage` / post_turn SSE.

Full spec: [chat-ui-areas.md](./chat-ui-areas.md).

---

## 6. Boundary fixes shipped (2026-05-29)

| Item | Before | After |
|------|--------|-------|
| Vault scope SQL | `chat/ChatVaultScope.php` | `vault/VaultChatScope.php` + `api('vault')->scope*` |
| Todo open items SQL | `user/UserSendOrchestratorPayload.php` | `todo/TodoOpenItemsForConversation.php` + `api('todo')->openItemsForConversation()` |
| Calendar/todo in `allowed_agents` | dispatchable rows | `intent_only: true` — excluded from dispatch; `planner_intent_catalog[]` |
| Strip chip order | before IQS / mixed DOM | **strip after info + state** (post-turn) |
| Planner prompt API | missing | `api('chat')->setPlannerPrompt()` + `{{planner_prompt_block}}` in planner templates |
| UI stage SSE | missing | `ui_stage_stream.py` + `applyUiStageEnvelope()` |

Remaining backlog: [sprint-module-boundary-charter.md §6](./sprint-module-boundary-charter.md#6-sprint-backlog-recommended-order) (P2–P4).

---

## 7. Agent checklist (before merging)

- [ ] Module behavior matches matrix (agent / async / stage / area)
- [ ] No SQL on foreign module tables
- [ ] No new regex routing in PHP/Python/JS for module detection
- [ ] UI mounts in named **area id**, not “under bubble”
- [ ] Registry + [module-hooks-registry.md](./module-hooks-registry.md) updated
- [ ] If touching shell DOM, bump `OAAO_CHAT_SHELL_ASM_REV` in `chat-panel.js`, `core.main.php`, `docker/env`

---

## 8. Change log

| Date | Change |
|------|--------|
| 2026-05-29 | Initial architecture hub — modularization purpose, dual pipelines, UI shell summary, P0 boundary status |
