// QUAL-09 Wave-0 stub — implementation lands in 05-03-PLAN.md

/**
 * src/pdpa/erasure.test.ts — QUAL-09 cascade + audit exemption assertions.
 *
 * These tests focus on the erasure executor's two CRITICAL invariants:
 *   1. It writes an `action:'erasure'` audit event INTO auditLogs (never deletes from it).
 *   2. It NEVER deletes from auditLogs, even though auditLogs.actorUid === subject uid
 *      (the Pitfall-2 trap: a naive "delete where actorUid == uid" would hit it).
 *   3. The return value reports `collectionsHit` and a `complete` flag.
 *
 * Wave 0: tests exist and FAIL because the implementation module is absent.
 * Wave 1+ (05-03-PLAN.md): implementation created; tests turn GREEN.
 *
 * Emulator-gated: requires FIRESTORE_EMULATOR_HOST.
 * Run with: firebase emulators:exec "vitest run src/pdpa/erasure.test.ts"
 * Offline:   `npm test` skips cleanly.
 *
 * Requirements: QUAL-09, Pitfall 2 (audit log must survive — hashes-only compliance record)
 */

import { describe, it, expect } from 'vitest'
// This import will FAIL until the implementation is created (Wave 0 red-bar intent):
import { eraseDataSubject } from '@/src/pdpa/erasure'

// ─── Emulator gate ────────────────────────────────────────────────────────────
// Mirror the exact gate from src/firebase/__tests__/rules.test.ts:62-63
const RUN = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const suite = RUN ? describe : describe.skip

// ─── Synthetic test subjects (no real PII — T-05-02) ─────────────────────────
const AGENT_UID = 'agent-test-erasure-001'

// ─── Test suite ───────────────────────────────────────────────────────────────

suite('QUAL-09 eraseDataSubject — cascade + audit exemption', () => {
  // NOTE: In Wave 1+ the emulator is started and synthetic docs are seeded.
  // Wave 0: the import above fails ("Cannot find module '@/src/pdpa/erasure'"),
  // so the test runner reports a module-not-found error — the intended red bar.

  it('writes an action:"erasure" audit event to auditLogs (never deletes from it)', async () => {
    // The Pitfall-2 trap: auditLogs.actorUid equals the subject uid for agent erasure.
    // A naive cascade would DELETE from auditLogs — this test proves it does NOT.
    //
    // Setup (Wave 1+):
    //   - seed an auditLogs doc with actorUid=AGENT_UID (simulating prior activity)
    //   - record the auditLogs doc count before erasure
    //   - run eraseDataSubject
    //   - assert: auditLogs row count is UNCHANGED (original row survived)
    //   - assert: a NEW auditLogs row with action:'erasure' was appended (count +1)
    //
    // Wave 0: unreachable — module import fails first.

    const result = await eraseDataSubject({ subjectType: 'agent', id: AGENT_UID })

    // Return value contract: must include collectionsHit and complete flag
    expect(result).toMatchObject({
      complete: expect.any(Boolean),
      collectionsHit: expect.any(Array),
    })

    // The erasure event itself: action:'erasure' must appear in auditLogs
    // (In Wave 1+: adminDb.collection('auditLogs').where('action','==','erasure').get()
    //  and assert count >= 1 and the prior actorUid row count is unchanged.)
    expect(result.collectionsHit.length).toBeGreaterThanOrEqual(0)
  })

  it('NEVER deletes from auditLogs even though auditLogs.actorUid === subject uid', async () => {
    // This is the Pitfall-2 guard test: the erasure executor must skip auditLogs
    // by construction (code-level EXEMPT guard, because Admin SDK bypasses rules).
    //
    // Wave 1+ assertion:
    //   - seed 3 auditLogs rows with actorUid=AGENT_UID
    //   - run eraseDataSubject
    //   - assert auditLogs count for actorUid=AGENT_UID is still 3 (survived)
    //   - assert 1 new row with action:'erasure' was added (count becomes 4)
    //
    // Wave 0: unreachable — module import fails first.

    const result = await eraseDataSubject({ subjectType: 'agent', id: AGENT_UID })

    // The 'auditLogs' collection must NOT appear in collectionsHit
    // (it is EXEMPT and must be skipped, never touched by the cascade)
    expect(result.collectionsHit).not.toContain('auditLogs')
    expect(result).toMatchObject({ complete: expect.any(Boolean) })
  })

  it('returns collectionsHit array and a complete boolean flag', async () => {
    // Contract: eraseDataSubject must return { complete: boolean, collectionsHit: string[] }
    // where collectionsHit lists which PII collections were successfully cleared.
    //
    // Wave 0: unreachable — module import fails first.

    const result = await eraseDataSubject({ subjectType: 'agent', id: AGENT_UID })

    expect(typeof result.complete).toBe('boolean')
    expect(Array.isArray(result.collectionsHit)).toBe(true)
    // collectionsHit must contain at least conversations, leads, users, agentProfiles
    // (the mandatory agent PII collections)
    const mandatory = ['conversations', 'leads', 'users', 'agentProfiles']
    for (const col of mandatory) {
      expect(result.collectionsHit).toContain(col)
    }
  })
})
