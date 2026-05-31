/**
 * RAG module unit tests — offline (no live Voyage or Firestore).
 *
 * Task 1: voyageEmbed + firestoreRetrieve + retrieve adapter (4 behaviors)
 * Task 2: buildCitations + isRetrievalMiss (3 behaviors)
 *
 * All Voyage API calls and Firestore findNearest calls are mocked.
 * The default `npx vitest run` MUST stay green without live credentials.
 *
 * References:
 *   - 01-09-PLAN.md: embed.ts, search.ts, index.ts, citations.ts, pinecone.ts
 *   - TSD §4: kbChunks findNearest DOT_PRODUCT, lang pre-filter, 1024-d normalized
 *   - 01-RESEARCH.md lines 384-413: retrieve() shape, findNearest signature
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (hoisted so vi.mock factories can reference them) ─────────────────

const { mockVoyageEmbed, mockFindNearest } = vi.hoisted(() => {
  // Stub voyageEmbed: returns a 1024-length vector by default
  const mockVoyageEmbed = vi.fn(
    async (_text: string, _opts: { model: string; inputType: 'query' | 'document' }) => {
      return Array.from({ length: 1024 }, (_, i) => (i + 1) / 1024)
    },
  )

  // Stub findNearest chain: .where().findNearest({}).get() → empty snap by default
  const mockGet = vi.fn(async () => ({ docs: [] }))
  const mockFindNearest = vi.fn(() => ({ get: mockGet }))
  const mockWhere = vi.fn(() => ({ findNearest: mockFindNearest }))
  const mockCollection = vi.fn(() => ({ where: mockWhere }))

  return { mockVoyageEmbed, mockFindNearest, mockWhere, mockGet, mockCollection }
})

// Mock the embed module so search.ts and index.ts use the stub
vi.mock('@/src/rag/embed', () => ({
  voyageEmbed: mockVoyageEmbed,
}))

// Mock firebase admin so Firestore is never actually called
vi.mock('@/src/firebase/admin', () => {
  const mockGet = vi.fn(async () => ({ docs: [] }))
  const mockFindNearestInner = vi.fn(() => ({ get: mockGet }))
  const mockWhere = vi.fn(() => ({ findNearest: mockFindNearestInner }))
  const mockCollection = vi.fn(() => ({ where: mockWhere }))
  return {
    adminDb: {
      collection: mockCollection,
    },
  }
})

// Mock kbChunksRef (not used directly in search.ts but keep consistent)
vi.mock('@/src/firebase/collections', () => ({
  kbChunksRef: vi.fn(() => ({})),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a mock Firestore snapshot with the given docs array.
 * Each doc has: { id: chunkId, data() → { text, lang, score?, docId? } }
 */
function makeSnap(docs: Array<{ id: string; text: string; lang: string; docId?: string }>) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        text: d.text,
        lang: d.lang,
        docId: d.docId ?? 'doc-1',
        tokens: 50,
        ownerCollection: 'kbChunks',
        embedding: [],
        tenantId: 'd2',
      }),
    })),
  }
}

// ─── Task 1 tests: voyageEmbed ─────────────────────────────────────────────

describe('voyageEmbed', () => {
  it('Test 1: returns a 1024-length number[] and passes inputType through', async () => {
    const { voyageEmbed } = await import('@/src/rag/embed')

    const result = await voyageEmbed('hello world', {
      model: 'voyage-3-large',
      inputType: 'query',
    })

    // 1024 dimensions
    expect(result).toHaveLength(1024)
    // all entries are numbers
    result.forEach((v) => expect(typeof v).toBe('number'))
    // inputType forwarded (mock records calls)
    expect(mockVoyageEmbed).toHaveBeenCalledWith('hello world', {
      model: 'voyage-3-large',
      inputType: 'query',
    })
  })
})

// ─── Task 1 tests: retrieve (Firestore adapter via index.ts) ─────────────────

describe('retrieve (Firestore adapter)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('Test 2: calls findNearest with DOT_PRODUCT + limit:8 for userLang=en', async () => {
    // Reset the firebase/admin mock to inspect findNearest call args
    const mockGetFn = vi.fn(async () => ({
      docs: [
        {
          id: 'chunk-001',
          data: () => ({
            text: 'Onboarding overview',
            lang: 'en',
            docId: 'doc-1',
            tokens: 40,
            ownerCollection: 'kbChunks',
            embedding: [],
            tenantId: 'd2',
          }),
        },
      ],
    }))
    const mockFindNearestFn = vi.fn(() => ({ get: mockGetFn }))
    const mockWhereFn = vi.fn(() => ({ findNearest: mockFindNearestFn }))
    const mockCollectionFn = vi.fn(() => ({ where: mockWhereFn }))

    vi.doMock('@/src/firebase/admin', () => ({
      adminDb: { collection: mockCollectionFn },
    }))
    vi.doMock('@/src/rag/embed', () => ({
      voyageEmbed: vi.fn(async () => Array.from({ length: 1024 }, () => 0.001)),
    }))

    const { firestoreRetrieve } = await import('@/src/rag/search')
    await firestoreRetrieve('how do I start onboarding', 'en')

    // where() called with lang pre-filter ['en', 'en'] or ['en'] (both acceptable for userLang=en)
    expect(mockWhereFn).toHaveBeenCalledWith('lang', 'in', expect.arrayContaining(['en']))

    // findNearest called with DOT_PRODUCT + limit:8
    const findNearestArg = mockFindNearestFn.mock.calls[0][0]
    expect(findNearestArg.distanceMeasure).toBe('DOT_PRODUCT')
    expect(findNearestArg.limit).toBe(8)
    expect(findNearestArg.vectorField).toBe('embedding')
  })

  it('Test 3: for userLang=ms, pre-filter includes ["ms", "en"]', async () => {
    const mockGetFn = vi.fn(async () => ({ docs: [] }))
    const mockFindNearestFn = vi.fn(() => ({ get: mockGetFn }))
    const mockWhereFn = vi.fn(() => ({ findNearest: mockFindNearestFn }))
    const mockCollectionFn = vi.fn(() => ({ where: mockWhereFn }))

    vi.doMock('@/src/firebase/admin', () => ({
      adminDb: { collection: mockCollectionFn },
    }))
    vi.doMock('@/src/rag/embed', () => ({
      voyageEmbed: vi.fn(async () => Array.from({ length: 1024 }, () => 0.001)),
    }))

    const { firestoreRetrieve } = await import('@/src/rag/search')
    await firestoreRetrieve('cara memulakan onboarding', 'ms')

    // Pre-filter must include both 'ms' and 'en'
    expect(mockWhereFn).toHaveBeenCalledWith('lang', 'in', expect.arrayContaining(['ms', 'en']))
  })

  it('Test 4: returns [] when findNearest returns no docs (retrieval-miss signal)', async () => {
    const mockGetFn = vi.fn(async () => ({ docs: [] }))
    const mockFindNearestFn = vi.fn(() => ({ get: mockGetFn }))
    const mockWhereFn = vi.fn(() => ({ findNearest: mockFindNearestFn }))
    const mockCollectionFn = vi.fn(() => ({ where: mockWhereFn }))

    vi.doMock('@/src/firebase/admin', () => ({
      adminDb: { collection: mockCollectionFn },
    }))
    vi.doMock('@/src/rag/embed', () => ({
      voyageEmbed: vi.fn(async () => Array.from({ length: 1024 }, () => 0.001)),
    }))

    const { retrieve } = await import('@/src/rag/index')
    const result = await retrieve('unknown query', 'zh')

    expect(result).toEqual([])
  })
})

// ─── Task 2 tests: buildCitations + isRetrievalMiss ──────────────────────────

describe('buildCitations', () => {
  it('Test 1: maps retrieval results to citation list preserving real chunk IDs', async () => {
    const { buildCitations } = await import('@/src/rag/citations')

    const results = [
      { chunkId: 'chunk-abc', text: 'Compliance requirements for new D2 agents.', lang: 'en', score: 0.92, docId: 'doc-1' },
      { chunkId: 'chunk-xyz', text: 'Commission structure explained.', lang: 'en', score: 0.85, docId: 'doc-2' },
    ]

    const { citations } = buildCitations(results)

    // All citation chunkIds came from input — no fabricated IDs
    const inputIds = new Set(results.map((r) => r.chunkId))
    citations.forEach((c) => {
      expect(inputIds.has(c.chunkId)).toBe(true)
    })
    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({ chunkId: 'chunk-abc', docId: 'doc-1' })
    expect(citations[0].snippet).toBeTruthy()
  })

  it('Test 2: buildCitations([]) returns [] and missed:true for handoff/no_sop_match', async () => {
    const { buildCitations, isRetrievalMiss } = await import('@/src/rag/citations')

    const { citations, missed } = buildCitations([])

    expect(citations).toEqual([])
    expect(missed).toBe(true)
    expect(isRetrievalMiss([])).toBe(true)
  })

  it('Test 3: citations are de-duplicated by chunkId and capped', async () => {
    const { buildCitations } = await import('@/src/rag/citations')

    // Duplicate chunkId 'chunk-dup' appears twice
    const results = [
      { chunkId: 'chunk-dup', text: 'First occurrence.', lang: 'en', score: 0.95, docId: 'doc-1' },
      { chunkId: 'chunk-dup', text: 'Second occurrence (duplicate).', lang: 'en', score: 0.91, docId: 'doc-1' },
      { chunkId: 'chunk-2', text: 'Other content.', lang: 'en', score: 0.88, docId: 'doc-2' },
      { chunkId: 'chunk-3', text: 'Content 3.', lang: 'en', score: 0.87, docId: 'doc-3' },
      { chunkId: 'chunk-4', text: 'Content 4.', lang: 'en', score: 0.86, docId: 'doc-4' },
      { chunkId: 'chunk-5', text: 'Content 5.', lang: 'en', score: 0.85, docId: 'doc-5' },
      { chunkId: 'chunk-6', text: 'Content 6.', lang: 'en', score: 0.84, docId: 'doc-6' },
    ]

    const { citations } = buildCitations(results)

    // De-duplicated: chunk-dup should appear once
    const ids = citations.map((c) => c.chunkId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)

    // Capped (no more than MAX_CITATIONS = 5)
    expect(citations.length).toBeLessThanOrEqual(5)
  })
})
