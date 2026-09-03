/**
 * scripts/backfill-project-sizes.ts — populate ProjectDoc.sizeMinSqft / sizeMaxSqft from
 * each project's own description (quick-kayinleong-085 / D1).
 *
 * WHY: `ProjectDoc` had no size field, so the Finder table had nothing to render in a Size
 * column. The figure exists only as prose inside `description` ("1 Bedroom: 904 sqft |
 * Penthouses: 2,900 – 4,855 sqft"). D1 locked both halves of the fix: real nullable fields
 * on the doc, populated by a deterministic regex — `extractSizeRange` — never by a model,
 * and never re-parsed at render time.
 *
 * WHAT IT WRITES: exactly two fields, `sizeMinSqft` and `sizeMaxSqft`, via `bulkWriter`.
 * Nothing else. In particular it does NOT go through `updateProject`, which would trip
 * `assertAdmin` (there is no signed-in admin here) and its re-embed delta check —
 * `EMBEDDING_RELEVANT_FIELDS` deliberately excludes these fields per D1, because the sqft
 * text is already inside the embedded `description` and a re-embed of 82 projects would
 * buy nothing.
 *
 * IDEMPOTENT: a doc whose stored pair already equals the computed pair is skipped, so a
 * second run reports zero writes, and a run after an extractor fix repairs only what
 * actually changed. Safe to re-run after every inventory import (new projects do not get
 * these fields on create — see the ProjectDoc comment).
 *
 * DRY RUN by default. Needs `--env-file=.env.local` for admin credentials.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-project-sizes.ts
 *   npx tsx --env-file=.env.local scripts/backfill-project-sizes.ts --apply
 */

import { adminDb } from '@/src/firebase/admin'
import { extractSizeRange } from '@/src/inventory/size-extract'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

/** The source substring that produced a range, so a dry run is reviewable by eye. */
function sourceEvidence(description: string): string {
  const mentions =
    description.match(/[^]{0,20}(?:sqft|sq\.?\s*ft\.?|square\s+feet|square\s+foot)/gi) ?? []
  return mentions
    .slice(0, 3)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .join(' /// ')
}

async function main() {
  console.log('═══ projects sizeMinSqft/sizeMaxSqft backfill ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log()

  const snap = await adminDb.collection('projects').limit(500).get()

  let parsed = 0
  let nulls = 0
  let toUpdate = 0
  let unchanged = 0

  const writer = APPLY ? adminDb.bulkWriter() : null

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const name = typeof data.name === 'string' ? data.name : doc.id
    const description = typeof data.description === 'string' ? data.description : ''

    const range = extractSizeRange(description)
    const nextMin = range ? range.minSqft : null
    const nextMax = range ? range.maxSqft : null
    if (range) parsed++
    else nulls++

    const storedMin = typeof data.sizeMinSqft === 'number' ? data.sizeMinSqft : null
    const storedMax = typeof data.sizeMaxSqft === 'number' ? data.sizeMaxSqft : null
    const same = storedMin === nextMin && storedMax === nextMax

    console.log(
      `  ${(range ? `${nextMin}-${nextMax}` : 'null').padEnd(14)} ${same ? '·' : '→'} ${name.slice(0, 46).padEnd(46)}`,
    )
    if (range) console.log(`        ${sourceEvidence(description)}`)

    if (same) {
      unchanged++
      continue
    }
    toUpdate++
    // Only these two fields. Never `embedding`, never `priceBand`, never anything else.
    writer?.update(doc.ref, { sizeMinSqft: nextMin, sizeMaxSqft: nextMax })
  }

  if (writer) await writer.close()

  console.log()
  console.log(`  total: ${snap.size}   parsed: ${parsed}   null: ${nulls}`)
  console.log(`  ${APPLY ? 'updated' : 'to update'}: ${toUpdate}   unchanged: ${unchanged}`)
  if (!APPLY && toUpdate > 0) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('backfill failed:', (e as Error).message)
    process.exit(1)
  })
