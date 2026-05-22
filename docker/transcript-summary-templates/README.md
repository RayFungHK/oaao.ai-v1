# Transcript summary templates

HiNote-style **Customize Summary** prompts for **View Transcript**.

Each `*.md` file is one template:

- YAML front matter: `id`, `label`, `emoji`, `beta`, `default`, `sort`
- Body: system prompt sent to the LLM (Settings → **vault.*** purpose allocation)

Default template: **General Meeting** (`general-meeting.md`).

## Docker

Mounted read-only into the `web` container:

```text
./docker/transcript-summary-templates → /var/www/html/config/transcript-summary-templates
```

Override in `.env`:

```bash
OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_PATH=./docker/transcript-summary-templates
OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_DIR=/var/www/html/config/transcript-summary-templates
```

After editing templates on the host, reopen **View Transcript** (no rebuild required).

## Regenerate all templates

```bash
python3 docker/transcript-summary-templates/generate_templates.py
```

Then customize individual `.md` files as needed.
