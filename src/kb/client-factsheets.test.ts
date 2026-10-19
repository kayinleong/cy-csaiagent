/**
 * client-factsheets.test.ts — behaviour tests for the fact-sheet ingest
 * (quick-kayinleong-096, T5).
 *
 * Every dependency is a fake: a small stateful in-memory KB stands in for kbDocs,
 * kbIngestionJobs and kbChunks, so the create -> update -> unchanged cycle is exercised
 * end to end without Firestore, Gemini or the Admin SDK. The module under test imports only
 * zod, node:crypto and the import-free safety kernel, so there is nothing to mock.
 *
 * The equivalence block reads the committed claim-dir files with node fs.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CLIENT_FACTSHEET_ACTOR, scanForContactDetails } from '@/src/inventory/client-workbook-safety'
import {
  FACTSHEET_MAX_CHARS,
  FactSheetApplyRefused,
  FactSheetLoadError,
  FactSheetManifestSchema,
  factSheetFingerprint,
  loadFactSheets,
  planFactSheets,
  renderFactSheetReport,
  runFactSheetIngest,
  sha256Hex,
  type LoadedFactSheet,
  type RunDeps,
} from './client-factsheets'

// ─── fixtures ────────────────────────────────────────────────────────────────

const SOURCE_LABEL = 'D2 project info sheet supplied by the client, 19 October 2026'
const WB_SHA = 'd'.repeat(64)

function sheetText(name: string, extra = ''): string {
  return [
    `# ${name}: D2 project facts`,
    '',
    `Source: ${SOURCE_LABEL}.`,
    '',
    `## ${name}: project facts`,
    '- Tenure: Freehold',
    extra,
    '',
  ].join('\n')
}

interface FixtureSheet {
  file: string
  docId: string
  inventoryName: string
  title: string
  category: string
  sha256: string
  text: string
}

function fixture(name: string, extra = ''): FixtureSheet {
  const text = sheetText(name, extra)
  return {
    file: `factsheets/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
    docId: `proj-${name}`,
    inventoryName: name,
    title: `${name} — D2 project facts (client sheet)`,
    category: name,
    sha256: sha256Hex(Buffer.from(text, 'utf8')),
    text,
  }
}

function manifestOf(sheets: FixtureSheet[]) {
  return {
    meta: { schema: 'factsheets/1', source_label: SOURCE_LABEL, workbook_sha256: WB_SHA },
    sheets: sheets.map((s) => ({
      file: s.file,
      docId: s.docId,
      inventoryName: s.inventoryName,
      title: s.title,
      category: s.category,
      sha256: s.sha256,
    })),
  }
}

function readerOf(sheets: FixtureSheet[], overrides: Record<string, string | Buffer> = {}) {
  const files = new Map<string, string | Buffer>(sheets.map((s) => [s.file, s.text]))
  for (const [k, v] of Object.entries(overrides)) files.set(k, v)
  return (rel: string): Uint8Array => {
    const v = files.get(rel)
    if (v === undefined) throw new Error('ENOENT')
    return Buffer.from(v)
  }
}

function load(sheets: FixtureSheet[], overrides: Record<string, string | Buffer> = {}): LoadedFactSheet[] {
  return loadFactSheets(manifestOf(sheets), readerOf(sheets, overrides))
}

/** Run loadFactSheets and return the thrown message (fails the test when it does not throw). */
function loadFailure(
  sheets: FixtureSheet[],
  overrides: Record<string, string | Buffer> = {},
  manifest: unknown = manifestOf(sheets),
): string {
  try {
    loadFactSheets(manifest, readerOf(sheets, overrides))
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected loadFactSheets to throw')
}

// ─── a stateful fake KB ──────────────────────────────────────────────────────

interface FakeDocRow {
  id: string
  title: string
  pillar: string
  status: string
  supersedes?: string
}
interface FakeJob {
  id: string
  docId: string
  fileHash: string
  total: number
  remaining: number
  supersedesId?: string
}

function makeKb(opts: { chunksPerSheet?: number; stallProcess?: boolean; swallowAudit?: boolean; skipSupersede?: boolean } = {}) {
  const chunksPerSheet = opts.chunksPerSheet ?? 3
  const docs: FakeDocRow[] = []
  const jobs: FakeJob[] = []
  const chunks: Array<{ docId: string; status: string }> = []
  const auditRows: Array<{ actorUid: string; action: string; targetRef: string; raw: Record<string, unknown> }> = []
  const calls = { createDoc: [] as unknown[], updateDoc: [] as unknown[], processBatch: 0, audit: 0, writeFile: [] as Array<{ path: string; text: string }> }
  let seq = 0

  const shard = (docId: string, content: string, supersedesId?: string) => {
    const job: FakeJob = {
      id: `job-${++seq}`,
      docId,
      fileHash: sha256Hex(Buffer.from(content, 'utf-8')),
      total: chunksPerSheet,
      remaining: chunksPerSheet,
      ...(supersedesId ? { supersedesId } : {}),
    }
    jobs.push(job)
    return job
  }

  const deps: RunDeps = {
    findDocsByTitle: async (title) => docs.filter((d) => d.title === title).map(({ id, pillar, status }) => ({ id, pillar, status })),
    jobHashesForDoc: async (id) => jobs.filter((j) => j.docId === id).map((j) => j.fileHash),
    countPublishedChunks: async (id) => chunks.filter((c) => c.docId === id && c.status === 'published').length,
    docStatus: async (id) => docs.find((d) => d.id === id)?.status ?? null,
    createDoc: async (user, input) => {
      calls.createDoc.push({ user, input })
      const id = `kb-${++seq}`
      docs.push({ id, title: input.title, pillar: input.pillar, status: 'published' })
      const job = shard(id, input.content)
      return { docId: id, jobId: job.id, total: job.total, remaining: job.remaining }
    },
    updateDoc: async (user, docId, patch) => {
      calls.updateDoc.push({ user, docId, patch })
      const old = docs.find((d) => d.id === docId)
      if (!old) throw new Error('not found')
      const id = `kb-${++seq}`
      docs.push({ id, title: old.title, pillar: old.pillar, status: 'published', supersedes: docId })
      const job = shard(id, patch.content, docId)
      return { docId, newDocId: id, jobId: job.id, total: job.total, remaining: job.remaining }
    },
    processBatch: async (jobId, limit) => {
      calls.processBatch += 1
      const job = jobs.find((j) => j.id === jobId)
      if (!job) throw new Error('job not found')
      if (opts.stallProcess) return { remaining: job.remaining }
      const n = Math.min(limit, job.remaining)
      for (let i = 0; i < n; i++) chunks.push({ docId: job.docId, status: 'published' })
      job.remaining -= n
      if (job.remaining === 0 && job.supersedesId && !opts.skipSupersede) {
        const old = docs.find((d) => d.id === job.supersedesId)
        if (old) old.status = 'superseded'
        for (const c of chunks) if (c.docId === job.supersedesId) c.status = 'superseded'
      }
      return { remaining: job.remaining }
    },
    audit: async (entry) => {
      calls.audit += 1
      if (!opts.swallowAudit) auditRows.push(entry)
    },
    countAuditRows: async () =>
      auditRows.filter((r) => r.actorUid === CLIENT_FACTSHEET_ACTOR && r.action === 'client_factsheet_ingest').length,
    writeFile: (path, text) => {
      calls.writeFile.push({ path, text })
    },
    now: () => new Date('2026-10-19T12:00:00.000Z'),
  }
  return { deps, docs, jobs, chunks, auditRows, calls }
}

const META = { source_label: SOURCE_LABEL, workbook_sha256: WB_SHA }

async function dryFingerprint(kb: ReturnType<typeof makeKb>, sheets: LoadedFactSheet[]) {
  return (await runFactSheetIngest(kb.deps, { mode: 'dry-run', sheets, meta: META, target: 'emulator', reportPath: 'dry.md' })).fingerprint
}

function applyOpts(sheets: LoadedFactSheet[], expectPlan: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    mode: 'apply' as const,
    sheets,
    meta: META,
    target: 'emulator',
    reportPath: 'apply.md',
    ...(expectPlan !== undefined ? { expectPlan } : {}),
    embeddingKeyPresent: true,
    ...extra,
  }
}

const A = fixture('Alpha Residences')
const B = fixture('Beta Tower')

// ─── loadFactSheets ──────────────────────────────────────────────────────────

describe('loadFactSheets', () => {
  it('loads verified sheets with the content verbatim and the sha256 of the exact bytes', () => {
    const loaded = load([A, B])
    expect(loaded).toHaveLength(2)
    expect(loaded[0].content).toBe(A.text)
    expect(loaded[0].sha256).toBe(sha256Hex(Buffer.from(A.text, 'utf-8')))
    expect(loaded[0].chars).toBe(A.text.length)
    expect(loaded[0].content.endsWith('\n')).toBe(true) // no trim, no newline normalisation
  })

  it('does not normalise newlines: a CRLF sheet is refused, not silently rewritten', () => {
    const odd = fixture('Gamma Place')
    odd.text = odd.text.replace(/\n/g, '\r\n') + '  '
    odd.sha256 = sha256Hex(Buffer.from(odd.text, 'utf8'))
    expect(loadFailure([odd])).toContain('source-line-missing')
  })

  const refusals: Array<[string, () => string, string]> = [
    ['sha256 mismatch (tampered bytes)', () => loadFailure([A, B], { [B.file]: B.text + 'x' }), 'sha256-mismatch'],
    [
      'title that is not "{inventoryName} — D2 project facts (client sheet)"',
      () => {
        const bad = { ...A, title: 'Alpha Residences - D2 project facts (client sheet)' }
        return loadFailure([bad])
      },
      'title-mismatch',
    ],
    ['category that differs from the inventory name', () => loadFailure([{ ...A, category: 'Other' }]), 'category-mismatch'],
    [
      'content that does not open with the project heading',
      () => {
        const bad = fixture('Delta House')
        bad.text = 'preamble\n' + bad.text
        bad.sha256 = sha256Hex(Buffer.from(bad.text, 'utf8'))
        return loadFailure([bad])
      },
      'heading-mismatch',
    ],
    [
      'a missing source line',
      () => {
        const bad = fixture('Echo Park')
        bad.text = bad.text.replace(`Source: ${SOURCE_LABEL}.`, 'Source: somewhere else.')
        bad.sha256 = sha256Hex(Buffer.from(bad.text, 'utf8'))
        return loadFailure([bad])
      },
      'source-line-missing',
    ],
    [
      'content over 20,000 characters',
      () => {
        const bad = fixture('Foxtrot Hill', 'x'.repeat(FACTSHEET_MAX_CHARS))
        return loadFailure([bad])
      },
      'too-long',
    ],
    [
      'an email in the content',
      () => {
        const bad = fixture('Golf View', 'Contact someone@example.com')
        return loadFailure([bad])
      },
      'contact-details(email',
    ],
    [
      'a local-format phone number in the content',
      () => loadFailure([fixture('Hotel Row', 'Call 012-000 0000')]),
      'contact-details(phone',
    ],
    ['a path that climbs out of the claim directory', () => loadFailure([{ ...A, file: 'factsheets/../../../etc/passwd' }]), 'unsafe-file-path'],
    ['an absolute path', () => loadFailure([{ ...A, file: '/etc/passwd' }]), 'unsafe-file-path'],
    ['an unreadable file', () => loadFailure([A], {}, manifestOf([{ ...A, file: 'factsheets/missing.md' }])), 'unreadable'],
    [
      'bytes that are not valid UTF-8',
      () => {
        const bad = Buffer.concat([Buffer.from(A.text, 'utf8'), Buffer.from([0xff, 0xfe])])
        return loadFailure([{ ...A, sha256: sha256Hex(bad) }], { [A.file]: bad })
      },
      'not-valid-utf8',
    ],
    ['a duplicate title', () => loadFailure([A, { ...A, docId: 'other', file: 'factsheets/dup.md' }], { 'factsheets/dup.md': A.text }), 'duplicate-title'],
  ]

  for (const [name, run, code] of refusals) {
    it(`refuses the whole run on ${name}`, () => {
      const message = run()
      expect(message).toContain('nothing was ingested')
      expect(message).toContain(code)
    })
  }

  it('refuses everything when one of several sheets is bad, and names titles only', () => {
    const bad = fixture('Golf View', 'Contact someone@example.com')
    let error: unknown
    try {
      load([A, bad, B])
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(FactSheetLoadError)
    const message = (error as Error).message
    expect(message).toContain('Golf View')
    expect(message).not.toContain('someone@example.com')
    expect(message).not.toContain('Freehold') // no content echoed
    expect((error as FactSheetLoadError).failures).toHaveLength(1)
  })

  it('does not echo a title that itself carries a contact detail', () => {
    const dirty = fixture('Call 012-000 0000')
    const message = loadFailure([dirty])
    expect(message).not.toContain('012-000 0000')
  })

  it('reports invalid manifests by path only', () => {
    expect(() => loadFactSheets({ meta: {}, sheets: [] }, () => new Uint8Array())).toThrow(/offending paths/)
    expect(() => loadFactSheets({ ...manifestOf([A]), meta: { schema: 'factsheets/2', source_label: 'x', workbook_sha256: WB_SHA } }, () => new Uint8Array())).toThrow(
      /meta\.schema/,
    )
  })

  it('exposes the Contract 3 schema', () => {
    expect(FactSheetManifestSchema.safeParse(manifestOf([A, B])).success).toBe(true)
    expect(FactSheetManifestSchema.safeParse({ ...manifestOf([A]), sheets: [] }).success).toBe(false)
  })
})

// ─── planFactSheets ──────────────────────────────────────────────────────────

describe('planFactSheets', () => {
  const sheets = () => load([A, B])

  it('creates when no finder doc carries the title', async () => {
    const kb = makeKb()
    const plan = await planFactSheets(sheets(), kb.deps)
    expect(plan.map((p) => p.action)).toEqual(['create', 'create'])
  })

  it('ignores superseded docs and docs of other pillars', async () => {
    const kb = makeKb()
    const [sa] = sheets()
    kb.docs.push({ id: 'old', title: sa.title, pillar: 'finder', status: 'superseded' })
    kb.docs.push({ id: 'coach-one', title: sa.title, pillar: 'coach', status: 'published' })
    const plan = await planFactSheets([sa], kb.deps)
    expect(plan[0].action).toBe('create')
  })

  it('is unchanged when exactly one live doc holds a job with the content hash', async () => {
    const kb = makeKb()
    const [sa] = sheets()
    kb.docs.push({ id: 'live', title: sa.title, pillar: 'finder', status: 'published' })
    kb.jobs.push({ id: 'j', docId: 'live', fileHash: sa.sha256, total: 1, remaining: 0 })
    kb.chunks.push({ docId: 'live', status: 'published' })
    const plan = await planFactSheets([sa], kb.deps)
    expect(plan[0]).toMatchObject({ action: 'unchanged', existingDocId: 'live' })
  })

  it('updates (supersedes that id) when the live doc holds a different hash', async () => {
    const kb = makeKb()
    const [sa] = sheets()
    kb.docs.push({ id: 'live', title: sa.title, pillar: 'finder', status: 'published' })
    kb.jobs.push({ id: 'j', docId: 'live', fileHash: 'f'.repeat(64), total: 1, remaining: 0 })
    const plan = await planFactSheets([sa], kb.deps)
    expect(plan[0]).toMatchObject({ action: 'update', existingDocId: 'live' })
  })

  it('refuses when more than one live doc shares the title', async () => {
    const kb = makeKb()
    const [sa] = sheets()
    kb.docs.push({ id: 'one', title: sa.title, pillar: 'finder', status: 'published' })
    kb.docs.push({ id: 'two', title: sa.title, pillar: 'finder', status: 'unpublished' })
    const plan = await planFactSheets([sa], kb.deps)
    expect(plan[0].action).toBe('refuse')
    expect(plan[0].reason).toContain('2-live-docs')
  })

  it('refuses a hash-matching doc that holds no published chunk rather than calling it unchanged', async () => {
    const kb = makeKb()
    const [sa] = sheets()
    kb.docs.push({ id: 'live', title: sa.title, pillar: 'finder', status: 'published' })
    kb.jobs.push({ id: 'j', docId: 'live', fileHash: sa.sha256, total: 3, remaining: 2 })
    const plan = await planFactSheets([sa], kb.deps)
    expect(plan[0]).toMatchObject({ action: 'refuse', reason: 'matching-doc-has-no-published-chunks' })
  })
})

describe('factSheetFingerprint', () => {
  const row = (title: string, action: 'create' | 'update', sha: string) => ({ title, action, sha256: sha, chars: 1, category: title })
  it('ignores order, but changes with any action or hash', () => {
    const p1 = [row('A', 'create', 'a'.repeat(64)), row('B', 'update', 'b'.repeat(64))]
    const base = factSheetFingerprint(p1)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(factSheetFingerprint([...p1].reverse())).toBe(base)
    expect(factSheetFingerprint([row('A', 'update', 'a'.repeat(64)), p1[1]])).not.toBe(base)
    expect(factSheetFingerprint([row('A', 'create', 'c'.repeat(64)), p1[1]])).not.toBe(base)
  })
})

// ─── dry run ─────────────────────────────────────────────────────────────────

describe('runFactSheetIngest: dry run', () => {
  it('makes zero calls to createDoc, updateDoc, processBatch or audit, and writes a fingerprinted report', async () => {
    const kb = makeKb()
    const sheets = load([A, B])
    const result = await runFactSheetIngest(kb.deps, { mode: 'dry-run', sheets, meta: META, target: 'live', reportPath: 'dry.md' })

    expect(kb.calls.createDoc).toHaveLength(0)
    expect(kb.calls.updateDoc).toHaveLength(0)
    expect(kb.calls.processBatch).toBe(0)
    expect(kb.calls.audit).toBe(0)

    expect(kb.calls.writeFile).toHaveLength(1)
    const report = kb.calls.writeFile[0].text
    expect(report).toContain(result.fingerprint)
    expect(report).toContain('| Title | Action | Chars |')
    expect(report).toContain(`| ${A.title} | create | ${A.text.length} |`)
    expect(report).toContain('create 2, update 0, unchanged 0, refuse 0, total 2')
    // never content
    expect(report).not.toContain('Freehold')
    expect(report).not.toContain('- Tenure')
    expect(scanForContactDetails(report)).toEqual([])
  })

  it('reports a refused sheet with its reason', async () => {
    const kb = makeKb()
    const [sa] = load([A])
    kb.docs.push({ id: 'one', title: sa.title, pillar: 'finder', status: 'published' })
    kb.docs.push({ id: 'two', title: sa.title, pillar: 'finder', status: 'published' })
    const result = await runFactSheetIngest(kb.deps, { mode: 'dry-run', sheets: [sa], meta: META, target: 'live', reportPath: 'dry.md' })
    expect(result.counts.refuse).toBe(1)
    expect(kb.calls.writeFile[0].text).toContain('## Refused')
  })

  it('refuses to render a report that would carry a contact detail', () => {
    expect(() =>
      renderFactSheetReport({
        mode: 'dry-run',
        target: 'live',
        fingerprint: 'a'.repeat(64),
        generatedAt: '2026-10-19T12:00:00.000Z',
        sourceLabel: SOURCE_LABEL,
        workbookSha256: WB_SHA,
        plan: [{ title: 'Call 012-000 0000', action: 'create', sha256: 'a'.repeat(64), chars: 1, category: 'x' }],
      }),
    ).toThrow(/contact-detail scan hit/)
  })
})

// ─── apply ───────────────────────────────────────────────────────────────────

describe('runFactSheetIngest: apply refusals (zero writes)', () => {
  const noWrites = (kb: ReturnType<typeof makeKb>) => {
    expect(kb.calls.createDoc).toHaveLength(0)
    expect(kb.calls.updateDoc).toHaveLength(0)
    expect(kb.calls.processBatch).toBe(0)
    expect(kb.calls.audit).toBe(0)
    expect(kb.calls.writeFile).toHaveLength(0)
  }

  it('refuses without --expect-plan', async () => {
    const kb = makeKb()
    await expect(runFactSheetIngest(kb.deps, applyOpts(load([A, B]), undefined))).rejects.toBeInstanceOf(FactSheetApplyRefused)
    noWrites(kb)
  })

  it('refuses a fingerprint that differs', async () => {
    const kb = makeKb()
    await expect(runFactSheetIngest(kb.deps, applyOpts(load([A, B]), '0'.repeat(64)))).rejects.toThrow(/does not match/)
    noWrites(kb)
  })

  it('refuses when the live state changed after the approved dry run', async () => {
    const kb = makeKb()
    const sheets = load([A, B])
    const fp = await dryFingerprint(kb, sheets)
    kb.calls.writeFile.length = 0
    // someone creates Alpha between the dry run and the apply
    kb.docs.push({ id: 'late', title: sheets[0].title, pillar: 'finder', status: 'published' })
    kb.jobs.push({ id: 'jl', docId: 'late', fileHash: 'e'.repeat(64), total: 1, remaining: 0 })
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/does not match/)
    noWrites(kb)
  })

  it('refuses when the plan contains a refuse', async () => {
    const kb = makeKb()
    const sheets = load([A])
    kb.docs.push({ id: 'one', title: sheets[0].title, pillar: 'finder', status: 'published' })
    kb.docs.push({ id: 'two', title: sheets[0].title, pillar: 'finder', status: 'published' })
    const fp = await dryFingerprint(kb, sheets)
    kb.calls.writeFile.length = 0
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/refused by the plan/)
    noWrites(kb)
  })

  it('refuses when the embedding key is not confirmed', async () => {
    const kb = makeKb()
    const sheets = load([A])
    const fp = await dryFingerprint(kb, sheets)
    kb.calls.writeFile.length = 0
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp, { embeddingKeyPresent: false }))).rejects.toThrow(/embedding key/)
    noWrites(kb)
  })
})

describe('runFactSheetIngest: apply', () => {
  it('creates, drives processBatch(jobId, 5) to zero, audits once per sheet, and verifies chunks', async () => {
    const kb = makeKb({ chunksPerSheet: 7 })
    const sheets = load([A, B])
    const fp = await dryFingerprint(kb, sheets)
    kb.calls.writeFile.length = 0

    const result = await runFactSheetIngest(kb.deps, applyOpts(sheets, fp))

    expect(kb.calls.createDoc).toHaveLength(2)
    const first = kb.calls.createDoc[0] as { user: unknown; input: Record<string, unknown> }
    expect(first.user).toEqual({ uid: CLIENT_FACTSHEET_ACTOR, role: 'admin', tenantId: 'd2' })
    expect(first.input).toEqual({
      title: A.title,
      content: A.text, // verbatim
      lang: 'en',
      pillar: 'finder',
      category: A.category,
    })
    expect(kb.calls.updateDoc).toHaveLength(0)
    // 7 chunks at 5 per call = 2 calls per sheet
    expect(kb.calls.processBatch).toBe(4)
    expect(kb.chunks.filter((c) => c.status === 'published')).toHaveLength(14)
    expect(result.counts).toMatchObject({ create: 2, update: 0, unchanged: 0, refuse: 0 })
    expect(result.outcomes.map((o) => o.publishedChunks)).toEqual([7, 7])

    expect(kb.auditRows).toHaveLength(2)
    expect(kb.auditRows[0]).toMatchObject({
      actorUid: CLIENT_FACTSHEET_ACTOR,
      action: 'client_factsheet_ingest',
      targetRef: `kbDocs/${result.outcomes[0].docId}`,
      raw: { title: A.title, sha256: A.sha256 },
    })
    expect(Object.keys(kb.auditRows[0].raw).sort()).toEqual(['sha256', 'title'])
    expect(result.auditRows).toEqual({ expected: 2, found: 2 })

    const report = kb.calls.writeFile[0].text
    expect(report).toContain('# Client fact sheets: apply')
    expect(report).toContain('expected 2, found 2')
    expect(report).not.toContain('Freehold')
  })

  it('a second plan run after the apply reports every sheet as unchanged', async () => {
    const kb = makeKb()
    const sheets = load([A, B])
    const fp = await dryFingerprint(kb, sheets)
    await runFactSheetIngest(kb.deps, applyOpts(sheets, fp))

    const again = await runFactSheetIngest(kb.deps, { mode: 'dry-run', sheets, meta: META, target: 'emulator', reportPath: 'again.md' })
    expect(again.plan.map((p) => p.action)).toEqual(['unchanged', 'unchanged'])
    expect(again.counts).toMatchObject({ create: 0, update: 0, unchanged: 2 })

    // and an apply of that no-op plan creates nothing
    const createsBefore = kb.calls.createDoc.length
    await runFactSheetIngest(kb.deps, applyOpts(sheets, again.fingerprint))
    expect(kb.calls.createDoc).toHaveLength(createsBefore)
    expect(kb.calls.updateDoc).toHaveLength(0)
  })

  it('a changed sheet supersedes its previous version and the old doc ends superseded', async () => {
    const kb = makeKb()
    const v1 = load([A, B])
    await runFactSheetIngest(kb.deps, applyOpts(v1, await dryFingerprint(kb, v1)))
    const oldAlphaId = kb.docs.find((d) => d.title === A.title)!.id

    const A2 = fixture('Alpha Residences', '- Furnishing: Fully furnished')
    const v2 = load([A2, B])
    const fp = await dryFingerprint(kb, v2)
    const result = await runFactSheetIngest(kb.deps, applyOpts(v2, fp))

    expect(result.counts).toMatchObject({ create: 0, update: 1, unchanged: 1 })
    expect(kb.calls.updateDoc).toHaveLength(1)
    expect(kb.calls.updateDoc[0]).toMatchObject({ docId: oldAlphaId, patch: { content: A2.text } })
    expect(kb.docs.find((d) => d.id === oldAlphaId)!.status).toBe('superseded')
    expect(result.outcomes[0]).toMatchObject({ action: 'update', supersededDocId: oldAlphaId })
    expect(kb.auditRows).toHaveLength(3) // 2 creates + 1 update

    // and now everything is unchanged again
    const again = await runFactSheetIngest(kb.deps, { mode: 'dry-run', sheets: v2, meta: META, target: 'emulator', reportPath: 'x.md' })
    expect(again.plan.map((p) => p.action)).toEqual(['unchanged', 'unchanged'])
  })

  it('raises an error when processBatch makes no progress', async () => {
    const kb = makeKb({ stallProcess: true })
    const sheets = load([A])
    const fp = await dryFingerprint(kb, sheets)
    kb.calls.writeFile.length = 0
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/no progress/)
    expect(kb.calls.processBatch).toBe(1) // stops at once, never spins
    // a failure report is still written, titles only
    expect(kb.calls.writeFile[0].text).toContain('## FAILED')
    expect(kb.auditRows).toHaveLength(0)
  })

  it('fails the post-apply check when the new doc has no published chunk', async () => {
    const kb = makeKb()
    const sheets = load([A])
    const fp = await dryFingerprint(kb, sheets)
    const real = kb.deps.countPublishedChunks
    kb.deps.countPublishedChunks = async (id) => (id.startsWith('kb-') ? 0 : real(id))
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/0 published chunk/)
    expect(kb.auditRows).toHaveLength(0)
  })

  it('fails the post-apply check when an update leaves the old doc un-superseded', async () => {
    const kb = makeKb({ skipSupersede: true })
    const v1 = load([A])
    await runFactSheetIngest(kb.deps, applyOpts(v1, await dryFingerprint(kb, v1)))
    const v2 = load([fixture('Alpha Residences', '- Furnishing: Partly')])
    const fp = await dryFingerprint(kb, v2)
    await expect(runFactSheetIngest(kb.deps, applyOpts(v2, fp))).rejects.toThrow(/expected "superseded"/)
  })

  it('exits non-zero in effect when audit rows are swallowed (count mismatch)', async () => {
    const kb = makeKb({ swallowAudit: true })
    const sheets = load([A, B])
    const fp = await dryFingerprint(kb, sheets)
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/audit row count mismatch: expected 2, found 0/)
    expect(kb.calls.audit).toBe(2) // it did try
  })

  it('stops at the first failing sheet and leaves completed sheets unchanged on re-plan', async () => {
    const kb = makeKb()
    const sheets = load([A, B])
    const fp = await dryFingerprint(kb, sheets)
    const realCreate = kb.deps.createDoc
    let n = 0
    kb.deps.createDoc = vi.fn(async (user, input) => {
      if (++n === 2) throw new Error('boom')
      return realCreate(user, input)
    })
    await expect(runFactSheetIngest(kb.deps, applyOpts(sheets, fp))).rejects.toThrow(/apply stopped after 1 of 2/)
    kb.deps.createDoc = realCreate
    const again = await planFactSheets(sheets, kb.deps)
    expect(again.map((p) => p.action)).toEqual(['unchanged', 'create'])
  })
})

// ─── equivalence over the committed claim-dir files ─────────────────────────

const CLAIM_DIR = resolve(process.cwd(), '.planning/quick/quick-kayinleong-096')

describe('equivalence with the committed claim-dir files', () => {
  it('scanForContactDetails agrees with every vector in pii-vectors.json', () => {
    const vectors = JSON.parse(readFileSync(resolve(CLAIM_DIR, 'pii-vectors.json'), 'utf8')) as { hit: string[]; miss: string[] }
    expect(vectors.hit.length).toBeGreaterThan(0)
    expect(vectors.miss.length).toBeGreaterThan(0)
    for (const text of vectors.hit) {
      expect(scanForContactDetails(text), `hit vector: ${text}`).not.toEqual([])
    }
    for (const text of vectors.miss) {
      expect(scanForContactDetails(text), `miss vector: ${text}`).toEqual([])
    }
  })

  it('every committed fact sheet in factsheets/index.json loads with zero hits', () => {
    const manifest: unknown = JSON.parse(readFileSync(resolve(CLAIM_DIR, 'factsheets/index.json'), 'utf8'))
    const loaded = loadFactSheets(manifest, (rel) => readFileSync(resolve(CLAIM_DIR, rel)))
    expect(loaded.length).toBeGreaterThan(0)
    for (const sheet of loaded) {
      expect(scanForContactDetails(sheet.content)).toEqual([])
      expect(sheet.chars).toBeLessThanOrEqual(FACTSHEET_MAX_CHARS)
      expect(sheet.title).toBe(`${sheet.inventoryName} — D2 project facts (client sheet)`)
    }
    // and the real set plans to all-create on an empty KB, with a stable fingerprint
    const kb = makeKb()
    return planFactSheets(loaded, kb.deps).then((plan) => {
      expect(plan.every((p) => p.action === 'create')).toBe(true)
      expect(factSheetFingerprint(plan)).toBe(factSheetFingerprint([...plan].reverse()))
    })
  })
})
