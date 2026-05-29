# Productivity agents — Calendar & Todo (CS-5 / CS-6)

**Epics:** [OAAO_Content_Studio_Epics.md](../OAAO_Content_Studio_Epics.md) §0 · CS-5 · CS-6

## Roles

| Agent | Entry | Stream event | Persist API |
|-------|--------|--------------|-------------|
| **Calendar** | Icon rail `workspace/calendar` | `calendar_event_suggested` | `POST /calendar/api/calendar_events_save` |
| **Todo** | Header todos panel | `todo_item_suggested`, `todo_resolve_suggested` | `POST /todo/api/todos_save`, `todos_resolve` |

PHP only enqueues and persists; extraction runs in **Python** at end of chat run:

- **Calendar:** `evaluation/calendar_event_candidate.py` — post-turn LLM hook (`materials/prompts/productivity/calendar_event_post_turn.md`) returns JSON `actions[]` with `type: calendar_event_suggested` (no regex field parsing).
- **Todo:** `evaluation/todo_item_candidate.py` — post-turn LLM JSON (`materials/prompts/productivity/todo_item_post_turn.md`) emits **one action per task**; ≥2 tasks → SSE `todo_items_suggested` batch; heuristic splits「包含：A、B、C」when LLM unavailable.

## Chat UX flow

1. Assistant finishes turn → orchestrator may emit suggestion status on SSE.
2. `chat-panel.js` handles event → `conversation-calendar-suggest.js` / `conversation-todo-suggest.js` renders chip under message.
3. User **Add** → RazyUI Dialog → **`POST /calendar/api/calendar_events_plan`** (orchestrator planner: LLM or heuristic) → **`POST calendar_events_save`** → chip removed; calendar may show “View in Calendar”.
4. Thread strip (`conversation-todo-thread.js`) lists open todos for conversation; **Resolve** marks done.

Strings: `oaao-i18n.js` keys `productivity.*`.

## Todo vs Conversation Skills (CS-4)

| | **Todo** | **Skill (MicroSkill)** |
|---|----------|------------------------|
| Purpose | Actionable task with open/done | Reusable prompt / behavior snippet |
| Lifetime | Per user, header panel | Versioned skill library |
| Trigger | Heuristic + optional LLM extract | Post-stream classifier + user confirm dialog |
| Output | `oaao_todo_item` row | `oaao_micro_skill` row |

Do not store long-form “how to answer” preferences as todos; use **UX-1** `preference_tags` instead.

## E2E checklist

Automated (orchestrator unit): `test_cs4_cs5_cs3_smoke.py`, `test_cs6_productivity_e2e.py`, `test_todo_item_candidate.py` (incl. open-todo dedupe).

Manual (workspace UI):

- [ ] Chat produces `calendar_event_suggested` with confidence ≥ threshold → chip visible
- [ ] Save event → appears on Calendar page with provenance `conversation_id`
- [ ] Chat produces `todo_item_suggested` → chip → save → header badge increments
- [ ] Resolve on thread marks todo `done` in panel

## Related code

- `python/oaao_orchestrator/run_executor_finalize.py` (emit hooks)
- `backbone/sites/oaaoai/oaaoai/chat/default/webassets/js/conversation-*-suggest.js`
- `python/materials/prompts/productivity/calendar_event_post_turn.md` · `evaluation/productivity_post_turn.py`
- `python/oaao_orchestrator/evaluation/calendar_event_planner.py` · `routes/productivity.py` (`POST /v1/productivity/calendar/plan`)
- `backbone/sites/oaaoai/oaaoai/calendar/default/webassets/js/calendar-planner-api.js`
- `backbone/sites/oaaoai/oaaoai/core/default/webassets/js/todos-panel.js`
