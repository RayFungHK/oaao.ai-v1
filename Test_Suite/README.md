# Test Suite（oaao.ai-v1）

**完整目錄** → [docs/Test_Catalog.md](../docs/Test_Catalog.md)

## 一鍵 Sandbox（改完先跑，不必等 user 點 UI）

```bash
# 快速：PHP lint + 模組隔離 + bridge/namespace 契約（~30s）
bash scripts/sandbox_check.sh

# 大改 / 送 PR 前：再加全量 pytest + Docker smoke（需 compose up）
bash scripts/sandbox_check.sh --all
```

| 腳本 | 用途 |
|------|------|
| `scripts/sandbox_check.sh` | 總入口（`--python` / `--docker` / `--all`） |
| `scripts/ci_check.sh` | 與 CI `bridge-and-contract` 對齊 |
| `scripts/php_lint_oaaoai.sh` | 全樹 `php -l` |
| `scripts/oaao_orchestrator_smoke.sh` | Sidecar HTTP |
| `scripts/audit_cross_module_requires.sh` | 跨模組 `require` |

## 結構

| 路徑 | 說明 |
|------|------|
| `python/tests/` | pytest（pipeline、planner、vault、live meeting、slide、**namespace contract**） |
| `python/tests/test_php_namespace_use_contract.py` | 攔 `Class not found`（缺 `use oaaoai\…`） |

除錯見 [docs/Debug_Guide.md](../docs/Debug_Guide.md)。
