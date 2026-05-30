# Sprint charter — PHP admin · Python worker · module boundaries

> **Audience:** Every agent starting work on oaao.ai-v1 chat / planner / productivity modules.  
> **Related:** [chat-modular-architecture.md](./chat-modular-architecture.md) · [module-hooks-registry.md](./module-hooks-registry.md) · [chat-send-pipeline.md](./chat-send-pipeline.md) · [chat-ui-areas.md](./chat-ui-areas.md) · [productivity-agents.md](./productivity-agents.md) · [purpose-prompt-contract.md](./purpose-prompt-contract.md)

Read this **before** adding features, regex classifiers, or cross-module `require` / SQL.

---

## 1. Core contract (non‑negotiable)

### PHP = administrator

PHP **plans and packages** work. It does not run LLM classifiers inline in `send.php`.

```
Browser → POST /chat/api/send
       → ChatSendPipeline (chat.send.* hooks, per module)
       → ChatRunRequest JSON (single bootstrap payload)
       → POST orchestrator /v1/runs/chat
```

PHP responsibilities:

| Responsibility | Where |
|----------------|--------|
| Auth, workspace scope, credits | `ChatSendGate` |
| Compose user message, attachments | `chat.send.prepare` / `message` |
| Merge module payload fragments | `ChatSendRunStarter` + `mergePayloadFragment()` |
| Registry catalog at boot | `{hook}.register` → endpoints hub |
| **Task JSON** to Python | `allowed_agents`, `agent_catalog`, `post_turn_actions[]`, purpose bindings |
| Persist message rows | `ChatSendPersist` |
| Return **Token / Footprint** to UI | `stream_url`, `run_id`, `assistant_message_id`, `run_principal` |

### Python = worker

Python **follows the work sheet** in `ChatRunRequest`. No mid-run PHP MDM calls (see `php_boundary.py`).

```
Stream assistant reply → system/end (non-blocking)
Background workers:
  - IQS / ACCS (post_stream_worker)
  - Calendar / Todo (post_turn_action_worker)
  - Vault jobs, slide agents, web_search agent, …
Attach results:
  - Late SSE status (if stream still open)
  - meta_json via chat_persist / turn_score upsert / internal PHP sync
```

Every Python job payload must carry **user identity + permission context**:

- `run_principal` (HMAC token: user_id, conversation_id, assistant_message_id, workspace_id, tenant_id)
- `user_id`, `tenant_id`, `workspace_id` on `ChatRunRequest`
- Internal PHP calls: `X-OAAO-Internal-Token` + `run_principal` verification

UI reads session via **PHP API only**; user permission is enforced on PHP before orchestrator starts.

**Chat surface:** six canonical UI areas (`task`, `message`, `agent`, `info`, `state`, `strip`) — see [chat-ui-areas.md](./chat-ui-areas.md). When specifying module UI, always name the **area id**, not “under the bubble”.

### UI = consumer of Token / Footprint

The SPA never guesses module intent with regex. It:

1. Opens SSE with `stream_url` + `run_id`
2. Renders stream + late status events
3. Polls `/chat/api/messages` or turn-score APIs when workers attach meta after `system/end`
4. Uses module-owned ESM (`conversation-*-suggest.js`, slide strips, …) driven by **meta keys**, not text parsing

**Footprint** (today): `run_principal`, message `meta_json`, Redis/queue job ids where used.  
**Target:** explicit footprint tokens per worker for cross-service reads (Redis / JSON sidecar / PHP API) — not yet unified.

---

## 2. Module interaction matrix (target)

How each module participates in chat. **Do not mix columns.**

| Module | Agent mode (planner task → Python runner) | Async after `system/end` | Primary pipeline stage | Planner prompt injection |
|--------|:----------------------------------------:|:------------------------:|------------------------|--------------------------|
| **Todo** | **No** | **Yes** (`post_turn_action`) | — | `todo` → action criteria (LLM) |
| **Calendar** | **No** | **Yes** (`post_turn_action`) | — | `calendar` → action criteria (LLM) |
| **Slide designer** | **Yes** (`slide_designer` runner) | **No** | `prepare`, `message`, `orchestrator`/SLIDE | `slide_designer` → planner hint |
| **Office** (`office_generate`) | **No** (task action only — **not** a long-lived agent loop) | **No** | Should be corpus listener, not chat finalize | `office` → task criteria |
| **Web search** | **No** (prepare flag only — **not** separate agent task in target) | **No** | `chat.send.prepare` (`enable_web_search`) | `web_search` → prepare criteria |

### Interpretation

- **Agent mode** = planner emits a task row executed by a registered `AgentRunner` during the run (slide_designer, vault_rag, sandbox_code, …).
- **Async after action** = `post_turn_action.register` worker runs **after** `system/end`; attaches suggestion meta / SSE.
- **Prepare stage action** = boolean or scope fragment merged in `chat.send.prepare` (web search toggle).
- **Task action** = one-shot planner step (office export) without post-turn classifier.

**Todo / Calendar must NOT appear in `allowed_agents` as dispatchable runners** until a real Python `AgentRunner` exists. They belong in:

1. Planner **prompt injection** (intent scoring only), and  
2. `post_turn_actions[]` (async classifiers).

---

## 3. Planner prompt injection

### API (P1 scaffold — shipped 2026-05-29)

```php
$this->api('chat')->setPlannerPrompt(
    'todo',            // module key
    'action',          // slot label in numbered line
    'When the user …', // prompt fragment
    true,              // numbered (default true)
    500                // sort
);
```

Rendered as `planner_prompt_block` on orchestrator ingress when non-empty:

```
1. action: When the user asks for a checklist …
2. calendar: When the user schedules focus time …
```

The **LLM decides** — no PHP/Python regex for module detection (target; regex debt remains — see §5).

### Implementation status

| Mechanism | Status |
|-----------|--------|
| `api('chat')->setPlannerPrompt()` | **Scaffold** — `PlannerPromptRegister` |
| `planner_prompt_block` on payload | **Shipped** when registry non-empty |
| `planner_agent.register` + `intent_only` | Dispatch vs intent split — **shipped** |
| `planner_intent_catalog[]` | Calendar/todo hints — **shipped** |
| `planning.intent` + `turn_agent_intent.md` | Per-turn LLM scores — existing |
| Python consumes dynamic numbered list | **Open** — templates still partly hardcoded |

### Remaining (P1)

1. `{module}:planner_prompt.register` hook emit from `collect_feature_registries` (optional; API exists).
2. Wire `planner_prompt_block` into `planner_system.md` / `turn_agent_intent.md`.
3. **Remove** regex gates: slide teaching intent, vault filename routing, todo bullet heuristic.

---

## 4. Cross-module communication rules

| From → To | Allowed | Forbidden |
|-----------|---------|-----------|
| Module A → Module B | `$this->api('module')->method()` | `require` foreign library, SQL on foreign tables |
| Module → Chat pipeline | `chat.send.{phase}` listener + `{Module}Send*.php` | Logic blocks in `send.php` |
| Module → Boot catalog | `$this->trigger('{hook}.register')` in `collect_feature_registries.php` | Hardcoded rows in `endpoints.php` except platform-owned slots |
| Module → Python | Payload fields on `ChatRunRequest` only | Python calling PHP for MDM mid-run |
| Python → PHP | Allowlisted internal routes + `run_principal` | Ad-hoc SQL from Python |

Settings UI: each module owns `settings.register` / SPA pages; **endpoints** owns purpose slot metadata; modules only emit `purpose_allocation.register`.

---

## 5. Independence audit (2026‑05‑29)

Modules are **not** fully independent today. Known boundary crossings:

### Critical / high

| # | Issue | Location | Status |
|---|-------|----------|--------|
| 1 | Chat SQL on **vault** tables | `chat/ChatVaultScope.php` | **Fixed** — `vault/VaultChatScope.php` + `api('vault')->scope*` |
| 2 | **User** SQL on **todo** table | `user/UserSendOrchestratorPayload.php` | **Fixed** — `api('todo')->openItemsForConversation()` |
| 3 | `calendar_schedule` / `todo_extract` dispatchable without runners | calendar/todo registries | **Fixed** — `intent_only: true`; `planner_intent_catalog[]` |
| 4 | **Web search** triple path | prepare, intent, agent | Open — P3 |
| 5 | **Corpus** style in chat finalize | `ChatSendOrchestratorFinalize.php` | Open — P2 |

### Medium

| # | Issue | Location |
|---|-------|----------|
| 6 | Slide allowed-agent **regex** in chat | `ChatTeachingIntent.php` |
| 7 | `office_generate` registered in `corpus.php` directly | bypasses hook emit |
| 8 | Endpoints listeners `require_once` chat registry classes | hub coupling (acceptable if documented) |
| 9 | Python `post_turn_action_worker._DEFAULT_ACTIONS` duplicates PHP registry | remove when send always forwards registry |
| 10 | Todo bullet **regex** heuristic | `todo_item_candidate.py` — debt |

### Per-module scorecard

| Module | Send hooks | Registry emits | Foreign SQL/code | Matches target matrix? |
|--------|:----------:|:--------------:|:----------------:|:----------------------:|
| chat | All phases | Seeds + hosts registries | Corpus finalize, slide regex | Partial |
| calendar | — | planner + post_turn + purpose | None | **Yes** (intent + async strip) |
| todo | — | planner + post_turn + purpose | None (via todo API) | **Yes** |
| slide-designer | prepare/message/settle/orch | Full | Chat regex gate | **Agent yes** |
| vault | prepare/orch | Full + scope API | None | **Yes** |
| endpoints | orch/PAYLOAD | Hub | Requires chat registries | OK (platform) |
| user | orch/PERSONALIZE | None | None (todo via API) | **Yes** |
| rag | — | Full | None | OK |
| corpus/office | — | Direct planner add only | Chat finalize imports corpus | Violation |
| web_search | prepare (+ agent) | Seeded in chat | Intent hardcode | **Does not match** prepare-only target |

---

## 6. Sprint backlog (recommended order)

### P0 — Boundary hygiene ✅ (2026-05-29)

1. ~~Move vault scope SQL~~ → `VaultChatScope` + vault API.
2. ~~Move `open_todo_items`~~ → todo API; user listener calls API only.
3. ~~Split intent vs dispatch~~ → `intent_only` on calendar/todo; `planner_intent_catalog[]`.
4. ~~Remove calendar/todo from dispatchable `allowed_agents`~~ → `filterDispatchableKinds()`.

### P0 UI — Hard shell ✅ (2026-05-29)

5. `data-oaao-chat-area` hosts + strip ordering (v150).
6. `ui_stage` SSE scaffold + `applyUiStageEnvelope()`.

### P1 — Planner prompt injection API ✅ (2026-05-29)

7. ~~`PlannerPromptRegister` + `setPlannerPrompt()` scaffold~~.
8. ~~Wire numbered injection into planner templates from payload~~ — `{{planner_prompt_block}}` in `planner_system.md` + `turn_agent_intent.md`.

### P2 — PHP admin work sheet completeness ✅ (2026-05-29)

8. ~~Ensure every send includes `post_turn_actions[]` from registry (no Python `_DEFAULT_ACTIONS` fallback)~~.
9. ~~Add `productivity.calendar.*` / `productivity.todo.*` purpose resolution to post-turn worker~~.
10. ~~Corpus orchestrator fragment via corpus listener~~ — `CorpusSendOrchestratorPayload` + `chat_send_orchestrator_finalize`.

### P3 — Web search / office alignment ✅ (2026-05-29)

11. ~~Prepare-only web search~~ — `RunTaskType.WEB_SEARCH` prepare step; legacy `type=agent web_search` coerced/skipped.
12. ~~Office task-action contract documented~~ — see [office-agent.md](./office-agent.md).

### P4 — Footprint / permission hardening ✅ (2026-05-29)

13. ~~Document footprint token schema~~ — [run-footprint-contract.md](./run-footprint-contract.md) audit table.
14. ~~Harden evolution plane~~ — `run_principal` on `turn_score_upsert` / `inference_turn_apply` via `ChatInternalPrincipalGate`.

### UI — `ui_stage` info/state ✅ (2026-05-29)

15. ~~Emit `ui_stage` `state` from `run_executor_finalize`~~; ~~`info` from post-stream worker~~; JS skips turn-score poll when `ui_stage` info received (v151).

---

## 7. Checklist before merging any module change

- [ ] No new `use oaaoai\{foreign}\` in `send.php`
- [ ] No SQL against tables owned by another module
- [ ] Module behavior matches matrix (agent / async / stage)
- [ ] Planner injection via registry — **no new regex**
- [ ] Python work driven by PHP payload fields, not hardcoded module lists
- [ ] UI driven by meta / SSE — **no client text inference**
- [ ] Settings / chat / orchestrator registration updated in [module-hooks-registry.md](./module-hooks-registry.md)

---

## 8. Change log

| Date | Change |
|------|--------|
| 2026-05-29 | P0 boundary + UI shell shipped; P1 planner prompt scaffold; audit scorecard updated |
| 2026-05-29 | Initial charter from sprint planning + codebase boundary audit |
