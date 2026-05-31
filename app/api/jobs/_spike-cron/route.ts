/**
 * SPIKE-CRON — QStash signed callback endpoint
 *
 * Verifies the QStash HMAC signature on every incoming request.
 * Returns 401 on an invalid or absent signature (T-01-23 mitigation).
 * Returns 200 on a valid signature and writes a timestamp heartbeat to the
 * response body (live SPIKE-CRON confirmation of retry-on-5xx and IANA TZ
 * is performed via the QStash dashboard — see SPIKES.md SPIKE-CRON section).
 *
 * Trust boundary: QStash → /api/jobs/*  (T-01-23: forged callbacks)
 *   Mitigation: verifySignatureAppRouter wraps the handler; unsigned requests
 *   receive 401 before the handler body executes.
 *
 * References:
 *   - 01-RESEARCH.md lines 428–440 (verifySignatureAppRouter; 3 env vars; IANA TZ)
 *   - TSD §3.4 scheduled jobs (QStash HMAC-signed /api/jobs/*, retries, DLQ)
 *   - SPIKE-CRON pass criteria: verifies, retries on 5xx, honors Asia/Kuala_Lumpur
 *   - CLAUDE.md: Next.js 16 — Route Handler, never Server Action
 *
 * Live pre-requisites (for the human-action SPIKE-CRON phase):
 *   QSTASH_CURRENT_SIGNING_KEY=<from Upstash console>
 *   QSTASH_NEXT_SIGNING_KEY=<from Upstash console>
 *
 * Signature-verify loading order (verifySignatureAppRouter internals):
 *   1. config.currentSigningKey / config.nextSigningKey (if provided explicitly)
 *   2. QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY env vars (default)
 */

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

/**
 * The underlying handler — only called if verifySignatureAppRouter passes the
 * HMAC check.  For the spike, it simply echoes the timestamp and any body.
 */
async function handler(req: Request): Promise<Response> {
  let body: string | null = null
  try {
    body = await req.text()
  } catch {
    body = null
  }

  const heartbeat = {
    job: '_spike-cron',
    receivedAt: new Date().toISOString(),
    timezone: 'Asia/Kuala_Lumpur',
    bodyLength: body?.length ?? 0,
  }

  // In production jobs, write heartbeat to Firestore here.
  // For the spike, we log and return it so the QStash dashboard can verify.
  console.log('[_spike-cron] heartbeat', heartbeat)

  return Response.json(heartbeat, { status: 200 })
}

/**
 * POST /api/jobs/_spike-cron
 *
 * Wrapped with verifySignatureAppRouter — requests without a valid QStash
 * HMAC signature are rejected with 401 before the handler body runs.
 *
 * The QStash schedule should be configured with:
 *   - Cron: "0 9 * * 1"  (Monday 09:00 Asia/Kuala_Lumpur)
 *   - Timezone: Asia/Kuala_Lumpur
 *   - Destination: https://<app-hosting-url>/api/jobs/_spike-cron
 *   - Retries: 3 (default)
 */
export const POST = verifySignatureAppRouter(handler)
