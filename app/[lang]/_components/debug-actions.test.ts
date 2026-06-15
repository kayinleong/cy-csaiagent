/**
 * app/[lang]/_components/debug-actions.test.ts — clearAllData admin gate + scope.
 *
 * Proves the destructive debug action:
 *   1. Rejects non-admin callers (senior-coach, read-only) with {ok:false,'Forbidden'}
 *      and deletes NOTHING.
 *   2. Rejects a missing session with {ok:false,'Unauthorized'}.
 *   3. On admin success: recursiveDelete is called once per CLEAR_COLLECTIONS entry,
 *      NEVER for `users` or `appConfig`, audits action 'debug-clear-all-data', and
 *      returns {ok:true, cleared: CLEAR_COLLECTIONS.length}.
 *
 * No emulator — auth/admin/audit are fully mocked (unit test).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'UnauthorizedError'
    }
  },
}))

const recursiveDelete = vi.fn().mockResolvedValue(undefined)
const collection = vi.fn((name: string) => ({ __collection: name }))

vi.mock('@/src/firebase/admin', () => ({
  adminDb: {
    recursiveDelete: (...args: unknown[]) => recursiveDelete(...args),
    collection: (name: string) => collection(name),
  },
}))

vi.mock('@/src/audit', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

import { clearAllData } from './debug-actions'
import { CLEAR_COLLECTIONS, PRESERVE_COLLECTIONS } from './debug-collections'

describe('clearAllData — admin gate + clear scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a senior-coach with Forbidden and deletes nothing', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid',
      role: 'senior-coach',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await clearAllData()

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
    expect(recursiveDelete).not.toHaveBeenCalled()
  })

  it('rejects a read-only caller with Forbidden and deletes nothing', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'ro-uid',
      role: 'read-only',
      tenantId: 'd2',
    } as unknown as AuthenticatedUser)

    const result = await clearAllData()

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
    expect(recursiveDelete).not.toHaveBeenCalled()
  })

  it('returns Unauthorized when there is no session cookie', async () => {
    const { cookies } = await import('next/headers')
    vi.mocked(cookies).mockResolvedValueOnce({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>)

    const result = await clearAllData()

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
    expect(recursiveDelete).not.toHaveBeenCalled()
  })

  it('deletes every CLEAR_COLLECTIONS entry on admin success', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await clearAllData()

    expect(result).toEqual({ ok: true, cleared: CLEAR_COLLECTIONS.length })
    expect(recursiveDelete).toHaveBeenCalledTimes(CLEAR_COLLECTIONS.length)

    const clearedNames = collection.mock.calls.map((c) => c[0])
    for (const name of CLEAR_COLLECTIONS) {
      expect(clearedNames).toContain(name)
    }
  })

  it('NEVER deletes the preserved collections (users, appConfig)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    await clearAllData()

    const clearedNames = collection.mock.calls.map((c) => c[0])
    for (const preserved of PRESERVE_COLLECTIONS) {
      expect(clearedNames).not.toContain(preserved)
    }
  })

  it("audits action 'debug-clear-all-data' after a successful wipe", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    const { log } = await import('@/src/audit')

    await clearAllData()

    expect(log).toHaveBeenCalledOnce()
    const auditCall = vi.mocked(log).mock.calls[0][0]
    expect(auditCall).toMatchObject({ actorUid: 'admin-uid', action: 'debug-clear-all-data' })
  })
})
