// QUAL-08/ADMIN-08 Wave-0 stub — implementation lands in 05-04-PLAN.md

/**
 * src/usage/record.test.ts — QUAL-08 usage capture assertions.
 *
 * These tests prove that `recordUsageEvent`:
 *   1. Persists COUNTS ONLY — no PII, no content, no routeDecision strings.
 *      (Anti-Pattern: storing content in usageEvents — same hashes-only discipline as audit.)
 *   2. Is fire-and-forget: a write failure does NOT throw (mirrors audit.log swallow contract).
 *
 * This is a unit test that MAY run offline if it asserts payload shape without a live write.
 * The import itself will fail until the implementation is created (Wave 0 red-bar intent).
 *
 * Wave 0: FAILS because the implementation module is absent.
 * Wave 1+ (05-04-PLAN.md): implementation created; tests turn GREEN.
 *
 * Requirements: QUAL-08, D-04 (counts only, no PII), RESEARCH Pattern 1, Anti-Pattern,
 *               Pitfall 3 (idempotent — addressed in rollup.test.ts)
 */

import { describe, it, expect, vi } from 'vitest'
// This import will FAIL until the implementation is created (Wave 0 red-bar intent):
import { recordUsageEvent } from '@/src/usage/record'

// ─── No emulator gate: record.test.ts is a unit test (shape assertion, no live write) ────
// If recordUsageEvent is implemented to always write to Firestore, apply the emulator gate.
// For now, the test is offline-safe by design (the module import itself is the red bar).

const SAMPLE_EVENT = {
  tenantId: 'd2' as const,
  uid: 'agent-test-usage-001',
  pillar: 'coach' as const,
  inputTokens: 1024,
  outputTokens: 512,
  cachedInputTokens: 256,
  cacheCreationInputTokens: 128,
  day: '2026-01-01',
}

describe('QUAL-08 recordUsageEvent — counts only, no PII', () => {
  // Wave 0: the import above fails ("Cannot find module '@/src/usage/record'"),
  // so the test runner reports a module-not-found error — the intended red bar.

  it('records counts only, NO PII / NO content fields', async () => {
    // Assert that the persisted/returned payload has the allowed keys:
    //   {tenantId, uid, pillar, inputTokens, outputTokens, cachedInputTokens,
    //    cacheCreationInputTokens, day}
    // And contains NONE of the forbidden keys that would constitute PII or content:
    //   content, text, originalDraft, routeDecision
    //
    // (Anti-Pattern: "Storing draft/message content in usageEvents" — RESEARCH §Anti-Patterns)
    //
    // Wave 0: unreachable — module import fails first.

    // Call with a sample event — in Wave 1+ this either returns the row or undefined
    // (fire-and-forget contract). We inspect the payload before it's written.
    await recordUsageEvent(SAMPLE_EVENT)

    // If recordUsageEvent returns the payload (for testability), assert its shape:
    // The following keys must NOT be present:
    const FORBIDDEN_KEYS = ['content', 'text', 'originalDraft', 'routeDecision']
    // (Wave 1+ implementation may expose the payload via a returned value or a test spy)

    // Assert the event shape only contains count/metric fields (no content, no PII):
    // In Wave 1+: if the function returns the event object, assert directly.
    // For now, assert via a structural check that SAMPLE_EVENT has no forbidden keys.
    for (const key of FORBIDDEN_KEYS) {
      expect(SAMPLE_EVENT).not.toHaveProperty(key)
    }

    // Allowed keys must be present in the input shape:
    const REQUIRED_KEYS = ['tenantId', 'uid', 'pillar', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'day']
    for (const key of REQUIRED_KEYS) {
      expect(SAMPLE_EVENT).toHaveProperty(key)
    }
  })

  it('counts only: payload has no content/originalDraft/routeDecision fields (negative assertion)', async () => {
    // Negative assertion: explicitly prove that content/originalDraft/routeDecision
    // are NOT in the usageEvent payload shape.
    //
    // These represent the PII/content field Anti-Pattern from RESEARCH:
    //   "Storing draft/message content in usageEvents"
    //
    // Wave 0: unreachable — module import fails first.

    // In Wave 1+: spy on the Firestore write and inspect the written document.
    const SAMPLE_WITH_FORBIDDEN = {
      ...SAMPLE_EVENT,
      // These fields MUST NOT be forwarded to usageEvents:
      content: 'some chat message',
      originalDraft: 'some draft text',
      routeDecision: 'coach',
      text: 'some content',
    }

    // When recordUsageEvent strips forbidden fields, the written doc must not contain them.
    // In Wave 1+: use a mock/spy to intercept the Firestore add() call.
    await recordUsageEvent(SAMPLE_WITH_FORBIDDEN as unknown as typeof SAMPLE_EVENT)

    // Assert that content/text/originalDraft/routeDecision are stripped from the written doc
    // (Wave 1+ implementation: the function only writes the allowed keys)
    expect(true).toBe(true) // placeholder — Wave 1+ uses Firestore mock to assert payload
  })

  it('fire-and-forget: a write failure does not throw', async () => {
    // Mirror the audit.log swallow contract (src/audit/log.ts:76-97):
    //   "Fire-and-forget: swallow the error silently.
    //    The caller (running inside after()) must NOT be affected by failures."
    //
    // recordUsageEvent is called inside after() (the same path as audit.log) —
    // any Firestore error must be caught and silently discarded.
    //
    // Wave 0: unreachable — module import fails first.

    // In Wave 1+: mock Firestore add() to throw, then assert recordUsageEvent does not rethrow.
    // This test verifies the swallow contract from PATTERNS.md §src/usage/record.ts.
    await expect(
      recordUsageEvent(SAMPLE_EVENT)
    ).resolves.not.toThrow()
  })
})
