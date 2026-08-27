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

const { mockDocGet, mockDocUpdate, mockChunksGet, mockChunkUpdate, mockDocRef } = vi.hoisted(() => {
  const mockDocGet = vi.fn(async () => ({ exists: true }))
  const mockDocUpdate = vi.fn(async (_p: Record<string, unknown>) => {})
  const mockChunkUpdate = vi.fn(async (_p: Record<string, unknown>) => {})
  const mockChunksGet = vi.fn(async () => ({ size: 0, docs: [] as Array<{ ref: unknown }> }))
  const mockDocRef = vi.fn(() => ({ get: mockDocGet, update: mockDocUpdate }))
  return { mockDocGet, mockDocUpdate, mockChunksGet, mockChunkUpdate, mockDocRef }
})

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__', delete: () => '__DEL__' },
}))

vi.mock('@/src/firebase/collections', () => ({
  TENANT_ID: 'd2',
  kbDocsRef: () => ({ doc: mockDocRef, where: () => ({ get: vi.fn() }) }),
  kbChunksRef: () => ({ where: () => ({ get: mockChunksGet }) }),
  kbIngestionJobsRef: () => ({ where: () => ({ limit: () => ({ get: vi.fn() }) }) }),
}))

vi.mock('@/src/rag/embed', () => ({ embedText: vi.fn(), EMBED_DIM: 1024 }))
vi.mock('@/src/kb/ingest/pipeline', () => ({ shardJob: vi.fn() }))
vi.mock('@/src/audit', () => ({ log: vi.fn() }))

import { repillarDocs, REPILLAR_DOC_LIMIT } from './crud'

const ADMIN = { uid: 'admin-1', role: 'admin', tenantId: 'd2' } as AuthenticatedUser
const AGENT = { uid: 'a-1', role: 'new-agent', tenantId: 'd2' } as AuthenticatedUser

const chunks = (n: number) => ({
  size: n,
  docs: Array.from({ length: n }, () => ({ ref: { update: mockChunkUpdate } })),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockDocGet.mockResolvedValue({ exists: true })
  mockChunksGet.mockResolvedValue(chunks(0))
})

describe('repillarDocs', () => {
  it('moves the CHUNKS, not just the doc — this is what retrieval filters on', async () => {
    mockChunksGet.mockResolvedValue(chunks(3))

    const result = await repillarDocs(ADMIN, ['d1'], 'coach')

    expect(mockDocUpdate).toHaveBeenCalledWith({ pillar: 'coach' })
    expect(mockChunkUpdate).toHaveBeenCalledTimes(3)
    expect(mockChunkUpdate).toHaveBeenCalledWith({ pillar: 'coach' })
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
