/**
 * scripts/client-workbook-guards.test.ts — behaviour tests for the D4 re-run guards
 * (quick-kayinleong-096, T4).
 *
 * The three backfill scripts re-derive `unitTypes`, sizes and prices from each project's
 * `description`. After the client sheet has been imported they must leave the fields the
 * sheet owns alone. These tests RUN each script (with `--apply`) against a fake `adminDb`
 * and assert on the bulk-writer calls, so a guard that is deleted or mis-wired fails here.
 *
 * Every guard has two halves:
 *   - a marked doc is skipped (no `update` for its ref) and the output says so;
 *   - a control doc with NO markers and a description that parses to something different
 *     IS updated, which proves the marked doc was skipped by the guard and not because the
 *     fixture was inert.
 *
 * No live Firestore, Gemini or Anthropic: `@/src/firebase/admin` is mocked in full.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

interface FakeDoc {
  id: string
  data: Record<string, unknown>
}

type UpdateCall = { id: string; patch: Record<string, unknown> }

interface RunResult {
  updates: UpdateCall[]
  logs: string[]
  exitCode: number | undefined
  writerClosed: boolean
}

/** Minimal Firestore query double: get / limit / orderBy('__name__') / startAfter(id). */
function fakeCollection(docs: FakeDoc[]) {
  const toSnap = (list: FakeDoc[]) => {
    const wrapped = list.map((d) => ({ id: d.id, ref: { id: d.id }, data: () => d.data }))
    return { docs: wrapped, size: wrapped.length, empty: wrapped.length === 0 }
  }
  const build = (list: FakeDoc[]) => ({
    get: async () => toSnap(list),
    limit: (n: number) => build(list.slice(0, n)),
    orderBy: () => build([...list].sort((a, b) => a.id.localeCompare(b.id))),
    startAfter: (id: string) => build(list.filter((d) => d.id.localeCompare(id) > 0)),
  })
  return build(docs)
}

const ORIGINAL_ARGV = process.argv

afterEach(() => {
  process.argv = ORIGINAL_ARGV
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('@/src/firebase/admin')
})

/**
 * Import `scriptPath` with `--apply` against a fake projects collection and wait for the
 * script to call `process.exit`. Returns every bulk-writer update, the logged lines and the
 * exit code.
 */
async function runScript(scriptPath: string, docs: FakeDoc[]): Promise<RunResult> {
  vi.resetModules()
  const updates: UpdateCall[] = []
  let writerClosed = false
  const writer = {
    update: vi.fn((ref: { id: string }, patch: Record<string, unknown>) => {
      updates.push({ id: ref.id, patch })
    }),
    close: vi.fn(async () => {
      writerClosed = true
    }),
  }
  const projects = fakeCollection(docs)
  vi.doMock('@/src/firebase/admin', () => ({
    adminDb: {
      collection: (name: string) => {
        if (name !== 'projects') throw new Error(`unexpected collection ${name}`)
        return projects
      },
      bulkWriter: () => writer,
    },
  }))

  const logs: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })

  let resolveExit!: (code: number | undefined) => void
  const exited = new Promise<number | undefined>((r) => {
    resolveExit = r
  })
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    resolveExit(code)
  }) as never)

  process.argv = ['node', scriptPath, '--apply']
  await import(scriptPath)
  const exitCode = await exited
  return { updates, logs, exitCode, writerClosed }
}

const UNIT_TABLE_DESC = '504sf Studio - From RM1.24 - 1.8mil'
const SIZE_DESC = '1 Bedroom: 904 sqft'

describe('backfill-unit-types: client workbook guard', () => {
  it('skips a doc whose clientWorkbookFields contains unitTypes, and says so', async () => {
    const r = await runScript('./backfill-unit-types', [
      {
        id: 'p-marked',
        data: {
          name: 'Marked Project',
          description: UNIT_TABLE_DESC,
          unitTypes: [],
          clientWorkbookFields: ['unitTypes'],
        },
      },
      {
        id: 'p-normal',
        data: { name: 'Normal Project', description: UNIT_TABLE_DESC, unitTypes: [] },
      },
    ])
    expect(r.exitCode).toBe(0)
    // Control: the unmarked doc IS written, with the parsed table.
    const normal = r.updates.filter((u) => u.id === 'p-normal')
    expect(normal).toHaveLength(1)
    expect(Object.keys(normal[0]!.patch)).toEqual(['unitTypes'])
    expect((normal[0]!.patch.unitTypes as unknown[]).length).toBe(1)
    // Guard: the marked doc is never passed to the writer.
    expect(r.updates.some((u) => u.id === 'p-marked')).toBe(false)
    expect(r.logs.some((l) => l.includes('skip (client workbook) Marked Project'))).toBe(true)
    expect(r.logs.some((l) => l.includes('skipped (client workbook): 1'))).toBe(true)
  })

  it('does not skip a doc that is marked only for an unrelated field', async () => {
    const r = await runScript('./backfill-unit-types', [
      {
        id: 'p-other',
        data: {
          name: 'Other Marker',
          description: UNIT_TABLE_DESC,
          unitTypes: [],
          clientWorkbookFields: ['tenure'],
        },
      },
    ])
    expect(r.updates.map((u) => u.id)).toEqual(['p-other'])
    expect(r.logs.some((l) => l.includes('skipped (client workbook): 0'))).toBe(true)
  })
})

describe('backfill-project-sizes: client workbook guard', () => {
  it.each([['sizeMinSqft'], ['sizeMaxSqft']])(
    'skips a doc marked for %s, and says so',
    async (field) => {
      const r = await runScript('./backfill-project-sizes', [
        {
          id: 'p-marked',
          data: {
            name: 'Marked Project',
            description: SIZE_DESC,
            sizeMinSqft: 111,
            sizeMaxSqft: 222,
            clientWorkbookFields: [field],
          },
        },
        {
          id: 'p-normal',
          data: {
            name: 'Normal Project',
            description: SIZE_DESC,
            sizeMinSqft: 111,
            sizeMaxSqft: 222,
          },
        },
      ])
      expect(r.exitCode).toBe(0)
      // Control: the unmarked doc's differing range IS updated.
      expect(r.updates.filter((u) => u.id === 'p-normal')).toEqual([
        { id: 'p-normal', patch: { sizeMinSqft: 904, sizeMaxSqft: 904 } },
      ])
      // Guard.
      expect(r.updates.some((u) => u.id === 'p-marked')).toBe(false)
      expect(r.logs.some((l) => l.includes('skip (client workbook) Marked Project'))).toBe(true)
      expect(r.logs.some((l) => l.includes('skipped (client workbook): 1'))).toBe(true)
    },
  )
})

describe('fix-fabricated-prices: client workbook guard', () => {
  const FABRICATED = {
    description: 'Gross Price: RM720 psf',
    priceValue: 360_000,
    priceBand: 'under_500k',
  }

  it.each([
    ['priceSource is client-workbook', { priceSource: 'client-workbook' }],
    ['clientWorkbookFields has priceValue', { clientWorkbookFields: ['priceValue'] }],
    ['clientWorkbookFields has pricePsfMin', { clientWorkbookFields: ['pricePsfMin'] }],
  ])('gets no patch when %s, and says so', async (_label, marker) => {
    const r = await runScript('./fix-fabricated-prices', [
      { id: 'p-marked', data: { name: 'Marked Project', ...FABRICATED, ...marker } },
      { id: 'p-normal', data: { name: 'Normal Project', ...FABRICATED } },
    ])
    expect(r.exitCode).toBe(0)
    // Control: the unmarked doc with a fabricated 360,000 IS patched to 0 / psf_only.
    const normal = r.updates.filter((u) => u.id === 'p-normal')
    expect(normal).toHaveLength(1)
    expect(normal[0]!.patch).toMatchObject({
      priceValue: 0,
      priceBand: 'price_unknown',
      pricePsfMin: 720,
      pricePsfMax: 720,
      priceProvenance: 'psf_only',
    })
    // Guard.
    expect(r.updates.some((u) => u.id === 'p-marked')).toBe(false)
    expect(r.logs.some((l) => l.includes('skip (client workbook) Marked Project'))).toBe(true)
    expect(r.logs.some((l) => l.includes('skipped (client workbook)') && /: 1\s*$/.test(l))).toBe(
      true,
    )
  })

  it('keeps skipped docs out of the provenance counts', async () => {
    const r = await runScript('./fix-fabricated-prices', [
      { id: 'p-marked', data: { name: 'Marked Project', ...FABRICATED, priceSource: 'client-workbook' } },
    ])
    expect(r.updates).toEqual([])
    const psfOnly = r.logs.find((l) => l.includes('psf_only (only a per-sqft asking rate)'))
    expect(psfOnly).toMatch(/: 0\s*$/)
  })
})

describe('export-projects-for-workbook: carries the client workbook markers', () => {
  it('exports clientWorkbookFields (default []) and clientWorkbookImportedAt (ISO date or null), still omits the embedding', async () => {
    vi.resetModules()
    const written: { path: string; body: string }[] = []
    let resolveWritten!: () => void
    const wrote = new Promise<void>((r) => {
      resolveWritten = r
    })
    vi.doMock('node:fs', async (orig) => {
      const actual = await orig<typeof import('node:fs')>()
      return {
        ...actual,
        writeFileSync: (path: string, body: string) => {
          written.push({ path: String(path), body: String(body) })
          resolveWritten()
        },
      }
    })

    const docs: FakeDoc[] = [
      {
        id: 'p-marked',
        data: {
          name: 'Marked Project',
          embedding: [0.1, 0.2],
          clientWorkbookFields: ['unitTypes', 'priceValue'],
          clientWorkbookImportedAt: new Date('2026-10-01T05:00:00Z'),
        },
      },
      { id: 'p-plain', data: { name: 'Plain Project', embedding: [0.3] } },
    ]
    vi.doMock('@/src/firebase/admin', () => ({
      adminDb: {
        collection: (name: string) => {
          if (name === 'projects') return fakeCollection(docs)
          if (name === 'collateral') return fakeCollection([])
          throw new Error(`unexpected collection ${name}`)
        },
      },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

    await import('./export-projects-for-workbook')
    await wrote

    expect(written).toHaveLength(1)
    const payload = JSON.parse(written[0]!.body) as {
      records: Array<Record<string, unknown>>
    }
    const byId = new Map(payload.records.map((r) => [r.projectId as string, r]))
    const marked = byId.get('p-marked')!
    const plain = byId.get('p-plain')!
    expect(marked.clientWorkbookFields).toEqual(['unitTypes', 'priceValue'])
    expect(marked.clientWorkbookImportedAt).toBe('2026-10-01')
    expect(plain.clientWorkbookFields).toEqual([])
    expect(plain.clientWorkbookImportedAt).toBeNull()
    expect('embedding' in marked).toBe(false)
    expect('embedding' in plain).toBe(false)

    vi.doUnmock('node:fs')
  })
})
