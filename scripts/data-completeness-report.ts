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
  /** Chunks in kbDocs matched to this project by category/title (exact convention). */
  kbChunksExact: number
  /** Chunks matched only by normalised substring — reported separately, never merged. */
  kbChunksFuzzy: number
  kbDocs: number
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

  // ─── KB coverage per project (quick-kayinleong-089) ─────────────────────────
  //
  // A structured field being blank is only half the question. After 43 WhatsApp archives
  // were ingested there are 24,866 chat chunks in the corpus, so a project with no stored
  // `priceValue` may still have 800 chunks of chat in which an agent quoted the price —
  // retrievable by the Finder even though the column is empty. A project with neither is a
  // genuinely dark one, and those are the rows worth escalating.
  //
  // Linking kbDocs to projects is done on the two deterministic conventions the ingest
  // paths actually use, in priority order:
  //   1. `kbDoc.category === project.name`         (to-kb.ts sets category per project)
  //   2. title `"<project name> — …"` or `"WhatsApp — <project name>"`
  // A normalised-substring fallback follows, and is COUNTED SEPARATELY so a fuzzy total can
  // never be mistaken for an exact one. Earlier in this claim a fuzzy title matcher reported
  // "0 to ingest" while empty docs still existed; the lesson was to keep fuzzy matches
  // visible rather than silently folded into the number.
  const kbNorm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

  const kbDocsSnap = await adminDb.collection('kbDocs').select('title', 'category').get()
  const chunkCountByDoc = new Map<string, number>()
  {
    let cur: FirebaseFirestore.QueryDocumentSnapshot | null = null
    for (;;) {
      let q = adminDb.collection('kbChunks').select('docId').orderBy('__name__').limit(2000)
      if (cur) q = q.startAfter(cur)
      const s = await q.get()
      if (s.empty) break
      for (const d of s.docs) {
        const id = String(d.get('docId'))
        chunkCountByDoc.set(id, (chunkCountByDoc.get(id) ?? 0) + 1)
      }
      cur = s.docs[s.docs.length - 1]
      if (s.size < 2000) break
    }
  }
  const kbDocs = kbDocsSnap.docs.map((d) => {
    const x = d.data() as { title?: unknown; category?: unknown }
    const title = typeof x.title === 'string' ? x.title : ''
    return {
      id: d.id,
      title,
      category: typeof x.category === 'string' ? x.category : '',
      chunks: chunkCountByDoc.get(d.id) ?? 0,
      // "WhatsApp — X" and "X — file.pdf" both reduce to X.
      subject: kbNorm(title.replace(/^WhatsApp —\s*/i, '').split('—')[0] ?? ''),
    }
  })

  function kbCoverage(projectName: string): { exact: number; fuzzy: number; docs: number } {
    const key = kbNorm(projectName)
    if (!key) return { exact: 0, fuzzy: 0, docs: 0 }
    let exact = 0
    let fuzzy = 0
    let docs = 0
    for (const k of kbDocs) {
      if (k.chunks === 0) continue
      const isExact = kbNorm(k.category) === key || k.subject === key
      const isFuzzy =
        !isExact &&
        key.length >= 8 &&
        (k.subject.includes(key) || key.includes(k.subject)) &&
        k.subject.length >= 8
      if (!isExact && !isFuzzy) continue
      docs++
      if (isExact) exact += k.chunks
      else fuzzy += k.chunks
    }
    return { exact, fuzzy, docs }
  }

  const rows: Row[] = snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>
    const descriptionChars = typeof d.description === 'string' ? d.description.length : 0
    const collateralCount = collateralByProject.get(doc.id) ?? 0
    const kb = kbCoverage(hasNonEmptyString(d.name) ? String(d.name) : '')

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
      kbChunksExact: kb.exact,
      kbChunksFuzzy: kb.fuzzy,
      kbDocs: kb.docs,
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

  // ── the rollup that actually drives action (quick-kayinleong-089) ──
  //
  // Cross the price question with KB coverage. A project with no stored price but a large
  // chat corpus is probably ANSWERABLE — an agent quoted a figure in the thread and the
  // Finder can retrieve it. A project with neither is dark: nothing in the app can answer
  // "how much?" for it, and no amount of parsing will change that. Only the second group
  // needs a human to go and find the information.
  const priceless = (r: Row) => priceBucket(r) === 'nothing'
  const kbTotal = (r: Row) => r.kbChunksExact + r.kbChunksFuzzy
  const darkRows = rows.filter((r) => priceless(r) && kbTotal(r) === 0)
  const recoverable = rows.filter((r) => priceless(r) && kbTotal(r) > 0)

  console.log()
  console.log('  ── no stored price: recoverable from the KB, or genuinely dark? ──')
  console.log(`  ${'recoverable (chat/doc content exists)'.padEnd(42)} ${String(recoverable.length).padStart(3)}`)
  console.log(`  ${'DARK (no price, no KB content at all)'.padEnd(42)} ${String(darkRows.length).padStart(3)}`)
  if (darkRows.length) {
    console.log()
    console.log('  the dark ones — nothing in the app can answer "how much?" for these:')
    for (const r of darkRows.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`    · ${r.name.slice(0, 52).padEnd(52)} ${r.status}`)
    }
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
      `  ${'desc'.padStart(6)} ${'coll'.padStart(5)}  ${'kb'.padStart(8)}`,
  )
  console.log(`  ${'─'.repeat(140)}`)
  for (const r of sorted) {
    console.log(
      `  ${String(r.missingCount).padStart(4)} ${r.name.slice(0, 44).padEnd(44)} ${r.status.padEnd(8)} ` +
        FIELDS.map((f) => (r.present[f] ? '   ✓ ' : '   · ')).join('') +
        `  ${String(r.descriptionChars).padStart(6)} ${String(r.collateralCount).padStart(5)}` +
        `  ${(r.kbChunksExact + r.kbChunksFuzzy === 0 ? 'NONE' : String(r.kbChunksExact + (r.kbChunksFuzzy ? `+${r.kbChunksFuzzy}?` : ''))).padStart(8)}`,
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
    md.push('## No stored price — recoverable, or genuinely dark?')
    md.push('')
    md.push('A blank price column is not the same as an unanswerable question. Where chat or')
    md.push('document content exists for the project, an agent very likely quoted a figure in')
    md.push('the thread and the Finder can retrieve it. Where neither exists, nothing in the app')
    md.push('can answer "how much?" — those are the rows that need a human.')
    md.push('')
    md.push('| | Projects |')
    md.push('|---|---:|')
    md.push(`| recoverable (KB content exists) | ${recoverable.length} |`)
    md.push(`| **DARK** (no price, no KB content) | **${darkRows.length}** |`)
    md.push('')
    if (darkRows.length) {
      md.push('**The dark ones:**')
      md.push('')
      for (const r of [...darkRows].sort((a, b) => a.name.localeCompare(b.name))) {
        md.push(`- ${r.name} (${r.status})`)
      }
      md.push('')
    }
    md.push('## Per project — most missing first')
    md.push('')
    md.push(`| Missing | Project | Status | ${FIELDS.map((f) => `\`${f}\``).join(' | ')} | desc chars | collateral | KB chunks |`)
    md.push(`|---:|---|---|${FIELDS.map(() => ':-:').join('|')}|---:|---:|---:|`)
    for (const r of sorted) {
      md.push(
        `| ${r.missingCount} | ${r.name.replace(/\|/g, '/')} | ${r.status} | ` +
          FIELDS.map((f) => (r.present[f] ? '✓' : '—')).join(' | ') +
          ` | ${r.descriptionChars} | ${r.collateralCount} | ${r.kbChunksExact + r.kbChunksFuzzy === 0 ? '**none**' : r.kbChunksExact + (r.kbChunksFuzzy ? ` (+${r.kbChunksFuzzy}?)` : '')} |`,
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
