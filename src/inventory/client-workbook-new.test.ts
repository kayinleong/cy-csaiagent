/**
 * client-workbook-new.test.ts — the records for the three client-sheet projects that were
 * never in the inventory (quick-kayinleong-101).
 *
 * Runs against the real build output in .planning/quick/quick-kayinleong-101/new-projects,
 * so what is tested is what the script would write.
 *
 * Run: npx vitest run src/inventory/client-workbook-new.test.ts
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/firebase/admin', () => ({ adminDb: {} }))

import { parseClientSheet } from '@/src/inventory/client-workbook'
import { describeNewProject, newProjectsFingerprint, planNewProject } from '@/src/inventory/client-workbook-new'

const SHEET_PATH = '.planning/quick/quick-kayinleong-101/new-projects/client-sheet.new.json'
const sheet = parseClientSheet(JSON.parse(readFileSync(SHEET_PATH, 'utf8')))
const IMPORTED_AT = new Date('2026-10-27T15:00:00Z')
const LABEL = sheet.meta.source_label
const byName = (n: string) => {
  const p = sheet.projects.find((x) => x.inventoryName === n)
  if (!p) throw new Error(`missing ${n}`)
  return p
}
const plan = (n: string) => planNewProject({ sheet: byName(n), sourceLabel: LABEL, importedAt: IMPORTED_AT })

describe('the three new projects from the client sheet', () => {
  it('the build holds exactly the three projects claim 096 skipped', () => {
    expect(sheet.projects.map((p) => p.inventoryName)).toEqual([
      'Binastra Cochrane',
      'Lagenda Tunku (Villa Gemilang)',
      'Ashbourne',
    ])
  })

  it('Ashbourne carries its eight layouts, sizes and tenure from the sheet', () => {
    const { record } = plan('Ashbourne')
    const units = record.unitTypes as Array<{ label: string; sizeSqft: number; priceMinRM: number | null }>
    expect(units.map((u) => u.label)).toEqual([
      'Type A', 'Type A1', 'Type A2', 'Type A3', 'Type B', 'Type C', 'Type C1', 'Type D',
    ])
    expect(units.map((u) => u.sizeSqft)).toEqual([1491, 1538, 1652, 1607, 1747, 2273, 2273, 2661])
    expect(record.sizeMinSqft).toBe(1491)
    expect(record.sizeMaxSqft).toBe(2661)
    expect(record.tenure).toBe('Freehold')
    expect(record.locationText).toBe('Jalan Ampang, Taman U-thant')
    // The sheet states no price: unknown, never a synthesised one.
    expect(units.every((u) => u.priceMinRM === null)).toBe(true)
    expect(record.priceValue).toBe(0)
    expect(record.priceBand).toBe('price_unknown')
    expect(record.priceProvenance).toBe('unknown')
    expect(record.clientWorkbookFields).toEqual(['sizeMaxSqft', 'sizeMinSqft', 'tenure', 'unitTypes'])
    expect(record.clientWorkbookImportedAt).toEqual(IMPORTED_AT)
  })

  it('an expected completion date is never written as a completed VP', () => {
    for (const n of ['Lagenda Tunku (Villa Gemilang)', 'Ashbourne']) {
      expect(plan(n).record.vpStatus).toBe(false)
      expect(plan(n).record.vpDate).toBeNull()
    }
  })

  it('records with no layouts still get the tenure, area and defaults', () => {
    const { record } = plan('Binastra Cochrane')
    expect(record).toMatchObject({
      tenantId: 'd2',
      name: 'Binastra Cochrane',
      status: 'active',
      tenure: 'Freehold',
      locationText: 'Jalan Cochrane in Cheras, Kuala Lumpur',
      bumiQuota: false,
      foreignEligible: false,
      bedrooms: 0,
    })
    expect(record.unitTypes).toBeUndefined()
    expect(record.embedding).toBeUndefined()
  })

  it('the write-up is the sheet\'s own cells, one labelled line each', () => {
    const text = describeNewProject(byName('Lagenda Tunku (Villa Gemilang)'), LABEL)
    expect(text.split('\n')).toEqual([
      'Project Name: Lagenda Tunku (Villa Gemilang)',
      'Developer: Revival International Sdn Bhd',
      'Area: Bukit Tunku',
      'Land Title: Strata',
      'Tenure: Freehold',
      'Total Units: 7 lots (bespoke villas)',
      'Total Floors/Storeys: 3 – 4 storeys',
      'Expected Completion/VP: Completion Date: July 2026',
      `Source: ${LABEL}.`,
    ])
    expect(describeNewProject(byName('Ashbourne'), LABEL)).toContain('- Type D: 2661sf | 4+1rooms facing fully golf')
  })

  it('a sheet entry with no Area is refused rather than stored without a location', () => {
    const noArea = { ...byName('Binastra Cochrane'), area: null }
    expect(() => planNewProject({ sheet: noArea, sourceLabel: LABEL, importedAt: IMPORTED_AT })).toThrow(/no Area/)
  })

  it('the fingerprint ignores the import time and order but not a value', () => {
    const plans = sheet.projects.map((p) => planNewProject({ sheet: p, sourceLabel: LABEL, importedAt: IMPORTED_AT }))
    const later = sheet.projects.map((p) =>
      planNewProject({ sheet: p, sourceLabel: LABEL, importedAt: new Date('2026-10-28T09:00:00Z') }),
    )
    const fp = newProjectsFingerprint(plans, sheet.meta.workbook_sha256)
    expect(newProjectsFingerprint([...later].reverse(), sheet.meta.workbook_sha256)).toBe(fp)
    const changed = plans.map((p, i) => (i === 0 ? { ...p, record: { ...p.record, bumiQuota: true } } : p))
    expect(newProjectsFingerprint(changed, sheet.meta.workbook_sha256)).not.toBe(fp)
  })
})
