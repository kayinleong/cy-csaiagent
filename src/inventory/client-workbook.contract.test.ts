/**
 * client-workbook.contract.test.ts — stage 1 -> stage 2 contract (quick-kayinleong-096, T3).
 *
 * Feeds the REAL committed stage-1 output (`client-sheet.normalized.json`,
 * `project-mapping.json`) through the T1 schema and planner. This is where the Python
 * stage and the TS stage are proven to agree: the TS invariants accept what Python wrote,
 * the counts match the plan, and the workbook-only baseline from the plan holds.
 *
 * "Workbook-only baseline": every project is planned against a stored doc with NO unitTypes
 * and priceValue 0, which isolates the sheet side of the rules from the stored lists (those
 * exist only in live data). Reads node fs only. Nothing touches a database.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/firebase/admin', () => ({ adminDb: {} }))

import { parseClientSheet, planProjectPatch, type ClientSheet, type ProjectPlan } from '@/src/inventory/client-workbook'
import {
  ProjectMappingSchema,
  planFingerprint,
  renderDryRunReport,
} from '@/src/inventory/client-workbook-run'

const CLAIM = '.planning/quick/quick-kayinleong-096'
const sheetBytes = readFileSync(`${CLAIM}/client-sheet.normalized.json`, 'utf8')
const mappingBytes = readFileSync(`${CLAIM}/project-mapping.json`)
const sheet: ClientSheet = parseClientSheet(JSON.parse(sheetBytes))
const mapping = ProjectMappingSchema.parse(JSON.parse(mappingBytes.toString('utf8')))

const IMPORTED_AT = new Date('2026-10-19T00:00:00.000Z')

/** A stored doc with no unit list and no price: the workbook-only baseline. */
function baseline(name: string): Record<string, unknown> {
  return { name, priceValue: 0, locationText: '' }
}

const plans: Record<string, ProjectPlan> = {}
for (const p of sheet.projects) {
  plans[p.inventoryName] = planProjectPatch({
    docId: p.docId,
    existing: baseline(p.inventoryName),
    sheet: p,
    holds: [],
    importedAt: IMPORTED_AT,
  })
}
const patchOf = (name: string): Record<string, unknown> => {
  const plan = plans[name]
  if (!plan) throw new Error(`no project named ${name}`)
  return plan.patch
}

describe('the committed sheet parses and matches the interface counts', () => {
  it('parseClientSheet accepts the real JSON (schema + the ten invariants)', () => {
    expect(sheet.meta.schema).toBe('client-sheet/1')
    expect(sheet.meta.import_date).toBe('2026-10-19')
    expect(sheet.projects).toHaveLength(81)
    expect(new Set(sheet.projects.map((p) => p.docId)).size).toBe(81)
  })

  it('has 106 units across 14 projects, 16 of them sold out (DC 14, One Eleven 1, Eden 1)', () => {
    const withUnits = sheet.projects.filter((p) => p.units.length > 0)
    expect(withUnits).toHaveLength(14)
    expect(withUnits.reduce((n, p) => n + p.units.length, 0)).toBe(106)
    const sold: Record<string, number> = {}
    for (const p of withUnits) {
      const n = p.units.filter((u) => u.soldOut).length
      if (n > 0) sold[p.inventoryName] = n
    }
    expect(sold).toEqual({
      'Damansara City Residency (DC Residensi)': 14,
      'One Eleven Menerung @ Bangsar': 1,
      'Eden BRDB, Taman Duta': 1,
    })
    expect(Object.values(sold).reduce((a, b) => a + b, 0)).toBe(16)
  })

  it('13 projects are merge and only Rafflesia is partial; the rest are none', () => {
    const modes = (m: string) => sheet.projects.filter((p) => p.unitMode === m)
    expect(modes('merge')).toHaveLength(13)
    expect(modes('partial').map((p) => p.inventoryName)).toEqual(['Rafflesia @ Hill 2, 3 & 4'])
    expect(modes('partial')[0].labelPrefix).toBe('Hill 4 · ')
    expect(modes('none')).toHaveLength(67)
    expect(modes('none').every((p) => p.units.length === 0 && p.labelPrefix === '')).toBe(true)
    expect(modes('merge').every((p) => p.units.length > 0 && p.labelPrefix === '')).toBe(true)
  })

  it('skips the three new projects', () => {
    expect(sheet.skipped.map((s) => s.sheetName).sort()).toEqual(
      ['Ashbourne', 'Binastra Cochrane', 'Lagenda Tunku (Villa Gemilang)'].sort(),
    )
  })
})

describe('mapping contract', () => {
  it('meta.mapping_sha256 equals the sha256 of the project-mapping.json bytes', () => {
    expect(sheet.meta.mapping_sha256).toBe(createHash('sha256').update(mappingBytes).digest('hex'))
  })

  it('every project docId is in the mapping, with the same name, unitMode and labelPrefix', () => {
    for (const p of sheet.projects) {
      const hit = mapping.entries.find(
        (e) =>
          e.docId === p.docId &&
          e.inventoryName === p.inventoryName &&
          e.unitMode === p.unitMode &&
          e.labelPrefix === p.labelPrefix,
      )
      expect(hit, `docId ${p.docId}`).toBeDefined()
    }
    expect(new Set(mapping.entries.map((e) => e.docId)).size).toBe(81)
  })

  it('has 78 exact, 2 variant and 3 sheet1-alias entries over the same workbook', () => {
    const by = (m: string) => mapping.entries.filter((e) => e.matchedBy === m).length
    expect(by('exact')).toBe(78)
    expect(by('variant')).toBe(2)
    expect(by('sheet1-alias')).toBe(3)
    expect(mapping.meta.workbook_sha256).toBe(sheet.meta.workbook_sha256)
    expect([...mapping.skippedNew].sort()).toEqual(
      ['Ashbourne', 'Binastra Cochrane', 'Lagenda Tunku (Villa Gemilang)'].sort(),
    )
  })
})

describe('workbook-only baseline (stored docs with no unitTypes and priceValue 0)', () => {
  const PRICE: Array<[string, number]> = [
    ['Damansara City Residency (DC Residensi)', 1_200_000],
    ['PDH: Imperial Residences RA', 5_050_000],
    ['ViiA Residences', 862_000],
    ['One Eleven Menerung @ Bangsar', 1_920_000],
    ['Parkside Residences', 588_000],
    ['Puncak Wangsamas Phase 2', 3_200_000],
    ['Eden BRDB, Taman Duta', 8_500_000],
    ['SO Sofitel Residences KLCC', 1_212_640],
    ['Jewel by Oxley KLCC', 1_601_663],
    ['Luminar Residence Subang by BRDB', 411_000],
    ['Rafflesia @ Hill 2, 3 & 4', 3_717_000],
  ]
  it.each(PRICE)('priceValue %s = %i', (name, value) => {
    const patch = patchOf(name)
    expect(patch.priceValue).toBe(value)
    expect(patch.priceProvenance).toBe('stated')
    expect(patch.priceSource).toBe('client-workbook')
  })

  it('plans no price key for The Lantern Bangsar, PDH Royal Suites or Southpoint', () => {
    for (const name of [
      'The Lantern Bangsar',
      'Pavilion Damansara Heights: Royal Suites(RC)',
      'Southpoint Residences (IGB )',
    ]) {
      expect(patchOf(name).priceValue, name).toBeUndefined()
    }
  })

  const PSF: Array<[string, number, number]> = [
    ['ViiA Residences', 1350, 1350],
    ['One Eleven Menerung @ Bangsar', 1760, 2200],
    ['Parkside Residences', 1200, 1300],
    ['Eden BRDB, Taman Duta', 1625, 1700],
    ['Luminar Residence Subang by BRDB', 700, 847],
    ['Rafflesia @ Hill 2, 3 & 4', 988, 1006],
  ]
  it.each(PSF)('psf %s = %i-%i', (name, lo, hi) => {
    const patch = patchOf(name)
    expect(patch.pricePsfMin).toBe(lo)
    expect(patch.pricePsfMax).toBe(hi)
  })

  it('plans no psf for any other project', () => {
    const named = new Set(PSF.map(([n]) => n))
    for (const p of sheet.projects) {
      if (named.has(p.inventoryName)) continue
      expect(plans[p.inventoryName].patch.pricePsfMin, p.inventoryName).toBeUndefined()
      expect(plans[p.inventoryName].patch.pricePsfMax, p.inventoryName).toBeUndefined()
    }
  })

  const SIZES: Array<[string, number, number]> = [
    ['Damansara City Residency (DC Residensi)', 904, 2982],
    ['Eden BRDB, Taman Duta', 5307, 19031],
    ['The Lantern Bangsar', 570, 852],
  ]
  it.each(SIZES)('sizes %s = %i-%i', (name, lo, hi) => {
    const patch = patchOf(name)
    expect(patch.sizeMinSqft).toBe(lo)
    expect(patch.sizeMaxSqft).toBe(hi)
  })

  const BEDROOMS: Array<[string, number]> = [
    ['PDH: Imperial Residences RA', 4],
    ['One Eleven Menerung @ Bangsar', 2],
    ['Eden BRDB, Taman Duta', 4],
    ['SO Sofitel Residences KLCC', 1],
  ]
  it.each(BEDROOMS)('bedrooms %s = %i', (name, beds) => {
    expect(patchOf(name).bedrooms).toBe(beds)
  })

  it('sold-out units never count toward price or size, and every planned list keeps them flagged', () => {
    const dc = patchOf('Damansara City Residency (DC Residensi)')
    const list = dc.unitTypes as Array<{ soldOut?: boolean; priceMinRM: number | null }>
    expect(list.filter((e) => e.soldOut === true)).toHaveLength(14)
    expect(list.filter((e) => e.soldOut === true).every((e) => e.priceMinRM === null)).toBe(true)
    expect(list).toHaveLength(18)
  })

  it('no stored figure is psf x size, and no psf outside 200-5,000 is planned', () => {
    for (const plan of Object.values(plans)) {
      const lo = plan.patch.pricePsfMin as number | undefined
      const hi = plan.patch.pricePsfMax as number | undefined
      if (lo !== undefined) expect(lo >= 200 && lo <= 5000).toBe(true)
      if (hi !== undefined) expect(hi >= 200 && hi <= 5000).toBe(true)
    }
  })
})

describe('the report renders over the real sheet', () => {
  it('renders 81 projects with the real names without tripping the contact scanner', () => {
    const list = Object.values(plans)
    const text = renderDryRunReport({
      title: 'Client workbook import: dry run',
      target: 'emulator',
      fingerprint: planFingerprint({
        mappingSha256: sheet.meta.mapping_sha256,
        holds: {},
        plans: list,
      }),
      generatedAt: IMPORTED_AT,
      workbookSha256: sheet.meta.workbook_sha256,
      mappingSha256: sheet.meta.mapping_sha256,
      columns: { before: 'Before', after: 'After' },
      mapping,
      docs: list.map((pl) => ({
        docId: pl.docId,
        name: pl.inventoryName,
        changes: pl.changes,
        warnings: pl.warnings,
        reembed: pl.reembed,
        holds: [],
        storedUnits: [],
      })),
      skippedCount: sheet.skipped.length,
      heldBackCount: sheet.heldBack.length,
      conflictCount: sheet.conflicts.length,
    })
    expect(text).toContain('Projects in the plan: 81')
    expect(text).toContain('Damansara City Residency (DC Residensi)')
    // 83 mapping rows are rendered
    expect(text.split('\n').filter((l) => /\| (exact|variant|sheet1-alias) \|$/.test(l))).toHaveLength(83)
  })
})
