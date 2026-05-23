# Test_Suite — oaao.ai-v1 黑箱／韌性層

> 與既有 `python/tests/` 並存：`python/tests/` 是模組單元測試；本目錄是 **無 UI、無 HTTP、CLI 可獨立執行** 的 Hook 整合 + 失敗韌性 + Message-In/Out smoke 層。

完整測試目錄總覽 → [docs/Test_Catalog.md](../docs/Test_Catalog.md)  
除錯與失敗訊息 → [docs/Debug_Guide.md](../docs/Debug_Guide.md)

---

## 一鍵跑全部

```bash
cd oaao.ai-v1
python -m pytest Test_Suite -q
```

## CLI Smoke（Message In → Hook Chain → Response Out）

```bash
cd oaao.ai-v1
python -m Test_Suite.smoke.cli_smoke "你好，oaao"

# 完整 envelope tracing
python -m Test_Suite.smoke.cli_smoke "ping" --trace
# 或環境變數：OAAO_TRACE=1 python -m Test_Suite.smoke.cli_smoke "ping"
```

退出碼：`0` = agent 成功；`1` = agent 失敗。**全程不打外網、不打 PHP、不啟 FastAPI。**

---

## 目錄結構

| 路徑 | 用途 |
|------|------|
| `conftest.py` | 共用 fixture：autouse reset agent registry、`stream_run`、`run_ctx`、`mock_llm` |
| `mocks/llm_mock.py` | 轉發 `python/tests/support/llm_mock`（避免雙份） |
| `mocks/mock_core.py` | `MockCore` 攝錄 `StreamEnvelope`；`StubAgent` / `BoomAgent` |
| `integration/test_pipeline_event_flow.py` | Hook A `AgentResult.extra` → Hook B `RunContext.extra` 傳遞契約 |
| `smoke/cli_smoke.py` | CLI 入口；註冊 `EchoAgent` 跑單輪 |
| `smoke/test_smoke_message_in_out.py` | CI 版 smoke |
| `resilience/test_hook_exception_isolation.py` | 已知 agent 拋錯：registry propagate / executor 模式 catch / 後續 agent 不受影響 |
| `resilience/test_unknown_agent_kind.py` | 未註冊 agent_kind 必須回 `AgentResult(success=False)`，**不** 拋錯 |
| `evolution/test_iqs_low_score_triggers_clarification.py` | **Phase 8 契約凍結** — IQS 維度拆解、低分→Clarify、熔斷→skip、幾何平均 |
| `evolution/test_accs_low_score_triggers_reflection.py` | **Phase 8 契約凍結** — ACCS 三因子、Reflection 最多 1 輪、`OAAO_REFLECTION_DISABLE` 短路、≥0.85 標 crystallization_candidate |
| `evolution/test_skill_self_crystallize.py` | **Phase 9 契約凍結** — Sealer 雙寫 Qdrant + Arango、degraded 不結晶、Recall sim ≥ 0.88、usage_count bump |
| `perf/test_circuit_breaker_opens.py` | **Phase 8 契約凍結** — 失敗 3 次 open、`BreakerOpen` 短路、half_open 探針、named breakers 隔離 |
| `perf/test_kv_pool_under_concurrency.py` | **Phase 8 契約凍結** — KV 池 ≥85% → 503 retry-after=2s、in-flight reservation 不雙花 |
| `perf/test_two_box_failover.py` | **Phase 10 契約凍結** — `pick_base_url` round_robin / tiered (mode_id ∈ {tot,ddtree} → Box1)、ASR 釘 Box2、不健康時 fallback、legacy `base_url` 相容 |

> **契約凍結測試 (evolution/ + perf/)**：以 `pytest.importorskip` 在模組層 skip，Phase 8/9/10 未落地前永遠綠燈。一旦對應模組 (`evaluation.iqs` / `evaluation.accs` / `evaluation.reflection` / `safety.circuit_breaker` / `safety.kv_pool_guard` / `crystallization.sealer` / `crystallization.recall` / `endpoint.pick_base_url`) 出現，這些測試**自動激活**，實作必須通過。視為 Phase 8/9/10 的 acceptance criteria。

## 快速命令

```bash
# 全部跑（Phase 6 綠 9 個 + Phase 8/9/10 spec skip 6 個 module）
pytest Test_Suite -q

# 只跑黑箱基線
pytest Test_Suite/integration Test_Suite/smoke Test_Suite/resilience -q

# 跑 Phase 8 契約（落地後自動激活）
pytest Test_Suite/evolution -q
pytest Test_Suite/perf -q
```

## 與 `python/tests/` 的分工

| 層 | 位置 | 適用情境 |
|---|---|---|
| 單元測試 | `python/tests/test_*.py` | 模組內部邏輯（planner、slide、live-meeting、ASR …） |
| Hook 韌性凍結 | `python/tests/test_pipeline_hook_resilience.py` | 既有契約 |
| **黑箱整合 / Smoke** | **本目錄** | **改完模組後 30 秒驗證 Hook 鏈未斷、CLI 仍可回應** |

## 相關腳本

| 腳本 | 用途 |
|------|------|
| `scripts/sandbox_check.sh` | lint + 模組隔離 + bridge 契約（不含本目錄） |
| `scripts/oaao_orchestrator_smoke.sh` | Sidecar HTTP smoke（**會** 啟 uvicorn） |

---

## 加新測試的規矩

1. **不要** 從 `oaao_orchestrator.<mod>` import 任何 `_underscore` 名稱（見 [Audit_Report §6.1](../docs/Audit_Report.md)）。
2. **不要** 直呼 `httpx`、檔案系統、Qdrant、Arango 等外部資源 — 用 `mocks/mock_core.MockCore` + `mocks/llm_mock.LlmMock`。
3. 每個測試開頭的 `reset_agent_registry_for_tests` 已由 `conftest.py` autouse 包辦。
4. 新測試若需共用 fixture，加在 `conftest.py`；不要在測試檔內 import private state。
