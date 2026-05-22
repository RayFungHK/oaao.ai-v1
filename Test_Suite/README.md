# Test Suite（oaao.ai-v1）

審計配套測試入口；**主要測試仍位於** `python/tests/`。

## 結構

| 路徑 | 說明 |
|------|------|
| `python/tests/` | 既有 pytest（pipeline、planner、vault RAG、live meeting） |
| `python/tests/support/llm_mock.py` | 可重用的 LLM / planner mock 輔助 |
| `python/tests/test_pipeline_hook_resilience.py` | Agent 失敗不拖垮 registry 契約 |
| `python/tests/test_orchestrator_bridge_contract.py` | PHP bridge 檔案結構契約（靜態） |

## 執行

```bash
# 與 CI 相同（bridge gate + 契約 + hook 測試）
bash scripts/ci_check.sh

# 完整 orchestrator app smoke（需較重依賴，見 requirements-orchestrator-app.txt）
pip install -r python/requirements-orchestrator-app.txt
cd python && python -m uvicorn oaao_orchestrator.app:app --host 127.0.0.1 --port 8103 &
OAAO_SMOKE_START_CHAT_RUN=1 OAAO_ORCHESTRATOR_INTERNAL_URL=http://127.0.0.1:8103 bash ../scripts/oaao_orchestrator_smoke.sh

# 嚴格模組隔離
bash scripts/audit_cross_module_requires.sh --gate   # bridge 模組
bash scripts/audit_cross_module_requires.sh          # 全樹 0 P0
```

## 尚未實作（見 Audit_Report §8）

- HTTP CLI smoke：`Message In → orchestrator → SSE Out`
- PHP Register 快照測試
- 統一 `Mock_Core` in-process 全鏈

詳見 [docs/Debug_Guide.md](../docs/Debug_Guide.md)。
