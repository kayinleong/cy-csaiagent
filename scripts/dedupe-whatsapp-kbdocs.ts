/**
 * scripts/dedupe-whatsapp-kbdocs.ts — collapse duplicate "WhatsApp — …" kbDocs
 * (quick-kayinleong-089).
 *
 * WHY
 * ---
 * The WhatsApp corpus accumulated 19 duplicated titles, and the cause is now understood:
 * `shardJob` used to store every chunk's text INLINE on the job document, so ingestion hit
 * Firestore's 1 MiB document cap around ~650 chunks and threw AFTER `createDoc` had already
 * written the kbDoc. Each failed browser attempt therefore left a PUBLISHED document holding
 * zero chunks, and the operator retried — leaving a stack of empty docs beside one good one.
 * "WhatsApp — Lunar Seputeh" exists ELEVEN times: three with chunks, eight empty.
 *
 * Two distinct kinds of duplicate, both handled:
 *   - ZERO-CHUNK siblings — pure wreckage from the capped writes. Nothing to lose.
 *   - CHUNKED siblings — the same export ingested more than once (e.g. "Aetas Damansara"
 *     twice at 613 chunks each). These are worse than clutter: retrieval returns the same
 *     text twice, so a query burns its `findNearest` limit on duplicates and the model sees
 *     less variety than the corpus actually holds.
 *
 * RULE: per title, keep the doc with the MOST chunks; on a tie keep the most recently
 * published. Delete the rest, chunks included. `--keep-empty` restricts the run to the
 * zero-chunk cases if you want the safest possible pass first.
 *
 * ⚠ A CHUNKED loser is only deleted if its text is actually CONTAINED in the winner
 * (`MIN_COVERAGE`, default 95%). Same title does NOT mean same content, and assuming it
 * does would have destroyed real data here: "WhatsApp — Conlay by E&O" had two chunked docs,
 * 1118 and 619 chunks, and the 619 turned out to be only **5% covered** by the 1118 — a
 * different chat that collided on title because the import titles by project, not by source
 * archive. Measured, not assumed. Zero-chunk losers skip this check; there is nothing to
 * cover.
 *
 * DRY RUN by default. Every deleted document and chunk is written to a JSON backup first, so
 * this is reversible.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/dedupe-whatsapp-kbdocs.ts
 *   … --apply --backup /path/out.json
 *   … --apply --keep-empty      # delete ONLY zero-chunk duplicates
 *
 * SAFETY: refuses to delete the last remaining doc for a title, and refuses to delete a doc
 * that is not titled "WhatsApp — …". A title with only ONE doc is never touched.
 *
 * PDPA: the backup contains transcript text. Keep it outside the repo and delete it when
 * done. Console output prints titles, ids and counts only.
 */

import { adminDb } from '@/src/firebase/admin'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const KEEP_EMPTY_ONLY = args.includes('--keep-empty')
const bIdx = args.indexOf('--backup')
const BACKUP = bIdx !== -1 ? args[bIdx + 1] : `whatsapp-dedupe-backup-${Date.now()}.json`

const TITLE_PREFIX = 'WhatsApp —'
/**
 * Fraction of a chunked loser's text that must already exist in the winner before the loser
 * may be deleted. Below this it is treated as unique content and KEPT.
 *
 * 0.95 rather than 1.0 because chunk boundaries shift between ingests of the same transcript
 * (the chunker splits on token budget, so a re-ingest can land a boundary a few words over
 * and leave one or two chunks that do not match verbatim). Coverage is measured both ways —
 * exact normalised equality, and a 150-char prefix appearing anywhere in the winner's joined
 * text — and the better of the two wins.
 */
const MIN_COVERAGE = 0.95

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

async function chunkTexts(docId: string): Promise<string[]> {
  const s = await adminDb.collection('kbChunks').where('docId', '==', docId).get()
  return s.docs.map((d) => String((d.data() as { text?: string }).text ?? ''))
}

/** What fraction of `loser`'s chunks are already present in `winner`? */
async function coverage(winnerId: string, loserId: string): Promise<number> {
  const [w, l] = await Promise.all([chunkTexts(winnerId), chunkTexts(loserId)])
  if (l.length === 0) return 1
  const wset = new Set(w.map(norm))
  const wjoined = [...wset].join(' ')
  const exact = l.filter((t) => wset.has(norm(t))).length
  const contained = l.filter((t) => wjoined.includes(norm(t).slice(0, 150))).length
  return Math.max(exact, contained) / l.length
}

interface Doc {
  id: string
  title: string
  chunks: number
  publishedAt: string
}

async function main() {
  console.log('═══ WhatsApp kbDoc dedupe ═══')
  console.log(`  mode:  ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  scope: ${KEEP_EMPTY_ONLY ? 'zero-chunk duplicates only' : 'all duplicates (keep most chunks)'}\n`)

  // Chunk counts, paged — 26k+ chunks will not fit in one get().
  const counts = new Map<string, number>()
  let cur: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let q = adminDb.collection('kbChunks').select('docId').orderBy('__name__').limit(2000)
    if (cur) q = q.startAfter(cur)
    const s = await q.get()
    if (s.empty) break
    for (const d of s.docs) {
      const id = String(d.get('docId'))
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    cur = s.docs[s.docs.length - 1]
    if (s.size < 2000) break
  }

  const snap = await adminDb.collection('kbDocs').get()
  const wa: Doc[] = snap.docs
    .filter((d) => String((d.data() as { title?: string }).title ?? '').startsWith(TITLE_PREFIX))
    .map((d) => {
      const x = d.data() as { title?: string; publishedAt?: { toDate?: () => Date } }
      return {
        id: d.id,
        title: String(x.title),
        chunks: counts.get(d.id) ?? 0,
        publishedAt: x.publishedAt?.toDate?.().toISOString() ?? '',
      }
    })

  const byTitle = new Map<string, Doc[]>()
  for (const d of wa) {
    const k = d.title.toLowerCase()
    byTitle.set(k, [...(byTitle.get(k) ?? []), d])
  }

  const backup: { generatedAt: string; docs: Array<Record<string, unknown>>; chunks: Array<Record<string, unknown>> } = {
    generatedAt: new Date().toISOString(),
    docs: [],
    chunks: [],
  }

  let titlesTouched = 0
  let docsDeleted = 0
  let chunksDeleted = 0
  let emptyDeleted = 0
  let kept = 0

  for (const [, group] of [...byTitle.entries()].sort()) {
    if (group.length < 2) continue // a single doc is never a duplicate

    // Winner: most chunks, then most recent.
    const ranked = [...group].sort((a, b) => b.chunks - a.chunks || b.publishedAt.localeCompare(a.publishedAt))
    const keep = ranked[0]
    let losers = ranked.slice(1)
    if (KEEP_EMPTY_ONLY) losers = losers.filter((d) => d.chunks === 0)
    if (losers.length === 0) continue

    // Never delete every doc for a title.
    if (keep.chunks === 0 && losers.some((l) => l.chunks > 0)) {
      console.log(`  ✗ ${keep.title.slice(0, 50)} — winner has 0 chunks but a loser has more. REFUSING.`)
      continue
    }

    titlesTouched++
    console.log(`  "${keep.title.slice(0, 54)}"`)
    console.log(`      keep   ${keep.id}  ${keep.chunks} chunks`)

    for (const l of losers) {
      if (!l.title.startsWith(TITLE_PREFIX)) {
        console.log(`      ✗ ${l.id} is not a WhatsApp doc. REFUSING.`)
        continue
      }
      // Same title is not same content — verify before destroying anything.
      if (l.chunks > 0) {
        const cov = await coverage(keep.id, l.id)
        if (cov < MIN_COVERAGE) {
          console.log(
            `      KEEP   ${l.id}  ${l.chunks} chunks — only ${Math.round(cov * 100)}% covered by the winner (unique content)`,
          )
          kept++
          continue
        }
        console.log(`      delete ${l.id}  ${l.chunks} chunks  (${Math.round(cov * 100)}% covered)`)
      } else {
        console.log(`      delete ${l.id}  0 chunks (empty wreckage)`)
      }
      const docSnap = await adminDb.collection('kbDocs').doc(l.id).get()
      if (docSnap.exists) backup.docs.push({ id: l.id, ...(docSnap.data() as Record<string, unknown>) })
      const cs = await adminDb.collection('kbChunks').where('docId', '==', l.id).get()
      for (const c of cs.docs) backup.chunks.push({ id: c.id, ...(c.data() as Record<string, unknown>) })

      if (APPLY) {
        for (const c of cs.docs) await c.ref.delete()
        if (docSnap.exists) await docSnap.ref.delete()
      }
      docsDeleted++
      chunksDeleted += cs.size
      if (l.chunks === 0) emptyDeleted++
    }
  }

  writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
  console.log(`\n  backup → ${BACKUP}`)
  console.log(`  (${backup.docs.length} kbDocs, ${backup.chunks.length} chunks captured)`)

  console.log('\n── summary ──')
  console.log(`  duplicated titles handled: ${titlesTouched}`)
  console.log(`  kbDocs ${APPLY ? 'deleted' : 'would delete'}: ${docsDeleted}  (${emptyDeleted} were empty wreckage)`)
  console.log(`  kept despite a duplicate title: ${kept}  (below ${Math.round(MIN_COVERAGE * 100)}% coverage — unique content)`)
  console.log(`  chunks ${APPLY ? 'deleted' : 'would delete'}: ${chunksDeleted}`)
  if (!APPLY) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log('\n═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
