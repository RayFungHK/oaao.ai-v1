# Chat inference control & auto tune

Per-thread control over LLM inference parameters (temperature, top_p, penalties, max_tokens). Default is **off** — sends use endpoint/purpose presets only. Optional **manual** sliders or **auto_tune**.

## Modes

| Mode | Send behavior | Storage |
|------|---------------|---------|
| `off` | No `model_params` on orchestrator payload | `params_json` without active overrides |
| `manual` | Baseline + thread `inference_control.model_params` (explicit overrides) | `inference_control.mode=manual` |
| `auto_tune` | Baseline + per-turn micro-deltas (see below) | `inference_control` + `auto_state.history` |

Legacy threads with only top-level `model_params` are treated as **manual**.

Account-level `UserModelParams` are **not** merged on send when mode is `off` (settings / personalization survey remain separate).

## Baseline stack (auto_tune & manual)

Merge order (later non-null keys win), aligned with `UserModelParams::mergeLayers`:

1. **System default** — purpose `meta_json.inference_params` + chat endpoint binding (`ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint`).
2. **User default** — `preferences_json.model_params` (wizard / preferences panel).
3. **Thread layer** — manual overrides, or auto accumulated state / per-turn deltas.

Auto mode must **not** replace this baseline with an unrelated preset; it only applies **bounded micro-adjustments** on top.

## Intended product: `auto_tune` (target)

When the composer inference control is **Auto**:

1. **Planner** (same run, after IQS gate / in plan build) reads the user turn + baseline and emits a small **`inference_delta`** (or equivalent plan meta), e.g. “creative brainstorm → +temperature step”, “strict extraction → −temperature, +presence”.
2. **PHP `send` / orchestrator** merges: `params_applied = clamp(baseline + delta)` per key, with max step sizes (no full dict replace).
3. **Primary `llm_stream`** receives `model_params` / sampling fields from that merged result for **this turn only**.
4. **ACCS** (post-stream) remains optional **secondary** feedback: small nudges to `auto_state` for the *next* turn, or audit-only — not the primary source of per-turn params.

IQS scores **input quality**; it does not choose inference parameters. Planner + baseline merge does.

```text
user message
  → IQS (clarify / pass; parallel with planner when clarify off)
  → planner(plan + inference_delta from baseline)
  → primary llm_stream(params = baseline ⊕ bounded delta)
  → ACCS (optional: nudge auto_state for following turn)
```

## Chat history

Each user and assistant message stores `meta_json.inference`:

```json
{
  "mode": "auto_tune",
  "params_applied": { "temperature": 0.64, "top_p": 0.9 },
  "source": "auto_tune_planner_delta",
  "baseline": { "temperature": 0.7, "top_p": 0.9 },
  "delta": { "temperature": -0.06 }
}
```

Send API response may include `inference` for the active turn.

## Shipped: `auto_tune` v2 (planner delta)

- PHP `ChatInferenceControl::baselineLayers` — purpose/endpoint then `preferences_json.model_params`.
- Send passes `inference_mode`, `inference_baseline` (auto_tune) on orchestrator payload.
- Planner JSON optional `inference_delta`; heuristic fallback in `inference_tune.py`.
- Preamble merges baseline ⊕ delta → `req.model_params` before `llm_stream`; stream event `inference_applied`.
- `POST /chat/api/inference_turn_apply` persists turn snapshot + `auto_state.history`.
- ACCS feedback **off by default** — set `OAAO_INFERENCE_ACCS_FEEDBACK=1` for small post-hoc nudges.

## Prior: `auto_tune` v1 (superseded for per-turn params)

| Target | v1 shipped |
|--------|------------|
| Per-turn planner `inference_delta` from baseline | **No** — planner does not emit inference fields |
| Baseline includes user `preferences_json.model_params` | **Partial** — seed uses purpose/endpoint only (`initialAutoState`, `resolveForSend`) |
| Micro-tune on send for current turn | **No** — uses prior `auto_state.params` as full layer |
| ACCS as secondary | **Yes** — **primary** loop today: `ChatInferenceAutoTune::adjustAfterAccs` after each ACCS upsert |

v1 behavior after orchestrator posts ACCS to `POST /chat/api/turn_score_upsert` (`plugin=accs`):

- Target ACCS ≈ 0.78
- Low ACCS: lower temperature, raise presence_penalty (bounded steps)
- High ACCS: slight temperature increase
- History capped at 24 entries under `auto_state.history`

## API

- `POST /chat/api/conversation_mode` — `inference_mode`, `model_params` (manual), `chat_endpoint_id` (seed auto_tune)
- `GET` conversations list — `inference_mode` per row
- Composer sun panel — Off / Auto tune / Manual (thread-scoped)

## Code (v1)

- `chat/default/library/ChatInferenceControl.php`
- `chat/default/library/ChatInferenceAutoTune.php`
- `chat/default/controller/api/send.php` — resolve + history
- `chat/default/controller/api/turn_score_upsert.php` — ACCS hook
- `chat/default/webassets/js/composer-model-params.js`

## v2 implementation notes (when built)

- Extend planner JSON schema / `RunPlan` meta with optional `inference_delta` (bounded keys, max step per key).
- `send.php`: `resolveForSend` loads baseline `[purpose, user_prefs]` then applies thread `auto_state` + request-time planner delta if present on run payload.
- Orchestrator: pass baseline in run request; apply delta in `run_executor_llm_stream` via shared helper with PHP.
- Demote or gate v1 ACCS-only tuning behind env / “feedback only” flag once planner path is live.
- UI copy: Auto = “Planner tunes sampling from your defaults each message”.

## Deferred UX (evaluate later — 2026-05-29)

**Per-turn applied parameters in chat UI** — data already persisted; no assistant-bubble UI yet.

| Source | When written | Contents (typical) |
|--------|----------------|-------------------|
| `message.meta.inference` | Orchestrator → `POST /chat/api/inference_turn_apply` (auto_tune) or send/stream snapshot | `mode`, `params_applied`, `source`, `baseline`, `delta` |
| `conversation.params_json.inference_control` | Composer Inference save / `conversation_mode` | Thread mode, `model_params` (manual), `auto_state.history` (auto_tune turns) |

**Product ask (recorded, not scheduled):** After each assistant reply, let users inspect **that turn’s** `params_applied` (and optional baseline/delta), alongside existing IQS/ACCS pills and **Logging** (pipeline timing only).

### Future: true conversation share (not shipped)

**Today:** `POST /chat/api/conversation_share` only mints `share_slug`; `GET resolve_share` reopens the thread for the **same signed-in owner** (workspace-scoped). There is **no** public / guest read-only share viewer yet.

**When real share ships**, the shared view should help recipients understand **why the thread felt accurate** — not only message text and IQS/ACCS pills, but **how inference parameters evolved turn-by-turn** (baseline → delta → `params_applied`, mode, `source`). That transparency supports:

- **Trust / explainability** — “this reply used temp 0.64 after planner nudged −0.06 from baseline 0.7.”
- **Training & eval later** — exportable per-turn inference trace + scores for fine-tuning, regression, or distillation datasets (pair with `turn_score`, materials, planner plan meta where allowed).

**Share viewer requirements (design backlog, evaluate with share epic):**

- Include `message.meta.inference` (and thread-level `inference_control.mode` summary) in the **read-only** payload served to guests; redact secrets (endpoint keys, internal tokens).
- UI: per-assistant-turn **Inference** strip or timeline (parameter deltas across turns), aligned with existing IQS/ACCS footer — same interaction patterns as owner UI where possible.
- Optional export hook (JSONL/Parquet) for ops — out of scope until share + privacy policy defined.
- Persist inference snapshots **before** share UI so shared links do not recompute history from live conversation state.

**Evaluation criteria (owner UI — when picked up):**

- Read path: `GET /chat/api/messages` already returns `meta` (decoded from `meta_json`); confirm inference block present for auto_tune runs before UI work.
- UX options: hover pill vs click card (mirror IQS/ACCS `showTurnScoreDimCard`); show for `off`/`manual` with resolved snapshot if send stores it.
- i18n + JIT-first; no duplicate of composer panel sliders.
- Out of scope for owner-only milestone: editing params retroactively; full `auto_state.history` admin timeline (unless folded into share viewer).

**Related today:** Composer **Inference** panel = thread-level mode; **Settings → Chat inference** = purpose `inference_params` defaults; reply footer = IQS/ACCS/`cite`/`scope` + **Logging** only; **Share** button copies owner reopen URL, not a public explainer page.
