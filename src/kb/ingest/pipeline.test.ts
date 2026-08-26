/**
 * pipeline.test.ts — shardJob's idempotency short-circuit (quick-kayinleong-060).
 *
 * The bug: shardJob keys idempotency on the file's sha256 and returned the existing job
 * VERBATIM — including the docId it was created with. Delete a KB doc, re-upload its file,
 * and createDocFromFile makes a NEW kbDoc while shardJob hands back the OLD job still bound
 * to the DELETED one. Chunks embed against a dangling docId, the new doc stays empty, and
 * completion dies with "5 NOT_FOUND: No document to update: …/kbDocs/…".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet, mockUpdate, mockExtractText, mockChunk } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(async (_patch: Record<string, unknown>) => {}),
  mockExtractText: vi.fn(async () => ({ text: 'extracted' })),
  mockChunk: vi.fn(() => [{ text: 'c1' }, { text: 'c2' }]),
}))

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__DELETE__', serverTimestamp: () => '__TS__' },
}))

vi.mock('@/src/firebase/collections', () => ({
  TENANT_ID: 'd2',
  kbIngestionJobsRef: () => ({
    where: () => ({ limit: () => ({ get: mockGet }) }),
    doc: () => ({ set: vi.fn(async () => {}) }),
  }),
  kbDocsRef: () => ({ doc: () => ({ get: vi.fn(), update: vi.fn() }) }),
  kbChunksRef: () => ({ add: vi.fn(), where: () => ({ get: vi.fn() }) }),
}))

vi.mock('@/src/rag/embed', () => ({ embedText: vi.fn(async () => [0.1]) }))
vi.mock('@/src/kb/ingest/chunker', () => ({ chunk: mockChunk }))
vi.mock('@/src/kb/ingest/pdf', () => ({ extractText: mockExtractText }))
vi.mock('gpt-tokenizer', () => ({ countTokens: () => 10 }))

import { shardJob } from './pipeline'

const FILE = {
  buffer: Buffer.from('the same bytes every time'),
  name: 'sales-kit.pdf',
  mimeType: 'application/pdf',
  lang: 'en' as const,
  pillar: 'finder' as const,
}

/** An existing job for the same file hash, bound to `docId`. */
function existingJob(docId: string, extra: Record<string, unknown> = {}) {
  return {
    empty: false,
    docs: [
      {
        id: 'job-abc123',
        ref: { update: mockUpdate },
        data: () => ({ total: 5, remaining: 2, status: 'processing', docId, ...extra }),
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue(undefined)
})

describe('shardJob — existing job for the same file', () => {
  it('re-points the job when the target kbDoc is DIFFERENT, and resets remaining', async () => {
    mockGet.mockResolvedValue(existingJob('deleted-doc-id'))

    const result = await shardJob({ ...FILE, docId: 'brand-new-doc-id' })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.docId).toBe('brand-new-doc-id')
    // Without the reset the job is already at remaining=2/complete, so the NEW doc would
    // never receive its chunks and would sit empty forever.
    expect(patch.remaining).toBe(5)
    expect(patch.status).toBe('pending')

    expect(result.remaining).toBe(5)
    expect(result.status).toBe('pending')
    expect(result.jobId).toBe('job-abc123')
  })

  it('does NOT re-extract or re-chunk — that work is already stored on the job', async () => {
    mockGet.mockResolvedValue(existingJob('deleted-doc-id'))
    await shardJob({ ...FILE, docId: 'brand-new-doc-id' })
    expect(mockExtractText).not.toHaveBeenCalled()
    expect(mockChunk).not.toHaveBeenCalled()
  })

  it('clears a stale supersedesId so the wrong doc is never retired', async () => {
    mockGet.mockResolvedValue(existingJob('old-doc', { supersedesId: 'some-older-doc' }))
    await shardJob({ ...FILE, docId: 'new-doc' })
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.supersedesId).toBe('__DELETE__')
  })

  it('carries the supersedesId of THIS request when one is given', async () => {
    mockGet.mockResolvedValue(existingJob('old-doc'))
    await shardJob({ ...FILE, docId: 'new-doc', supersedesId: 'v1-doc' })
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.supersedesId).toBe('v1-doc')
  })

  it('leaves a job for the SAME doc untouched — that is real idempotency', async () => {
    // A double submit must not restart an in-flight ingestion from the top.
    mockGet.mockResolvedValue(existingJob('same-doc'))

    const result = await shardJob({ ...FILE, docId: 'same-doc' })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(result.remaining).toBe(2)
    expect(result.status).toBe('processing')
    expect(result.isExisting).toBe(true)
  })
})
