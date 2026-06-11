/**
 * src/kb/__tests__/crud-contribution.test.ts — CKB-01 senior-coach KB contribution.
 *
 * Phase 6 surfaces the senior-coach KB-contribution path beyond the inline-correction
 * panel. The contribution entry point is the existing `correctKbDoc` (CDASH-04): it is
 * permitted by `assertAdminOrCoach` (admin OR senior-coach), ATTRIBUTES the version to
 * the actor via `correctedBy: user.uid`, and is AUDITED (append-only, hashes-only).
 *
 * KB docs are ORG-WIDE knowledge — there is NO per-doc owner / NO `seniorCoachId` on
 * `KbDocDoc`. So the "downline accountability" control is attribution (`correctedBy`)
 * + audit, NOT a per-doc scope. This test pins exactly that contract:
 *
 *   senior-coach → accepted, correctedBy stamped, audited
 *   admin        → accepted, correctedBy stamped, audited
 *   read-only    → REJECTED by assertAdminOrCoach (never contributes)
 *   new-agent    → REJECTED by assertAdminOrCoach
 *
 * Firestore / embed / audit are mocked — no live credentials, no PII in fixtures.
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * Requirements: CKB-01.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Per-test isolated mocks (vi.resetModules + vi.doMock, mirrors kb.test.ts) ──

function makeContributionMocks() {
  const mockKbDocSet = vi.fn().mockResolvedValue(undefined)

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
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }))

  // Collection-level .get() for listDocsForViewer (reads ALL kbDocs).
  const mockKbDocsCollectionGet = vi.fn().mockResolvedValue({
    docs: [
      { id: 'doc-1', data: () => ({ ...mockOldDocData }) },
      { id: 'doc-2', data: () => ({ ...mockOldDocData, version: 2, supersedesId: 'doc-1' }) },
    ],
  })

  const mockKbChunksWhere = vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [] }),
  })
  const mockKbChunksAdd = vi.fn().mockResolvedValue({ id: 'new-chunk-id' })

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

  const mockAuditLog = vi.fn().mockResolvedValue(undefined)

  return {
    mockKbDocSet,
    mockKbDocGet,
    mockKbDocRef,
    mockKbDocsCollectionGet,
    mockKbChunksWhere,
    mockKbChunksAdd,
    mockJobSet,
    mockJobDoc,
    mockJobsWhere,
    mockAuditLog,
  }
}

function installMocks(m: ReturnType<typeof makeContributionMocks>) {
  vi.doMock('@/src/firebase/collections', () => ({
    kbDocsRef: vi.fn(() => ({ doc: m.mockKbDocRef, get: m.mockKbDocsCollectionGet })),
    kbChunksRef: vi.fn(() => ({ where: m.mockKbChunksWhere, add: m.mockKbChunksAdd })),
    kbIngestionJobsRef: vi.fn(() => ({ doc: m.mockJobDoc, where: m.mockJobsWhere })),
    TENANT_ID: 'd2',
  }))
  vi.doMock('@/src/rag/embed', () => ({
    embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.001)),
    EMBED_DIM: 1024,
  }))
  // Spy on the append-only audit writer so we can assert the contribution is audited.
  vi.doMock('@/src/audit/log', () => ({
    log: m.mockAuditLog,
    auditDrilldown: vi.fn().mockResolvedValue(undefined),
  }))
}

const COACH = { uid: 'coach-uid-1', role: 'senior-coach' as const, tenantId: 'd2' }
const ADMIN = { uid: 'admin-uid-1', role: 'admin' as const, tenantId: 'd2' }
const READ_ONLY = { uid: 'readonly-uid-1', role: 'read-only' as const, tenantId: 'd2' }
const NEW_AGENT = { uid: 'agent-uid-1', role: 'new-agent' as const, tenantId: 'd2' }

describe('CKB-01: senior-coach KB contribution — permitted, attributed, audited', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('senior-coach contribution is accepted, stamped with correctedBy, and audited', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { correctKbDoc } = await import('@/src/kb/crud')

    const result = await correctKbDoc(COACH, 'old-doc-id', 'Corrected commission content')

    expect(result.newDocId).toBeTruthy()

    // Attribution: the new version records the contributing actor's uid.
    const setArg = m.mockKbDocSet.mock.calls[0]![0] as { correctedBy?: string }
    expect(setArg.correctedBy).toBe(COACH.uid)

    // Audited: an append-only audit row is written for the contribution, by the actor.
    expect(m.mockAuditLog).toHaveBeenCalledTimes(1)
    const auditArg = m.mockAuditLog.mock.calls[0]![0] as {
      actorUid: string
      action: string
    }
    expect(auditArg.actorUid).toBe(COACH.uid)
    expect(auditArg.action).toBe('kb_contribution')
  })

  it('admin contribution is also accepted, attributed, and audited', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { correctKbDoc } = await import('@/src/kb/crud')

    const result = await correctKbDoc(ADMIN, 'old-doc-id', 'Admin correction content')

    expect(result.newDocId).toBeTruthy()
    const setArg = m.mockKbDocSet.mock.calls[0]![0] as { correctedBy?: string }
    expect(setArg.correctedBy).toBe(ADMIN.uid)
    expect(m.mockAuditLog).toHaveBeenCalledTimes(1)
  })

  it('read-only is REJECTED by assertAdminOrCoach (never contributes)', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { correctKbDoc } = await import('@/src/kb/crud')

    await expect(
      correctKbDoc(READ_ONLY, 'old-doc-id', 'should be rejected'),
    ).rejects.toThrow(/admin or senior-coach/i)

    // No version created, no audit row.
    expect(m.mockKbDocSet).not.toHaveBeenCalled()
    expect(m.mockAuditLog).not.toHaveBeenCalled()
  })

  it('new-agent is REJECTED by assertAdminOrCoach', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { correctKbDoc } = await import('@/src/kb/crud')

    await expect(
      correctKbDoc(NEW_AGENT, 'old-doc-id', 'should be rejected'),
    ).rejects.toThrow(/admin or senior-coach/i)
    expect(m.mockKbDocSet).not.toHaveBeenCalled()
    expect(m.mockAuditLog).not.toHaveBeenCalled()
  })
})

describe('KM-01 / RO-01: listDocsForViewer — read-only may read the version chain', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('read-only is ALLOWED (the read-only KB version-history viewer — CR-01/WR-02)', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { listDocsForViewer } = await import('@/src/kb/crud')

    const docs = await listDocsForViewer(READ_ONLY)
    expect(docs.length).toBe(2)
    expect(m.mockKbDocsCollectionGet).toHaveBeenCalledTimes(1)
  })

  it('admin is ALLOWED', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { listDocsForViewer } = await import('@/src/kb/crud')
    const docs = await listDocsForViewer(ADMIN)
    expect(docs.length).toBe(2)
  })

  it('senior-coach and new-agent are REJECTED (viewer is admin|read-only only)', async () => {
    const m = makeContributionMocks()
    installMocks(m)
    const { listDocsForViewer } = await import('@/src/kb/crud')
    await expect(listDocsForViewer(COACH)).rejects.toThrow(/admin or read-only/i)
    await expect(listDocsForViewer(NEW_AGENT)).rejects.toThrow(/admin or read-only/i)
  })
})
