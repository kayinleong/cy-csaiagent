/**
 * scripts/backfill-kbchunk-category.ts — denormalize kbDocs.category onto its kbChunks
 * (quick-kayinleong-078).
 *
 * WHY: `retrieveReplySop` narrows its results by category IN MEMORY —
 * `results.filter((r) => r.category === category)` — but the ingestion pipeline never wrote
 * `category` onto a chunk. So every categorised Reply lookup filtered out ALL of its hits
 * and the agent answered `no_sop_match`, even with the SOPs present and retrieval scoring
 * 0.69. The pipeline now writes it; this repairs everything ingested before that.
 *
 * Only touches docs that HAVE a category, and only chunks that lack one.
 *
 * SCOPE IT WITH --pillar. A dry run across everything reported 25,184 chunks, because the
 * WhatsApp/inventory importer put the PROJECT NAME in `category` on all 1068 Finder docs
 * ("Tangen Residences", "Kensho @ Taman Desa"). Those are not SOP categories and nothing
 * reads them — Finder scores in memory over `projects` and never touches kbChunks. Only
 * `reply` has a consumer, so backfilling everything would be 25k writes for no behaviour.
 *
 * DRY RUN by default.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-kbchunk-category.ts --pillar reply
 *   npx tsx --env-file=.env.local scripts/backfill-kbchunk-category.ts --pillar reply --apply
 */

import { adminDb } from '@/src/firebase/admin'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const pillarIdx = args.indexOf('--pillar')
const PILLAR = pillarIdx !== -1 ? args[pillarIdx + 1] : null

async function main() {
  console.log('═══ kbChunks category backfill ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}   pillar: ${PILLAR ?? 'ALL (see the note in this file)'}`)
  console.log()

  const base = adminDb.collection('kbDocs')
  const docs = await (PILLAR ? base.where('pillar', '==', PILLAR) : base).limit(2000).get()
  const withCategory = docs.docs.filter((d) => {
    const c = (d.data() as Record<string, unknown>).category
    return typeof c === 'string' && c.length > 0
  })
  console.log(`  kbDocs with a category: ${withCategory.length} of ${docs.size}`)

  let updated = 0
  let alreadySet = 0

  for (const doc of withCategory) {
    const category = String((doc.data() as Record<string, unknown>).category)
    const chunks = await adminDb.collection('kbChunks').where('docId', '==', doc.id).get()
    const missing = chunks.docs.filter(
      (c) => !(c.data() as Record<string, unknown>).category,
    )
    alreadySet += chunks.size - missing.length
    if (missing.length === 0) continue

    console.log(`  ${category.padEnd(20)} ${missing.length}/${chunks.size} chunk(s) — ${String((doc.data() as Record<string, unknown>).title).slice(0, 44)}`)
    if (APPLY) {
      const writer = adminDb.bulkWriter()
      for (const c of missing) writer.update(c.ref, { category })
      await writer.close()
    }
    updated += missing.length
  }

  console.log()
  console.log(`  chunks ${APPLY ? 'updated' : 'to update'}: ${updated}   already set: ${alreadySet}`)
  if (!APPLY && updated > 0) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('backfill failed:', (e as Error).message)
    process.exit(1)
  })
