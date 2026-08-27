/**
 * scripts/backfill-kbchunk-vectors.ts — convert kbChunks.embedding from a plain
 * number[] to the Firestore VECTOR type (quick-kayinleong-066).
 *
 * WHY: a Firestore vector index only covers fields stored as the VECTOR type. Every chunk
 * written before quick-066 used a bare `number[]`, so the index contained none of them and
 * `findNearest` returned zero rows for every Coach and Reply query — silently, with no
 * error anywhere. Measured before this script: 14 coach chunks matched the pre-filters and
 * findNearest returned 0; one probe chunk written with FieldValue.vector() returned a hit
 * at score 0.8517 for the same question.
 *
 * Re-runnable. A chunk already stored as a VECTOR reads back with `toArray()` and is
 * skipped, so a partial run just resumes.
 *
 * DRY RUN by default — prints what it WOULD do and writes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-kbchunk-vectors.ts
 *   npx tsx --env-file=.env.local scripts/backfill-kbchunk-vectors.ts --pillar coach --apply
 *   npx tsx --env-file=.env.local scripts/backfill-kbchunk-vectors.ts --apply
 *
 * Flags:
 *   --apply           actually write (default: dry run)
 *   --pillar <p>      restrict to one pillar (coach | finder | reply)
 *   --limit <n>       stop after n chunks (default: all)
 *
 * PDPA: prints counts and chunk ids only — never chunk text.
 */

import { adminDb } from '@/src/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const pillarIdx = args.indexOf('--pillar')
const PILLAR = pillarIdx !== -1 ? args[pillarIdx + 1] : null
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity

/** Read a page at a time — 25k chunks x 1024 floats will not fit in one get(). */
const PAGE = 300

function needsConversion(embedding: unknown): embedding is number[] {
  return Array.isArray(embedding)
}

async function main() {
  console.log('═══ kbChunks embedding → VECTOR backfill ═══')
  console.log(`  mode:   ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  pillar: ${PILLAR ?? 'all'}`)
  console.log(`  limit:  ${LIMIT === Infinity ? 'all' : LIMIT}`)
  console.log()

  const col = adminDb.collection('kbChunks')
  const base: FirebaseFirestore.Query = (
    PILLAR ? col.where('pillar', '==', PILLAR) : col
  )
    .orderBy('__name__')
    .limit(PAGE)

  let cursor: string | null = null
  let scanned = 0
  let converted = 0
  let alreadyVector = 0
  let noEmbedding = 0
  let failed = 0

  for (;;) {
    const q: FirebaseFirestore.Query = cursor ? base.startAfter(cursor) : base
    const snap: FirebaseFirestore.QuerySnapshot = await q.get()
    if (snap.empty) break

    const writer = adminDb.bulkWriter()
    let pageWrites = 0

    for (const doc of snap.docs) {
      if (scanned >= LIMIT) break
      scanned++
      cursor = doc.id

      const embedding = (doc.data() as Record<string, unknown>).embedding
      if (embedding == null) {
        noEmbedding++
        continue
      }
      if (!needsConversion(embedding)) {
        alreadyVector++
        continue
      }
      converted++
      if (APPLY) {
        writer.update(doc.ref, { embedding: FieldValue.vector(embedding) })
        pageWrites++
      }
    }

    if (APPLY && pageWrites > 0) {
      try {
        await writer.close()
      } catch (err) {
        failed += pageWrites
        console.log(`  ! page write failed: ${(err as Error).message.slice(0, 140)}`)
      }
    } else {
      await writer.close()
    }

    process.stdout.write(
      `\r  scanned ${scanned}  converted ${converted}  already-vector ${alreadyVector}  `,
    )
    if (snap.size < PAGE || scanned >= LIMIT) break
  }

  console.log()
  console.log()
  console.log('── summary ──')
  console.log(`  scanned:        ${scanned}`)
  console.log(`  converted:      ${converted}${APPLY ? '' : ' (would convert)'}`)
  console.log(`  already vector: ${alreadyVector}`)
  console.log(`  no embedding:   ${noEmbedding}`)
  if (failed > 0) console.log(`  FAILED writes:  ${failed}`)
  if (!APPLY && converted > 0) {
    console.log()
    console.log('  Dry run. Re-run with --apply to write.')
  }
  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('backfill failed:', (e as Error).message)
    process.exit(1)
  })
