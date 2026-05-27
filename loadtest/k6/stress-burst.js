/**
 * W13-S1 stress burst — ramp 200 VUs over 60s, hold 5m.
 *
 * Run:
 *   k6 run loadtest/k6/stress-burst.js
 *   bash scripts/run_loadtest_k6.sh stress-burst
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Trend, Rate } from 'k6/metrics';
import { startChatRun } from './lib/helpers.js';

export const chatTtfb = new Trend('oaao_chat_ttfb_ms', true);
export const chatErrors = new Rate('oaao_chat_errors');

export const options = {
  scenarios: {
    stress_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s', target: Number(__ENV.OAAO_K6_VUS || 200) },
        { duration: __ENV.OAAO_K6_HOLD || '5m', target: Number(__ENV.OAAO_K6_VUS || 200) },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    oaao_chat_errors: ['rate<0.10'],
  },
};

export default function stressBurst() {
  const started = startChatRun(http, `stress vu=${__VU} iter=${__ITER}`);
  if (!started.ok) {
    chatErrors.add(1);
    check(null, { 'chat run started': () => false });
    return;
  }
  chatErrors.add(0);
  chatTtfb.add(started.timings.duration);
  check(started.data, { 'run_id present': (d) => Boolean(d && d.run_id) });
  sleep(Number(__ENV.OAAO_K6_SLEEP_SEC || 0.5));
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
