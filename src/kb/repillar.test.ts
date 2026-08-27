/**
 * repillar.test.ts — moving KB documents between pillars (quick-kayinleong-064).
 *
 * The corpus is 1068 Finder docs and 1 Coach doc, so every Coach question kb_misses. The
 * fix Derek needs is a way to move documents — and the load-bearing part is that the
 * CHUNKS move with them: every retrieval path filters findNearest on `kbChunks.pillar`, so
 * moving only the kbDocs row would relabel the admin table and change nothing retrievable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

const {
  mockDocGet, mockDocUpdate, mockDocSet, mockChunksGet, mockChunkUpdate, mockChunkAdd, mockDocRef,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn(async () => ({ exists: true }) as Record<string, unknown>)
  const mockDocUpdate = vi.fn(async (_p: Record<string, unknown>) => {})
  const mockDocSet = vi.fn(async (_p: Record<string, unknown>) => {})
  const mockChunkUpdate = vi.fn(async (_p: Record<string, unknown>) => {})
  const mockChunkAdd = vi.fn(async (_p: Record<string, unknown>) => ({ id: 'new-chunk' }))
  const mockChunksGet = vi.fn(async () => ({ size: 0, docs: [] as Array<Record<string, unknown>> }))
  // copyDocsToPillar reads the SOURCE then probes the TARGET id. The second get() is the
  // "already copied?" check, so the mock answers it from a flag the tests control.
  const mockDocRef = vi.fn((id: string) => ({
    get: id.includes('--')
      ? vi.fn(async () => ({ exists: mockTargetExists }))
      : mockDocGet,
    update: mockDocUpdate,
    set: mockDocSet,
  }))
  return {
    mockDocGet, mockDocUpdate, mockDocSet, mockChunksGet, mockChunkUpdate, mockChunkAdd, mockDocRef,
  }
})

/** Whether the deterministic copy id already exists (set per test). */
let mockTargetExists = false

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__TS__',
    delete: () => '__DEL__',
    vector: (a: number[]) => ({ __vector: a }),
  },
}))

vi.mock('@/src/firebase/collections', () => ({
  TENANT_ID: 'd2',
  kbDocsRef: () => ({ doc: mockDocRef, where: () => ({ get: vi.fn() }) }),
  kbChunksRef: () => ({ where: () => ({ get: mockChunksGet }), add: mockChunkAdd }),
  kbIngestionJobsRef: () => ({ where: () => ({ limit: () => ({ get: vi.fn() }) }) }),
}))

vi.mock('@/src/rag/embed', () => ({ embedText: vi.fn(), EMBED_DIM: 1024 }))
vi.mock('@/src/kb/ingest/pipeline', () => ({ shardJob: vi.fn() }))
vi.mock('@/src/audit', () => ({ log: vi.fn() }))

import {
  repillarDocs,
  REPILLAR_DOC_LIMIT,
  copyDocsToPillar,
  copyDocId,
  COPY_DOC_LIMIT,
} from './crud'

const ADMIN = { uid: 'admin-1', role: 'admin', tenantId: 'd2' } as AuthenticatedUser
const AGENT = { uid: 'a-1', role: 'new-agent', tenantId: 'd2' } as AuthenticatedUser

const chunks = (n: number, data: Record<string, unknown> = {}) => ({
  size: n,
  docs: Array.from({ length: n }, () => ({
    ref: { update: mockChunkUpdate },
    data: () => ({ text: 't', embedding: [0.1], tokens: 1, chunkIndex: 0, ...data }),
  })),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockTargetExists = false
  mockDocGet.mockResolvedValue({ exists: true })
  mockChunksGet.mockResolvedValue(chunks(0))
})

describe('repillarDocs', () => {
  it('moves the CHUNKS, not just the doc — this is what retrieval filters on', async () => {
    mockChunksGet.mockResolvedValue(chunks(3))

    const result = await repillarDocs(ADMIN, ['d1'], 'coach')

    expect(mockDocUpdate).toHaveBeenCalledWith({ pillar: 'coach' })
    expect(mockChunkUpdate).toHaveBeenCalledTimes(3)
    const chunkPatch = mockChunkUpdate.mock.calls[0][0]
    expect(chunkPatch.pillar).toBe('coach')
    // quick-066: a chunk written as a bare number[] is invisible to the vector index, so
    // moving it to Coach without repairing the type would relabel an UNSEARCHABLE chunk
    // and the move would look like it had done nothing.
    expect(chunkPatch.embedding).toEqual({ __vector: [0.1] })
    expect(result).toEqual({ docsMoved: 1, chunksMoved: 3, remaining: [] })
  })

  it('is bounded per call and hands the rest back to the caller', async () => {
    const ids = Array.from({ length: REPILLAR_DOC_LIMIT + 3 }, (_, i) => `d${i}`)
    const result = await repillarDocs(ADMIN, ids, 'finder')
    expect(result.docsMoved).toBe(REPILLAR_DOC_LIMIT)
    expect(result.remaining).toHaveLength(3)
    expect(result.remaining[0]).toBe(`d${REPILLAR_DOC_LIMIT}`)
  })

  it('skips a document deleted since the page rendered, without aborting the batch', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false }).mockResolvedValue({ exists: true })
    const result = await repillarDocs(ADMIN, ['gone', 'here'], 'coach')
    expect(result.docsMoved).toBe(1)
    expect(mockDocUpdate).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-admin', async () => {
    await expect(repillarDocs(AGENT, ['d1'], 'coach')).rejects.toThrow()
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('rejects a pillar that is not one of the three', async () => {
    await expect(
      repillarDocs(ADMIN, ['d1'], 'marketing' as unknown as 'coach'),
    ).rejects.toThrow(/invalid pillar/)
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('filters malformed ids before touching Firestore', async () => {
    const result = await repillarDocs(ADMIN, ['  ', 'a/b', 'x'.repeat(129), 'ok'], 'reply')
    expect(result.docsMoved).toBe(1)
    expect(mockDocRef).toHaveBeenCalledWith('ok')
  })

  it('does nothing for an empty selection', async () => {
    const result = await repillarDocs(ADMIN, [], 'coach')
    expect(result).toEqual({ docsMoved: 0, chunksMoved: 0, remaining: [] })
    expect(mockDocGet).not.toHaveBeenCalled()
  })
})

// ─── copyDocsToPillar (quick-kayinleong-065) ─────────────────────────────────
//
// Move is destructive to the source pillar, which is the wrong tool when Coach needs
// material that Finder still has to serve.

describe('copyDocsToPillar', () => {
  beforeEach(() => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Sales kit',
        sourcePath: 'kb/src/sales.pdf',
        lang: 'en',
        pillar: 'finder',
        status: 'published',
        version: 3,
        supersedesId: 'older-doc',
        correctedBy: 'coach-9',
      }),
    })
    mockChunksGet.mockResolvedValue(chunks(0))
  })

  it('duplicates the doc AND its chunks under the target pillar', async () => {
    mockChunksGet.mockResolvedValue(chunks(2))

    const result = await copyDocsToPillar(ADMIN, ['src1'], 'coach')

    expect(result.docsCopied).toBe(1)
    expect(result.chunksCopied).toBe(2)
    expect(mockChunkAdd).toHaveBeenCalledTimes(2)
    // The chunk carries the NEW docId and the NEW pillar; retrieval keys off both.
    const chunkWrite = mockChunkAdd.mock.calls[0][0]
    expect(chunkWrite.pillar).toBe('coach')
    expect(chunkWrite.docId).toBe(copyDocId('src1', 'coach'))
  })

  it('copies the embedding values verbatim, but as the VECTOR type', async () => {
    // The numbers are unchanged — a copy needs no re-embedding — but they must land as a
    // Firestore VECTOR or the copy is unsearchable (quick-066).
    mockChunksGet.mockResolvedValue(chunks(1, { embedding: [0.5, 0.25], text: 'body', tokens: 7 }))
    await copyDocsToPillar(ADMIN, ['src1'], 'coach')
    const chunkWrite = mockChunkAdd.mock.calls[0][0]
    expect(chunkWrite.embedding).toEqual({ __vector: [0.5, 0.25] })
    expect(chunkWrite.text).toBe('body')
  })

  it('converts a source chunk ALREADY stored as a VectorValue without double-wrapping', async () => {
    mockChunksGet.mockResolvedValue(
      chunks(1, { embedding: { toArray: () => [0.9, 0.1] } as unknown as number[] }),
    )
    await copyDocsToPillar(ADMIN, ['src1'], 'coach')
    expect(mockChunkAdd.mock.calls[0][0].embedding).toEqual({ __vector: [0.9, 0.1] })
  })

  it('does NOT carry version lineage into the copy', async () => {
    // supersedesId / correctedBy describe the SOURCE's chain; duplicating them would make
    // two documents claim the same place in one history.
    await copyDocsToPillar(ADMIN, ['src1'], 'coach')
    const written = mockDocSet.mock.calls[0][0]
    expect(written.supersedesId).toBeUndefined()
    expect(written.supersededBy).toBeUndefined()
    expect(written.correctedBy).toBeUndefined()
    expect(written.version).toBe(1)
    expect(written.copiedFromId).toBe('src1')
    expect(written.pillar).toBe('coach')
    expect(written.title).toBe('Sales kit')
  })

  it('is a no-op on a repeat click — the copy id is deterministic', async () => {
    // The client LOOPS this action and a user can double-click; a generated id would mint
    // another duplicate each pass and quietly double the corpus.
    mockTargetExists = true
    const result = await copyDocsToPillar(ADMIN, ['src1'], 'coach')
    expect(result).toMatchObject({ docsCopied: 0, chunksCopied: 0, skipped: 1 })
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it('skips a document already in the target pillar', async () => {
    const result = await copyDocsToPillar(ADMIN, ['src1'], 'finder')
    expect(result).toMatchObject({ docsCopied: 0, skipped: 1 })
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it('is bounded per call and hands back the rest', async () => {
    const ids = Array.from({ length: COPY_DOC_LIMIT + 2 }, (_, i) => `s${i}`)
    const result = await copyDocsToPillar(ADMIN, ids, 'coach')
    expect(result.docsCopied).toBe(COPY_DOC_LIMIT)
    expect(result.remaining).toHaveLength(2)
  })

  it('refuses a non-admin and an invalid pillar before any write', async () => {
    await expect(copyDocsToPillar(AGENT, ['src1'], 'coach')).rejects.toThrow()
    await expect(
      copyDocsToPillar(ADMIN, ['src1'], 'marketing' as unknown as 'coach'),
    ).rejects.toThrow(/invalid pillar/)
    expect(mockDocSet).not.toHaveBeenCalled()
  })
})
