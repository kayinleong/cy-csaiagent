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
      doc: vi.fn((id: string) => {
        mocks.docIds.push(id)
        return { get: () => mocks.mockDocGet(id) }
      }),
    })),
    collateralRef: vi.fn(() => ({ where: vi.fn(() => ({ get: mocks.mockCollateralGet })) })),
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
    docs: ids.map((id) => ({ id, data: () => PROJECTS[id] })),
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
    const view = toModelOutput((await execute(input, {} as never)) as never) as {
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
    const project = (out as { project: Record<string, unknown> }).project
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
    // pillar:finder so a project lookup can never cite a Coach SOP as project data.
    expect(opts).toEqual({ pillar: 'finder' })
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
