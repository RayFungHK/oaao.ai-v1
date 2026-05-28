# SearXNG (Compose service `searxng`)

Internal meta-search for:

- Chat **web_search** agent (`OAAO_SEARXNG_URL` → `/search?format=json`)
- Knowledge refresh workers (`knowledge.search_plan`)

Not exposed publicly by default; orchestrator calls `http://searxng:8080` on the Compose network.

Optional host debug port: set `OAAO_SEARXNG_HOST_PORT` in `docker/env` (default `8088`).

Edit `settings.yml` to tune engines; restart `docker compose up -d searxng`.
