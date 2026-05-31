/**
 * app/api/jobs/stall-detect/route.ts — QStash-signed stall detection cron callback
 *
 * This is the ONE sanctioned non-Firebase dependency for background jobs
 * (QStash → HMAC-signed /api/jobs/*) — no Cloud Functions, no Cloud Scheduler.
 *
 * Trust boundary: QStash → /api/jobs/stall-detect (T-01-33)
 *   - verifySignatureAppRouter wraps the handler
 *   - Unsigned or tampered requests are rejected with 401 BEFORE the handler runs
 *   - Signing keys sourced from QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY
 *     (Secret Manager in production; .env.local in development)
 *
 * Handler logic (only runs on verified requests):
 *   1. findStalled({ days: 2 }) — agents inactive 2+ days via agentProfiles.lastActiveAt
 *   2. emitHandoffSignal({ reason: 'stall', ... }) for each stalled agent
 *   3. writeHeartbeat('stall-detect') — upserts timestamp for UI watchdog (T-01-34)
 *   4. Returns { processed: N }
 *
 * QStash schedule (configure in Upstash dashboard):
 *   - Cron: "0 9 * * *" (daily 09:00 Asia/Kuala_Lumpur — adjust as needed)
 *   - Timezone: Asia/Kuala_Lumpur
 *   - Destination: https://<app-hosting-url>/api/jobs/stall-detect
 *   - Retries: 3 (QStash default; 5xx triggers a retry — heartbeat idempotent)
 *
 * SPIKE-CRON fallback: if QStash is unavailable, a GitHub Actions workflow can
 * call this endpoint with a manually constructed HMAC signature — see
 * .planning/phases/01-foundations/SPIKES.md SPIKE-CRON section (D-05).
 *
 * References:
 *   - TSD §3.4 scheduled jobs
 *   - 01-11 PLAN.md Task 2
 *   - 01-PATTERNS.md app/api/jobs/stall-detect/route.ts row
 *   - 01-08 SPIKE-CRON: verifySignatureAppRouter confirmed
 *   - NEVER log the signing key; NEVER hard-code model IDs (not applicable here)
 *
 * Runtime: Node (required for Firebase Admin SDK)
 * Method: POST only (QStash delivers via POST)
 */

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { findStalled, emitHandoffSignal } from '@/src/escalation'
import { writeHeartbeat } from '@/src/jobs/heartbeat'

// Force Node.js runtime — Firebase Admin SDK requires Node (not Edge).
export const runtime = 'nodejs'

// ─── Inner handler (only called after signature verification) ──────────────────

/**
 * Core stall-detect job logic.
 *
 * Finds agents inactive for 2+ days, emits a handoff escalation signal for
 * each, and writes a heartbeat so the Phase-2 UI watchdog can detect a
 * missed cron window.
 *
 * Returns: `{ processed: N }` where N is the number of stalled agents found.
 */
async function handler(_req: Request): Promise<Response> {
  // Step 1: Find stalled agents (lastActiveAt < now - 2 days)
  const stalled = await findStalled({ days: 2 })

  // Step 2: Emit a handoff signal for each stalled agent
  // emitHandoffSignal has its own dedup guard — safe to call on each run
  for (const agent of stalled) {
    await emitHandoffSignal({
      agentUid: agent.agentUid,
      seniorCoachId: agent.seniorCoachId,
      reason: 'stall',
      contextBundle: {
        lastActiveAt: agent.lastActiveAt,
        // Note: no raw PII — only technical metadata (T-01-36 / PDPA)
      },
    })
  }

  // Step 3: Write heartbeat — must run even when stalled.length === 0
  // The watchdog reads this to confirm the cron is alive (T-01-34, Pitfall F)
  await writeHeartbeat('stall-detect')

  return Response.json({ processed: stalled.length })
}

// ─── Exported POST handler (signature-verified) ───────────────────────────────

/**
 * POST /api/jobs/stall-detect
 *
 * Wrapped with verifySignatureAppRouter — requests without a valid QStash
 * HMAC signature (upstash-signature header) are rejected with 401 before
 * the handler body executes (T-01-33 mitigation).
 *
 * Key rotation: verifySignatureAppRouter tries QSTASH_CURRENT_SIGNING_KEY
 * first, then QSTASH_NEXT_SIGNING_KEY — handles rotation transparently.
 */
export const POST = verifySignatureAppRouter(handler)
