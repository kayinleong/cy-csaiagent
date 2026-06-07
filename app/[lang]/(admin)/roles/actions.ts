'use server'

/**
 * app/[lang]/(admin)/roles/actions.ts — Admin role assignment Server Actions (ADMIN-07).
 *
 * Three-layer admin gate:
 *   Layer 1: (admin)/layout.tsx redirects non-admins.
 *   Layer 2: roles/page.tsx (RSC) re-checks role.
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED TOKEN (never from args).
 *
 * STRIDE: T-05-ADMINGATE, T-05-CLAIM, T-05-SELFDEMOTE.
 * Role is read from the verified Firebase ID token via requireUser, NEVER from action args (T-02-31).
 *
 * Actions exported:
 *   assignRole       — admin-only, delegates to setUserClaims (sole sanctioned path), audited
 *   listUsersWithRoles — admin-only bounded read of users + roles for the matrix
 *
 * Security invariants:
 *   - Claims ONLY written via setUserClaims (src/firebase/auth.ts:148) — the sole sanctioned claim path.
 *   - Role from verified token, never from action args.
 *   - Every role change audited with action:'role-assign'.
 *   - InvalidRoleError surfaced as {ok:false} (no crash).
 *
 * References:
 *   - ADMIN-07 (role matrix + guarded assignment)
 *   - HR-6 (demotion AlertDialog confirm — in the UI layer, not here)
 *   - 05-PATTERNS.md §roles/actions.ts
 *   - src/firebase/auth.ts:148 (setUserClaims — sole claim path)
 *   - dashboard/actions.ts:39-52 (getSessionUser pattern verbatim)
 *   - T-05-ADMINGATE, T-05-CLAIM
 */

import { cookies } from 'next/headers'
import { requireUser, setUserClaims, UnauthorizedError, InvalidRoleError } from '@/src/firebase/auth'
import * as audit from '@/src/audit'

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Verbatim copy of dashboard/actions.ts:40-52 (getSessionUser pattern).
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/roles', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssignableRole = 'new-agent' | 'senior-coach' | 'admin'

export interface AssignRoleResult {
  ok: true
}

export type AssignRoleError = {
  ok: false
  error: string
}

export interface UserWithRole {
  id: string
  role: 'new-agent' | 'senior-coach' | 'admin'
  /** Truncated display ref (first 8 chars of uid). */
  displayRef: string
  seniorCoachId: string | null
}

export interface ListUsersResult {
  ok: true
  users: UserWithRole[]
}

export type ListUsersError = {
  ok: false
  error: string
}

// ─── assignRole ───────────────────────────────────────────────────────────────

/**
 * Admin-only role assignment via the SOLE sanctioned claim path (ADMIN-07).
 *
 * Security:
 *   - Requires role === 'admin' from the verified token (T-05-ADMINGATE).
 *   - Delegates to setUserClaims (src/firebase/auth.ts:148) — the ONLY allowed claim writer.
 *   - Claims written exclusively via setUserClaims (T-05-CLAIM).
 *   - Writes action:'role-assign' audit event after every successful claim change.
 *   - InvalidRoleError surfaced as {ok:false} without crashing.
 *
 * @param targetUid  UID of the user whose role is being changed.
 * @param role       The new role ('new-agent' | 'senior-coach' | 'admin').
 * @param downline   Optional new downline array for senior-coach (not used in claim — for UI context).
 */
export async function assignRole(
  targetUid: string,
  role: AssignableRole,
  downline?: string[]
): Promise<AssignRoleResult | AssignRoleError> {
  void downline // downline context for UI — not written to claims

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // ADMIN-07: role assignment is admin-only.
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // The SOLE sanctioned claim-setting path (T-05-CLAIM).
    // setUserClaims validates the role union and throws InvalidRoleError for unknown roles.
    // It also upserts the users/{uid} doc (src/firebase/auth.ts:148-183).
    await setUserClaims(targetUid, role)

    // Audit every role change (ADMIN-07 / T-05-CLAIM).
    await audit.log({
      actorUid: user.uid,
      action: 'role-assign',
      targetRef: `users/${targetUid}`,
      raw: { targetUid, role },
    })

    return { ok: true }
  } catch (err) {
    if (err instanceof InvalidRoleError) {
      return { ok: false, error: `Invalid role: ${role}` }
    }
    const msg = err instanceof Error ? err.message : 'Failed to assign role'
    return { ok: false, error: msg }
  }
}

// ─── listUsersWithRoles ───────────────────────────────────────────────────────

/**
 * Admin-only bounded read of users + roles for the role matrix (ADMIN-07).
 *
 * Returns projected user rows (id, role, displayRef, seniorCoachId) for the
 * matrix UI. Never fetches more than needed — bounded by limit(200) (the org
 * is expected to be ≤ 200 agents at pilot scale; this is NOT fetch-all).
 *
 * NOTE: role from the verified token, NEVER from action args (T-02-31).
 */
export async function listUsersWithRoles(): Promise<ListUsersResult | ListUsersError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Admin-only gate (ADMIN-07)
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    const { usersRef } = await import('@/src/firebase/collections')
    // Bounded read: limit to 200 (never fetch-all; pilot org ≤ 200 agents).
    const snap = await usersRef().limit(200).get()

    const users: UserWithRole[] = snap.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        role: data.role,
        displayRef: doc.id.slice(0, 8),
        seniorCoachId: (data as typeof data & { seniorCoachId?: string }).seniorCoachId ?? null,
      }
    })

    return { ok: true, users }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list users'
    return { ok: false, error: msg }
  }
}
