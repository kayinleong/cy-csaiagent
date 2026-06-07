/**
 * scripts/loadtest/chat.js — k6 load-test harness for the D2 chat SSE endpoint.
 *
 * Target: /api/chat (the SSE producer at app/api/chat/route.ts:638 toUIMessageStreamResponse)
 * Simulates ~400 concurrent agents (D-11 requirement) sending chat turns.
 *
 * USAGE:
 *   k6 run -e TARGET=https://your-app-hosting-url -e TOKEN=<firebase-id-jwt> scripts/loadtest/chat.js
 *
 * DEPENDENCIES:
 *   - k6 binary (NOT an npm dep): brew install k6  OR  docker run grafana/k6
 *   - Do NOT run against production without Derek's approval. Use a staging stack.
 *
 * LIVE EXECUTION: Deferred to rollout prep (D-11 "code-ready this phase, executed during rollout").
 *   - Live execution requires a deployed App Hosting stack (asia-southeast1).
 *   - Results are documented in .planning/phases/05-hardening-scale/LOADTEST.md.
 *
 * SLOS / THRESHOLDS: Marked PROPOSED — final numbers are Derek's call (D-06/A4).
 *   Per CONTEXT.md: "Exact SLO/p95 numbers + 400-agent load profile shape are Derek's call."
 *
 * CONSTRAINT NOTE: This is dev/CI tooling hitting the deployed endpoint — it is NOT
 *   app infrastructure. k6 is not bundled into the Next.js app. No Cloud Functions
 *   or external schedulers are added. (RESEARCH Pitfall 7)
 *
 * SECURITY NOTE (T-05-01): TOKEN is passed via environment variable only.
 *   NEVER hard-code a Firebase ID token or any real JWT here.
 *   The diff is scanned before commit (CLAUDE.md secrets gate).
 */

import http from 'k6/http'
import { check, sleep } from 'k6'

// ─── Load-test configuration ──────────────────────────────────────────────────

/**
 * TARGET: the deployed App Hosting base URL (no trailing slash).
 * TOKEN: a valid Firebase ID token (from a test/pilot account — NOT a real agent).
 *
 * Both are injected via -e flags: never commit real values.
 */
const TARGET = __ENV.TARGET   // e.g. 'https://cy-csaiagent.web.app'
const TOKEN  = __ENV.TOKEN    // Firebase ID JWT — PROPOSED: use a test-account token

// ─── k6 scenario configuration ────────────────────────────────────────────────

export const options = {
  scenarios: {
    /**
     * chat_concurrent: Ramp to ~400 VUs (virtual users), hold for 5 minutes,
     * then ramp down. Each VU simulates one agent sending sequential chat turns.
     *
     * PROPOSED: 400 VUs, 5-minute hold, 30s ramp — Derek to confirm load shape (D-11/A4).
     */
    chat_concurrent: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },  // PROPOSED: ramp to 200 VUs in 30s
        { duration: '5m',  target: 400 },  // PROPOSED: hold at ~400 VUs (pilot agent count) for 5 min
        { duration: '30s', target: 0   },  // ramp down
      ],
    },
  },

  /**
   * Performance thresholds.
   * All values are PROPOSED — Derek approves the final SLO (D-06/A4).
   * These are conservative estimates based on the SSE streaming architecture
   * (first-token latency is lower than full-response p95).
   */
  thresholds: {
    // PROPOSED: final SLO is Derek's call (D-06/A4)
    // p95 full-response duration < 3s under 400 concurrent agents
    'http_req_duration': ['p(95)<3000'],
    // PROPOSED: error rate < 1% (includes 4xx/5xx from the chat endpoint)
    'http_req_failed': ['rate<0.01'],
    // PROPOSED: p50 (median) < 1.5s — interactive feel for the pilot agents
    'http_req_duration{percentile:50}': ['p(50)<1500'],
  },
}

// ─── Test scenario ────────────────────────────────────────────────────────────

/**
 * A single synthetic chat turn.
 * Uses a hardcoded safe question (no real lead data, no PII — T-05-02).
 *
 * WR-01 fix: app/api/chat/route.ts parses body.messages (not a bare array).
 * The previous bare-array body caused every request to 400 at the body-parse gate
 * before any auth/ratelimit/model logic ran, making the load test a silent no-op.
 */
const SAMPLE_CHAT_BODY = JSON.stringify({
  messages: [
    {
      role: 'user',
      content: 'What is the D2 onboarding process for new agents?',
    },
  ],
})

/**
 * Default function: executed by each VU on each iteration.
 * Sends one chat turn to the SSE endpoint and checks the response.
 *
 * NOTES:
 *   - The /api/chat endpoint returns an SSE stream (toUIMessageStreamResponse, route.ts:638).
 *   - k6 reads the full body (waits for stream end) — this measures full-response latency.
 *   - For first-token latency, use a custom streaming test (not in scope for pilot load test).
 */
export default function () {
  const url = `${TARGET}/api/chat`

  const params = {
    headers: {
      'Content-Type': 'application/json',
      // TOKEN is a Firebase ID JWT — injected via -e TOKEN=<jwt>, never hard-coded (T-05-01)
      'Authorization': `Bearer ${TOKEN}`,
      // Prevent proxy/load-balancer SSE buffering (mirrors X-Accel-Buffering: no in the route)
      'X-Accel-Buffering': 'no',
      // Required by the locale middleware (proxy.ts): default to English
      'Accept-Language': 'en',
    },
    timeout: '30s',  // SSE streams can take longer than the default k6 timeout
  }

  const res = http.post(url, SAMPLE_CHAT_BODY, params)

  // Checks: 200 response and body contains AI SDK SSE stream markers.
  // WR-01 fix: require status === 200 so a regression back to the 400 body-parse
  // gate is caught rather than masked.  The SSE body check ('data:' present)
  // further confirms the streaming path was actually exercised.
  check(res, {
    'status is 200': (r) => r.status === 200,
    // AI SDK SSE stream: the body should contain 'data:' lines (the SSE format).
    // A 200 with empty body indicates a streaming error in the route.
    'body contains SSE data marker': (r) => r.body !== null && (r.body as string).includes('data:'),
  })

  // Small think-time between turns to simulate realistic agent usage
  // PROPOSED: 1s think-time — adjust based on real D2 agent session cadence (A4)
  sleep(1)
}
