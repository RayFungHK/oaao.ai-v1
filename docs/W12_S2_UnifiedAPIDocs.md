# W12-S2 — Unified API Docs Entry (FastAPI + PHP)

Single discovery surface for every public/internal HTTP endpoint across the stack.

## 1. FastAPI orchestrator

**OpenAPI auto-generated:** `GET /openapi.json`  
**Swagger UI:** `GET /docs`  
**ReDoc:** `GET /redoc`

These reflect the live route table assembled in [app.py](../python/oaao_orchestrator/app.py) plus the routers in [routes/](../python/oaao_orchestrator/routes/) (admin / health). 48 routes registered at last verification (W5-S1).

### Authentication

| Header / Query | Where | Purpose |
| --- | --- | --- |
| `X-OAAO-Internal-Token` | All `/v1/*` admin + run endpoints | Shared secret — see [W11_S1_SecretsRotationDrill.md](W11_S1_SecretsRotationDrill.md) |
| `?token=` | `GET /v1/stream`, `GET /v1/live/{id}/stream`, `WS /v1/live/{id}/audio` | Per-run / per-session stream token — see [stream_token.py](../python/oaao_orchestrator/stream_token.py) |

### Error contract

All non-200 responses follow [contracts/v1/error.json](../contracts/v1/error.json) shape: `{code, message, request_id?, details?}`. Codes mirrored on PHP via [OaaoErrorCode.php](../backbone/sites/oaaoai/oaaoai/core/default/library/OaaoErrorCode.php).

## 2. PHP Razy backbone

Razy controllers do not auto-emit OpenAPI. The canonical list:

| Path | Method | Controller | Notes |
| --- | --- | --- | --- |
| `/vault/api/job/{action}` | POST | `vault.php` | Internal token only |
| `/vault/storage/{ref}` | GET | `vault.php` (delegates to `VaultStorageUtil::streamBinaryFile`) | Range 206/416 support |
| `/chat/run` | POST | `chat.php` | Public — proxied through Razy auth |

Full enumeration: `scripts/list_php_routes.php` (W12-S2 follow-up — emit JSON for ingestion by the unified docs page).

## 3. Versioning policy

- `/v1/*` is the stable surface. Breaking changes require a `/v2/*` parallel deploy.
- Contract schemas under [contracts/v1/](../contracts/v1/) are the source of truth; both FastAPI Pydantic models and PHP `JsonSchema` consumers MUST stay aligned (W7-S1 contract tests guard this).

## 4. Discovery URL (production)

| Asset | URL |
| --- | --- |
| Swagger UI | `https://api.<env>.oaao.ai/docs` |
| Raw OpenAPI | `https://api.<env>.oaao.ai/openapi.json` |
| Contracts repo | `https://api.<env>.oaao.ai/contracts/v1/<name>.json` (W12-S2 follow-up — wire static route) |

## 5. Local discovery

```powershell
cd oaao.ai-v1/python
uvicorn oaao_orchestrator.app:app --reload
# Then open http://localhost:8000/docs
```
