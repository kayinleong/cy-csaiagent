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
 *  T-01-09: no unruled collection (all 19 enumerated here)
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
  readOnlyCtx,
  unauthContext,
  cleanup,
  syntheticNewAgent,
  syntheticSeniorCoach,
  syntheticAdmin,
  syntheticReadOnly,
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
  // @firebase/rules-unit-testing v5 invalidates the RulesTestContext once the
  // withSecurityRulesDisabled() callback resolves, so the seed write MUST happen
  // INSIDE the callback (returning the ctx and calling .firestore() afterwards
  // throws "This RulesTestContext is no longer valid"). Use the env directly.
  const env = await getTestEnv()
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const db = adminCtx.firestore()
    await setDoc(doc(db, path), data)
  })
}

// ─── 1. DENY-BY-DEFAULT: Unauthenticated reads are denied on every collection ──

rulesSuite('Deny-by-default: unauthenticated reads', () => {
  // no unruled collection (all 19 enumerated here — T-01-09 / T-05-UNRULED guard)
  const collections = [
    'users', 'agentProfiles', 'conversations', 'leads', 'leadContext',
    'projects', 'collateral', 'kbDocs', 'kbChunks', 'kbIngestionJobs',
    'escalations', 'auditLogs', 'evals', 'rateBudgets', 'knowledgeGaps',
    'replyEdits',
    // Phase-5 collections 18-20 (T-05-UNRULED / T-05-TAMPER mitigate)
    'usageEvents', 'usageRollups', 'erasureRequests',
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

// ─── 8b. projects + collateral — extended schema (FIND-03/07/10, ADMIN-04, T-03-01) ──
//
// Proves deny-by-default holds for the extended ProjectDoc (priceValue, vpDate,
// priceBand, description, locationText, bedrooms) and CollateralDoc (externalUrl).
// Key guard (T-03-01): senior-coach CANNOT write projects — elevation-of-privilege
// check that admin-only-inventory boundary is enforced for all non-admin roles.

rulesSuite('projects + collateral — extended schema + senior-coach-deny (T-03-01/ADMIN-04)', () => {
  const projectDocId = 'project-extended-001'
  const collateralDocId = 'collateral-extended-001'

  /** Full new-shape ProjectDoc (mirrors the extended ProjectDoc interface from collections.ts). */
  const fullProjectDoc = {
    tenantId: D2_TENANT,
    name: 'Sunway Nexus',
    status: 'active',
    priceValue: 600_000,
    priceBand: '500k_800k',
    tenure: 'leasehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Modern serviced apartment near Subang LRT',
    locationText: 'Subang Jaya, Selangor',
    bedrooms: 3,
    embedding: [],
  }

  /** Full new-shape CollateralDoc (mirrors the extended CollateralDoc interface). */
  const fullCollateralDoc = {
    tenantId: D2_TENANT,
    projectId: projectDocId,
    type: 'poster',
    storagePath: 'gs://cy-csaiagent.appspot.com/collateral/project-001/poster.pdf',
    externalUrl: null,
    lang: 'en',
  }

  beforeAll(async () => {
    await seed(`projects/${projectDocId}`, fullProjectDoc)
    await seed(`collateral/${collateralDocId}`, fullCollateralDoc)
  })

  // ── signed-in tenant user CAN read ──────────────────────────────────────────

  it('new-agent CAN read projects (signed-in, same tenant)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'projects', projectDocId)))
  })

  it('new-agent CAN read collateral (signed-in, same tenant)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'collateral', collateralDocId)))
  })

  // ── unauthenticated CANNOT read ──────────────────────────────────────────────

  it('unauthenticated CANNOT read projects (deny-by-default)', async () => {
    const ctx = await unauthContext()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'projects', projectDocId)))
  })

  it('unauthenticated CANNOT read collateral (deny-by-default)', async () => {
    const ctx = await unauthContext()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'collateral', collateralDocId)))
  })

  // ── non-admin CANNOT write ───────────────────────────────────────────────────

  it('new-agent CANNOT write projects (not admin)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'projects', 'agent-write-attempt'), { ...fullProjectDoc })
    )
  })

  it('new-agent CANNOT write collateral (not admin)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'collateral', 'agent-collateral-write'), { ...fullCollateralDoc })
    )
  })

  // ── T-03-01 elevation-of-privilege guard: senior-coach CANNOT write projects ──

  it('senior-coach CANNOT write projects (admin-only-inventory boundary — T-03-01)', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'projects', 'coach-write-attempt'), { ...fullProjectDoc })
    )
  })

  it('senior-coach CANNOT write collateral (admin-only-inventory boundary — T-03-01)', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'collateral', 'coach-collateral-write'), { ...fullCollateralDoc })
    )
  })

  // ── admin CAN write the full new-shape doc ────────────────────────────────────

  it('admin CAN write full new-shape ProjectDoc (priceValue + vpDate + bedrooms — T-03-02)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(
      setDoc(doc(db, 'projects', 'admin-new-shape-project'), { ...fullProjectDoc })
    )
  })

  it('admin CAN write full new-shape CollateralDoc (externalUrl field — T-03-02)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(
      setDoc(doc(db, 'collateral', 'admin-new-shape-collateral'), { ...fullCollateralDoc })
    )
  })
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

// ─── 14. replyEdits collection — downline-scoped, server-write-only (04-01 Wave 0) ──
//
// REPLY-09 / ADMIN-06 (D-19). Mirrors escalations/knowledgeGaps: agent reads OWN row;
// senior-coach reads downline rows where seniorCoachId == auth.uid; admin reads any
// same-tenant row; cross-agent / cross-coach / cross-tenant reads DENIED; ANY client
// create/update/delete DENIED (append-only, Admin-SDK writes only).
//
// These are emulator-gated (rulesSuite = describe.skip without FIRESTORE_EMULATOR_HOST),
// so they do NOT run in the offline `npm run test` (exit 0 preserved). They turn RED
// against the live emulator until Plan 04-07 adds the `replyEdits` match block to
// firestore.rules (the seniorCoachId denormalization is proven here — Pitfall D).

rulesSuite('replyEdits collection — downline-scoped, server-write-only (REPLY-09/ADMIN-06, D-19)', () => {
  const ownEditId = 'reply-edit-own-001'        // agent = syntheticNewAgent, coach = syntheticSeniorCoach
  const otherEditId = 'reply-edit-other-001'     // agent = stranger, coach = other-coach-uid

  beforeAll(async () => {
    await seed(`replyEdits/${ownEditId}`, {
      tenantId: D2_TENANT,
      leadId: 'lead-001',
      draftId: 'draft-001',
      sopDocIds: ['sop-cold-001'],
      originalDraft: 'synthetic original',
      editedFinal: 'synthetic edited',
      editRatio: 0.12,
      agentUid: syntheticNewAgent.uid,
      seniorCoachId: syntheticSeniorCoach.uid,
      lang: 'en',
      timestamp: new Date(),
    })
    await seed(`replyEdits/${otherEditId}`, {
      tenantId: D2_TENANT,
      leadId: 'lead-002',
      draftId: 'draft-002',
      sopDocIds: ['sop-obj-001'],
      originalDraft: 'synthetic original 2',
      editedFinal: 'synthetic edited 2',
      editRatio: 0,
      agentUid: STRANGER_UID,
      seniorCoachId: 'other-coach-uid',
      lang: 'ms',
      thumbsDown: true,
      timestamp: new Date(),
    })
  })

  // agent reads OWN row — SUCCEEDS
  it('agent CAN read their own replyEdits row (agentUid == self)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'replyEdits', ownEditId)))
  })

  // agent reads ANOTHER agent's row — DENIED
  it("agent CANNOT read another agent's replyEdits row", async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'replyEdits', otherEditId)))
  })

  // senior-coach reads a DOWNLINE row (seniorCoachId == coach.uid) — SUCCEEDS
  it('senior-coach CAN read a downline replyEdits row where seniorCoachId == self', async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'replyEdits', ownEditId)))
  })

  // senior-coach reads ANOTHER coach's downline row — DENIED
  it("senior-coach CANNOT read a different coach's downline replyEdits row (cross-coach denied)", async () => {
    const ctx = await seniorCoachCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'replyEdits', otherEditId)))
  })

  // admin reads ANY same-tenant row — SUCCEEDS
  it('admin CAN read any replyEdits row in the tenant', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'replyEdits', ownEditId)))
    await assertSucceeds(getDoc(doc(db, 'replyEdits', otherEditId)))
  })

  // ANY client CREATE — DENIED (server/Admin-SDK writes only, append-only)
  it('any client CREATE on replyEdits is DENIED (server/Admin-SDK writes only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'replyEdits', 'client-created-edit'), {
        tenantId: D2_TENANT,
        leadId: 'lead-001',
        draftId: 'draft-x',
        sopDocIds: ['sop-cold-001'],
        originalDraft: 'x',
        editedFinal: 'x',
        editRatio: 0,
        agentUid: syntheticNewAgent.uid,
        seniorCoachId: syntheticSeniorCoach.uid,
        lang: 'en',
        timestamp: new Date(),
      }),
    )
  })

  // ANY client UPDATE — DENIED (append-only)
  it('any client UPDATE on replyEdits is DENIED (append-only)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(updateDoc(doc(db, 'replyEdits', ownEditId), { editRatio: 0.99 }))
  })

  // ANY client DELETE — DENIED (append-only)
  it('any client DELETE on replyEdits is DENIED (append-only)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(deleteDoc(doc(db, 'replyEdits', ownEditId)))
  })

  // cross-tenant admin read — DENIED
  it('admin with the WRONG tenant CANNOT read a replyEdits row (cross-tenant denied)', async () => {
    const { authedContext } = await import('./rules-helpers')
    const wrongTenantAdmin = await authedContext('wrong-tenant-admin', { role: 'admin', tenantId: WRONG_TENANT })
    const db = wrongTenantAdmin.firestore()
    await assertFails(getDoc(doc(db, 'replyEdits', ownEditId)))
  })
})

// ─── 15. usageEvents collection — server-write-only, admin-read (T-05-UNRULED/T-05-TAMPER) ──

rulesSuite('usageEvents collection — server-write-only, admin-read (QUAL-08/D-04, T-05-UNRULED/T-05-TAMPER)', () => {
  const usageEventDocId = 'usage-event-001'

  beforeAll(async () => {
    await seed(`usageEvents/${usageEventDocId}`, {
      tenantId: D2_TENANT,
      uid: syntheticNewAgent.uid,
      pillar: 'coach',
      inputTokens: 150,
      outputTokens: 80,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      day: '2026-06-07',
      createdAt: new Date(),
    })
  })

  // admin CAN read — org-wide cost/usage view
  it('admin CAN read usageEvents (org-wide cost view)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'usageEvents', usageEventDocId)))
  })

  // new-agent CANNOT read — Information Disclosure guard (T-05-UNRULED)
  it('new-agent CANNOT read usageEvents (Information Disclosure guard)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'usageEvents', usageEventDocId)))
  })

  // any client CREATE DENIED — Tampering guard (T-05-TAMPER)
  it('any client CREATE on usageEvents is DENIED (Admin-SDK only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'usageEvents', 'client-created-event'), {
        tenantId: D2_TENANT,
        uid: syntheticNewAgent.uid,
        pillar: 'coach',
        inputTokens: 9999,
        outputTokens: 9999,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        day: '2026-06-07',
        createdAt: new Date(),
      })
    )
  })

  // any client UPDATE DENIED — Tampering guard
  it('any client UPDATE on usageEvents is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(updateDoc(doc(db, 'usageEvents', usageEventDocId), { inputTokens: 99999 }))
  })

  // any client DELETE DENIED — Tampering guard
  it('any client DELETE on usageEvents is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(deleteDoc(doc(db, 'usageEvents', usageEventDocId)))
  })

  // cross-tenant admin CANNOT read — sameTenant() guard (T-05-CROSS)
  it('admin with wrong tenant CANNOT read usageEvents (cross-tenant denied, T-05-CROSS)', async () => {
    const { authedContext } = await import('./rules-helpers')
    const wrongTenantAdmin = await authedContext('wrong-tenant-admin-ue', { role: 'admin', tenantId: WRONG_TENANT })
    const db = wrongTenantAdmin.firestore()
    await assertFails(getDoc(doc(db, 'usageEvents', usageEventDocId)))
  })
})

// ─── 16. usageRollups collection — server-write-only, admin-read (T-05-UNRULED/T-05-TAMPER) ──

rulesSuite('usageRollups collection — server-write-only, admin-read (QUAL-08/ADMIN-08/D-05, T-05-UNRULED/T-05-TAMPER)', () => {
  const rollupDocId = '2026-06-07__agent-test-001__coach'

  beforeAll(async () => {
    await seed(`usageRollups/${rollupDocId}`, {
      tenantId: D2_TENANT,
      day: '2026-06-07',
      uid: syntheticNewAgent.uid,
      pillar: 'coach',
      msgCount: 5,
      inputTokens: 750,
      outputTokens: 400,
      cachedInputTokens: 150,
      cacheCreationInputTokens: 0,
      updatedAt: new Date(),
    })
  })

  // admin CAN read usageRollups — ADMIN-08 dashboard data source
  it('admin CAN read usageRollups (ADMIN-08 dashboard, admin CAN read usageRollups)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'usageRollups', rollupDocId)))
  })

  // new-agent CANNOT read — Information Disclosure guard
  it('new-agent CANNOT read usageRollups (Information Disclosure guard)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'usageRollups', rollupDocId)))
  })

  // any client CREATE DENIED — Tampering guard
  it('any client CREATE on usageRollups is DENIED (Admin-SDK only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'usageRollups', 'client-created-rollup'), {
        tenantId: D2_TENANT,
        day: '2026-06-07',
        uid: syntheticNewAgent.uid,
        pillar: 'coach',
        msgCount: 999,
        inputTokens: 999,
        outputTokens: 999,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        updatedAt: new Date(),
      })
    )
  })

  // any client UPDATE DENIED
  it('any client UPDATE on usageRollups is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(updateDoc(doc(db, 'usageRollups', rollupDocId), { msgCount: 9999 }))
  })

  // any client DELETE DENIED
  it('any client DELETE on usageRollups is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(deleteDoc(doc(db, 'usageRollups', rollupDocId)))
  })

  // cross-tenant admin CANNOT read — sameTenant() guard (T-05-CROSS)
  it('admin with wrong tenant CANNOT read usageRollups (cross-tenant denied, T-05-CROSS)', async () => {
    const { authedContext } = await import('./rules-helpers')
    const wrongTenantAdmin = await authedContext('wrong-tenant-admin-ur', { role: 'admin', tenantId: WRONG_TENANT })
    const db = wrongTenantAdmin.firestore()
    await assertFails(getDoc(doc(db, 'usageRollups', rollupDocId)))
  })
})

// ─── 17. erasureRequests collection — server-write-only, admin-read (T-05-UNRULED/T-05-TAMPER) ──

rulesSuite('erasureRequests collection — server-write-only, admin-read (QUAL-09/D-02, T-05-UNRULED/T-05-TAMPER)', () => {
  const erasureDocId = 'erasure-req-001'

  beforeAll(async () => {
    await seed(`erasureRequests/${erasureDocId}`, {
      tenantId: D2_TENANT,
      subjectType: 'agent',
      subjectIdHash: 'abc123hash456def',
      status: 'pending',
      requestedBy: syntheticAdmin.uid,
      requestedAt: new Date(),
      slaDeadline: Date.now() + 72 * 60 * 60 * 1000,
      collectionsRemaining: ['conversations', 'leads'],
    })
  })

  // admin CAN read — erasure monitoring
  it('admin CAN read erasureRequests (erasure monitoring)', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'erasureRequests', erasureDocId)))
  })

  // new-agent CANNOT read — Information Disclosure guard
  it('new-agent CANNOT read erasureRequests (Information Disclosure guard)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'erasureRequests', erasureDocId)))
  })

  // any client CREATE DENIED — Tampering guard (client cannot forge erasure requests)
  it('any client CREATE on erasureRequests is DENIED (Admin-SDK only)', async () => {
    const ctx = await newAgentCtx()
    const db = ctx.firestore()
    await assertFails(
      setDoc(doc(db, 'erasureRequests', 'client-created-erasure'), {
        tenantId: D2_TENANT,
        subjectType: 'agent',
        subjectIdHash: 'fakehash',
        status: 'pending',
        requestedBy: syntheticNewAgent.uid,
        requestedAt: new Date(),
        slaDeadline: Date.now() + 72 * 60 * 60 * 1000,
        collectionsRemaining: [],
      })
    )
  })

  // any client UPDATE DENIED
  it('any client UPDATE on erasureRequests is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(updateDoc(doc(db, 'erasureRequests', erasureDocId), { status: 'complete' }))
  })

  // any client DELETE DENIED
  it('any client DELETE on erasureRequests is DENIED', async () => {
    const ctx = await adminRoleCtx()
    const db = ctx.firestore()
    await assertFails(deleteDoc(doc(db, 'erasureRequests', erasureDocId)))
  })

  // cross-tenant admin CANNOT read — sameTenant() guard (T-05-CROSS)
  it('admin with wrong tenant CANNOT read erasureRequests (cross-tenant denied, T-05-CROSS)', async () => {
    const { authedContext } = await import('./rules-helpers')
    const wrongTenantAdmin = await authedContext('wrong-tenant-admin-er', { role: 'admin', tenantId: WRONG_TENANT })
    const db = wrongTenantAdmin.firestore()
    await assertFails(getDoc(doc(db, 'erasureRequests', erasureDocId)))
  })
})

// ─── 18. read-only role — the RO-01 collection-by-collection rules matrix ─────
//
// Phase 6 (RO-01). The read-only stakeholder is a least-privilege analytics
// reader. This block encodes the LOCKED rules matrix from 06-VALIDATION.md /
// 06-CONTEXT.md as assertions over readOnlyCtx():
//
//   ALLOW READ : usageRollups, usageEvents, evals (analytics aggregates)
//                projects, collateral, kbDocs, kbChunks, kbIngestionJobs (KB read)
//   DENY  READ : auditLogs, conversations, messages, leads, leadContext,
//                erasureRequests, rateBudgets, knowledgeGaps, escalations,
//                users, agentProfiles  (PII / owner-scoped — Pitfall 2)
//   DENY  WRITE: every collection (read-only never writes)
//
// RED-BY-DESIGN: today firestore.rules has no `read-only` role, so the analytics
// `assertSucceeds` reads FAIL (admin-only rules) — these turn GREEN when Wave 2/3
// add isAnalyticsReader() to firestore.rules. The DENY assertions should already
// pass (deny-by-default) and must STAY denied after the rules land.
//
// CRITICAL (Pitfall 2): there is NO assertSucceeds on a PII-collection read for
// read-only anywhere in this block — asserting a PII read SUCCEEDS would encode
// an information-disclosure leak (T-06-01). The acceptance grep gate enforces this.
//
// Emulator-gated via rulesSuite (describe.skip without FIRESTORE_EMULATOR_HOST).

rulesSuite('read-only role — RO-01 analytics-reader matrix (T-06-01)', () => {
  // Reuse a stable doc id per collection; seeded via the admin (rules-bypassing) ctx.
  const ROLLUP_ID = '2026-06-07__ro-test-001__coach'
  const USAGE_EVENT_ID = 'ro-usage-event-001'
  const EVAL_ID = 'ro-eval-001'
  const KB_DOC_ID = 'ro-kb-doc-001'

  beforeAll(async () => {
    await seed(`usageRollups/${ROLLUP_ID}`, {
      tenantId: D2_TENANT, day: '2026-06-07', uid: syntheticNewAgent.uid, pillar: 'coach',
      msgCount: 1, inputTokens: 10, outputTokens: 5, cachedInputTokens: 0,
      cacheCreationInputTokens: 0, updatedAt: new Date(),
    })
    await seed(`usageEvents/${USAGE_EVENT_ID}`, {
      tenantId: D2_TENANT, uid: syntheticNewAgent.uid, pillar: 'coach',
      inputTokens: 10, outputTokens: 5, cachedInputTokens: 0,
      cacheCreationInputTokens: 0, day: '2026-06-07', createdAt: new Date(),
    })
    await seed(`evals/${EVAL_ID}`, {
      tenantId: D2_TENANT, suite: 'coach-en', lang: 'en', score: 0.9,
      judgeModel: 'claude-opus-4-7', failures: [],
    })
    for (const col of ['projects', 'collateral', 'kbDocs', 'kbChunks', 'kbIngestionJobs']) {
      await seed(`${col}/${KB_DOC_ID}`, { tenantId: D2_TENANT, name: 'ro read test' })
    }
    // PII / owner-scoped docs the read-only user must NOT read.
    await seed(`auditLogs/ro-audit-001`, {
      tenantId: D2_TENANT, actorUid: syntheticNewAgent.uid, action: 'chat_turn',
      targetRef: 'conversations/c', hashes: {}, ts: new Date(),
    })
    await seed(`conversations/ro-conv-001`, {
      tenantId: D2_TENANT, ownerUid: syntheticNewAgent.uid, pillar: 'coach',
      lang: 'en', createdAt: new Date(), summary: '',
    })
    await seed(`conversations/ro-conv-001/messages/ro-msg-001`, {
      tenantId: D2_TENANT, role: 'user', content: 'x', citations: [],
      routeDecision: 'coach', tokens: 1, redacted: false,
    })
    await seed(`leads/ro-lead-001`, {
      tenantId: D2_TENANT, ownerUid: syntheticNewAgent.uid, name: '<LEAD_ID:RO>',
      phoneHash: 'hash-ro', consentFlag: true, nationality: 'MY', segment: 'investor',
    })
    await seed(`leadContext/ro-lead-ctx-001`, {
      tenantId: D2_TENANT, coachSlot: {}, finderSlot: {}, replySlot: {},
      rollingSummary: '', updatedAt: new Date(),
    })
    await seed(`erasureRequests/ro-erasure-001`, {
      tenantId: D2_TENANT, subjectType: 'agent', subjectIdHash: 'h', status: 'pending',
      requestedBy: syntheticAdmin.uid, requestedAt: new Date(),
      slaDeadline: Date.now() + 1000, collectionsRemaining: [],
    })
    await seed(`rateBudgets/${syntheticNewAgent.uid}`, {
      tenantId: D2_TENANT, ownerUid: syntheticNewAgent.uid, requestCount: 0,
      tokenCount: 0, windowStart: new Date(),
    })
    await seed(`knowledgeGaps/ro-gap-001`, {
      tenantId: D2_TENANT, seniorCoachId: syntheticSeniorCoach.uid,
      agentUid: syntheticNewAgent.uid, topicHash: 'h', topicLabel: 't', lang: 'en',
      count: 1, lastSeenAt: new Date(),
    })
    await seed(`escalations/ro-esc-001`, {
      tenantId: D2_TENANT, agentUid: syntheticNewAgent.uid,
      seniorCoachId: syntheticSeniorCoach.uid, reason: 'stall-detect',
      contextBundle: {}, status: 'open', openedAt: new Date(),
    })
    await seed(`users/${syntheticNewAgent.uid}`, {
      tenantId: D2_TENANT, role: 'new-agent', lang: 'en', voiceSamples: [],
      uplineCoachId: syntheticSeniorCoach.uid,
    })
    await seed(`agentProfiles/${syntheticNewAgent.uid}`, {
      tenantId: D2_TENANT, journeyStage: 'onboarding', currentCheckpoint: 'intro',
      lastActiveAt: new Date(), activeLeadIds: [], seniorCoachId: syntheticSeniorCoach.uid,
    })
    // A users doc for the read-only stakeholder itself — it must NOT be able to
    // read even its OWN users row (read-only is not self of an agent; LOCKED deny).
    await seed(`users/${syntheticReadOnly.uid}`, {
      tenantId: D2_TENANT, role: 'read-only', lang: 'en', voiceSamples: [],
    })
  })

  // ── ALLOW READ: analytics aggregates (RED until isAnalyticsReader() lands) ──

  it('read-only CAN read usageRollups (analytics aggregate)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertSucceeds(getDoc(doc(db, 'usageRollups', ROLLUP_ID)))
  })

  it('read-only CAN read usageEvents (analytics aggregate, counts-only)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertSucceeds(getDoc(doc(db, 'usageEvents', USAGE_EVENT_ID)))
  })

  it('read-only CAN read evals (analytics aggregate)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertSucceeds(getDoc(doc(db, 'evals', EVAL_ID)))
  })

  // ── ALLOW READ: KB read collections (signed-in tenant read) ──

  for (const col of ['projects', 'collateral', 'kbDocs', 'kbChunks', 'kbIngestionJobs'] as const) {
    it(`read-only CAN read ${col} (signed-in tenant read)`, async () => {
      const db = (await readOnlyCtx()).firestore()
      await assertSucceeds(getDoc(doc(db, col, KB_DOC_ID)))
    })
  }

  // ── DENY READ: PII / owner-scoped collections (Pitfall 2 — never assertSucceeds) ──

  it('read-only CANNOT read auditLogs (PII / compliance — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'auditLogs', 'ro-audit-001')))
  })

  it('read-only CANNOT read conversations (PII — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'conversations', 'ro-conv-001')))
  })

  it('read-only CANNOT read conversation messages (PII — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'conversations', 'ro-conv-001', 'messages', 'ro-msg-001')))
  })

  it('read-only CANNOT read leads (PII — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'leads', 'ro-lead-001')))
  })

  it('read-only CANNOT read leadContext (PII — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'leadContext', 'ro-lead-ctx-001')))
  })

  it('read-only CANNOT read erasureRequests (PDPA — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'erasureRequests', 'ro-erasure-001')))
  })

  it('read-only CANNOT read rateBudgets (owner-scoped — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'rateBudgets', syntheticNewAgent.uid)))
  })

  it('read-only CANNOT read knowledgeGaps (carries agentUid — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'knowledgeGaps', 'ro-gap-001')))
  })

  it('read-only CANNOT read escalations (carries agentUid — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'escalations', 'ro-esc-001')))
  })

  it('read-only CANNOT read users (PII — denied, incl. its own row)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'users', syntheticNewAgent.uid)))
    await assertFails(getDoc(doc(db, 'users', syntheticReadOnly.uid)))
  })

  it('read-only CANNOT read agentProfiles (PII — denied)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(getDoc(doc(db, 'agentProfiles', syntheticNewAgent.uid)))
  })

  // ── DENY WRITE: read-only never writes any collection ──

  it('read-only CANNOT write usageRollups (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'usageRollups', 'ro-write-rollup'), { tenantId: D2_TENANT }))
  })

  it('read-only CANNOT write usageEvents (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'usageEvents', 'ro-write-event'), { tenantId: D2_TENANT }))
  })

  it('read-only CANNOT write evals (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'evals', 'ro-write-eval'), { tenantId: D2_TENANT }))
  })

  it('read-only CANNOT write kbDocs (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'kbDocs', 'ro-write-kbdoc'), { tenantId: D2_TENANT, name: 'x' }))
  })

  it('read-only CANNOT write projects (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'projects', 'ro-write-project'), { tenantId: D2_TENANT, name: 'x' }))
  })

  it('read-only CANNOT write collateral (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'collateral', 'ro-write-collateral'), { tenantId: D2_TENANT }))
  })

  it('read-only CANNOT write leadContext (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'leadContext', 'ro-write-leadctx'), { tenantId: D2_TENANT }))
  })

  it('read-only CANNOT write users (read-only never writes)', async () => {
    const db = (await readOnlyCtx()).firestore()
    await assertFails(setDoc(doc(db, 'users', syntheticReadOnly.uid), { tenantId: D2_TENANT, role: 'admin' }))
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a custom-role context outside the 3 synthetic defaults. */
async function authedAs(uid: string, role: string, tenantId: string) {
  const { authedContext } = await import('./rules-helpers')
  return authedContext(uid, { role, tenantId })
}
