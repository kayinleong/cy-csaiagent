/**
 * src/jobs/runDueJobs.ts — On-visit lazy-cron job runner
 *
 * Replaces QStash-scheduled /api/jobs/* routes with a last-run-guarded job
 * runner that fires from authenticated page visits. Each job has a window (in
 * milliseconds); if the last run was more than one window ago the job executes,
 * otherwise it is skipped cheaply (single doc read).
 *
 * Concurrency safety: `runJob` uses a Firestore transaction to read-then-write
 * the last-run doc. Two concurrent visits racing through the same window will
 * both see the same lastRunAt on their reads, but only one transaction will win
 * the write — the loser's transaction is retried by Firestore and will then see
 * the updated lastRunAt and skip the job body. This gives exactly-once-per-window
 * semantics under concurrent load without any external lock.
 *
 * Last-run ledger: `jobRuns/{jobName}` document with:
 *   { jobName, lastRunAt: Timestamp, tenantId: 'd2' }
 *
 * Phase-1 jobs registered:
 *   - stall-detect  (daily window: 24 h) — runs findStalled + emitHandoffSignal
 *   - escalate      (no-op stub — Phase 2)
 *   - eval-nightly  (no-op stub — Phase 3)
 *   - usage-rollup  (no-op stub — Phase 3)
 *
 * References:
 *   - TSD §3.4 scheduled jobs
 *   - Decision override 2026-06-01: on-visit lazy-cron Server Action
 *   - T-01-34 (heartbeat / watchdog signal)
 */

import { adminDb } from '@/src/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { findStalled, emitHandoffSignal } from '@/src/escalation'
import { writeHeartbeat } from '@/src/jobs/heartbeat'
import { TENANT_ID } from '@/src/firebase/collections'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobRunDoc {
  jobName: string
  lastRunAt: Timestamp
  tenantId: typeof TENANT_ID
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_RUNS_COLLECTION = 'jobRuns'

/** One full day in milliseconds — default window for daily jobs. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// ─── Job registry ─────────────────────────────────────────────────────────────

interface JobDefinition {
  /** Window duration in ms — job fires at most once per window. */
  windowMs: number
  /** Job body — only called when the job is due. Must be idempotent. */
  run: () => Promise<void>
}

/**
 * All registered jobs.
 *
 * Add future jobs here. Stub entries (no-op run) serve as seams that already
 * have last-run tracking in place, so wiring the body in a future plan does not
 * require touching the ledger or the trigger.
 */
const JOB_REGISTRY: Record<string, JobDefinition> = {
  'stall-detect': {
    windowMs: ONE_DAY_MS,
    run: async () => {
      const stalled = await findStalled({ days: 2 })
      for (const agent of stalled) {
        await emitHandoffSignal({
          agentUid: agent.agentUid,
          seniorCoachId: agent.seniorCoachId,
          reason: 'stall',
          contextBundle: {
            lastActiveAt: agent.lastActiveAt,
            // No raw PII — technical metadata only (T-01-36 / PDPA)
          },
        })
      }
      await writeHeartbeat('stall-detect')
    },
  },

  // ── Phase-2 stubs — wire bodies when the pillar lands ─────────────────────
  escalate: {
    windowMs: ONE_DAY_MS,
    // TODO(Phase-2): escalate overdue open escalations to senior coach queue
    run: async () => {},
  },

  // ── Phase-3 stubs ──────────────────────────────────────────────────────────
  'eval-nightly': {
    windowMs: ONE_DAY_MS,
    // TODO(Phase-3): run Promptfoo eval suite and write results to evals/
    run: async () => {},
  },
  'usage-rollup': {
    windowMs: ONE_DAY_MS,
    // TODO(Phase-3): roll up per-agent token/request counts into billing summary
    run: async () => {},
  },
}

// ─── Core: run a single job inside a Firestore transaction ────────────────────

/**
 * Attempt to run `jobName` if it is due (now - lastRunAt >= windowMs).
 *
 * Uses a Firestore transaction so concurrent visitors racing through the same
 * window cannot double-run the job body:
 *   - Both reads see the same (old) lastRunAt → both evaluate isDue = true.
 *   - The transaction that writes first wins; the other transaction is retried
 *     by the Firestore SDK, now sees a fresh lastRunAt, evaluates isDue = false,
 *     and commits a no-op.
 *
 * @returns `true` if the job ran, `false` if skipped (not due or no definition).
 */
export async function runJob(jobName: string, now: Date = new Date()): Promise<boolean> {
  const def = JOB_REGISTRY[jobName]
  if (!def) return false

  const docRef = adminDb.collection(JOB_RUNS_COLLECTION).doc(jobName)

  let shouldRun = false

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef)

    if (snap.exists) {
      const data = snap.data() as JobRunDoc
      const lastRunMs = data.lastRunAt.toMillis()
      shouldRun = now.getTime() - lastRunMs >= def.windowMs
    } else {
      // Job has never run — treat as due
      shouldRun = true
    }

    if (shouldRun) {
      // Stake the claim — update lastRunAt inside the transaction so the loser
      // of a concurrent race sees this write on its retry and skips the body.
      tx.set(docRef, {
        jobName,
        lastRunAt: Timestamp.fromDate(now),
        tenantId: TENANT_ID,
      })
    }
  })

  if (shouldRun) {
    await def.run()
  }

  return shouldRun
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Run all registered jobs that are currently due.
 *
 * Called by the Server Action on authenticated page visits. Each job is run
 * sequentially; a failure in one job is caught and logged so other jobs still
 * run. Returns a summary of which jobs ran and which were skipped.
 *
 * Error handling is intentionally non-fatal — a transient Firestore error must
 * not block the page from rendering.
 *
 * @param now Injectable clock for unit tests (defaults to `new Date()`).
 */
export async function runDueJobs(now: Date = new Date()): Promise<{
  ran: string[]
  skipped: string[]
  errors: Array<{ job: string; error: string }>
}> {
  const ran: string[] = []
  const skipped: string[] = []
  const errors: Array<{ job: string; error: string }> = []

  for (const jobName of Object.keys(JOB_REGISTRY)) {
    try {
      const didRun = await runJob(jobName, now)
      if (didRun) {
        ran.push(jobName)
      } else {
        skipped.push(jobName)
      }
    } catch (err) {
      // Log but do NOT rethrow — other jobs must still run (T-01-34 resilience)
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[runDueJobs] job=${jobName} error=${message}`)
      errors.push({ job: jobName, error: message })
    }
  }

  return { ran, skipped, errors }
}
