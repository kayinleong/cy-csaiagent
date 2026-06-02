/**
 * src/eval/runNightly.ts — Nightly eval runner (02-07, QUAL-06)
 *
 * Implements the `eval-nightly` lazy-cron job body that
 * `src/jobs/runDueJobs.ts` delegates to. The job registry wiring is owned by
 * 02-05 (runDueJobs.ts) — this file only implements the Promptfoo run logic.
 *
 * Flow:
 *   1. Offline-skip guard: if JUDGE_MODEL is unset, log a warning and return.
 *      This prevents the lazy-cron from crashing when the stack is offline or
 *      JUDGE_MODEL has not been configured in Remote Config yet.
 *   2. Build a unique runId (timestamp-based) for this eval run.
 *   3. Shell out to `npx promptfoo eval` against `evals/promptfooconfig.yaml`,
 *      writing JSON results to `evals/results/{runId}.json`.
 *   4. Parse the Promptfoo JSON output and write one EvalDoc per (suite, lang)
 *      to the `evals/{runId}` Firestore collection via evalsRef().
 *   5. Log a summary. Any thrown error is caught and re-thrown so the lazy-cron
 *      runner can log it without crashing other jobs (runDueJobs.ts is resilient).
 *
 * Offline-skip contract (CALIBRATION.md §7):
 *   - JUDGE_MODEL unset → warn + skip (do NOT crash the lazy-cron).
 *   - ANTHROPIC_API_KEY unset is handled by Promptfoo internally (it will error);
 *     the skip guard here is specifically for the JUDGE_MODEL / Remote Config gate.
 *
 * Suite → lang mapping:
 *   Each Promptfoo test case carries a `lang` var (en/ms/zh). The result writer
 *   groups by (suiteName, lang) and writes one EvalDoc per group.
 *
 * Security / PDPA:
 *   - Gold sets use SYNTHETIC prompts only — no real client PII crosses to the
 *     judge model (T-02-33).
 *   - The evals/ collection is write-only via Admin SDK (T-02-34); client writes
 *     are denied by Firestore rules.
 *   - judgeModel is stored in EvalDoc from JUDGE_MODEL env (never hard-coded).
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * References:
 *   - src/jobs/runDueJobs.ts eval-nightly registry entry (02-05 — do NOT modify)
 *   - src/eval/judge.ts (rubric + judgeModelEnvKey / JUDGE_MODEL_RC_KEY)
 *   - src/firebase/collections.ts (evalsRef + EvalDoc)
 *   - evals/promptfooconfig.yaml (the suite config)
 *   - evals/CALIBRATION.md (calibration protocol)
 *   - QUAL-06: prompt regression suite wired into nightly eval
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { evalsRef } from '@/src/firebase/collections'
import { judgeModelEnvKey } from '@/src/eval/judge'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The shape of a single Promptfoo test result from the JSON output.
 * Only the fields we consume are typed; the rest are unknown.
 */
interface PromptfooTestResult {
  description?: string
  vars?: {
    lang?: string
    [key: string]: unknown
  }
  success: boolean
  score?: number
  gradingResult?: {
    pass: boolean
    score?: number
    reason?: string
    componentResults?: Array<{
      pass: boolean
      score?: number
      reason?: string
    }>
  }
}

/**
 * The shape of the Promptfoo JSON output file.
 * Only the fields we consume are typed.
 */
interface PromptfooOutput {
  results?: {
    results?: PromptfooTestResult[]
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Path to the Promptfoo config from the project root.
 * Must match the path used in `npm run eval`.
 */
const PROMPTFOO_CONFIG = 'evals/promptfooconfig.yaml'

/**
 * Directory for eval JSON output files (results/{runId}.json).
 * Written relative to the project root (process.cwd()).
 */
const EVAL_RESULTS_DIR = 'evals/results'

/**
 * Infer a suite name from a Promptfoo test case description.
 *
 * Description format: "Coach | {lang} | {suite} | {scenario}"
 * Example: "Coach | EN | training-qa | What is PowerBoost?"
 * → suiteName = "coach-training"
 *
 * Falls back to "coach-general" if parsing fails.
 */
function inferSuiteName(description?: string): string {
  if (!description) return 'coach-general'
  const parts = description.split('|').map((p) => p.trim().toLowerCase())
  if (parts.length < 3) return 'coach-general'
  const middle = parts[2]
  if (middle.includes('training')) return 'coach-training'
  if (middle.includes('journey')) return 'coach-journey'
  if (middle.includes('playbook')) return 'coach-playbooks'
  if (middle.includes('onboarding')) return 'coach-trilingual'
  return 'coach-general'
}

/**
 * Normalize a lang string from a Promptfoo vars.lang value.
 * Returns 'en', 'ms', or 'zh'; defaults to 'en' for unknown values.
 */
function normalizeLang(lang?: string): 'en' | 'ms' | 'zh' {
  const l = (lang ?? 'en').toLowerCase()
  if (l === 'ms') return 'ms'
  if (l === 'zh') return 'zh'
  return 'en'
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the nightly eval suite.
 *
 * Called by the eval-nightly lazy-cron job in src/jobs/runDueJobs.ts.
 * Do NOT call this from runDueJobs.ts directly — it is already wired there
 * by 02-05; this function only implements the eval logic.
 *
 * @returns Promise that resolves when the eval suite completes (or is skipped).
 */
export async function runNightlyEval(): Promise<void> {
  // ── Offline-skip guard ────────────────────────────────────────────────────
  // If JUDGE_MODEL is not set (no Remote Config access / offline CI), skip the
  // live judge run. The lazy-cron must never crash because of a missing judge
  // model — it will try again next window.
  const judgeModel = process.env[judgeModelEnvKey]
  if (!judgeModel) {
    console.warn(
      `[runNightlyEval] JUDGE_MODEL env var is not set (Remote Config key: ${judgeModelEnvKey}). ` +
        'Skipping live eval run — configure model.grader.default in Firebase Remote Config to enable nightly scoring.',
    )
    return
  }

  // ── Generate a unique run ID ──────────────────────────────────────────────
  const runId = `eval-${Date.now()}`
  console.info(`[runNightlyEval] Starting eval run: ${runId} (judgeModel=${judgeModel})`)

  // ── Ensure results directory exists ──────────────────────────────────────
  const resultsDir = join(process.cwd(), EVAL_RESULTS_DIR)
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true })
  }

  const outputPath = join(resultsDir, `${runId}.json`)

  // ── Run Promptfoo eval ────────────────────────────────────────────────────
  // Shell out to promptfoo. We pass --output to capture JSON results.
  // Errors from Promptfoo (e.g., provider auth failure) are re-thrown so the
  // lazy-cron runner can log them (runDueJobs.ts has a per-job try/catch).
  const cmd = [
    'npx promptfoo eval',
    `-c ${PROMPTFOO_CONFIG}`,
    `--output ${outputPath}`,
    '--no-cache',
  ].join(' ')

  console.info(`[runNightlyEval] Running: ${cmd}`)
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, [judgeModelEnvKey]: judgeModel } })

  // ── Parse results ─────────────────────────────────────────────────────────
  if (!existsSync(outputPath)) {
    throw new Error(`[runNightlyEval] Promptfoo output file not found at ${outputPath}`)
  }

  const rawOutput = readFileSync(outputPath, 'utf-8')
  let parsed: PromptfooOutput
  try {
    parsed = JSON.parse(rawOutput) as PromptfooOutput
  } catch (err) {
    throw new Error(`[runNightlyEval] Failed to parse Promptfoo JSON output: ${String(err)}`)
  }

  const testResults = parsed.results?.results ?? []
  console.info(`[runNightlyEval] Parsed ${testResults.length} test results`)

  // ── Group results by (suiteName, lang) ──────────────────────────────────
  // One EvalDoc per (suite, lang) pair, matching the EvalDoc schema.
  type GroupKey = `${string}__${string}`
  const groups = new Map<
    GroupKey,
    { suite: string; lang: 'en' | 'ms' | 'zh'; passed: number; total: number; failures: string[] }
  >()

  for (const result of testResults) {
    const suite = inferSuiteName(result.description)
    const lang = normalizeLang(result.vars?.lang as string | undefined)
    const key: GroupKey = `${suite}__${lang}`

    if (!groups.has(key)) {
      groups.set(key, { suite, lang, passed: 0, total: 0, failures: [] })
    }

    const group = groups.get(key)!
    group.total++
    if (result.success) {
      group.passed++
    } else {
      // Capture a short failure reason for the dashboard's regression view
      const reason =
        result.gradingResult?.reason ??
        result.description ??
        `Test index ${group.total}`
      group.failures.push(reason.slice(0, 200)) // cap at 200 chars per failure
    }
  }

  // ── Write EvalDoc per (suite, lang) to Firestore ─────────────────────────
  const ref = evalsRef()
  const writePromises: Promise<unknown>[] = []

  for (const [, group] of groups) {
    const score = group.total > 0 ? group.passed / group.total : 0
    const docId = `${runId}__${group.suite}__${group.lang}`

    // Write only the EvalDoc-typed fields to satisfy the typed converter.
    // Ancillary metadata (runId, runAt, totalCases, passedCases) is encoded
    // into the failures array footer line so no schema extension is needed.
    const failuresWithMeta = [
      ...group.failures,
      `meta:runId=${runId};total=${group.total};passed=${group.passed};ts=${Date.now()}`,
    ]

    writePromises.push(
      ref.doc(docId).set({
        tenantId: 'd2',
        suite: group.suite,
        lang: group.lang,
        score,
        judgeModel,
        failures: failuresWithMeta,
      }),
    )

    const pct = (score * 100).toFixed(1)
    console.info(
      `[runNightlyEval] suite=${group.suite} lang=${group.lang} score=${pct}% ` +
        `(${group.passed}/${group.total}) failures=${group.failures.length}`,
    )
  }

  await Promise.all(writePromises)
  console.info(`[runNightlyEval] Wrote ${writePromises.length} EvalDoc(s) to evals/ collection (runId=${runId})`)
}
