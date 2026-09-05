/**
 * scripts/data-completeness-report.ts — per-project field coverage across the whole
 * `projects` collection (quick-kayinleong-088).
 *
 * WHY: the user asked for this in as many words — "then show a report of how many
 * properties miss which data." The audit that opened this claim spent most of its effort
 * establishing that the Finder's em-dashes are a CONTENT gap wearing an engineering
 * costume: 30 of 32 unpriced active projects have no price anywhere in their source
 * material, so no parser, prompt or model can recover them. This report is the instrument
 * that makes that gap visible and hands it to whoever can actually close it — Derek.
 *
 * READ-ONLY. Touches nothing, writes no Firestore field. Its only output is stdout and a
 * markdown copy at .planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md so the
 * numbers can be reviewed and committed.
 *
 * Counts and project names only. No PII: `projects` holds marketing write-ups, and the
 * report deliberately prints presence/absence, never field VALUES beyond a description
 * length and a collateral count.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/data-completeness-report.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/data-completeness-report.ts --no-write
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { adminDb } from '@/src/firebase/admin'

const args = process.argv.slice(2)
const NO_WRITE = args.includes('--no-write')

const OUT_PATH = '.planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md'

/**
 * The fields a D2 agent needs to answer a client, in the order they get asked about.
 *
 * `pricePsf` and `unitTypes` are here because they are the honest fallbacks introduced by
 * this claim: a project with no total but a stated psf rate, or with a full layout table,
 * is NOT a blank row even though `priceValue` is 0.
 */
const FIELDS = [
  'priceValue',
  'pricePsf',
  'bedrooms',
  'size',
  'tenure',
  'locationText',
  'vpDate',
  'unitTypes',
  'description',
  'collateral',
] as const
type Field = (typeof FIELDS)[number]

interface Row {
  id: string
  name: string
  status: string
  present: Record<Field, boolean>
  descriptionChars: number
  collateralCount: number
  missingCount: number
  /** Whether ANY layout row in `unitTypes` carries a price. */
  layoutPriced: boolean
}

/**
 * The decision-relevant rollup: what a client asking "how much?" can actually be told.
 *
 * A row with `priceValue: 0` is NOT automatically a blank — this claim added two honest
 * fallbacks, a stated psf rate and a per-layout price table. Reporting the four buckets
 * separately is the difference between "57 projects have no price" (true of `priceValue`,
 * and misleading) and the real answer.
 */
const PRICE_BUCKETS = ['total', 'psf rate only', 'per-layout prices only', 'nothing'] as const
type PriceBucket = (typeof PRICE_BUCKETS)[number]

function priceBucket(r: Row): PriceBucket {
  if (r.present.priceValue) return 'total'
  if (r.present.pricePsf) return 'psf rate only'
  if (r.layoutPriced) return 'per-layout prices only'
  return 'nothing'
}

/** A number that carries information. 0 is the documented "unknown" sentinel here. */
function hasPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function hasNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

async function main() {
  console.log('═══ projects data completeness ═══')
  console.log()

  const snap = await adminDb.collection('projects').get()

  // One aggregation query per project would be 87 round trips; one collection read of
  // `collateral` grouped by projectId is a single pass.
  const collateralByProject = new Map<string, number>()
  const collateralSnap = await adminDb.collection('collateral').select('projectId').get()
  for (const doc of collateralSnap.docs) {
    const pid = (doc.data() as { projectId?: unknown }).projectId
    if (typeof pid !== 'string') continue
    collateralByProject.set(pid, (collateralByProject.get(pid) ?? 0) + 1)
  }

  const rows: Row[] = snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>
    const descriptionChars = typeof d.description === 'string' ? d.description.length : 0
    const collateralCount = collateralByProject.get(doc.id) ?? 0

    const present: Record<Field, boolean> = {
      priceValue: hasPositiveNumber(d.priceValue),
      pricePsf: hasPositiveNumber(d.pricePsfMin),
      // `bedrooms: 0` is the documented UNKNOWN sentinel on ProjectDoc — unlike
      // UnitTypeEntry.bedrooms, where 0 legitimately means studio.
      bedrooms: hasPositiveNumber(d.bedrooms),
      size: hasPositiveNumber(d.sizeMinSqft) || hasPositiveNumber(d.sizeMaxSqft),
      tenure: hasNonEmptyString(d.tenure),
      locationText: hasNonEmptyString(d.locationText),
      vpDate: d.vpDate !== null && d.vpDate !== undefined,
      unitTypes: Array.isArray(d.unitTypes) && d.unitTypes.length > 0,
      description: descriptionChars > 0,
      collateral: collateralCount > 0,
    }

    const layouts = Array.isArray(d.unitTypes) ? (d.unitTypes as Array<{ priceMinRM?: unknown }>) : []

    return {
      id: doc.id,
      name: hasNonEmptyString(d.name) ? String(d.name) : doc.id,
      status: hasNonEmptyString(d.status) ? String(d.status) : '?',
      present,
      descriptionChars,
      collateralCount,
      missingCount: FIELDS.filter((f) => !present[f]).length,
      layoutPriced: layouts.some((e) => hasPositiveNumber(e.priceMinRM)),
    }
  })

  const total = rows.length
  const active = rows.filter((r) => r.status === 'active')

  const missingCounts = (set: Row[]) =>
    FIELDS.map((f) => ({ field: f, missing: set.filter((r) => !r.present[f]).length }))

  const pct = (n: number, d: number) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1))

  // ── summary first, per the brief ──
  console.log(`  ${total} projects total, ${active.length} active`)
  console.log()
  console.log(`  ${'field'.padEnd(14)} ${'missing (all)'.padStart(14)} ${'%'.padStart(7)} ${'missing (active)'.padStart(17)} ${'%'.padStart(7)}`)
  console.log(`  ${'─'.repeat(64)}`)
  const allMissing = missingCounts(rows)
  const activeMissing = new Map(missingCounts(active).map((m) => [m.field, m.missing]))
  for (const { field, missing } of [...allMissing].sort((a, b) => b.missing - a.missing)) {
    const am = activeMissing.get(field) ?? 0
    console.log(
      `  ${field.padEnd(14)} ${String(missing).padStart(14)} ${pct(missing, total).padStart(6)}% ` +
        `${String(am).padStart(17)} ${pct(am, active.length).padStart(6)}%`,
    )
  }

  // ── the price question, answered honestly ──
  const bucketOf = (set: Row[]) =>
    PRICE_BUCKETS.map((b) => ({ bucket: b, n: set.filter((r) => priceBucket(r) === b).length }))

  console.log()
  console.log('  ── what a client asking "how much?" can be told ──')
  console.log(`  ${'price signal'.padEnd(24)} ${'all'.padStart(5)} ${'%'.padStart(7)} ${'active'.padStart(7)} ${'%'.padStart(7)}`)
  console.log(`  ${'─'.repeat(54)}`)
  const activeBuckets = new Map(bucketOf(active).map((b) => [b.bucket, b.n]))
  for (const { bucket, n } of bucketOf(rows)) {
    const an = activeBuckets.get(bucket) ?? 0
    console.log(
      `  ${bucket.padEnd(24)} ${String(n).padStart(5)} ${pct(n, total).padStart(6)}% ` +
        `${String(an).padStart(7)} ${pct(an, active.length).padStart(6)}%`,
    )
  }

  // ── per-project detail, worst first ──
  const sorted = [...rows].sort(
    (a, b) => b.missingCount - a.missingCount || a.name.localeCompare(b.name),
  )

  console.log()
  console.log('  ── per project, most missing first ──')
  console.log(
    `  ${'miss'.padStart(4)} ${'project'.padEnd(44)} ${'status'.padEnd(8)} ` +
      FIELDS.map((f) => f.slice(0, 4).padStart(5)).join('') +
      `  ${'desc'.padStart(6)} ${'coll'.padStart(5)}`,
  )
  console.log(`  ${'─'.repeat(140)}`)
  for (const r of sorted) {
    console.log(
      `  ${String(r.missingCount).padStart(4)} ${r.name.slice(0, 44).padEnd(44)} ${r.status.padEnd(8)} ` +
        FIELDS.map((f) => (r.present[f] ? '   ✓ ' : '   · ')).join('') +
        `  ${String(r.descriptionChars).padStart(6)} ${String(r.collateralCount).padStart(5)}`,
    )
  }

  // ── markdown copy ──
  if (!NO_WRITE) {
    const md: string[] = []
    md.push('# Data completeness — `projects` collection')
    md.push('')
    md.push(`Generated by \`scripts/data-completeness-report.ts\` (quick-kayinleong-088).`)
    md.push(`Measured against **live Firestore**. Read-only — this report changes nothing.`)
    md.push('')
    md.push(`**${total} projects total, ${active.length} active.**`)
    md.push('')
    md.push('## What "missing" means')
    md.push('')
    md.push('| Field | Counted present when |')
    md.push('|---|---|')
    md.push('| `priceValue` | `> 0`. `0` is the documented unknown sentinel, not a price. |')
    md.push('| `pricePsf` | `pricePsfMin > 0` — a stated asking RM/sqft rate (quick-088). |')
    md.push('| `bedrooms` | `> 0`. `0` is the unknown sentinel on `ProjectDoc`. |')
    md.push('| `size` | `sizeMinSqft` or `sizeMaxSqft` is `> 0`. |')
    md.push('| `tenure` | non-empty string. |')
    md.push('| `locationText` | non-empty string. |')
    md.push('| `vpDate` | not `null` (absent means VP not yet completed OR simply unrecorded). |')
    md.push('| `unitTypes` | a non-empty per-layout table (quick-088). |')
    md.push('| `description` | non-empty. |')
    md.push('| `collateral` | at least one `collateral` doc points at the project. |')
    md.push('')
    md.push('## Summary — how many projects miss which field')
    md.push('')
    md.push('| Field | Missing (all 87) | % | Missing (active) | % |')
    md.push('|---|---:|---:|---:|---:|')
    for (const { field, missing } of [...allMissing].sort((a, b) => b.missing - a.missing)) {
      const am = activeMissing.get(field) ?? 0
      md.push(
        `| \`${field}\` | ${missing} | ${pct(missing, total)}% | ${am} | ${pct(am, active.length)}% |`,
      )
    }
    md.push('')
    md.push('## What a client asking "how much?" can be told')
    md.push('')
    md.push(
      'A `priceValue` of 0 is not automatically a blank row — quick-088 added two honest',
    )
    md.push(
      'fallbacks (a stated psf rate, and per-layout prices). These four buckets are the real answer.',
    )
    md.push('')
    md.push('| Price signal | All 87 | % | Active | % |')
    md.push('|---|---:|---:|---:|---:|')
    for (const { bucket, n } of bucketOf(rows)) {
      const an = activeBuckets.get(bucket) ?? 0
      md.push(`| ${bucket} | ${n} | ${pct(n, total)}% | ${an} | ${pct(an, active.length)}% |`)
    }
    md.push('')
    md.push('## Per project — most missing first')
    md.push('')
    md.push(`| Missing | Project | Status | ${FIELDS.map((f) => `\`${f}\``).join(' | ')} | desc chars | collateral |`)
    md.push(`|---:|---|---|${FIELDS.map(() => ':-:').join('|')}|---:|---:|`)
    for (const r of sorted) {
      md.push(
        `| ${r.missingCount} | ${r.name.replace(/\|/g, '/')} | ${r.status} | ` +
          FIELDS.map((f) => (r.present[f] ? '✓' : '—')).join(' | ') +
          ` | ${r.descriptionChars} | ${r.collateralCount} |`,
      )
    }
    md.push('')

    mkdirSync(dirname(OUT_PATH), { recursive: true })
    writeFileSync(OUT_PATH, md.join('\n'))
    console.log()
    console.log(`  markdown written to ${OUT_PATH}`)
  }

  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('completeness report failed:', (e as Error).message)
    process.exit(1)
  })
