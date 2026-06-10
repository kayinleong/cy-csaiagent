/**
 * src/firebase/__tests__/role-helper.test.ts — RO-01 centralized server-side role gate.
 *
 * Phase 6 introduces a centralized `requireRole({ lang, allowed, fallback? })` helper
 * (Pitfall 4 / CONTEXT Open Q2) so the duplicated `if (user.role !== 'admin') redirect(...)`
 * gate sites can eventually route through ONE tested function — and so the read-only role
 * is denied SERVER-SIDE at the gate (not merely nav-hidden). This test pins that contract
 * BEFORE any existing gate is rewired (Wave 3), so a regression surfaces in isolation.
 *
 * Contract under test (Pattern A — app/[lang]/(admin)/inventory/page.tsx:46-70):
 *   1. allowed → returns the verified AuthenticatedUser (role read from the token only).
 *   2. disallowed → redirect(fallback ?? `/${lang}/chat`); the user is NEVER returned.
 *   3. missing session cookie → redirect(`/${lang}/sign-in`).
 *   4. invalid/expired token (UnauthorizedError) → redirect(`/${lang}/sign-in`).
 *   5. non-Unauthorized error from requireUser → rethrown (fails closed, not swallowed).
 *   6. VALID_ROLES includes 'read-only' (the 4th role tier exists).
 *
 * Pitfall 6: redirect() throws NEXT_REDIRECT; the helper must resolve the role INSIDE the
 * try/catch and call redirect() OUTSIDE it. We model that by making the redirect mock throw
 * a sentinel (as the real next/navigation redirect does) and asserting it was called with
 * the right path — never swallowed.
 *
 * Logic-only: requireUser, next/navigation redirect, and next/headers cookies are mocked
 * (mirrors the vi.hoisted + vi.mock style in src/firebase/auth.test.ts:19-47). No emulator,
 * no network.
 *
 * Requirements: RO-01, Pitfall 4, Pitfall 6, 06-RESEARCH "Role-branch sites".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedError, VALID_ROLES, type AuthenticatedUser } from '@/src/firebase/auth'

// ── Hoisted mocks (available when vi.mock factories run) ────────────────────
const { mockRequireUser, mockRedirect, mockCookiesGet } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockRedirect: vi.fn(),
  mockCookiesGet: vi.fn(),
}))

// requireUser is the REAL gate: the helper reads the role from its verified output.
// We preserve the real UnauthorizedError + VALID_ROLES so instanceof + the union assert hold.
vi.mock('@/src/firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/firebase/auth')>()
  return { ...actual, requireUser: mockRequireUser }
})

// next/navigation redirect throws NEXT_REDIRECT in Next 16. Model that with a sentinel so a
// redirect inside a try/catch would be caught (the bug Pitfall 6 warns about); the helper must
// call it OUTSIDE the try/catch, so the sentinel propagates out of requireRole uncaught.
const REDIRECT_SENTINEL = 'NEXT_REDIRECT'
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mockRedirect(path)
    throw new Error(REDIRECT_SENTINEL)
  },
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookiesGet }),
}))

// Import AFTER mocks are registered.
import { requireRole } from '@/app/[lang]/_lib/require-role'

const adminUser: AuthenticatedUser = { uid: 'admin-uid', role: 'admin', tenantId: 'd2' }
const readOnlyUser: AuthenticatedUser = { uid: 'ro-uid', role: 'read-only', tenantId: 'd2' }

function withSession(value = 'valid-session-cookie') {
  mockCookiesGet.mockReturnValue({ value })
}
function withoutSession() {
  mockCookiesGet.mockReturnValue(undefined)
}

describe('requireRole(allowed) — centralized server-side role gate (RO-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the verified user when their role is in the allow-list', async () => {
    withSession()
    mockRequireUser.mockResolvedValueOnce(adminUser)

    const result = await requireRole({ lang: 'en', allowed: ['admin', 'read-only'] })

    expect(result).toEqual(adminUser)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('admits a read-only caller on an analytics surface that allows it', async () => {
    withSession()
    mockRequireUser.mockResolvedValueOnce(readOnlyUser)

    const result = await requireRole({ lang: 'en', allowed: ['admin', 'read-only'] })

    expect(result).toEqual(readOnlyUser)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('DENIES a read-only caller on an admin-only surface (redirect to fallback, no user)', async () => {
    withSession()
    mockRequireUser.mockResolvedValueOnce(readOnlyUser)

    // redirect() throws NEXT_REDIRECT → the helper does not return the user.
    await expect(requireRole({ lang: 'en', allowed: ['admin'] })).rejects.toThrow(REDIRECT_SENTINEL)
    expect(mockRedirect).toHaveBeenCalledWith('/en/chat') // default fallback
  })

  it('honours a custom fallback path when the role is disallowed', async () => {
    withSession()
    mockRequireUser.mockResolvedValueOnce(readOnlyUser)

    await expect(
      requireRole({ lang: 'ms', allowed: ['admin'], fallback: '/ms' })
    ).rejects.toThrow(REDIRECT_SENTINEL)
    expect(mockRedirect).toHaveBeenCalledWith('/ms')
  })

  it('redirects to sign-in when the session cookie is missing', async () => {
    withoutSession()

    await expect(requireRole({ lang: 'en', allowed: ['admin'] })).rejects.toThrow(REDIRECT_SENTINEL)
    expect(mockRedirect).toHaveBeenCalledWith('/en/sign-in')
    expect(mockRequireUser).not.toHaveBeenCalled() // never verify when there is no cookie
  })

  it('redirects to sign-in when the token is invalid (UnauthorizedError)', async () => {
    withSession()
    mockRequireUser.mockRejectedValueOnce(new UnauthorizedError('bad token'))

    await expect(requireRole({ lang: 'en', allowed: ['admin'] })).rejects.toThrow(REDIRECT_SENTINEL)
    expect(mockRedirect).toHaveBeenCalledWith('/en/sign-in')
  })

  it('rethrows a non-Unauthorized error from requireUser (fails closed, not swallowed)', async () => {
    withSession()
    mockRequireUser.mockRejectedValueOnce(new Error('firestore down'))

    await expect(requireRole({ lang: 'en', allowed: ['admin'] })).rejects.toThrow('firestore down')
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('reads the role from the verified token only (synthetic Bearer request)', async () => {
    withSession('the-cookie-value')
    mockRequireUser.mockResolvedValueOnce(adminUser)

    await requireRole({ lang: 'en', allowed: ['admin'] })

    // requireUser is called with a Request carrying the cookie as a Bearer token.
    const req = mockRequireUser.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBe('Bearer the-cookie-value')
  })
})

describe('VALID_ROLES — the read-only role tier exists (RO-01)', () => {
  it("VALID_ROLES includes 'read-only'", () => {
    expect(VALID_ROLES).toContain('read-only')
  })
})
