/**
 * src/kb/kb.test.ts
 *
 * Unit tests for the KB ingestion pipeline (chunker + PDF/DOCX extraction +
 * idempotent chunked-poll ingestion).
 *
 * All 4 behaviors:
 *   Test 1: chunk(text) produces token-bounded chunks with overlap;
 *           chunk count is deterministic for a given input.
 *   Test 2: shardJob(file) computes sha256 fileHash and creates a
 *           kbIngestionJobs/{jobId} with total=chunkCount, remaining=total, status:'pending'.
 *   Test 3: re-sharding the SAME file (same sha256) is idempotent —
 *           it does NOT create duplicate kbChunks.
 *   Test 4: processBatch(jobId, limit) embeds `limit` chunks (embedText document),
 *           writes them to kbChunks with status:'published', decrements remaining,
 *           and returns { remaining }; when remaining hits 0 marks the doc/job complete.
 *
 * 02-02 additions:
 *   Test 5: processBatch writes kbChunks with status:'published' (Pitfall 3 fix).
 *   Test 6: version supersede cascade — markSuperseded sets old doc + chunks 'superseded'.
 *   Test 7: publishDoc / unpublishDoc toggles doc + chunk status.
 *   Test 8: correctKbDoc allows senior-coach role; creates new version with correctedBy.
 *   Test 9: deleteDoc deletes doc + all associated kbChunks (close orphan-chunk note).
 *   Test 10: assertAdmin rejects non-admin; correctKbDoc allows 'admin'|'senior-coach'.
 *
 * Firestore and embedText are mocked — no live credentials needed.
 * No PII in fixtures.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
// vi.hoisted() runs before module-level vi.mock() factories; variables declared
// here are available inside the factory functions below.

const {
  mockIngestionJobsSet,
  mockIngestionJobsDoc,
  mockIngestionJobsGet,
  mockIngestionJobsUpdate,
  mockChunksAdd,
  mockKbDocsDoc,
  mockKbDocsUpdate,
  mockEmbedText,
  mockJobDocData,
} = vi.hoisted(() => {
  // Track calls to Firestore operations
  const mockIngestionJobsSet = vi.fn().mockResolvedValue(undefined)
  const mockIngestionJobsUpdate = vi.fn().mockResolvedValue(undefined)
  const mockChunksAdd = vi.fn().mockResolvedValue({ id: 'mock-chunk-id' })
  const mockKbDocsUpdate = vi.fn().mockResolvedValue(undefined)

  // Mutable job doc state (simulates reading from Firestore)
  const mockJobDocData = {
    fileHash: 'abc123',
    total: 4,
    remaining: 4,
    status: 'pending',
    chunkTexts: ['chunk0', 'chunk1', 'chunk2', 'chunk3'],
    docId: 'mock-doc-id',
    lang: 'en' as const,
    pillar: 'coach' as const,
  }

  const mockIngestionJobsGet = vi.fn().mockImplementation(() =>
    Promise.resolve({
      exists: true,
      data: () => ({ ...mockJobDocData }),
    })
  )

  const mockIngestionJobsDoc = vi.fn().mockImplementation(() => ({
    set: mockIngestionJobsSet,
    get: mockIngestionJobsGet,
    update: mockIngestionJobsUpdate,
  }))

  const mockKbDocsDoc = vi.fn().mockImplementation(() => ({
    update: mockKbDocsUpdate,
  }))

  const mockEmbedText = vi.fn().mockResolvedValue(new Array(1024).fill(0.001))

  return {
    mockIngestionJobsSet,
    mockIngestionJobsDoc,
    mockIngestionJobsGet,
    mockIngestionJobsUpdate,
    mockChunksAdd,
    mockKbDocsDoc,
    mockKbDocsUpdate,
    mockEmbedText,
    mockJobDocData,
  }
})

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/src/firebase/collections', () => ({
  kbIngestionJobsRef: vi.fn(() => ({
    doc: mockIngestionJobsDoc,
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      }),
      get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    }),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  })),
  kbChunksRef: vi.fn(() => ({
    add: mockChunksAdd,
  })),
  kbDocsRef: vi.fn(() => ({
    doc: mockKbDocsDoc,
  })),
  TENANT_ID: 'd2',
}))

vi.mock('@/src/rag/embed', () => ({
  embedText: mockEmbedText,
  EMBED_DIM: 1024,
}))

// ─── Imports under test ───────────────────────────────────────────────────────

import { chunk } from '@/src/kb/ingest/chunker'
import { shardJob, processBatch } from '@/src/kb/ingest/pipeline'

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Synthetic KB content — D2-flavored, no PII */
const SAMPLE_TEXT = `
Welcome to D2 Property. As a new agent, your first week focuses on completing the compliance
checklist, attending the product knowledge session, and setting up your CRM account.

D2 Compliance Checklist: All agents must submit a certified true copy of their REN tag,
NRIC, and bank account details within 3 working days of joining. Failure to do so will
delay commission processing.

Product Knowledge: D2 currently offers residential and commercial projects in Kuala Lumpur,
Selangor, and Johor. Key projects include Taman D2 Residences (freehold, bumiputera-reserved
lots available) and D2 Commercial Hub (strata offices, foreigner-eligible).

CRM Setup: Use the D2 CRM portal at crm.d2property.my. Your login credentials are sent to
your registered email. Complete your profile and link your upline coach before submitting
your first lead.

Commission Structure: D2 agents earn a base commission of 1.5% on residential sales and
2.0% on commercial sales. Bonuses apply for achieving monthly targets above RM 500,000.
Senior agents with 2+ years receive an additional 0.25% override.
`.trim()

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KB Ingestion Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mockEmbedText to return a 1024-d vector
    mockEmbedText.mockResolvedValue(new Array(1024).fill(0.001))
  })

  // ─── Test 1: chunker ────────────────────────────────────────────────────────

  describe('Test 1: chunk(text) — token-bounded chunks with overlap', () => {
    it('should produce at least one chunk for non-empty text', () => {
      const chunks = chunk(SAMPLE_TEXT)
      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should produce deterministic chunk count for a given input', () => {
      const chunks1 = chunk(SAMPLE_TEXT)
      const chunks2 = chunk(SAMPLE_TEXT)
      expect(chunks1.length).toBe(chunks2.length)
      expect(chunks1.map((c) => c.text)).toEqual(chunks2.map((c) => c.text))
    })

    it('each chunk should not exceed the maxTokens limit', () => {
      const maxTokens = 400
      const chunks = chunk(SAMPLE_TEXT, { maxTokens })
      for (const c of chunks) {
        expect(c.tokens).toBeLessThanOrEqual(maxTokens)
      }
    })

    it('each chunk should have a non-empty text and a token count', () => {
      const chunks = chunk(SAMPLE_TEXT)
      for (const c of chunks) {
        expect(c.text.trim().length).toBeGreaterThan(0)
        expect(c.tokens).toBeGreaterThan(0)
      }
    })

    it('should produce the same chunks with default options (deterministic)', () => {
      const c1 = chunk(SAMPLE_TEXT)
      const c2 = chunk(SAMPLE_TEXT)
      expect(c1).toEqual(c2)
    })
  })

  // ─── Test 2: shardJob ───────────────────────────────────────────────────────

  describe('Test 2: shardJob(file) — sha256 hash + kbIngestionJobs doc', () => {
    it('should call kbIngestionJobsRef().doc().set() with total and remaining', async () => {
      const file = {
        buffer: Buffer.from(SAMPLE_TEXT),
        name: 'onboarding.txt',
        mimeType: 'text/plain',
        docId: 'kb-doc-001',
        lang: 'en' as const,
        pillar: 'coach' as const,
      }

      const result = await shardJob(file)

      expect(result.fileHash).toBeDefined()
      expect(result.fileHash.length).toBe(64) // sha256 hex = 64 chars
      expect(result.total).toBeGreaterThan(0)
      expect(result.remaining).toBe(result.total)
      expect(result.status).toBe('pending')
      expect(mockIngestionJobsSet).toHaveBeenCalledOnce()

      const callArg = mockIngestionJobsSet.mock.calls[0][0]
      expect(callArg.fileHash).toBe(result.fileHash)
      expect(callArg.total).toBe(result.total)
      expect(callArg.remaining).toBe(result.total)
      expect(callArg.status).toBe('pending')
    })

    it('should include chunkTexts, docId, lang, pillar in the job doc', async () => {
      const file = {
        buffer: Buffer.from(SAMPLE_TEXT),
        name: 'onboarding.txt',
        mimeType: 'text/plain',
        docId: 'kb-doc-001',
        lang: 'en' as const,
        pillar: 'coach' as const,
      }

      await shardJob(file)

      const callArg = mockIngestionJobsSet.mock.calls[0][0]
      expect(Array.isArray(callArg.chunkTexts)).toBe(true)
      expect(callArg.chunkTexts.length).toBe(callArg.total)
      expect(callArg.docId).toBe('kb-doc-001')
      expect(callArg.lang).toBe('en')
      expect(callArg.pillar).toBe('coach')
    })
  })

  // ─── Test 3: idempotency ────────────────────────────────────────────────────

  describe('Test 3: idempotency — re-sharding the same file does NOT duplicate', () => {
    it('should detect an existing job with the same sha256 and return early without creating duplicate', async () => {
      // Simulate kbIngestionJobsRef().where().get() returning an existing job
      const { kbIngestionJobsRef } = await import('@/src/firebase/collections')
      const existingJobData = {
        fileHash: '', // will be filled after computing hash
        total: 4,
        remaining: 4,
        status: 'pending',
        chunkTexts: ['chunk0', 'chunk1', 'chunk2', 'chunk3'],
        docId: 'kb-doc-001',
        lang: 'en',
        pillar: 'coach',
      }

      // Mock the where().get() to return a non-empty snapshot
      vi.mocked(kbIngestionJobsRef).mockReturnValue({
        doc: mockIngestionJobsDoc,
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ id: 'existing-job-id', data: () => existingJobData }],
            }),
          }),
        }),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      } as unknown as ReturnType<typeof kbIngestionJobsRef>)

      const file = {
        buffer: Buffer.from(SAMPLE_TEXT),
        name: 'onboarding.txt',
        mimeType: 'text/plain',
        docId: 'kb-doc-001',
        lang: 'en' as const,
        pillar: 'coach' as const,
      }

      const result = await shardJob(file)

      // Should NOT create a new job doc — returned the existing one
      expect(mockIngestionJobsSet).not.toHaveBeenCalled()
      expect(result.jobId).toBe('existing-job-id')
    })
  })

  // ─── Test 4: processBatch ────────────────────────────────────────────────────

  describe('Test 4: processBatch(jobId, limit) — embed + write kbChunks + decrement remaining', () => {
    beforeEach(() => {
      // Reset to fresh state: 4 remaining
      mockJobDocData.remaining = 4
      mockJobDocData.total = 4
      mockJobDocData.chunkTexts = ['chunk0', 'chunk1', 'chunk2', 'chunk3']
      mockJobDocData.status = 'pending'

      mockIngestionJobsGet.mockImplementation(() =>
        Promise.resolve({
          exists: true,
          data: () => ({ ...mockJobDocData }),
        })
      )
    })

    it('should embed `limit` chunks with embedText document inputType', async () => {
      await processBatch('test-job-id', 2)

      expect(mockEmbedText).toHaveBeenCalledTimes(2)
      for (const call of mockEmbedText.mock.calls) {
        expect(call[1]).toMatchObject({ inputType: 'document' })
      }
    })

    it('should write each chunk to kbChunks with the correct fields', async () => {
      await processBatch('test-job-id', 2)

      expect(mockChunksAdd).toHaveBeenCalledTimes(2)
      const firstCall = mockChunksAdd.mock.calls[0][0]
      expect(firstCall.docId).toBe('mock-doc-id')
      expect(firstCall.lang).toBe('en')
      expect(firstCall.ownerCollection).toBe('kbDocs')
      expect(Array.isArray(firstCall.embedding)).toBe(true)
      expect(firstCall.embedding.length).toBe(1024)
      expect(typeof firstCall.tokens).toBe('number')
      expect(firstCall.tenantId).toBe('d2')
    })

    it('Test 5 (02-02): processBatch writes kbChunks with status:"published" (Pitfall 3 fix)', async () => {
      await processBatch('test-job-id', 2)

      expect(mockChunksAdd).toHaveBeenCalledTimes(2)
      for (const call of mockChunksAdd.mock.calls) {
        expect(call[0].status).toBe('published')
      }
    })

    // ─── 04-01 Wave 0 (REPLY-01) — kbChunks.pillar denormalization, GREEN as of 04-03 ──
    //
    // The retrieveReplySop pillar filter (RESEARCH Q7 / Pitfall B) needs `pillar` on
    // EACH kbChunk, denormalized from the parent job doc (mockJobDocData.pillar:'coach').
    // Plan 04-03 destructures `pillar` from jobData and adds it to chunksRef.add({...}),
    // flipping this from the Wave-0 RED guard (`it.fails`) to a real passing assertion.
    it('Test 5b (04-03): processBatch writes a `pillar` field on each kbChunk, denormalized from the job doc', async () => {
      await processBatch('test-job-id', 2)

      expect(mockChunksAdd).toHaveBeenCalledTimes(2)
      for (const call of mockChunksAdd.mock.calls) {
        // pillar must be present AND match the job doc's pillar ('coach' in this fixture)
        expect(call[0].pillar).toBe('coach')
      }
    })

    it('should decrement remaining by the number of chunks processed', async () => {
      const result = await processBatch('test-job-id', 2)

      expect(mockIngestionJobsUpdate).toHaveBeenCalled()
      expect(result.remaining).toBe(2) // 4 - 2 = 2
    })

    it('should mark status as complete when remaining hits 0', async () => {
      // Only 2 chunks, process all 2
      mockJobDocData.remaining = 2
      mockJobDocData.total = 2
      mockJobDocData.chunkTexts = ['chunk0', 'chunk1']

      const result = await processBatch('test-job-id', 2)

      expect(result.remaining).toBe(0)
      // The job or doc should be marked complete
      expect(mockIngestionJobsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'complete', remaining: 0 })
      )
    })

    it('should return { remaining } reflecting updated state', async () => {
      const result = await processBatch('test-job-id', 1)

      expect(typeof result.remaining).toBe('number')
      expect(result.remaining).toBe(3) // 4 - 1 = 3
    })
  })
})

// ─── 02-02 Task 2: crud.ts — version supersede, publish/unpublish, correction ─
//
// These tests use vi.resetModules() + vi.doMock() to isolate each test with
// a fresh mock for kbDocsRef/kbChunksRef since the top-level vi.mock() at the
// top of this file provides a minimal mock for the pipeline tests above.

describe('02-02 KB CRUD: version supersede + publish/unpublish + correction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  // ─── Shared mock factory ────────────────────────────────────────────────────

  function makeCrudMocks() {
    // kbDocs mock: doc(id) → { get, set, update, delete }
    const mockKbDocSet = vi.fn().mockResolvedValue(undefined)
    const mockKbDocUpdate = vi.fn().mockResolvedValue(undefined)
    const mockKbDocDelete = vi.fn().mockResolvedValue(undefined)

    // Old doc data (the doc being updated/superseded)
    const mockOldDocData = {
      title: 'D2 Commission Structure v1',
      sourcePath: 'kb/old-doc-id',
      version: 1,
      lang: 'en' as const,
      pillar: 'coach' as const,
      status: 'published' as const,
      tenantId: 'd2',
    }

    const mockKbDocGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ ...mockOldDocData }),
    })

    const mockKbDocRef = vi.fn().mockImplementation((_id?: string) => ({
      id: _id ?? 'new-doc-id',
      get: mockKbDocGet,
      set: mockKbDocSet,
      update: mockKbDocUpdate,
      delete: mockKbDocDelete,
    }))

    // kbChunks mock: where(...).get() → docs[] for bulk status updates or deletes
    const mockChunkDocs = [
      { id: 'chunk-1', ref: { update: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) } },
      { id: 'chunk-2', ref: { update: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) } },
    ]
    const mockKbChunksWhere = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ docs: mockChunkDocs }),
    })
    const mockKbChunksAdd = vi.fn().mockResolvedValue({ id: 'new-chunk-id' })

    // ingestion jobs mock (for shardJob called from updateDoc)
    const mockJobSet = vi.fn().mockResolvedValue(undefined)
    const mockJobDoc = vi.fn().mockReturnValue({
      id: 'new-job-id',
      set: mockJobSet,
      get: vi.fn().mockResolvedValue({ exists: false }),
    })
    const mockJobsWhere = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      }),
    })

    return {
      mockKbDocRef,
      mockKbDocSet,
      mockKbDocUpdate,
      mockKbDocDelete,
      mockKbDocGet,
      mockOldDocData,
      mockChunkDocs,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobSet,
      mockJobDoc,
      mockJobsWhere,
    }
  }

  // ─── Test 6: version supersede cascade ─────────────────────────────────────

  it('Test 6 (02-02): markSuperseded sets old kbDoc status:superseded + supersededBy, bulk-updates old chunks to superseded', async () => {
    const {
      mockKbDocRef,
      mockKbDocUpdate,
      mockChunkDocs,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd }),
      ),
      kbIngestionJobsRef: vi.fn(() => ({
        doc: mockJobDoc,
        where: mockJobsWhere,
      })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { markSuperseded } = await import('@/src/kb/crud')

    await markSuperseded('old-doc-id', 'new-doc-id')

    // Old kbDoc should be updated to superseded + supersededBy
    expect(mockKbDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'superseded', supersededBy: 'new-doc-id' }),
    )

    // Old kbChunks should be fetched by docId and bulk-updated to superseded
    expect(mockKbChunksWhere).toHaveBeenCalledWith('docId', '==', 'old-doc-id')
    for (const chunkDoc of mockChunkDocs) {
      expect(chunkDoc.ref.update).toHaveBeenCalledWith({ status: 'superseded' })
    }
  })

  // ─── Test 7: unpublishDoc / publishDoc ──────────────────────────────────────

  it('Test 7a (02-02): unpublishDoc sets kbDoc + its chunks to status:unpublished', async () => {
    const {
      mockKbDocRef,
      mockKbDocUpdate,
      mockChunkDocs,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { unpublishDoc } = await import('@/src/kb/crud')
    const adminUser = { uid: 'admin-1', role: 'admin' as const, tenantId: 'd2' }

    await unpublishDoc(adminUser, 'doc-123')

    // kbDoc must be set to unpublished
    expect(mockKbDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'unpublished' }))

    // kbChunks must be queried and bulk-updated to unpublished
    expect(mockKbChunksWhere).toHaveBeenCalledWith('docId', '==', 'doc-123')
    for (const chunkDoc of mockChunkDocs) {
      expect(chunkDoc.ref.update).toHaveBeenCalledWith({ status: 'unpublished' })
    }
  })

  it('Test 7b (02-02): publishDoc restores kbDoc + its chunks to status:published', async () => {
    const {
      mockKbDocRef,
      mockKbDocUpdate,
      mockChunkDocs,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { publishDoc } = await import('@/src/kb/crud')
    const adminUser = { uid: 'admin-1', role: 'admin' as const, tenantId: 'd2' }

    await publishDoc(adminUser, 'doc-123')

    // kbDoc must be set to published
    expect(mockKbDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }))

    // kbChunks must be queried and bulk-updated to published
    expect(mockKbChunksWhere).toHaveBeenCalledWith('docId', '==', 'doc-123')
    for (const chunkDoc of mockChunkDocs) {
      expect(chunkDoc.ref.update).toHaveBeenCalledWith({ status: 'published' })
    }
  })

  // ─── Test 8: correctKbDoc — correction attribution ──────────────────────────

  it('Test 8 (02-02): correctKbDoc allows senior-coach; creates new version with correctedBy', async () => {
    const {
      mockKbDocRef,
      mockKbDocSet,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
      mockJobSet,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { correctKbDoc } = await import('@/src/kb/crud')
    const seniorCoachUser = { uid: 'coach-uid-1', role: 'senior-coach' as const, tenantId: 'd2' }

    const result = await correctKbDoc(
      seniorCoachUser,
      'old-doc-id',
      'Updated D2 commission: residential 1.75% from Jan 2026.',
    )

    // Should NOT throw — senior-coach is allowed
    expect(result).toBeDefined()

    // New doc version must have correctedBy = coach uid
    const setCall = mockKbDocSet.mock.calls[0]
    expect(setCall).toBeDefined()
    const newDocData = setCall[0]
    expect(newDocData.correctedBy).toBe('coach-uid-1')
    expect(newDocData.supersedesId).toBe('old-doc-id')

    // A shard job must have been created
    expect(mockJobSet).toHaveBeenCalled()
  })

  it('Test 8b (02-02): correctKbDoc rejects new-agent role', async () => {
    const {
      mockKbDocRef,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { correctKbDoc } = await import('@/src/kb/crud')
    const agentUser = { uid: 'agent-1', role: 'new-agent' as const, tenantId: 'd2' }

    await expect(
      correctKbDoc(agentUser, 'doc-id', 'Some correction content'),
    ).rejects.toThrow()
  })

  // ─── Test 9: deleteDoc cleans up kbChunks ──────────────────────────────────

  it('Test 9 (02-02): deleteDoc deletes kbDoc AND hard-deletes all associated kbChunks', async () => {
    const {
      mockKbDocRef,
      mockKbDocDelete,
      mockChunkDocs,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { deleteDoc } = await import('@/src/kb/crud')
    const adminUser = { uid: 'admin-1', role: 'admin' as const, tenantId: 'd2' }

    await deleteDoc(adminUser, 'doc-to-delete')

    // kbDocs doc must be deleted
    expect(mockKbDocDelete).toHaveBeenCalled()

    // kbChunks for this docId must be fetched and each hard-deleted
    expect(mockKbChunksWhere).toHaveBeenCalledWith('docId', '==', 'doc-to-delete')
    for (const chunkDoc of mockChunkDocs) {
      expect(chunkDoc.ref.delete).toHaveBeenCalled()
    }
  })

  // ─── Test 10: assertAdmin guards; correctKbDoc allows admin|senior-coach ────

  it('Test 10a (02-02): publishDoc/unpublishDoc reject non-admin (new-agent)', async () => {
    const {
      mockKbDocRef,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { publishDoc, unpublishDoc } = await import('@/src/kb/crud')
    const agentUser = { uid: 'agent-1', role: 'new-agent' as const, tenantId: 'd2' }

    await expect(publishDoc(agentUser, 'doc-1')).rejects.toThrow()
    await expect(unpublishDoc(agentUser, 'doc-1')).rejects.toThrow()
  })

  it('Test 10b (02-02): correctKbDoc allows admin role too', async () => {
    const {
      mockKbDocRef,
      mockKbDocSet,
      mockKbChunksWhere,
      mockKbChunksAdd,
      mockJobDoc,
      mockJobsWhere,
    } = makeCrudMocks()

    vi.doMock('@/src/firebase/collections', () => ({
      kbDocsRef: vi.fn(() => ({ doc: mockKbDocRef })),
      kbChunksRef: vi.fn(() => ({ where: mockKbChunksWhere, add: mockKbChunksAdd })),
      kbIngestionJobsRef: vi.fn(() => ({ doc: mockJobDoc, where: mockJobsWhere })),
      TENANT_ID: 'd2',
    }))
    vi.doMock('@/src/rag/embed', () => ({
      embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    }))

    const { correctKbDoc } = await import('@/src/kb/crud')
    const adminUser = { uid: 'admin-1', role: 'admin' as const, tenantId: 'd2' }

    const result = await correctKbDoc(adminUser, 'old-doc-id', 'Admin correction content')
    expect(result).toBeDefined()

    const setCall = mockKbDocSet.mock.calls[0]
    expect(setCall[0].correctedBy).toBe('admin-1')
  })
})
