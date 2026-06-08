/**
 * scripts/pdpa-erasure-drill.ts — Live PDPA erasure end-to-end drill (QUAL-09 §6).
 *
 * SYNTHETIC-ONLY. Seeds a fake data-subject across every PII_ERASURE_MANIFEST collection
 * (plus one auditLogs row), runs eraseDataSubject to completion, and verifies:
 *   1. every PII collection reaches 0 docs for the subject,
 *   2. the conversation's messages subcollection is gone (recursiveDelete),
 *   3. auditLogs SURVIVES (the exempt legal record),
 *   4. an `action:'erasure'` audit event was appended.
 * Then it cleans up the synthetic audit rows so production audit log is not polluted.
 *
 * SAFETY: the subject id MUST start with `DRILL-` — the script refuses anything else, so it
 * can never match a real agent/lead. A fresh Firestore backup was taken before this drill.
 *
 * Usage: npx tsx scripts/pdpa-erasure-drill.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const TENANT = 'd2'
const ts = Date.now()
const DRILL_ID = `DRILL-agent-${ts}`
const DRILL_LEAD = `DRILL-lead-${ts}`
const REQ_ID = `drill-${ts}`

if (!DRILL_ID.startsWith('DRILL-') || !DRILL_LEAD.startsWith('DRILL-')) {
  throw new Error('SAFETY: drill subject ids must start with "DRILL-"')
}

async function main() {
  const { adminDb } = await import('@/src/firebase/admin')
  const { eraseDataSubject } = await import('@/src/pdpa/erasure')

  console.log(`[drill] synthetic agent=${DRILL_ID} lead=${DRILL_LEAD}`)

  // ── 1. SEED synthetic data across the agent manifest ────────────────────────
  const convRef = adminDb.collection('conversations').doc()
  await convRef.set({ ownerUid: DRILL_ID, tenantId: TENANT, _drill: true })
  await convRef.collection('messages').doc().set({ role: 'user', text: 'drill', tenantId: TENANT, _drill: true })
  await adminDb.collection('leads').doc(DRILL_LEAD).set({ ownerUid: DRILL_ID, tenantId: TENANT, _drill: true })
  await adminDb.collection('leadContext').doc(DRILL_LEAD).set({ tenantId: TENANT, _drill: true })
  await adminDb.collection('replyEdits').doc().set({ agentUid: DRILL_ID, tenantId: TENANT, _drill: true })
  await adminDb.collection('escalations').doc().set({ agentUid: DRILL_ID, tenantId: TENANT, _drill: true })
  await adminDb.collection('knowledgeGaps').doc().set({ agentUid: DRILL_ID, tenantId: TENANT, _drill: true })
  await adminDb.collection('agentProfiles').doc(DRILL_ID).set({ tenantId: TENANT, _drill: true })
  await adminDb.collection('rateBudgets').doc(DRILL_ID).set({ tenantId: TENANT, _drill: true })
  await adminDb.collection('users').doc(DRILL_ID).set({ tenantId: TENANT, _drill: true })
  // auditLogs row that MUST survive erasure (exempt legal record)
  await adminDb.collection('auditLogs').add({ actorUid: DRILL_ID, action: 'drill-seed', tenantId: TENANT, _drill: true })

  // ── 2. Count before ─────────────────────────────────────────────────────────
  const countKey = async (col: string, field: string) =>
    (await adminDb.collection(col).where(field, '==', DRILL_ID).count().get()).data().count
  const existsDoc = async (col: string, id: string) => (await adminDb.collection(col).doc(id).get()).exists

  const before = {
    conversations: await countKey('conversations', 'ownerUid'),
    leads: await countKey('leads', 'ownerUid'),
    leadContext: (await existsDoc('leadContext', DRILL_LEAD)) ? 1 : 0,
    replyEdits: await countKey('replyEdits', 'agentUid'),
    escalations: await countKey('escalations', 'agentUid'),
    knowledgeGaps: await countKey('knowledgeGaps', 'agentUid'),
    agentProfiles: (await existsDoc('agentProfiles', DRILL_ID)) ? 1 : 0,
    rateBudgets: (await existsDoc('rateBudgets', DRILL_ID)) ? 1 : 0,
    users: (await existsDoc('users', DRILL_ID)) ? 1 : 0,
  }
  const messagesBefore = (await convRef.collection('messages').count().get()).data().count
  const auditBefore = (await adminDb.collection('auditLogs').where('actorUid', '==', DRILL_ID).count().get()).data().count
  console.log('[drill] seeded:', { ...before, messages: messagesBefore, auditLogs: auditBefore })

  // ── 3. Erase (loop to completion, mimicking the sweep) ──────────────────────
  const startedAt = Date.now()
  let passes = 0
  let result
  do {
    result = await eraseDataSubject({ subjectType: 'agent', id: DRILL_ID, actorUid: 'DRILL', reqId: REQ_ID })
    passes++
  } while (!result.complete && passes < 25)
  const elapsedMs = Date.now() - startedAt
  console.log(`[drill] erase complete=${result.complete} passes=${passes} elapsedMs=${elapsedMs}`)

  // ── 4. Verify after ─────────────────────────────────────────────────────────
  const after = {
    conversations: await countKey('conversations', 'ownerUid'),
    leads: await countKey('leads', 'ownerUid'),
    leadContext: (await existsDoc('leadContext', DRILL_LEAD)) ? 1 : 0,
    replyEdits: await countKey('replyEdits', 'agentUid'),
    escalations: await countKey('escalations', 'agentUid'),
    knowledgeGaps: await countKey('knowledgeGaps', 'agentUid'),
    agentProfiles: (await existsDoc('agentProfiles', DRILL_ID)) ? 1 : 0,
    rateBudgets: (await existsDoc('rateBudgets', DRILL_ID)) ? 1 : 0,
    users: (await existsDoc('users', DRILL_ID)) ? 1 : 0,
  }
  const messagesAfter = (await convRef.collection('messages').count().get()).data().count
  const auditAfter = (await adminDb.collection('auditLogs').where('actorUid', '==', DRILL_ID).count().get()).data().count
  const erasureEvents = (await adminDb.collection('auditLogs').where('actorUid', '==', 'DRILL').where('action', '==', 'erasure').count().get()).data().count

  const piiZeroed = Object.values(after).every((v) => v === 0) && messagesAfter === 0
  const auditSurvived = auditAfter >= 1
  const erasureLogged = erasureEvents >= 1

  console.log('[drill] after erasure:', { ...after, messages: messagesAfter })
  console.log(`[drill] PII zeroed:        ${piiZeroed ? 'PASS' : 'FAIL'}`)
  console.log(`[drill] auditLogs survived: ${auditSurvived ? 'PASS' : 'FAIL'} (rows=${auditAfter})`)
  console.log(`[drill] erasure event:     ${erasureLogged ? 'PASS' : 'FAIL'} (events=${erasureEvents})`)

  // ── 5. Cleanup synthetic audit rows (keep prod audit log clean) ─────────────
  for (const actor of [DRILL_ID, 'DRILL']) {
    const snap = await adminDb.collection('auditLogs').where('actorUid', '==', actor).get()
    for (const d of snap.docs) await d.ref.delete()
  }
  // remove the now-empty drill conversation shell if it lingered (it shouldn't)
  if ((await convRef.get()).exists) await adminDb.recursiveDelete(convRef)
  console.log('[drill] cleanup done (synthetic audit rows removed)')

  const pass = result.complete && piiZeroed && auditSurvived && erasureLogged
  console.log(`\n[drill] RESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'}  (elapsed ${elapsedMs}ms, well under the 72h SLA)`)
  if (!pass) process.exit(1)
}

main().catch((err) => {
  console.error('[drill] ✗ drill failed:', err?.message ?? err)
  process.exit(1)
})
