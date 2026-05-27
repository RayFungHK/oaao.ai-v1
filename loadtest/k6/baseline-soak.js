/**
 * W13-S1 baseline soak — 20 VUs, 30 minutes.
 *
 * Env:
 *   OAAO_ORCH_SHARED_SECRET (required)
 *   OAAO_ORCHESTRATOR_URL   (default http://127.0.0.1:8103)
 *   OAAO_CHAT_ENDPOINT_URL  (upstream LLM base_url for chat run)
 *   OAAO_CHAT_MODEL
 *
 * Run:
 *   k6 run loadtest/k6/baseline-soak.js
 *   bash scripts/run_loadtest_k6.sh baseline-soak
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Trend, Rate } from 'k6/metrics';
import { startChatRun, streamFirstByteMs } from './lib/helpers.js';

export const chatTtfb = new Trend('oaao_chat_ttfb_ms', true);
export const chatErrors = new Rate('oaao_chat_errors');

export const options = {
  scenarios: {
    baseline_soak: {
      executor: 'constant-vus',
      vus: Number(__ENV.OAAO_K6_VUS || 20),
      duration: __ENV.OAAO_K6_DURATION || '30m',
    },
  },
  thresholds: {
    oaao_chat_errors: ['rate<0.05'],
    oaao_chat_ttfb_ms: ['p(95)<1500', 'p(99)<2500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function baselineSoak() {
  const msg = `loadtest vu=${__VU} iter=${__ITER} ts=${Date.now()}`;
  const started = startChatRun(http, msg);
  if (!started.ok) {
    chatErrors.add(1);
    check(null, { 'chat run started': () => false });
    sleep(1);
    return;
  }
  chatErrors.add(0);
  const data = started.data;
  check(data, {
    'run_id present': (d) => Boolean(d && d.run_id),
  });

  const ttfb = streamFirstByteMs(http, data.run_id, data.stream_token);
  if (ttfb != null) {
    chatTtfb.add(ttfb);
  }

  sleep(Number(__ENV.OAAO_K6_SLEEP_SEC || 2));
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
