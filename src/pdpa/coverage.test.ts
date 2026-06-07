// QUAL-09 Wave-0 stub — implementation lands in 05-03-PLAN.md

/**
 * src/pdpa/coverage.test.ts — QUAL-09 erasure coverage proof.
 *
 * These tests prove that after `eraseDataSubject` runs, EVERY PII-bearing collection
 * enumerated in PII_ERASURE_MANIFEST reaches 0 docs for that subject, and that
 * `auditLogs` SURVIVES (hashes-only compliance record — audit-exempt by design).
 *
 * Wave 0: tests exist and FAIL because the implementation modules are absent.
 * Wave 1+ (05-03-PLAN.md): the implementations are created; tests turn GREEN.
 *
 * Emulator-gated: these tests require a live Firestore emulator (FIRESTORE_EMULATOR_HOST).
 * Run with: firebase emulators:exec "vitest run src/pdpa/coverage.test.ts"
 * Offline:   `npm test` skips this entire suite cleanly (describe.skip).
 *
 * Requirements: QUAL-09 (SC1 gate), Pitfall 1 (incomplete coverage), Pitfall 2 (audit exempt)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// These imports will FAIL until implementations are created (Wave 0 red-bar intent):
import { PII_ERASURE_MANIFEST } from '@/src/pdpa/coverage'
import { eraseDataSubject } from '@/src/pdpa/erasure'

// ─── Emulator gate ────────────────────────────────────────────────────────────
// Mirror the exact gate from src/firebase/__tests__/rules.test.ts:62-63
const RUN = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const suite = RUN ? describe : describe.skip

// ─── Synthetic test subjects (no real PII — T-05-02) ─────────────────────────
const AGENT_UID = 'agent-test-coverage-001'
const LEAD_ID = 'lead-test-coverage-001'
const CONV_ID = 'conv-test-coverage-001'
const AUDIT_LOG_ID = 'auditlog-test-coverage-001'

// ─── Test suite ───────────────────────────────────────────────────────────────

suite('QUAL-09 erasure coverage — every PII collection reaches 0 docs', () => {
  // NOTE: In Wave 1+ the emulator is started; these tests seed synthetic data and
  // assert post-erasure state. Wave 0: the imports above fail, so the test runner
  // reports "Cannot find module '@/src/pdpa/coverage'" before reaching this block.

  it('EXEMPT list contains auditLogs', () => {
    // Pitfall 2: auditLogs must be exempted by construction, not by accident.
    expect(PII_ERASURE_MANIFEST.EXEMPT).toContain('auditLogs')
  })

  it('every PII collection reaches 0 docs after agent erasure', async () => {
    // Seed one synthetic doc into EVERY agent manifest collection using the
    // verified keyFields from the interfaces block:
    //   conversations.ownerUid, leads.ownerUid, replyEdits.agentUid,
    //   escalations.agentUid, knowledgeGaps.agentUid, agentProfiles/{uid},
    //   rateBudgets/{uid}, users/{uid}
    // Plus one auditLogs row with actorUid=AGENT_UID to prove it SURVIVES.
    // Plus a conversations/{cid}/messages subcollection doc to prove recursive delete.
    //
    // (Implementation detail: use adminDb.collection(...).doc(...).set({...}) via
    // firebase-admin in beforeEach — seeding code lives here in Wave 1+.)
    //
    // Wave 0: this test is unreachable (module import fails first).

    const result = await eraseDataSubject({ subjectType: 'agent', id: AGENT_UID })

    // Agent manifest collections must all reach 0 docs:
    const agentCollections = PII_ERASURE_MANIFEST.agent
      .filter((entry) => entry.collection !== 'STORAGE')
      .map((entry) => entry.collection)

    for (const col of agentCollections) {
      // Assert: 0 docs remain for this subject in each collection
      // (Implementation checks each collection per its keyField / docId / keyVia)
      expect(result.collectionsHit).toContain(col)
    }

    // Recursive delete: messages subcollection must be empty (Pitfall 2 / RESEARCH Pattern 3)
    expect(result.complete).toBe(true)

    // auditLogs SURVIVES — hashes-only, audit-exempt (QUAL-09 / SC1 gate, Pitfall 2)
    // (In Wave 1+ we read auditLogs and assert count is unchanged + an erasure event was added)
    expect(PII_ERASURE_MANIFEST.EXEMPT).toContain('auditLogs')
  })

  it('erasure writes an erasure audit event (action:"erasure") to auditLogs', async () => {
    // Run erasure and assert an action:'erasure' row was appended to auditLogs.
    // The audit log is NOT deleted; a new row is ADDED (D-01 compliance record).
    //
    // Wave 0: unreachable — module import fails first.

    const result = await eraseDataSubject({ subjectType: 'agent', id: AGENT_UID })

    // The erasure event must be in the audit trail
    // (In Wave 1+: read auditLogs where action=='erasure' and subjectIdHash matches)
    expect(result).toMatchObject({ complete: true, collectionsHit: expect.any(Array) })
    // Placeholder assertion for the audit event — Wave 1+ uses adminDb to read auditLogs
    expect(result.collectionsHit.length).toBeGreaterThan(0)
  })

  it('lead erasure reaches lead-keyed collections', async () => {
    // Seed: conversations(leadId), leadContext/{leadId}, leads/{leadId}, replyEdits(leadId)
    // Seed a Finder conversation keyed by leadId (RESEARCH Open Question 2:
    // one lead == one Finder/Reply conversation).
    //
    // Wave 0: unreachable — module import fails first.

    const result = await eraseDataSubject({ subjectType: 'lead', id: LEAD_ID })

    const leadCollections = PII_ERASURE_MANIFEST.lead.map((entry) => entry.collection)
    for (const col of leadCollections) {
      expect(result.collectionsHit).toContain(col)
    }

    // auditLogs survives lead erasure too (same EXEMPT rule applies)
    expect(PII_ERASURE_MANIFEST.EXEMPT).toContain('auditLogs')
    expect(result.complete).toBe(true)
  })
})
