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

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hermetic Firestore mock (the Wave-1+ "mock/spy to intercept add()" this file describes) ──
// recordUsageEvent does `await usageEventsRef().add(doc)`. Without this mock the test makes a
// REAL Firestore write when credentials are present in the environment (e.g. a local .env.local),
// which both hangs the test on the network AND pollutes the live usageEvents collection with
// junk test docs. We intercept `usageEventsRef().add()` so the test is fully offline + hermetic
// and can assert the exact written payload (counts only, no PII).
const { addMock } = vi.hoisted(() => ({ addMock: vi.fn() }))
vi.mock('@/src/firebase/collections', () => ({
  usageEventsRef: () => ({ add: addMock }),
}))

import { recordUsageEvent } from '@/src/usage/record'

beforeEach(() => {
  addMock.mockReset()
  addMock.mockResolvedValue({ id: 'usage-evt-test' })
})

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

    // Call with a sample event; the mocked add() captures the exact written payload.
    await recordUsageEvent(SAMPLE_EVENT)

    expect(addMock).toHaveBeenCalledTimes(1)
    const writtenDoc = addMock.mock.calls[0][0] as Record<string, unknown>

    // The persisted doc must NOT contain any content/PII field:
    const FORBIDDEN_KEYS = ['content', 'text', 'originalDraft', 'routeDecision']
    for (const key of FORBIDDEN_KEYS) {
      expect(writtenDoc).not.toHaveProperty(key)
    }

    // Allowed count/metric keys must be present in the written doc:
    const REQUIRED_KEYS = ['tenantId', 'uid', 'pillar', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'day']
    for (const key of REQUIRED_KEYS) {
      expect(writtenDoc).toHaveProperty(key)
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

    // recordUsageEvent destructures only the allowed keys, so the forbidden fields
    // must never reach the written doc. The mocked add() lets us assert this directly.
    await recordUsageEvent(SAMPLE_WITH_FORBIDDEN as unknown as typeof SAMPLE_EVENT)

    expect(addMock).toHaveBeenCalledTimes(1)
    const writtenDoc = addMock.mock.calls[0][0] as Record<string, unknown>
    for (const key of ['content', 'originalDraft', 'routeDecision', 'text']) {
      expect(writtenDoc).not.toHaveProperty(key)
    }
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

    // Make the Firestore write reject, then assert recordUsageEvent still resolves
    // (swallow contract — the after() caller must never see the error).
    addMock.mockRejectedValueOnce(new Error('simulated Firestore write failure'))
    await expect(recordUsageEvent(SAMPLE_EVENT)).resolves.toBeUndefined()
  })
})
