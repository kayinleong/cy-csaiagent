/**
 * src/firebase/__tests__/role-helper.test.ts — RO-01 server-side role gate (RED scaffold).
 *
 * Phase 6 introduces a centralized `requireRole(allowed: Role[])` helper (Pitfall 4 /
 * Open Q2) so the ~24 duplicated `if (user.role !== 'admin') redirect(...)` gate sites
 * route through ONE tested function — and so the read-only role is denied SERVER-SIDE
 * at the gate (not merely nav-hidden). This test pins that contract:
 *
 *   1. requireRole returns the verified user when their role is in the allow-list.
 *   2. requireRole DENIES (throws / redirects) when the role is NOT in the allow-list —
 *      proving a read-only stakeholder hitting a write/admin surface is turned away
 *      at the gate (RO-01: "redirected at the layout gate, not nav-hidden").
 *   3. VALID_ROLES includes 'read-only' (the 4th role tier exists).
 *
 * RED-BY-DESIGN: `requireRole` does not exist yet (Wave 1) → the dynamic import below
 * resolves to `undefined`, so the call throws and the spec fails. `VALID_ROLES` does
 * not yet contain 'read-only' → that assertion fails too. Both turn GREEN in Wave 1.
 *
 * Logic-only: no emulator, no network. The gate logic is exercised over a plain
 * verified-user object (role from the verified token, never from request input).
 *
 * Requirements: RO-01, Pitfall 4, 06-RESEARCH "Role-branch sites".
 */

import { describe, it, expect } from 'vitest'
import type { Role } from '@/src/firebase/auth'

interface VerifiedUser {
  uid: string
  role: Role
  tenantId: 'd2'
}

/** Allow-lists that include 'read-only' before the Role union is widened (Wave 1). */
const ALLOW_ADMIN = ['admin'] as unknown as Role[]
const ALLOW_ANALYTICS = ['admin', 'read-only'] as unknown as Role[]

// 'read-only' is not yet in the Role union (Wave 1 adds it) — cast through unknown
// so the RED scaffold stays type-clean before the union is widened.
const readOnlyUser = {
  uid: 'ro-uid',
  role: 'read-only' as unknown as Role,
  tenantId: 'd2' as const,
}
const adminUser: VerifiedUser = { uid: 'admin-uid', role: 'admin', tenantId: 'd2' }

/**
 * Load the not-yet-existing Wave-1 helper. Resolves to `undefined` today so the
 * caller's invocation throws — the intended Wave-0 red bar.
 */
async function loadRequireRole(): Promise<
  ((user: VerifiedUser, allowed: Role[]) => VerifiedUser) | undefined
> {
  const mod = (await import('@/src/firebase/auth')) as Record<string, unknown>
  return mod.requireRole as
    | ((user: VerifiedUser, allowed: Role[]) => VerifiedUser)
    | undefined
}

describe('requireRole(allowed) — centralized server-side role gate (RO-01)', () => {
  it('returns the user when their role is in the allow-list', async () => {
    const requireRole = await loadRequireRole()
    // RED today: requireRole is undefined → this call throws (Wave-0 intent).
    const result = requireRole!(adminUser, ALLOW_ANALYTICS)
    expect(result).toEqual(adminUser)
  })

  it('DENIES (throws/redirects) a read-only caller on a write/admin surface', async () => {
    const requireRole = await loadRequireRole()
    // read-only is NOT in an admin-only allow-list → the gate must turn it away
    // SERVER-SIDE (the RO-01 invariant). RED today: requireRole is undefined.
    expect(() => requireRole!(readOnlyUser, ALLOW_ADMIN)).toThrow()
  })

  it('admits a read-only caller on an analytics surface that allows it', async () => {
    const requireRole = await loadRequireRole()
    const result = requireRole!(readOnlyUser, ALLOW_ANALYTICS)
    expect(result).toEqual(readOnlyUser)
  })
})

describe('VALID_ROLES — the read-only role tier exists (RO-01)', () => {
  it("VALID_ROLES includes 'read-only'", async () => {
    const mod = (await import('@/src/firebase/auth')) as Record<string, unknown>
    // RED today: VALID_ROLES is ['new-agent','senior-coach','admin'] (Wave 1 adds 'read-only').
    const validRoles = (mod.VALID_ROLES as readonly string[] | undefined) ?? []
    expect(validRoles).toContain('read-only')
  })
})
