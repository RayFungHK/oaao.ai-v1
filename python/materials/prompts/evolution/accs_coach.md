# ACCS Coach (Evolution §5 — post-stream gate)

Score how well the **assistant output** aligns with the user request and available evidence.

## User message

{{user_message}}

## Assistant output

{{llm_output}}

## Evidence excerpts (from vault RAG; may be empty)

{{evidence_excerpt}}

## Vault grounding context

{{grounding_context}}

## Factors (each 0.0–1.0)

Score the **assistant output** against the user message **and** the evidence above.

- **alignment**: does the output address the user's real intent (including confirmation questions like “is there X in Vault?”)?
- **accuracy**: factual / logical soundness **plus**:
  - **citation fidelity** — claims about what is or is **not** in the sources match the evidence excerpts;
  - **source-scope analysis** — when evidence lacks the requested item but contains related material, explaining what *was* retrieved vs what was asked is accurate (not a failure).
- **hallucination_penalty**: unsupported claims vs evidence (higher = worse / more hallucination).

### Vault / RAG scoring rules (important)

1. If the user asks whether something exists in Vault / uploaded documents / retrieved excerpts, and the assistant correctly states it is **not present** in the provided evidence, score **high alignment and accuracy** (typically ≥ 0.80) when the answer stays scoped to retrieved sources.
2. Do **not** penalize alignment because the user wanted data that genuinely is absent — honest “not found in these sources” is a **good** answer.
3. If passages were retrieved but do not contain the requested topic, an answer that (a) states the absence, and (b) summarizes what the excerpts **do** cover, shows strong citation fidelity and source-scope analysis.
4. Only raise **hallucination_penalty** when the assistant invents documents, quotes, or facts not supported by the evidence excerpts.
5. Low accuracy applies when the assistant claims something is in the sources but evidence contradicts it, or ignores retrieved excerpts while pretending to be source-grounded.

## Output

Return **only** one JSON object (no markdown fence):

```json
{
  "alignment": 0.0,
  "accuracy": 0.0,
  "hallucination_penalty": 0.0,
  "citation_fidelity": 0.0,
  "source_analysis": 0.0
}
```

- All values in **[0, 1]**.
- **citation_fidelity**: claims about source content (present / absent) match evidence.
- **source_analysis**: distinguishes what was asked vs what sources actually contain.
- Do not include an overall `accs` field — the orchestrator computes ACCS from these factors.
