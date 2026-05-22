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
# 與 CI 相同（bridge gate + 契約測試）
bash scripts/ci_check.sh

# 或僅 Python（建議先 pip install -r python/requirements-dev.txt）
cd python && python -m pytest tests/test_orchestrator_bridge_contract.py tests/test_pipeline_hook_resilience.py -q

# 嚴格模組隔離 gate（chat / live-meeting / slide-designer）
bash scripts/audit_cross_module_requires.sh --gate
```

## 尚未實作（見 Audit_Report §8）

- HTTP CLI smoke：`Message In → orchestrator → SSE Out`
- PHP Register 快照測試
- 統一 `Mock_Core` in-process 全鏈

詳見 [docs/Debug_Guide.md](../docs/Debug_Guide.md)。
