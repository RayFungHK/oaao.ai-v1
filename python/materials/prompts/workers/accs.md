# Answer Coherence & Completion Score (ACCS)

Score how well the **assistant reply** completes the implied user request for this run.
Use only the metadata below; do not invent transcript text.

## Run metadata

- conversation_id: {{conversation_id}}
- assistant_message_id: {{assistant_message_id}}
- user_id: {{user_id}}
- workspace_id: {{workspace_id}}
- purpose_id: {{purpose_id}}
- mode_id: {{mode_id}}
- materials_count: {{materials_count}}
- task_count: {{task_count}}

## Output

Return **only** one JSON object (no markdown fence):

```json
{
  "accs": 0.0,
  "dimensions": {
    "completeness": 0.0,
    "coherence": 0.0,
    "actionability": 0.0
  },
  "reasons": {
    "completeness": "short rationale",
    "coherence": "short rationale",
    "actionability": "short rationale"
  }
}
```

- All scores are floats in **[0, 1]** (1 = best).
- `accs` is the overall answer quality estimate.
