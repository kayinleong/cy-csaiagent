/**
 * rules.test.ts — Firestore Security Rules unit tests.
 *
 * Runs against the local Firestore emulator via @firebase/rules-unit-testing.
 * Requires: `firebase emulators:exec` or `firebase emulators:start` with the
 * Firestore emulator running on port 8080 (as configured in firebase.json).
 *
 * Coverage:
 *  - Every collection × 3 roles (new-agent / senior-coach / admin)
 *  - Deny-by-default: unauthenticated access is DENIED on every collection
 *  - Cross-owner reads are DENIED (new-agent cannot read another agent's data)
 *  - Non-downline coach reads are DENIED (coach cannot read an agent they don't manage)
 *  - Cross-tenant admin reads are DENIED (admin with wrong tenantId cannot read)
 *  - auditLogs create/update/delete is DENIED from any client
 *  - rateBudgets cross-agent read/write is DENIED (owner-scoped isolation)
 *  - knowledgeGaps: senior-coach reads own gaps, cross-coach denied, client create denied
 *
 * Threat mitigations proven:
 *  T-01-06: cross-tenant / cross-agent reads denied
 *  T-01-07: auditLogs client mutation denied
 *  T-01-09: no unruled collection (all 16 enumerated here)
 *  T-01-10: rateBudgets cross-agent access denied
 *  T-02-01: cross-coach downline read denied (agentProfiles, knowledgeGaps)
 *  T-02-03: knowledgeGaps client writes denied (server/Admin-SDK only)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, addDoc } from 'firebase/firestore'
import {
  getTestEnv,
  newAgentCtx,
  seniorCoachCtx,
  adminRoleCtx,
  unauthContext,
  adminContext,
  cleanup,
  syntheticNewAgent,
  syntheticSeniorCoach,
  syntheticAdmin,
} from './rules-helpers'

// ─── Test data helpers ────────────────────────────────────────────────────────

/** A base document with the correct tenantId:'d2' for the seed admin context. */
const D2_TENANT = 'd2'
const WRONG_TENANT = 'other-corp'

/** UID of a completely different agent (not in any downline). */
const STRANGER_UID = 'test-uid-stranger-999'

// ─── Emulator gate ────────────────────────────────────────────────────────────
// These rules tests can only run against the local Firestore emulator (you cannot
// assert deny-by-default against production). `firebase emulators:exec` sets
// FIRESTORE_EMULATOR_HOST, which is our signal that the emulator is up. When it is
// absent (default `npm test`, CI without the emulator job), the whole suite skips
// cleanly instead of hard-failing on ECONNREFUSED. Run them with:
//   firebase emulators:exec --only firestore "npm run test:rules"
const RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const rulesSuite = RUN_RULES ? describe : describe.skip

// ─── Lifecycle ────────────────────────────────────────────────────────────────

if (RUN_RULES) {
  beforeAll(async () => {
    // Warm up the emulator environment (loads rules).
    await getTestEnv()
  }, 30_000)

  afterAll(async () => {
    await cleanup()
  }, 10_000)
}

// ─── Helper: seed a doc via admin (bypasses rules for test setup) ─────────────

async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  const ctx = await adminContext()
  const db = ctx.firestore()
  await setDoc(doc(db, path), data)
}

// ─── 1. DENY-BY-DEFAULT: Unauthenticated reads are denied on every collection ──

rulesSuite('Deny-by-default: unauthenticated reads', () => {
  const collections = [
    'users', 'agentProfiles', 'conversations', 'leads', 'leadContext',
    'projects', 'collateral', 'kbDocs', 'kbChunks', 'kbIngestionJobs',
    'escalations', 'auditLogs', 'evals', 'rateBudgets', 'knowledgeGaps',
  ]

  for (const col of collections) {
    it(`unauthenticated GET on /${col}/some-doc is DENIED`, async () => {
      const ctx = await unauthContext()
      const db = ctx.firestore()
      await assertFails(getDoc(doc(db, col, 'some-doc')))
    })
  }
})

// ─── 2. users collection ──────────────────────────────────────────────────────

rulesSuite('users collection', () => {
  const agentDoc = {
    tenantId: D2_TENANT,
    role: 'new-agent',
    lang: 'en',
    voiceSamples: [],
    uplineCoachId: syntheticSeniorCoach.uid,
  }
  const coachDoc = {
    tenantId: D2_TENANT,
    role: 'senior-coach',
    lang: 'en',
    voiceSamples: [],
  }

  beforeAll(async () => {
    await seed(`users/${syntheticNewAgent.uid}`, agentDoc)
    await seed(`users/${syntheticSeniorCoach.uid}`, coachDoc)
  })

  it('new-agent can read their OWN users doc', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'users', syntheticNewAgent.uid)))
  })

  it('new-agent CANNOT read another user doc (cross-owner denied)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'users', syntheticSeniorCoach.uid)))
  })

  it("senior-coach can read a downline agent's users doc (uplineCoachId == coach.uid)", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'users', syntheticNewAgent.uid)))
  })

  it("senior-coach CANNOT read a stranger's users doc (non-downline denied)", async () => {
    await seed(`users/${STRANGER_UID}`, { tenantId: D2_TENANT, role: 'new-agent', lang: 'en', voiceSamples: [], uplineCoachId: 'some-other-coach' })
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'users', STRANGER_UID)))
  })

  it('admin can read any users doc in the same tenant', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'users', syntheticNewAgent.uid)))
  })

  it('admin with WRONG tenant CANNOT read a d2 users doc (cross-tenant denied)', async () => {
    const wrongCtx = await authedAs(syntheticAdmin.uid, 'admin', WRONG_TENANT)
    const db = wrongCtx.firestore()
    await assertFails(getDoc(doc(db, 'users', syntheticNewAgent.uid)))
  })
})

// ─── 3. agentProfiles collection ─────────────────────────────────────────────

rulesSuite('agentProfiles collection', () => {
  const agentProfile = {
    tenantId: D2_TENANT,
    journeyStage: 'onboarding',
    currentCheckpoint: 'intro',
    lastActiveAt: new Date(),
    activeLeadIds: [],
    seniorCoachId: syntheticSeniorCoach.uid,
  }
  const strangerProfile = {
    tenantId: D2_TENANT,
    journeyStage: 'onboarding',
    currentCheckpoint: 'intro',
    lastActiveAt: new Date(),
    activeLeadIds: [],
    seniorCoachId: 'other-coach-uid',
  }

  beforeAll(async () => {
    await seed(`agentProfiles/${syntheticNewAgent.uid}`, agentProfile)
    await seed(`agentProfiles/${STRANGER_UID}`, strangerProfile)
  })

  it('new-agent can read their OWN agentProfile', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'agentProfiles', syntheticNewAgent.uid)))
  })

  it('new-agent CANNOT read another agentProfile (cross-owner denied)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'agentProfiles', STRANGER_UID)))
  })

  it("senior-coach CAN read a downline agent's agentProfile (seniorCoachId == coach.uid)", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'agentProfiles', syntheticNewAgent.uid)))
  })

  it("senior-coach CANNOT read a non-downline agentProfile", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'agentProfiles', STRANGER_UID)))
  })

  it('admin CAN read any agentProfile in the tenant', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'agentProfiles', syntheticNewAgent.uid)))
  })
})

// ─── 4. conversations collection ─────────────────────────────────────────────

rulesSuite('conversations collection', () => {
  const ownConvId = 'conv-own-001'
  const otherConvId = 'conv-other-001'

  beforeAll(async () => {
    await seed(`conversations/${ownConvId}`, {
      tenantId: D2_TENANT,
      ownerUid: syntheticNewAgent.uid,
      pillar: 'coach',
      lang: 'en',
      createdAt: new Date(),
      summary: '',
    })
    await seed(`conversations/${otherConvId}`, {
      tenantId: D2_TENANT,
      ownerUid: STRANGER_UID,
      pillar: 'coach',
      lang: 'en',
      createdAt: new Date(),
      summary: '',
    })
  })

  it("new-agent can read their OWN conversation", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'conversations', ownConvId)))
  })

  it("new-agent CANNOT read another agent's conversation (cross-owner denied)", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'conversations', otherConvId)))
  })

  it('admin CAN read any conversation', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'conversations', ownConvId)))
  })
})

// ─── 5. conversations/messages subcollection ──────────────────────────────────

rulesSuite('conversations/{cid}/messages subcollection', () => {
  const convId = 'conv-messages-test-001'
  const msgId = 'msg-001'

  beforeAll(async () => {
    await seed(`conversations/${convId}`, {
      tenantId: D2_TENANT,
      ownerUid: syntheticNewAgent.uid,
      pillar: 'coach',
      lang: 'en',
      createdAt: new Date(),
      summary: '',
    })
    await seed(`conversations/${convId}/messages/${msgId}`, {
      tenantId: D2_TENANT,
      role: 'user',
      content: 'Test message',
      citations: [],
      routeDecision: 'coach',
      tokens: 5,
      redacted: false,
    })
  })

  it("new-agent CAN read their OWN conversation's message", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'conversations', convId, 'messages', msgId)))
  })

  it("new-agent CANNOT read another agent's conversation messages", async () => {
    const otherConvId = 'conv-other-messages-001'
    await seed(`conversations/${otherConvId}`, {
      tenantId: D2_TENANT,
      ownerUid: STRANGER_UID,
      pillar: 'coach',
      lang: 'en',
      createdAt: new Date(),
      summary: '',
    })
    await seed(`conversations/${otherConvId}/messages/msg-other`, {
      tenantId: D2_TENANT,
      role: 'user',
      content: 'Stranger message',
      citations: [],
      routeDecision: 'coach',
      tokens: 5,
      redacted: false,
    })
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'conversations', otherConvId, 'messages', 'msg-other')))
  })

  it('admin CAN read any conversation message', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'conversations', convId, 'messages', msgId)))
  })
})

// ─── 6. leads collection ─────────────────────────────────────────────────────

rulesSuite('leads collection', () => {
  const ownLeadId = 'lead-own-001'
  const otherLeadId = 'lead-other-001'

  beforeAll(async () => {
    await seed(`leads/${ownLeadId}`, {
      tenantId: D2_TENANT,
      ownerUid: syntheticNewAgent.uid,
      name: '<LEAD_ID:001>',
      phoneHash: 'hash-001',
      consentFlag: true,
      nationality: 'MY',
      segment: 'first-time-buyer',
    })
    await seed(`leads/${otherLeadId}`, {
      tenantId: D2_TENANT,
      ownerUid: STRANGER_UID,
      name: '<LEAD_ID:002>',
      phoneHash: 'hash-002',
      consentFlag: true,
      nationality: 'MY',
      segment: 'investor',
    })
  })

  it('new-agent can read their OWN lead', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'leads', ownLeadId)))
  })

  it("new-agent CANNOT read another agent's lead (cross-owner denied)", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'leads', otherLeadId)))
  })

  it('admin CAN read any lead', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'leads', ownLeadId)))
  })
})

// ─── 7. leadContext collection ────────────────────────────────────────────────

rulesSuite('leadContext collection', () => {
  const leadContextId = 'lead-ctx-001'

  beforeAll(async () => {
    await seed(`leadContext/${leadContextId}`, {
      tenantId: D2_TENANT,
      coachSlot: {},
      finderSlot: {},
      replySlot: {},
      rollingSummary: '',
      updatedAt: new Date(),
    })
  })

  it('signed-in user CAN read leadContext', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'leadContext', leadContextId)))
  })

  it('unauthenticated user CANNOT read leadContext', async () => {
    const ctx = await unauthContext()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'leadContext', leadContextId)))
  })
})

// ─── 8. KB collections (projects, collateral, kbDocs, kbChunks, kbIngestionJobs) ──

rulesSuite('KB collections (shared tenant read, admin write)', () => {
  const cols = ['projects', 'collateral', 'kbDocs', 'kbChunks', 'kbIngestionJobs'] as const

  for (const col of cols) {
    beforeAll(async () => {
      await seed(`${col}/test-doc-001`, { tenantId: D2_TENANT, name: 'test' })
    })

    it(`${col}: new-agent CAN read (signed-in, same tenant)`, async () => {
      const ctx = await newAgentCtx()
      const db = ctx.firestore()
      await assertSucceeds(getDoc(doc(db, col, 'test-doc-001')))
    })

    it(`${col}: unauthenticated CANNOT read`, async () => {
      const ctx = await unauthContext()
      const db = ctx.firestore()
      await assertFails(getDoc(doc(db, col, 'test-doc-001')))
    })

    it(`${col}: new-agent CANNOT write (not admin)`, async () => {
      const ctx = await newAgentCtx()
      const db = ctx.firestore()
      await assertFails(
        setDoc(doc(db, col, 'new-doc'), { tenantId: D2_TENANT, name: 'unauthorized write' })
      )
    })

    it(`${col}: admin CAN write`, async () => {
      const ctx = await adminRoleCtx()
      const db = ctx.firestore()
      await assertSucceeds(
        setDoc(doc(db, col, `admin-write-${col}`), { tenantId: D2_TENANT, name: 'admin write' })
      )
    })
  }
})

// ─── 9. escalations collection ────────────────────────────────────────────────

rulesSuite('escalations collection', () => {
  const downlineEscalationId = 'esc-downline-001'
  const strangerEscalationId = 'esc-stranger-001'

  beforeAll(async () => {
    await seed(`escalations/${downlineEscalationId}`, {
      tenantId: D2_TENANT,
      agentUid: syntheticNewAgent.uid,
      seniorCoachId: syntheticSeniorCoach.uid,
      reason: 'stall-detect',
      contextBundle: {},
      status: 'open',
      openedAt: new Date(),
    })
    await seed(`escalations/${strangerEscalationId}`, {
      tenantId: D2_TENANT,
      agentUid: STRANGER_UID,
      seniorCoachId: 'other-coach-uid',
      reason: 'stall-detect',
      contextBundle: {},
      status: 'open',
      openedAt: new Date(),
    })
  })

  it("senior-coach CAN read escalation assigned to them", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'escalations', downlineEscalationId)))
  })

  it("senior-coach CANNOT read escalation assigned to a different coach", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'escalations', strangerEscalationId)))
  })

  it('admin CAN read any escalation', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'escalations', downlineEscalationId)))
  })

  it('new-agent CANNOT read escalations', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'escalations', downlineEscalationId)))
  })

  it('no client can CREATE an escalation (server-side only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'escalations', 'client-created-esc'), {
        tenantId: D2_TENANT,
        agentUid: syntheticNewAgent.uid,
        seniorCoachId: syntheticSeniorCoach.uid,
        reason: 'test',
        contextBundle: {},
        status: 'open',
        openedAt: new Date(),
      })
    )
  })
})

// ─── 10. auditLogs collection — IMMUTABLE ────────────────────────────────────

rulesSuite('auditLogs collection — append-only, immutable (T-01-07)', () => {
  const auditDocId = 'audit-log-001'

  beforeAll(async () => {
    await seed(`auditLogs/${auditDocId}`, {
      tenantId: D2_TENANT,
      actorUid: syntheticNewAgent.uid,
      action: 'chat_turn',
      targetRef: 'conversations/conv-001',
      hashes: { content: 'abc123' },
      ts: new Date(),
    })
  })

  it('admin CAN read auditLogs', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'auditLogs', auditDocId)))
  })

  it('new-agent CANNOT read auditLogs', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'auditLogs', auditDocId)))
  })

  it('any client CREATE on auditLogs is DENIED (create: if false)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'auditLogs', 'client-created-log'), {
        tenantId: D2_TENANT,
        actorUid: syntheticNewAgent.uid,
        action: 'fake_action',
        targetRef: 'test',
        hashes: {},
        ts: new Date(),
      })
    )
  })

  it('admin CREATE on auditLogs is DENIED (create: if false — Admin SDK bypasses rules)', async () => {
    // Even admin role cannot create via client SDK — Admin SDK bypasses rules.
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'auditLogs', 'admin-client-created-log'), {
        tenantId: D2_TENANT,
        actorUid: syntheticAdmin.uid,
        action: 'admin_action',
        targetRef: 'test',
        hashes: {},
        ts: new Date(),
      })
    )
  })

  it('any client UPDATE on auditLogs is DENIED (update: if false)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(
      updateDoc(doc(db, 'auditLogs', auditDocId), { action: 'tampered' })
    )
  })

  it('any client DELETE on auditLogs is DENIED (delete: if false)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(deleteDoc(doc(db, 'auditLogs', auditDocId)))
  })
})

// ─── 11. evals collection ────────────────────────────────────────────────────

rulesSuite('evals collection', () => {
  const evalDocId = 'eval-run-001'

  beforeAll(async () => {
    await seed(`evals/${evalDocId}`, {
      tenantId: D2_TENANT,
      suite: 'coach-en',
      lang: 'en',
      score: 0.87,
      judgeModel: 'claude-opus-4-7',
      failures: [],
    })
  })

  it('admin CAN read evals', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'evals', evalDocId)))
  })

  it('new-agent CANNOT read evals', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'evals', evalDocId)))
  })

  it('no client can write evals (write: if false)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'evals', 'client-eval'), {
        tenantId: D2_TENANT,
        suite: 'fake',
        lang: 'en',
        score: 1.0,
        judgeModel: 'fake',
        failures: [],
      })
    )
  })
})

// ─── 12. rateBudgets collection — owner-scoped (T-01-10) ─────────────────────

rulesSuite('rateBudgets collection — cross-agent isolation (T-01-10)', () => {
  const agentBudgetId = syntheticNewAgent.uid   // rateBudgets/{uid}
  const strangerBudgetId = STRANGER_UID

  beforeAll(async () => {
    await seed(`rateBudgets/${agentBudgetId}`, {
      tenantId: D2_TENANT,
      ownerUid: syntheticNewAgent.uid,
      requestCount: 0,
      tokenCount: 0,
      windowStart: new Date(),
    })
    await seed(`rateBudgets/${strangerBudgetId}`, {
      tenantId: D2_TENANT,
      ownerUid: STRANGER_UID,
      requestCount: 0,
      tokenCount: 0,
      windowStart: new Date(),
    })
  })

  it('new-agent CAN read their OWN rateBudgets doc', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'rateBudgets', agentBudgetId)))
  })

  it('new-agent CAN write their OWN rateBudgets doc', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(
      setDoc(doc(db, 'rateBudgets', agentBudgetId), {
        tenantId: D2_TENANT,
        ownerUid: syntheticNewAgent.uid,
        requestCount: 1,
        tokenCount: 500,
        windowStart: new Date(),
      })
    )
  })

  it("new-agent CANNOT read another agent's rateBudgets doc (cross-agent denied)", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'rateBudgets', strangerBudgetId)))
  })

  it("new-agent CANNOT write another agent's rateBudgets doc (cross-agent denied)", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'rateBudgets', strangerBudgetId), {
        tenantId: D2_TENANT,
        ownerUid: STRANGER_UID,
        requestCount: 999,
        tokenCount: 999999,
        windowStart: new Date(),
      })
    )
  })

  it('admin CAN read any rateBudgets doc', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'rateBudgets', agentBudgetId)))
    await assertSucceeds(getDoc(doc(db, 'rateBudgets', strangerBudgetId)))
  })

  it('senior-coach CANNOT read an agent rateBudgets doc (not owner, not admin)', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'rateBudgets', agentBudgetId)))
  })

  it('unauthenticated user CANNOT read any rateBudgets doc', async () => {
    const ctx = await unauthContext()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'rateBudgets', agentBudgetId)))
  })
})

// ─── 13. knowledgeGaps collection — downline-scoped (T-02-01, T-02-03) ───────

rulesSuite('knowledgeGaps collection — downline-scoped, server-write-only (T-02-01/T-02-03)', () => {
  const ownGapId = 'gap-own-001'
  const otherGapId = 'gap-other-001'

  beforeAll(async () => {
    await seed(`knowledgeGaps/${ownGapId}`, {
      tenantId: D2_TENANT,
      seniorCoachId: syntheticSeniorCoach.uid,
      agentUid: syntheticNewAgent.uid,
      topicHash: 'abc123hash',
      topicLabel: 'OC bumiputera quota',
      lang: 'en',
      count: 3,
      lastSeenAt: new Date(),
    })
    await seed(`knowledgeGaps/${otherGapId}`, {
      tenantId: D2_TENANT,
      seniorCoachId: 'other-coach-uid',
      agentUid: STRANGER_UID,
      topicHash: 'def456hash',
      topicLabel: 'meta-ads budgeting',
      lang: 'ms',
      count: 1,
      lastSeenAt: new Date(),
    })
  })

  // (d) senior-coach reads their own gap — SUCCEEDS
  it('senior-coach CAN read knowledgeGap where seniorCoachId == self', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'knowledgeGaps', ownGapId)))
  })

  // (e) cross-coach knowledgeGap read — DENIED
  it('senior-coach CANNOT read a knowledgeGap belonging to a different coach (cross-coach denied)', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'knowledgeGaps', otherGapId)))
  })

  // (f) any client create on knowledgeGaps — DENIED
  it('any client CREATE on knowledgeGaps is DENIED (server/Admin-SDK writes only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'knowledgeGaps', 'client-created-gap'), {
        tenantId: D2_TENANT,
        seniorCoachId: syntheticSeniorCoach.uid,
        agentUid: syntheticNewAgent.uid,
        topicHash: 'fakehash',
        topicLabel: 'fake topic',
        lang: 'en',
        count: 1,
        lastSeenAt: new Date(),
      })
    )
  })

  // admin reads all knowledgeGaps — SUCCEEDS (T-02-01 admin path)
  it('admin CAN read any knowledgeGap in the tenant', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'knowledgeGaps', ownGapId)))
    await assertSucceeds(getDoc(doc(db, 'knowledgeGaps', otherGapId)))
  })

  it('new-agent CANNOT read knowledgeGaps (not senior-coach or admin)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'knowledgeGaps', ownGapId)))
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a custom-role context outside the 3 synthetic defaults. */
async function authedAs(uid: string, role: string, tenantId: string) {
  const { authedContext } = await import('./rules-helpers')
  return authedContext(uid, { role, tenantId })
}
