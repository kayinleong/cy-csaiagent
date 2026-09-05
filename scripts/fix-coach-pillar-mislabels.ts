/**
 * scripts/fix-coach-pillar-mislabels.ts — remove property content mislabelled as
 * `pillar:'coach'`, and the orphaned chunks beside it (quick-kayinleong-089).
 *
 * WHY
 * ---
 * quick-kayinleong-088 added `{ pillar: 'coach' }` to the Coach's retrieval so it stopped
 * searching 25,153 property chunks. That fixed the query and not the data: an audit of the
 * 47 `pillar:'coach'` chunks found 26 of them (55%) are property material wearing a coach
 * label, which a pillar filter cannot see. The Coach was still able to answer an onboarding
 * question from a tower FAQ — just via its "own" corpus.
 *
 * WHAT IS REMOVED, and why deletion rather than re-pillaring
 * ---------------------------------------------------------
 * Re-pillaring these to `finder` would DUPLICATE documents finder already has. Verified
 * against live Firestore before writing this:
 *
 *  1. `0uFVYzDdnkSsPMYlxPiQ--coach` — "Bangsar Hill Park — FAQ - Tower B, C.pdf (OCR)",
 *     21 chunks, 45% of the whole coach corpus. It is a cross-pillar COPY:
 *     `copiedFromId` → `0uFVYzDdnkSsPMYlxPiQ`, which exists with `pillar:'finder'` and the
 *     same 21 chunks. The `--coach` id suffix is `copyDocsToPillar`'s deterministic scheme.
 *     Nothing is lost — the original is untouched.
 *
 *  2. `g3YG8KgrydA8B9sKRuMM` — "Core Residence @ TRX — Emailing 629-TRX-…", 5 chunks,
 *     ingested directly as coach (no `copiedFromId`). An architect's email about a tower
 *     drawing. Finder already holds the same document as `0ciFnNIwbNYsgkSSqfE6` (4 chunks);
 *     3 of the 5 coach chunks appear verbatim there, and the 2 that do not are Malay
 *     building-plan boilerplate ("MEKANIKAL DI ARAS 49…"), not onboarding content.
 *
 *  3. `aWXEQ4oqOdRXonDcI9SX` — 5 chunks whose parent kbDoc no longer exists. Same Malay
 *     building-plan text. They remain retrievable because `status` is denormalised onto the
 *     chunk, so any citation naming the parent doc breaks. There is no source to re-ingest
 *     from, so deletion is the only resolution.
 *
 * CONSEQUENCE, stated plainly: the coach corpus drops 47 → 16 chunks, all of them
 * `[Example]` placeholders. The Coach will return `kb_miss` + handoff for most onboarding
 * questions. That is the DESIGNED behaviour (D-10) and it is the honest answer — better than
 * citing a Bangsar Hill Park FAQ at a new agent asking how to get their REN tag. The real
 * fix is loading onboarding content, which is Derek's to supply.
 *
 * SAFETY
 * ------
 * DRY RUN by default. `--apply` writes. Every document and chunk it deletes is first written
 * to a JSON backup (`--backup <file>`, default alongside the script run) so the change is
 * reversible. Refuses to touch anything whose `pillar` is not `coach`.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-coach-pillar-mislabels.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-coach-pillar-mislabels.ts --apply --backup /path/out.json
 *
 * PDPA: the backup contains chunk text (property/legal documents, not personal data), but
 * keep it outside the repo regardless. Console output prints ids, titles and counts only.
 */

import { adminDb } from '@/src/firebase/admin'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const bIdx = args.indexOf('--backup')
const BACKUP = bIdx !== -1 ? args[bIdx + 1] : `coach-pillar-cleanup-backup-${Date.now()}.json`

/** Docs to remove, each with the finder document that already carries the content. */
const DELETE_DOCS: Array<{ id: string; why: string; preservedIn: string | null }> = [
  {
    id: '0uFVYzDdnkSsPMYlxPiQ--coach',
    why: 'cross-pillar copy of a finder doc (copiedFromId), 21 chunks',
    preservedIn: '0uFVYzDdnkSsPMYlxPiQ',
  },
  {
    id: 'g3YG8KgrydA8B9sKRuMM',
    why: 'property/legal email ingested directly as coach, 5 chunks',
    preservedIn: '0ciFnNIwbNYsgkSSqfE6',
  },
]

/** Chunk groups whose parent kbDoc is gone — nothing to cite, nothing to re-ingest from. */
const DELETE_ORPHAN_DOCIDS = ['aWXEQ4oqOdRXonDcI9SX']

async function chunksFor(docId: string) {
  return (await adminDb.collection('kbChunks').where('docId', '==', docId).get()).docs
}

async function main() {
  console.log('═══ coach-pillar mislabel cleanup ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`)

  const before = (await adminDb.collection('kbChunks').where('pillar', '==', 'coach').count().get()).data().count
  console.log(`coach chunks before: ${before}\n`)

  const backup: {
    generatedAt: string
    docs: Array<Record<string, unknown>>
    chunks: Array<Record<string, unknown>>
  } = { generatedAt: new Date().toISOString(), docs: [], chunks: [] }

  let docsToDelete = 0
  let chunksToDelete = 0

  for (const target of DELETE_DOCS) {
    const doc = await adminDb.collection('kbDocs').doc(target.id).get()
    if (!doc.exists) {
      console.log(`  · ${target.id} — kbDoc already absent, skipping`)
      continue
    }
    const data = doc.data() as Record<string, unknown>
    if (data.pillar !== 'coach') {
      console.log(`  ✗ ${target.id} — pillar is '${String(data.pillar)}', NOT coach. REFUSING.`)
      continue
    }
    // The preserved twin must actually exist, or this is data loss rather than dedupe.
    if (target.preservedIn) {
      const twin = await adminDb.collection('kbDocs').doc(target.preservedIn).get()
      const twinChunks = twin.exists ? (await chunksFor(target.preservedIn)).length : 0
      if (!twin.exists || twinChunks === 0) {
        console.log(`  ✗ ${target.id} — preserved twin ${target.preservedIn} missing/empty. REFUSING.`)
        continue
      }
      console.log(`  ✓ twin ${target.preservedIn} present (pillar=${String((twin.data() as {pillar?:string}).pillar)}, ${twinChunks} chunks)`)
    }

    const chunks = await chunksFor(target.id)
    console.log(`  → delete ${target.id}  "${String(data.title).slice(0, 52)}"`)
    console.log(`      ${target.why} · ${chunks.length} chunks`)
    backup.docs.push({ id: doc.id, ...data })
    for (const c of chunks) backup.chunks.push({ id: c.id, ...(c.data() as Record<string, unknown>) })
    docsToDelete++
    chunksToDelete += chunks.length

    if (APPLY) {
      for (const c of chunks) await c.ref.delete()
      await doc.ref.delete()
    }
  }

  for (const docId of DELETE_ORPHAN_DOCIDS) {
    const parent = await adminDb.collection('kbDocs').doc(docId).get()
    if (parent.exists) {
      console.log(`  ✗ ${docId} — parent kbDoc EXISTS, so these are not orphans. REFUSING.`)
      continue
    }
    const chunks = await chunksFor(docId)
    const nonCoach = chunks.filter((c) => (c.data() as { pillar?: string }).pillar !== 'coach').length
    if (nonCoach > 0) {
      console.log(`  ✗ ${docId} — ${nonCoach} chunk(s) are not pillar:coach. REFUSING.`)
      continue
    }
    console.log(`  → delete ${chunks.length} orphaned chunks (parent kbDoc ${docId} absent)`)
    for (const c of chunks) backup.chunks.push({ id: c.id, ...(c.data() as Record<string, unknown>) })
    chunksToDelete += chunks.length
    if (APPLY) for (const c of chunks) await c.ref.delete()
  }

  // The backup is written in BOTH modes: a dry run should let you inspect exactly what an
  // apply would remove, before removing it.
  writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
  console.log(`\n  backup written → ${BACKUP}`)
  console.log(`  (${backup.docs.length} kbDocs, ${backup.chunks.length} chunks captured)`)

  const after = (await adminDb.collection('kbChunks').where('pillar', '==', 'coach').count().get()).data().count
  console.log('\n── summary ──')
  console.log(`  kbDocs  ${APPLY ? 'deleted' : 'would delete'}: ${docsToDelete}`)
  console.log(`  chunks  ${APPLY ? 'deleted' : 'would delete'}: ${chunksToDelete}`)
  console.log(`  coach chunks: ${before} → ${APPLY ? after : before - chunksToDelete} (${APPLY ? 'measured' : 'projected'})`)
  if (!APPLY) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log('\n═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
