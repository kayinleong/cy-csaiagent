/**
 * src/eval/runNightly.ts — Nightly eval runner seam (placeholder for 02-07)
 *
 * This file provides a stable export point for the `eval-nightly` lazy-cron
 * job registered in `src/jobs/runDueJobs.ts`. The job body delegates here so
 * plan 02-07 only needs to implement the Promptfoo run logic in THIS file —
 * no changes to the registry are required when 02-07 lands.
 *
 * CURRENT STATE: no-op placeholder.
 * 02-07 will replace this no-op with:
 *   1. Resolve judge model ID from Firebase Remote Config (JUDGE_MODEL env var).
 *   2. Run the Promptfoo suite against the trilingual gold fixtures in evals/.
 *   3. Write eval results to the `evals/{runId}` Firestore collection.
 *   4. Flag regressions (score < threshold) to the senior-coach dashboard.
 *
 * Why a seam? The registry is already wired and tracks last-run-per-window.
 * Filling the seam in 02-07 does not require touching runDueJobs.ts at all.
 *
 * References:
 *   - src/jobs/runDueJobs.ts eval-nightly registry entry
 *   - src/eval/judge.ts (rubric + judgeModelEnvKey)
 *   - QUAL-06: prompt regression suite wired into nightly eval
 *   - 02-05 PLAN.md Task 3
 */

/**
 * Run the nightly eval suite.
 *
 * PLACEHOLDER — currently a no-op. Plan 02-07 implements the Promptfoo run.
 *
 * @returns Promise that resolves when the eval suite completes (or is skipped).
 */
export async function runNightlyEval(): Promise<void> {
  // TODO(02-07): implement Promptfoo run + evals/ write + regression flag
  // Do NOT implement here — 02-07 is the designated plan for this body.
}
