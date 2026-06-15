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
 *   - stall-detect  (daily window: 24 h) — runs findStalled + in-app nudge + emitHandoffSignal
 *   - escalate      (daily window: 24 h) — 48h stall → emitHandoffSignal gated to working hours
 *   - eval-nightly  (daily window: 24 h) — delegates to runNightlyEval seam (02-07 fills body)
 *   - usage-rollup  (hourly window) — aggregates usageEvents → usageRollups for
 *                   yesterday + today (idempotent recompute; quick-015)
 *
 * D-09 RESOLUTION (2026-06-02): ON-VISIT nudges — the lazy-cron fires only when an
 * authorized user visits the app. A truly idle overnight defers nudges. The wall-clock
 * GitHub Actions escape hatch was presented to the user and the decision was:
 * ACCEPT ON-VISIT-ONLY for the pilot. The heartbeat + UI watchdog surfaces a stale
 * last-run when the cron hasn't fired in the expected window.
 *
 * References:
 *   - TSD §3.4 scheduled jobs
 *   - Decision override 2026-06-01: on-visit lazy-cron Server Action
 *   - T-01-34 (heartbeat / watchdog signal)
 *   - COACH-04 (stall nudge), COACH-05 (48h escalation), CDASH-06 (working-hours gate)
 *   - 02-CONTEXT.md D-08/D-09, 02-RESEARCH.md Pattern 4
 */

import { adminDb } from '@/src/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { findStalled, emitHandoffSignal } from '@/src/escalation'
import { writeHeartbeat } from '@/src/jobs/heartbeat'
import { isWithinWorkingHours } from '@/src/jobs/workingHours'
import { appendMessage, loadRecent } from '@/src/memory/conversation'
import { runNightlyEval } from '@/src/eval/runNightly'
import { TENANT_ID } from '@/src/firebase/collections'
import { erasureSweep } from '@/src/pdpa/sweep'
import { rollupUsage } from '@/src/usage/rollup'
import { dayKey } from '@/src/usage/types'

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

/** One hour in milliseconds — window for jobs that must refresh the in-progress day. */
const ONE_HOUR_MS = 60 * 60 * 1000

// ─── Job registry ─────────────────────────────────────────────────────────────

interface JobDefinition {
  /** Window duration in ms — job fires at most once per window. */
  windowMs: number
  /**
   * Job body — only called when the job is due. Must be idempotent.
   *
   * Receives the same `now` clock that `runJob` was called with so job bodies
   * can perform time-relative checks (e.g., working-hours gate in `escalate`)
   * without importing a separate clock. Injectable for unit tests.
   */
  run: (now: Date) => Promise<void>
}

/**
 * All registered jobs.
 *
 * Add future jobs here. Stub entries (no-op run) serve as seams that already
 * have last-run tracking in place, so wiring the body in a future plan does not
 * require touching the ledger or the trigger.
 */
const JOB_REGISTRY: Record<string, JobDefinition> = {
  /**
   * stall-detect — COACH-04
   *
   * Runs daily. For each agent stalled ≥2 days:
   *   1. Emits a 'stall' escalation row (dedup-guarded by emitHandoffSignal).
   *   2. Writes ONE in-app nudge into the agent's primary coach thread
   *      (`coach-{uid}/messages`) — cadence-capped so the same window does not
   *      produce duplicate nudges (T-02-20 over-nudging mitigation).
   */
  'stall-detect': {
    windowMs: ONE_DAY_MS,
    run: async (_now: Date) => {
      const stalled = await findStalled({ days: 2 })
      for (const agent of stalled) {
        // ── Escalation row (dedup-guarded) ──────────────────────────────────
        await emitHandoffSignal({
          agentUid: agent.agentUid,
          seniorCoachId: agent.seniorCoachId,
          reason: 'stall',
          contextBundle: {
            lastActiveAt: agent.lastActiveAt,
            // No raw PII — technical metadata only (T-01-36 / PDPA)
          },
        })

        // ── In-app nudge (COACH-04, cadence-capped) ─────────────────────────
        // Query the coach thread for any nudge already written in this stall
        // window (last 24 h). Only write a new nudge if none exists yet.
        const cid = `coach-${agent.agentUid}`
        const recentMessages = await loadRecent(cid, 20)
        const alreadyNudged = recentMessages.some(
          (m) => m.data.routeDecision === 'nudge',
        )

        if (!alreadyNudged) {
          await appendMessage(cid, {
            tenantId: TENANT_ID,
            role: 'assistant',
            content:
              "Hey, looks like you haven't checked in for a couple of days. " +
              "Your D2 onboarding journey is waiting — even 15 minutes today " +
              'keeps the momentum going. Your coach is here if you need help!',
            citations: [],
            routeDecision: 'nudge',
            tokens: 0,
            redacted: true,
          })
        }
      }
      await writeHeartbeat('stall-detect')
    },
  },

  /**
   * escalate — COACH-05 / CDASH-06
   *
   * Runs daily. For each agent stalled ≥2 days, if the stall has aged past 48h
   * and it is currently within working hours (Asia/Kuala_Lumpur 09:00–18:00
   * Mon–Fri), emit a 'stall' escalation row so it surfaces on the senior-coach
   * dashboard during their working day.
   *
   * Outside working hours: skip the emit (defer to next run inside the window).
   * The dedup guard in emitHandoffSignal ensures no duplicate escalation is
   * created if the job runs multiple times during working hours (T-02-21).
   *
   * Working-hours default (Assumption A1 — confirm with Derek):
   *   Asia/Kuala_Lumpur, 09:00–18:00, Mon–Fri
   */
  escalate: {
    windowMs: ONE_DAY_MS,
    run: async (now: Date) => {
      const currentTime = now

      // Gate: only surface escalations during working hours (CDASH-06)
      if (!isWithinWorkingHours(currentTime)) {
        // Outside working hours — defer escalation visibility until next window
        await writeHeartbeat('escalate')
        return
      }

      const stalled = await findStalled({ days: 2 })
      for (const agent of stalled) {
        // Additional 48h gate: lastActiveAt must be at least 48h before now
        const stalledMs = currentTime.getTime() - agent.lastActiveAt.getTime()
        const fortyEightHoursMs = 48 * 60 * 60 * 1000
        if (stalledMs < fortyEightHoursMs) {
          // Stall is detected (≥2d) but hasn't crossed 48h yet — skip escalation
          continue
        }

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

      await writeHeartbeat('escalate')
    },
  },

  /**
   * eval-nightly — QUAL-06 seam
   *
   * Runs daily. Delegates to `runNightlyEval` (src/eval/runNightly.ts).
   * The body of runNightlyEval is a no-op placeholder filled by plan 02-07.
   * This registry entry provides the stable wiring so 02-07 only needs to
   * implement the Promptfoo run inside runNightlyEval — no registry changes.
   */
  'eval-nightly': {
    windowMs: ONE_DAY_MS,
    run: async (_now: Date) => {
      await runNightlyEval()
      await writeHeartbeat('eval-nightly')
    },
  },

  /**
   * usage-rollup — QUAL-08 / ADMIN-08 / D-05
   *
   * Aggregates usageEvents into per-(uid, pillar) usageRollups documents using
   * AggregateField.sum()/count() — NEVER fetch-all.
   *
   * Rolls up BOTH the previous day and the current day on each run:
   *   - Current day (`dayKey(now)`): the on-visit lazy-cron fires on chat-page LOAD,
   *     i.e. before the visitor sends a message, so the in-progress day must be
   *     re-aggregated on later visits or its events are never captured (quick-015).
   *   - Previous day (`dayKey(now - 1d)`): covers the midnight boundary so the tail
   *     of yesterday (events after that day's last run) is not dropped.
   *
   * Idempotent: each rollup doc is keyed `${day}__${uid}__${pillar}` and written
   * with set(merge:true) — recompute-from-source overwrite, never accumulates
   * (Pitfall 3). This is what makes the hourly recompute below safe.
   *
   * DUE-gate (runJob txn): exactly-once-per-window under concurrent visitors.
   *
   * windowMs: ONE_HOUR_MS — the current day must refresh more than once per day,
   * otherwise the single daily run (which lands before any events exist) leaves
   * usageRollups empty and the usage page shows nothing (quick-015 root cause).
   * dayKey() converts to 'YYYY-MM-DD' in MYT so rollups align with D2's day.
   */
  'usage-rollup': {
    windowMs: ONE_HOUR_MS,
    run: async (now: Date) => {
      const yesterday = dayKey(new Date(now.getTime() - ONE_DAY_MS))
      const today = dayKey(now)
      await rollupUsage(yesterday)
      await rollupUsage(today)
      await writeHeartbeat('usage-rollup')
    },
  },

  /**
   * erasure-sweep — QUAL-09 / D-02
   *
   * Runs every hour. Finishes any pending/sweeping erasureRequests in bounded
   * batches (RESEARCH Pattern 3 / Pitfall 10 — never a mega-delete). Each call
   * processes up to BATCH_SIZE docs per collection per request and marks the
   * request 'complete' once nothing remains.
   *
   * windowMs: 1h — well inside the 72h PDPA SLA (D-02 / T-05-MEGADELETE).
   *
   * The runJob txn DUE-gate (line 229-265) gives exactly-once-per-window semantics
   * under concurrency — two concurrent visitors racing this window: only one wins
   * the transaction write and runs the sweep body (T-05-DOUBLESWEEP mitigated).
   * Even if both ran, erasureSweep is idempotent (Pitfall 3 guard).
   */
  'erasure-sweep': {
    windowMs: 60 * 60 * 1000, // 1h — well inside the 72h SLA (D-02)
    run: async (_now: Date) => {
      await erasureSweep()
      await writeHeartbeat('erasure-sweep')
    },
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
    await def.run(now)
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
