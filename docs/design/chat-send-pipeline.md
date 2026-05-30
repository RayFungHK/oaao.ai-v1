# Chat send pipeline (PHP)

Thin orchestration for `POST /chat/api/send` — replace inline cross-module logic in `send.php` with **chainable Razy hook phases**.

**Related:** [chat-modular-architecture.md](./chat-modular-architecture.md) · [module-hooks-registry.md](./module-hooks-registry.md) (per-module hook inventory + isolation audit) · [chat-ui-areas.md](./chat-ui-areas.md) · [Audit_Report.md](../Audit_Report.md) §6 (cross-module coupling) · [razy-module-autoload.md](./razy-module-autoload.md) · [bubble-chat.md](./bubble-chat.md)

---

## 1. Problem

`chat/default/controller/api/send.php` (~1400 lines) owns vault parsing, slide-designer extras, endpoints binding, conversation persistence, and orchestrator payload assembly. That violates the productization rule:

> Multi-module pipeline steps must be **hook points** owned by each module — not hardcoded in a single controller.

Repeated AI edits to `send.php` reintroduce cross-module bugs because there is no stable extension surface.

---

## 2. Target shape

```
send.php (thin)
  → ChatSendContext (per-request mutable state)
  → ChatSendPipeline::run(phase, ctx)
       → $this->trigger('chat.send.{phase}')->resolve(['context' => $ctx])
            ← oaaoai/chat listeners (core)
            ← oaaoai/vault listeners (vault scope)
            ← oaaoai/slide-designer, oaaoai/endpoints, … (future)
  → read ctx fields → persist / POST orchestrator → JSON response
```

Compare with existing **registry** pattern (`planner_agent.register`, `chat_pipeline.register`): those answer *what exists at boot*. Chat send hooks answer *what happens on each POST*.

---

## 3. Phases

### 3.1 PHP send phases (`chat.send.*`)

| Phase | Event | Owner (today) | Notes |
|--------|--------|---------------|--------|
| `gate` | `chat.send.gate` | chat (stub) | Credits, workspace scope — still inline in `send.php` |
| **`prepare`** | **`chat.send.prepare`** | **chat + vault + slide-designer** | **Shipped:** composer flags, vault refs, attachments, slide template |
| **`message`** | **`chat.send.message`** | **chat + slide-designer** | **Shipped:** empty-body defaults, continue prompt, template slug display/enrich |
| **`scope`** | **`chat.send.scope`** | **chat** | **Shipped:** auto-RAG / teaching-intent vault expansion |
| `persist` | `chat.send.persist` | chat | **Shipped:** `ChatSendPersist::execute()` — adjunct SQLite TX |
| **`conversation_settle`** | **`chat.send.conversation_settle`** | **chat + slide-designer** | **Shipped:** provisional title, inference meta, user message meta |
| **`orchestrator_ready`** | **`chat.send.orchestrator_ready`** | **chat + endpoints + vault + slide-designer + calendar + todo** | **Partial:** `bind`, `agents`, `slide`, `payload`, `personalize`, `finalize` stages |
| `run_start` | `chat.send.run_start` | chat | **Shipped:** `ChatSendRunStarter::start()` — compact, payload, POST run |
| `respond` | `chat.send.respond` | chat | **Shipped:** `ChatSendResponder::emit()` — JSON envelope to browser |

Phases run in order when using `ChatSendPipeline::runMany()`. Migration is **incremental** — wire one phase at a time in `send.php`.

### 3.2 Orchestrator run phases (Python, one `POST /v1/runs/chat`)

After PHP `run_start`, Python executes the work sheet in **four inference stages**. Prompt injection content is **owned by PHP** (`module_prompts` on `ChatRunRequest`); Python only renders `template_ref` + `variables` — no compose gating heuristics in orchestrator code.

```
planning          → planner LLM (intent scores, optional agent tasks)
agent context     → vault_rag / web_search merge into messages (no calendar/todo fences)
compose (llm_stream) → main assistant LLM; productivity **action-in-compose** lives here
post-turn queue   → background jobs after system/end (same lifecycle as IQS) — see §3.4
```

| Stage | When | Calendar / Todo role |
|-------|------|----------------------|
| **Planning** | Before agent tasks | `module_prompts.planner` / `planner_prompt_block` — intent hints only (`calendar_schedule`, `todo_extract` are **`intent_only`**, not dispatchable tasks). |
| **Agent context** | vault_rag, web_search, … | Merge retrieval snippets into `messages`. **No** `oaao-calendar` / `oaao-todo` fence contract here. |
| **Compose** | `llm_stream` immediately before upstream inference | **`module_prompts.compose_assistant`** injects fence contract. Main LLM writes human prose and places each fence **adjacent to the section it implements** (not necessarily at message end) — see §3.3. |
| **Post-turn queue** | After `system/end` (async, non-blocking) | **`post_turn_actions[]`** schedules queued classifiers — same pattern as IQS. Surfaces via **`[info]`** pending pills and/or **`[strip]`** — polled through `GET /chat/api/info_worker` — see §3.4. |

**Hard rules:**

- PHP assembles `module_prompts` in `orchestrator_ready` **FINALIZE** (`ModulePromptPayload::build()`).
- Python `inject_compose_response_fences()` runs **only** at compose — never at run entry or during web_search.
- Endpoints module must **not** `require_once` chat/calendar/todo libraries (`FeatureRegistryBootstrap` fires `collect_feature_registries` only).

### 3.3 Calendar / Todo — action-in-compose (primary contract)

Calendar and Todo productivity actions are **in-dialogue commitments** produced by the **main compose LLM**, not separate agent runners mid-stream.

**User-visible flow:** assistant replies in natural language (schedule summary, checklist prose) like everyday chat — **each committed action gets a fence block right under its section** so the thread reads top-to-bottom without scrolling past unrelated tips to find Confirm.

**Machine contract:** fenced JSON blocks may appear **anywhere in the body**, but **must follow the human section they implement** (calendar fence after schedule prose; todo fence after todo prose). Optional closing advice may come **after** the last fence.

````markdown
### 🗓️ 明天行程規劃
…readable schedule…

```oaao-calendar
{"title":"…","start_at":"ISO-8601Z","end_at":"ISO-8601Z",…}
```

### ✅ 待辦清單
…readable checklist…

```oaao-todo
{"type":"todo_items_suggested","items":[{"title":"…","confidence":0.85}],…}
```

### 💡 小撇步
…tips only — no fence unless another action…
````

| Concept | Definition |
|---------|------------|
| **Fence block** | Markdown code fence with info string `oaao-calendar` or `oaao-todo` wrapping a **single JSON object**. |
| **Action payload** | The parsed JSON **inside** the fence — this is the same schema `post_turn_action` workers and **`[strip]`** chips use (`calendar_event_suggested`, `todo_items_suggested`, …). |
| **Compose prompt** | PHP `module_prompts.compose_assistant.{calendar,todo}.content` — each module owns minimal English + JSON schema; Python injects as-is. |
| **Human prose vs fence** | Prose is for reading; fence JSON is for **confirm / persist**, placed **adjacent** to the matching section. UI extracts fences **in document order** — not “last block only”. |

**Validation path (target — fence-first UX):**

```
assistant stream ends
  → extract all ```oaao-calendar``` / ```oaao-todo``` blocks (productivity_inline_extract)
  → agent smoke test per module (schema + required fields + min_confidence)
  → pass → JSON is action-ready
  → mount inline fence UI with Confirm / Dismiss on the block itself
  → Confirm → module save API (calendar_events_save / todos_save) using fence JSON as body
```

When smoke test **passes**, inline fence Confirm/Dismiss is sufficient — JSON already carries save parameters.

**Post-turn queue** (§3.4) still runs in parallel for registry-driven workers: gap-fill when fences were omitted, `[info]` status pills, and optional `[strip]` attach. Compose fences and post-turn jobs are **orthogonal surfaces** on the same action schema.

See [productivity-agents.md](./productivity-agents.md) · [strip-chip-shell.md](./strip-chip-shell.md) · [chat-ui-areas.md §6](./chat-ui-areas.md#6-php-admin--python-worker--ui-per-area) · `python/oaao_orchestrator/productivity_inline_extract.py`.

### 3.4 Post-turn — queued background jobs (like IQS)

After **compose completes** (`system/end`), the orchestrator schedules **non-blocking background jobs** from registries on the PHP work sheet. The user can read the assistant message immediately; workers run afterward — **same lifecycle as IQS/ACCS** (`post_stream_worker`).

```
system/end  (compose stream finished — message persisted)
    │
    ├─ post_stream_worker     → IQS / ACCS classifiers → meta turn_score
    │
    └─ post_turn_action_worker → productivity / module classifiers → meta + optional ui_stage
            │
            ├─ meta.post_turn_productivity_scanning  → [info] pending pill
            ├─ worker completes                    → meta keys + strip items
            └─ meta.post_turn_productivity_scanned → poll stops pending
```

| Job family | Python dispatcher | PHP registry | Typical UI surface |
|------------|-------------------|--------------|-------------------|
| Turn scores | `post_stream_worker` | `uiqe.*` purpose | **`[info]`** — IQS / ACCS pills |
| Productivity | `post_turn_action_worker` | `post_turn_action.register` | **`[info]`** Cal/Todo pending + **`[strip]`** chips |
| Future modules | `post_turn_action_worker` | `post_turn_action.register` | **`[info]`** and/or **`[strip]`** per row |

**`info_worker` is the poll hub** — browser does not block on workers finishing during SSE.

1. Stream ends → `scheduleInfoWorkerPoll` / `scheduleProductivityInfoWorkerPoll` in `chat-panel.js`.
2. `GET /chat/api/info_worker?conversation_id=…&watch_message_id=…` → `ChatInfoWorker::buildPayload()`.
3. Payload aggregates all `info_worker.register` rows (`turn_scores`, `calendar`, `todo`, …).
4. Each row declares `pill_kind`, `post_turn_action_ids`, `meta_keys`, `only_last`.
5. While meta has `post_turn_productivity_scanning` (or score pending), `[info]` shows **pending** pills.
6. When worker attaches meta (`post_turn_productivity_scanned`, action keys, `strip` items), poll refreshes **`[info]`** and may mount **`[strip]`**.

Post-turn output is **not strip-only**:

| Surface | When | Example |
|---------|------|---------|
| **`[info]`** | Always for registered workers | “Calendar…” / “Todo…” pending pill → resolved score or “ready” state |
| **`[strip]`** | When worker emits `ui_stage` strip or meta → `ChatStripItems` | Add-to-calendar / Add-todos chips |
| **inline fence** | Sync extract from compose body (§3.3) | Confirm/Dismiss on fence block — may make strip redundant when JSON valid |

**Productivity classifier prompts** for queued jobs come from PHP `module_prompts.after_turn` (template_ref + variables) — orchestrator renders templates only.

Registry wiring (modules own their rows):

- `post_turn_action.register` — worker dispatch + `template_ref`
- `info_worker.register` — `[info]` pill + poll meta keys (`calendar/default/.../collect_feature_registries.php`)
- `strip_action.register` — confirm API for `[strip]` shell

---

## 4. Core types (chat module)

| Class | Role |
|--------|------|
| `ChatSendPhase` | Phase name constants + `eventName()` |
| `ChatSendContext` | Request state; modules mutate fields or `moduleData('vault')` |
| `ChatSendPipeline` | Fires `chat.send.*` on `oaaoai/chat` |
| `ChatSendPersist` | Adjunct SQLite TX (`execute()` + `ChatSendPersistResult`) |
| `ChatSendRunStarter` | Post-persist orchestrator run (`start()` + `ChatSendRunResult`) |
| `ChatSendResponder` | Browser JSON envelope (`emit()` + `ChatSendRespondInput`) |
| `ChatSendValidator` | Early HTTP validation (session, continue, length, endpoint profile) |
| `ChatSendAbort` | Early JSON exit (HTTP status + payload) |
| `ChatSendComposer` | Chat-owned input parsing (web search, attachments) |

**Hard rule (new work):** do not add cross-module parsing or `require_once` of another module's library in `send.php`. Register a listener instead.

---

## 5. Module extension template (vault — reference)

### 5.1 Library — domain parsing

`vault/default/library/VaultSendScope.php` — `parseComposerInput()`, `parseAutoRag()`.

### 5.2 Event listener

`vault/default/controller/event/chat_send_prepare.php`:

```php
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (!$ctx instanceof \oaaoai\chat\ChatSendContext) {
        return;
    }
    $parsed = VaultSendScope::parseComposerInput($ctx->input);
    $ctx->vaultSourceRefs = $parsed['refs'];
    $ctx->vaultSourceIds = $parsed['ids'];
    $ctx->vaultAutoRag = $parsed['auto_rag'];
};
```

### 5.3 Register in `__onInit`

```php
$agent->listen('oaaoai/chat:chat.send.prepare', 'event/chat_send_prepare');
```

No changes to `send.php` when adding vault-only behavior — only the listener.

---

## 6. Migration backlog (priority)

1. **Done:** `prepare` — vault scope, web search, attachments, slide template.
2. **Done:** `scope` — vault auto-expand after message content known.
3. **Done:** `gate` — credit block, workspace gate (`ChatSendGate`).
4. **Done:** `conversation_settle` — title, inference snapshot, user meta (+ slide-designer template meta).
5. **Done:** `orchestrator_ready` — bind, agents, CORE, SLIDE, PAYLOAD (endpoints/vault), PERSONALIZE (user), FINALIZE (inference/corpus/library/run_principal).
6. **Done:** `persist` — `ChatSendPersist::execute()` (conversation + messages TX).
7. **Done:** `run_start` — `ChatSendRunStarter::start()` (compact, payload stages, POST run).
8. **Done:** `respond` — `ChatSendResponder::emit()` (JSON envelope + hook).
9. **Done:** `message` — template slug + composer text via `chat.send.message`.

Modules to migrate (non-exhaustive):

| Module | Target phase(s) | Today in `send.php` |
|--------|-----------------|---------------------|
| vault | prepare, orchestrator_ready | refs, auto-RAG, profiles, glossary via API |
| endpoints | orchestrator_ready | purpose binding, allowed agents, UIQE |
| slide-designer | prepare?, orchestrator_ready | template id, material container |
| corpus | orchestrator_ready | `corpus_id` style injection |
| live-meeting | orchestrator_ready | ASR extras (via chat API today) |

---

## 7. Bubble vs full chat

Same pipeline and phases. `ChatSendContext::$isBubbleChat` is set from `input.bubble`. Listeners that should skip persistent-agent behavior check this flag (or downstream Python `conversation_kind: bubble` — unchanged).

---

## 8. Testing

- PHP: `chat/default/tests/ChatSendPrepareTest.php`, `vault/default/tests/VaultSendScopeTest.php`
- Python contract: extend `test_orchestrator_bridge_contract.py` to assert pipeline classes exist
- Manual: send with vault refs + `enable_web_search` + attachments — payload unchanged vs pre-refactor

---

## 9. AGENTS.md snippet (recommended)

When editing chat send behavior:

1. Prefer a `chat.send.{phase}` listener in the **owning module**.
2. Never `require_once` another module's library from `send.php`.
3. Expose cross-module data via `$this->api('module')` or listener mutation of `ChatSendContext`.
4. Keep `send.php` as wiring only — if a change needs >10 lines of domain logic, it belongs in a hook.

---

## 10. Orchestrator stream pipeline (Python → UI)

After `run_start` POSTs to `/v1/runs/chat`, the browser opens SSE. This is the **second pipeline** — distinct from PHP `chat.send.*`.

See [chat-modular-architecture.md §3.2](./chat-modular-architecture.md#32-orchestrator-stream-pipeline-one-run) and [chat-ui-areas.md §8](./chat-ui-areas.md#8-sse-ui_stage-contract-pipeline-order).

### 10.1 Stream phase → UI area

| Order | Stream | UI area | Persist | Notes |
|:-----:|--------|---------|---------|-------|
| 1 | `task` * | `task` | `meta.tasks` | Planner checklist |
| 2 | `agent` / `rag` / … | `agent` | `oaao_pipeline.blocks` | vault_rag, web_search context |
| 3 | `llm` delta | `message` | `content` | Human prose **+** contextual `oaao-calendar` / `oaao-todo` fences (section-adjacent, any order) |
| 3b | fence extract (sync, post-stream chunk) | **inline fence block** | `meta` productivity keys | **Primary** confirm/dismiss on fence when smoke test passes |
| 4 | `system` end + metrics | `state` | run meta | tok/s, duration — **compose done**; background jobs queued |
| 5 | post_stream_worker (queued) | `info` | turn_score API | IQS / ACCS — poll via `info_worker` |
| 6 | post_turn_action_worker (queued) | `info` + `strip` | meta productivity keys | Cal/Todo pending pills (`info_worker`) + optional strip chips |
| 3b | fence extract (sync, on message body) | **inline fence block** | `meta` productivity keys | Confirm/Dismiss when compose fence JSON passes smoke test |

\* Task frames may arrive before/during LLM depending on planner mode.

**Background job UX:** steps 5–6 do not block step 3. Browser polls `GET /chat/api/info_worker` for worker status (IQS, ACCS, calendar, todo) and hydrates `[info]` / `[strip]` when meta is ready.

### 10.2 `ui_stage` envelope (canonical attach path)

```json
{
  "phase": "ui",
  "kind": "stage",
  "text": "strip",
  "payload": {
    "area": "strip",
    "calendar_event_suggested": { "title": "…", "confidence": 0.8 }
  }
}
```

- **Emitter:** `python/oaao_orchestrator/streaming/ui_stage_stream.py`
- **Router:** `applyUiStageEnvelope()` in `chat-panel.js`
- **Legacy:** `system/status` + `calendar_event_suggested` etc. still handled during migration

### 10.3 Orchestrator payload fields (PHP → Python)

Added or clarified on `ChatRunRequest`:

| Field | Source (PHP) | Used in stage |
|-------|----------------|---------------|
| `allowed_agents` | `PlannerAgentRegister::filterDispatchableKinds()` | planning / agent tasks |
| `agent_catalog` | dispatchable planner hints only | planning |
| `planner_intent_catalog` | `intent_only` rows (calendar/todo) | planning |
| `planner_prompt_block` | `PlannerPromptRegister::numberedBlock()` | planning |
| **`module_prompts`** | **`ModulePromptPayload::build()`** | **`planner` / `compose_assistant` / `after_turn`** |
| `post_turn_actions[]` | `PostTurnActionRegister::forOrchestrator()` | post-turn fallback workers |
| `upcoming_calendar_events` | calendar `PERSONALIZE` hook | compose + after_turn template vars |
| `open_todo_items` | todo `PERSONALIZE` hook | compose + after_turn template vars |
| `productivity` | endpoints purpose bindings | after_turn LLM endpoints |

`module_prompts` shape (PHP-owned injection; Python renders templates only):

```json
{
  "planner": { "calendar": "…", "todo": "…" },
  "compose_assistant": {
    "calendar": { "content": "Calendar Schedule\n===\n…schema…" },
    "todo": { "content": "Todo\n===\n…schema…" }
  },
  "after_turn": {
    "calendar_event_suggested": { "template_ref": "…", "variables": { "…" } },
    "todo_items_suggested": { "template_ref": "…", "variables": { "…" } }
  }
}
```

Compose assistant prompt is included only when enabled productivity rows exist in `post_turn_actions[]` (PHP gate — not Python heuristics).

### 10.4 Prompt debug (per assistant message)

On send, PHP writes `meta_json.orchestrator_prompt_debug` on the assistant row:

| Key | Source |
|-----|--------|
| `module_prompts` | Full payload forwarded to orchestrator |
| `planner_prompt_block` | Numbered planner lines |
| `compose_assistant` | Per-slot content + char counts |
| `compose_inject_preview` | PHP preview of compose system block |
| `compose_injected` | Python actual inject at llm_stream (after run starts) |
| `post_turn_action_ids` | Queued background workers |
| `run_id` | Orchestrator run |

**API:** `GET /chat/api/message_prompt_debug?conversation_id=&message_id=`  
**Messages list:** `GET /chat/api/messages?…&include_prompt_debug=1` adds `prompt_debug` on assistant rows.

---

## 11. Change log

| Date | Change |
|------|--------|
| 2026-05-30 | Assistant `meta.orchestrator_prompt_debug` + `GET message_prompt_debug` API |
| 2026-05-30 | §3.4 post-turn as queued jobs (IQS pattern); `info_worker` poll hub; info + strip surfaces |
| 2026-05-30 | §3 orchestrator run phases; action-in-compose fence contract; `module_prompts` |
| 2026-05-29 | Add orchestrator stream pipeline, `ui_stage`, payload field table |
| 2026-05-29 | Initial send pipeline doc |
