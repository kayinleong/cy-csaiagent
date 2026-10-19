/**
 * client-workbook-run.ts — stage 2 orchestration of the client project info sheet ingest
 * (quick-kayinleong-096, D10 / D11 / D13).
 *
 * Portable: every side effect is injected through `RunDeps`, so the whole dry run / apply /
 * restore flow is unit-tested against an in-memory store. The CLI
 * (`scripts/import-client-workbook.ts`) wires the deps to the Admin SDK only AFTER the env
 * guard has passed. This module never reads an environment variable, never logs, and has
 * no Firestore import of its own.
 *
 * It does NOT re-implement any planner rule: `planProjectPatch` and `mergeUnits` (T1) decide
 * what changes. This module adds the safety envelope around them:
 *
 *   dry run   read every mapped doc, plan, fingerprint, render the report (PII-scanned).
 *   apply     refuse unless `expectPlan === fingerprint`; write a full pre-write backup and
 *             RE-READ it before the first write; write with update() by docId only; re-read
 *             and assert every doc before the next; one audit row per doc, then count the
 *             rows (log() swallows failures); selectively re-embed as a plain number[].
 *   restore   the same envelope, planning the inverse of a backup.
 *
 * The write path has no create path at all: a missing doc makes update() throw.
 * Embeddings are written as plain arrays only. A Firestore vector value on `projects`
 * zeroes every search score (commit ac7cd28), so the vector wrapper is deliberately absent
 * here and a static test keeps it that way.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { UnitTypeEntry } from '@/src/firebase/collections'
import {
  DELETE_FIELD,
  HOLD_GROUPS,
  mergeUnits,
  planProjectPatch,
  type ClientSheet,
  type MergeResult,
  type PlanChange,
  type PlanWarning,
  type ProjectPlan,
  type SheetProject,
} from '@/src/inventory/client-workbook'
import { CLIENT_WORKBOOK_ACTOR, scanForContactDetails } from '@/src/inventory/client-workbook-safety'

// ─── Contract 2: project-mapping.json ─────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/

export const ProjectMappingSchema = z.strictObject({
  meta: z.strictObject({
    schema: z.literal('project-mapping/1'),
    export_exported_at: z.string(),
    workbook_sha256: z.string().regex(HEX64),
  }),
  entries: z.array(
    z.strictObject({
      sheet: z.string(),
      sheetName: z.string().min(1),
      docId: z.string().min(1),
      inventoryName: z.string().min(1),
      matchedBy: z.enum(['exact', 'variant', 'sheet1-alias']),
      unitMode: z.enum(['merge', 'partial', 'none']),
      labelPrefix: z.string(),
    }),
  ),
  skippedNew: z.array(z.string()),
})
export type ProjectMapping = z.infer<typeof ProjectMappingSchema>

/** `review-holds.json`: `{"holds": {"<docId>": ["price", "unitDrops", ...]}}`. */
export type HoldsByDoc = Record<string, string[]>

const HoldsFileSchema = z.strictObject({
  holds: z.record(z.string(), z.array(z.string())),
})

/** Parse an optional `review-holds.json`. An unknown group is an error. */
export function parseHoldsFile(json: unknown): HoldsByDoc {
  const parsed = HoldsFileSchema.parse(json)
  for (const [docId, groups] of Object.entries(parsed.holds)) {
    for (const g of groups) {
      if (!Object.prototype.hasOwnProperty.call(HOLD_GROUPS, g)) {
        throw new Error(`review-holds: docId=${docId} names an unknown hold group "${g}"`)
      }
    }
  }
  return parsed.holds
}

// ─── Dependencies and options ─────────────────────────────────────────────────

export interface DocRead {
  exists: boolean
  data: Record<string, unknown> | undefined
}

export interface AuditEntryLike {
  actorUid: string
  action: string
  targetRef: string
  raw: Record<string, unknown>
}

export interface RunDeps {
  readDoc(docId: string): Promise<DocRead>
  /** update() by docId. Must reject for a missing doc. There is no set/create path. */
  updateDoc(docId: string, patch: Record<string, unknown>): Promise<void>
  /** Produces the store's "delete this field" marker (FieldValue.delete()). */
  deleteSentinel(): unknown
  embed(project: Record<string, unknown>): Promise<number[]>
  /** Must store the vector as a plain array. */
  writeEmbedding(docId: string, vec: number[]): Promise<void>
  audit(entry: AuditEntryLike): Promise<void>
  countAuditRows(actor: string, sinceMs: number): Promise<number>
  writeFile(path: string, content: string): Promise<void> | void
  readFile(path: string): Promise<string> | string
  now(): Date
  sleep(ms: number): Promise<void>
}

export type RunMode = 'dry-run' | 'apply' | 'restore-dry-run' | 'restore-apply'

export interface RunOptions {
  mode: RunMode
  /** The fingerprint the user approved. Required by `apply` and `restore-apply`. */
  expectPlan?: string
  /** Parsed sheet and mapping. Required by the import modes, unused by the restore modes. */
  sheet?: ClientSheet
  mapping?: ProjectMapping
  mappingSha256?: string
  holds?: HoldsByDoc
  backupDir: string
  /** The backup file to restore. Required by the restore modes. */
  restoreFrom?: string
  reportPath: string
  /** 'live' | 'emulator', for the report header. */
  target: string
  delayMs: number
  /** Presence of the Gemini key, confirmed by the caller. Required when any plan re-embeds. */
  hasEmbeddingKey?: boolean
}

export interface RunResult {
  ok: boolean
  mode: RunMode
  fingerprint: string
  docsInPlan: number
  docsChanged: number
  fieldsChanged: number
  written: number
  asserted: number
  /** null when no audit count was taken (dry runs). */
  auditRows: number | null
  reembedPlanned: number
  reembedded: number
  reembedFailed: string[]
  backupPath: string | null
  reportPath: string
  problems: string[]
}

export const REEMBED_RECOVERY_COMMAND =
  'node_modules/.bin/tsx --env-file=.env.local scripts/reembed-projects.ts --apply'

const EMBED_DIM = 1024
const IMPORTED_AT_TOLERANCE_MS = 10 * 60 * 1000
/** Fields whose change alters the project embedding text (R12, plus the derived band). */
const EMBEDDED_FIELDS: ReadonlySet<string> = new Set(['priceValue', 'priceBand', 'tenure', 'bedrooms'])

// ─── Fingerprint ──────────────────────────────────────────────────────────────

export interface FingerprintPlan {
  docId: string
  changes: ReadonlyArray<{ field: string; after: unknown }>
}

function millisOf(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (v !== null && typeof v === 'object') {
    const o = v as { toMillis?: unknown; toDate?: unknown }
    if (typeof o.toMillis === 'function') return (o.toMillis as () => number)()
    if (typeof o.toDate === 'function') return ((o.toDate as () => Date)()).getTime()
  }
  return null
}

/** Canonical form for hashing: dates as ISO, DELETE_FIELD as "$delete", keys sorted. */
function canon(v: unknown): unknown {
  if (v === DELETE_FIELD) return '$delete'
  const ms = millisOf(v)
  if (ms !== null) return new Date(ms).toISOString()
  if (Array.isArray(v)) return v.map(canon)
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = canon(o[k])
    }
    return out
  }
  return v
}

/** Holds as a set per doc: keys sorted, groups sorted and de-duplicated, empties dropped. */
function normalizeHolds(holds: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const docId of Object.keys(holds).sort()) {
    const groups = [...new Set(holds[docId])].sort()
    if (groups.length > 0) out[docId] = groups
  }
  return out
}

/**
 * sha256 hex over `{mappingSha256, holds, plans}`. Plans are sorted by docId and field;
 * `clientWorkbookImportedAt` is excluded (it is the run time); a plan with no remaining
 * change is omitted, so an unchanged doc never moves the fingerprint. Approving a
 * fingerprint therefore approves exactly this diff under exactly these holds.
 */
export function planFingerprint(input: {
  mappingSha256: string
  holds: Readonly<Record<string, readonly string[]>>
  plans: ReadonlyArray<FingerprintPlan>
}): string {
  const plans = input.plans
    .map((p) => ({
      docId: p.docId,
      changes: p.changes
        .filter((c) => c.field !== 'clientWorkbookImportedAt')
        .map((c) => ({ field: c.field, after: canon(c.after) }))
        .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)),
    }))
    .filter((p) => p.changes.length > 0)
    .sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0))
  const body = JSON.stringify({
    mappingSha256: input.mappingSha256,
    holds: normalizeHolds(input.holds),
    plans,
  })
  return createHash('sha256').update(body).digest('hex')
}

// ─── Backup (de)serialisation ─────────────────────────────────────────────────

/** Dates and Timestamp-likes become `{"$ts": ISO}`; undefined values are dropped. */
function toBackupValue(v: unknown): unknown {
  const ms = millisOf(v)
  if (ms !== null) return { $ts: new Date(ms).toISOString() }
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : toBackupValue(x)))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) out[k] = toBackupValue(x)
    }
    return out
  }
  return v
}

function fromBackupValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromBackupValue)
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === '$ts' && typeof o.$ts === 'string') return new Date(o.$ts)
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = fromBackupValue(o[k])
    return out
  }
  return v
}

/** The full doc minus its embedding, serialised for the backup file. */
function toBackupDoc(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k === 'embedding' || v === undefined) continue
    out[k] = toBackupValue(v)
  }
  return out
}

const BackupSchema = z.object({
  meta: z.object({
    fingerprint: z.string(),
    createdAt: z.string(),
    target: z.string(),
    workbook_sha256: z.string(),
    mapping_sha256: z.string(),
    kind: z.enum(['import', 'restore']),
  }),
  docs: z.array(
    z.object({
      docId: z.string().min(1),
      before: z.record(z.string(), z.unknown()),
      plannedFields: z.array(z.string()),
    }),
  ),
})
export type ProjectsBackup = z.infer<typeof BackupSchema>

// ─── Value comparison ─────────────────────────────────────────────────────────

/** Deep equality; a Date and a Timestamp-like compare by milliseconds. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const am = millisOf(a)
  const bm = millisOf(b)
  if (am !== null || bm !== null) return am === bm
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => valuesEqual(x, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && valuesEqual(ao[k], bo[k]))
}

function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

// ─── Internal plan model ──────────────────────────────────────────────────────

interface WritePlan {
  docId: string
  name: string
  /** Changed keys only; a value may be DELETE_FIELD. */
  patch: Record<string, unknown>
  changes: PlanChange[]
  reembed: boolean
  warnings: PlanWarning[]
  holds: string[]
  /** The doc as read at planning time (embedding included; stripped for the backup). */
  before: Record<string, unknown>
  /** The merge view behind a planned unitTypes change, for the report. */
  merge?: MergeResult
  /** Stored unitTypes entries, to tell kept entries from merged ones in the report. */
  storedUnits: readonly unknown[]
}

function sortedChanges(changes: PlanChange[]): PlanChange[] {
  return [...changes].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
}

// ─── Mapping validation and reading ───────────────────────────────────────────

function validateInputs(opts: RunOptions): {
  sheet: ClientSheet
  mapping: ProjectMapping
  mappingSha256: string
} {
  const { sheet, mapping, mappingSha256 } = opts
  if (!sheet || !mapping || !mappingSha256) {
    throw new Error('import modes need a parsed sheet, a mapping and the mapping sha256')
  }
  const problems: string[] = []
  if (mapping.meta.workbook_sha256 !== sheet.meta.workbook_sha256) {
    problems.push('mapping and sheet were built from different workbooks (workbook_sha256 differs)')
  }
  if (mappingSha256 !== sheet.meta.mapping_sha256) {
    problems.push('the mapping file does not match sheet.meta.mapping_sha256 (the mapping changed after the sheet was built)')
  }
  const seen: string[] = []
  for (const p of sheet.projects) {
    if (seen.includes(p.docId)) problems.push(`docId=${p.docId} appears twice in the sheet`)
    seen.push(p.docId)
    const ok = mapping.entries.some(
      (e) =>
        e.docId === p.docId &&
        e.inventoryName === p.inventoryName &&
        e.unitMode === p.unitMode &&
        e.labelPrefix === p.labelPrefix,
    )
    if (!ok) problems.push(`docId=${p.docId} is not in the mapping with the same name, unitMode and labelPrefix`)
  }
  for (const e of mapping.entries) {
    if (!seen.includes(e.docId)) problems.push(`mapping docId=${e.docId} has no project in the sheet`)
  }
  if (problems.length > 0) throw new Error(`refusing to plan:\n - ${[...new Set(problems)].join('\n - ')}`)
  return { sheet, mapping, mappingSha256 }
}

async function readAndCheck(
  deps: RunDeps,
  targets: ReadonlyArray<{ docId: string; name: string }>,
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  const problems: string[] = []
  for (const t of targets) {
    const r = await deps.readDoc(t.docId)
    if (!r.exists || r.data === undefined) {
      problems.push(`docId=${t.docId} ("${t.name}"): document not found`)
      continue
    }
    if (r.data.name !== t.name) {
      problems.push(
        `docId=${t.docId}: stored name "${String(r.data.name)}" differs from the expected "${t.name}"`,
      )
      continue
    }
    out[t.docId] = r.data
  }
  if (problems.length > 0) {
    throw new Error(`refusing to continue, no writes made:\n - ${problems.join('\n - ')}`)
  }
  return out
}

async function planImport(deps: RunDeps, opts: RunOptions, runStart: Date): Promise<WritePlan[]> {
  const { sheet } = validateInputs(opts)
  const holds = opts.holds ?? {}
  const known = sheet.projects.map((p) => p.docId)
  for (const docId of Object.keys(holds)) {
    if (!known.includes(docId)) {
      throw new Error(`review-holds: docId=${docId} is not a project in the sheet`)
    }
  }
  const docs = await readAndCheck(
    deps,
    sheet.projects.map((p) => ({ docId: p.docId, name: p.inventoryName })),
  )
  return sheet.projects.map((p: SheetProject) => {
    const existing = docs[p.docId]
    const projectHolds = holds[p.docId] ?? []
    const plan: ProjectPlan = planProjectPatch({
      docId: p.docId,
      existing,
      sheet: p,
      holds: projectHolds,
      importedAt: runStart,
    })
    const storedUnits = Array.isArray(existing.unitTypes) ? (existing.unitTypes as unknown[]) : []
    let merge: MergeResult | undefined
    if (hasOwn(plan.patch, 'unitTypes')) {
      merge = mergeUnits({
        stored: storedUnits as UnitTypeEntry[],
        sheetUnits: p.units,
        unitMode: p.unitMode,
        labelPrefix: p.labelPrefix,
        holds: projectHolds,
      })
    }
    return {
      docId: p.docId,
      name: p.inventoryName,
      patch: plan.patch,
      changes: plan.changes,
      reembed: plan.reembed,
      warnings: plan.warnings,
      holds: projectHolds,
      before: existing,
      merge,
      storedUnits,
    }
  })
}

async function planRestore(
  deps: RunDeps,
  opts: RunOptions,
): Promise<{ plans: WritePlan[]; backup: ProjectsBackup }> {
  if (!opts.restoreFrom) throw new Error('restore modes need a backup path')
  const backup = BackupSchema.parse(JSON.parse(await deps.readFile(opts.restoreFrom)))
  const names = backup.docs.map((d) => ({
    docId: d.docId,
    name: typeof d.before.name === 'string' ? d.before.name : '',
  }))
  const live = await readAndCheck(deps, names)
  const plans: WritePlan[] = backup.docs.map((d) => {
    const current = live[d.docId]
    const patch: Record<string, unknown> = {}
    const changes: PlanChange[] = []
    for (const field of d.plannedFields) {
      const hadIt = hasOwn(d.before, field)
      const desired = hadIt ? fromBackupValue(d.before[field]) : DELETE_FIELD
      const liveHas = hasOwn(current, field)
      const differs = desired === DELETE_FIELD ? liveHas : !valuesEqual(current[field], desired)
      if (differs) {
        patch[field] = desired
        changes.push({ field, before: current[field] ?? null, after: desired })
      }
    }
    return {
      docId: d.docId,
      name: names.find((n) => n.docId === d.docId)?.name ?? d.docId,
      patch,
      changes: sortedChanges(changes),
      reembed: changes.some((c) => EMBEDDED_FIELDS.has(c.field)),
      warnings: [],
      holds: [],
      before: current,
      storedUnits: [],
    }
  })
  return { plans, backup }
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  const neg = n < 0 ? '-' : ''
  const [int, frac] = String(Math.abs(n)).split('.')
  return neg + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '')
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function summarizeUnits(list: unknown[]): string {
  const priced = list.filter((e) => typeof (e as { priceMinRM?: unknown })?.priceMinRM === 'number').length
  const sold = list.filter((e) => (e as { soldOut?: unknown })?.soldOut === true).length
  return `${list.length} ${list.length === 1 ? 'entry' : 'entries'} (${priced} priced${sold > 0 ? `, ${sold} sold out` : ''})`
}

function fmtCell(field: string, v: unknown): string {
  if (v === DELETE_FIELD) return '(removed)'
  if (v === null || v === undefined) return '(not set)'
  if (field === 'unitTypes' && Array.isArray(v)) return summarizeUnits(v)
  const ms = millisOf(v)
  if (ms !== null) {
    const iso = new Date(ms).toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (typeof v === 'number') return fmtNum(v)
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return esc(v.map((x) => String(x)).join(', '))
  if (typeof v === 'string') return esc(v.length > 80 ? `${v.slice(0, 80)}…` : v)
  return '(object)'
}

function nettRange(e: { priceMinRM?: unknown; priceMaxRM?: unknown }): string {
  if (typeof e.priceMinRM !== 'number') return ''
  return typeof e.priceMaxRM === 'number' && e.priceMaxRM !== e.priceMinRM
    ? `${fmtNum(e.priceMinRM)}–${fmtNum(e.priceMaxRM)}`
    : fmtNum(e.priceMinRM)
}

interface UnitLike {
  label?: unknown
  sizeSqft?: unknown
  bedrooms?: unknown
  priceMinRM?: unknown
  priceMaxRM?: unknown
  soldOut?: unknown
  raw?: unknown
}

function renderUnitTable(p: Pick<ReportDoc, 'merge' | 'storedUnits'>): string[] {
  const m = p.merge
  if (!m) return []
  const lines = [
    '',
    'Unit list after the merge:',
    '',
    '| Status | Label | Size (sqft) | Bedrooms | Nett (RM) | Sold out | Notes |',
    '|---|---|---|---|---|---|---|',
  ]
  const firstAdded = m.final.length - m.added.length
  m.final.forEach((entry, i) => {
    const e = entry as UnitLike
    const status = i >= firstAdded ? 'added' : p.storedUnits.includes(entry) ? 'kept' : 'matched'
    const kept = typeof e.raw === 'string' ? /\| kept from previous record: (.+)$/.exec(e.raw)?.[1] : undefined
    lines.push(
      `| ${status} | ${esc(String(e.label))} | ${typeof e.sizeSqft === 'number' ? fmtNum(e.sizeSqft) : ''} | ${
        typeof e.bedrooms === 'number' ? e.bedrooms : ''
      } | ${nettRange(e)} | ${e.soldOut === true ? 'yes' : ''} | ${kept ? `kept from previous: ${esc(kept)}` : ''} |`,
    )
  })
  for (const d of m.dropped) {
    lines.push(
      `| dropped | ${esc(d.label)} |  |  |  |  | ${d.hadPrice ? 'carried a price' : 'carried no price'} |`,
    )
  }
  return lines
}

const WARNING_ORDER = [
  'unit-dropped',
  'kept-from-previous',
  'ambiguous-label-match',
  'partial-coverage-price-kept',
  'price-from-kept-unit',
  'vp-conflict',
  'area-not-in-location',
  'tenure-kept-specific',
  'all-units-sold-out',
  'hold-applied',
]

export interface ReportDoc {
  docId: string
  name: string
  changes: PlanChange[]
  warnings: PlanWarning[]
  reembed: boolean
  holds: string[]
  merge?: MergeResult
  storedUnits: readonly unknown[]
}

export interface ReportInput {
  title: string
  target: string
  fingerprint: string
  generatedAt: Date
  workbookSha256: string
  mappingSha256: string
  /** Column headings for the per-field tables. */
  columns: { before: string; after: string }
  mapping?: ProjectMapping
  docs: ReportDoc[]
  skippedCount: number
  heldBackCount: number
  conflictCount: number
}

/**
 * Render the reviewable diff as markdown: header, mapping table, a before -> after table per
 * changed project (unitTypes as a merge sub-table), warnings grouped by code and the re-embed
 * list. It never shows a description, location text or a stored `raw` line. The whole text
 * is scanned for contact details and this throws on any hit, before anything is written.
 */
export function renderDryRunReport(input: ReportInput): string {
  const changed = input.docs.filter((d) => d.changes.length > 0)
  const fieldCount = changed.reduce(
    (n, d) => n + d.changes.filter((c) => c.field !== 'clientWorkbookImportedAt').length,
    0,
  )
  const reembed = changed.filter((d) => d.reembed)
  const L: string[] = []
  L.push(`# ${input.title}`, '')
  L.push(`- Target: ${input.target}`)
  L.push(`- Generated: ${input.generatedAt.toISOString()}`)
  L.push(`- Plan fingerprint: \`${input.fingerprint}\``)
  L.push(`- Workbook sha256: \`${input.workbookSha256}\``)
  L.push(`- Mapping sha256: \`${input.mappingSha256}\``)
  L.push('', '## Summary', '')
  L.push(`- Projects in the plan: ${input.docs.length}`)
  L.push(`- Projects with changes: ${changed.length}`)
  L.push(`- Projects unchanged: ${input.docs.length - changed.length}`)
  L.push(`- Field changes (markers excluded): ${fieldCount}`)
  L.push(`- Projects to re-embed: ${reembed.length}`)
  L.push(
    `- Skipped new projects: ${input.skippedCount}; values held back: ${input.heldBackCount}; brochure conflicts: ${input.conflictCount}. See HELD-BACK.md for the plain-language list.`,
  )

  if (input.mapping) {
    L.push('', '## Project mapping', '')
    L.push('| Sheet name | Inventory name | docId | Matched by |', '|---|---|---|---|')
    for (const e of input.mapping.entries) {
      L.push(`| ${esc(e.sheetName)} | ${esc(e.inventoryName)} | ${e.docId} | ${e.matchedBy} |`)
    }
  }

  L.push('', '## Changes by project', '')
  if (changed.length === 0) L.push('No project changes.')
  for (const d of changed) {
    L.push(`### ${esc(d.name)} (\`${d.docId}\`)`, '')
    if (d.holds.length > 0) L.push(`Holds: ${d.holds.join(', ')}`, '')
    L.push(`| Field | ${input.columns.before} | ${input.columns.after} |`, '|---|---|---|')
    for (const c of d.changes) {
      L.push(`| ${c.field} | ${fmtCell(c.field, c.before)} | ${fmtCell(c.field, c.after)} |`)
    }
    L.push(...renderUnitTable(d), '')
  }

  const byCode: Record<string, string[]> = {}
  for (const d of input.docs) {
    for (const w of d.warnings) {
      ;(byCode[w.code] ??= []).push(`- ${esc(d.name)}: ${esc(w.message)}`)
    }
  }
  const codes = [
    ...WARNING_ORDER.filter((c) => byCode[c]),
    ...Object.keys(byCode)
      .filter((c) => !WARNING_ORDER.includes(c))
      .sort(),
  ]
  L.push('## Warnings', '')
  if (codes.length === 0) L.push('None.', '')
  for (const code of codes) {
    L.push(`### ${code} (${byCode[code].length})`, '', ...byCode[code], '')
  }

  L.push('## Re-embed list', '')
  if (reembed.length === 0) L.push('None.')
  for (const d of reembed) L.push(`- ${esc(d.name)} (\`${d.docId}\`)`)
  L.push('')

  const text = L.join('\n')
  const hits = scanForContactDetails(text)
  if (hits.length > 0) {
    throw new Error(`refusing to write the report: it would contain contact details (${hits.join(', ')})`)
  }
  return text
}

interface ApplyOutcome {
  status: string
  written: Array<{ docId: string; name: string; fields: string[] }>
  asserted: number
  auditRows: number | null
  backupPath: string | null
  reembedPlanned: number
  reembedded: number
  reembedFailed: string[]
  problems: string[]
}

function renderApplyResults(o: ApplyOutcome): string {
  const L: string[] = ['## Apply results', '', `- Status: ${o.status}`]
  L.push(`- Documents written: ${o.written.length}`)
  L.push(`- Re-read assertions passed: ${o.asserted}`)
  L.push(`- Audit rows counted: ${o.auditRows === null ? 'not counted' : o.auditRows}`)
  L.push(`- Backup: ${o.backupPath ?? 'none written'}`)
  L.push(`- Re-embeds: ${o.reembedded} of ${o.reembedPlanned} done, ${o.reembedFailed.length} failed`)
  if (o.problems.length > 0) {
    L.push('', '### Problems', '', ...o.problems.map((p) => `- ${esc(p)}`))
  }
  if (o.written.length > 0) {
    L.push('', '### Documents written', '', '| docId | Name | Fields |', '|---|---|---|')
    for (const w of o.written) L.push(`| ${w.docId} | ${esc(w.name)} | ${w.fields.join(', ')} |`)
  }
  L.push('')
  const text = L.join('\n')
  const hits = scanForContactDetails(text)
  if (hits.length > 0) throw new Error(`refusing to write the report: contact details (${hits.join(', ')})`)
  return text
}

// ─── Apply envelope (shared by import and restore) ────────────────────────────

function isFiniteVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === EMBED_DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function mapPatch(deps: RunDeps, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === DELETE_FIELD ? deps.deleteSentinel() : v
  return out
}

/** Which planned changes the re-read does not show. Field names only, never values. */
function mismatches(
  data: Record<string, unknown>,
  plan: WritePlan,
  runStartMs: number,
  importedAtIsRunTime: boolean,
): string[] {
  const bad: string[] = []
  for (const c of plan.changes) {
    if (c.after === DELETE_FIELD) {
      if (hasOwn(data, c.field)) bad.push(c.field)
    } else if (c.field === 'clientWorkbookImportedAt' && importedAtIsRunTime) {
      const ms = millisOf(data[c.field])
      if (ms === null || Math.abs(ms - runStartMs) > IMPORTED_AT_TOLERANCE_MS) bad.push(c.field)
    } else if (!valuesEqual(data[c.field], c.after)) {
      bad.push(c.field)
    }
  }
  return bad
}

async function applyPlans(args: {
  deps: RunDeps
  opts: RunOptions
  plans: WritePlan[]
  fingerprint: string
  kind: 'import' | 'restore'
  runStart: Date
  diffText: string
  reportBase: Omit<RunResult, 'ok' | 'written' | 'asserted' | 'auditRows' | 'reembedded' | 'reembedFailed' | 'backupPath' | 'problems'>
  meta: { workbook_sha256: string; mapping_sha256: string }
}): Promise<RunResult> {
  const { deps, opts, plans, fingerprint, kind, runStart, diffText, reportBase, meta } = args
  const runStartMs = runStart.getTime()
  const changed = plans.filter((p) => p.changes.length > 0)
  const reembedPlans = changed.filter((p) => p.reembed)
  const importedAtIsRunTime = kind === 'import'
  const action = kind === 'import' ? 'client_workbook_import' : 'client_workbook_restore'

  const outcome: ApplyOutcome = {
    status: 'IN PROGRESS',
    written: [],
    asserted: 0,
    auditRows: null,
    backupPath: null,
    reembedPlanned: reembedPlans.length,
    reembedded: 0,
    reembedFailed: [],
    problems: [],
  }
  const finish = async (status: string): Promise<RunResult> => {
    outcome.status = status
    await deps.writeFile(opts.reportPath, diffText + '\n' + renderApplyResults(outcome))
    return {
      ...reportBase,
      ok: outcome.problems.length === 0,
      written: outcome.written.length,
      asserted: outcome.asserted,
      auditRows: outcome.auditRows,
      reembedded: outcome.reembedded,
      reembedFailed: outcome.reembedFailed,
      backupPath: outcome.backupPath,
      problems: outcome.problems,
    }
  }
  const abort = async (message: string): Promise<never> => {
    outcome.problems.push(message)
    const recovery = outcome.backupPath
      ? ` Backup: ${outcome.backupPath}. Restore with: node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts --restore ${outcome.backupPath}`
      : ''
    try {
      await finish('ABORTED')
    } catch {
      // The report is best effort here; the thrown error below carries the facts.
    }
    throw new Error(`${message}. Written before the stop: ${outcome.written.length} doc(s).${recovery}`)
  }

  // (d) The user approved a fingerprint. Refuse unless it is exactly this plan.
  if (opts.expectPlan === undefined || opts.expectPlan !== fingerprint) {
    throw new Error(
      `refusing to apply: --expect-plan ${opts.expectPlan ? 'does not match' : 'is required; the current plan fingerprint is'} ${
        opts.expectPlan ? `the current plan (${fingerprint})` : fingerprint
      }`,
    )
  }
  if (reembedPlans.length > 0 && opts.hasEmbeddingKey !== true) {
    throw new Error(
      `refusing to apply: ${reembedPlans.length} doc(s) need a re-embed but the embedding key is not set`,
    )
  }
  if (changed.length === 0) return finish('NOTHING TO WRITE')

  // (e) Full backup first, then prove it is readable before the first write.
  const stamp = runStart.toISOString().replace(/[:.]/g, '-')
  const backupPath = `${opts.backupDir}/${stamp}${kind === 'restore' ? '-restore' : ''}/projects-backup.json`
  // Never overwrite an existing backup: it is the only way back.
  let backupExists = true
  try {
    await deps.readFile(backupPath)
  } catch {
    backupExists = false
  }
  if (backupExists) throw new Error(`refusing to write: a backup already exists at ${backupPath}`)
  const backup: ProjectsBackup = {
    meta: {
      fingerprint,
      createdAt: runStart.toISOString(),
      target: opts.target,
      workbook_sha256: meta.workbook_sha256,
      mapping_sha256: meta.mapping_sha256,
      kind,
    },
    docs: changed.map((p) => ({
      docId: p.docId,
      before: toBackupDoc(p.before),
      plannedFields: Object.keys(p.patch),
    })),
  }
  await deps.writeFile(backupPath, JSON.stringify(backup, null, 2) + '\n')
  const reread = BackupSchema.parse(JSON.parse(await deps.readFile(backupPath)))
  if (
    reread.docs.length !== changed.length ||
    reread.docs.some((d, i) => d.docId !== changed[i].docId || hasOwn(d.before, 'embedding')) ||
    JSON.stringify(reread) !== JSON.stringify(backup)
  ) {
    throw new Error(`refusing to write: the backup at ${backupPath} did not read back intact`)
  }
  outcome.backupPath = backupPath

  // (f) + (g) + audit. Sequential, update() by docId only. Re-read and assert each doc
  // before touching the next, so a bad write stops the run after at most one doc.
  for (const p of changed) {
    try {
      await deps.updateDoc(p.docId, mapPatch(deps, p.patch))
    } catch (e) {
      return abort(`docId=${p.docId}: update failed (${errText(e)})`)
    }
    outcome.written.push({ docId: p.docId, name: p.name, fields: p.changes.map((c) => c.field) })
    await deps.audit({
      actorUid: CLIENT_WORKBOOK_ACTOR,
      action,
      targetRef: `projects/${p.docId}`,
      raw: { docId: p.docId, fields: p.changes.map((c) => c.field).join(','), fingerprint },
    })
    const r = await deps.readDoc(p.docId)
    const bad = r.exists && r.data ? mismatches(r.data, p, runStartMs, importedAtIsRunTime) : ['(document missing)']
    if (bad.length > 0) {
      return abort(`docId=${p.docId}: re-read does not match the plan for field(s) ${bad.join(', ')}`)
    }
    outcome.asserted++
  }

  // (h) log() swallows failures, so count the rows it actually wrote.
  outcome.auditRows = await deps.countAuditRows(CLIENT_WORKBOOK_ACTOR, runStartMs)
  if (outcome.auditRows !== outcome.written.length) {
    outcome.problems.push(
      `audit rows counted ${outcome.auditRows}, expected ${outcome.written.length}: an audit write was swallowed`,
    )
  }

  // (i) Selective re-embed as a plain number[]. Keep going on failure.
  for (const p of reembedPlans) {
    try {
      const doc = await deps.readDoc(p.docId)
      if (!doc.exists || !doc.data) throw new Error('document missing')
      const vec = await deps.embed(doc.data)
      if (!isFiniteVector(vec)) {
        throw new Error(`vector must be a plain array of ${EMBED_DIM} finite numbers`)
      }
      await deps.writeEmbedding(p.docId, vec)
      const back = await deps.readDoc(p.docId)
      const stored = back.data?.embedding
      if (!Array.isArray(stored) || stored.length !== EMBED_DIM) {
        throw new Error('stored embedding is not a plain array of the right length')
      }
      outcome.reembedded++
    } catch (e) {
      outcome.reembedFailed.push(p.docId)
      outcome.problems.push(`docId=${p.docId}: re-embed failed (${errText(e)})`)
    }
    await deps.sleep(opts.delayMs)
  }
  if (outcome.reembedFailed.length > 0) {
    outcome.problems.push(
      `re-embed failed for ${outcome.reembedFailed.length} doc(s): ${outcome.reembedFailed.join(', ')}. Recover with: ${REEMBED_RECOVERY_COMMAND}`,
    )
  }

  // (j)
  return finish(outcome.problems.length === 0 ? 'COMPLETE' : 'COMPLETE WITH PROBLEMS')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run one mode of the import. Dry runs write only the report. `apply` and `restore-apply`
 * are gated by `expectPlan`. A refusal or a failed assertion throws; a swallowed audit
 * write or a failed re-embed returns `ok: false` after the report is written.
 */
export async function runClientWorkbookImport(deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const runStart = deps.now()
  const restoring = opts.mode === 'restore-dry-run' || opts.mode === 'restore-apply'
  const applying = opts.mode === 'apply' || opts.mode === 'restore-apply'

  let plans: WritePlan[]
  let fingerprint: string
  let meta: { workbook_sha256: string; mapping_sha256: string }
  let mappingSha256: string
  let mapping: ProjectMapping | undefined
  let counts = { skipped: 0, heldBack: 0, conflicts: 0 }

  if (restoring) {
    const r = await planRestore(deps, opts)
    plans = r.plans
    meta = { workbook_sha256: r.backup.meta.workbook_sha256, mapping_sha256: r.backup.meta.mapping_sha256 }
    mappingSha256 = r.backup.meta.mapping_sha256
    fingerprint = planFingerprint({ mappingSha256, holds: {}, plans })
  } else {
    const v = validateInputs(opts)
    plans = await planImport(deps, opts, runStart)
    mappingSha256 = v.mappingSha256
    mapping = v.mapping
    meta = { workbook_sha256: v.sheet.meta.workbook_sha256, mapping_sha256: v.mappingSha256 }
    counts = {
      skipped: v.sheet.skipped.length,
      heldBack: v.sheet.heldBack.length,
      conflicts: v.sheet.conflicts.length,
    }
    fingerprint = planFingerprint({ mappingSha256, holds: opts.holds ?? {}, plans })
  }

  const changed = plans.filter((p) => p.changes.length > 0)
  const fieldsChanged = changed.reduce(
    (n, p) => n + p.changes.filter((c) => c.field !== 'clientWorkbookImportedAt').length,
    0,
  )
  const titles: Record<RunMode, string> = {
    'dry-run': 'Client workbook import: dry run',
    apply: 'Client workbook import: apply report',
    'restore-dry-run': 'Client workbook restore: dry run',
    'restore-apply': 'Client workbook restore: apply report',
  }
  const diffText = renderDryRunReport({
    title: titles[opts.mode],
    target: opts.target,
    fingerprint,
    generatedAt: runStart,
    workbookSha256: meta.workbook_sha256,
    mappingSha256,
    columns: restoring ? { before: 'Current', after: 'Restored' } : { before: 'Before', after: 'After' },
    mapping,
    docs: plans,
    skippedCount: counts.skipped,
    heldBackCount: counts.heldBack,
    conflictCount: counts.conflicts,
  })

  const base = {
    mode: opts.mode,
    fingerprint,
    docsInPlan: plans.length,
    docsChanged: changed.length,
    fieldsChanged,
    reembedPlanned: changed.filter((p) => p.reembed).length,
    reportPath: opts.reportPath,
  }

  if (!applying) {
    await deps.writeFile(opts.reportPath, diffText)
    return {
      ...base,
      ok: true,
      written: 0,
      asserted: 0,
      auditRows: null,
      reembedded: 0,
      reembedFailed: [],
      backupPath: null,
      problems: [],
    }
  }

  return applyPlans({
    deps,
    opts,
    plans,
    fingerprint,
    kind: restoring ? 'restore' : 'import',
    runStart,
    diffText,
    reportBase: base,
    meta,
  })
}

// ─── Firestore wiring (used by the CLI and by the emulator test) ──────────────

/** The slice of the Admin Firestore API the runner needs. Structural, so no SDK import. */
export interface FirestoreLike {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
      update(patch: Record<string, unknown>): Promise<unknown>
    }
    where(
      field: string,
      op: '==',
      value: unknown,
    ): { get(): Promise<{ docs: Array<{ data(): Record<string, unknown> }> }> }
  }
}

/**
 * Build the production `RunDeps` over a Firestore handle. Reads and writes use the raw
 * `projects` collection (no converter), exactly like the backfill scripts. Writes are
 * `update()` only; the embedding is written as the plain array it was given.
 */
export function buildFirestoreDeps(io: {
  db: FirestoreLike
  deleteSentinel: () => unknown
  audit: RunDeps['audit']
  embed: RunDeps['embed']
  writeFile: RunDeps['writeFile']
  readFile: RunDeps['readFile']
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}): RunDeps {
  const projects = () => io.db.collection('projects')
  return {
    readDoc: async (docId) => {
      const snap = await projects().doc(docId).get()
      return { exists: snap.exists, data: snap.data() }
    },
    updateDoc: async (docId, patch) => {
      await projects().doc(docId).update(patch)
    },
    deleteSentinel: io.deleteSentinel,
    embed: io.embed,
    writeEmbedding: async (docId, vec) => {
      await projects().doc(docId).update({ embedding: vec })
    },
    audit: io.audit,
    countAuditRows: async (actor, sinceMs) => {
      const snap = await io.db.collection('auditLogs').where('actorUid', '==', actor).get()
      return snap.docs.filter((d) => {
        const ts = d.data().ts
        const ms = typeof ts === 'number' ? ts : millisOf(ts)
        return ms !== null && ms >= sinceMs
      }).length
    },
    writeFile: io.writeFile,
    readFile: io.readFile,
    now: io.now ?? (() => new Date()),
    sleep: io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  }
}
