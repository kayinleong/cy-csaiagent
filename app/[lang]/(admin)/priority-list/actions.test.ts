/**
 * app/[lang]/(admin)/priority-list/actions.test.ts — Priority-List Firestore
 * publish contract (quick-kayinleong-090).
 *
 * The Priority List is the singleton Firestore doc `appConfig/priorityList` — one
 * free-text ordering prompt injected into the Coach/Finder system prompts as a
 * RANKING preference. This pins the secure behavior of publishPriorityList:
 *   1. AUTHENTICATED (no session cookie → 'Unauthorized', before any Firestore work).
 *   2. ADMIN-ONLY (non-admin → 'Forbidden'; role from the VERIFIED token, never args).
 *   3. TRANSACTIONAL WRITE: the doc is written with the trimmed text + tenantId +
 *      updatedBy (verified uid) + a server timestamp.
 *   4. CONFLICT: if the stored text differs from the `expectedCurrent` the admin saw,
 *      returns {ok:false,error:'conflict'} and does NOT write — never blind-overwrites
 *      a concurrent publish.
 *   5. BOUNDED: over-length input is rejected ('too-long') BEFORE any transaction —
 *      never silently truncated (a clipped ordering rule changes agent behavior
 *      invisibly). An EMPTY string is VALID — that is how the feature is turned off.
 *   6. ANTI-MASKING: any Firestore failure returns 'publish-failed', never silently
 *      mislabeled as a conflict.
 *   7. AUDITED: a successful publish writes action:'priority_list_publish'; a
 *      conflict, rejection or failure writes NO audit row.
 *
 * No emulator needed — Firestore (adminDb.runTransaction + priorityListRef) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/audit', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// Firestore transaction mocks (vi.hoisted so the vi.mock factories below can
// reference them — vi.mock is hoisted above plain const declarations).
// adminDb.runTransaction invokes the callback with a transaction object exposing
// get()/set(). mockDocGet backs the readPriorityList non-transactional read.
const { mockTxGet, mockTxSet, mockDocGet, mockRunTransaction } = vi.hoisted(() => {
  const mockTxGet = vi.fn()
  const mockTxSet = vi.fn()
  const mockDocGet = vi.fn()
  const mockRunTransaction = vi.fn(
    async (fn: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) =>
      fn({ get: mockTxGet, set: mockTxSet }),
  )
  return { mockTxGet, mockTxSet, mockDocGet, mockRunTransaction }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { runTransaction: mockRunTransaction },
}))

// priorityListRef().doc(PRIORITY_LIST_DOC_ID) — the doc ref is opaque (tx.get/tx.set
// are themselves mocks).
vi.mock('@/src/firebase/collections', () => ({
  priorityListRef: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockDocGet })) })),
  PRIORITY_LIST_DOC_ID: 'priorityList',
}))

// FieldValue.serverTimestamp() — deterministic sentinel for assertions.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => '__serverTimestamp__') },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

import { publishPriorityList, readPriorityList } from './actions'

const adminUser = { uid: 'admin-uid', role: 'admin', tenantId: 'd2' } as AuthenticatedUser

/** The published prompt a freshly-read doc exposes by default. */
const PUBLISHED = 'Put Residensi Alam first, then anything in Cyberjaya.'

/** Make the NEXT cookies() call return no `__session` cookie (signed-out caller). */
async function withNoSessionCookie() {
  const { cookies } = await import('next/headers')
  vi.mocked(cookies).mockResolvedValueOnce({
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
}

describe('publishPriorityList — auth / transaction / conflict / bounds / audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunTransaction.mockImplementation(async (fn) => fn({ get: mockTxGet, set: mockTxSet }))
    mockTxGet.mockResolvedValue({ data: () => ({ text: PUBLISHED }) })
  })

  it("returns 'Unauthorized' with no session cookie, and touches no Firestore", async () => {
    await withNoSessionCookie()

    const result = await publishPriorityList('anything', PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'Unauthorized' })
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it("returns 'Forbidden' for a non-admin (senior-coach) caller — role from the verified token", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await publishPriorityList('Put my own listings first.', PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it("returns 'Forbidden' for a read-only caller (D-24 — read-only is not an admin)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'ro-uid', role: 'read-only', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await publishPriorityList('Put anything first.', PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('writes the expected doc shape (trimmed text + tenantId + verified uid + server timestamp)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    const result = await publishPriorityList('  Prefer bumiputera-quota units.  ', PUBLISHED)

    expect(result).toMatchObject({ ok: true })
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    expect(mockTxSet).toHaveBeenCalledTimes(1)

    const setData = mockTxSet.mock.calls[0][1]
    expect(setData.text).toBe('Prefer bumiputera-quota units.') // trimmed
    expect(setData.tenantId).toBe('d2')
    expect(setData.updatedBy).toBe('admin-uid')
    expect(setData.updatedAt).toBe('__serverTimestamp__')
  })

  it("returns {ok:false, error:'conflict'} when the stored text changed since load — never blind-overwrite", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    // Another admin already republished since this admin loaded the form.
    mockTxGet.mockResolvedValueOnce({ data: () => ({ text: 'Someone else published this.' }) })

    const result = await publishPriorityList('My new ordering.', PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'conflict' })
    expect(mockTxSet).not.toHaveBeenCalled()            // never writes on conflict
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled() // no audit row on conflict
  })

  it('accepts an EMPTY string — that is how the feature is turned off', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    const result = await publishPriorityList('   ', PUBLISHED)

    expect(result).toMatchObject({ ok: true })
    expect(mockTxSet).toHaveBeenCalledTimes(1)
    expect(mockTxSet.mock.calls[0][1].text).toBe('')
  })

  it('publishes onto a never-published doc (expectedCurrent = "")', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockTxGet.mockResolvedValueOnce({ data: () => undefined }) // doc does not exist yet

    const result = await publishPriorityList('First ever ordering rule.', '')

    expect(result).toMatchObject({ ok: true })
    expect(mockTxSet.mock.calls[0][1].text).toBe('First ever ordering rule.')
  })

  it("rejects over-length input with 'too-long' BEFORE any transaction, and writes no audit row", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')

    const result = await publishPriorityList('x'.repeat(4001), PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'too-long' })
    expect(mockRunTransaction).not.toHaveBeenCalled()
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()
  })

  it('accepts input exactly at the 4000-character bound (off-by-one guard)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    const result = await publishPriorityList('x'.repeat(4000), PUBLISHED)

    expect(result).toMatchObject({ ok: true })
    expect(mockTxSet).toHaveBeenCalledTimes(1)
  })

  it("returns 'publish-failed' (NOT conflict) when the transaction throws, and writes NO audit row (anti-masking)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    mockTxGet.mockRejectedValueOnce(new Error('network'))

    const result = await publishPriorityList('Some ordering.', PUBLISHED)

    expect(result).toMatchObject({ ok: false, error: 'publish-failed' })
    expect(result).not.toMatchObject({ error: 'conflict' })
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()
  })

  it("never echoes the raw Firestore error text back to the client", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockTxGet.mockRejectedValueOnce(new Error('PERMISSION_DENIED on projects/d2-secret/databases'))

    const result = await publishPriorityList('Some ordering.', PUBLISHED)

    expect(JSON.stringify(result)).not.toContain('d2-secret')
    expect(JSON.stringify(result)).not.toContain('PERMISSION_DENIED')
  })

  it("writes an action:'priority_list_publish' audit row (targetRef appConfig/priorityList) on success", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')

    await publishPriorityList('Prefer Cyberjaya first.', PUBLISHED)

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'admin-uid',
        action: 'priority_list_publish',
        targetRef: 'appConfig/priorityList',
        raw: expect.objectContaining({ text: 'Prefer Cyberjaya first.' }),
      }),
    )
  })
})

describe('readPriorityList — admin-only read of appConfig/priorityList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 'Unauthorized' with no session cookie", async () => {
    await withNoSessionCookie()

    const result = await readPriorityList()

    expect(result).toMatchObject({ ok: false, error: 'Unauthorized' })
    expect(mockDocGet).not.toHaveBeenCalled()
  })

  it("returns 'Forbidden' for a non-admin caller", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await readPriorityList()

    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockDocGet).not.toHaveBeenCalled()
  })

  it('returns the published text for an admin', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockDocGet.mockResolvedValueOnce({ data: () => ({ text: PUBLISHED }) })

    const result = await readPriorityList()

    expect(result).toMatchObject({ ok: true, text: PUBLISHED })
  })

  it("returns '' (feature off) when the doc does not exist", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockDocGet.mockResolvedValueOnce({ data: () => undefined })

    const result = await readPriorityList()

    expect(result).toMatchObject({ ok: true, text: '' })
  })

  it("returns a generic 'read-failed' code (no raw Firestore text) when the read throws", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockDocGet.mockRejectedValueOnce(new Error('PERMISSION_DENIED on projects/d2-secret'))

    const result = await readPriorityList()

    expect(result).toMatchObject({ ok: false, error: 'read-failed' })
    expect(JSON.stringify(result)).not.toContain('d2-secret')
  })
})
