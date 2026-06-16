'use server'

/**
 * app/[lang]/(admin)/users/actions.ts — Admin-only "add user" Server Action.
 *
 * Fills the provisioning gap: the roles surface (roles/actions.ts) can only
 * RE-assign a role to a user who already has a Firebase Auth account; there was
 * no way to CREATE a brand-new account from the console (only the CLI
 * scripts/set-claims.ts, which assumes the UID already exists).
 *
 * Three-layer admin gate (mirrors roles/actions.ts + cohorts/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: users/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED.
 *   Layer 3: this Server Action asserts role === 'admin' from the VERIFIED token
 *            (never from args, T-02-31 / T-07-10).
 *
 * Provisioning uses the Admin SDK on the server — this is the SANCTIONED path.
 * The "never admin from a user-facing path" rule (CLAUDE.md) targets AGENT TOOLS
 * (chat retrieval), which must auth as the user. Admin Server Actions that
 * provision users are explicitly the Admin-SDK home (cf. roles/actions.ts,
 * scripts/set-claims.ts).
 *
 * Claims are written ONLY via setUserClaims (src/firebase/auth.ts) — the sole
 * sanctioned claim path. Email is PII: validated + passed to the Admin SDK
 * server-side, but NEVER logged and NEVER placed in the audit `raw` map.
 *
 * Cohort linkage (COH-02): for a new-agent, an optional cohortId is written onto
 * agentProfiles/{uid} so the agent joins an intake batch — this closes the
 * previously-orphaned write half of cohort membership (the cohort registry
 * shipped, but nothing ever assigned an agent to a cohort).
 */

import { cookies } from 'next/headers'
import {
  requireUser,
  setUserClaims,
  UnauthorizedError,
  InvalidRoleError,
  VALID_ROLES,
  type Role,
} from '@/src/firebase/auth'
import { adminAuth } from '@/src/firebase/admin'
import { agentProfilesRef, TENANT_ID } from '@/src/firebase/collections'
import * as audit from '@/src/audit'

// ─── Session helper ─────────────────────────────────────────────────────────

/** Verbatim getSessionUser pattern (roles/actions.ts:43-56). */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/users', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateUserInput {
  email: string
  password: string
  displayName?: string
  role: Role
  /** Optional intake-batch assignment — only honored for the 'new-agent' role. */
  cohortId?: string
}

/**
 * Stable, non-PII error codes returned to the client (mapped to trilingual copy
 * in the UI). We deliberately do NOT forward raw Firebase error strings — they
 * could echo the submitted email (PII) and are not localized.
 */
export type CreateUserErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-email'
  | 'weak-password'
  | 'invalid-role'
  | 'email-exists'
  | 'unknown'

export type CreateUserResult =
  | { ok: true; uid: string }
  | { ok: false; error: CreateUserErrorCode }

// ─── createUser ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Firebase Auth requires a minimum password length of 6 characters.
const MIN_PASSWORD_LENGTH = 6

/**
 * Create a new Firebase Auth user and grant it a role in one admin-gated step.
 *
 * Steps (all server-side):
 *   1. Verify admin from the VERIFIED token (never args).
 *   2. Validate email shape, password length, and role union.
 *   3. adminAuth.createUser({ email, password, displayName? }).
 *   4. setUserClaims(uid, role) — the SOLE sanctioned claim path (sets claims +
 *      users/{uid}; for new-agent also seeds agentProfiles/{uid}).
 *   5. new-agent only: if a cohort was chosen, write cohortId onto the profile.
 *   6. Audit `user-create` with role (+ cohortId) — NEVER the email (PII).
 */
export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'unauthorized' }
  }

  // Admin-only — role from the verified token, never from args (T-07-10).
  if (user.role !== 'admin') {
    return { ok: false, error: 'forbidden' }
  }

  const email = input.email?.trim().toLowerCase() ?? ''
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'invalid-email' }
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'weak-password' }
  }
  if (!VALID_ROLES.includes(input.role)) {
    return { ok: false, error: 'invalid-role' }
  }

  const displayName = input.displayName?.trim()

  try {
    const created = await adminAuth.createUser({
      email,
      password: input.password,
      ...(displayName ? { displayName } : {}),
    })

    // The SOLE sanctioned claim-setting path. Sets custom claims + users/{uid};
    // for 'new-agent' it also seeds agentProfiles/{uid}.
    await setUserClaims(created.uid, input.role)

    // COH-02: close the cohort write-gap. Only a new-agent has an agentProfiles
    // doc (created by setUserClaims above), so cohort assignment is new-agent only.
    if (input.role === 'new-agent' && input.cohortId) {
      await agentProfilesRef()
        .doc(created.uid)
        .set({ tenantId: TENANT_ID, cohortId: input.cohortId }, { merge: true })
    }

    // Audit — role (+ cohortId) only. The email is PII and must never be hashed
    // into the audit row or logged (CLAUDE.md secrets hygiene).
    await audit.log({
      actorUid: user.uid,
      action: 'user-create',
      targetRef: `users/${created.uid}`,
      raw: {
        role: input.role,
        ...(input.role === 'new-agent' && input.cohortId ? { cohortId: input.cohortId } : {}),
      },
    })

    return { ok: true, uid: created.uid }
  } catch (err) {
    if (err instanceof InvalidRoleError) {
      return { ok: false, error: 'invalid-role' }
    }
    // Map known Firebase Admin error codes to stable, non-PII codes.
    const code = (err as { code?: string } | null)?.code
    if (code === 'auth/email-already-exists') return { ok: false, error: 'email-exists' }
    if (code === 'auth/invalid-email') return { ok: false, error: 'invalid-email' }
    if (code === 'auth/invalid-password') return { ok: false, error: 'weak-password' }
    // Never forward the raw message — it may contain the submitted email.
    return { ok: false, error: 'unknown' }
  }
}
