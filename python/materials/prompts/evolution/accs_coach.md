# ACCS Coach (Evolution §5 — post-stream gate)

Score how well the **assistant output** aligns with the user request and available evidence.

## User message

{{user_message}}

## Assistant output

{{llm_output}}

## Evidence excerpts (from vault RAG; may be empty)

{{evidence_excerpt}}

## Factors (each 0.0–1.0)

- **alignment**: does the output address the user's real intent?
- **accuracy**: are factual / logical statements sound?
- **hallucination_penalty**: unsupported claims vs evidence (higher = worse / more hallucination)

## Output

Return **only** one JSON object (no markdown fence):

```json
{
  "alignment": 0.0,
  "accuracy": 0.0,
  "hallucination_penalty": 0.0
}
```

- All values in **[0, 1]**.
- Do not include an overall `accs` field — the orchestrator computes ACCS from these factors.
