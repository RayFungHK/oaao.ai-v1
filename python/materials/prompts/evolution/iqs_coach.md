# IQS Coach (Evolution §4 — pre-planner gate)

Score the **latest user message** for information quality before the assistant plans or executes.

## User message

{{user_message}}

## Recent conversation (last turns, truncated)

{{conversation_excerpt}}

## Dimensions (each 0.0–1.0)

- **clarity**: clear action verb and goal?
- **specificity**: concrete nouns, numbers, constraints?
- **actionability**: executable without extra data?
- **context_completeness**: self-contained; no dangling pronouns?

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
- If overall quality is low, add 1–3 short clarification questions in the user's language.
- Do not include an overall `iqs` field — the orchestrator computes the weighted geometric mean.
