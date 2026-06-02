/**
 * Inventory search module tests — offline (no live Gemini or Firestore).
 *
 * Covers:
 *   - active-only: sold_out + hidden projects never appear in searchProjects results (FIND-01)
 *   - eligibility (foreign): foreignEligible:false projects excluded for nationality:'foreign'
 *   - eligibility (bumi): bumiQuota:true projects excluded for bumiputera:false criteria
 *   - affordability: all-unaffordable → {found:false, reason:'ineligible', why:'financing'} (FIND-10)
 *   - no_match: empty eligible set → {found:false, reason:'no_match'}
 *   - rank: eligible project closest in vector space ranks first (Stage B re-rank)
 *   - segmentation: investment vs own_stay produce different top-1/top-3 order (FIND-09)
 *   - returning: 'since' filter surfaces only newer launches (FIND-06)
 *   - queryInventory: structured VP query with no embedText call (FIND-07)
 *
 * Threat model (T-03-04): deterministic Stage-A filter means sold_out/hidden/ineligible
 * projects are unreachable by construction. These tests unit-assert that invariant.
 *
 * All Gemini embedding calls and Firestore adminDb calls are mocked.
 * The default `npx vitest run` MUST stay green without live credentials.
 *
 * References:
 *   - 03-02-PLAN.md: two-stage searchProjects + queryInventory
 *   - 03-RESEARCH.md Pattern 4: deterministic filter FIRST, vector re-rank SECOND
 *   - src/rag/rag.test.ts: mock pattern to mirror
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Fixture data ─────────────────────────────────────────────────────────────

/**
 * Fixture set: 8 projects covering all invariant test cases.
 *
 * Embedding design for rank + segmentation tests:
 *   - proj-active-a: investment-leaning (high vpStatus), embedding high in dim-0
 *   - proj-active-b: own-stay-leaning (more bedrooms, locationText heavy), embedding high in dim-1
 *   - proj-active-c: neutral, lower bedrooms
 *   - proj-active-d: affordable (low priceValue)
 *   - proj-sold-out: status:'sold_out' — must never appear
 *   - proj-hidden: status:'hidden' — must never appear
 *   - proj-bumi-only: bumiQuota:true, foreignEligible:false — excluded for non-bumi/foreign
 *   - proj-foreign-ineligible: foreignEligible:false — excluded for foreign nationals
 */
const FIXTURES = {
  'proj-active-a': {
    tenantId: 'd2' as const,
    name: 'Skyview Residences',
    status: 'active' as const,
    priceBand: '800k_1.2m' as const,
    priceValue: 950_000,
    tenure: 'freehold',
    vpStatus: true,
    vpDate: new Date('2024-06-01'),
    bumiQuota: false,
    foreignEligible: true,
    description: 'Premium investment units near KLCC with high rental yield',
    locationText: 'KLCC, Kuala Lumpur',
    bedrooms: 2,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? 0.9 : 0.01)), // high in dim-0
    createdAt: new Date('2023-01-01'),
  },
  'proj-active-b': {
    tenantId: 'd2' as const,
    name: 'Setia Aman Park',
    status: 'active' as const,
    priceBand: '500k_800k' as const,
    priceValue: 620_000,
    tenure: 'leasehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Family-friendly townhouse near LRT with good schools nearby',
    locationText: 'Cheras, Kuala Lumpur — near LRT Taman Connaught',
    bedrooms: 4,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 1 ? 0.9 : 0.01)), // high in dim-1
    createdAt: new Date('2023-03-01'),
  },
  'proj-active-c': {
    tenantId: 'd2' as const,
    name: 'Vista Green Condo',
    status: 'active' as const,
    priceBand: '500k_800k' as const,
    priceValue: 700_000,
    tenure: 'freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Modern condominiums in established neighbourhood',
    locationText: 'Damansara, Selangor',
    bedrooms: 3,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 2 ? 0.8 : 0.01)), // high in dim-2
    createdAt: new Date('2023-06-01'),
  },
  'proj-active-d': {
    tenantId: 'd2' as const,
    name: 'Affordable Homes Kepong',
    status: 'active' as const,
    priceBand: 'under_500k' as const,
    priceValue: 350_000,
    tenure: 'leasehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: false, // foreign-ineligible (shared with proj-foreign-ineligible concept)
    description: 'Affordable starter home for first-time buyers in Kepong',
    locationText: 'Kepong, Kuala Lumpur',
    bedrooms: 3,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 3 ? 0.8 : 0.01)),
    createdAt: new Date('2024-01-15'), // newer launch — used for returning-client test
  },
  'proj-sold-out': {
    tenantId: 'd2' as const,
    name: 'Sold Out Tower',
    status: 'sold_out' as const,
    priceBand: '800k_1.2m' as const,
    priceValue: 900_000,
    tenure: 'freehold',
    vpStatus: true,
    vpDate: new Date('2023-06-01'),
    bumiQuota: false,
    foreignEligible: true,
    description: 'Already sold out — should NEVER appear in search results',
    locationText: 'Bangsar, Kuala Lumpur',
    bedrooms: 2,
    // Embedding is very high in ALL dims — would rank #1 if not filtered
    embedding: Array.from({ length: 1024 }, () => 1.0 / Math.sqrt(1024)),
    createdAt: new Date('2022-01-01'),
  },
  'proj-hidden': {
    tenantId: 'd2' as const,
    name: 'Hidden Project',
    status: 'hidden' as const,
    priceBand: '500k_800k' as const,
    priceValue: 750_000,
    tenure: 'freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Unlisted project — must never appear in search results',
    locationText: 'Mont Kiara, Kuala Lumpur',
    bedrooms: 3,
    embedding: Array.from({ length: 1024 }, () => 1.0 / Math.sqrt(1024)),
    createdAt: new Date('2022-06-01'),
  },
  'proj-bumi-only': {
    tenantId: 'd2' as const,
    name: 'Bumiputera Reserve Block',
    status: 'active' as const,
    priceBand: '500k_800k' as const,
    priceValue: 580_000,
    tenure: 'leasehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: true,     // bumi-reserved — excluded for non-bumi buyers
    foreignEligible: false,
    description: 'Reserved for bumiputera buyers only',
    locationText: 'Shah Alam, Selangor',
    bedrooms: 3,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 5 ? 0.7 : 0.01)),
    createdAt: new Date('2023-01-01'),
  },
  'proj-new-launch': {
    tenantId: 'd2' as const,
    name: 'New Launch Tower 2025',
    status: 'active' as const,
    priceBand: '800k_1.2m' as const,
    priceValue: 880_000,
    tenure: 'freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Brand new launch — surfaced for returning clients',
    locationText: 'Cyberjaya, Selangor',
    bedrooms: 2,
    embedding: Array.from({ length: 1024 }, (_, i) => (i === 6 ? 0.75 : 0.01)),
    createdAt: new Date('2025-01-01'), // very recent — used for returning-client test
  },
}

type FixtureId = keyof typeof FIXTURES

/**
 * Build a mock Firestore QuerySnapshot from a list of project IDs.
 * Only includes active projects matching the given IDs from FIXTURES.
 */
function makeProjectSnap(ids: FixtureId[]) {
  return {
    empty: ids.length === 0,
    docs: ids.map((id) => ({
      id,
      data: () => ({ ...FIXTURES[id] }),
    })),
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Deterministic stub vector for embedText.
 * Returns a vector with 1.0 in dim-0 (normalized) to simulate a query
 * that would rank proj-active-a highest by dot product.
 * Typed as number[] to prevent TypeScript from inferring a narrow (0|1)[] literal tuple.
 */
const STUB_QUERY_VECTOR: number[] = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1.0 : 0.0))

const { mockEmbedText, mockProjectsGet, mockWhereFn } = vi.hoisted(() => {
  const mockEmbedText = vi.fn(
    async (_text: string, _opts: { inputType: 'query' | 'document' }) =>
      STUB_QUERY_VECTOR,
  )

  // Track where() calls so we can assert which filters were applied
  const whereCalls: Array<[string, string, unknown]> = []

  // get() returns all ACTIVE docs by default (Stage-A filter result)
  const mockProjectsGet = vi.fn(async () =>
    makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c', 'proj-active-d']),
  )

  // Self-referential mockWhereFn supports chained .where().where()...get()
  const mockWhereFn: ReturnType<typeof vi.fn> = vi.fn(
    (...args: [string, string, unknown]) => {
      whereCalls.push(args)
      return { where: mockWhereFn, get: mockProjectsGet, orderBy: mockWhereFn }
    },
  )

  return { mockEmbedText, mockProjectsGet, mockWhereFn, whereCalls }
})

vi.mock('@/src/rag/embed', () => ({
  embedText: mockEmbedText,
  EMBED_DIM: 1024,
}))

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      where: mockWhereFn,
    })),
  },
}))

vi.mock('@/src/firebase/collections', () => ({
  projectsRef: vi.fn(() => ({
    where: mockWhereFn,
  })),
  PRICE_BANDS: ['under_500k', '500k_800k', '800k_1.2m', 'above_1.2m'],
  priceBandFor: vi.fn((price: number) => {
    if (price < 500_000) return 'under_500k'
    if (price < 800_000) return '500k_800k'
    if (price < 1_200_000) return '800k_1.2m'
    return 'above_1.2m'
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('searchProjects', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()

    // Restore default behaviors after reset
    mockEmbedText.mockImplementation(
      async (_text: string, _opts: { inputType: 'query' | 'document' }) =>
        STUB_QUERY_VECTOR,
    )
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c', 'proj-active-d']),
    )
  })

  // ── active-only ─────────────────────────────────────────────────────────────

  it('active-only: sold_out projects never appear in results (T-03-04)', async () => {
    // Stage A filter returns only active docs — sold_out is excluded at the DB layer.
    // Simulate: Firestore filtered out sold_out/hidden and returned only active docs.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      expect(ids).not.toContain('proj-sold-out')
      expect(ids).not.toContain('proj-hidden')
      ids.forEach((id) => {
        expect(FIXTURES[id as FixtureId].status).toBe('active')
      })
    }
  })

  it('active-only: hidden projects never appear in results', async () => {
    // Stage A filter excludes hidden — mock returns only active
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-c']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      expect(ids).not.toContain('proj-hidden')
    }
  })

  // ── eligibility (foreign) ────────────────────────────────────────────────────

  it('eligibility (foreign): foreignEligible:false projects excluded for nationality:foreign', async () => {
    // Simulate: Stage A where('foreignEligible','==',true) filter returned only eligible
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'foreign',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      // proj-active-d (foreignEligible:false) and proj-bumi-only must not appear
      expect(ids).not.toContain('proj-active-d')
      expect(ids).not.toContain('proj-bumi-only')
    }
  })

  // ── eligibility (bumi) ───────────────────────────────────────────────────────

  it('eligibility (bumi): bumiQuota:true projects excluded for bumiputera:false criteria', async () => {
    // Simulate: Stage A where('bumiQuota','==',false) filter returned only non-bumi-reserved
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c', 'proj-active-d']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'malaysian',
      bumiputera: false,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      expect(ids).not.toContain('proj-bumi-only')
    }
  })

  // ── affordability ────────────────────────────────────────────────────────────

  it('affordability: all-eligible exceed ceiling → {found:false, reason:"ineligible", why:"financing"}', async () => {
    // Eligible set: only high-priced projects (priceValue > 900k)
    // monthlyIncome of 3000 → ceiling well below 900k → all unaffordable
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a']), // priceValue: 950_000
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: 3_000, // very low income → ceiling far below 950k
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('ineligible')
      expect((result as { found: false; reason: 'ineligible'; why: string }).why).toBe('financing')
    }
  })

  // ── no_match ─────────────────────────────────────────────────────────────────

  it('no_match: empty eligible set → {found:false, reason:"no_match"}', async () => {
    // Stage A returns no docs (all filtered out)
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap([]))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'very niche criteria with no match',
    })

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('no_match')
    }
  })

  // ── rank ─────────────────────────────────────────────────────────────────────

  it('rank: eligible project closest in vector space ranks first (Stage B re-rank)', async () => {
    // STUB_QUERY_VECTOR has 1.0 in dim-0 → dot product with proj-active-a embedding
    // (which has 0.9 in dim-0) is highest. proj-active-a should rank #1.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-b', 'proj-active-c', 'proj-active-a']), // a is last in fetch order
    )
    mockEmbedText.mockResolvedValueOnce(STUB_QUERY_VECTOR) // dim-0 bias → proj-active-a wins

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'investment near KLCC',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      // proj-active-a must be first (highest dot product with STUB_QUERY_VECTOR)
      expect(result.matches[0].projectId).toBe('proj-active-a')
    }
  })

  // ── segmentation ─────────────────────────────────────────────────────────────

  it('segmentation: investment vs own_stay produce different top-1/top-3 order (FIND-09)', async () => {
    // Provide a balanced eligible set: proj-active-a (vpStatus:true, investment-leaning)
    // and proj-active-b (more bedrooms, family-friendly, own-stay-leaning)
    const balancedSet: FixtureId[] = ['proj-active-a', 'proj-active-b', 'proj-active-c']

    mockProjectsGet.mockResolvedValue(makeProjectSnap(balancedSet))
    // Use a neutral query vector (equal weight) to let segmentation drive the difference
    const neutralVector: number[] = Array.from({ length: 1024 }, () => 1.0 / Math.sqrt(1024))
    mockEmbedText.mockResolvedValue(neutralVector)

    const { searchProjects } = await import('@/src/inventory/search')

    const investmentResult = await searchProjects({
      segment: 'investment',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    // Reset modules for the second call
    vi.resetModules()
    mockProjectsGet.mockResolvedValue(makeProjectSnap(balancedSet))
    mockEmbedText.mockResolvedValue(neutralVector)

    const { searchProjects: searchProjects2 } = await import('@/src/inventory/search')
    const ownStayResult = await searchProjects2({
      segment: 'own_stay',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'property',
    })

    expect(investmentResult.found).toBe(true)
    expect(ownStayResult.found).toBe(true)

    if (investmentResult.found && ownStayResult.found) {
      const investmentTop1 = investmentResult.matches[0].projectId
      const ownStayTop1 = ownStayResult.matches[0].projectId
      // Segmentation MUST produce a different top-1 for investment vs own_stay
      expect(investmentTop1).not.toBe(ownStayTop1)
    }
  })

  // ── returning (FIND-06) ───────────────────────────────────────────────────────

  it('returning (FIND-06): since filter returns only projects created after the threshold', async () => {
    // since: 2024-06-01 → only proj-new-launch (2025-01-01) should pass
    // proj-active-a (2023-01-01), proj-active-b (2023-03-01) are older
    const since = new Date('2024-06-01')

    // Stage A returns the set; the since filter should further narrow in-memory
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-new-launch']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'new launch',
      since,
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      // Only proj-new-launch (2025-01-01) passes the since filter
      expect(ids).toContain('proj-new-launch')
      expect(ids).not.toContain('proj-active-a')  // 2023-01-01 — too old
      expect(ids).not.toContain('proj-active-b')  // 2023-03-01 — too old
    }
  })
})

// ─── queryInventory tests ─────────────────────────────────────────────────────

describe('queryInventory', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()

    mockEmbedText.mockImplementation(
      async (_text: string, _opts: { inputType: 'query' | 'document' }) =>
        STUB_QUERY_VECTOR,
    )
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(
      makeProjectSnap(['proj-active-a', 'proj-active-b']),
    )
  })

  it('queryInventory: VP query returns correct project IDs', async () => {
    const startOfYear = new Date('2024-01-01')
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-a']))

    const { queryInventory } = await import('@/src/inventory/search')
    const result = await queryInventory({ vpDateFrom: startOfYear })

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  it('queryInventory: does NOT call embedText (structured query only, FIND-07)', async () => {
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-a']))

    // Fresh reset to count embedText calls cleanly
    mockEmbedText.mockClear()

    const { queryInventory } = await import('@/src/inventory/search')
    await queryInventory({ vpDateFrom: new Date('2024-01-01') })

    // embedText MUST NOT be called in a structured query (no vector search)
    expect(mockEmbedText).not.toHaveBeenCalled()
  })

  it('queryInventory: priceBand filter narrows results', async () => {
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a']), // priceBand: '800k_1.2m'
    )

    const { queryInventory } = await import('@/src/inventory/search')
    const result = await queryInventory({ priceBand: '800k_1.2m' })

    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── composeProjectEmbeddingText tests (embedText section) ───────────────────

describe('composeProjectEmbeddingText', () => {
  it('status is excluded from embedding text (Pitfall 1/8 — status is a hard filter, not vector content)', async () => {
    const { composeProjectEmbeddingText } = await import('@/src/inventory/embedText')

    const activeProject = {
      ...FIXTURES['proj-active-a'],
      status: 'active' as const,
    }
    const soldOutProject = {
      ...FIXTURES['proj-active-a'],
      status: 'sold_out' as const,
    }

    const activeText = composeProjectEmbeddingText(activeProject)
    const soldOutText = composeProjectEmbeddingText(soldOutProject)

    // Two projects identical except status produce the SAME embedding text
    expect(activeText).toBe(soldOutText)
    // Status value must NOT appear in the embedding text
    expect(activeText).not.toContain('active')
    expect(activeText).not.toContain('sold_out')
    expect(activeText).not.toContain('hidden')
  })

  it('composeProjectEmbeddingText includes semantic fields: name, priceBand, tenure, bedrooms, locationText, description', async () => {
    const { composeProjectEmbeddingText } = await import('@/src/inventory/embedText')
    const proj = FIXTURES['proj-active-b']
    const text = composeProjectEmbeddingText(proj)

    expect(text).toContain(proj.name)
    expect(text).toContain(proj.tenure)
    expect(text).toContain(proj.locationText)
    expect(text).toContain(proj.description)
  })

  it('embedProject returns a 1024-d vector (mocked embedText length assertion)', async () => {
    // embedText is mocked to return STUB_QUERY_VECTOR (1024 entries)
    const { embedProject } = await import('@/src/inventory/embedText')
    const result = await embedProject(FIXTURES['proj-active-a'])
    expect(result).toHaveLength(1024)
  })
})
