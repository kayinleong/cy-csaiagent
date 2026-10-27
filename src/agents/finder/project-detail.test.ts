/**
 * project-detail.test.ts — the by-id lookup and the Details-button fix
 * (quick-kayinleong-088).
 *
 * TWO defects are pinned here, and the first test REPRODUCES the old behaviour rather
 * than asserting the new one, because a test that only checks the new path passes
 * vacuously if the old path was never actually broken:
 *
 *   1. THE ROW-37 BUG. The Details button pushed a canned sentence back through a normal
 *      Finder turn, so the project was resolved by re-running `searchProjects` — a
 *      semantic re-rank whose top `MAX_MATCHES` (8) is all the model ever sees. On a
 *      50-row result, tapping row 37 handed the model eight OTHER projects and it
 *      correctly reported it could not find the one that had just been clicked.
 *      `it('OLD BEHAVIOUR …')` below demonstrates that failure on a real 50-project
 *      search; the test after it shows `getProjectDetail` resolving the same ID.
 *
 *   2. OUTPUT DEPTH. Every other Finder path produces `ProjectMatch`, which drops
 *      `description` — the whole Skool write-up, and the only place the Quick Facts a D2
 *      agent needs actually live. `projectDetail` carries it, plus `unitTypes`, the psf
 *      rate, the collateral, and the finder `kbChunks` sales-kit extracts that no Finder
 *      tool queried before this claim.
 *
 * All Gemini embedding and Firestore calls are mocked — `npx vitest run` must stay green
 * with no credentials.
 *
 * Run: npx vitest run src/agents/finder/project-detail.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectDoc } from '@/src/firebase/collections'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VEC_DIM = 64
const PROJECT_COUNT = 50
/** "Row 37 of 50" — the reported failure, 1-indexed for the agent, 36 here. */
const TARGET_INDEX = 36
const TARGET_ID = `proj-${TARGET_INDEX}`
const TARGET_NAME = 'Imperial Residences Pavilion Damansara Heights'

/**
 * The verbatim shape of the stored write-up: this is what `description` holds and what
 * NO Finder tool handed the model before this claim.
 */
const TARGET_DESCRIPTION = [
  'Quick Facts:',
  'Project Name: Imperial Residences',
  'Developer: Imperial Land Sdn Bhd',
  'Land Tenure: Freehold',
  'Maintenance Fee: RM0.88 psf (inclusive of sinking fund)',
  'Booking Fee: RM100,000 standard / RM200,000 penthouse',
  'Furnishing: fully fitted kitchen, Bosch appliances',
].join('\n')

/** One vector with all its weight in a single dimension — makes ranking exact. */
function unitVector(dim: number): number[] {
  return Array.from({ length: VEC_DIM }, (_, i) => (i === dim ? 1 : 0))
}

function makeProject(i: number): ProjectDoc {
  const isTarget = i === TARGET_INDEX
  return {
    tenantId: 'd2',
    name: isTarget ? TARGET_NAME : `Project ${i}`,
    status: 'active',
    priceBand: '800k_1.2m',
    priceValue: 900_000 + i,
    tenure: 'Freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: isTarget ? TARGET_DESCRIPTION : `Write-up for project ${i}`,
    locationText: 'Kuala Lumpur',
    bedrooms: 2,
    sizeMinSqft: isTarget ? 504 : null,
    sizeMaxSqft: isTarget ? 1_206 : null,
    pricePsfMin: isTarget ? 1_700 : null,
    pricePsfMax: isTarget ? 2_300 : null,
    priceProvenance: isTarget ? 'psf_only' : 'unknown',
    unitTypes: isTarget
      ? [
          {
            label: 'Studio',
            sizeSqft: 504,
            bedrooms: null,
            priceMinRM: 1_240_000,
            priceMaxRM: 1_800_000,
            raw: '504sf Studio - from RM1.24mil to RM1.8mil',
          },
          {
            label: '1+1 Room',
            sizeSqft: 770,
            bedrooms: 1,
            priceMinRM: 1_800_000,
            priceMaxRM: 2_700_000,
            raw: '770sf 1+1 Room - from RM1.8mil to RM2.7mil',
          },
        ]
      : [],
    // Weight in dimension `i` — the query vector below decides the ranking.
    embedding: unitVector(i % VEC_DIM),
  }
}

const PROJECTS: Record<string, ProjectDoc> = Object.fromEntries(
  Array.from({ length: PROJECT_COUNT }, (_, i) => [`proj-${i}`, makeProject(i)]),
)

/**
 * The query vector for the Details sentence.
 *
 * Weight decreases with the dimension index, so project `i` scores `1 - i/100`: a strict,
 * known ranking in which the target sits at rank 37 of 50 and EVERY project clears
 * `MIN_RELEVANCE` (worst is 0.51 vs a 0.20 floor). That matters — this must reproduce
 * "ranked too low for the model to see", not "dropped by the relevance floor", or it would
 * be demonstrating a different bug.
 */
const QUERY_VECTOR = Array.from({ length: VEC_DIM }, (_, i) =>
  i < PROJECT_COUNT ? 1 - i / 100 : 0,
)

/** The literal payload the Details button sends, after the quick-088 retarget. */
const DETAILS_SENTENCE =
  `Full details for ${TARGET_NAME} — projectId: ${TARGET_ID}. ` +
  'Layouts and sizes, pricing, the key facts, and all supporting documents.'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockEmbedText: vi.fn(),
  mockProjectsGet: vi.fn(),
  mockDocGet: vi.fn(),
  mockCollateralGet: vi.fn(),
  mockRetrieve: vi.fn(),
  /** kbDocs/{id} read — decides which retrieved chunks belong to the project (quick-100). */
  mockKbDocGet: vi.fn(),
  /** kbDocs where(title == …) — the client fact-sheet lookup (quick-101). */
  mockFactSheetDocsGet: vi.fn(),
  /** kbChunks where(docId == …) — the fact sheet's chunks (quick-101). */
  mockFactSheetChunksGet: vi.fn(),
  /** Every where(field, op, value) on kbDocs / kbChunks, to prove the exact-title read. */
  kbWheres: [] as Array<[string, string, unknown]>,
  /** Last doc id passed to projectsRef().doc(...) — proves the read is BY ID. */
  docIds: [] as string[],
}))

vi.mock('@/src/rag/embed', () => ({
  embedText: mocks.mockEmbedText,
  EMBED_DIM: 1024,
}))

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { collection: vi.fn(() => ({ where: vi.fn() })) },
  adminAuth: {},
  remoteConfig: vi.fn(),
}))

vi.mock('@/src/firebase/collections', () => {
  const whereFn: ReturnType<typeof vi.fn> = vi.fn(() => ({
    where: whereFn,
    orderBy: whereFn,
    get: mocks.mockProjectsGet,
  }))
  return {
    projectsRef: vi.fn(() => ({
      where: whereFn,
      // The by-name lookup's name-field read (quick-kayinleong-102).
      select: vi.fn(() => ({ get: mocks.mockProjectsGet })),
      doc: vi.fn((id: string) => {
        mocks.docIds.push(id)
        return { get: () => mocks.mockDocGet(id) }
      }),
    })),
    collateralRef: vi.fn(() => ({ where: vi.fn(() => ({ get: mocks.mockCollateralGet })) })),
    kbDocsRef: vi.fn(() => ({
      doc: vi.fn((id: string) => ({ get: () => mocks.mockKbDocGet(id) })),
      where: vi.fn((field: string, op: string, value: unknown) => {
        mocks.kbWheres.push([field, op, value])
        return { get: mocks.mockFactSheetDocsGet }
      }),
    })),
    kbChunksRef: vi.fn(() => ({
      where: vi.fn((field: string, op: string, value: unknown) => {
        mocks.kbWheres.push([field, op, value])
        return { get: mocks.mockFactSheetChunksGet }
      }),
    })),
    TENANT_ID: 'd2',
    PRICE_BANDS: ['price_unknown', 'under_500k', '500k_800k', '800k_1.2m', 'above_1.2m'],
    priceBandFor: vi.fn((p: number) => (p <= 0 ? 'price_unknown' : '800k_1.2m')),
  }
})

// The REAL buildCitations / isRetrievalMiss — only `retrieve` is stubbed, so the citation
// shape under test is the production one.
vi.mock('@/src/rag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/rag')>()),
  retrieve: mocks.mockRetrieve,
}))

/** A Firestore-shaped query snapshot over the whole 50-project fixture set. */
function projectSnap() {
  const ids = Object.keys(PROJECTS)
  return {
    empty: ids.length === 0,
    docs: ids.map((id) => ({
      id,
      data: () => PROJECTS[id],
      get: (field: keyof ProjectDoc) => PROJECTS[id][field],
    })),
  }
}

function kbChunk(i: number, text: string) {
  return {
    chunkId: `chunk-${i}`,
    docId: `salekit-${i}`,
    text,
    lang: 'en' as const,
    score: 0.83 - i * 0.01,
    pillar: 'finder' as const,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.docIds.length = 0
  mocks.mockEmbedText.mockResolvedValue(QUERY_VECTOR)
  mocks.mockProjectsGet.mockResolvedValue(projectSnap())
  mocks.mockDocGet.mockImplementation(async (id: string) => ({
    exists: id in PROJECTS,
    data: () => PROJECTS[id],
  }))
  mocks.mockCollateralGet.mockResolvedValue({ empty: true, docs: [] })
  mocks.mockRetrieve.mockResolvedValue([])
  // By default no client fact sheet is on record, so the ranked extracts are all there is.
  mocks.kbWheres.length = 0
  mocks.mockFactSheetDocsGet.mockResolvedValue({ docs: [] })
  mocks.mockFactSheetChunksGet.mockResolvedValue({ docs: [] })
  // By default every retrieved chunk's parent document is the target project's own sales kit.
  mocks.mockKbDocGet.mockImplementation(async (id: string) => ({
    id,
    exists: true,
    data: () => ({ title: `${TARGET_NAME} — Sales Kit.pdf`, category: TARGET_NAME }),
  }))
})

// ─── 1. The row-37 bug: old behaviour vs new ──────────────────────────────────

describe('the Details button resolves the project it was clicked on', () => {
  it('OLD BEHAVIOUR (reproduced): the semantic re-run hides row 37 from the model', async () => {
    const { searchProjects, MAX_MATCHES } = await import('@/src/inventory/search')
    const { makeSearchProjectsTool } = await import('./tools')

    // Exactly what the old path did: the canned Details sentence as freeText, every other
    // criterion null, because the button carried no structured criteria.
    const input = {
      segment: 'unknown' as const,
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      financingNote: null,
      nationality: 'unknown' as const,
      bumiputera: null,
      locationPref: null,
      tenurePref: null,
      bedrooms: null,
      freeText: DETAILS_SENTENCE,
    }

    const result = await searchProjects(input)
    expect(result.found).toBe(true)
    if (!result.found) return

    // The project IS in the raw result — it is not filtered out, just ranked 37th.
    expect(result.matches).toHaveLength(PROJECT_COUNT)
    expect(result.matches.findIndex((m) => m.projectId === TARGET_ID)).toBe(TARGET_INDEX)

    // But the MODEL only ever sees `MAX_MATCHES`. Go through the real tool projection
    // rather than slicing by hand, so this is the actual model-visible payload.
    const t = makeSearchProjectsTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    const toModelOutput = t.toModelOutput as NonNullable<typeof t.toModelOutput>
    // `as unknown as` is required: toModelOutput's declared return is the AI SDK's
    // LanguageModelV2ToolResultOutput union, whose `content` arm does not overlap this
    // shape, so a direct assertion is rejected. Narrowing to the shape this tool actually
    // returns is the point of the test.
    const view = toModelOutput((await execute(input, {} as never)) as never) as unknown as {
      value: { matches: Array<{ projectId: string }> }
    }

    expect(view.value.matches).toHaveLength(MAX_MATCHES)
    // ── THE BUG ── the clicked project is absent from everything the model can cite,
    // so the only correct thing it can say is that it cannot find the project.
    expect(view.value.matches.map((m) => m.projectId)).not.toContain(TARGET_ID)
    // And the eight it DOES get are eight different projects.
    expect(view.value.matches[0].projectId).toBe('proj-0')
  })

  it('NEW BEHAVIOUR: getProjectDetail resolves that same ID by direct read', async () => {
    const { getProjectDetail } = await import('@/src/inventory/search')

    const detail = await getProjectDetail(TARGET_ID)

    expect(detail.found).toBe(true)
    if (!detail.found) return
    expect(detail.project.projectId).toBe(TARGET_ID)
    expect(detail.project.name).toBe(TARGET_NAME)
    // A BY-ID read, not a query: no embedding call, no scan, no ranking to lose.
    expect(mocks.docIds).toEqual([TARGET_ID])
    expect(mocks.mockEmbedText).not.toHaveBeenCalled()
    expect(mocks.mockProjectsGet).not.toHaveBeenCalled()
  })

  it('rank cannot affect it — every one of the 50 projects resolves by ID', async () => {
    const { getProjectDetail } = await import('@/src/inventory/search')
    for (const id of Object.keys(PROJECTS)) {
      const d = await getProjectDetail(id)
      expect(d.found).toBe(true)
      if (d.found) expect(d.project.projectId).toBe(id)
    }
  })
})

// ─── 2. What the tool returns ─────────────────────────────────────────────────

describe('projectDetail tool payload', () => {
  async function runDetail(projectId: string, question?: string) {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    return execute({ projectId, question: question ?? null }, {} as never)
  }

  it('carries the full write-up that ProjectMatch drops', async () => {
    const out = (await runDetail(TARGET_ID)) as {
      found: true
      project: { description: string }
    }
    expect(out.found).toBe(true)
    expect(out.project.description).toBe(TARGET_DESCRIPTION)
    // The specific facts the stakeholder asked for, all of which were unreachable before.
    expect(out.project.description).toContain('Maintenance Fee: RM0.88 psf')
    expect(out.project.description).toContain('Booking Fee: RM100,000')
    expect(out.project.description).toContain('Developer: Imperial Land Sdn Bhd')
  })

  it('carries unitTypes verbatim, including the raw source line', async () => {
    const out = (await runDetail(TARGET_ID)) as {
      found: true
      project: { unitTypes: Array<{ label: string; sizeSqft: number | null; raw: string }> }
    }
    expect(out.project.unitTypes).toHaveLength(2)
    expect(out.project.unitTypes[0]).toMatchObject({ label: 'Studio', sizeSqft: 504 })
    // `raw` is the audit trail — grounding is mandatory, so it must survive to the model.
    expect(out.project.unitTypes[1].raw).toBe('770sf 1+1 Room - from RM1.8mil to RM2.7mil')
  })

  it('carries the psf rate and its provenance, not a synthesised total', async () => {
    const out = (await runDetail(TARGET_ID)) as {
      found: true
      project: {
        pricePsfMin: number | null
        pricePsfMax: number | null
        priceProvenance: string
        priceValue: number
      }
    }
    expect(out.project.pricePsfMin).toBe(1_700)
    expect(out.project.pricePsfMax).toBe(2_300)
    expect(out.project.priceProvenance).toBe('psf_only')
    // 900_036 in the fixture — carried as stored. The prompt, not the tool, forbids
    // quoting a 0; the tool's job is to report the field faithfully.
    expect(out.project.priceValue).toBe(900_000 + TARGET_INDEX)
  })

  it('NEVER ships the 1024-float embedding', async () => {
    const out = await runDetail(TARGET_ID)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('embedding')
    // Not vacuous: the stored doc really does carry one.
    expect(PROJECTS[TARGET_ID].embedding.length).toBe(VEC_DIM)
    // And structurally absent, not merely stringified away.
    // `as unknown as`: execute()'s declared return includes an AsyncIterable arm, which
    // does not overlap this object shape. The tool returns the object form here.
    const project = (out as unknown as { project: Record<string, unknown> }).project
    expect('embedding' in project).toBe(false)
  })

  it('attaches the ranked collateral', async () => {
    mocks.mockCollateralGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ type: 'whatsapp-media', externalUrl: 'https://x.test/photo.jpg' }) },
        { data: () => ({ type: 'sales-kit', externalUrl: 'https://x.test/kit.pdf' }) },
        // Storage-path-only: not web-addressable, must be omitted (quick-050).
        { data: () => ({ type: 'brochure', storagePath: 'collateral/p/b.pdf' }) },
      ],
    })
    const out = (await runDetail(TARGET_ID)) as {
      found: true
      collateral: Array<{ type: string; url: string }>
    }
    expect(out.collateral).toHaveLength(2)
    // Documents first — an agent forwarding to a lead wants the sales kit, not a photo.
    expect(out.collateral[0].url).toBe('https://x.test/kit.pdf')
    expect(JSON.stringify(out.collateral)).not.toContain('collateral/p/b.pdf')
  })

  it('an unknown projectId is an honest miss, never a substitution', async () => {
    const out = (await runDetail('proj-does-not-exist')) as {
      found: false
      reason: string
      projectId: string
      message: string
    }
    expect(out.found).toBe(false)
    expect(out.reason).toBe('not_found')
    expect(out.projectId).toBe('proj-does-not-exist')
    expect(out.message).toContain('Do not substitute a different project')
  })

  it('a blank projectId is a miss, not a full-collection read', async () => {
    const out = (await runDetail('   ')) as { found: false }
    expect(out.found).toBe(false)
    expect(mocks.mockProjectsGet).not.toHaveBeenCalled()
  })
})

// ─── 3. Non-active projects: the status decision and its guard rail ───────────

describe('non-active projects are readable but flagged', () => {
  async function runDetail(projectId: string) {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    return execute({ projectId, question: null }, {} as never)
  }

  it('a sold_out project resolves AND carries a loud availability warning', async () => {
    // The decision: a detail lookup is not a recommendation, so it does not filter on
    // status — an agent who cannot look a sold-out project up cannot tell a lead it is
    // sold out. The warning is what makes that safe.
    mocks.mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...makeProject(1), status: 'sold_out', name: 'Sold Out Tower' }),
    })

    const out = (await runDetail('proj-sold')) as {
      found: true
      project: { status: string }
      availability?: string
    }
    expect(out.found).toBe(true)
    expect(out.project.status).toBe('sold_out')
    expect(out.availability).toBeDefined()
    expect(out.availability).toContain('NOT AVAILABLE')
    expect(out.availability).toContain('sold_out')
    expect(out.availability).toContain('do NOT')
  })

  it('a hidden project is flagged the same way', async () => {
    mocks.mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...makeProject(2), status: 'hidden' }),
    })
    const out = (await runDetail('proj-hidden')) as { availability?: string }
    expect(out.availability).toContain('hidden')
  })

  it('an active project carries NO warning — the field would lose meaning', async () => {
    const out = (await runDetail(TARGET_ID)) as Record<string, unknown>
    expect('availability' in out).toBe(false)
  })

  it('searchProjects still hard-filters status — the recommendation gate is untouched', async () => {
    // The nuance that makes the status decision defensible: the gate that matters lives
    // in searchProjects, and this claim did not touch it.
    const { searchProjects } = await import('@/src/inventory/search')
    const whereArgs: Array<[string, string, unknown]> = []
    const { projectsRef } = await import('@/src/firebase/collections')
    const whereSpy: ReturnType<typeof vi.fn> = vi.fn((...a: [string, string, unknown]) => {
      whereArgs.push(a)
      return { where: whereSpy, orderBy: whereSpy, get: mocks.mockProjectsGet }
    })
    // Once — the override must not leak into the tests that follow (clearAllMocks resets
    // call history, not implementations).
    vi.mocked(projectsRef).mockReturnValueOnce({ where: whereSpy } as never)

    await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'anything',
    })
    expect(whereArgs).toContainEqual(['status', '==', 'active'])
  })
})

// ─── 4. The sales-kit KB half ─────────────────────────────────────────────────

describe('projectDetail retrieves the finder sales-kit KB', () => {
  async function runDetail(question?: string) {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('ms')
    const execute = t.execute as NonNullable<typeof t.execute>
    return execute({ projectId: TARGET_ID, question: question ?? null }, {} as never)
  }

  it('scopes retrieval to pillar:finder and to the turn language', async () => {
    await runDetail('panel bankers and loan margin')
    expect(mocks.mockRetrieve).toHaveBeenCalledTimes(1)
    const [query, lang, opts] = mocks.mockRetrieve.mock.calls[0]
    // The project NAME anchors the query — that is what makes the chunks project-specific.
    expect(query).toContain(TARGET_NAME)
    expect(query).toContain('panel bankers and loan margin')
    expect(lang).toBe('ms')
    // pillar:finder so a project lookup can never cite a Coach SOP as project data, and a
    // wider candidate pool because foreign chunks are dropped afterwards (quick-100).
    const { KB_CANDIDATES_FOR_DETAIL } = await import('./tools')
    expect(opts).toEqual({ pillar: 'finder', limit: KB_CANDIDATES_FOR_DETAIL })
  })

  it('falls back to the Quick-Facts topics when no question is given', async () => {
    await runDetail()
    const [query] = mocks.mockRetrieve.mock.calls[0]
    expect(query).toContain('maintenance fee')
    expect(query).toContain('panel bankers')
  })

  it('returns chunk IDs so the answer stays citable', async () => {
    mocks.mockRetrieve.mockResolvedValue([
      kbChunk(0, 'Panel Bankers EF for Imperial Residences RA: 1. MBB (Margin up to 90%)'),
      kbChunk(1, 'Maintenance fee RM0.88 psf'),
    ])
    const out = (await runDetail('panel bankers')) as {
      found: true
      kb: { found: boolean; citations: Array<{ chunkId: string }>; context: string }
    }
    expect(out.kb.found).toBe(true)
    expect(out.kb.citations.map((c) => c.chunkId)).toEqual(['chunk-0', 'chunk-1'])
    expect(out.kb.context).toContain('[KB:chunk-0]')
    expect(out.kb.context).toContain('Margin up to 90%')
  })

  it('a retrieval miss is reported honestly, not silently dropped', async () => {
    mocks.mockRetrieve.mockResolvedValue([])
    const out = (await runDetail()) as { found: true; kb: { found: boolean; context: string } }
    expect(out.kb.found).toBe(false)
    expect(out.kb.context).toBe('')
  })

  it('caps the chunk count and each chunk length', async () => {
    const { KB_CHUNKS_FOR_DETAIL, KB_CHUNK_CHARS } = await import('./tools')
    mocks.mockRetrieve.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => kbChunk(i, 'x'.repeat(5_000))),
    )
    const out = (await runDetail()) as {
      found: true
      kb: { citations: unknown[]; context: string }
    }
    expect(out.kb.citations).toHaveLength(KB_CHUNKS_FOR_DETAIL)
    // The tool result is re-sent on every step of the 5-step loop, so an uncapped chunk
    // is paid for five times. 5 chunks x 1,600 chars + the [KB:id] headers and separators.
    expect(out.kb.context.length).toBeLessThan(KB_CHUNKS_FOR_DETAIL * (KB_CHUNK_CHARS + 100))
    expect(out.kb.context).not.toContain('x'.repeat(KB_CHUNK_CHARS + 1))
  })

  it('a KB failure degrades to a miss — it never fails the whole lookup', async () => {
    mocks.mockRetrieve.mockRejectedValue(new Error('findNearest exploded'))
    const out = (await runDetail()) as {
      found: true
      project: { name: string }
      kb: { found: boolean }
    }
    // The stored record is still ground truth; the agent just gets no sales-kit prose.
    expect(out.found).toBe(true)
    expect(out.project.name).toBe(TARGET_NAME)
    expect(out.kb.found).toBe(false)
  })
})

// ─── quick-kayinleong-100: extracts come from THIS project only ───────────────

describe('projectDetail keeps only the asked-about project\'s KB extracts', () => {
  async function runDetail() {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    return (await execute({ projectId: TARGET_ID, question: null }, {} as never)) as {
      found: true
      kb: { found: boolean; citations: Array<{ chunkId: string }>; context: string }
    }
  }
  /** Parent documents keyed by the kbChunk fixture's docId (`salekit-<i>`). */
  function parents(byDoc: Record<string, { title: string; category?: string } | null>) {
    mocks.mockKbDocGet.mockImplementation(async (id: string) => {
      const d = byDoc[id]
      return { id, exists: d !== null && d !== undefined, data: () => d ?? undefined }
    })
  }

  it('UAT re-test: a neighbouring project\'s fact sheet is dropped, own chunks keep their order', async () => {
    mocks.mockRetrieve.mockResolvedValue([
      kbChunk(0, 'Developer: UOA Development Bhd (Master Developer of Bangsar South)'),
      kbChunk(1, 'Maintenance fee RM0.88 psf'),
      kbChunk(2, 'Panel Bankers EF: MBB'),
    ])
    parents({
      'salekit-0': { title: 'St. Regis Residences Kuala Lumpur — D2 project facts (client sheet)' },
      'salekit-1': { title: `${TARGET_NAME} — D2 project facts (client sheet)` },
      'salekit-2': { title: `WhatsApp — ${TARGET_NAME}` },
    })
    const out = await runDetail()
    expect(out.kb.citations.map((c) => c.chunkId)).toEqual(['chunk-1', 'chunk-2'])
    expect(out.kb.context).not.toContain('UOA Development')
  })

  it('a document whose category is the project name is kept even with a variant title', async () => {
    mocks.mockRetrieve.mockResolvedValue([kbChunk(0, 'Booking fee RM5,000')])
    parents({ 'salekit-0': { title: 'WhatsApp — Imperial PDH group', category: TARGET_NAME } })
    expect((await runDetail()).kb.citations.map((c) => c.chunkId)).toEqual(['chunk-0'])
  })

  it('when every candidate is foreign, the extract is an honest miss', async () => {
    mocks.mockRetrieve.mockResolvedValue([kbChunk(0, 'Developer: CCCG joint-venture with WCT')])
    parents({ 'salekit-0': { title: 'Senja The Jewel Collection — D2 project facts (client sheet)' } })
    const out = await runDetail()
    expect(out.kb.found).toBe(false)
    expect(out.kb.context).toBe('')
  })

  it('if the parent documents cannot be read, nothing unscoped leaks through', async () => {
    mocks.mockRetrieve.mockResolvedValue([kbChunk(0, 'Developer: someone else')])
    mocks.mockKbDocGet.mockRejectedValue(new Error('kbDocs read failed'))
    const out = await runDetail()
    expect(out.kb.found).toBe(false)
    expect(out.kb.context).toBe('')
  })
})

// ─── quick-kayinleong-101: the client fact sheet is always attached ──────────

describe('projectDetail always attaches the project\'s client fact sheet', () => {
  const SHEET_TITLE = `${TARGET_NAME} — D2 project facts (client sheet)`

  async function runDetail() {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    return (await execute({ projectId: TARGET_ID, question: null }, {} as never)) as {
      found: true
      kb: { found: boolean; citations: Array<{ chunkId: string }>; context: string }
    }
  }
  function sheetDocs(...docs: Array<{ id: string; status?: string; pillar?: string }>) {
    mocks.mockFactSheetDocsGet.mockResolvedValue({
      docs: docs.map((d) => ({
        id: d.id,
        data: () => ({ title: SHEET_TITLE, status: d.status ?? 'published', pillar: d.pillar ?? 'finder' }),
      })),
    })
  }
  function sheetChunks(...chunks: Array<{ id: string; index: number; text: string; status?: string }>) {
    mocks.mockFactSheetChunksGet.mockResolvedValue({
      docs: chunks.map((c) => ({
        id: c.id,
        data: () => ({
          docId: 'factsheet-doc',
          text: c.text,
          lang: 'en',
          pillar: 'finder',
          category: TARGET_NAME,
          status: c.status ?? 'published',
          chunkIndex: c.index,
        }),
      })),
    })
  }

  it('2026-10-27 re-test: the sheet is attached even when the similarity search misses it', async () => {
    sheetDocs({ id: 'factsheet-doc' })
    sheetChunks(
      { id: 'fs-1', index: 1, text: '## unit types | Type C1 | 1,184 sf |' },
      { id: 'fs-0', index: 0, text: '- Land title: Commercial (HDA)' },
    )
    mocks.mockRetrieve.mockResolvedValue([])
    const out = await runDetail()
    expect(out.kb.found).toBe(true)
    // Document order, read by the exact title the ingest writes.
    expect(out.kb.citations.map((c) => c.chunkId)).toEqual(['fs-0', 'fs-1'])
    expect(out.kb.context).toContain('[KB:fs-0]\n- Land title: Commercial (HDA)')
    expect(mocks.kbWheres).toContainEqual(['title', '==', SHEET_TITLE])
    expect(mocks.kbWheres).toContainEqual(['docId', '==', 'factsheet-doc'])
  })

  it('the sheet comes first, a chunk the search also found is not repeated, and the ranked fill stays capped', async () => {
    const { KB_CHUNKS_FOR_DETAIL } = await import('./tools')
    sheetDocs({ id: 'factsheet-doc' })
    sheetChunks({ id: 'chunk-2', index: 0, text: '- Developer: Imperial Land Sdn Bhd' })
    mocks.mockRetrieve.mockResolvedValue(Array.from({ length: 8 }, (_, i) => kbChunk(i, `sales kit ${i}`)))
    const out = await runDetail()
    const ids = out.kb.context.match(/\[KB:[^\]]+\]/g) ?? []
    expect(ids[0]).toBe('[KB:chunk-2]')
    expect(ids.filter((id) => id === '[KB:chunk-2]')).toHaveLength(1)
    expect(ids).toHaveLength(1 + KB_CHUNKS_FOR_DETAIL)
    expect(out.kb.citations[0].chunkId).toBe('chunk-2')
  })

  it('no sheet, or two live sheets with the same title, attaches nothing from the sheet', async () => {
    mocks.mockRetrieve.mockResolvedValue([kbChunk(0, 'Maintenance fee RM0.88 psf')])
    sheetChunks({ id: 'fs-0', index: 0, text: '- Tenure: Freehold' })
    for (const docs of [[], [{ id: 'a' }, { id: 'b' }]]) {
      sheetDocs(...docs)
      const out = await runDetail()
      expect(out.kb.citations.map((c) => c.chunkId)).toEqual(['chunk-0'])
    }
  })

  it('an unpublished or non-Finder document, or an unpublished chunk, is never attached', async () => {
    mocks.mockRetrieve.mockResolvedValue([])
    sheetChunks({ id: 'fs-0', index: 0, text: '- Tenure: Freehold' })
    sheetDocs({ id: 'factsheet-doc', status: 'superseded' })
    expect((await runDetail()).kb.found).toBe(false)
    sheetDocs({ id: 'factsheet-doc', pillar: 'coach' })
    expect((await runDetail()).kb.found).toBe(false)
    sheetDocs({ id: 'factsheet-doc' })
    sheetChunks({ id: 'fs-0', index: 0, text: '- Tenure: Freehold', status: 'superseded' })
    expect((await runDetail()).kb.found).toBe(false)
  })

  it('caps the sheet at FACT_SHEET_CHUNKS_MAX chunks', async () => {
    const { FACT_SHEET_CHUNKS_MAX } = await import('./tools')
    sheetDocs({ id: 'factsheet-doc' })
    sheetChunks(...Array.from({ length: FACT_SHEET_CHUNKS_MAX + 3 }, (_, i) => ({ id: `fs-${i}`, index: i, text: `part ${i}` })))
    const out = await runDetail()
    expect(out.kb.context.match(/\[KB:fs-/g)).toHaveLength(FACT_SHEET_CHUNKS_MAX)
  })

  it('a failed sheet read loses only the sheet; the ranked extracts still arrive', async () => {
    mocks.mockFactSheetDocsGet.mockRejectedValue(new Error('kbDocs query failed'))
    mocks.mockRetrieve.mockResolvedValue([kbChunk(0, 'Maintenance fee RM0.88 psf')])
    const out = await runDetail()
    expect(out.kb.citations.map((c) => c.chunkId)).toEqual(['chunk-0'])
  })

  it('the title matches the one the fact-sheet ingest writes', async () => {
    const { clientFactSheetTitle } = await import('@/src/kb/client-factsheets')
    expect(clientFactSheetTitle(TARGET_NAME)).toBe(SHEET_TITLE)
  })

  it('FINDER_SYSTEM_PROMPT makes the sheet the authority and forbids filling an unconfirmed cell', async () => {
    const { FINDER_SYSTEM_PROMPT } = await import('./prompt')
    expect(FINDER_SYSTEM_PROMPT).toContain('The client fact sheet is the authority')
    expect(FINDER_SYSTEM_PROMPT).toContain('not confirmed (under review)')
  })
})

describe('kbDocBelongsToProject', () => {
  it('matches the category or the title subject exactly, ignoring case and punctuation', async () => {
    const { kbDocBelongsToProject } = await import('./tools')
    const name = 'Eaton Residences by Sutera @ KLCC'
    expect(kbDocBelongsToProject({ title: 'Eaton Residences by Sutera @ KLCC — D2 project facts (client sheet)' }, name)).toBe(true)
    expect(kbDocBelongsToProject({ title: 'WhatsApp — Eaton Residences by Sutera @ KLCC' }, name)).toBe(true)
    expect(kbDocBelongsToProject({ title: 'eaton residences by sutera klcc — brochure.pdf' }, name)).toBe(true)
    expect(kbDocBelongsToProject({ title: 'anything', category: 'Eaton Residences by Sutera @ KLCC' }, name)).toBe(true)
  })

  it('rejects near-misses: a variant name is how another project\'s facts get in', async () => {
    const { kbDocBelongsToProject } = await import('./tools')
    const name = 'Eaton Residences by Sutera @ KLCC'
    expect(kbDocBelongsToProject({ title: 'WhatsApp — Eaton KLCC' }, name)).toBe(false)
    expect(kbDocBelongsToProject({ title: 'Aria Luxury Residence @ KLCC — D2 project facts (client sheet)' }, name)).toBe(false)
    expect(kbDocBelongsToProject({ title: '' }, name)).toBe(false)
    expect(kbDocBelongsToProject({ title: 'Eaton Residences by Sutera @ KLCC — x.pdf' }, '')).toBe(false)
  })
})

// ─── 4c. A wrong or missing projectId (quick-kayinleong-102) ───────────────────

describe('projectDetail recovers a wrong or missing projectId by exact name', () => {
  async function runDetail(input: { projectId?: string | null; projectName?: string | null }) {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    // `as unknown as`: execute()'s declared return includes an AsyncIterable arm. The tool
    // returns the object form here.
    return (await execute({ question: null, ...input }, {} as never)) as unknown as Record<string, unknown>
  }

  it('live run 4 (P02): an ID the model built from the name still finds the project', async () => {
    // What claude-sonnet-4-6 sent for "Full details for PDH: Imperial Residences RA", in this
    // fixture's terms: a slug of the name, not a Firestore ID.
    const slug = 'imperial-residences-pavilion-damansara-heights'
    const out = (await runDetail({ projectId: slug })) as {
      found: boolean
      project: { projectId: string; name: string }
      resolvedByName: string
    }
    expect(out.found).toBe(true)
    expect(out.project.projectId).toBe(TARGET_ID)
    expect(out.project.name).toBe(TARGET_NAME)
    // The model is told the ID was wrong and given the real one.
    expect(out.resolvedByName).toContain(`"${slug}"`)
    expect(out.resolvedByName).toContain(`"${TARGET_ID}"`)
    // The slug was read as an ID first, then the real ID.
    expect(mocks.docIds).toEqual([slug, TARGET_ID])
  })

  it('a name with no projectId finds the project, ignoring case and punctuation', async () => {
    const out = (await runDetail({ projectName: 'imperial residences: PAVILION damansara heights' })) as {
      found: boolean
      project: { projectId: string }
      resolvedByName: string
    }
    expect(out.found).toBe(true)
    expect(out.project.projectId).toBe(TARGET_ID)
    expect(out.resolvedByName).not.toContain('No project has the ID')
  })

  it('a correct projectId never reads by name and carries no note', async () => {
    const out = await runDetail({ projectId: TARGET_ID, projectName: 'something else entirely' })
    expect(out.found).toBe(true)
    expect(mocks.mockProjectsGet).not.toHaveBeenCalled()
    expect('resolvedByName' in out).toBe(false)
  })

  it('a near name is a miss, never a substitution', async () => {
    // A prefix of the target's name. A contains match would pick the target; equality must not.
    const out = (await runDetail({ projectId: 'imperial-residences', projectName: 'Imperial Residences' })) as {
      found: boolean
      message: string
    }
    expect(out.found).toBe(false)
    expect(out.message).toContain('Do not substitute a different project')
  })

  it('two projects with the same name key resolve to neither', async () => {
    mocks.mockProjectsGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        { id: 'proj-1', get: () => 'Twin Towers' },
        { id: 'proj-2', get: () => 'Twin-Towers' },
      ],
    })
    const out = await runDetail({ projectName: 'Twin Towers' })
    expect(out.found).toBe(false)
  })

  it('a miss tells the model to search by name before saying the project is not on record', async () => {
    const out = (await runDetail({ projectId: 'pdh-royal-suites-rc', projectName: 'PDH: Royal Suites(RC)' })) as {
      found: boolean
      projectId: string
      message: string
    }
    expect(out.found).toBe(false)
    expect(out.projectId).toBe('pdh-royal-suites-rc')
    expect(out.message).toContain('call searchProjects with the project name')
    expect(out.message).toContain('Do not substitute a different project')
  })

  it('projectNameKey makes a stored name and its slug equal, and keeps nothing else', async () => {
    const { projectNameKey } = await import('@/src/inventory/search')
    expect(projectNameKey('PDH: Imperial Residences RA')).toBe(projectNameKey('pdh-imperial-residences-ra'))
    expect(projectNameKey('PDH: Royal Suites(RC)')).toBe('pdhroyalsuitesrc')
    // No Latin letters or digits: no key, so no read can match on it.
    expect(projectNameKey('皇家套房')).toBe('')
  })

  it('FINDER_SYSTEM_PROMPT says to pass a name, never build an ID, and search before a miss', async () => {
    const { FINDER_SYSTEM_PROMPT } = await import('./prompt')
    expect(FINDER_SYSTEM_PROMPT).toContain('call projectDetail with projectName set to the name')
    expect(FINDER_SYSTEM_PROMPT).toContain('Never build an ID from a name.')
    expect(FINDER_SYSTEM_PROMPT).toContain('Call searchProjects with the project name as freeText before answering')
  })
})

// ─── 5. Registration ──────────────────────────────────────────────────────────

describe('the Finder exposes projectDetail as a tool', () => {
  it('makeTools registers it alongside the other three', async () => {
    const { finderAgent } = await import('./index')
    const tools = finderAgent.makeTools('en')
    expect(Object.keys(tools).sort()).toEqual(
      ['fetchCollateral', 'projectDetail', 'queryInventory', 'searchProjects'].sort(),
    )
  })

  it('its description steers the model away from searchProjects for a named project', async () => {
    const { finderAgent } = await import('./index')
    const description = finderAgent.makeTools('en').projectDetail.description ?? ''
    expect(description).toContain('never searchProjects')
    expect(description).toContain('projectId')
  })
})

// ─── 6. Sold-out layouts (quick-kayinleong-096) ───────────────────────────────

describe('a sold-out layout reaches the model and is governed by an explicit rule', () => {
  const SOLD_ID = 'proj-sold-out-layout'
  const SOLD_ENTRY = {
    label: 'Type E1',
    sizeSqft: 2_072,
    bedrooms: 3,
    priceMinRM: null,
    priceMaxRM: null,
    raw: 'Type E1: Sold out',
    soldOut: true,
  }
  const OPEN_ENTRY = {
    label: 'Type S1',
    sizeSqft: 904,
    bedrooms: 1,
    priceMinRM: 1_200_000,
    priceMaxRM: 1_350_000,
    raw: 'Type S1: 904 Sqft | 1 Bedroom | Nett: RM1.2mil-RM1.35mil',
  }

  beforeEach(() => {
    // Serve one extra project through the file's existing by-id mock, leaving the
    // 50-project fixture set (and every count that depends on it) untouched.
    const doc: ProjectDoc = {
      ...makeProject(1),
      name: 'Sold-out layout project',
      unitTypes: [OPEN_ENTRY, SOLD_ENTRY],
    }
    mocks.mockDocGet.mockImplementation(async (id: string) =>
      id === SOLD_ID
        ? { exists: true, data: () => doc }
        : { exists: id in PROJECTS, data: () => PROJECTS[id] },
    )
  })

  it('getProjectDetail returns the entry with soldOut true, whole and unchanged', async () => {
    const { getProjectDetail } = await import('@/src/inventory/search')
    const detail = await getProjectDetail(SOLD_ID)
    expect(detail.found).toBe(true)
    if (!detail.found) return
    const sold = detail.project.unitTypes.find((e) => e.label === 'Type E1')
    expect(sold).toEqual(SOLD_ENTRY)
    expect(sold?.soldOut).toBe(true)
    // An entry that is not sold out carries no soldOut key at all.
    const open = detail.project.unitTypes.find((e) => e.label === 'Type S1')
    expect(open).not.toHaveProperty('soldOut')
  })

  it('the projectDetail tool payload carries the flag to the model', async () => {
    const { makeProjectDetailTool } = await import('./tools')
    const t = makeProjectDetailTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    const out = (await execute({ projectId: SOLD_ID, question: null }, {} as never)) as {
      found: true
      project: { unitTypes: Array<{ label: string; soldOut?: boolean }> }
    }
    expect(out.project.unitTypes.filter((e) => e.soldOut === true).map((e) => e.label)).toEqual(['Type E1'])
  })

  it('FINDER_SYSTEM_PROMPT states the sold-out rule', async () => {
    const { FINDER_SYSTEM_PROMPT } = await import('./prompt')
    expect(FINDER_SYSTEM_PROMPT).toContain('"soldOut": true')
    expect(FINDER_SYSTEM_PROMPT).toContain('never offer it as available')
    expect(FINDER_SYSTEM_PROMPT).toContain('never quote a price for it')
  })
})
