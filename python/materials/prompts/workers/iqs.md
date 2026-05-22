# Input Quality Score (IQS)

Score the **user turn + assistant reply** for this chat run using only the metadata below.
Do not invent facts. If context is insufficient, use mid-range scores and say so in `reasons`.

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
  "iqs": 0.0,
  "dimensions": {
    "clarity": 0.0,
    "relevance": 0.0,
    "grounding": 0.0
  },
  "reasons": {
    "clarity": "short rationale",
    "relevance": "short rationale",
    "grounding": "short rationale"
  }
}
```

- All scores are floats in **[0, 1]** (1 = best).
- `iqs` is the overall input/turn quality estimate (weighted toward user intent clarity and assistant appropriateness).
