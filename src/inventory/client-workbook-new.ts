/**
 * src/inventory/client-workbook-new.ts — the project record for a client-sheet project that
 * is not in the inventory yet (quick-kayinleong-101).
 *
 * Claim 096 merged the client's project info sheet into the 81 projects that already
 * existed and skipped three that did not: Binastra Cochrane, Lagenda Tunku (Villa Gemilang)
 * and Ashbourne. This builds their records from the same normalised sheet entries, through
 * the same planner (`planProjectPatch`), so a created project carries exactly what an
 * updated one would: the sheet's layouts, sizes, bedrooms, tenure and completion, and the
 * `clientWorkbookFields` markers that keep the prose backfills off those fields.
 *
 * Everything else is a stated default, never a guess:
 *   status 'active'                the sheet lists it as a project D2 sells
 *   priceValue 0 / 'unknown'       no total price in the sheet (the planner sets one if it has)
 *   bumiQuota / foreignEligible    false: the sheet does not mention either, which is the
 *                                  inventory importer's rule for an unmentioned flag
 *   locationText                   the sheet's Area cell, verbatim
 *   description                    the sheet's own cells, one labelled line each
 *
 * Pure: no Firestore, no network. The script that writes these is
 * scripts/add-client-workbook-projects.ts.
 */

import { createHash } from 'node:crypto'
import { priceBandFor, TENANT_ID } from '@/src/firebase/collections'
import { DELETE_FIELD, planProjectPatch, type PlanWarning, type SheetProject } from '@/src/inventory/client-workbook'

/** The record fields, minus the embedding the script adds after embedding this text. */
export type NewProjectRecord = Record<string, unknown> & {
  tenantId: typeof TENANT_ID
  name: string
  status: 'active'
  description: string
  locationText: string
}

export interface NewProjectPlan {
  docId: string
  name: string
  record: NewProjectRecord
  warnings: PlanWarning[]
}

/** The sheet's project-level cells, in the order the sheet lists them. */
const DESCRIPTION_FACTS: ReadonlyArray<readonly [keyof SheetProject['facts'], string]> = [
  ['developer', 'Developer'],
  ['area', 'Area'],
  ['landTitle', 'Land Title'],
  ['tenure', 'Tenure'],
  ['maintenanceFee', 'Maintenance Fee'],
  ['totalUnits', 'Total Units'],
  ['floors', 'Total Floors/Storeys'],
  ['completion', 'Expected Completion/VP'],
  ['topReasons', 'Top Reasons Why'],
  ['furnishing', 'Furnishing'],
  ['carPark', 'Car Park Allocation'],
]

/**
 * The write-up: the sheet's cells as labelled lines, then the layouts' verbatim source
 * lines. Nothing is paraphrased, so every sentence traces back to a cell.
 */
export function describeNewProject(sheet: SheetProject, sourceLabel: string): string {
  const lines = [`Project Name: ${sheet.inventoryName}`]
  for (const [key, label] of DESCRIPTION_FACTS) {
    const v = sheet.facts[key]
    if (typeof v === 'string' && v.trim() !== '') lines.push(`${label}: ${v.trim()}`)
  }
  if (sheet.units.length > 0) {
    lines.push('Layouts:')
    for (const u of sheet.units) lines.push(`- ${u.raw}${u.soldOut ? ' (sold out)' : ''}`)
  }
  lines.push(`Source: ${sourceLabel}.`)
  return lines.join('\n')
}

/** Plan the record for one new project. Refuses a sheet entry that names no area. */
export function planNewProject(args: {
  sheet: SheetProject
  sourceLabel: string
  importedAt: Date
}): NewProjectPlan {
  const { sheet, sourceLabel, importedAt } = args
  const area = sheet.area?.trim() ?? ''
  if (area === '') throw new Error(`docId=${sheet.docId}: the sheet gives no Area, so there is no location to store`)

  const base: Record<string, unknown> = {
    tenantId: TENANT_ID,
    name: sheet.inventoryName,
    status: 'active',
    priceValue: 0,
    priceBand: priceBandFor(0),
    priceProvenance: 'unknown',
    tenure: '',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: false,
    description: describeNewProject(sheet, sourceLabel),
    locationText: area,
    bedrooms: 0,
  }
  const plan = planProjectPatch({ docId: sheet.docId, existing: base, sheet, holds: [], importedAt })
  const record: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(plan.patch)) {
    if (v === DELETE_FIELD) delete record[k]
    else record[k] = v
  }
  return {
    docId: sheet.docId,
    name: sheet.inventoryName,
    record: record as NewProjectRecord,
    warnings: plan.warnings,
  }
}

function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(canon)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}

/**
 * The fingerprint the user approves: every planned record (minus the import timestamp,
 * which changes run to run), sorted by docId, plus the workbook it came from.
 */
export function newProjectsFingerprint(plans: readonly NewProjectPlan[], workbookSha256: string): string {
  const body = [...plans]
    .sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0))
    .map((p) => {
      const rest = { ...p.record }
      delete rest.clientWorkbookImportedAt
      return { docId: p.docId, record: canon(rest) }
    })
  return createHash('sha256').update(JSON.stringify({ workbookSha256, body })).digest('hex')
}
