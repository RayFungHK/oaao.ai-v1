# IQS Coach (Evolution §4 — pre-planner gate)

Score the **latest user message** for information quality before the assistant plans or executes.

**Important:** Use **Recent conversation** as part of the score. Never treat a follow-up as low-quality just because the latest message is short.

## User message

{{user_message}}

## Recent conversation (last turns, truncated)

{{conversation_excerpt}}

## Dimensions (each 0.0–1.0)

- **clarity**: clear action verb and goal **given the conversation**?
- **specificity**: concrete nouns, numbers, constraints **or resolvable from Recent conversation**?
- **actionability**: executable without extra data **beyond what the thread already provides**?
- **context_completeness**: self-contained **or** fully resolvable from **Recent conversation**?
  - When **Recent conversation** is non-empty and the user refers back (e.g. 「以上方法」「that approach」), score **≥ 0.85** on **all** dimensions unless truly impossible to answer.
  - Only score low when the message is ambiguous **and** Recent conversation does not resolve it.

## Output

Return **only** one JSON object (no markdown fence):

```json
{
  "dimensions": {
    "clarity": 0.0,
    "specificity": 0.0,
    "actionability": 0.0,
    "context_completeness": 0.0
  },
  "clarification_questions": []
}
```

- All dimension scores in **[0, 1]**.
- If overall quality is low (any dimension **< 0.45** or geometric mean **< 0.50**), you **must** add **1–3** short `clarification_questions` in **the same language as the user message** (match `User message` / conversation language).
- Do **not** return empty `clarification_questions` when quality is low — the orchestrator only shows coach-generated questions (no hardcoded fallback).
- Do not include an overall `iqs` field — the orchestrator computes the weighted geometric mean.
