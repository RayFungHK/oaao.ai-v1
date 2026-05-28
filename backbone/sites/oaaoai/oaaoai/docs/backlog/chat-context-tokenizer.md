# Backlog — Chat context tokenizer

**Shipped:** per-endpoint **chars/token heuristic** via `ChatTokenEstimator` (`claude`, `gpt`, `gemini`, `llama`, `default`); exposed as `tokenizer_profile` on `context_usage`.

## Follow-up

- Ship **tiktoken** (or provider API) behind feature flag for OpenAI-compatible models.
- Anthropic / Gemini official token APIs where licensed.
- Cache token counts on `message` rows after send for stable toolbar reads.
