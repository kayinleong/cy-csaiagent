/**
 * src/jobs/heartbeat.ts — Job heartbeat writer (UI watchdog signal)
 *
 * Each lazy-cron job run upserts a heartbeat doc so a UI watchdog (Phase-2 banner)
 * can detect a missed window.  If no heartbeat appears within the expected
 * interval, the dashboard surfaces a "stall detection offline" alert.
 *
 * Collection: `jobHeartbeats/{jobName}` (adminDb direct write — no typed converter
 * needed; this is operational metadata, not user data).
 *
 * Per-doc structure:
 *   { job: string, ts: Timestamp, tenantId: 'd2' }
 *
 * Upserted with `{ merge: true }` so concurrent job runs don't conflict.
 *
 * References:
 *   - TSD §3.4 scheduled jobs (heartbeat doc per run; UI watchdog reads it)
 *   - TSD §9 cron heartbeats
 *   - 01-11 PLAN.md Task 2 (writeHeartbeat / readHeartbeat)
 *   - T-01-34 (DoS mitigation: heartbeat lets watchdog detect a lapsed schedule)
 *   - Pitfall F (missed cron window silently kills proactive value)
 */

import { adminDb } from '@/src/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { TENANT_ID } from '@/src/firebase/collections'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeartbeatDoc {
  job: string
  ts: ReturnType<typeof FieldValue.serverTimestamp>
  tenantId: typeof TENANT_ID
}

// ─── Collection ───────────────────────────────────────────────────────────────

const HEARTBEATS_COLLECTION = 'jobHeartbeats'

// ─── writeHeartbeat ───────────────────────────────────────────────────────────

/**
 * Upsert a heartbeat document for `jobName`.
 *
 * Called at the END of every successful job run.  The doc is identified by
 * job name so the watchdog knows exactly which job last ran and when.
 *
 * @param jobName  Stable job identifier (e.g. 'stall-detect').
 */
export async function writeHeartbeat(jobName: string): Promise<void> {
  await adminDb.collection(HEARTBEATS_COLLECTION).doc(jobName).set(
    {
      job: jobName,
      ts: FieldValue.serverTimestamp(),
      tenantId: TENANT_ID,
    },
    { merge: true }, // safe to run concurrently; last writer wins on ts
  )
}

// ─── readHeartbeat ────────────────────────────────────────────────────────────

/**
 * Read the latest heartbeat for `jobName`.
 *
 * Used by the Phase-2 watchdog to determine whether the job ran recently.
 * Returns `null` if no heartbeat has ever been written (job never ran).
 *
 * @param jobName  Stable job identifier (e.g. 'stall-detect').
 */
export async function readHeartbeat(
  jobName: string,
): Promise<{ job: string; ts: Date } | null> {
  const snap = await adminDb.collection(HEARTBEATS_COLLECTION).doc(jobName).get()
  if (!snap.exists) return null
  const data = snap.data() as {
    job: string
    ts: FirebaseFirestore.Timestamp
    tenantId: string
  }
  return {
    job: data.job,
    ts: data.ts.toDate(),
  }
}
