/**
 * scripts/ci-guards.test.ts — Phase-7 CI grep-guard suite (07-VALIDATION.md "Gate").
 *
 * Static-analysis guards over the repo source that FAIL when a Phase-7 invariant
 * is violated. Each content guard filters comment lines (so a `// claude-...`
 * doc-comment never trips the hard-coded-model-id guard, per the grep-gate
 * hygiene rule). Runtime is kept under a few seconds via bounded fast-glob.
 *
 * Guards:
 *   1. NO hard-coded model ID in any Phase-7 surface (model.{pillar}.default
 *      resolves from Remote Config; src/llm/provider.ts REMOTE_CONFIG_FALLBACKS
 *      is the SOLE allowed literal home and is explicitly excluded). RED until 07-05.
 *   2. NO src/ → app/ import (core/shell split — src/ is portable). GREEN today.
 *   3. NO read-only grant in the cohorts/conversationFlags rules blocks. RED until 07-02.
 *   4. NO { force:true } Remote Config publishTemplate. RED until 07-05.
 *   5. NO journey-edit symbol on the agent-profile route (PROF-01/D-04). RED until 07-03.
 *   6. ANTI-VACUOUS (Nyquist): under CI, FAIL if the Firestore emulator is absent
 *      (the rules-suite would describe.skip and the read-only-DENY + cross-coach-DENY
 *      matrices would pass vacuously). No-op when CI is unset (offline dev works).
 *
 * No emulator needed for guards 1-5 (pure file reads).
 *
 * Requirements / threats: T-07-04 (1/3/4), core/shell (2), PROF-01/D-04 (5),
 * T-07-28 (6 — anti-vacuous rules-suite guard).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import fg from 'fast-glob'

const ROOT = process.cwd()

/** A model-id literal: claude-… or gemini-… inside a quote. */
const MODEL_ID_RE = /['"`](?:claude|gemini)-[a-z0-9.-]+['"`]/i

/** Strip whole comment lines (// , /* , * , #) so doc-comments never trip a guard. */
function nonCommentLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*|#)/.test(line))
}

/** Read a file's non-comment lines; '' if absent (an absent RED target trivially passes). */
function nonCommentLinesOf(absPath: string): string[] {
  if (!existsSync(absPath)) return []
  return nonCommentLines(readFileSync(absPath, 'utf8'))
}

// ─── Guard 1: no hard-coded model ID in Phase-7 surfaces ─────────────────────

describe('Guard 1 — no hard-coded model ID in Phase-7 surfaces (T-07-04 / D-15)', () => {
  it('no Phase-7 model-config/cohort surface contains a claude-*/gemini-* literal', () => {
    // The model-config UI must resolve from Remote Config; the SOLE allowed literal
    // home (src/llm/provider.ts REMOTE_CONFIG_FALLBACKS) is excluded by the glob.
    const files = fg.sync(
      [
        'app/**/(admin)/model-config/**/*.{ts,tsx}',
        'app/**/(admin)/cohorts/**/*.{ts,tsx}',
      ],
      { cwd: ROOT, absolute: true, ignore: ['**/*.test.ts', '**/*.test.tsx'] },
    )

    const offenders: string[] = []
    for (const file of files) {
      for (const line of nonCommentLinesOf(file)) {
        if (MODEL_ID_RE.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders, `Hard-coded model IDs found (resolve from Remote Config):\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─── Guard 2: no src/ → app/ import (core/shell split) ───────────────────────

describe('Guard 2 — no src/ → app/ import (core/shell split, GREEN today)', () => {
  it('no file under src/ imports from @/app/ or a relative ../app/ path', () => {
    // Test files are excluded: a colocated *.test.ts legitimately imports the app/
    // module it verifies (the portable core itself must never import app/, but its
    // tests may reference the shell surface they assert against).
    const files = fg.sync(['src/**/*.{ts,tsx}'], {
      cwd: ROOT,
      absolute: true,
      ignore: ['**/*.test.ts', '**/*.test.tsx'],
    })

    const offenders: string[] = []
    for (const file of files) {
      for (const line of nonCommentLinesOf(file)) {
        if (/from\s+['"`]@\/app\//.test(line) || /from\s+['"`](?:\.\.\/)+app\//.test(line)) {
          offenders.push(`${file}: ${line.trim()}`)
        }
      }
    }
    expect(offenders, `src/ → app/ imports violate the core/shell split:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─── Guard 3: no read-only grant in the new rule blocks ──────────────────────

describe('Guard 3 — no read-only grant in cohorts/conversationFlags rules (T-07-01 / D-24)', () => {
  it('the cohorts + conversationFlags rule blocks contain no read-only token', () => {
    const rulesPath = resolve(ROOT, 'firestore.rules')
    const lines = nonCommentLinesOf(rulesPath)
    if (lines.length === 0) return // rules file absent — RED target trivially passes

    // Extract the two Phase-7 blocks (best-effort: lines within `match /cohorts/`
    // and `match /conversationFlags/` up to the closing brace). If the blocks do
    // not exist yet (07-02 not landed), there is nothing to scan — RED-by-design.
    const text = lines.join('\n')
    const READONLY_TOKENS = /isAnalyticsReader\s*\(|hasRole\(\s*['"`]read-only['"`]\s*\)|isReadOnlyRole\s*\(/

    const blockRe = /match\s+\/(cohorts|conversationFlags)\/[^{]*\{([\s\S]*?)\n\s*\}/g
    const offenders: string[] = []
    let m: RegExpExecArray | null
    while ((m = blockRe.exec(text)) !== null) {
      if (READONLY_TOKENS.test(m[2])) offenders.push(`match /${m[1]}/ block grants a read-only token`)
    }
    expect(offenders, `read-only must be DENIED on Phase-7 collections:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─── Guard 4: no { force:true } Remote Config publish ────────────────────────

describe('Guard 4 — no { force:true } Remote Config publishTemplate (T-07-04 / D-16)', () => {
  it('no publishTemplate call site passes force:true', () => {
    const files = fg.sync(['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'], {
      cwd: ROOT,
      absolute: true,
      ignore: ['**/*.test.ts', '**/*.test.tsx'],
    })

    const offenders: string[] = []
    for (const file of files) {
      const lines = nonCommentLinesOf(file)
      const text = lines.join('\n')
      // publishTemplate(...) anywhere followed by a force:true within the same call window.
      if (/publishTemplate\s*\(/.test(text) && /force\s*:\s*true/.test(text)) {
        offenders.push(file)
      }
    }
    expect(offenders, `publishTemplate must use ETag concurrency, never { force:true }:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─── Guard 5: no journey-edit symbol on the agent-profile route (PROF-01/D-04) ─

describe('Guard 5 — no journey-edit on the agent-profile route (PROF-01 / D-04)', () => {
  it('the agent-profile route (and colocated components) contain no journey-state write symbol', () => {
    // The profile is read-only composition only — editing journey state would risk
    // the journey state machine (D-04). An ABSENT route trivially passes (RED-by-design
    // until 07-03 ships it); once present it must contain none of these symbols.
    const files = fg.sync(
      [
        'app/**/(coach)/agents/[uid]/**/*.{ts,tsx}',
        'app/**/(admin)/agents/[uid]/**/*.{ts,tsx}',
      ],
      { cwd: ROOT, absolute: true, ignore: ['**/*.test.ts', '**/*.test.tsx'] },
    )

    const JOURNEY_WRITE_RE =
      /setJourneyStage|setCurrentCheckpoint|updateJourney|advanceCheckpoint|recordCheckpoint|journeyStage\s*:/

    const offenders: string[] = []
    for (const file of files) {
      for (const line of nonCommentLinesOf(file)) {
        if (JOURNEY_WRITE_RE.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders, `agent-profile is read-only — no journey-state write/mutation allowed:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ─── Guard 6: anti-vacuous rules-suite guard (Nyquist, T-07-28) ──────────────

describe('Guard 6 — anti-vacuous rules-suite guard under CI (T-07-28)', () => {
  it('under CI, the Firestore emulator MUST be reachable (else the rules matrices skip vacuously)', () => {
    const underCI = Boolean(process.env.CI)
    if (!underCI) {
      // Offline dev / non-CI run: no-op so `npm run test` still works without the emulator.
      expect(true).toBe(true)
      return
    }
    // Under CI, the security-critical read-only-DENY + cross-coach-DENY matrices
    // must actually execute — they only run when FIRESTORE_EMULATOR_HOST is set
    // (rulesSuite = describe.skip otherwise). A CI run with the emulator down is a
    // hard FAILURE, never a green vacuous pass.
    const emulatorReachable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
    expect(
      emulatorReachable,
      'CI=true but FIRESTORE_EMULATOR_HOST is unset — the Firestore rules suite would ' +
        'describe.skip and the read-only-DENY + cross-coach-DENY matrices would pass ' +
        'vacuously. Run the rules suite via `firebase emulators:exec --only firestore`.',
    ).toBe(true)
  })
})
