/**
 * client-workbook.ts — the pure core of the client project info sheet ingest
 * (quick-kayinleong-096).
 *
 * Two jobs, both free of I/O (no Firestore calls, no node fs):
 *
 *   1. `parseClientSheet` — load the normalised sheet JSON that the Python stage wrote
 *      (`client-sheet.normalized.json`, "Contract 1") through a zod schema AND the same
 *      ten invariant gates the Python stage runs before it writes (gate equivalence).
 *      A violation is a hard error that names the docId and unit and the invariant,
 *      never the cell text.
 *
 *   2. `planProjectPatch` — decide, for one stored project, exactly which fields the
 *      sheet changes (rules R1–R13). The central rule (D4): a blank sheet cell NEVER
 *      clears a stored value. Unit lists are merged unit by unit (U1–U6), and every
 *      derived value (sizes, bedrooms, price) is computed over the FINAL merged list.
 *
 * Importing `priceBandFor` loads `collections.ts`, which loads the admin SDK, so tests of
 * this module mock `@/src/firebase/admin`. The CLIs must run `assertSafeTarget` (from the
 * import-free safety module) before they import this file.
 */

import { z } from 'zod'
import { priceBandFor } from '@/src/firebase/collections'
import type { ClientWorkbookField, UnitTypeEntry } from '@/src/firebase/collections'
import { CLIENT_WORKBOOK_SOURCE, scanForContactDetails } from '@/src/inventory/client-workbook-safety'

// ─── Contract 1: schema ───────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/

/** The only `labelPrefix` a `partial` project may carry: "Hill 4" + " · " (U+00B7). */
export const PARTIAL_LABEL_PREFIX = 'Hill 4 · '

const UNIT_MODES = ['merge', 'partial', 'none'] as const
export type UnitMode = (typeof UNIT_MODES)[number]

const COMPLETION_KINDS = [
  'completed_year',
  'completed_no_year',
  'future_or_expected',
  'ambiguous',
] as const

const nullableInt = z.number().int().nullable()
const nullableString = z.string().nullable()

const SheetUnitSchema = z.strictObject({
  sheetRow: z.number().int(),
  label: z.string(),
  sizeSqft: nullableInt,
  bedrooms: nullableInt,
  nettMinRM: nullableInt,
  nettMaxRM: nullableInt,
  grossMinRM: nullableInt,
  grossMaxRM: nullableInt,
  psfRM: nullableInt,
  soldOut: z.boolean(),
  raw: z.string(),
  held: z.array(z.enum(['Size', 'Rooms', 'Nett', 'Gross'])),
})

const FactsSchema = z.strictObject({
  area: nullableString,
  developer: nullableString,
  landTitle: nullableString,
  maintenanceFee: nullableString,
  tenure: nullableString,
  totalUnits: nullableString,
  floors: nullableString,
  completion: nullableString,
  topReasons: nullableString,
  furnishing: nullableString,
  carPark: nullableString,
})

const CompletionSchema = z
  .strictObject({
    kind: z.enum(COMPLETION_KINDS),
    year: nullableInt,
  })
  .nullable()

const SheetProjectSchema = z.strictObject({
  docId: z.string().min(1),
  inventoryName: z.string().min(1),
  sheetName: z.string().min(1),
  sheetRow: nullableInt,
  unitMode: z.enum(UNIT_MODES),
  labelPrefix: z.string(),
  units: z.array(SheetUnitSchema),
  tenure: nullableString,
  completion: CompletionSchema,
  area: nullableString,
  facts: FactsSchema,
  focusLists: z.array(z.string()),
  factSheet: nullableString,
})

export const ClientSheetSchema = z.strictObject({
  meta: z.strictObject({
    schema: z.literal('client-sheet/1'),
    source_label: z.string().min(1),
    import_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    workbook_sha256: z.string().regex(HEX64),
    mapping_sha256: z.string().regex(HEX64),
  }),
  projects: z.array(SheetProjectSchema),
  skipped: z.array(
    z.strictObject({
      sheetName: z.string(),
      sheetRow: nullableInt,
      unitRows: z.number().int(),
      reason: z.string(),
    }),
  ),
  heldBack: z.array(
    z.strictObject({
      docId: z.string(),
      inventoryName: z.string(),
      sheetRow: nullableInt,
      unit: nullableString,
      column: z.string(),
      sheetText: nullableString,
      reason: z.string(),
    }),
  ),
  conflicts: z.array(
    z.strictObject({
      inventoryName: z.string(),
      unit: z.string(),
      column: z.string(),
      sheet: z.string(),
      reference: z.string(),
      referenceSource: z.string(),
      action: z.string(),
    }),
  ),
})

export type ClientSheet = z.infer<typeof ClientSheetSchema>
export type SheetProject = z.infer<typeof SheetProjectSchema>
export type SheetUnit = z.infer<typeof SheetUnitSchema>

// ─── Contract 1: invariants and loader ────────────────────────────────────────

/** Thrown by `parseClientSheet`. `violations` never contain cell text. */
export class ClientSheetError extends Error {
  readonly violations: string[]
  constructor(violations: string[]) {
    super(`client sheet failed validation (${violations.length}):\n - ${violations.join('\n - ')}`)
    this.name = 'ClientSheetError'
    this.violations = violations
  }
}

const NETT_GROSS_MIN = 50_000
const NETT_GROSS_MAX = 100_000_000
const TENURE_RE = /^(Freehold|Leasehold( \d{4})?)$/

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** Describe where a zod issue sits using ids and labels only, never values. */
function describeIssuePath(json: unknown, path: ReadonlyArray<PropertyKey>): string {
  const root = json as { projects?: Array<{ docId?: unknown; units?: Array<{ label?: unknown }> }> }
  if (path[0] === 'projects' && typeof path[1] === 'number') {
    const proj = root?.projects?.[path[1]]
    const docId = typeof proj?.docId === 'string' ? proj.docId : `#${path[1]}`
    if (path[2] === 'units' && typeof path[3] === 'number') {
      const label = proj?.units?.[path[3]]?.label
      const unit = typeof label === 'string' ? label : `#${path[3]}`
      return `docId=${docId} unit="${unit}" field ${path.slice(4).map(String).join('.') || '(unit)'}`
    }
    return `docId=${docId} field ${path.slice(2).map(String).join('.') || '(project)'}`
  }
  return `field ${path.map(String).join('.') || '(root)'}`
}

function checkUnit(docId: string, u: SheetUnit, out: string[]): void {
  const at = `docId=${docId} unit="${u.label}"`
  if (u.label.trim() === '' || u.raw.trim() === '') {
    out.push(`${at} invariant 1: label and raw must be non-empty`)
  }
  if (u.sizeSqft !== null && !(u.sizeSqft >= 100 && u.sizeSqft <= 30_000)) {
    out.push(`${at} invariant 2: sizeSqft must be null or 100-30,000`)
  }
  if (u.bedrooms !== null && !(u.bedrooms >= 0 && u.bedrooms <= 10)) {
    out.push(`${at} invariant 3: bedrooms must be null or 0-10`)
  }
  const pair = (kind: string, lo: number | null, hi: number | null): void => {
    if (lo === null && hi === null) return
    if (lo === null || hi === null) {
      out.push(`${at} invariant 4: ${kind} must be both null or both set`)
      return
    }
    if (lo < NETT_GROSS_MIN || hi > NETT_GROSS_MAX || lo > NETT_GROSS_MAX || hi < NETT_GROSS_MIN) {
      out.push(`${at} invariant 4: ${kind} must be 50,000-100,000,000`)
    }
    if (lo > hi) out.push(`${at} invariant 4: ${kind} min is above max`)
  }
  pair('nett', u.nettMinRM, u.nettMaxRM)
  pair('gross', u.grossMinRM, u.grossMaxRM)
  if (
    u.nettMinRM !== null &&
    u.nettMaxRM !== null &&
    u.grossMinRM !== null &&
    u.grossMaxRM !== null &&
    (u.grossMinRM < u.nettMinRM || u.grossMaxRM < u.nettMaxRM)
  ) {
    out.push(`${at} invariant 5: gross must not be below nett`)
  }
  if (u.psfRM !== null && !(u.psfRM >= 200 && u.psfRM <= 5_000)) {
    out.push(`${at} invariant 6: psfRM must be null or 200-5,000`)
  }
  if (
    u.soldOut &&
    (u.nettMinRM !== null ||
      u.nettMaxRM !== null ||
      u.grossMinRM !== null ||
      u.grossMaxRM !== null ||
      u.psfRM !== null)
  ) {
    out.push(`${at} invariant 7: a sold-out unit must carry no price`)
  }
}

function checkProject(p: SheetProject, importYear: number, out: string[]): void {
  const at = `docId=${p.docId}`
  // 8. unitMode and labelPrefix
  if (p.unitMode === 'merge' && p.labelPrefix !== '') {
    out.push(`${at} invariant 8: merge needs an empty labelPrefix`)
  }
  if (p.unitMode === 'partial' && p.labelPrefix !== PARTIAL_LABEL_PREFIX) {
    out.push(`${at} invariant 8: partial needs the "Hill 4 · " labelPrefix`)
  }
  if (p.unitMode === 'none' && (p.units.length > 0 || p.labelPrefix !== '')) {
    out.push(`${at} invariant 8: none needs no units and an empty labelPrefix`)
  }
  if (p.unitMode !== 'none' && p.units.length === 0) {
    out.push(`${at} invariant 8: ${p.unitMode} needs at least one unit`)
  }
  // 9. tenure and completion
  if (p.tenure !== null && !TENURE_RE.test(p.tenure)) {
    out.push(`${at} invariant 9: tenure must be null, Freehold or Leasehold [YYYY]`)
  }
  if (p.completion !== null) {
    const { kind, year } = p.completion
    if (kind === 'completed_year') {
      if (!isInt(year) || year >= importYear) {
        out.push(`${at} invariant 9: completed_year needs an integer year before ${importYear}`)
      }
    } else if (year !== null) {
      out.push(`${at} invariant 9: only completed_year may carry a year`)
    }
  }
  for (const u of p.units) checkUnit(p.docId, u, out)
}

/** Walk every string under `value`, calling `visit(path, text)`. */
function walkStrings(value: unknown, path: string, visit: (path: string, text: string) => void): void {
  if (typeof value === 'string') visit(path, value)
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit))
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, path === '' ? k : `${path}.${k}`, visit)
  }
}

/**
 * Parse and gate the normalised client sheet. Runs the zod schema, then the ten
 * invariants. Every violation is collected and thrown together as a `ClientSheetError`
 * that names the docId and unit and the invariant, never the cell text.
 */
export function parseClientSheet(json: unknown): ClientSheet {
  const parsed = ClientSheetSchema.safeParse(json)
  if (!parsed.success) {
    throw new ClientSheetError(
      parsed.error.issues.map((i) => `${describeIssuePath(json, i.path)}: ${i.message}`),
    )
  }
  const sheet = parsed.data
  const violations: string[] = []
  const importYear = Number(sheet.meta.import_date.slice(0, 4))
  for (const p of sheet.projects) checkProject(p, importYear, violations)

  // 10. no contact details anywhere under projects, skipped, heldBack or conflicts
  // (meta is excluded: it holds hex hashes).
  const scan = (root: string, value: unknown, label: (index: number) => string): void => {
    ;(value as unknown[]).forEach((item, i) => {
      walkStrings(item, '', (path, text) => {
        const classes = scanForContactDetails(text)
        if (classes.length > 0) {
          violations.push(`${label(i)} field ${path || root} invariant 10: contact details (${classes.join(', ')})`)
        }
      })
    })
  }
  scan('projects', sheet.projects, (i) => `docId=${sheet.projects[i].docId}`)
  scan('skipped', sheet.skipped, (i) => `skipped[${i}]`)
  scan('heldBack', sheet.heldBack, (i) => `heldBack[${i}]`)
  scan('conflicts', sheet.conflicts, (i) => `conflicts[${i}]`)

  if (violations.length > 0) throw new ClientSheetError(violations)
  return sheet
}

// ─── Planner types ────────────────────────────────────────────────────────────

/** Sentinel for "delete this field". The runner turns it into FieldValue.delete(). */
export const DELETE_FIELD: unique symbol = Symbol('client-workbook.delete-field')

export type HoldGroup =
  | 'unitTypes'
  | 'unitDrops'
  | 'sizes'
  | 'bedrooms'
  | 'price'
  | 'psf'
  | 'tenure'
  | 'vp'

/** Which stored keys each hold group removes from the plan (R9). */
export const HOLD_GROUPS: Readonly<Record<HoldGroup, readonly string[]>> = {
  unitTypes: ['unitTypes'],
  unitDrops: [],
  sizes: ['sizeMinSqft', 'sizeMaxSqft'],
  bedrooms: ['bedrooms'],
  price: ['priceValue', 'priceBand', 'priceProvenance', 'priceSource', 'priceSourceChunkId'],
  psf: ['pricePsfMin', 'pricePsfMax'],
  tenure: ['tenure'],
  vp: ['vpStatus', 'vpDate'],
}

export interface PlanWarning {
  code: string
  message: string
}

export interface PlanChange {
  field: string
  before: unknown
  after: unknown
}

export interface ProjectPlan {
  docId: string
  inventoryName: string
  /** Changed keys only. A value may be `DELETE_FIELD`. */
  patch: Record<string, unknown>
  changes: PlanChange[]
  /** The ClientWorkbookFields planned by R1-R8 after holds, changed or not. */
  asserted: ClientWorkbookField[]
  warnings: PlanWarning[]
  /** True when the changes touch priceValue, tenure or bedrooms (embedded fields). */
  reembed: boolean
  /** The final merged list is non-empty and every entry is sold out. */
  allUnitsSoldOut: boolean
}

export interface MergeResult {
  final: UnitTypeEntry[]
  /** Final labels of stored entries that were merged with a sheet unit. */
  matched: string[]
  /** Final labels of sheet units added as new entries. */
  added: string[]
  /** Labels of stored entries that had no sheet match and were kept. */
  keptUnmatched: string[]
  /** Stored grouped entries that were dropped (U5), with whether they carried a price. */
  dropped: Array<{ label: string; hadPrice: boolean }>
  warnings: PlanWarning[]
  /**
   * Aligned with `final`: where each entry's price pair came from. 'sheet' = the sheet's
   * nett (or sheet sold-out null); 'stored' = a stored pair kept; 'none' = no price.
   */
  priceSources: Array<'sheet' | 'stored' | 'none'>
}

function assertHoldGroups(holds: readonly string[]): asserts holds is readonly HoldGroup[] {
  for (const g of holds) {
    if (!Object.prototype.hasOwnProperty.call(HOLD_GROUPS, g)) {
      throw new Error(`unknown hold group "${g}"`)
    }
  }
}

// ─── Unit-level merge (R1, U1-U6) ─────────────────────────────────────────────

function stripPrefix(label: string, labelPrefix: string): string {
  return labelPrefix !== '' && label.startsWith(labelPrefix) ? label.slice(labelPrefix.length) : label
}

/**
 * U1. The key two labels are compared by: prefix off, one trailing parenthetical off,
 * lower-cased, a leading "type" word off, runs of non-alphanumerics collapsed to a space.
 */
export function labelKey(label: string, labelPrefix: string): string {
  let s = stripPrefix(label, labelPrefix)
  s = s.replace(/\s*\([^)]*\)\s*$/, '')
  s = s.toLowerCase()
  s = s.replace(/^type\s+/, '')
  return s.replace(/[^a-z0-9]+/g, ' ').trim()
}

/** A type code at the start of a label (T2 label regex, case-sensitive). */
const TYPE_CODE_RE = /^(?:Type\s+[A-Z]|[A-Z]{1,3}\d+[a-z]?)/

/**
 * U5. A grouped (bucket) entry is one whose label, prefix removed and trimmed, does NOT
 * start with a type code: "1 Bedroom", "1+1 Bedrooms", "Penthouses", "Studio".
 */
export function isGroupedLabel(label: string, labelPrefix: string): boolean {
  return !TYPE_CODE_RE.test(stripPrefix(label, labelPrefix).trim())
}

function fmtRM(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function entryHasPrice(e: UnitTypeEntry): boolean {
  return e.priceMinRM !== null && e.priceMinRM !== undefined
}

/**
 * R1. Merge the sheet's units into the stored list, unit by unit. Stored values the sheet
 * leaves blank are kept. Only an untyped grouped stored entry is ever dropped, and only in
 * `merge` mode, unless the `unitDrops` hold keeps it.
 */
export function mergeUnits(args: {
  stored: readonly UnitTypeEntry[]
  sheetUnits: readonly SheetUnit[]
  unitMode: UnitMode
  labelPrefix: string
  holds?: readonly string[]
}): MergeResult {
  const { stored, sheetUnits, unitMode, labelPrefix } = args
  const holds = args.holds ?? []
  assertHoldGroups(holds)
  const keepDrops = holds.includes('unitDrops')
  const partial = unitMode === 'partial'

  const warnings: PlanWarning[] = []
  const storedKeys = stored.map((e) => labelKey(e.label, labelPrefix))
  const used: boolean[] = stored.map(() => false)
  const matchOf = new Map<number, SheetUnit>()
  const toAdd: SheetUnit[] = []

  // U2. Matching, in sheet order. A stored entry can be matched at most once.
  for (const su of sheetUnits) {
    const key = labelKey(su.label, labelPrefix)
    let cands: number[] = []
    storedKeys.forEach((k, i) => {
      if (!used[i] && k === key) cands.push(i)
    })
    if (cands.length > 1) {
      const bySize = cands.filter((i) => su.sizeSqft !== null && stored[i].sizeSqft === su.sizeSqft)
      if (bySize.length === 1) {
        cands = bySize
      } else {
        warnings.push({
          code: 'ambiguous-label-match',
          message: `Sheet unit "${su.label}" matches ${cands.length} stored layouts with the same label and no size tie-break; added as a new layout`,
        })
        cands = []
      }
    }
    if (cands.length === 1) {
      used[cands[0]] = true
      matchOf.set(cands[0], su)
    } else {
      toAdd.push(su)
    }
  }

  const final: UnitTypeEntry[] = []
  const priceSources: MergeResult['priceSources'] = []
  const matched: string[] = []
  const added: string[] = []
  const keptUnmatched: string[] = []
  const dropped: MergeResult['dropped'] = []

  // U3 + U5, stored entries in their original order.
  stored.forEach((entry, i) => {
    const su = matchOf.get(i)
    if (su) {
      const kept: string[] = []
      const label = partial ? labelPrefix + stripPrefix(entry.label, labelPrefix) : entry.label

      const sizeKept = su.sizeSqft === null && entry.sizeSqft !== null && entry.sizeSqft !== undefined
      const sizeSqft = su.sizeSqft ?? entry.sizeSqft ?? null
      if (sizeKept) kept.push('size')

      const bedKept = su.bedrooms === null && entry.bedrooms !== null && entry.bedrooms !== undefined
      const bedrooms = su.bedrooms ?? entry.bedrooms ?? null
      if (bedKept) kept.push('bedrooms')

      let priceMinRM: number | null
      let priceMaxRM: number | null
      let src: 'sheet' | 'stored' | 'none'
      if (su.nettMinRM !== null && su.nettMaxRM !== null) {
        priceMinRM = su.nettMinRM
        priceMaxRM = su.nettMaxRM
        src = 'sheet'
      } else if (su.soldOut) {
        priceMinRM = null
        priceMaxRM = null
        src = 'sheet'
      } else {
        priceMinRM = entry.priceMinRM ?? null
        priceMaxRM = entry.priceMaxRM ?? null
        const has = priceMinRM !== null || priceMaxRM !== null
        src = has ? 'stored' : 'none'
        if (has) kept.push('price')
      }

      // soldOut: stated by the sheet, or kept only when the row states no availability.
      const statesAvailability =
        su.nettMinRM !== null || su.grossMinRM !== null || su.held.includes('Nett') || su.held.includes('Gross')
      let soldOut = false
      if (su.soldOut) soldOut = true
      else if (!statesAvailability && entry.soldOut === true) {
        soldOut = true
        kept.push('soldOut')
      }

      const merged: UnitTypeEntry = {
        label,
        sizeSqft,
        bedrooms,
        priceMinRM,
        priceMaxRM,
        raw: kept.length > 0 ? `${su.raw} | kept from previous record: ${kept.join(', ')}` : su.raw,
      }
      if (soldOut) merged.soldOut = true
      final.push(merged)
      priceSources.push(src)
      matched.push(label)
      if (kept.length > 0) {
        warnings.push({
          code: 'kept-from-previous',
          message: `Layout "${label}" kept its stored ${kept.join(', ')} because the sheet leaves that blank`,
        })
      }
      return
    }

    // U5. Stored entry with no match.
    if (!partial && isGroupedLabel(entry.label, labelPrefix) && sheetUnits.length > 0 && !keepDrops) {
      const hadPrice = entryHasPrice(entry)
      dropped.push({ label: entry.label, hadPrice })
      warnings.push({
        code: 'unit-dropped',
        message: `Dropped stored grouped layout "${entry.label}"${
          hadPrice ? ` (it carried a price of RM${fmtRM(entry.priceMinRM as number)})` : ' (it carried no price)'
        }`,
      })
      return
    }
    final.push(entry)
    priceSources.push(entryHasPrice(entry) ? 'stored' : 'none')
    keptUnmatched.push(entry.label)
  })

  // U4 + U6. New entries follow, in sheet order.
  for (const su of toAdd) {
    const label = labelPrefix + su.label
    const e: UnitTypeEntry = {
      label,
      sizeSqft: su.sizeSqft,
      bedrooms: su.bedrooms,
      priceMinRM: su.nettMinRM,
      priceMaxRM: su.nettMaxRM,
      raw: su.raw,
    }
    if (su.soldOut) e.soldOut = true
    final.push(e)
    priceSources.push(su.nettMinRM !== null ? 'sheet' : 'none')
    added.push(label)
  }

  return { final, matched, added, keptUnmatched, dropped, warnings, priceSources }
}

// ─── Comparison helpers (R10) ─────────────────────────────────────────────────

/** Milliseconds of a Date or a Firestore-Timestamp-like value, else null. */
function millisOf(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (v !== null && typeof v === 'object') {
    const o = v as { toMillis?: unknown; toDate?: unknown }
    if (typeof o.toMillis === 'function') return (o.toMillis as () => number)()
    if (typeof o.toDate === 'function') return ((o.toDate as () => Date)()).getTime()
  }
  return null
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const am = millisOf(a)
  const bm = millisOf(b)
  if (am !== null || bm !== null) return am === bm
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]))
}

const WORKBOOK_FIELDS: ReadonlySet<string> = new Set<ClientWorkbookField>([
  'unitTypes',
  'sizeMinSqft',
  'sizeMaxSqft',
  'bedrooms',
  'priceValue',
  'priceBand',
  'priceProvenance',
  'priceSource',
  'pricePsfMin',
  'pricePsfMax',
  'tenure',
  'vpStatus',
  'vpDate',
])

const EMBEDDED_FIELDS: ReadonlySet<string> = new Set(['priceValue', 'tenure', 'bedrooms'])

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ─── planProjectPatch (R1-R13) ────────────────────────────────────────────────

/**
 * Decide the patch for one stored project. Applies R1-R13 in order. `existing` is the
 * stored document data; `holds` are the user's hold groups for this project (R9);
 * `importedAt` stamps `clientWorkbookImportedAt` when anything changes.
 */
export function planProjectPatch(args: {
  docId: string
  existing: Readonly<Record<string, unknown>>
  sheet: SheetProject
  holds: readonly string[]
  importedAt: Date
}): ProjectPlan {
  const { docId, existing, sheet, importedAt } = args
  assertHoldGroups(args.holds)
  const holds: readonly HoldGroup[] = args.holds
  const warnings: PlanWarning[] = []
  const planned: Record<string, unknown> = {}

  const storedList: UnitTypeEntry[] = Array.isArray(existing.unitTypes)
    ? (existing.unitTypes as UnitTypeEntry[])
    : []
  const storedPriceValue = numberOr(existing.priceValue, 0)
  let allUnitsSoldOut = false
  let psfOnlyProvenance = false

  // R1 + R2. The unit list, and everything derived from it, only when there are units.
  if ((sheet.unitMode === 'merge' || sheet.unitMode === 'partial') && sheet.units.length > 0) {
    const merge = mergeUnits({
      stored: storedList,
      sheetUnits: sheet.units,
      unitMode: sheet.unitMode,
      labelPrefix: sheet.labelPrefix,
      holds,
    })
    warnings.push(...merge.warnings)
    planned.unitTypes = merge.final

    // R3. Sizes over the available entries (all entries when none is available).
    const idx = merge.final.map((_, i) => i)
    const availableIdx = idx.filter((i) => merge.final[i].soldOut !== true)
    const basis = availableIdx.length > 0 ? availableIdx : idx
    const sizes = basis.map((i) => merge.final[i].sizeSqft).filter((v): v is number => typeof v === 'number')
    if (sizes.length > 0) {
      planned.sizeMinSqft = Math.min(...sizes)
      planned.sizeMaxSqft = Math.max(...sizes)
    }

    // R4. The smallest bedroom count of 1 or more (0 means a studio / unknown).
    const beds = basis
      .map((i) => merge.final[i].bedrooms)
      .filter((v): v is number => typeof v === 'number' && v >= 1)
    if (beds.length > 0) planned.bedrooms = Math.min(...beds)

    allUnitsSoldOut = merge.final.length > 0 && availableIdx.length === 0

    // R5. priceValue: the lowest stated price among the AVAILABLE final entries.
    const unitCands = availableIdx
      .filter((i) => typeof merge.final[i].priceMinRM === 'number')
      .map((i) => ({ value: merge.final[i].priceMinRM as number, src: merge.priceSources[i] }))
    const unitMin = unitCands.length > 0 ? Math.min(...unitCands.map((c) => c.value)) : undefined
    const projectCand = sheet.unitMode === 'partial' && storedPriceValue > 0 ? storedPriceValue : undefined
    const all = [...unitCands.map((c) => c.value), ...(projectCand !== undefined ? [projectCand] : [])]
    if (all.length > 0) {
      const min = Math.min(...all)
      if (min === storedPriceValue) {
        if (projectCand !== undefined && unitMin !== undefined && projectCand < unitMin) {
          warnings.push({
            code: 'partial-coverage-price-kept',
            message: `The sheet covers only part of this project; the stored from-price RM${fmtRM(projectCand)} is lower than the sheet's lowest RM${fmtRM(unitMin)} and is kept`,
          })
        }
      } else if (unitCands.some((c) => c.value === min && c.src === 'sheet')) {
        planned.priceValue = min
        planned.priceBand = priceBandFor(min)
        planned.priceProvenance = 'stated'
        planned.priceSource = CLIENT_WORKBOOK_SOURCE
        if (Object.prototype.hasOwnProperty.call(existing, 'priceSourceChunkId')) {
          planned.priceSourceChunkId = DELETE_FIELD
        }
      } else {
        planned.priceValue = min
        planned.priceBand = priceBandFor(min)
        planned.priceProvenance = 'stated'
        warnings.push({
          code: 'price-from-kept-unit',
          message: `The from-price RM${fmtRM(min)} comes from a stored layout price kept from the previous record, not from the sheet`,
        })
      }
    }

    // R6. psf from the sheet's non-sold-out units.
    const psfs = sheet.units.filter((u) => !u.soldOut && u.psfRM !== null).map((u) => u.psfRM as number)
    if (psfs.length > 0) {
      planned.pricePsfMin = Math.min(...psfs)
      planned.pricePsfMax = Math.max(...psfs)
      if (planned.priceValue === undefined && !(storedPriceValue > 0)) {
        planned.priceProvenance = 'psf_only'
        psfOnlyProvenance = true
      }
    }
  }

  // R7. Tenure: never overwrite a specific "Leasehold YYYY" with the weaker "Leasehold".
  if (sheet.tenure !== null && sheet.tenure !== existing.tenure) {
    if (sheet.tenure === 'Leasehold' && typeof existing.tenure === 'string' && /^Leasehold \d{4}$/.test(existing.tenure)) {
      warnings.push({
        code: 'tenure-kept-specific',
        message: `The sheet says "Leasehold"; the stored "${existing.tenure}" is more specific and is kept`,
      })
    } else {
      planned.tenure = sheet.tenure
    }
  }

  // R8. Completed projects only; expected or ambiguous dates never become vp facts.
  const comp = sheet.completion
  if (comp !== null) {
    const existingVpMs = millisOf(existing.vpDate)
    if (comp.kind === 'completed_year' && comp.year !== null) {
      planned.vpStatus = true
      planned.vpDate = new Date(Date.UTC(comp.year, 0, 1))
      if (existingVpMs !== null && new Date(existingVpMs).getUTCFullYear() !== comp.year) {
        warnings.push({
          code: 'vp-conflict',
          message: `The sheet says completed in ${comp.year}; the stored vpDate is in ${new Date(existingVpMs).getUTCFullYear()}`,
        })
      }
    } else if (comp.kind === 'completed_no_year') {
      planned.vpStatus = true
    } else if (existing.vpStatus === true) {
      warnings.push({
        code: 'vp-conflict',
        message: `The sheet gives an ${comp.kind === 'ambiguous' ? 'ambiguous' : 'expected'} completion date but the stored record says completed; left unchanged`,
      })
    }
  }

  // R9. Holds drop whole groups of keys, one warning per group.
  for (const group of holds) {
    for (const key of HOLD_GROUPS[group]) delete planned[key]
    if (group === 'psf' && psfOnlyProvenance) delete planned.priceProvenance
    warnings.push({ code: 'hold-applied', message: `Hold "${group}" applied: those fields are left as stored` })
  }

  // R11 (first half). Asserted = the workbook fields planned after holds, changed or not.
  const asserted = Object.keys(planned)
    .filter((k) => WORKBOOK_FIELDS.has(k))
    .sort() as ClientWorkbookField[]

  // R10. Keep only keys whose planned value differs from the stored one.
  const patch: Record<string, unknown> = {}
  const changes: PlanChange[] = []
  const record = (field: string, after: unknown): void => {
    patch[field] = after
    changes.push({ field, before: existing[field] ?? null, after })
  }
  for (const [field, after] of Object.entries(planned)) {
    const has = Object.prototype.hasOwnProperty.call(existing, field)
    if (after === DELETE_FIELD) {
      if (has) record(field, after)
    } else if (!deepEqual(after, existing[field])) {
      record(field, after)
    }
  }

  // R11. The marker list is the sorted union of the stored list and the asserted fields.
  const existingList = Array.isArray(existing.clientWorkbookFields)
    ? (existing.clientWorkbookFields as string[])
    : []
  const union = [...new Set<string>([...existingList, ...asserted])].sort()
  if (union.length > 0 && !deepEqual(union, existing.clientWorkbookFields)) {
    record('clientWorkbookFields', union)
  }
  if (changes.length > 0) record('clientWorkbookImportedAt', importedAt)

  // R12. Re-embed only when an embedded field changed. Status is never planned.
  const reembed = changes.some((c) => EMBEDDED_FIELDS.has(c.field))
  if (allUnitsSoldOut) {
    warnings.push({
      code: 'all-units-sold-out',
      message: 'Every listed layout is sold out; the project status is left unchanged for the user to decide',
    })
  }

  // R13. The sheet's area must appear in the stored location text.
  const area = (sheet.area ?? '').trim().toLowerCase()
  const location = typeof existing.locationText === 'string' ? existing.locationText.toLowerCase() : ''
  if (area !== '' && !location.includes(area)) {
    warnings.push({
      code: 'area-not-in-location',
      message: `Sheet area "${sheet.area}" does not appear in the stored location text`,
    })
  }

  changes.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
  return {
    docId,
    inventoryName: sheet.inventoryName,
    patch,
    changes,
    asserted,
    warnings,
    reembed,
    allUnitsSoldOut,
  }
}
