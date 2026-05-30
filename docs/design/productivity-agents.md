# Productivity agents — Calendar & Todo (CS-5 / CS-6)

**Epics:** [OAAO_Content_Studio_Epics.md](../OAAO_Content_Studio_Epics.md) §0 · CS-5 · CS-6  
**Related:** [chat-modular-architecture.md](./chat-modular-architecture.md) · [chat-ui-areas.md](./chat-ui-areas.md) · [module-hooks-registry.md](./module-hooks-registry.md) · [purpose-prompt-contract.md](./purpose-prompt-contract.md)

## Roles

| Agent | Entry | Stream event | Persist API |
|-------|--------|--------------|-------------|
| **Calendar** | Icon rail `workspace/calendar` | `calendar_event_suggested` | `POST /calendar/api/calendar_events_save` |
| **Todo** | Header todos panel | `todo_item_suggested`, `todo_items_suggested`, `todo_resolve_suggested` | `POST /todo/api/todos_save`, `todos_resolve` |

PHP only enqueues and persists; extraction runs in **Python** via registry-driven post-turn workers (not inline regex in finalize).

---

## Three-layer hook model (target architecture)

Productivity must follow the same modular pattern as planner agents and IQS/ACCS — **no hardcoded regex classifiers in Python or JS**.

```mermaid
sequenceDiagram
    participant User
    participant Planner as Task planner (planning.primary)
    participant Intent as planning.intent hook
    participant Stream as LLM stream
    participant End as system/end
    participant Worker as post_turn_action worker
    participant UI as chat-panel.js

    User->>Intent: user turn
    Note over Intent: planner_agent.register hints<br/>(calendar_schedule, todo_extract)
    Intent->>Planner: agent scores + ask/agent mode
    Planner->>Stream: task plan (optional agent tasks)
    Stream->>End: assistant text (non-blocking)
    End->>UI: run_end (IQS provisional, no productivity yet)
    End->>Worker: schedule_post_turn_productivity_actions
    Worker->>Worker: LLM JSON via template_ref + purpose slot
    Worker->>UI: ui_stage strip (+ legacy SSE status)
    UI->>UI: mountProductivityChip → [strip] area
```

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

### Layer 3 — Finalize async attach (`post_turn_action.register`)

After `system/end` (same lifecycle as IQS/ACCS in `post_stream_worker`):

| Registry hook | Registry class | Python dispatcher |
|---------------|----------------|-------------------|
| `post_turn_action.register` | `PostTurnActionRegister` | `evaluation/post_turn_action_worker.py` |

Each row declares:

| Field | Example | Purpose |
|-------|---------|---------|
| `action_id` | `calendar_event_suggested` | Meta key + worker dispatch id |
| `purpose_key_prefix` | `productivity.calendar` | Settings LLM slot (future: dedicated purpose row) |
| `template_ref` | `materials/prompts/productivity/calendar_event_post_turn.md` | Command template — **no inline regex** |
| `sse_event` | `calendar_event_suggested` | Late SSE status for open streams |
| `min_confidence` | `0.62` | JSON action threshold |

**Worker flow:**

1. `ChatSendOrchestratorFinalize` forwards `post_turn_actions[]` on run bootstrap.
2. `run_executor_finalize` emits `system/end` immediately (productivity does not block).
3. `_post_run_end_housekeeping` calls `schedule_post_turn_productivity_actions`.
4. Worker runs LLM classifiers → `emit_ui_stage(strip, …)` + legacy `emit_*_status` → `persist_assistant_message` meta attach.
5. UI: **`[strip]`** area via `applyUiStageEnvelope` / legacy SSE + `hydrateProductivityChipsFromServer`.

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
| Inline `classify_*` calls in `run_executor_finalize` before `system/end` | `post_turn_action_worker` after `system/end` |
| Client-side text inference in `chat-panel.js` | Server meta attach + `hydrateProductivityChipsFromServer` |
| Hardcoded calendar/todo blocks in `send.php` | Module `collect_feature_registries` + `post_turn_action.register` |

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
| 2026-05-29 | `intent_only`, `[strip]` UI area, `ui_stage` attach path, vault/todo boundary docs |
| 2026-05-29 | Document three-layer hook model; add `post_turn_action.register`; move classify to async worker; remove calendar regex heuristic |
