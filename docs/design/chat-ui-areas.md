# Chat UI areas — canonical layout for module placement

> **Audience:** Product, module authors, and agents deciding *where* to mount UI.  
> **Related:** [chat-modular-architecture.md](./chat-modular-architecture.md) · [sprint-module-boundary-charter.md](./sprint-module-boundary-charter.md) · [module-hooks-registry.md](./module-hooks-registry.md) · [chat-send-pipeline.md](./chat-send-pipeline.md) · `ChatPipelineRegister.php`

When you say *「在 Chat 的 X 區加 Y」*, use the **Area id** below — not vague words like “under the bubble”.

---

## 1. The six areas (canonical)

Each assistant turn is one **`.oaao-chat-assistant-row`**. User turns use a separate stack (no six-area model).

| # | Area id | Name | Purpose | Lifetime | Typical content |
|---|---------|------|---------|----------|-----------------|
| 1 | **`task`** | Task / Steps | Planner task list + agent **Ask** (Proceed / Skip) | Per turn; collapsible | Inline task steps, `requires_ask` chips |
| 2 | **`message`** | Message | **Real assistant prose** (stream + persisted) | Permanent (message body) | Markdown bubble, user-visible answer |
| 3 | **`agent`** | Agent mode custom | Module-specific **live agent chrome** | While agent runs / until handoff | Slide preview strip, deck worker UI |
| 4 | **`info`** | Information | Quality / evaluation — **always show when present** | Sticky on row after scores arrive | IQS, ACCS, **Cal/Todo worker pills**, cite/scope sub-pills |
| 5 | **`state`** | State | Run telemetry — **always show when present** | Sticky on row | tok/s, duration, think time, Logging link |
| 6 | **`strip`** | Strip | **Ephemeral actions** — Dismiss / Confirm | **Detach after command** | Calendar chip, Todo chip, skill upgrade, resolve todo |

### Visual order (top → bottom, target)

```
┌─ .oaao-chat-assistant-row ─────────────────────────────┐
│  (identity) Assistant avatar / endpoint chip           │
│  [task]     Task / Steps + Ask                         │
│  [agent]    Pipeline blocks BEFORE bubble (zone:before)│
│  [message]  Assistant markdown bubble                  │
│  [agent]    Pipeline blocks AFTER bubble (zone:after)  │
│  [info]     IQS · ACCS · Cal · Todo · cite · scope     │
│  [state]    44.99s · 21.53 tok/s · think · Logging     │
│  [strip]    Post-turn action chips (calendar, todo, …) │
│  (toolbar)  Copy · thumbs · materials — not an “area”  │
└────────────────────────────────────────────────────────┘
```

**Composer** (below thread) is separate: vault picker, web toggle, template chips — use `composer_slot` zones, not the six areas.

**Thread-level** (not per message):

| Host | Area analogue | Content |
|------|---------------|---------|
| `[data-oaao-chat="activity"]` | debug state | SSE activity log (dev / power user) |
| `[data-oaao-chat="composer-refs"]` | composer strips | thread health, skill suggest, desk mode |

---

## 2. Stable DOM anchors (implementation)

Target **`data-oaao-chat-area`** attributes on hosts inside `.oaao-chat-assistant-row` (**v150 — implemented**).

| Area id | Selector | Mount API |
|---------|----------|-----------|
| `task` | `[data-oaao-chat-area="task"]` | `getOrCreateAssistantInlineStepsHost(outer)` |
| `message` | `[data-oaao-chat-area="message"]` | `applyAssistantMarkdown(bubble, …)` |
| `agent-before` | `[data-oaao-chat-area="agent-before"]` | `syncAssistantMessageBlocks` (before zone) |
| `agent-after` | `[data-oaao-chat-area="agent-after"]` | `syncAssistantAfterBlocks` |
| `strip` | `[data-oaao-chat-area="strip"]` | `mountProductivityChip`, skill suggest handlers |
| `info` | `[data-oaao-chat-area="info"]` | `GET /chat/api/info_worker` → IQS/ACCS + **queued worker status** (Cal/Todo pending pills) + strip items when ready |
| `state` | `[data-oaao-chat-area="state"]` | `applyAssistantRunSummaryToRow(outer, meta)` |

### Current assistant row order (v150 — target achieved)

1. (identity) — `data-oaao-chat="assistant-identity"`  
2. `[task]` — `data-oaao-chat-area="task"` (`inline-task-steps`)  
3. `[agent]` before — `data-oaao-chat-area="agent-before"` (`pipeline-blocks`)  
4. `[message]` — `data-oaao-chat-area="message"` (assistant bubble)  
5. `[agent]` after — `data-oaao-chat-area="agent-after"` (`pipeline-after-blocks`)  
6. **[info]** — `data-oaao-chat-area="info"` (`turn-score`) — IQS / ACCS / Cal / Todo pills  
7. **[state]** — `data-oaao-chat-area="state"` (`assistant-summary-wrap`) — tok/s, Logging  
8. **[strip]** — `data-oaao-chat-area="strip"` (`action-strip`) — **post-turn** productivity / skill chips (after info/state)  
9. `.oaao-chat-assistant-toolbar` — Copy / feedback (chrome, not an area)

Setup: `ensureAssistantAreaHosts(outer)` in `renderMessages` and stream row creation.

**Shell asset rev:** `20260529-ui-areas-v150` — sync `chat-panel.js`, `core.main.php`, `docker/env`.

---

## 3. Module → area matrix

Use this when specifying work to an agent:

| Module | Agent mode? | Async after? | Primary **area** | Secondary | Registry / hook |
|--------|:-----------:|:------------:|------------------|-----------|-----------------|
| **Chat (core)** | — | — | `message` | `state` | markdown stream |
| **Planner** | dispatches tasks | — | **`task`** | — | `meta.tasks` → inline steps; Ask via agent-ask SSE |
| **Slide designer** | Yes | No | **`agent`** | `task` | `cp.slide_designer.preview_strip` (`message_block`, `after`) |
| **RAG / vault** | via vault_rag task | No | **`agent`** | — | `cp.rag.citation_block`, retrieval rails |
| **Calendar** | No | Yes | **`strip`** | — | `post_turn_action` → `calendar_event_suggested` |
| **Todo** | No | Yes | **`strip`** | — | `post_turn_action` → `todo_items_suggested` |
| **Skills (CS-4)** | No | post-stream | **`strip`** | composer refs | skill suggest chip |
| **IQS / ACCS** | No | Yes (worker) | **`info`** | — | turn_score upsert → `[turn-score]` |
| **Run metrics** | No | at run_end | **`state`** | `activity` (thread) | `applyAssistantRunSummaryToRow` |
| **Web search** | No (prepare only) | No | composer | — | `enable_web_search` in prepare; not a message area |
| **Office** | task action | No | **`agent`** or export CTA | `task` | `task_files_cta` block (today) |

---

## 4. How modules register (by area)

### `[task]` Task / Steps

- **Data:** `meta.tasks` / SSE `task_plan`, planner steps, agent ask payloads  
- **UI:** `renderOaaoInlineTaskStepsFromState`, agent ask Proceed/Skip  
- **Owner:** chat shell + planner orchestrator  
- **Module extension:** planner task rows reference `agent_kind`; Ask copy from `planner_agent.register` `ask_*` fields  

### `[message]` Message

- **Data:** streamed + persisted `content`  
- **UI:** markdown bubble only — **no** chips, scores, or module chrome inside bubble text  
- **Module extension:** do not inject HTML into content; use other areas  

### `[agent]` Agent mode custom

- **Registry:** `chat_pipeline.register` with `kind: message_block`  
- **Zones:** `extras.message_zone`: `before` | `after` (default `before`)  
- **Examples:**
  - `cp.slide_designer.preview_strip` → slide deck preview (`slide-preview-strip.js`)
  - `cp.rag.citation_block` → citation rail  
  - `cp.chat.task_materials` → materials affordance  
- **Python:** `oaao_pipeline.blocks[]` in run meta drives which blocks mount  

### `[info]` Information

- **Data:** `GET /chat/api/info_worker` — turn scores + productivity worker status + strip items (registered via `info_worker.register`)
- **UI:** `[data-oaao-chat="turn-score"]` pills — IQS/ACCS scores; **Cal/Todo blink while post-turn workers run**; ready state links to `[strip]`
- **Module extension:** register with `info_worker.register` (see calendar/todo/chat registries) — **not** ad-hoc divs or separate poll endpoints

### `[state]` State

- **Data:** `run_end` metrics — `duration_ms`, `tokens_per_sec`, `pipeline_timing`  
- **UI:** `[data-oaao-chat="assistant-summary-wrap"]` + optional Logging popover  
- **Always show** when meta present (even if `[info]` still pending)  

### `[strip]` Strip

- **Data:** SSE status + `meta_json` suggestion fields  
- **UI:** one chip row per suggestion; **Dismiss** removes chip; **Confirm** opens dialog then removes  
- **Modules:** calendar/todo suggest, skill upgrade, todo resolve  
- **Registry:** `post_turn_action.register` (backend) + module ESM (`conversation-*-suggest.js`)  
- **Rule:** never persist strip UI in message body; chip gone after action  

---

## 5. Communication cheat sheet (for agents)

| You want… | Say… | Do not… |
|-----------|------|---------|
| Planner step list on a turn | “Mount in **`[task]`**” | Put steps inside markdown |
| Slide deck preview | “Register **`[agent]`** `message_block` after bubble” | Patch `chat-panel.js` render |
| Calendar Add chip | “Emit **`[strip]`** via post_turn_action” | Regex-parse message in JS |
| IQS pill | “Update **`[info]`** via turn_score” | Append score text to bubble |
| tok/s line | “Update **`[state]`** from run_meta” | Duplicate under composer |
| Vault citation rail | “**`[agent]`** block `rag_citations`” | Inline in message prose |
| Composer web toggle | “**composer** `prepare` flag” | Message area |

---

## 6. PHP admin · Python worker · UI (per area)

| Area | PHP (admin) | Python | UI attach |
|------|-------------|--------|-----------|
| `task` | planner in payload; task list in run meta | planner + agent runners | SSE during run |
| `message` | persist content | stream tokens | stream + reload |
| `agent` | pipeline block registry | `oaao_pipeline.blocks` | syncAssistantMessageBlocks |
| `info` | — | **queued:** `post_stream_worker` + `post_turn_action_worker` | **`info_worker` API poll** | `chat-info-worker.js` — IQS, ACCS, Cal/Todo pending |
| `state` | — | run_end metrics | applyAssistantRunSummaryToRow | tok/s after compose |
| `strip` | `post_turn_actions[]` | **queued:** `post_turn_action_worker` | `info_worker` poll + SSE hydrate | strip chips when meta ready |

---

## 7. Migration checklist (shell hardening)

- [x] Add `[data-oaao-chat-area="task|message|agent|info|state|strip"]` hosts in `renderMessages` / stream row setup
- [x] Move `[strip]` mount **after** `[info]` / `[state]` (post-turn), **before** toolbar
- [x] Route `mountProductivityChip` → `[data-oaao-chat-area="strip"]` only
- [ ] Document `turn_score.register` for new `[info]` metrics
- [x] Split `[agent]` hosts: `pipeline-before` / `pipeline-after` tagged via `data-oaao-chat-area`
- [ ] Export area ids in `ChatPipelineRegister` row schema (`ui_area` field)

---

## 8. SSE `ui_stage` contract (pipeline order)

Orchestrator emits **`phase=ui`, `kind=stage`** after the message body is complete. The UI router is `applyUiStageEnvelope()` in `chat-panel.js`.

| Stage order | `payload.area` | Payload shape (examples) |
|-------------|----------------|---------------------------|
| async worker | `info` | `{ area: "info", iqs, accs, productivity: { calendar: { pending, … }, todo: { … } } }` |
| run_end | `state` | `{ area: "state", duration_ms, tokens_per_sec, pipeline_timing }` |
| post_turn (queued, after compose) | `strip` | `{ area: "strip", items: [...], strip_hash }` — may also appear via **`info_worker`** poll |

Legacy **`system/status`** events (`calendar_event_suggested`, turn-score polling) remain supported during migration.

Python helper: `oaao_orchestrator.streaming.ui_stage_stream.emit_ui_stage(run, area, payload)`.

---

## 9. Change log

| Date | Change |
|------|--------|
| 2026-05-30 | Post-turn = queued jobs; `info_worker` poll for info + strip hydration |
| 2026-05-29 | info_worker v160: unified `GET info_worker`, Cal/Todo pending pills in [info], registry `info_worker.register` |
| 2026-05-29 | UI areas v150: `data-oaao-chat-area` hosts, strip ordering, `ui_stage` SSE scaffold |
| 2026-05-29 | Initial six-area vocabulary + mapping to current chat-panel DOM |
