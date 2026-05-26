# W3-S1 PR 計畫：移除預設弱密鑰 fallback

> 目標：消滅所有 `oaao_dev_shared_secret` 與類似明文預設值，改為 **fail-fast**（缺少 ENV 一律拒絕啟動或返回 503）。  
> Backlog 參考：[OAAO_90D_Jira_Linear_Backlog.md](OAAO_90D_Jira_Linear_Backlog.md#w3-s1)  
> Owner: `security-lead`（Python） + `php-lead`（Backbone） + `devops`（compose/env）  
> 預估：3 PR、約 30 個檔案、可分 2 天完成（含 review）

---

## 1. 風險與設計取捨

| 取捨 | 選 A（fail-fast） | 選 B（保留 dev fallback） |
|------|-------------------|---------------------------|
| 安全 | ✅ 0 明文預設 | ❌ grep 仍見明文 |
| Dev DX | ⚠ 缺 ENV 直接拒啟動，需要 `.env` 模板 | ✅ 開箱即用 |
| 生產風險 | ✅ 不會誤用 dev secret 上線 | ❌ 一旦遺漏 ENV 就走預設 |

**採用 A**。Dev DX 透過 `.env.example` 與 `docker-compose` 的 `${VAR:?msg}` 形式補償（缺值給出清楚錯誤）。

---

## 2. 修改清單（共 30 處）

### 2.1 Python（10 檔，11 處）

| # | 檔案 | 行號 | 現況 |
|---|------|------|------|
| 1 | [python/oaao_orchestrator/app.py](../python/oaao_orchestrator/app.py) | 343 | `os.environ.get("OAAO_ORCH_SHARED_SECRET", "oaao_dev_shared_secret")` |
| 2 | [python/oaao_orchestrator/run_principal.py](../python/oaao_orchestrator/run_principal.py) | 19 | 同上 |
| 3 | [python/oaao_orchestrator/run_executor.py](../python/oaao_orchestrator/run_executor.py) | 1034 | 同上 |
| 4 | [python/oaao_orchestrator/run_executor.py](../python/oaao_orchestrator/run_executor.py) | 1675 | 同上 |
| 5 | [python/oaao_orchestrator/post_stream_persist.py](../python/oaao_orchestrator/post_stream_persist.py) | 21 | `(os.environ.get(...) or "oaao_dev_shared_secret")` |
| 6 | [python/oaao_orchestrator/vault_speaker_profiles.py](../python/oaao_orchestrator/vault_speaker_profiles.py) | 23 | 同 #1 |
| 7 | [python/oaao_orchestrator/vault_job_poll.py](../python/oaao_orchestrator/vault_job_poll.py) | 86 | 同 #1 |
| 8 | [python/oaao_orchestrator/mine/usage.py](../python/oaao_orchestrator/mine/usage.py) | 17 | 同 #1 |
| 9 | [python/oaao_orchestrator/research/worker.py](../python/oaao_orchestrator/research/worker.py) | 24 | 同 #1 |
| 10 | [python/scripts/test_turn_score_upsert.py](../python/scripts/test_turn_score_upsert.py) | 12 | dev script，可保留警告但不應靜默使用 fallback |

### 2.2 PHP（14 檔，14 處）

| # | 檔案 | 行號 |
|---|------|------|
| 1 | [backbone/sites/oaaoai/oaaoai/vault/default/controller/vault.php](../backbone/sites/oaaoai/oaaoai/vault/default/controller/vault.php) | 206 |
| 2 | [backbone/sites/oaaoai/oaaoai/endpoints/default/controller/endpoints.php](../backbone/sites/oaaoai/oaaoai/endpoints/default/controller/endpoints.php) | 106 |
| 3 | [backbone/sites/oaaoai/oaaoai/chat/default/library/ChatRunPrincipal.php](../backbone/sites/oaaoai/oaaoai/chat/default/library/ChatRunPrincipal.php) | 106 |
| 4 | [backbone/sites/oaaoai/oaaoai/chat/default/library/ChatOrchestratorApi.php](../backbone/sites/oaaoai/oaaoai/chat/default/library/ChatOrchestratorApi.php) | 23 |
| 5 | [backbone/sites/oaaoai/oaaoai/chat/default/controller/api/send.php](../backbone/sites/oaaoai/oaaoai/chat/default/controller/api/send.php) | 516 |
| 6 | [backbone/sites/oaaoai/oaaoai/chat/default/controller/api/turn_score_upsert.php](../backbone/sites/oaaoai/oaaoai/chat/default/controller/api/turn_score_upsert.php) | 14 |
| 7 | [backbone/sites/oaaoai/oaaoai/chat/default/controller/api/attachments_dispose.php](../backbone/sites/oaaoai/oaaoai/chat/default/controller/api/attachments_dispose.php) | 19 |
| 8 | [backbone/sites/oaaoai/oaaoai/chat/default/controller/api/assistant_internal_sync.php](../backbone/sites/oaaoai/oaaoai/chat/default/controller/api/assistant_internal_sync.php) | 18 |
| 9 | [backbone/sites/oaaoai/oaaoai/chat/default/controller/api/asr_transcribe.php](../backbone/sites/oaaoai/oaaoai/chat/default/controller/api/asr_transcribe.php) | 60 |
| 10 | [backbone/sites/oaaoai/oaaoai/mine/default/controller/api/cron_run.php](../backbone/sites/oaaoai/oaaoai/mine/default/controller/api/cron_run.php) | 23 |
| 11 | [backbone/sites/oaaoai/oaaoai/mine/default/controller/api/export_vault.php](../backbone/sites/oaaoai/oaaoai/mine/default/controller/api/export_vault.php) | 107 |
| 12 | [backbone/sites/oaaoai/oaaoai/research/default/controller/api/_internal_auth.php](../backbone/sites/oaaoai/oaaoai/research/default/controller/api/_internal_auth.php) | 10 |
| 13 | [backbone/sites/oaaoai/oaaoai/research/default/controller/api/item_upsert.php](../backbone/sites/oaaoai/oaaoai/research/default/controller/api/item_upsert.php) | 16 |
| 14 | [backbone/sites/oaaoai/oaaoai/research/default/controller/api/cron_run.php](../backbone/sites/oaaoai/oaaoai/research/default/controller/api/cron_run.php) | 22 |

### 2.3 Infra / Scripts / Docs（5 項）

| # | 檔案 | 操作 |
|---|------|------|
| 1 | [docker-compose.yml](../docker-compose.yml) | L92, L138：`${OAAO_ORCH_SHARED_SECRET:-oaao_dev_shared_secret}` → `${OAAO_ORCH_SHARED_SECRET:?OAAO_ORCH_SHARED_SECRET is required}` |
| 2 | [docker/env.example](../docker/env.example) | L34：清空預設值，加註釋說明 `必填，啟動前請以 secret manager 注入` |
| 3 | [docker/env](../docker/env) | L32：若仍在 repo，需移到 `.gitignore` 並輪替當前值；列為獨立 task |
| 4 | [scripts/oaao_orchestrator_smoke.sh](../scripts/oaao_orchestrator_smoke.sh) | L6：移除 fallback，未設 ENV 直接 exit 1 |
| 5 | [docs/Debug_Guide.md](Debug_Guide.md) / [docs/Test_Catalog.md](Test_Catalog.md) | 文件示例改為 `OAAO_ORCH_SHARED_SECRET=<your-dev-secret>` |

---

## 3. 統一替換策略

### 3.1 Python — 新增中央 helper

新增檔案 `python/oaao_orchestrator/_internal_secret.py`：

```python
from __future__ import annotations
import os

_ENV_KEY = "OAAO_ORCH_SHARED_SECRET"


def require_internal_secret() -> str:
    """Return the internal shared secret or raise if unset/empty.

    Fail-fast at the first call site instead of silently signing
    requests with a well-known dev value.
    """
    value = (os.environ.get(_ENV_KEY) or "").strip()
    if not value:
        raise RuntimeError(
            f"{_ENV_KEY} is not set; refusing to use a default secret."
        )
    return value
```

每個 call site：

```python
# before
secret = os.environ.get("OAAO_ORCH_SHARED_SECRET", "oaao_dev_shared_secret").strip()
# after
from oaao_orchestrator._internal_secret import require_internal_secret
secret = require_internal_secret()
```

### 3.2 PHP — 新增中央 helper

新增 `backbone/sites/oaaoai/oaaoai/_shared/lib/internal_secret.php`（或專案既有 common 位置）：

```php
<?php
function oaao_require_internal_secret(): string
{
    $raw = getenv('OAAO_ORCH_SHARED_SECRET');
    $value = is_string($raw) ? trim($raw) : '';
    if ($value === '') {
        throw new \RuntimeException(
            'OAAO_ORCH_SHARED_SECRET is not set; refusing to use a default secret.'
        );
    }
    return $value;
}
```

每個 call site：

```php
// before
$secret = ($secret !== false && trim((string) $secret) !== '')
    ? trim((string) $secret)
    : 'oaao_dev_shared_secret';
// after
$secret = oaao_require_internal_secret();
```

---

## 4. PR 切片建議

| PR | 範圍 | Reviewer | 風險 | 滾回方式 |
|----|------|----------|------|----------|
| **PR-1**：infra & docs | docker-compose / env.example / smoke script / docs | devops + cto | 低 | revert |
| **PR-2**：Python helper + 全 Python 替換 | 10 檔（含新 helper）+ 對應單元測試 | security-lead + python-lead | 中 | revert（helper 模組獨立） |
| **PR-3**：PHP helper + 全 PHP 替換 | 14 檔 + helper require | security-lead + php-lead | 中 | revert |

每個 PR 必須包含：
- 對應 ENV 缺失情境的單元測試（Python：pytest；PHP：手動 curl + 503 期待）
- CI run 全綠
- `grep -r oaao_dev_shared_secret` 在範圍內結果為 0

---

## 5. 驗收標準（DoD）

1. 全 repo `grep -r "oaao_dev_shared_secret"` 僅剩於 `docs/Audit_Report.md` 等說明性文件
2. `OAAO_ORCH_SHARED_SECRET` 未設時：
   - orchestrator 啟動失敗並輸出明確錯誤
   - PHP 內部 token 簽發路徑回 503 + log
   - docker compose up 直接拒絕
3. 既有合法請求行為不變（chat / vault / research smoke 全綠）
4. CI 增加新測試：缺少 ENV → 預期錯誤碼

---

## 6. 風險與緩解

| 風險 | 緩解 |
|------|------|
| Dev 環境啟動失敗 | 提供 `docker/env.example`、`scripts/seed_dev_env.sh` 一鍵生成隨機值 |
| Cron / batch 作業遺漏 | grep `oaao_dev_shared_secret` 與 `OAAO_ORCH_SHARED_SECRET` 雙比對 |
| docker/env 是否在 git history 中有明文 | 列入後續 secret rotation task（W11-S1） |

---

## 7. 執行順序

```
Day 1 上午：PR-1（infra/docs） → 合併後 dev 環境改吃 .env
Day 1 下午：PR-2（Python）   → 合併、smoke 重跑
Day 2 上午：PR-3（PHP）       → 合併、回歸測試
Day 2 下午：CI gate 加入 grep check（防止回流）
```

CI 防回流（建議加在新 lint job）：

```yaml
- name: Forbid weak default secret literal
  run: |
    if grep -RIn --exclude-dir=docs --exclude-dir=.git 'oaao_dev_shared_secret' .; then
      echo "Weak default secret literal found"; exit 1
    fi
```
