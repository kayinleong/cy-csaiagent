/**
 * client-workbook-run.test.ts — stage 2 envelope (quick-kayinleong-096, T3).
 *
 * Every test runs against an in-memory fake store with update() semantics, a fake embedder
 * and a fake audit writer. Nothing here touches live Firestore, Gemini or Anthropic. The
 * last suite drives the SAME `buildFirestoreDeps` wiring the CLI uses against the Firestore
 * emulator; it is gated on FIRESTORE_EMULATOR_HOST and skips cleanly without it, and it
 * refuses to run unless the env guard says 'emulator' (a `demo-` project).
 *
 * The mock must come first: importing the planner loads collections.ts, which loads the
 * admin SDK. Under the emulator gate the real module is used instead.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/firebase/admin', async (importOriginal) => {
  if (process.env.FIRESTORE_EMULATOR_HOST) return importOriginal()
  return { adminDb: {} }
})

import {
  DELETE_FIELD,
  parseClientSheet,
  type ClientSheet,
  type SheetProject,
  type SheetUnit,
} from '@/src/inventory/client-workbook'
import { assertSafeTarget, CLIENT_WORKBOOK_ACTOR } from '@/src/inventory/client-workbook-safety'
import {
  ProjectMappingSchema,
  REEMBED_RECOVERY_COMMAND,
  buildFirestoreDeps,
  parseHoldsFile,
  planFingerprint,
  renderDryRunReport,
  runClientWorkbookImport,
  type AuditEntryLike,
  type ProjectMapping,
  type RunDeps,
  type RunOptions,
} from '@/src/inventory/client-workbook-run'

// ─── Fixture: a small valid sheet, mapping and stored docs ────────────────────

const WB_SHA = 'a'.repeat(64)
const DESCRIPTION_SENTINEL = 'DESCRIPTION-SENTINEL-do-not-leak'
const LOCATION_SENTINEL = 'LOCATION-SENTINEL-do-not-leak'
const RAW_SENTINEL = 'RAW-SENTINEL-existing-line-do-not-leak'

function unit(o: Partial<SheetUnit> & { label: string }): SheetUnit {
  return {
    sheetRow: 2,
    sizeSqft: null,
    bedrooms: null,
    nettMinRM: null,
    nettMaxRM: null,
    grossMinRM: null,
    grossMaxRM: null,
    psfRM: null,
    soldOut: false,
    raw: `${o.label}: sheet text`,
    held: [],
    ...o,
  }
}

const NO_FACTS = {
  area: null,
  developer: null,
  landTitle: null,
  maintenanceFee: null,
  tenure: null,
  totalUnits: null,
  floors: null,
  completion: null,
  topReasons: null,
  furnishing: null,
  carPark: null,
}

function project(o: Partial<SheetProject> & { docId: string; inventoryName: string }): SheetProject {
  return {
    sheetName: o.inventoryName,
    sheetRow: 2,
    unitMode: 'merge',
    labelPrefix: '',
    units: [],
    tenure: null,
    completion: null,
    area: null,
    facts: NO_FACTS,
    focusLists: [],
    factSheet: null,
    ...o,
  }
}

const SOUTH = 'doc-south'
const DC = 'doc-dc'
const NONE = 'doc-none'

function makeMapping(): ProjectMapping {
  const entry = (docId: string, name: string, unitMode: 'merge' | 'none') => ({
    sheet: 'Raw Data',
    sheetName: name,
    docId,
    inventoryName: name,
    matchedBy: 'exact' as const,
    unitMode,
    labelPrefix: '',
  })
  return ProjectMappingSchema.parse({
    meta: { schema: 'project-mapping/1', export_exported_at: '2026-09-18T06:31:24.701Z', workbook_sha256: WB_SHA },
    entries: [
      entry(SOUTH, 'Southpoint Like', 'merge'),
      entry(DC, 'DC Like', 'merge'),
      entry(NONE, 'Tenure Only', 'none'),
    ],
    skippedNew: ['Ashbourne'],
  })
}

const MAPPING = makeMapping()
const MAPPING_SHA = createHash('sha256').update(JSON.stringify(MAPPING)).digest('hex')

function makeSheet(): ClientSheet {
  return parseClientSheet({
    meta: {
      schema: 'client-sheet/1',
      source_label: 'Synthetic test sheet',
      import_date: '2026-10-19',
      workbook_sha256: WB_SHA,
      mapping_sha256: MAPPING_SHA,
    },
    projects: [
      project({
        docId: SOUTH,
        inventoryName: 'Southpoint Like',
        units: [
          unit({ label: 'Type C', sizeSqft: 1119, bedrooms: 2 }),
          unit({ label: 'Type D', sizeSqft: 1636, bedrooms: 3 }),
          unit({ label: 'Type A3', sizeSqft: 2347, bedrooms: 3 }),
        ],
      }),
      project({
        docId: DC,
        inventoryName: 'DC Like',
        units: [
          unit({
            label: 'Type S1',
            sizeSqft: 904,
            bedrooms: 1,
            nettMinRM: 1_200_000,
            nettMaxRM: 1_350_000,
            grossMinRM: 1_750_000,
            grossMaxRM: 1_800_000,
          }),
          unit({ label: 'Type S2', sizeSqft: 1100, bedrooms: 2, soldOut: true, raw: 'Type S2: Sold out' }),
        ],
        tenure: 'Freehold',
        completion: { kind: 'completed_year', year: 2017 },
        area: 'Damansara Height',
      }),
      project({
        docId: NONE,
        inventoryName: 'Tenure Only',
        unitMode: 'none',
        tenure: 'Leasehold',
      }),
    ],
    skipped: [{ sheetName: 'Ashbourne', sheetRow: 186, unitRows: 8, reason: 'new project, not in the inventory' }],
    heldBack: [],
    conflicts: [],
  })
}

const vector1024 = () => Array.from({ length: 1024 }, (_, i) => (i % 7) / 10)

class FakeTimestamp {
  constructor(readonly ms: number) {}
  toMillis(): number {
    return this.ms
  }
  toDate(): Date {
    return new Date(this.ms)
  }
}

function initialDocs(): Record<string, Record<string, unknown>> {
  return {
    [SOUTH]: {
      name: 'Southpoint Like',
      priceValue: 1_740_000,
      bedrooms: 2,
      tenure: 'Freehold',
      locationText: LOCATION_SENTINEL,
      description: DESCRIPTION_SENTINEL,
      createdAt: new FakeTimestamp(Date.UTC(2026, 0, 5)),
      embedding: vector1024(),
      unitTypes: [
        { label: 'Type C', sizeSqft: 1119, bedrooms: 2, priceMinRM: 1_740_000, priceMaxRM: 1_740_000, raw: RAW_SENTINEL },
        { label: 'Type D', sizeSqft: 1636, bedrooms: 3, priceMinRM: 2_380_000, priceMaxRM: 2_380_000, raw: RAW_SENTINEL },
      ],
    },
    [DC]: {
      name: 'DC Like',
      priceValue: 0,
      tenure: 'Unknown',
      bedrooms: 0,
      locationText: LOCATION_SENTINEL,
      description: DESCRIPTION_SENTINEL,
      priceSourceChunkId: 'chunk-1',
      embedding: vector1024(),
      unitTypes: [
        { label: '1 Bedroom', sizeSqft: 904, bedrooms: 1, priceMinRM: null, priceMaxRM: null, raw: RAW_SENTINEL },
        { label: '1+1 Bedrooms', sizeSqft: 1100, bedrooms: 1, priceMinRM: 1_500_000, priceMaxRM: 1_500_000, raw: RAW_SENTINEL },
      ],
    },
    [NONE]: {
      name: 'Tenure Only',
      priceValue: 700_000,
      tenure: 'Leasehold 2116',
      locationText: LOCATION_SENTINEL,
      description: DESCRIPTION_SENTINEL,
      embedding: vector1024(),
    },
  }
}

// ─── Fake environment ─────────────────────────────────────────────────────────

const FAKE_DELETE = Symbol('fake-delete')

function clone<T>(v: T): T {
  if (v instanceof FakeTimestamp) return new FakeTimestamp(v.ms) as T
  if (v instanceof Date) return new Date(v.getTime()) as T
  if (Array.isArray(v)) return v.map(clone) as T
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = clone(x)
    return out as T
  }
  return v
}

interface Behaviour {
  dropAudit?: boolean
  /** The store silently ignores this field on update (simulates a lost write). */
  loseField?: { docId: string; field: string }
  embedResult?: (docId: string) => unknown
  storeEmbeddingAs?: 'array' | 'object'
}

function makeEnv(docs = initialDocs(), behaviour: Behaviour = {}) {
  const store: Record<string, Record<string, unknown>> = clone(docs)
  const files: Record<string, string> = {}
  const log: string[] = []
  const audits: Array<AuditEntryLike & { ts: number }> = []
  const clock = { ms: Date.UTC(2026, 9, 19, 10, 0, 0) }
  const embeddedWith: unknown[] = []

  const deps: RunDeps = {
    readDoc: async (docId) => {
      log.push(`readDoc:${docId}`)
      return docId in store ? { exists: true, data: clone(store[docId]) } : { exists: false, data: undefined }
    },
    updateDoc: async (docId, patch) => {
      log.push(`updateDoc:${docId}`)
      if (!(docId in store)) throw new Error('NOT_FOUND: no document to update')
      for (const [k, v] of Object.entries(patch)) {
        if (behaviour.loseField && behaviour.loseField.docId === docId && behaviour.loseField.field === k) continue
        if (v === FAKE_DELETE) delete store[docId][k]
        else if (v instanceof Date) store[docId][k] = new FakeTimestamp(v.getTime())
        else store[docId][k] = clone(v)
      }
    },
    deleteSentinel: () => FAKE_DELETE,
    embed: async (doc) => {
      log.push(`embed:${String(doc.name)}`)
      const id = Object.keys(store).find((k) => store[k].name === doc.name) ?? ''
      return (behaviour.embedResult ? behaviour.embedResult(id) : vector1024()) as number[]
    },
    writeEmbedding: async (docId, vec) => {
      log.push(`writeEmbedding:${docId}`)
      embeddedWith.push(vec)
      store[docId].embedding = behaviour.storeEmbeddingAs === 'object' ? { vector: vec } : vec
    },
    audit: async (entry) => {
      log.push(`audit:${entry.targetRef}`)
      if (behaviour.dropAudit) return
      audits.push({ ...entry, ts: clock.ms })
    },
    countAuditRows: async (actor, since) => audits.filter((a) => a.actorUid === actor && a.ts >= since).length,
    writeFile: (path, content) => {
      log.push(`writeFile:${path}`)
      files[path] = content
    },
    readFile: (path) => {
      log.push(`readFile:${path}`)
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return files[path]
    },
    now: () => new Date(clock.ms),
    sleep: async () => {},
  }
  return { store, files, log, audits, clock, deps, embeddedWith }
}

function baseOpts(over: Partial<RunOptions> = {}): RunOptions {
  return {
    mode: 'dry-run',
    sheet: makeSheet(),
    mapping: MAPPING,
    mappingSha256: MAPPING_SHA,
    holds: {},
    backupDir: 'backups',
    reportPath: 'IMPORT-DRYRUN.md',
    target: 'emulator',
    delayMs: 0,
    hasEmbeddingKey: true,
    ...over,
  }
}

const writes = (log: string[]) => log.filter((l) => l.startsWith('updateDoc:') || l.startsWith('writeEmbedding:'))

async function dryFingerprint(env: ReturnType<typeof makeEnv>, over: Partial<RunOptions> = {}) {
  return (await runClientWorkbookImport(env.deps, baseOpts(over))).fingerprint
}

// ─── Dry run ──────────────────────────────────────────────────────────────────

describe('dry run', () => {
  it('makes no write, audit, embed or embedding call; writes the report; returns the fingerprint', async () => {
    const env = makeEnv()
    const before = JSON.stringify(env.store)
    const r = await runClientWorkbookImport(env.deps, baseOpts())
    expect(r.ok).toBe(true)
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(env.log.filter((l) => /^(updateDoc|audit|embed|writeEmbedding):/.test(l))).toEqual([])
    expect(JSON.stringify(env.store)).toBe(before)
    expect(env.audits).toHaveLength(0)
    expect(Object.keys(env.files)).toEqual(['IMPORT-DRYRUN.md'])
    expect(env.files['IMPORT-DRYRUN.md']).toContain(r.fingerprint)
    expect(r.docsInPlan).toBe(3)
    expect(r.docsChanged).toBe(2)
    expect(r.reembedPlanned).toBe(1)
  })

  it('renders the header, mapping table, before/after tables, named drops and kept-from-previous lines', async () => {
    const env = makeEnv()
    const r = await runClientWorkbookImport(env.deps, baseOpts())
    const text = env.files['IMPORT-DRYRUN.md']
    expect(text).toContain(`Workbook sha256: \`${WB_SHA}\``)
    expect(text).toContain(`Mapping sha256: \`${MAPPING_SHA}\``)
    expect(text).toContain('Target: emulator')
    expect(text).toContain('| Sheet name | Inventory name | docId | Matched by |')
    expect(text).toContain('| DC Like | DC Like | doc-dc | exact |')
    expect(text).toContain('| Field | Before | After |')
    // a numeric change uses en-MY thousands separators
    expect(text).toContain('| priceValue | 0 | 1,200,000 |')
    // DELETE_FIELD is shown as "(removed)"
    expect(text).toContain('| priceSourceChunkId | chunk-1 | (removed) |')
    // unitTypes sub-table: status, label, nett range, sold out, drops named and flagged
    expect(text).toContain('| added | Type S1 | 904 | 1 | 1,200,000–1,350,000 |')
    expect(text).toContain('| added | Type S2 | 1,100 | 2 |  | yes |')
    expect(text).toContain('| dropped | 1+1 Bedrooms |  |  |  |  | carried a price |')
    expect(text).toContain('| dropped | 1 Bedroom |  |  |  |  | carried no price |')
    expect(text).toContain('### unit-dropped (2)')
    expect(text).toContain('Dropped stored grouped layout "1+1 Bedrooms" (it carried a price of RM1,500,000)')
    // Southpoint-like: stored prices kept because the sheet leaves them blank
    expect(text).toContain('### kept-from-previous (2)')
    expect(text).toContain('Layout "Type C" kept its stored price because the sheet leaves that blank')
    expect(text).toContain('| matched | Type C | 1,119 | 2 | 1,740,000 |  | kept from previous: price |')
    expect(text).toContain('kept from previous: price')
    expect(text).toContain('### area-not-in-location')
    expect(text).toContain('### tenure-kept-specific')
    expect(text).toContain('See HELD-BACK.md')
    expect(text).toContain('Skipped new projects: 1')
    expect(text).toContain('## Re-embed list')
    expect(r.docsChanged).toBe(2)
  })

  it('never contains the existing description, location text or an existing raw line', async () => {
    const env = makeEnv()
    await runClientWorkbookImport(env.deps, baseOpts())
    const text = env.files['IMPORT-DRYRUN.md']
    for (const s of [DESCRIPTION_SENTINEL, LOCATION_SENTINEL, RAW_SENTINEL, 'RAW-SENTINEL']) {
      expect(text).not.toContain(s)
    }
  })

  it('aborts before writing anything when the report would contain contact details', async () => {
    const docs = initialDocs()
    docs[DC].tenure = 'Call 012-000 0000'
    const env = makeEnv(docs)
    await expect(runClientWorkbookImport(env.deps, baseOpts())).rejects.toThrow(/contact details \(phone\)/)
    expect(Object.keys(env.files)).toEqual([])
    expect(writes(env.log)).toEqual([])
    // and the same on an apply: refused before the backup or any write
    const fp = 'x'
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply', expectPlan: fp })),
    ).rejects.toThrow(/contact details/)
    expect(Object.keys(env.files)).toEqual([])
    expect(writes(env.log)).toEqual([])
  })

  it('refuses a missing mapped doc, and a live name that differs by one character, before any write', async () => {
    const missing = makeEnv()
    delete missing.store[NONE]
    await expect(runClientWorkbookImport(missing.deps, baseOpts())).rejects.toThrow(/docId=doc-none.*not found/)
    expect(writes(missing.log)).toEqual([])

    const docs = initialDocs()
    docs[DC].name = 'DC Likf'
    const renamed = makeEnv(docs)
    await expect(runClientWorkbookImport(renamed.deps, baseOpts())).rejects.toThrow(/docId=doc-dc.*differs/)
    const fp = await dryFingerprint(makeEnv()).catch(() => 'x'.repeat(64))
    await expect(
      runClientWorkbookImport(renamed.deps, baseOpts({ mode: 'apply', expectPlan: fp })),
    ).rejects.toThrow(/differs/)
    expect(writes(renamed.log)).toEqual([])
    expect(Object.keys(renamed.files)).toEqual([])
  })

  it('refuses a sheet and mapping that disagree', async () => {
    const env = makeEnv()
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mappingSha256: 'b'.repeat(64) })),
    ).rejects.toThrow(/mapping_sha256/)
    const sheet = makeSheet()
    sheet.projects[0] = { ...sheet.projects[0], docId: 'doc-unmapped' }
    await expect(runClientWorkbookImport(env.deps, baseOpts({ sheet }))).rejects.toThrow(
      /docId=doc-unmapped is not in the mapping/,
    )
    expect(writes(env.log)).toEqual([])
  })
})

// ─── Holds and the fingerprint ────────────────────────────────────────────────

describe('holds and fingerprint', () => {
  it('honours holds, and the fingerprint changes when the holds change', async () => {
    const env = makeEnv()
    const none = await dryFingerprint(env)
    const held = await runClientWorkbookImport(env.deps, baseOpts({ holds: { [DC]: ['price'] } }))
    expect(held.fingerprint).not.toBe(none)
    expect(env.files['IMPORT-DRYRUN.md']).toContain('Holds: price')
    expect(env.files['IMPORT-DRYRUN.md']).not.toContain('| priceValue | 0 | 1,200,000 |')
    expect(env.files['IMPORT-DRYRUN.md']).toContain('### hold-applied (1)')
    const keepDrops = await dryFingerprint(env, { holds: { [DC]: ['unitDrops'] } })
    expect(keepDrops).not.toBe(none)
    expect(keepDrops).not.toBe(held.fingerprint)
  })

  it('rejects a hold on a docId that is not in the sheet, and an unknown group', async () => {
    const env = makeEnv()
    await expect(runClientWorkbookImport(env.deps, baseOpts({ holds: { nope: ['price'] } }))).rejects.toThrow(
      /docId=nope is not a project in the sheet/,
    )
    await expect(runClientWorkbookImport(env.deps, baseOpts({ holds: { [DC]: ['prices'] } }))).rejects.toThrow(
      /unknown hold group/,
    )
    expect(() => parseHoldsFile({ holds: { [DC]: ['prices'] } })).toThrow(/unknown hold group/)
    expect(parseHoldsFile({ holds: { [DC]: ['price', 'unitDrops'] } })).toEqual({ [DC]: ['price', 'unitDrops'] })
  })

  it('planFingerprint ignores clientWorkbookImportedAt, order and empty plans; maps dates and DELETE_FIELD', () => {
    const a = planFingerprint({
      mappingSha256: 'm',
      holds: { z: ['b', 'a'], y: [] },
      plans: [
        { docId: 'd2', changes: [{ field: 'vpDate', after: new Date('2017-01-01T00:00:00.000Z') }] },
        {
          docId: 'd1',
          changes: [
            { field: 'priceSourceChunkId', after: DELETE_FIELD },
            { field: 'clientWorkbookImportedAt', after: new Date('2026-10-19T10:00:00.000Z') },
            { field: 'priceValue', after: { b: 1, a: [2, 1] } },
          ],
        },
        { docId: 'd3', changes: [{ field: 'clientWorkbookImportedAt', after: new Date() }] },
      ],
    })
    const b = planFingerprint({
      mappingSha256: 'm',
      holds: { z: ['a', 'b'] },
      plans: [
        {
          docId: 'd1',
          changes: [
            { field: 'priceValue', after: { a: [2, 1], b: 1 } },
            { field: 'priceSourceChunkId', after: '$delete' },
            { field: 'clientWorkbookImportedAt', after: new Date('2030-01-01T00:00:00.000Z') },
          ],
        },
        { docId: 'd2', changes: [{ field: 'vpDate', after: '2017-01-01T00:00:00.000Z' }] },
      ],
    })
    expect(a).toBe(b)
    // array order inside a value is significant
    const c = planFingerprint({
      mappingSha256: 'm',
      holds: { z: ['a', 'b'] },
      plans: [{ docId: 'd1', changes: [{ field: 'priceValue', after: { a: [1, 2], b: 1 } }] }],
    })
    expect(c).not.toBe(a)
  })
})

// ─── Apply ────────────────────────────────────────────────────────────────────

async function dryThenApply(env: ReturnType<typeof makeEnv>, over: Partial<RunOptions> = {}) {
  const dry = await runClientWorkbookImport(env.deps, baseOpts(over))
  return runClientWorkbookImport(
    env.deps,
    baseOpts({ mode: 'apply', reportPath: 'IMPORT-APPLY.md', expectPlan: dry.fingerprint, ...over }),
  )
}

describe('apply gating', () => {
  it('refuses without --expect-plan, and with a fingerprint that differs, with zero writes', async () => {
    const env = makeEnv()
    await expect(runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply' }))).rejects.toThrow(
      /--expect-plan is required/,
    )
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply', expectPlan: 'f'.repeat(64) })),
    ).rejects.toThrow(/does not match/)
    expect(writes(env.log)).toEqual([])
    expect(env.audits).toHaveLength(0)
    expect(Object.keys(env.files)).toEqual([])
  })

  it('refuses when the live state drifted since the approved dry run', async () => {
    const env = makeEnv()
    const dry = await runClientWorkbookImport(env.deps, baseOpts())
    env.store[DC].tenure = 'Freehold' // drift: the approved tenure change is no longer in the plan
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply', expectPlan: dry.fingerprint })),
    ).rejects.toThrow(/does not match/)
    expect(writes(env.log)).toEqual([])
  })

  it('refuses before the backup when a re-embed is needed and the embedding key is absent', async () => {
    const env = makeEnv()
    const dry = await runClientWorkbookImport(env.deps, baseOpts())
    await expect(
      runClientWorkbookImport(
        env.deps,
        baseOpts({ mode: 'apply', expectPlan: dry.fingerprint, hasEmbeddingKey: false }),
      ),
    ).rejects.toThrow(/embedding key is not set/)
    expect(writes(env.log)).toEqual([])
    expect(Object.keys(env.files).filter((f) => f.includes('backup'))).toEqual([])
  })
})

describe('apply', () => {
  it('writes the backup, re-reads and parses it, and only then makes the first update', async () => {
    const env = makeEnv()
    const r = await dryThenApply(env)
    expect(r.ok).toBe(true)
    const backupPath = r.backupPath as string
    expect(backupPath).toMatch(/^backups\/2026-10-19T10-00-00-000Z\/projects-backup\.json$/)
    const iWrite = env.log.indexOf(`writeFile:${backupPath}`)
    const iRead = env.log.lastIndexOf(`readFile:${backupPath}`)
    const iFirst = env.log.findIndex((l) => l.startsWith('updateDoc:'))
    expect(iWrite).toBeGreaterThan(-1)
    expect(iRead).toBeGreaterThan(iWrite)
    expect(iFirst).toBeGreaterThan(iRead)

    const backup = JSON.parse(env.files[backupPath])
    expect(backup.docs).toHaveLength(2)
    expect(backup.docs.map((d: { docId: string }) => d.docId)).toEqual([SOUTH, DC])
    for (const d of backup.docs) {
      expect('embedding' in d.before).toBe(false)
      expect(d.plannedFields).toContain('unitTypes')
    }
    // full pre-image, including prose, which is why the directory is gitignored
    expect(backup.docs[1].before.description).toBe(DESCRIPTION_SENTINEL)
    expect(backup.meta).toMatchObject({ fingerprint: r.fingerprint, target: 'emulator', kind: 'import' })
    expect(backup.meta.workbook_sha256).toBe(WB_SHA)
    expect(backup.meta.mapping_sha256).toBe(MAPPING_SHA)
  })

  it('serialises Timestamp-likes as {"$ts": ISO} in the backup', async () => {
    const docs = initialDocs()
    docs[DC].vpDate = new FakeTimestamp(Date.UTC(2015, 5, 1))
    const env = makeEnv(docs)
    const r = await dryThenApply(env)
    const backup = JSON.parse(env.files[r.backupPath as string])
    expect(backup.docs[1].before.vpDate).toEqual({ $ts: '2015-06-01T00:00:00.000Z' })
  })

  it('writes with update() by docId only and writes exactly the planned fields', async () => {
    const env = makeEnv()
    const r = await dryThenApply(env)
    expect(r.written).toBe(2)
    expect(env.log.filter((l) => l.startsWith('updateDoc:') && !l.startsWith('updateDoc:doc-'))).toEqual([])
    // Southpoint keeps its stored per-layout prices; Tenure Only is untouched
    const south = env.store[SOUTH]
    const list = south.unitTypes as Array<{ label: string; priceMinRM: number | null; raw: string }>
    expect(list.map((e) => e.label)).toEqual(['Type C', 'Type D', 'Type A3'])
    expect(list.filter((e) => e.priceMinRM !== null)).toHaveLength(2)
    expect(list[0].raw).toBe('Type C: sheet text | kept from previous record: price')
    expect(south.priceValue).toBe(1_740_000)
    expect(env.store[NONE]).toEqual(initialDocs()[NONE])
    // DC: the projection of the sheet
    const dc = env.store[DC]
    expect(dc.priceValue).toBe(1_200_000)
    expect(dc.priceBand).toBe('above_1.2m')
    expect(dc.priceProvenance).toBe('stated')
    expect(dc.priceSource).toBe('client-workbook')
    expect('priceSourceChunkId' in dc).toBe(false)
    expect(dc.tenure).toBe('Freehold')
    expect(dc.vpStatus).toBe(true)
    expect((dc.vpDate as FakeTimestamp).toMillis()).toBe(Date.UTC(2017, 0, 1))
    expect(dc.clientWorkbookFields).toContain('unitTypes')
    expect(env.store[SOUTH].clientWorkbookFields).toEqual(['bedrooms', 'sizeMaxSqft', 'sizeMinSqft', 'unitTypes'])
    expect((dc.clientWorkbookImportedAt as FakeTimestamp).toMillis()).toBe(env.clock.ms)
    // the stored embedding is untouched by the field writes of an unchanged-embedding doc
    expect(Array.isArray(south.embedding)).toBe(true)
  })

  it('has no set/create path: the store update throws for a missing doc, and the runner surfaces it', async () => {
    const env = makeEnv()
    await expect(env.deps.updateDoc('doc-missing', { a: 1 })).rejects.toThrow(/NOT_FOUND/)
    expect('doc-missing' in env.store).toBe(false)

    // A doc that vanishes between planning and writing: update throws, the run aborts
    // naming the doc, and nothing is created.
    const dry = await runClientWorkbookImport(env.deps, baseOpts())
    const realWrite = env.deps.writeFile
    env.deps.writeFile = (path, content) => {
      realWrite(path, content)
      if (path.includes('backup')) delete env.store[DC]
    }
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply', expectPlan: dry.fingerprint })),
    ).rejects.toThrow(/docId=doc-dc: update failed \(NOT_FOUND/)
    expect('doc-dc' in env.store).toBe(false)
  })

  it('throws naming the docId and writes no further doc when a re-read differs from the plan', async () => {
    const env = makeEnv(initialDocs(), { loseField: { docId: SOUTH, field: 'sizeMinSqft' } })
    const dry = await runClientWorkbookImport(env.deps, baseOpts())
    await expect(
      runClientWorkbookImport(env.deps, baseOpts({ mode: 'apply', expectPlan: dry.fingerprint, reportPath: 'IMPORT-APPLY.md' })),
    ).rejects.toThrow(/docId=doc-south: re-read does not match the plan for field\(s\) sizeMinSqft/)
    const updates = env.log.filter((l) => l.startsWith('updateDoc:'))
    expect(updates).toEqual(['updateDoc:doc-south'])
    // the partial state is reported, with the backup named for recovery
    expect(env.files['IMPORT-APPLY.md']).toContain('ABORTED')
  })

  it('writes one audit row per written doc holding only docId, field names and the fingerprint', async () => {
    const env = makeEnv()
    const r = await dryThenApply(env)
    expect(r.auditRows).toBe(2)
    expect(env.audits).toHaveLength(2)
    for (const a of env.audits) {
      expect(a.actorUid).toBe(CLIENT_WORKBOOK_ACTOR)
      expect(a.actorUid).toBe('client-workbook-import-096')
      expect(a.action).toBe('client_workbook_import')
      expect(Object.keys(a.raw).sort()).toEqual(['docId', 'fields', 'fingerprint'])
      expect(a.targetRef).toBe(`projects/${a.raw.docId}`)
      expect(a.raw.fingerprint).toBe(r.fingerprint)
      expect(JSON.stringify(a)).not.toContain(DESCRIPTION_SENTINEL)
    }
    expect(env.audits.map((a) => a.targetRef)).toEqual([`projects/${SOUTH}`, `projects/${DC}`])
  })

  it('returns not-ok when the audit count differs (a swallowed audit failure)', async () => {
    const env = makeEnv(initialDocs(), { dropAudit: true })
    const r = await dryThenApply(env)
    expect(r.ok).toBe(false)
    expect(r.auditRows).toBe(0)
    expect(r.written).toBe(2)
    expect(r.problems.join('\n')).toMatch(/audit rows counted 0, expected 2/)
    expect(env.files['IMPORT-APPLY.md']).toContain('COMPLETE WITH PROBLEMS')
  })
})

// ─── Re-embed ─────────────────────────────────────────────────────────────────

describe('selective re-embed', () => {
  it('re-embeds only plans flagged reembed, as a plain array of 1024 finite numbers', async () => {
    const env = makeEnv()
    const r = await dryThenApply(env)
    expect(r.reembedded).toBe(1)
    expect(r.reembedFailed).toEqual([])
    expect(env.log.filter((l) => l.startsWith('embed:'))).toEqual(['embed:DC Like'])
    expect(env.log.filter((l) => l.startsWith('writeEmbedding:'))).toEqual(['writeEmbedding:doc-dc'])
    const v = env.embeddedWith[0]
    expect(Array.isArray(v)).toBe(true)
    expect((v as number[]).length).toBe(1024)
    expect((v as number[]).every((x) => Number.isFinite(x))).toBe(true)
    const stored = env.store[DC].embedding
    expect(Array.isArray(stored)).toBe(true)
    expect((stored as number[]).length).toBe(1024)
    // embeds the POST-write doc (the new band is in the text being embedded)
    expect(env.log.indexOf('embed:DC Like')).toBeGreaterThan(env.log.indexOf('updateDoc:doc-dc'))
  })

  it('refuses a wrong-length vector and a non-array, keeps going, and exits not-ok with the recovery command', async () => {
    for (const bad of [[0.1, 0.2, 0.3], { vector: vector1024() }, Float64Array.from(vector1024()), 'nope']) {
      const env = makeEnv(initialDocs(), { embedResult: () => bad })
      const r = await dryThenApply(env)
      expect(r.ok).toBe(false)
      expect(r.reembedFailed).toEqual([DC])
      expect(env.log.filter((l) => l.startsWith('writeEmbedding:'))).toEqual([])
      expect(r.problems.join('\n')).toContain(REEMBED_RECOVERY_COMMAND)
      expect(r.written).toBe(2)
    }
  })

  it('fails the post-write check when the stored embedding is not a plain array of length 1024', async () => {
    const env = makeEnv(initialDocs(), { storeEmbeddingAs: 'object' })
    const r = await dryThenApply(env)
    expect(r.ok).toBe(false)
    expect(r.reembedFailed).toEqual([DC])
    expect(r.problems.join('\n')).toMatch(/stored embedding is not a plain array/)
  })
})

// ─── Idempotency and restore ──────────────────────────────────────────────────

describe('idempotency', () => {
  it('a second dry run after apply shows 0 changes', async () => {
    const env = makeEnv()
    const first = await dryThenApply(env)
    expect(first.ok).toBe(true)
    const second = await runClientWorkbookImport(env.deps, baseOpts({ reportPath: 'SECOND.md' }))
    expect(second.docsChanged).toBe(0)
    expect(second.fieldsChanged).toBe(0)
    expect(second.reembedPlanned).toBe(0)
    expect(env.files['SECOND.md']).toContain('Projects with changes: 0')
    expect(env.files['SECOND.md']).toContain('No project changes.')
    // and an apply with that fingerprint writes nothing
    const noop = await runClientWorkbookImport(
      env.deps,
      baseOpts({ mode: 'apply', reportPath: 'NOOP.md', expectPlan: second.fingerprint }),
    )
    expect(noop.written).toBe(0)
    expect(noop.backupPath).toBeNull()
    expect(noop.ok).toBe(true)
    expect(env.files['NOOP.md']).toContain('NOTHING TO WRITE')
  })
})

describe('restore', () => {
  async function applied() {
    const env = makeEnv()
    const pre = clone(env.store)
    const r = await dryThenApply(env)
    expect(r.ok).toBe(true)
    return { env, pre, backupPath: r.backupPath as string, importFp: r.fingerprint }
  }
  const restoreOpts = (backupPath: string, over: Partial<RunOptions> = {}): RunOptions => ({
    mode: 'restore-dry-run',
    restoreFrom: backupPath,
    backupDir: 'backups',
    reportPath: 'RESTORE-DRYRUN.md',
    target: 'emulator',
    delayMs: 0,
    hasEmbeddingKey: true,
    ...over,
  })

  it('restores every patched field to its pre-image and removes both markers', async () => {
    const { env, pre, backupPath } = await applied()
    env.clock.ms += 60_000
    const dry = await runClientWorkbookImport(env.deps, restoreOpts(backupPath))
    expect(dry.docsChanged).toBe(2)
    expect(env.files['RESTORE-DRYRUN.md']).toContain('| Field | Current | Restored |')
    const res = await runClientWorkbookImport(
      env.deps,
      restoreOpts(backupPath, { mode: 'restore-apply', reportPath: 'RESTORE-APPLY.md', expectPlan: dry.fingerprint }),
    )
    expect(res.ok).toBe(true)
    expect(res.written).toBe(2)
    for (const id of [SOUTH, DC]) {
      const now = env.store[id]
      const was = pre[id]
      for (const k of Object.keys(was)) {
        if (k === 'embedding') continue
        expect(JSON.stringify(now[k])).toBe(JSON.stringify(was[k]))
      }
      for (const k of Object.keys(now)) {
        if (k === 'embedding') continue
        expect(k in was).toBe(true)
      }
      expect('clientWorkbookFields' in now).toBe(false)
      expect('clientWorkbookImportedAt' in now).toBe(false)
    }
    // the embedding is brought back in line with the restored text, as a plain array
    expect(env.log.filter((l) => l.startsWith('writeEmbedding:')).length).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(env.store[DC].embedding)).toBe(true)
    // a pre-restore backup was taken, then re-read before the first restore write
    expect(res.backupPath).toMatch(/projects-backup\.json$/)
    expect(res.backupPath).not.toBe(backupPath)
    // and the import is plannable again from the restored state
    const again = await runClientWorkbookImport(env.deps, baseOpts({ reportPath: 'AGAIN.md' }))
    expect(again.docsChanged).toBe(2)
  })

  it('requires its own --expect-plan: the import fingerprint is refused', async () => {
    const { env, backupPath, importFp } = await applied()
    const before = JSON.stringify(env.store)
    await expect(
      runClientWorkbookImport(env.deps, restoreOpts(backupPath, { mode: 'restore-apply', expectPlan: importFp })),
    ).rejects.toThrow(/does not match/)
    await expect(
      runClientWorkbookImport(env.deps, restoreOpts(backupPath, { mode: 'restore-apply' })),
    ).rejects.toThrow(/--expect-plan is required/)
    expect(JSON.stringify(env.store)).toBe(before)
  })

  it('refuses a backup whose doc is missing or renamed live, and a malformed backup', async () => {
    const { env, backupPath } = await applied()
    delete env.store[SOUTH]
    await expect(runClientWorkbookImport(env.deps, restoreOpts(backupPath))).rejects.toThrow(/not found/)
    env.files['bad.json'] = '{"nope":true}'
    await expect(runClientWorkbookImport(env.deps, restoreOpts('bad.json'))).rejects.toThrow()
  })

  it('a restore dry run after the restore shows 0 changes', async () => {
    const { env, backupPath } = await applied()
    const dry = await runClientWorkbookImport(env.deps, restoreOpts(backupPath))
    await runClientWorkbookImport(
      env.deps,
      restoreOpts(backupPath, { mode: 'restore-apply', reportPath: 'R.md', expectPlan: dry.fingerprint }),
    )
    const after = await runClientWorkbookImport(env.deps, restoreOpts(backupPath, { reportPath: 'R2.md' }))
    expect(after.docsChanged).toBe(0)
  })
})

// ─── Report rendering ─────────────────────────────────────────────────────────

describe('renderDryRunReport', () => {
  it('throws on a contact detail anywhere in the text', () => {
    expect(() =>
      renderDryRunReport({
        title: 'x',
        target: 'emulator',
        fingerprint: 'f',
        generatedAt: new Date(0),
        workbookSha256: WB_SHA,
        mappingSha256: MAPPING_SHA,
        columns: { before: 'Before', after: 'After' },
        docs: [
          {
            docId: 'd',
            name: 'Visit example.com.my now',
            changes: [{ field: 'tenure', before: 'a', after: 'b' }],
            warnings: [],
            reembed: false,
            holds: [],
            storedUnits: [],
          },
        ],
        skippedCount: 0,
        heldBackCount: 0,
        conflictCount: 0,
      }),
    ).toThrow(/contact details \(url\)/)
  })
})

// ─── Static check ─────────────────────────────────────────────────────────────

describe('static guarantees of the import code', () => {
  const code = (file: string) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')

  for (const file of ['scripts/import-client-workbook.ts', 'src/inventory/client-workbook-run.ts']) {
    it(`${file} has no Firestore vector wrapper, no .set( and no .create(`, () => {
      const src = code(file)
      expect(src).not.toMatch(/\.vector\s*\(/)
      expect(src).not.toMatch(/VectorValue/)
      expect(src).not.toMatch(/\.set\s*\(/)
      expect(src).not.toMatch(/\.create\s*\(/)
    })
  }

  it('the CLI has only node built-ins and the safety module as static imports, and guards first', () => {
    const lines = readFileSync('scripts/import-client-workbook.ts', 'utf8').split('\n')
    const imports = lines.filter((l) => /^import\s/.test(l))
    expect(imports.every((l) => /from '(node:[a-z]+|@\/src\/inventory\/client-workbook-safety)'/.test(l))).toBe(true)
    const src = code('scripts/import-client-workbook.ts')
    const guard = src.indexOf('assertSafeTarget(process.env)')
    const firstDynamic = src.indexOf("await Promise.all([")
    expect(guard).toBeGreaterThan(-1)
    expect(firstDynamic).toBeGreaterThan(guard)
    expect(src).not.toMatch(/^import[^\n]*firebase\/(admin|collections)/m)
  })
})

// ─── Emulator-gated: the CLI's own wiring against a real Firestore ────────────

const EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const emulatorSuite = EMULATOR ? describe : describe.skip

emulatorSuite('emulator: buildFirestoreDeps against the Firestore emulator (demo project only)', () => {
  it('dry run, apply, idempotent re-run, restore, with real update/delete/audit/array semantics', async () => {
    // The guard first: anything but an emulator on a demo- project fails the test.
    expect(assertSafeTarget(process.env)).toBe('emulator')
    const { adminDb } = await import('@/src/firebase/admin')
    const { FieldValue } = await import('firebase-admin/firestore')
    const { log } = await import('@/src/audit/log')

    // base36: a long run of digits in a docId would (rightly) trip the phone scanner
    const stamp = Date.now().toString(36)
    const ids = { south: `t3-south-${stamp}`, dc: `t3-dc-${stamp}`, none: `t3-none-${stamp}` }
    const docs = initialDocs()
    const idMap: Record<string, string> = { [SOUTH]: ids.south, [DC]: ids.dc, [NONE]: ids.none }
    for (const [k, id] of Object.entries(idMap)) {
      const seed = clone(docs[k])
      for (const [f, v] of Object.entries(seed)) if (v instanceof FakeTimestamp) seed[f] = v.toDate()
      await adminDb.collection('projects').doc(id).set(seed)
    }

    // Re-key the sheet and mapping to the emulator docIds.
    const sheet = makeSheet()
    sheet.projects = sheet.projects.map((p) => ({ ...p, docId: idMap[p.docId] }))
    const mapping = ProjectMappingSchema.parse({
      ...MAPPING,
      entries: MAPPING.entries.map((e) => ({ ...e, docId: idMap[e.docId] })),
    })
    const mappingSha256 = createHash('sha256').update(JSON.stringify(mapping)).digest('hex')
    sheet.meta = { ...sheet.meta, mapping_sha256: mappingSha256 }

    const dir = mkdtempSync(join(tmpdir(), 'cw-run-'))
    const deps = buildFirestoreDeps({
      db: adminDb as unknown as Parameters<typeof buildFirestoreDeps>[0]['db'],
      deleteSentinel: () => FieldValue.delete(),
      audit: (e) => log(e),
      embed: async () => vector1024(),
      writeFile: (p, c) => {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, c)
      },
      readFile: (p) => readFileSync(p, 'utf8'),
      sleep: async () => {},
    })
    const opts = (over: Partial<RunOptions>): RunOptions => ({
      mode: 'dry-run',
      sheet,
      mapping,
      mappingSha256,
      holds: {},
      backupDir: join(dir, 'backups'),
      reportPath: join(dir, 'report.md'),
      target: 'emulator',
      delayMs: 0,
      hasEmbeddingKey: true,
      ...over,
    })

    const dry = await runClientWorkbookImport(deps, opts({}))
    expect(dry.docsChanged).toBe(2)
    const applied = await runClientWorkbookImport(deps, opts({ mode: 'apply', expectPlan: dry.fingerprint }))
    expect(applied.problems).toEqual([])
    expect(applied.ok).toBe(true)
    expect(applied.written).toBe(2)
    expect(applied.asserted).toBe(2)
    expect(applied.auditRows).toBe(2)
    expect(applied.reembedded).toBe(1)
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1)

    const dc = (await adminDb.collection('projects').doc(ids.dc).get()).data() as Record<string, unknown>
    expect(dc.priceValue).toBe(1_200_000)
    expect('priceSourceChunkId' in dc).toBe(false)
    expect(Array.isArray(dc.embedding)).toBe(true)
    expect((dc.embedding as number[]).length).toBe(1024)

    const second = await runClientWorkbookImport(deps, opts({}))
    expect(second.docsChanged).toBe(0)

    const restoreDry = await runClientWorkbookImport(
      deps,
      opts({ mode: 'restore-dry-run', restoreFrom: applied.backupPath as string }),
    )
    expect(restoreDry.docsChanged).toBe(2)
    const restored = await runClientWorkbookImport(
      deps,
      opts({ mode: 'restore-apply', restoreFrom: applied.backupPath as string, expectPlan: restoreDry.fingerprint }),
    )
    expect(restored.ok).toBe(true)
    const dcBack = (await adminDb.collection('projects').doc(ids.dc).get()).data() as Record<string, unknown>
    expect(dcBack.priceValue).toBe(0)
    expect(dcBack.priceSourceChunkId).toBe('chunk-1')
    expect('clientWorkbookFields' in dcBack).toBe(false)
    expect('clientWorkbookImportedAt' in dcBack).toBe(false)
    expect(dcBack.tenure).toBe('Unknown')
  }, 60_000)
})
