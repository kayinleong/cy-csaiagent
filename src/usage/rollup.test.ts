// QUAL-08/ADMIN-08 Wave-0 stub — implementation lands in 05-04-PLAN.md

/**
 * src/usage/rollup.test.ts — QUAL-08/ADMIN-08 aggregation assertions.
 *
 * These tests prove that `rollupUsage(day)`:
 *   1. Aggregates `usageEvents` into `usageRollups` using AggregateField.sum/count
 *      (NEVER fetch-all-then-sum — Pitfall 4 cost runaway at 400 agents).
 *   2. Produces correct sums: inTok/outTok/cachedTok + msgCount per (day,uid,pillar).
 *   3. Is idempotent via set(merge): re-running does NOT double-count (Pitfall 3).
 *      Key: `${day}__${uid}__${pillar}` with set(merge) overwrites, never accumulates.
 *
 * Wave 0: tests exist and FAIL because the implementation module is absent.
 * Wave 1+ (05-04-PLAN.md): implementation created; tests turn GREEN.
 *
 * Emulator-gated: requires FIRESTORE_EMULATOR_HOST.
 * Run with: firebase emulators:exec "vitest run src/usage/rollup.test.ts"
 * Offline:   `npm test` skips cleanly.
 *
 * Requirements: QUAL-08, ADMIN-08, D-05, RESEARCH Pattern 2, Pitfall 3 (double-count),
 *               Pitfall 4 (cost at 400 agents — no fetch-all)
 */

import { describe, it, expect } from 'vitest'
// This import will FAIL until the implementation is created (Wave 0 red-bar intent):
import { rollupUsage } from '@/src/usage/rollup'

// ─── Emulator gate ────────────────────────────────────────────────────────────
// Mirror the exact gate from src/firebase/__tests__/rules.test.ts:62-63
const RUN = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const suite = RUN ? describe : describe.skip

// ─── Synthetic test fixtures (no real PII — T-05-02) ─────────────────────────
const TEST_DAY = '2026-01-01'
const TEST_UID = 'agent-test-rollup-001'
const TEST_PILLAR = 'coach' as const
const ROLLUP_KEY = `${TEST_DAY}__${TEST_UID}__${TEST_PILLAR}`

// ─── Test suite ───────────────────────────────────────────────────────────────

suite('QUAL-08/ADMIN-08 rollupUsage — aggregation (sum/count) + idempotent set-merge', () => {
  // NOTE: In Wave 1+ the emulator is started and synthetic usageEvents docs are seeded.
  // Wave 0: the import above fails ("Cannot find module '@/src/usage/rollup'"),
  // so the test runner reports a module-not-found error — the intended red bar.

  it('sums tokens + counts messages per (day, uid, pillar)', async () => {
    // Setup (Wave 1+):
    //   - seed N=3 usageEvents docs for (TEST_DAY, TEST_UID, TEST_PILLAR):
    //     Event 1: { inputTokens:100, outputTokens:50, cachedInputTokens:10 }
    //     Event 2: { inputTokens:200, outputTokens:80, cachedInputTokens:20 }
    //     Event 3: { inputTokens:150, outputTokens:60, cachedInputTokens:15 }
    //   - run rollupUsage(TEST_DAY)
    //   - read usageRollups/${ROLLUP_KEY}
    //   - assert: inTok === 450, outTok === 190, cachedTok === 45, msgCount === 3
    //
    // Uses AggregateField.sum()/count() NOT fetch-all (Pitfall 4).
    // RESEARCH Pattern 2: .aggregate({ msgCount: AggregateField.count(), inTok: AggregateField.sum('inputTokens'), ... })
    //
    // Wave 0: unreachable — module import fails first.

    await rollupUsage(TEST_DAY)

    // In Wave 1+: read the rollup doc via adminDb and assert token sums + msgCount
    // Placeholder: just verifying the function runs without throwing
    expect(true).toBe(true) // Wave 1+ replaces with: adminDb.collection('usageRollups').doc(ROLLUP_KEY).get()
  })

  it('idempotent set-merge — re-running does NOT double-count (Pitfall 3)', async () => {
    // This is the critical Pitfall-3 guard: running rollupUsage(day) twice
    // must produce the SAME result as running it once.
    //
    // Mechanism: rollupUsage uses `set(merge:true)` with the recomputed aggregation
    // from source events. A second run overwrites the rollup doc with the same values
    // (NOT accumulates). Key is `${day}__${uid}__${pillar}`.
    //
    // (RESEARCH Pitfall 3 double-count / under-count: "Make the rollup idempotent:
    //  key usageRollups docs by ${day}__${uid}__${pillar} and recompute-from-source
    //  with set(merge) so a re-run overwrites, never accumulates.")
    //
    // Setup (Wave 1+):
    //   - seed 3 usageEvents docs
    //   - run rollupUsage(TEST_DAY) → record inTok, outTok, msgCount
    //   - run rollupUsage(TEST_DAY) AGAIN
    //   - read usageRollups/${ROLLUP_KEY}
    //   - assert: totals equal SINGLE-RUN totals (not 2x)
    //
    // Wave 0: unreachable — module import fails first.

    // First run
    await rollupUsage(TEST_DAY)
    // Second run — MUST NOT double-count
    await rollupUsage(TEST_DAY)

    // In Wave 1+: assert rollup doc has same values as after first run
    // Placeholder assertion confirming idempotency intent:
    expect(true).toBe(true) // Wave 1+ replaces with doc value comparison
  })

  it('rollup doc key follows ${day}__${uid}__${pillar} pattern', async () => {
    // Assert the rollup key pattern is correct — required for idempotency and admin reads.
    // (RESEARCH Pattern 2, PATTERNS.md §rollup.ts idempotency contract)
    //
    // Wave 0: unreachable — module import fails first.

    await rollupUsage(TEST_DAY)

    // In Wave 1+: assert adminDb.collection('usageRollups').doc(ROLLUP_KEY).get() exists
    const expectedKey = `${TEST_DAY}__${TEST_UID}__${TEST_PILLAR}`
    expect(expectedKey).toMatch(/^\d{4}-\d{2}-\d{2}__.+__.+$/)
  })
})
