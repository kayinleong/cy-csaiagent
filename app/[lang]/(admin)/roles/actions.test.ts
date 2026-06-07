// QUAL-09 Wave-0 stub — implementation lands in 05-03-PLAN.md

/**
 * app/[lang]/(admin)/roles/actions.test.ts — ADMIN-07 role assignment assertions.
 *
 * These unit tests prove that the role assignment Server Action:
 *   1. Returns {ok:false, error:'Forbidden'} for non-admin roles.
 *   2. On admin success: calls `setUserClaims(targetUid, role)` (the SOLE sanctioned
 *      claim-setting path per src/firebase/auth.ts:148) AND writes an `action:'role-assign'`
 *      audit event.
 *   3. Rejects an invalid role string (InvalidRoleError surfaced as {ok:false}).
 *
 * Per PATTERNS.md §roles/actions.ts: reuse setUserClaims from src/firebase/auth.ts:148.
 * "No new auth model — setUserClaims is the only writer." (auth.ts:136 comment)
 *
 * Wave 0: FAILS because the action module is absent.
 * Wave 1+ (05-03-PLAN.md): implementation created; tests turn GREEN.
 *
 * No emulator needed — all dependencies are mocked (unit test).
 *
 * Requirements: ADMIN-07, D-09, PATTERNS.md §roles/actions.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  setUserClaims: vi.fn().mockResolvedValue(undefined),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
  InvalidRoleError: class InvalidRoleError extends Error {
    constructor(msg: string) { super(msg); this.name = 'InvalidRoleError' }
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

// This import will FAIL until the action module is created (Wave 0 red-bar intent):
// The module under test: app/[lang]/(admin)/roles/actions.ts
import { assignRole } from './actions'

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('ADMIN-07 assignRole — admin-gate + setUserClaims + audit', () => {
  // Wave 0: the import above fails ("Cannot find module './actions'") —
  // the intended red bar for this Wave-0 stub.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns {ok:false, error:"Forbidden"} for a non-admin role', async () => {
    // ADMIN-07: role assignment is admin-only.

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid',
      role: 'senior-coach',
      tenantId: 'd2',
    } as any)

    const result = await assignRole('target-uid', 'new-agent')

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
  })

  it('calls setUserClaims(targetUid, role) on admin success', async () => {
    // ADMIN-07: setUserClaims is the SOLE sanctioned claim-setting path.
    // (src/firebase/auth.ts:148 — "ONLY sanctioned claim-setting path")
    // The action must delegate to setUserClaims, never set claims directly.

    const { requireUser, setUserClaims } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)

    await assignRole('target-agent-uid', 'senior-coach')

    expect(setUserClaims).toHaveBeenCalledWith('target-agent-uid', 'senior-coach')
  })

  it('writes an action:"role-assign" audit event after successful role change', async () => {
    // ADMIN-07: every role change must be audited.
    // Audit event: { actorUid, action: 'role-assign', targetRef: `users/${targetUid}`, raw: { targetUid, role } }
    // (RESEARCH "Code Examples → Role matrix assignment")

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)

    const { log } = await import('@/src/audit')

    await assignRole('target-agent-uid', 'senior-coach')

    expect(log).toHaveBeenCalledOnce()
    const auditCall = vi.mocked(log).mock.calls[0][0]
    expect(auditCall).toMatchObject({ action: 'role-assign' })
  })

  it('returns {ok:false} for an invalid role string (InvalidRoleError)', async () => {
    // ADMIN-07: invalid role → surfaced as {ok:false} without crashing.
    // setUserClaims validates the role union and throws InvalidRoleError for bad values.
    // The action must catch and surface it gracefully.

    const { requireUser, setUserClaims, InvalidRoleError } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)
    vi.mocked(setUserClaims).mockRejectedValueOnce(new InvalidRoleError('Invalid role: super-admin'))

    const result = await assignRole('target-uid', 'super-admin' as any)

    expect(result.ok).toBe(false)
    // The error should convey the InvalidRoleError, not Unauthorized/Forbidden
    // Narrow the union type so TypeScript can resolve .error
    const errResult = result as { ok: false; error: string }
    expect(errResult.error).toBeDefined()
    expect(errResult.error).not.toBe('Unauthorized')
    expect(errResult.error).not.toBe('Forbidden')
  })

  it('returns {ok:true} on successful role assignment', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)

    const result = await assignRole('target-agent-uid', 'new-agent')

    expect(result).toEqual({ ok: true })
  })
})
