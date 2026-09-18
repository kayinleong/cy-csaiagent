/**
 * scripts/export-projects-for-workbook.ts — dump the `projects` collection to a local
 * JSON so the client-facing workbook can show REAL VALUES instead of presence markers
 * (quick-kayinleong-090).
 *
 * WHY: `.planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md` records presence only —
 * deliberately, so no values or PII land in a committed artifact. That is the right call for
 * a committed report, but it means the workbook can only say "on file". Derek asked to see
 * the actual value next to each blank. This script is the read-only bridge.
 *
 * READ-ONLY. Writes no Firestore field. Its only output is the local JSON below.
 *
 * ⚠ OUTPUT IS GITIGNORED AND MUST STAY THAT WAY. It carries full `description` prose, which
 * in this corpus can include agent contact details (PIC names, WhatsApp numbers) — the same
 * exposure that put /projects.json and /projects.inventory.json in .gitignore. `embedding` is
 * dropped (8 KB x 87, useless here).
 *
 *   npm install                                   # node_modules is absent on a fresh clone
 *   node_modules/.bin/tsx --env-file=.env.local scripts/export-projects-for-workbook.ts
 *
 * Then rebuild the workbook — it picks the export up automatically:
 *   uv run --with openpyxl python .planning/quick/quick-kayinleong-090/build-property-workbook.py
 */

import { writeFileSync } from 'node:fs'
import { adminDb } from '@/src/firebase/admin'

const OUT_PATH = 'projects.export.json'

/** Firestore Timestamp | Date | null → 'YYYY-MM-DD' | null, without pulling in a date lib. */
function toISODate(v: unknown): string | null {
  if (v == null) return null
  const d =
    typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function'
      ? (v as { toDate: () => Date }).toDate()
      : v instanceof Date
        ? v
        : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

async function main() {
  console.log('[export] reading projects…')
  const snap = await adminDb.collection('projects').get()

  // Collateral: count per project, and the type histogram. 12,020 docs — count, never dump.
  console.log('[export] reading collateral…')
  const collSnap = await adminDb.collection('collateral').get()
  const collByProject = new Map<string, { total: number; byType: Record<string, number>; byLang: Record<string, number> }>()
  for (const d of collSnap.docs) {
    const { projectId, type, lang } = d.data() as { projectId?: string; type?: string; lang?: string }
    if (!projectId) continue
    const e = collByProject.get(projectId) ?? { total: 0, byType: {}, byLang: {} }
    e.total += 1
    if (type) e.byType[type] = (e.byType[type] ?? 0) + 1
    if (lang) e.byLang[lang] = (e.byLang[lang] ?? 0) + 1
    collByProject.set(projectId, e)
  }

  const records = snap.docs.map((doc) => {
    // `embedding` is destructured out and never serialized.
    const { embedding: _embedding, ...d } = doc.data() as Record<string, unknown>
    const coll = collByProject.get(doc.id) ?? { total: 0, byType: {}, byLang: {} }
    return {
      projectId: doc.id,
      name: d.name ?? null,
      status: d.status ?? null,
      priceValue: d.priceValue ?? null,
      priceBand: d.priceBand ?? null,
      pricePsfMin: d.pricePsfMin ?? null,
      pricePsfMax: d.pricePsfMax ?? null,
      priceProvenance: d.priceProvenance ?? null,
      priceSource: d.priceSource ?? null,
      priceSourceChunkId: d.priceSourceChunkId ?? null,
      tenure: d.tenure ?? null,
      vpStatus: d.vpStatus ?? null,
      vpDate: toISODate(d.vpDate),
      bumiQuota: d.bumiQuota ?? null,
      foreignEligible: d.foreignEligible ?? null,
      bedrooms: d.bedrooms ?? null,
      sizeMinSqft: d.sizeMinSqft ?? null,
      sizeMaxSqft: d.sizeMaxSqft ?? null,
      locationText: d.locationText ?? null,
      description: d.description ?? null,
      unitTypes: d.unitTypes ?? [],
      collateralTotal: coll.total,
      collateralByType: coll.byType,
      collateralByLang: coll.byLang,
    }
  })

  records.sort((a, b) => String(a.name ?? '').toLowerCase().localeCompare(String(b.name ?? '').toLowerCase()))

  const payload = {
    exportedAt: new Date().toISOString(),
    source: 'live Firestore — projects + collateral',
    note: 'embedding omitted. Contains full description prose — keep gitignored.',
    projectCount: records.length,
    collateralCount: collSnap.size,
    records,
  }

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2))

  const withPrice = records.filter((r) => typeof r.priceValue === 'number' && r.priceValue > 0).length
  const withBeds = records.filter((r) => typeof r.bedrooms === 'number' && r.bedrooms > 0).length
  const withLayouts = records.filter((r) => Array.isArray(r.unitTypes) && r.unitTypes.length > 0).length
  console.log(`[export] ✓ ${records.length} projects → ${OUT_PATH}`)
  console.log(`[export]   ${withPrice} with a total price · ${withBeds} with bedrooms · ${withLayouts} with a layout table`)
  console.log(`[export]   ${collSnap.size} collateral docs counted (not dumped)`)
  console.log('[export] NOTE: this file is gitignored. Do not commit it.')
}

main().catch((err) => {
  console.error('[export] FAILED:', err)
  process.exit(1)
})
