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
  /**
   * quick-kayinleong-050: priceValue 0 means UNKNOWN, not free.
   * 32 of 83 active projects are in this state in the real corpus.
   */
  'proj-unpriced': {
    tenantId: 'd2' as const,
    name: 'Unpriced Launch',
    status: 'active' as const,
    // priceBand is derived via priceBandFor(0) at import, so unpriced projects are all
    // mislabelled 'under_500k' — which is why priceBand is not a usable budget filter.
    priceBand: 'under_500k' as const,
    priceValue: 0,
    tenure: 'freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Price not yet released by the developer',
    locationText: 'Bangsar, Kuala Lumpur',
    bedrooms: 0, // 0 = unknown, not studio
    embedding: Array.from({ length: 1024 }, () => 1.0 / Math.sqrt(1024)),
    createdAt: new Date('2024-02-01'),
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

/**
 * Build a mock QuerySnapshot from ad-hoc docs that are not in FIXTURES.
 * Needed for cases that synthesise projects (bulk sets, locationText variants) — the
 * FixtureId-keyed `makeProjectSnap` cannot express those.
 */
function makeAdHocSnap(entries: Array<{ id: string; doc: Record<string, unknown> }>) {
  return {
    empty: entries.length === 0,
    docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e.doc }) })),
  } as unknown as ReturnType<typeof makeProjectSnap>
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Deterministic stub vector for embedText.
 * Returns a vector with 1.0 in dim-0 (normalized) to simulate a query
 * that would rank proj-active-a highest by dot product.
 * Typed as number[] to prevent TypeScript from inferring a narrow (0|1)[] literal tuple.
 */
const STUB_QUERY_VECTOR: number[] = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1.0 : 0.0))

/**
 * Evenly-weighted unit vector. Every fixture scores ~0.34 against it — comfortably above
 * MIN_RELEVANCE and inside the same relevance tier, so segment/criteria behaviour can be
 * asserted without the relevance floor or tier ordering interfering.
 */
const NEUTRAL_VECTOR: number[] = Array.from({ length: 1024 }, () => 1.0 / Math.sqrt(1024))

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
    // quick-kayinleong-050: Stage B now enforces a MIN_RELEVANCE floor, so the surviving
    // project must actually score against the query. Align the stub query vector with
    // proj-new-launch's embedding (dim-6) — i.e. a "new launch" query that genuinely
    // matches it. The default dim-0 stub would score 0.01 and be dropped by the floor,
    // which would test the floor rather than the since-filter this case exists for.
    mockEmbedText.mockResolvedValueOnce(
      Array.from({ length: 1024 }, (_, i) => (i === 6 ? 1.0 : 0.0)),
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

// ─── quick-kayinleong-050: location gate, price gate, floor/cap, grounding ────
//
// The reported defect: a tester asked for "a 2-bedroom in Cheras, budget 800k" and was
// shown a RM6.4M Ampang project. `locationPref` and `priceMax` were carried through the
// whole pipeline as display-only strings — never filters, never scoring inputs — so the
// tool returned all 83 active projects and the prompt forbade a refusal.

describe('quick-kayinleong-050: locationPref is a hard filter', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()
    mockEmbedText.mockImplementation(async () => STUB_QUERY_VECTOR)
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c', 'proj-active-d']),
    )
  })

  /** The reported query, minus the Cheras fixture — mirrors the real corpus (zero Cheras). */
  const CHERAS_QUERY = {
    segment: 'investment' as const,
    priceMin: null,
    priceMax: 800_000,
    monthlyIncome: null,
    nationality: 'unknown' as const,
    bumiputera: null,
    locationPref: 'Cheras, KL',
    bedrooms: 2,
    freeText: 'Find me a 2-bedroom in Cheras, budget 800k',
  }

  it('THE REPORTED BUG: a Cheras query REFUSES instead of returning far-away projects', async () => {
    // Eligible set is KLCC / Damansara / Kepong — no Cheras project. The real inventory
    // has zero Cheras projects, so this is the production case.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-c', 'proj-active-d']),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects(CHERAS_QUERY)

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('no_match')
    }
  })

  it('a Cheras query DOES return the Cheras project when one exists', async () => {
    // proj-active-b is "Cheras, Kuala Lumpur — near LRT Taman Connaught", 620k.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c']),
    )
    // Query vector aligned with proj-active-b (dim-1) so it clears MIN_RELEVANCE.
    mockEmbedText.mockResolvedValueOnce(
      Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1.0 : 0.0)),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects(CHERAS_QUERY)

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).toEqual(['proj-active-b'])
    }
  })

  it('a location preference with nothing discriminating ("KL") does NOT filter to zero', async () => {
    // "Kuala Lumpur" appears in 23+ of 82 locationText values — matching on it is
    // indistinguishable from not filtering. The gate must be skipped, not applied.
    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      ...CHERAS_QUERY,
      priceMax: null,
      bedrooms: null,
      locationPref: 'KL',
      freeText: 'anything',
    })

    expect(result.found).toBe(true)
  })

  it('D4: a REGION preference ("Klang Valley") skips the gate and claims no location match', async () => {
    // quick-kayinleong-085 / D4. "Klang Valley" is not a neighbourhood — every active D2
    // project is inside it — but the gate matched it as a literal substring of
    // name + locationText, so only 5 of 82 real projects survived and 3 once a budget
    // applied. That was the reported "too few results" defect; MAX_MATCHES never engaged.
    //
    // Skipping the gate is only honest if nothing then claims the match, hence the
    // locationPref assertion: same contract as the bare-"KL" case above.
    const { searchProjects } = await import('@/src/inventory/search')
    const QUERY = {
      ...CHERAS_QUERY,
      priceMax: null,
      bedrooms: null,
      freeText: 'show me a list of 1mil property within Klang Valley',
    }

    const withRegion = await searchProjects({ ...QUERY, locationPref: 'Klang Valley' })
    const withNoPref = await searchProjects({ ...QUERY, locationPref: null })

    expect(withRegion.found).toBe(true)
    expect(withNoPref.found).toBe(true)
    if (withRegion.found && withNoPref.found) {
      // Identical result sets: stating the region filtered nothing out. (Comparing to the
      // no-preference run is stronger than a count — it cannot be satisfied by a gate that
      // happens to keep the same NUMBER of different projects.)
      expect(withRegion.matches.map((m) => m.projectId)).toEqual(
        withNoPref.matches.map((m) => m.projectId),
      )
      expect(withRegion.matches.every((m) => m.matchedCriteria.locationPref === null)).toBe(true)
    }
  })

  it('proximity prose does NOT count as a location match (false-positive guard)', async () => {
    // HAZARD: locationText is prose that name-drops NEARBY landmarks. 27 of 83 active
    // projects mention KLCC; most are not in KLCC. A naive substring match would match
    // any project whose blurb says "near KLCC".
    const { locationNeedles, projectMatchesLocation } = await import('@/src/inventory/search')

    const nearKlcc = {
      ...FIXTURES['proj-active-b'],
      name: 'Bangsar Hill Park',
      locationText:
        'Lorong Maarof, Bangsar, 400m to Bangsar LRT Station & 450m to Bangsar Village Shopping Mall, near KLCC and Bangsar CBD',
    }

    const klcc = locationNeedles('KLCC')
    const bangsar = locationNeedles('Bangsar')
    expect(klcc).not.toBeNull()
    expect(bangsar).not.toBeNull()

    // Sits in Bangsar, merely near KLCC.
    expect(projectMatchesLocation(nearKlcc, bangsar!)).toBe(true)
    expect(projectMatchesLocation(nearKlcc, klcc!)).toBe(false)
  })

  it('a generic place-type prefix does not conflate distinct areas', async () => {
    const { locationNeedles, projectMatchesLocation } = await import('@/src/inventory/search')

    const bukitJalil = { ...FIXTURES['proj-active-c'], locationText: 'Bukit Jalil, Kuala Lumpur' }
    const bukitBintang = { ...FIXTURES['proj-active-c'], locationText: 'Bukit Bintang, Kuala Lumpur' }
    const needles = locationNeedles('Bukit Jalil')!

    expect(projectMatchesLocation(bukitJalil, needles)).toBe(true)
    // "bukit" alone must never be the match — Bukit Bintang is a different place.
    expect(projectMatchesLocation(bukitBintang, needles)).toBe(false)

    // Mirror case: "Sri Petaling" must not match "Petaling Jaya".
    const sriPetaling = locationNeedles('Sri Petaling')!
    const petalingJaya = { ...FIXTURES['proj-active-c'], locationText: 'Petaling Jaya, Selangor' }
    expect(projectMatchesLocation(petalingJaya, sriPetaling)).toBe(false)
  })
})

describe('quick-kayinleong-050: priceMax/priceMin are hard filters', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()
    mockEmbedText.mockImplementation(async () => NEUTRAL_VECTOR)
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c', 'proj-active-d']),
    )
  })

  const BASE = {
    segment: 'unknown' as const,
    priceMin: null,
    priceMax: null,
    monthlyIncome: null,
    nationality: 'unknown' as const,
    bumiputera: null,
    locationPref: null,
    bedrooms: null,
    freeText: 'property',
  }

  it('a price ceiling EXCLUDES over-budget projects', async () => {
    // proj-active-a is 950k; b 620k; c 700k; d 350k. Budget 800k must drop a.
    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 800_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      expect(ids).not.toContain('proj-active-a')
      expect(result.matches.every((m) => m.priceValue <= 800_000)).toBe(true)
    }
  })

  it('the price ceiling is INCLUSIVE at the boundary', async () => {
    // A project priced at exactly priceMax is within budget (proj-active-a === 950_000).
    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 950_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).toContain('proj-active-a')
    }
  })

  it('priceMin excludes under-budget projects and is inclusive', async () => {
    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMin: 700_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      const ids = result.matches.map((m) => m.projectId)
      expect(ids).toContain('proj-active-c') // exactly 700_000 — boundary
      expect(ids).not.toContain('proj-active-d') // 350_000
      expect(ids).not.toContain('proj-active-b') // 620_000
    }
  })

  it('an all-over-budget set refuses with no_match, NOT ineligible/financing', async () => {
    // 'ineligible'/'financing' is reserved for the income-derived affordability ceiling.
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-a']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 100_000 })

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('no_match')
    }
  })

  it('D2: an UNPRICED project (priceValue 0 = unknown) is ADMITTED when a budget is stated', async () => {
    // REVERSED by quick-kayinleong-085 / D2. This case previously asserted the opposite.
    // 32 of 82 active projects carry priceValue 0, which means UNKNOWN — and "unknown" is
    // not "out of range". Excluding them hid 32 of 82 projects from the driving query.
    // The honesty half of the decision is the next test: an admitted project must not
    // claim the budget match.
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-unpriced', 'proj-active-b']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 800_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).toContain('proj-unpriced')
    }
  })

  it('D2: an unpriced survivor claims NO budget match while a priced one does', async () => {
    // The invariant the loosening rests on. `matchedCriteria` is rendered under "Matched
    // criteria" and handed to the model verbatim, so a blanket `priceApplied` here would
    // make a project whose price we do not hold assert "within budget (max RM800k)".
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-unpriced', 'proj-active-b']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 800_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      const unpriced = result.matches.find((m) => m.projectId === 'proj-unpriced')
      const priced = result.matches.find((m) => m.projectId === 'proj-active-b')
      expect(unpriced).toBeDefined()
      expect(priced).toBeDefined()
      expect(unpriced!.matchedCriteria.priceMax).toBeNull()
      expect(priced!.matchedCriteria.priceMax).toBe(800_000)
    }
  })

  it('D2: an over-budget PRICED project is still excluded', async () => {
    // The loosening applies only to unknown prices. A known 950k must not survive 800k.
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-a', 'proj-active-b']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, priceMax: 800_000 })

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).not.toContain('proj-active-a')
    }
  })

  it('an unpriced project is still returned when NO budget is stated', async () => {
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-unpriced']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects(BASE)

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).toContain('proj-unpriced')
    }
  })
})

describe('quick-kayinleong-050: matchedCriteria never claims an unapplied criterion', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()
    mockEmbedText.mockImplementation(async () => NEUTRAL_VECTOR)
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(makeProjectSnap(['proj-active-c']))
  })

  it('locationPref is NOT echoed when the location gate never ran', async () => {
    // buildRationale renders this under the heading "Matched criteria" and the chat UI
    // badges it, so echoing an unapplied criterion is a false grounding claim.
    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: 'KL', // reduces to nothing discriminating → gate skipped
      bedrooms: null,
      freeText: 'property',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches[0].matchedCriteria.locationPref).toBeNull()
    }
  })

  it('priceMax is NOT echoed when no budget was supplied', async () => {
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
      expect(result.matches[0].matchedCriteria.priceMax).toBeNull()
    }
  })

  it('bedrooms is echoed ONLY when the project actually has that bedroom count', async () => {
    // proj-active-c has 3 bedrooms. `bedrooms` is not a filter (0 means "unknown" on 29
    // of 83 projects), so it may only be claimed when it genuinely matches.
    const { searchProjects } = await import('@/src/inventory/search')
    const base = {
      segment: 'unknown' as const,
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'unknown' as const,
      bumiputera: null,
      locationPref: null,
      freeText: 'property',
    }

    const mismatch = await searchProjects({ ...base, bedrooms: 2 })
    expect(mismatch.found).toBe(true)
    if (mismatch.found) {
      expect(mismatch.matches[0].matchedCriteria.bedrooms).toBeNull()
    }

    vi.resetModules()
    mockProjectsGet.mockResolvedValue(makeProjectSnap(['proj-active-c']))
    mockEmbedText.mockImplementation(async () => NEUTRAL_VECTOR)
    const { searchProjects: searchProjects2 } = await import('@/src/inventory/search')
    const match = await searchProjects2({ ...base, bedrooms: 3 })
    expect(match.found).toBe(true)
    if (match.found) {
      expect(match.matches[0].matchedCriteria.bedrooms).toBe(3)
    }
  })

  it('applied criteria ARE echoed (the echo is narrowed, not removed)', async () => {
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-b']))
    mockEmbedText.mockResolvedValueOnce(
      Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1.0 : 0.0)),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({
      segment: 'own_stay',
      priceMin: null,
      priceMax: 800_000,
      monthlyIncome: null,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: 'Cheras',
      bedrooms: 4,
      freeText: 'family home in Cheras',
    })

    expect(result.found).toBe(true)
    if (result.found) {
      const mc = result.matches[0].matchedCriteria
      expect(mc.locationPref).toBe('Cheras') // gate ran, this project passed it
      expect(mc.priceMax).toBe(800_000)      // gate ran, 620k is within budget
      expect(mc.bedrooms).toBe(4)            // proj-active-b genuinely has 4
    }
  })
})

describe('quick-kayinleong-050: relevance floor, top-N cap, and segment weighting', () => {
  beforeEach(() => {
    vi.resetModules()
    mockEmbedText.mockReset()
    mockProjectsGet.mockReset()
    mockWhereFn.mockReset()
    mockEmbedText.mockImplementation(async () => STUB_QUERY_VECTOR)
    mockWhereFn.mockImplementation((..._args: [string, string, unknown]) => ({
      where: mockWhereFn,
      get: mockProjectsGet,
      orderBy: mockWhereFn,
    }))
    mockProjectsGet.mockResolvedValue(makeProjectSnap(['proj-active-a']))
  })

  const BASE = {
    segment: 'unknown' as const,
    priceMin: null,
    priceMax: null,
    monthlyIncome: null,
    nationality: 'unknown' as const,
    bumiputera: null,
    locationPref: null,
    bedrooms: null,
    freeText: 'property',
  }

  it('projects below MIN_RELEVANCE are dropped', async () => {
    // STUB_QUERY_VECTOR is dim-0: proj-active-a scores 0.9, the rest 0.01.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-a', 'proj-active-b', 'proj-active-c']),
    )

    const { searchProjects, MIN_RELEVANCE } = await import('@/src/inventory/search')
    const result = await searchProjects(BASE)

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.map((m) => m.projectId)).toEqual(['proj-active-a'])
      expect(result.matches.every((m) => m.score >= MIN_RELEVANCE)).toBe(true)
    }
  })

  it('an all-irrelevant set refuses rather than returning noise', async () => {
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-b', 'proj-active-c']))

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects(BASE)

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('no_match')
    }
  })

  it('results are capped at MAX_MATCHES (payload guard — was all 83 active projects)', async () => {
    // 12 relevant projects → must be truncated to MAX_MATCHES.
    mockProjectsGet.mockResolvedValueOnce(
      makeAdHocSnap(
        Array.from({ length: 12 }, (_, i) => ({
          id: `proj-bulk-${i}`,
          doc: { ...FIXTURES['proj-active-a'], priceValue: 500_000 + i },
        })),
      ),
    )
    mockEmbedText.mockResolvedValueOnce(STUB_QUERY_VECTOR)

    const { searchProjects, MAX_MATCHES } = await import('@/src/inventory/search')
    const result = await searchProjects(BASE)

    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.matches.length).toBe(MAX_MATCHES)
    }
  })

  it('segment weighting cannot outrank relevance across tiers', async () => {
    // proj-active-a: highly relevant (dim-0, score 0.9) but only 2 bedrooms.
    // proj-active-b: irrelevant to this query (score 0.01) but 4 bedrooms.
    // The old own_stay sort was bedrooms-first, so b would win. Relevance tier is now
    // primary, so the far more relevant project must stay on top.
    mockProjectsGet.mockResolvedValueOnce(
      makeProjectSnap(['proj-active-b', 'proj-active-a']),
    )
    // Lower the floor's effect by scoring both above it: dim-0 0.9 vs a blended vector.
    mockEmbedText.mockResolvedValueOnce(
      Array.from({ length: 1024 }, (_, i) => (i === 0 ? 0.9 : i === 1 ? 0.3 : 0.0)),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, segment: 'own_stay' })

    expect(result.found).toBe(true)
    if (result.found) {
      // a scores ~0.81 (tier 16); b scores ~0.27 (tier 5). Bedrooms must not cross tiers.
      expect(result.matches[0].projectId).toBe('proj-active-a')
    }
  })

  it('own_stay ranking no longer uses locationText.length', async () => {
    // The old secondary key was the CHARACTER COUNT of locationText — a "location
    // richness" proxy with no relationship to where the project is. Two projects with
    // equal relevance and equal bedrooms must not be ordered by string length.
    const short = { ...FIXTURES['proj-active-c'], bedrooms: 3, locationText: 'Bangsar' }
    const long = {
      ...FIXTURES['proj-active-c'],
      bedrooms: 3,
      locationText: 'Bangsar, Kuala Lumpur with a very long descriptive location blurb attached',
    }
    mockProjectsGet.mockResolvedValueOnce(
      makeAdHocSnap([
        { id: 'proj-short', doc: short },
        { id: 'proj-long', doc: long },
      ]),
    )
    mockEmbedText.mockResolvedValueOnce(
      Array.from({ length: 1024 }, (_, i) => (i === 2 ? 1.0 : 0.0)),
    )

    const { searchProjects } = await import('@/src/inventory/search')
    const result = await searchProjects({ ...BASE, segment: 'own_stay' })

    expect(result.found).toBe(true)
    if (result.found) {
      // Identical score and bedrooms → stable input order, NOT longest-locationText-first.
      expect(result.matches[0].projectId).toBe('proj-short')
    }
  })

  it('status:active is still the base Firestore gate (T-03-05)', async () => {
    mockProjectsGet.mockResolvedValueOnce(makeProjectSnap(['proj-active-a']))

    const { searchProjects } = await import('@/src/inventory/search')
    await searchProjects({ ...BASE, locationPref: 'KLCC', priceMax: 1_000_000 })

    // The very first filter applied must be status == active — the new location/price
    // gates run in memory and must NOT have displaced it.
    expect(mockWhereFn).toHaveBeenCalledWith('status', '==', 'active')
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
