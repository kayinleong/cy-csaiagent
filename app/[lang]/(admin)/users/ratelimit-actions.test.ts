/**
 * ratelimit-actions.test.ts — the admin rate-limit reset Server Actions
 * (quick-kayinleong-049).
 *
 * Covers `resetUserRateLimit` and `listRateBudgets` from ./actions:
 *   - Layer-3 admin gate (role read from the VERIFIED token, never from args)
 *   - target-uid shape validation
 *   - the audit entry
 *   - listRateBudgets batching via ONE getAll(), and never leaking a Firestore
 *     Timestamp across the RSC→Client boundary
 *
 * Kept in its own file rather than appended to a users/actions.test.ts: createUser needs
 * a much heavier adminAuth mock, and mixing the two would couple these cases to it.
 *
 * Mirrors the vi.hoisted() dance in (admin)/leads/actions.test.ts — a plain module-scope
 * const would still be in its TDZ when the hoisted vi.mock factories run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  setUserClaims: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'UnauthorizedError'
    }
  },
  InvalidRoleError: class InvalidRoleError extends Error {},
  VALID_ROLES: ['admin', 'senior-coach', 'new-agent', 'read-only'],
}))

vi.mock('@/src/audit', () => ({ log: vi.fn().mockResolvedValue(undefined) }))

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
}))

const { mockCookieGet, mockResetBudget, mockGetAll, mockDocFactory } = vi.hoisted(() => ({
  mockCookieGet: vi.fn(),
  mockResetBudget: vi.fn().mockResolvedValue(undefined),
  mockGetAll: vi.fn(),
  mockDocFactory: vi.fn((id: string) => ({ __id: id })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockCookieGet }),
}))

vi.mock('@/src/ratelimit', () => ({ resetBudget: mockResetBudget }))

vi.mock('@/src/firebase/collections', () => ({
  agentProfilesRef: vi.fn(() => ({ doc: vi.fn(() => ({ set: vi.fn() })) })),
  rateBudgetsRef: vi.fn(() => ({ doc: mockDocFactory })),
  TENANT_ID: 'd2',
}))

vi.mock('@/src/firebase/admin', () => ({
  adminAuth: { createUser: vi.fn(), getUsers: vi.fn() },
  adminDb: { getAll: mockGetAll },
}))

import { requireUser } from '@/src/firebase/auth'
import * as audit from '@/src/audit'
import { resetUserRateLimit, listRateBudgets } from './actions'

const ADMIN: AuthenticatedUser = {
  uid: 'admin-1',
  role: 'admin',
  tenantId: 'd2',
} as AuthenticatedUser

function asRole(role: string, uid = 'user-1'): AuthenticatedUser {
  return { uid, role, tenantId: 'd2' } as AuthenticatedUser
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCookieGet.mockReturnValue({ value: 'valid-session-cookie' })
  vi.mocked(requireUser).mockResolvedValue(ADMIN)
  mockResetBudget.mockResolvedValue(undefined)
  mockGetAll.mockResolvedValue([])
})

// ─── resetUserRateLimit ───────────────────────────────────────────────────────

describe('resetUserRateLimit — admin gate', () => {
  it('resets the budget for an admin caller', async () => {
    const result = await resetUserRateLimit('agent-9')
    expect(result).toEqual({ ok: true })
    expect(mockResetBudget).toHaveBeenCalledWith('agent-9')
  })

  it('rejects a missing session as unauthorized', async () => {
    mockCookieGet.mockReturnValue(undefined)
    expect(await resetUserRateLimit('agent-9')).toEqual({
      ok: false,
      error: 'unauthorized',
    })
    expect(mockResetBudget).not.toHaveBeenCalled()
  })

  it.each(['senior-coach', 'new-agent', 'read-only'])(
    'refuses role %s — the gate reads the VERIFIED token, not the args',
    async (role) => {
      vi.mocked(requireUser).mockResolvedValue(asRole(role))
      expect(await resetUserRateLimit('agent-9')).toEqual({
        ok: false,
        error: 'forbidden',
      })
      // read-only is admitted into the (admin) group by the layout, so this Layer-3
      // check is the one that actually stops it mutating anything.
      expect(mockResetBudget).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['path separator', 'a/b'],
    ['over-long', 'x'.repeat(129)],
  ])('rejects a %s uid without touching Firestore', async (_label, uid) => {
    expect(await resetUserRateLimit(uid)).toEqual({ ok: false, error: 'invalid-uid' })
    expect(mockResetBudget).not.toHaveBeenCalled()
  })

  it('trims the uid before use', async () => {
    await resetUserRateLimit('  agent-9  ')
    expect(mockResetBudget).toHaveBeenCalledWith('agent-9')
  })

  it('audits the reset with the actor and target, and no PII', async () => {
    await resetUserRateLimit('agent-9')
    expect(audit.log).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(audit.log).mock.calls[0][0]
    expect(entry.actorUid).toBe('admin-1')
    expect(entry.action).toBe('ratelimit-reset')
    expect(entry.targetRef).toBe('rateBudgets/agent-9')
    // No email or display name may reach the audit map.
    expect(JSON.stringify(entry.raw)).not.toMatch(/@/)
  })

  it('returns unknown (not a raw Firestore error) when the write fails', async () => {
    mockResetBudget.mockRejectedValue(new Error('7 PERMISSION_DENIED: nope'))
    expect(await resetUserRateLimit('agent-9')).toEqual({ ok: false, error: 'unknown' })
  })

  it('does not audit a failed reset', async () => {
    mockResetBudget.mockRejectedValue(new Error('boom'))
    await resetUserRateLimit('agent-9')
    expect(audit.log).not.toHaveBeenCalled()
  })
})

// ─── listRateBudgets ──────────────────────────────────────────────────────────

describe('listRateBudgets', () => {
  it('uses ONE batched getAll() rather than a read per uid', async () => {
    await listRateBudgets(['a', 'b', 'c'])
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    // Three refs, one round trip. A read-per-user loop is the N+1 shape quick-046
    // spent a commit removing, and this list grows with the pilot.
    expect(mockGetAll.mock.calls[0]).toHaveLength(3)
  })

  it('short-circuits an empty list — getAll() throws with no refs', async () => {
    expect(await listRateBudgets([])).toEqual({ ok: true, budgets: [] })
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('omits agents with no budget doc', async () => {
    mockGetAll.mockResolvedValue([
      { exists: false, id: 'a', data: () => undefined },
      {
        exists: true,
        id: 'b',
        data: () => ({ requestCount: 3, tokenCount: 900, windowStart: new Date() }),
      },
    ])
    const result = await listRateBudgets(['a', 'b'])
    expect(result).toEqual({
      ok: true,
      budgets: [{ uid: 'b', requestCount: 3, tokenCount: 900, expired: false }],
    })
  })

  it('returns only plain values — no Firestore Timestamp crosses to the client', async () => {
    // The "Only plain objects can be passed to Client Components" crash was fixed three
    // separate times (quick-029/030/031). windowStart is collapsed to a boolean here.
    mockGetAll.mockResolvedValue([
      {
        exists: true,
        id: 'b',
        data: () => ({
          requestCount: 1,
          tokenCount: 2,
          // A Timestamp-shaped object, as Firestore would return.
          windowStart: { toDate: () => new Date(Date.now() - 1000) },
        }),
      },
    ])
    const result = await listRateBudgets(['b'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const b = result.budgets[0]
    expect(Object.keys(b).sort()).toEqual(['expired', 'requestCount', 'tokenCount', 'uid'])
    expect(typeof b.expired).toBe('boolean')
    expect(JSON.stringify(result.budgets)).not.toContain('toDate')
  })

  it('filters malformed uids out of the batch', async () => {
    await listRateBudgets(['ok', '', 'bad/uid'])
    expect(mockGetAll.mock.calls[0]).toHaveLength(1)
  })

  it('refuses non-admin callers', async () => {
    vi.mocked(requireUser).mockResolvedValue(asRole('read-only'))
    expect(await listRateBudgets(['a'])).toEqual({ ok: false, error: 'forbidden' })
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('defaults missing counters to 0 rather than undefined', async () => {
    mockGetAll.mockResolvedValue([
      { exists: true, id: 'b', data: () => ({ windowStart: new Date() }) },
    ])
    const result = await listRateBudgets(['b'])
    expect(result).toEqual({
      ok: true,
      budgets: [{ uid: 'b', requestCount: 0, tokenCount: 0, expired: false }],
    })
  })
})
