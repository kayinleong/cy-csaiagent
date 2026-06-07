// QUAL-09 Wave-0 stub — implementation lands in 05-03-PLAN.md

/**
 * app/[lang]/(admin)/erasure/actions.test.ts — QUAL-09 erasure Server Action gate assertions.
 *
 * These unit tests prove the GATE ORDER for the erasure Server Action:
 *   1. No session → { ok: false, error: 'Unauthorized' }
 *   2. Non-admin role → { ok: false, error: 'Forbidden' }
 *   3. Invalid zod input → { ok: false, error: <ZodError> } BEFORE any Admin-SDK call
 *
 * Per STRIDE: "Admin SDK bypasses rules → gate in code" — the test proves the gate
 * is in the SERVER ACTION, not in Firestore rules (which the Admin SDK bypasses).
 *
 * Wave 0: FAILS because the action module is absent.
 * Wave 1+ (05-03-PLAN.md): implementation created; tests turn GREEN.
 *
 * No emulator needed — all dependencies are mocked (unit test).
 *
 * Requirements: QUAL-09, ADMIN-08, D-01, RESEARCH Security Domain STRIDE,
 *               PATTERNS.md §erasure/actions.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the action's dependencies BEFORE importing the action module ─────────
// These mocks intercept the module-level imports inside the action file.

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/pdpa/erasure', () => ({
  eraseDataSubject: vi.fn().mockResolvedValue({ ok: true, complete: true, collectionsHit: [] }),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import will FAIL until the action module is created (Wave 0 red-bar intent):
// The module under test: app/[lang]/(admin)/erasure/actions.ts
// Using relative path (this test co-locates with the action file):
import { eraseDataSubjectAction } from './actions'

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('QUAL-09 erasure Server Action — auth → admin → zod gate order', () => {
  // Wave 0: the import above fails ("Cannot find module '@/src/pdpa/erasure'") —
  // or the action module is at app/[lang]/(admin)/erasure/actions.ts and that fails.
  // Either way, the test runner reports "Cannot find module" — the intended red bar.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns {ok:false, error:"Unauthorized"} when no session exists', async () => {
    // Gate 1: missing session → Unauthorized (before any role or input check)
    // PATTERNS.md: "try { user = await getSessionUser() } catch { return { ok: false, error: 'Unauthorized' } }"

    const { cookies } = await import('next/headers')
    vi.mocked(cookies).mockResolvedValueOnce({
      get: vi.fn().mockReturnValue(undefined), // no session cookie
    } as any)

    const result = await eraseDataSubjectAction({ subjectType: 'agent', id: 'test-uid' })

    expect(result).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('returns {ok:false, error:"Forbidden"} for a non-admin (senior-coach) session', async () => {
    // Gate 2: non-admin role → Forbidden (after auth succeeds but before any Admin-SDK call)
    // PATTERNS.md: "if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }"
    // Erasure is admin-ONLY (not coach + admin like resolveStall).

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid',
      role: 'senior-coach',
      tenantId: 'd2',
    } as any)

    const result = await eraseDataSubjectAction({ subjectType: 'agent', id: 'test-uid' })

    expect(result).toEqual({ ok: false, error: 'Forbidden' })
  })

  it('rejects invalid subjectType via zod BEFORE any Admin-SDK call (gate 3)', async () => {
    // Gate 3: zod input validation — subjectType must be 'lead' | 'agent'
    // This check must run AFTER auth+admin gates, BEFORE any Admin-SDK call.
    // Ensures bad input never reaches the destructive erasure code.

    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)

    // Invalid subjectType (not in the zod enum)
    const result = await eraseDataSubjectAction({ subjectType: 'invalid-type', id: 'test-uid' })

    expect(result.ok).toBe(false)
    // The error should reference invalid input (zod parse error), not 'Unauthorized'/'Forbidden'
    expect(result.error).toBeDefined()
    expect(result.error).not.toBe('Unauthorized')
    expect(result.error).not.toBe('Forbidden')

    // The erasure core must NOT have been called
    const { eraseDataSubject } = await import('@/src/pdpa/erasure')
    expect(eraseDataSubject).not.toHaveBeenCalled()
  })

  it('succeeds for an admin session with valid input', async () => {
    // Happy path: admin + valid input → eraseDataSubject is called
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as any)

    const result = await eraseDataSubjectAction({ subjectType: 'agent', id: 'agent-test-001' })

    expect(result.ok).toBe(true)
  })
})
