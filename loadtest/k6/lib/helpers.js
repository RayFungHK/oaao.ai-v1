/**
 * Shared k6 helpers for OAAO load tests (W13-S1).
 * @see docs/W13_S1_LoadTest_GoNoGo.md
 */

export function orchBase() {
  return (__ENV.OAAO_ORCHESTRATOR_URL || 'http://127.0.0.1:8103').replace(/\/$/, '');
}

export function internalHeaders() {
  const secret = __ENV.OAAO_ORCH_SHARED_SECRET;
  if (!secret) {
    throw new Error('OAAO_ORCH_SHARED_SECRET is required');
  }
  return {
    'Content-Type': 'application/json',
    'X-OAAO-Internal-Token': secret,
  };
}

export function chatRunBody(message) {
  const baseUrl = __ENV.OAAO_CHAT_ENDPOINT_URL || 'http://127.0.0.1:9';
  const model = __ENV.OAAO_CHAT_MODEL || 'loadtest-stub';
  return JSON.stringify({
    messages: [{ role: 'user', content: message || 'loadtest ping' }],
    allowed_agents: ['vault_rag'],
    run_planner_mode: 'fixed',
    endpoint: {
      base_url: baseUrl,
      model: model,
      api_key_env: null,
    },
  });
}

/** POST /v1/runs/chat — returns parsed JSON or null. */
export function startChatRun(http, message) {
  const res = http.post(`${orchBase()}/v1/runs/chat`, chatRunBody(message), {
    headers: internalHeaders(),
    tags: { name: 'POST /v1/runs/chat' },
  });
  if (res.status !== 200) {
    return { ok: false, status: res.status, body: res.body };
  }
  try {
    const data = JSON.parse(res.body);
    return { ok: true, data, timings: res.timings };
  } catch (e) {
    return { ok: false, status: res.status, body: res.body };
  }
}

/** Measure first SSE byte latency for a run (optional; requires valid stream_token). */
export function streamFirstByteMs(http, runId, streamToken) {
  if (!runId || !streamToken) {
    return null;
  }
  const url = `${orchBase()}/v1/stream?run_id=${encodeURIComponent(runId)}&token=${encodeURIComponent(streamToken)}`;
  const res = http.get(url, {
    headers: { Accept: 'text/event-stream' },
    tags: { name: 'GET /v1/stream (first byte)' },
    timeout: '120s',
  });
  return res.timings.waiting;
}

export function fetchProfiling(http) {
  return http.get(`${orchBase()}/v1/admin/profiling`, {
    headers: internalHeaders(),
    tags: { name: 'GET /v1/admin/profiling' },
  });
}

export function fetchWorkQueues(http) {
  return http.get(`${orchBase()}/v1/work_queues/status`, {
    headers: internalHeaders(),
    tags: { name: 'GET /v1/work_queues/status' },
  });
}
