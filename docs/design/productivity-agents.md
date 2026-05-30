# Productivity agents — Calendar & Todo (CS-5 / CS-6)

**Epics:** [OAAO_Content_Studio_Epics.md](../OAAO_Content_Studio_Epics.md) §0 · CS-5 · CS-6  
**Related:** [chat-modular-architecture.md](./chat-modular-architecture.md) · [chat-ui-areas.md](./chat-ui-areas.md) · [module-hooks-registry.md](./module-hooks-registry.md) · [purpose-prompt-contract.md](./purpose-prompt-contract.md)

## Roles

| Agent | Entry | Compose attach | Queued after compose | Persist API |
|-------|--------|----------------|----------------------|-------------|
| **Calendar** | Icon rail `workspace/calendar` | **`oaao-calendar` fence** | `[info]` poll + optional `[strip]` | `POST /calendar/api/calendar_events_save` |
| **Todo** | Header todos panel | **`oaao-todo` fence** | `[info]` poll + optional `[strip]` | `POST /todo/api/todos_save`, `todos_resolve` |

PHP enqueues background jobs on send; compose fences extracted from stream; **`GET /chat/api/info_worker`** polls worker status (same pattern as IQS).

---

## Action-in-compose (primary — CS-5 / CS-6)

Calendar/Todo actions are **parameters the main compose LLM emits during inference**, wrapped as fence blocks — not separate mid-run agent tasks.

1. User asks to schedule / track todos in natural language.
2. PHP injects `module_prompts.compose_assistant` — **calendar** / **todo** modules each register `content` (minimal English + agent JSON schema).
3. Main LLM writes readable sections; each committed action gets a fence **directly under its section** (行程 → `oaao-calendar`, 待辦 → `oaao-todo`; tips may follow without fences).
4. **`productivity_inline_extract`** parses all fences from the assistant body (any position, document order).
5. **Agent smoke test** validates JSON (required fields, schema, `min_confidence`) — same payload shape as strip / save APIs.
6. **Pass → inline fence UI** — Confirm / Dismiss on the fence block; Confirm posts fence JSON to module save API.
7. **`system/end`** queues post-turn jobs (Layer 3) — same as IQS; **`info_worker`** poll drives `[info]` pending + optional `[strip]`.

Fence JSON **is** the action — not a preview that needs a second LLM pass when valid.

---

## Three-layer hook model (target architecture)

Productivity follows the modular send + stream pipeline — **compose fence first**, post-turn classifier second.

```mermaid
sequenceDiagram
    participant User
    participant PHP as PHP send (module_prompts)
    participant Compose as llm_stream compose
    participant Stream as LLM stream
    participant Extract as productivity_inline_extract
    participant Smoke as agent smoke test
    participant FenceUI as inline fence Confirm/Dismiss
    participant End as system/end
    participant Worker as post_turn_action worker
    participant Strip as [strip] optional

    User->>PHP: POST send
    PHP->>Compose: module_prompts.compose_assistant
    Compose->>Stream: main LLM (+ vault/web context)
    Stream->>Extract: assistant text + oaao-* fences
    Extract->>Smoke: per-fence JSON
    alt smoke pass
        Smoke->>FenceUI: mount Confirm/Dismiss on fence
        Note over FenceUI: save API uses fence JSON directly
    end
    Stream->>End: system/end (compose complete)
    End->>Worker: queue post_turn_actions (background, like IQS)
    Worker->>Worker: LLM via module_prompts.after_turn
    Worker->>Info: meta scanning → scanned
    Note over Info: GET info_worker poll
    Worker->>Strip: optional ui_stage strip items
```

### Layer 0 — Compose fence (`module_prompts.compose_assistant`)

| Piece | Location |
|-------|----------|
| PHP registry | `ComposePromptRegister` + `CalendarComposePrompt` / `TodoComposePrompt` |
| Python inject | `inject_compose_response_fences()` — concatenates slot `content`, one-line fluency prefix |
| Extract | `productivity_inline_extract.py` |
| UI | `productivity-inline-blocks.js` — Confirm/Dismiss on fence |

### Layer 1 — Planner intent (`planner_agent.register` + `intent_only`)

Each productivity module registers a **planner-facing agent kind** with `planner_hint` and **`intent_only: true`**:

| Module | `agent_kind` | Purpose |
|--------|--------------|---------|
| `oaaoai/calendar` | `calendar_schedule` | Focus blocks, meetings, room booking |
| `oaaoai/todo` | `todo_extract` | Checklists, actionable next steps |

These rows merge into **`planner_intent_catalog[]`** on chat send — **not** into `allowed_agents` / dispatchable `agent_catalog[]`.

**Ask mode:** modules may set `ask_enabled` on future iterations when confirmation is needed before a dedicated agent runner exists.

### Layer 2 — Planner actions (during run)

When intent/planner confidence is high enough:

- **Agent mode** — planner emits a task row (future: `calendar_schedule` / `todo_extract` as `RunTaskType.AGENT`).
- **Ask mode** — `requires_ask` pauses for user confirmation (composer agent-ask chip).

Productivity chips are **not** produced here; this layer only decides whether dedicated agent work runs inside the pipeline.

### Layer 3 — Post-turn queued jobs (`post_turn_action.register` + `info_worker.register`)

After **`system/end`** (compose stream finished), productivity classifiers are **queued background jobs** — same non-blocking pattern as IQS (`post_stream_worker`):

| Piece | Role |
|-------|------|
| `post_turn_action_worker.py` | Dispatches registry rows; persists meta; optional `ui_stage strip` |
| `module_prompts.after_turn` | PHP-owned classifier prompts (template_ref + variables) |
| `info_worker.register` | Declares `[info]` pill_kind + meta keys for poll |
| `GET /chat/api/info_worker` | Browser poll — pending → scanned; includes strip items when ready |

**Surfaces (not mutually exclusive):**

- **`[info]`** — Cal/Todo pending pill while `post_turn_productivity_scanning`; updates when worker completes.
- **`[strip]`** — confirmation chips when worker attaches action meta / emits strip items.
- **Inline fence** (Layer 0) — compose-time JSON; may satisfy confirm without waiting for queue.

Gap-fill: when compose omitted valid fences, the queued classifier is the primary source of action JSON for strip/info.

| Registry hook | Registry class | Python dispatcher |
|---------------|----------------|-------------------|
| `post_turn_action.register` | `PostTurnActionRegister` | `evaluation/post_turn_action_worker.py` |
| `info_worker.register` | `InfoWorkerRegister` | (poll only — `ChatInfoWorker::buildPayload`) |

Each `post_turn_action` row declares:

| Field | Example | Purpose |
|-------|---------|---------|
| `action_id` | `calendar_event_suggested` | Meta key + worker dispatch id |
| `purpose_key_prefix` | `productivity.calendar` | Settings LLM slot |
| `template_ref` | `materials/prompts/productivity/calendar_event_post_turn.md` | Queued classifier prompt |
| `sse_event` | `calendar_event_suggested` | Late SSE for open streams (legacy) |
| `min_confidence` | `0.62` | JSON action threshold |

**Queued worker flow:**

1. `ChatSendOrchestratorFinalize` forwards `post_turn_actions[]` + `module_prompts` on run bootstrap.
2. Compose stream finishes → `system/end` (user can read message).
3. `_post_run_end_housekeeping` queues `schedule_post_turn_productivity_actions` (non-blocking).
4. Worker sets `post_turn_productivity_scanning` → **`[info]`** pending via `info_worker` poll.
5. Worker completes → meta attach + optional `ui_stage strip` → poll refreshes **`[info]`** + **`[strip]`**.

---

## Module registry (implemented)

### `oaaoai/calendar`

- `planner_agent.register` → `calendar_schedule`
- `post_turn_action.register` → `calendar_event_suggested`
- Files: `calendar/default/controller/event/collect_feature_registries.php`

### `oaaoai/todo`

- `planner_agent.register` → `todo_extract`
- `post_turn_action.register` → `todo_items_suggested`, `todo_resolve_suggested`
- Files: `todo/default/controller/event/collect_feature_registries.php`

---

## Classifiers (Python)

| Action | Module | Template | Notes |
|--------|--------|----------|-------|
| Calendar | `evaluation/calendar_event_candidate.py` | `calendar_event_post_turn.md` | **LLM JSON only** — regex heuristic removed |
| Todo | `evaluation/todo_item_candidate.py` | `todo_item_post_turn.md` | LLM JSON primary; bullet heuristic is **debt** → remove when purpose slot wired |
| Todo resolve | `evaluation/todo_completion_checker.py` | — | Open-todo completion hint |

Prompt load: `evaluation/productivity_post_turn.py` + registry `template_ref`.

---

## Chat UX flow

1. Assistant stream completes → `system/end` (scores may be provisional in **`[info]`**).
2. Post-turn worker attaches productivity meta → **`ui_stage` `strip`** (+ optional legacy SSE).
3. Chips mount in **`[data-oaao-chat-area="strip"]`** — **above** IQS/ACCS (`[info]`), below message/agent blocks.
4. `conversation-calendar-suggest.js` / `conversation-todo-suggest.js` render chips.
5. User **Add** → RazyUI Dialog → planner API → save API → chip removed from strip.

Strings: `oaao-i18n.js` keys `productivity.*`.

---

## Anti-patterns (do not add)

| ❌ | ✅ |
|----|---|
| Regex time/checklist parsers in `calendar_event_candidate.py` | LLM JSON via `template_ref` + purpose endpoint |
| Inline `classify_*` in finalize before `system/end` | Queue `post_turn_action_worker` after compose (`system/end`) |
| Block UI until post_turn finishes | Poll `info_worker` for pending → ready (IQS pattern) |
| Client-side text inference in `chat-panel.js` | Server fence extract + smoke test + inline fence UI |
| Hardcoded calendar/todo blocks in `send.php` | Module `collect_feature_registries` + `module_prompts` |
| Python keyword heuristics for compose inject | PHP `module_prompts.compose_assistant` gate |
| Treat markdown schedule tables as actions when fences exist | Use fence JSON as sole action payload |
| Require `[strip]` when fence smoke test passed | Confirm/Dismiss directly on fence block |

---

## E2E checklist

Automated: `test_cs6_productivity_e2e.py`, `test_todo_item_candidate.py`.

Manual:

- [ ] `post_turn_actions[]` present on orchestrator ingress (DevTools / orchestrator logs)
- [ ] After stream ends, late SSE or messages API meta contains productivity fields within ~3s
- [ ] Chips mount in **`[strip]`** area above **`[info]`** turn-score row
- [ ] Save event/todo → provenance `conversation_id` + `message_id`

---

## Related code

- `python/oaao_orchestrator/evaluation/post_turn_action_worker.py`
- `python/oaao_orchestrator/run_executor_finalize.py` (schedules worker; no inline classify)
- `backbone/.../chat/default/library/PostTurnActionRegister.php`
- `backbone/.../chat/default/webassets/js/conversation-*-suggest.js`
- `python/materials/prompts/productivity/*.md`

---

## Change log

| Date | Change |
|------|--------|
| 2026-05-30 | Post-turn as queued jobs + `info_worker` poll; compose fence + info/strip surfaces |
| 2026-05-29 | `intent_only`, `[strip]` UI area, `ui_stage` attach path, vault/todo boundary docs |
| 2026-05-29 | Document three-layer hook model; add `post_turn_action.register`; move classify to async worker; remove calendar regex heuristic |
