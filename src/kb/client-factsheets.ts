/**
 * client-factsheets.ts — stage 3 of the client project info sheet ingest
 * (quick-kayinleong-096, D1): put one clean fact sheet per project into the finder KB,
 * idempotently, through the EXISTING createDoc / updateDoc -> processBatch path.
 *
 * PORTABLE: all I/O is injected. This module imports only zod, node:crypto and the
 * import-free safety kernel, so it needs no Firebase mock in tests and cannot initialise
 * the Admin SDK by being loaded. `scripts/ingest-client-factsheets.ts` wires the real deps
 * AFTER the env guard has passed.
 *
 * IDEMPOTENCY IDENTITY. A fact sheet is identified by its TITLE
 * ("{inventoryName} — D2 project facts (client sheet)") within pillar 'finder', and
 * versioned by the sha256 of its exact UTF-8 bytes. The pipeline's `shardJob` stores that
 * same sha256 as `fileHash` on the ingestion job (pipeline.ts:118), so "does the current doc
 * already hold this content" is answered by reading the doc's job hashes:
 *
 *   no live doc with the title            -> create
 *   one live doc, a job hash == sha256    -> unchanged
 *   one live doc, no job hash == sha256   -> update (new version, supersedes that id)
 *   more than one live doc, or a live doc that holds no published chunks -> refuse
 *
 * "Live" means not `superseded`. Content is passed through VERBATIM (no trim, no newline
 * normalisation) because the hash identity depends on the exact bytes.
 *
 * Nothing here ever returns, logs or reports fact-sheet CONTENT: only titles, actions,
 * counts, char lengths, ids, hashes and scanner class names.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  CLIENT_FACTSHEET_ACTOR,
  scanForContactDetails,
} from '@/src/inventory/client-workbook-safety'

// ─── Contract 3: the manifest ────────────────────────────────────────────────

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

export const FactSheetManifestSchema = z.object({
  meta: z.object({
    schema: z.literal('factsheets/1'),
    source_label: z.string().min(1),
    workbook_sha256: Sha256Hex,
  }),
  sheets: z
    .array(
      z.object({
        file: z.string().min(1),
        docId: z.string().min(1),
        inventoryName: z.string().min(1),
        title: z.string().min(1),
        category: z.string().min(1),
        sha256: Sha256Hex,
      }),
    )
    .min(1),
})

export type FactSheetManifest = z.infer<typeof FactSheetManifestSchema>

/** A manifest entry whose bytes have been read and verified. */
export interface LoadedFactSheet {
  file: string
  docId: string
  inventoryName: string
  title: string
  category: string
  /** sha256 of the exact UTF-8 bytes; equals the pipeline's `fileHash` for this content. */
  sha256: string
  /** The file content, verbatim. Never logged. */
  content: string
  chars: number
}

/** Maximum fact-sheet size in characters (well inside one KB document's chunk budget). */
export const FACTSHEET_MAX_CHARS = 20_000

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export class FactSheetLoadError extends Error {
  readonly failures: ReadonlyArray<{ label: string; reasons: string[] }>
  constructor(failures: ReadonlyArray<{ label: string; reasons: string[] }>) {
    super(
      `fact-sheet load refused (${failures.length} sheet(s)); nothing was ingested:\n` +
        failures.map((f) => `  - ${f.label}: ${f.reasons.join(', ')}`).join('\n'),
    )
    this.name = 'FactSheetLoadError'
    this.failures = failures
  }
}

/** A manifest-relative path may not be absolute and may not climb out of the claim dir. */
function isSafeRelativePath(file: string): boolean {
  if (file.startsWith('/') || file.startsWith('\\') || /^[A-Za-z]:/.test(file)) return false
  if (file.includes('\0')) return false
  return !file.split(/[\\/]/).some((seg) => seg === '..')
}

/** A label that names the sheet by title only, and never echoes a title that scans dirty. */
function sheetLabel(index: number, title: string): string {
  return scanForContactDetails(title).length === 0 ? `sheet[${index}] "${title}"` : `sheet[${index}]`
}

/**
 * Parse the manifest, read every sheet and verify it. Refuses the WHOLE run (throws
 * `FactSheetLoadError`, naming titles and reason codes only) when any sheet fails:
 *
 *   sha256 of the bytes == manifest sha256       title == "{inventoryName} — D2 project facts (client sheet)"
 *   category == inventoryName                    content starts "# {inventoryName}: D2 project facts"
 *   the "Source: {label}." line is present       at most 20,000 characters
 *   zero contact-detail scanner hits             valid UTF-8, safe relative path, unique title and docId
 */
export function loadFactSheets(
  manifest: unknown,
  readFile: (relativePath: string) => Uint8Array,
): LoadedFactSheet[] {
  const parsed = FactSheetManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))]
    throw new Error(`fact-sheet manifest invalid; offending paths: ${paths.join(', ')}`)
  }
  const { meta, sheets } = parsed.data
  const sourceLine = `Source: ${meta.source_label}.`

  const failures: Array<{ label: string; reasons: string[] }> = []
  const loaded: LoadedFactSheet[] = []
  const seenTitles = new Set<string>()
  const seenDocIds = new Set<string>()

  sheets.forEach((entry, index) => {
    const reasons: string[] = []
    const label = sheetLabel(index, entry.title)

    if (seenTitles.has(entry.title)) reasons.push('duplicate-title')
    seenTitles.add(entry.title)
    if (seenDocIds.has(entry.docId)) reasons.push('duplicate-docId')
    seenDocIds.add(entry.docId)

    if (entry.title !== `${entry.inventoryName} — D2 project facts (client sheet)`) {
      reasons.push('title-mismatch')
    }
    if (entry.category !== entry.inventoryName) reasons.push('category-mismatch')
    const titleHits = scanForContactDetails(entry.title)
    if (titleHits.length > 0) reasons.push(`title-contact-details(${titleHits.join('+')})`)

    if (!isSafeRelativePath(entry.file)) {
      reasons.push('unsafe-file-path')
    } else {
      let bytes: Uint8Array | undefined
      try {
        bytes = readFile(entry.file)
      } catch {
        reasons.push('unreadable')
      }
      if (bytes !== undefined) {
        const actual = sha256Hex(bytes)
        if (actual !== entry.sha256) reasons.push('sha256-mismatch')
        const content = Buffer.from(bytes).toString('utf8')
        // The pipeline hashes Buffer.from(content, 'utf-8'); the identity only holds when
        // the file survives that round trip byte for byte.
        if (sha256Hex(Buffer.from(content, 'utf-8')) !== actual) reasons.push('not-valid-utf8')
        if (!content.startsWith(`# ${entry.inventoryName}: D2 project facts`)) {
          reasons.push('heading-mismatch')
        }
        if (!content.split('\n').includes(sourceLine)) reasons.push('source-line-missing')
        if (content.length > FACTSHEET_MAX_CHARS) reasons.push('too-long')
        const hits = scanForContactDetails(content)
        if (hits.length > 0) reasons.push(`contact-details(${hits.join('+')})`)

        if (reasons.length === 0) {
          loaded.push({
            file: entry.file,
            docId: entry.docId,
            inventoryName: entry.inventoryName,
            title: entry.title,
            category: entry.category,
            sha256: actual,
            content,
            chars: content.length,
          })
        }
      }
    }

    if (reasons.length > 0) failures.push({ label, reasons })
  })

  if (failures.length > 0) throw new FactSheetLoadError(failures)
  return loaded
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export type PlanAction = 'create' | 'update' | 'unchanged' | 'refuse'

export interface ExistingDoc {
  id: string
  pillar: string
  status: string
}

export interface PlanDeps {
  /** Every kbDoc with exactly this title, any pillar, any status. */
  findDocsByTitle(title: string): Promise<ExistingDoc[]>
  /** The `fileHash` of every ingestion job bound to this doc. */
  jobHashesForDoc(docId: string): Promise<string[]>
  /**
   * Optional safety net used by the planner: a doc whose content hash matches but that holds
   * no published chunk (an interrupted earlier ingest, or an unpublished doc) is `refuse`,
   * never `unchanged`, because retrieval would still find nothing.
   */
  countPublishedChunks?(docId: string): Promise<number>
}

export interface PlannedSheet {
  title: string
  action: PlanAction
  sha256: string
  chars: number
  category: string
  /** The live doc this plan acts on (update / unchanged), when there is exactly one. */
  existingDocId?: string
  /** Reason code for `refuse`. */
  reason?: string
}

export async function planFactSheets(
  sheets: ReadonlyArray<LoadedFactSheet>,
  deps: PlanDeps,
): Promise<PlannedSheet[]> {
  const plan: PlannedSheet[] = []
  for (const sheet of sheets) {
    const base = {
      title: sheet.title,
      sha256: sheet.sha256,
      chars: sheet.chars,
      category: sheet.category,
    }
    const live = (await deps.findDocsByTitle(sheet.title)).filter(
      (d) => d.pillar === 'finder' && d.status !== 'superseded',
    )
    if (live.length === 0) {
      plan.push({ ...base, action: 'create' })
      continue
    }
    if (live.length > 1) {
      plan.push({ ...base, action: 'refuse', reason: `${live.length}-live-docs-share-the-title` })
      continue
    }
    const doc = live[0]
    const hashes = await deps.jobHashesForDoc(doc.id)
    if (hashes.includes(sheet.sha256)) {
      if (deps.countPublishedChunks && (await deps.countPublishedChunks(doc.id)) < 1) {
        plan.push({ ...base, action: 'refuse', existingDocId: doc.id, reason: 'matching-doc-has-no-published-chunks' })
      } else {
        plan.push({ ...base, action: 'unchanged', existingDocId: doc.id })
      }
    } else {
      plan.push({ ...base, action: 'update', existingDocId: doc.id })
    }
  }
  return plan
}

/**
 * sha256 over the canonical `[{title, action, sha256}]` list, sorted by title (code-point
 * order), so the approval is bound to exactly which sheets will be created or updated and
 * to the exact bytes. Reordering the manifest cannot change it; changing any byte can.
 */
export function factSheetFingerprint(plan: ReadonlyArray<PlannedSheet>): string {
  const rows = plan
    .map((p) => ({ title: p.title, action: p.action, sha256: p.sha256 }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
  return sha256Hex(JSON.stringify(rows))
}

export function countActions(plan: ReadonlyArray<PlannedSheet>): Record<PlanAction, number> {
  const counts: Record<PlanAction, number> = { create: 0, update: 0, unchanged: 0, refuse: 0 }
  for (const p of plan) counts[p.action] += 1
  return counts
}

// ─── Report ──────────────────────────────────────────────────────────────────

export interface SheetOutcome {
  title: string
  action: PlanAction
  /** The doc holding the new content (create / update). */
  docId?: string
  /** The doc that was superseded (update). */
  supersededDocId?: string
  publishedChunks?: number
}

export interface ReportInput {
  mode: 'dry-run' | 'apply'
  target: string
  fingerprint: string
  generatedAt: string
  sourceLabel: string
  workbookSha256: string
  plan: ReadonlyArray<PlannedSheet>
  /** Apply only. */
  outcomes?: ReadonlyArray<SheetOutcome>
  /** Apply only: set when the run stopped early. */
  failure?: string
  /** Apply only. */
  auditRows?: { expected: number; found: number }
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/**
 * Render the report. It shows a title | action | chars table and counts, never content, and
 * is itself scanned: a contact-detail hit refuses to render rather than write a dirty file.
 */
export function renderFactSheetReport(input: ReportInput): string {
  const counts = countActions(input.plan)
  const lines: string[] = []
  lines.push(input.mode === 'dry-run' ? '# Client fact sheets: dry run' : '# Client fact sheets: apply')
  lines.push('')
  lines.push(`- Target: ${input.target}`)
  lines.push(`- Generated: ${input.generatedAt}`)
  lines.push(`- FACTSHEETS fingerprint: \`${input.fingerprint}\``)
  lines.push(`- Workbook sha256: \`${input.workbookSha256}\``)
  lines.push(`- Source: ${input.sourceLabel}`)
  lines.push(`- Actor: ${CLIENT_FACTSHEET_ACTOR}`)
  lines.push('')
  lines.push('## Counts')
  lines.push('')
  lines.push(`create ${counts.create}, update ${counts.update}, unchanged ${counts.unchanged}, refuse ${counts.refuse}, total ${input.plan.length}`)
  lines.push('')

  if (input.failure !== undefined) {
    lines.push('## FAILED')
    lines.push('')
    lines.push(input.failure)
    lines.push('')
  }
  if (input.auditRows) {
    lines.push('## Audit rows')
    lines.push('')
    lines.push(`expected ${input.auditRows.expected}, found ${input.auditRows.found}`)
    lines.push('')
  }

  lines.push('## Sheets')
  lines.push('')
  if (input.outcomes) {
    const byTitle = new Map(input.outcomes.map((o) => [o.title, o]))
    lines.push('| Title | Action | Chars | Doc | Superseded doc | Published chunks |')
    lines.push('|---|---|---|---|---|---|')
    for (const p of input.plan) {
      const o = byTitle.get(p.title)
      lines.push(
        `| ${cell(p.title)} | ${p.action} | ${p.chars} | ${o?.docId ?? ''} | ${o?.supersededDocId ?? ''} | ${o?.publishedChunks ?? ''} |`,
      )
    }
  } else {
    lines.push('| Title | Action | Chars |')
    lines.push('|---|---|---|')
    for (const p of input.plan) lines.push(`| ${cell(p.title)} | ${p.action} | ${p.chars} |`)
  }
  lines.push('')

  const refused = input.plan.filter((p) => p.action === 'refuse')
  if (refused.length > 0) {
    lines.push('## Refused')
    lines.push('')
    for (const p of refused) lines.push(`- ${cell(p.title)}: ${p.reason ?? 'unspecified'}`)
    lines.push('')
  }

  const text = lines.join('\n')
  const hits = scanForContactDetails(text)
  if (hits.length > 0) {
    throw new Error(`fact-sheet report refused: contact-detail scan hit (${hits.join(', ')})`)
  }
  return text
}

// ─── Run ─────────────────────────────────────────────────────────────────────

/** The synthetic admin user (precedent: scripts/ingest-kb-seed.ts:101). */
export const FACTSHEET_USER = { uid: CLIENT_FACTSHEET_ACTOR, role: 'admin', tenantId: 'd2' } as const

export interface IngestResult {
  docId: string
  newDocId?: string
  jobId?: string
  total?: number
  remaining?: number
}

export interface RunDeps extends PlanDeps {
  countPublishedChunks(docId: string): Promise<number>
  createDoc(
    user: typeof FACTSHEET_USER,
    input: { title: string; content: string; lang: 'en'; pillar: 'finder'; category: string },
  ): Promise<{ docId: string; jobId: string; total: number; remaining: number }>
  updateDoc(user: typeof FACTSHEET_USER, docId: string, patch: { content: string }): Promise<IngestResult>
  processBatch(jobId: string, limit: number): Promise<{ remaining: number }>
  docStatus(docId: string): Promise<string | null>
  audit(entry: {
    actorUid: string
    action: string
    targetRef: string
    raw: Record<string, unknown>
  }): Promise<void>
  /** Rows written by this actor with action 'client_factsheet_ingest'. */
  countAuditRows(): Promise<number>
  writeFile(path: string, text: string): void | Promise<void>
  now(): Date
  log?(line: string): void
}

export interface RunOptions {
  mode: 'dry-run' | 'apply'
  sheets: ReadonlyArray<LoadedFactSheet>
  meta: { source_label: string; workbook_sha256: string }
  /** 'live' | 'emulator' (from assertSafeTarget). */
  target: string
  reportPath: string
  /** Apply only: the FACTSHEETS fingerprint the user approved. */
  expectPlan?: string
  /** Apply only: the caller confirmed the embedding key is present (never its value). */
  embeddingKeyPresent?: boolean
  batchSize?: number
}

export interface RunResult {
  mode: 'dry-run' | 'apply'
  fingerprint: string
  plan: PlannedSheet[]
  counts: Record<PlanAction, number>
  outcomes: SheetOutcome[]
  reportPath: string
  auditRows?: { expected: number; found: number }
}

export class FactSheetApplyRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FactSheetApplyRefused'
  }
}

const DEFAULT_BATCH = 5

/** Drive a job to completion exactly as the browser poll loop does; no progress is an error. */
async function driveJob(
  deps: Pick<RunDeps, 'processBatch'>,
  jobId: string,
  startRemaining: number,
  batchSize: number,
): Promise<void> {
  let remaining = startRemaining
  while (remaining > 0) {
    const batch = await deps.processBatch(jobId, batchSize)
    if (batch.remaining >= remaining) {
      throw new Error(`processBatch made no progress on job "${jobId}" (remaining stayed at ${remaining})`)
    }
    remaining = batch.remaining
  }
}

export async function runFactSheetIngest(deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const say = (line: string): void => deps.log?.(line)
  const batchSize = opts.batchSize ?? DEFAULT_BATCH

  const plan = await planFactSheets(opts.sheets, deps)
  const fingerprint = factSheetFingerprint(plan)
  const counts = countActions(plan)
  const reportBase = {
    mode: opts.mode,
    target: opts.target,
    fingerprint,
    generatedAt: deps.now().toISOString(),
    sourceLabel: opts.meta.source_label,
    workbookSha256: opts.meta.workbook_sha256,
    plan,
  } as const

  // ── Dry run: read-only. No createDoc, updateDoc, processBatch or audit call. ──
  if (opts.mode === 'dry-run') {
    await deps.writeFile(opts.reportPath, renderFactSheetReport(reportBase))
    return { mode: 'dry-run', fingerprint, plan, counts, outcomes: [], reportPath: opts.reportPath }
  }

  // ── Apply: every refusal happens before the first write. ──
  if (opts.expectPlan === undefined || opts.expectPlan !== fingerprint) {
    throw new FactSheetApplyRefused(
      'apply refused: --expect-plan is missing or does not match the live plan; re-run the dry run and approve its fingerprint',
    )
  }
  if (counts.refuse > 0) {
    throw new FactSheetApplyRefused(
      `apply refused: ${counts.refuse} sheet(s) are refused by the plan: ` +
        plan.filter((p) => p.action === 'refuse').map((p) => `"${p.title}" (${p.reason})`).join('; '),
    )
  }
  const work = plan.filter((p) => p.action === 'create' || p.action === 'update')
  if (work.length > 0 && opts.embeddingKeyPresent !== true) {
    throw new FactSheetApplyRefused('apply refused: the embedding key is not confirmed present')
  }

  const byTitle = new Map(opts.sheets.map((s) => [s.title, s]))
  const auditBefore = await deps.countAuditRows()
  const outcomes: SheetOutcome[] = []
  let failure: string | undefined

  try {
    for (const planned of work) {
      const sheet = byTitle.get(planned.title)
      if (!sheet) throw new Error(`internal: no loaded sheet for "${planned.title}"`)
      let outcome: SheetOutcome

      if (planned.action === 'create') {
        const res = await deps.createDoc(FACTSHEET_USER, {
          title: sheet.title,
          content: sheet.content,
          lang: 'en',
          pillar: 'finder',
          category: sheet.category,
        })
        await driveJob(deps, res.jobId, res.remaining, batchSize)
        const published = await deps.countPublishedChunks(res.docId)
        if (published < 1 || published !== res.total) {
          throw new Error(
            `post-apply check failed for "${sheet.title}": ${published} published chunk(s), expected ${res.total}`,
          )
        }
        outcome = { title: sheet.title, action: 'create', docId: res.docId, publishedChunks: published }
      } else {
        const oldId = planned.existingDocId
        if (!oldId) throw new Error(`internal: update without an existing doc for "${planned.title}"`)
        const res = await deps.updateDoc(FACTSHEET_USER, oldId, { content: sheet.content })
        if (!res.newDocId || !res.jobId || res.remaining === undefined) {
          throw new Error(`updateDoc returned no new version for "${sheet.title}"`)
        }
        await driveJob(deps, res.jobId, res.remaining, batchSize)
        const published = await deps.countPublishedChunks(res.newDocId)
        if (published < 1 || (res.total !== undefined && published !== res.total)) {
          throw new Error(
            `post-apply check failed for "${sheet.title}": ${published} published chunk(s), expected ${res.total ?? 'at least 1'}`,
          )
        }
        const oldStatus = await deps.docStatus(oldId)
        if (oldStatus !== 'superseded') {
          throw new Error(
            `post-apply check failed for "${sheet.title}": previous version is "${oldStatus ?? 'missing'}", expected "superseded"`,
          )
        }
        outcome = {
          title: sheet.title,
          action: 'update',
          docId: res.newDocId,
          supersededDocId: oldId,
          publishedChunks: published,
        }
      }

      await deps.audit({
        actorUid: CLIENT_FACTSHEET_ACTOR,
        action: 'client_factsheet_ingest',
        targetRef: `kbDocs/${outcome.docId}`,
        raw: { title: sheet.title, sha256: sheet.sha256 },
      })
      outcomes.push(outcome)
      say(`  ${planned.action.toUpperCase().padEnd(6)} ${sheet.title}  (${outcome.publishedChunks} chunks)`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The message goes into a scanned report; never let it mask itself behind a scan refusal.
    failure = scanForContactDetails(message).length === 0 ? message : 'error message withheld (contact-detail scan hit)'
  }

  // audit() swallows its own failures, so the rows are counted rather than trusted.
  const auditAfter = await deps.countAuditRows()
  const auditRows = { expected: outcomes.length, found: auditAfter - auditBefore }

  const report = renderFactSheetReport({
    ...reportBase,
    outcomes,
    ...(failure !== undefined ? { failure } : {}),
    auditRows,
  })
  await deps.writeFile(opts.reportPath, report)

  if (failure !== undefined) {
    throw new Error(
      `apply stopped after ${outcomes.length} of ${work.length} sheet(s): ${failure}. ` +
        'Re-run the dry run: completed sheets show as unchanged.',
    )
  }
  if (auditRows.found !== auditRows.expected) {
    throw new Error(
      `audit row count mismatch: expected ${auditRows.expected}, found ${auditRows.found}`,
    )
  }
  return { mode: 'apply', fingerprint, plan, counts, outcomes, reportPath: opts.reportPath, auditRows }
}
