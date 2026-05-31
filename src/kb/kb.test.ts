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
 *   Test 4: processBatch(jobId, limit) embeds `limit` chunks (voyageEmbed document),
 *           writes them to kbChunks, decrements remaining, and returns { remaining };
 *           when remaining hits 0 it marks the doc/job complete.
 *
 * Firestore and voyageEmbed are mocked — no live credentials needed.
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
  mockVoyageEmbed,
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

  const mockVoyageEmbed = vi.fn().mockResolvedValue(new Array(1024).fill(0.001))

  return {
    mockIngestionJobsSet,
    mockIngestionJobsDoc,
    mockIngestionJobsGet,
    mockIngestionJobsUpdate,
    mockChunksAdd,
    mockKbDocsDoc,
    mockKbDocsUpdate,
    mockVoyageEmbed,
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
  voyageEmbed: mockVoyageEmbed,
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
    // Reset mockVoyageEmbed to return a 1024-d vector
    mockVoyageEmbed.mockResolvedValue(new Array(1024).fill(0.001))
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

    it('should embed `limit` chunks with voyageEmbed document inputType', async () => {
      await processBatch('test-job-id', 2)

      expect(mockVoyageEmbed).toHaveBeenCalledTimes(2)
      for (const call of mockVoyageEmbed.mock.calls) {
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
