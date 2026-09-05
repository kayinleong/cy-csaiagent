/**
 * scripts/inspect-reply-readiness.ts — READ-ONLY Firestore probe.
 *
 * Answers one question: "which Reply questions will actually produce a grounded draft
 * right now, rather than no_sop_match?" That depends entirely on what is ingested, so
 * this reads the live data instead of guessing.
 *
 * Writes NOTHING. Uses count() aggregates where possible so it does not pull whole
 * collections.
 *
 * PDPA: deliberately never prints lead `name` or `phoneHash`, or any message content.
 * Only counts, category/enum distributions, and KB/project titles (not PII).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/inspect-reply-readiness.ts
 */

import { adminDb } from '@/src/firebase/admin'

const line = (s = '') => console.log(s)

async function safeCount(label: string, q: ReturnType<typeof adminDb.collection>) {
  try {
    const snap = await q.count().get()
    return snap.data().count
  } catch (err) {
    line(`  ! ${label}: ${(err as Error).message.slice(0, 140)}`)
    return -1
  }
}

async function main() {
  line('═══ Reply readiness probe (read-only) ═══')
  line()

  // ── 1. KB pillar distribution ───────────────────────────────────────────────
  line('── kbChunks by pillar ──')
  const totalChunks = await safeCount('kbChunks', adminDb.collection('kbChunks'))
  line(`  total: ${totalChunks}`)
  for (const pillar of ['coach', 'finder', 'reply'] as const) {
    const n = await safeCount(
      `pillar=${pillar}`,
      adminDb.collection('kbChunks').where('pillar', '==', pillar) as never,
    )
    line(`  pillar=${pillar}: ${n}`)
  }
  const noPillar = totalChunks // informational only
  void noPillar

  line()
  line('── kbDocs (title + pillar + category + status) ──')
  try {
    const docs = await adminDb.collection('kbDocs').limit(60).get()
    if (docs.empty) {
      line('  (none)')
    } else {
      for (const d of docs.docs) {
        const x = d.data() as Record<string, unknown>
        line(
          `  [${String(x.pillar ?? '—')}/${String(x.category ?? '—')}/${String(
            x.status ?? '—',
          )}/${String(x.lang ?? '—')}] ${String(x.title ?? '(untitled)').slice(0, 70)}`,
        )
      }
      line(`  (showing ${docs.size})`)
    }
  } catch (err) {
    line(`  ! ${(err as Error).message.slice(0, 160)}`)
  }

  // ── 2. Reply SOP categories actually present ────────────────────────────────
  line()
  line('── reply-pillar chunks by category (what retrieveReplySop can match) ──')
  for (const cat of ['cold-prospect', 'objection-handling', 'financing', 'voice'] as const) {
    const n = await safeCount(
      cat,
      adminDb
        .collection('kbChunks')
        .where('pillar', '==', 'reply')
        .where('category', '==', cat) as never,
    )
    line(`  ${cat}: ${n}`)
  }

  // ── 3. Leads (NO PII printed) ───────────────────────────────────────────────
  line()
  line('── leads (counts + non-PII fields only) ──')
  const leadCount = await safeCount('leads', adminDb.collection('leads'))
  const ctxCount = await safeCount('leadContext', adminDb.collection('leadContext'))
  line(`  leads: ${leadCount}   leadContext: ${ctxCount}${
    leadCount >= 0 && ctxCount >= 0 && leadCount !== ctxCount
      ? '   <-- MISMATCH: writeLeadSlot uses .update() and throws NOT_FOUND without a context doc'
      : ''
  }`)
  try {
    const leads = await adminDb.collection('leads').limit(25).get()
    for (const d of leads.docs) {
      const x = d.data() as Record<string, unknown>
      // name / phoneHash intentionally omitted.
      line(
        `  ${d.id}  owner=${String(x.ownerUid ?? '—').slice(0, 10)}…  segment=${String(
          x.segment ?? '—',
        )}  nationality=${String(x.nationality ?? '—')}  consent=${String(x.consentFlag ?? '—')}`,
      )
    }
    if (leads.empty) line('  (none — the chat lead picker will be empty)')
  } catch (err) {
    line(`  ! ${(err as Error).message.slice(0, 160)}`)
  }

  // ── 4. Active projects (real names make the test questions concrete) ────────
  line()
  line('── active projects (for realistic question text) ──')
  const projCount = await safeCount('projects', adminDb.collection('projects'))
  const activeCount = await safeCount(
    'active',
    adminDb.collection('projects').where('status', '==', 'active') as never,
  )
  line(`  projects: ${projCount}   status=active: ${activeCount}`)
  try {
    const projs = await adminDb
      .collection('projects')
      .where('status', '==', 'active')
      .limit(15)
      .get()
    for (const d of projs.docs) {
      const x = d.data() as Record<string, unknown>
      line(
        `  ${String(x.name ?? d.id).slice(0, 44).padEnd(44)} ${String(x.area ?? x.location ?? '—')}`,
      )
    }
  } catch (err) {
    line(`  ! ${(err as Error).message.slice(0, 160)}`)
  }

  line()
  line('═══ done (no writes performed) ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('probe failed:', (e as Error).message)
    process.exit(1)
  })
