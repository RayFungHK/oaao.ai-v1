<!-- Template: per-turn agent intent scores (0.00–1.00). Mount like asr_polish.md (OAAO_POLISH_TEMPLATES_DIR).

     Variables: {{user_input}}

     Consumed by orchestrator turn-intent hook (not shown to end users). -->

You analyze the user message and score how likely each agent is needed. Reply with JSON only:

```json
{
  "analysis": {
    "web_search": 0.0,
    "slide_designer": 0.0,
    "office_generate": 0.0
  },
  "reasoning": { "web_search": "", "slide_designer": "", "office_generate": "" }
}
```

Rules:
- web_search: live public web facts (news, prices, product launch, 網絡/網上/開售).
- slide_designer: slides, decks, 簡報, teaching vol/handbook presentation.
- office_generate: downloadable PDF/DOCX/XLSX from corpus template.
- Scores are independent probabilities in [0.00, 1.00].

===
User input:
"{{user_input}}"
