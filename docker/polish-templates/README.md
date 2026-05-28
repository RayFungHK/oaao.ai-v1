# ASR polish template prompts

Edit `asr_polish.md` to change voice-composer LLM polish behaviour without redeploying Python code.

| Variable   | Source |
|-----------|--------|
| `{{style}}`  | User preference: `formal` / `natural` / `concise` |
| `{{locale}}` | User display language, e.g. `zh-Hant` |
| `{{raw}}`    | Merged ASR transcript (quoted) |

Optional style-specific files (set `OAAO_POLISH_TEMPLATE_REF=asr_polish_formal.md` in `docker/env`):

- `asr_polish.md` — default (all styles via `{{style}}`)
