/**
 * scripts/backfill-unit-types.ts — populate ProjectDoc.unitTypes from each project's own
 * description (quick-kayinleong-088).
 *
 * WHY: `priceValue` + `sizeMinSqft`/`sizeMaxSqft` collapse a project to one price and one
 * size span, which cannot answer "what does the 2-bedroom cost?" — and the pressure to
 * answer it anyway is what produced the fabricated prices this claim exists to undo. The
 * per-layout table is already written in `description`, one layout per line, so it is
 * parsed rather than inferred: `extractUnitTypes` in `src/inventory/unit-types.ts` is the
 * MECHANISM and `ProjectDoc.unitTypes` is where its output is PERSISTED. Nothing re-parses
 * prose at render time and nothing here is model-authored.
 *
 * WHAT IT WRITES: exactly one field, `unitTypes`, via `bulkWriter`. Nothing else. In
 * particular it does NOT go through `updateProject`, which would trip `assertAdmin` (no
 * signed-in admin in a script) and its re-embed delta check.
 *
 * ⚠ DOES NOT RE-EMBED, mirroring the D1 decision on `sizeMinSqft`: the layout text already
 * lives inside the embedded `description`, so the semantic content is present and adding
 * structured mirrors would only force a needless re-embed. `unitTypes` is deliberately NOT
 * in `EMBEDDING_RELEVANT_FIELDS` (`src/inventory/crud.ts`).
 *
 * IDEMPOTENT: a doc whose stored table already equals the computed one is skipped, so a
 * second run reports zero writes and a run after a parser fix repairs only what actually
 * changed. RESUMABLE + PAGINATED: walks `projects` in `__name__` order in pages, so an
 * interrupted run can be restarted with `--after=<docId>` and continues where it stopped.
 *
 * DRY RUN by default. Needs `--env-file=.env.local` for admin credentials.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/backfill-unit-types.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/backfill-unit-types.ts --apply
 *   node_modules/.bin/tsx --env-file=.env.local scripts/backfill-unit-types.ts --apply --after=WsCKdwpNCvFwHy5cHTH6
 */

import { adminDb } from '@/src/firebase/admin'
import { extractUnitTypes } from '@/src/inventory/unit-types'
import type { UnitTypeEntry } from '@/src/firebase/collections'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const AFTER = args.find((a) => a.startsWith('--after='))?.slice('--after='.length)

/** Firestore page size. Small enough to keep a resume point close to the failure. */
const PAGE_SIZE = 25

/** Structural equality, so an unchanged table is not rewritten. */
function sameTable(a: UnitTypeEntry[], b: UnitTypeEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    return (
      x.label === y.label &&
      x.sizeSqft === y.sizeSqft &&
      x.bedrooms === y.bedrooms &&
      x.priceMinRM === y.priceMinRM &&
      x.priceMaxRM === y.priceMaxRM &&
      x.raw === y.raw
    )
  })
}

/** Stored value defensively narrowed — legacy docs have no field at all. */
function storedTable(value: unknown): UnitTypeEntry[] {
  return Array.isArray(value) ? (value as UnitTypeEntry[]) : []
}

function fmtEntry(e: UnitTypeEntry): string {
  const size = e.sizeSqft === null ? '—' : `${e.sizeSqft} sqft`
  const beds = e.bedrooms === null ? '—' : e.bedrooms === 0 ? 'studio' : `${e.bedrooms} bd`
  const price =
    e.priceMinRM === null
      ? '—'
      : e.priceMinRM === e.priceMaxRM
        ? `RM${e.priceMinRM.toLocaleString('en-MY')}`
        : `RM${e.priceMinRM.toLocaleString('en-MY')}–${e.priceMaxRM!.toLocaleString('en-MY')}`
  return `${e.label.slice(0, 22).padEnd(22)} ${size.padStart(10)}  ${beds.padStart(7)}  ${price}`
}

async function main() {
  console.log('═══ projects unitTypes backfill ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  if (AFTER !== undefined) console.log(`  resuming after docId: ${AFTER}`)
  console.log()

  let cursor = AFTER
  let scanned = 0
  let withLayouts = 0
  let totalEntries = 0
  let toUpdate = 0
  let unchanged = 0
  let empty = 0
  let entriesWithPrice = 0
  let entriesWithBedrooms = 0
  let lastId = AFTER ?? '(none)'

  const writer = APPLY ? adminDb.bulkWriter() : null

  try {
    for (;;) {
      let query = adminDb.collection('projects').orderBy('__name__').limit(PAGE_SIZE)
      if (cursor !== undefined) query = query.startAfter(cursor)
      const page = await query.get()
      if (page.empty) break

      for (const doc of page.docs) {
        scanned++
        lastId = doc.id
        const data = doc.data() as Record<string, unknown>
        const name = typeof data.name === 'string' ? data.name : doc.id
        const description = typeof data.description === 'string' ? data.description : ''

        const next = extractUnitTypes(description)
        const stored = storedTable(data.unitTypes)

        if (next.length === 0) {
          empty++
        } else {
          withLayouts++
          totalEntries += next.length
          entriesWithPrice += next.filter((e) => e.priceMinRM !== null).length
          entriesWithBedrooms += next.filter((e) => e.bedrooms !== null).length
        }

        const same = sameTable(stored, next)
        console.log(
          `  ${String(next.length).padStart(3)} layouts ${same ? '·' : '→'} ${name.slice(0, 46)}`,
        )
        for (const e of next) console.log(`        ${fmtEntry(e)}`)

        if (same) {
          unchanged++
          continue
        }
        toUpdate++
        // Only this one field. Never `embedding`, never `priceValue`, never anything else.
        writer?.update(doc.ref, { unitTypes: next })
      }

      cursor = page.docs[page.docs.length - 1]!.id
      if (page.size < PAGE_SIZE) break
    }
  } catch (e) {
    if (writer) await writer.close()
    console.error(`\n  FAILED after ${scanned} docs. Resume with --after=${lastId}`)
    throw e
  }

  if (writer) await writer.close()

  console.log()
  console.log(`  scanned: ${scanned}`)
  console.log(`  projects with >= 1 layout : ${withLayouts}`)
  console.log(`  projects with no table    : ${empty}`)
  console.log(`  total layout entries      : ${totalEntries}`)
  console.log(`    ... of which state a price    : ${entriesWithPrice}`)
  console.log(`    ... of which state bedrooms   : ${entriesWithBedrooms}`)
  console.log(`  ${APPLY ? 'updated' : 'to update'}: ${toUpdate}   unchanged: ${unchanged}`)
  console.log()
  console.log(
    '  NOT re-embedded, by design: the layout text is already inside the embedded\n' +
      '  `description`, so unitTypes is excluded from EMBEDDING_RELEVANT_FIELDS (D1\n' +
      '  precedent on sizeMinSqft). No vector is stale because of this run.',
  )
  console.log(
    '  ⚠ New inventory imports do NOT populate unitTypes — `createProject` and\n' +
      '  scripts/scrape-skool/to-inventory.ts are untouched. Re-run this after an import.',
  )
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
