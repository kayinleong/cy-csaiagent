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
import {
  agentProfilesRef,
  rateBudgetsRef,
  TENANT_ID,
  type RateBudgetDoc,
} from '@/src/firebase/collections'
import { adminDb } from '@/src/firebase/admin'
import { isWindowExpired } from '@/src/ratelimit/window'
import * as audit from '@/src/audit'
import * as ratelimit from '@/src/ratelimit'

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

// ─── resetUserRateLimit ───────────────────────────────────────────────────────

export type ResetRateLimitErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-uid'
  | 'unknown'

export type ResetRateLimitResult =
  | { ok: true }
  | { ok: false; error: ResetRateLimitErrorCode }

/**
 * Admin-only: clear a specific agent's rate-limit budget and start a fresh window
 * (quick-kayinleong-049).
 *
 * `ratelimit.check()` only clears once the 24h window expires on its own, so an agent
 * who hits TOKEN_CAP is locked out of chat for the rest of the day with no operator
 * recourse. This is that recourse.
 *
 * Same three-layer gate as createUser above:
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: users/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED.
 *   Layer 3: this action asserts role === 'admin' from the VERIFIED token, never from
 *            args (T-02-31 / T-07-10).
 *
 * The target uid comes from the client, so it is treated as untrusted input and shape-
 * checked — but note it is only ever used as a document id under `rateBudgets`, and the
 * worst case of a wrong-but-well-formed uid is resetting a budget that did not need it
 * (the write is idempotent and creates no privilege).
 *
 * Audited as `ratelimit-reset`. The audit `raw` map is hashed by audit.log, and carries
 * only the target uid — no email, no counts tied to an identity in plaintext.
 */
export async function resetUserRateLimit(uid: string): Promise<ResetRateLimitResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'unauthorized' }
  }

  // Layer 3 — the authoritative gate. Role comes from the verified token.
  if (user.role !== 'admin') {
    return { ok: false, error: 'forbidden' }
  }

  const targetUid = uid?.trim()
  // Firebase UIDs are non-empty and never contain a path separator; rejecting '/' keeps
  // a malformed value from being read as a nested document path.
  if (!targetUid || targetUid.length > 128 || targetUid.includes('/')) {
    return { ok: false, error: 'invalid-uid' }
  }

  try {
    await ratelimit.resetBudget(targetUid)

    await audit.log({
      actorUid: user.uid,
      action: 'ratelimit-reset',
      targetRef: `rateBudgets/${targetUid}`,
      raw: { targetUid },
    })

    return { ok: true }
  } catch {
    // Never surface a raw Firestore error to the client.
    return { ok: false, error: 'unknown' }
  }
}

// ─── listRateBudgets ──────────────────────────────────────────────────────────

/**
 * Per-user budget summary. Deliberately PLAIN — no Firestore Timestamp crosses the
 * RSC→Client boundary (that is the "Only plain objects can be passed to Client
 * Components" crash fixed three times already in quick-029/030/031). `windowStart` is
 * collapsed server-side into the boolean the UI actually needs.
 */
export interface RateBudgetSummary {
  uid: string
  requestCount: number
  tokenCount: number
  /** True when the stored window already rolled over — counters are stale, nothing to reset. */
  expired: boolean
}

export type ListRateBudgetsResult =
  | { ok: true; budgets: RateBudgetSummary[] }
  | { ok: false; error: 'unauthorized' | 'forbidden' | 'unknown' }

/**
 * Admin-only: read the current rate-limit budget for a set of agents
 * (quick-kayinleong-049), so the admin can see who is actually near the cap instead of
 * resetting blind.
 *
 * ONE batched `getAll()` round-trip, not one read per uid. A read-per-user loop is the
 * N+1 shape quick-046 spent a commit removing, and this list grows with the pilot.
 *
 * Missing docs are simply omitted — an agent who has never spent anything has no doc and
 * needs no reset. Counts only, no PII.
 */
export async function listRateBudgets(uids: string[]): Promise<ListRateBudgetsResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'unauthorized' }
  }
  if (user.role !== 'admin') {
    return { ok: false, error: 'forbidden' }
  }

  const clean = uids.filter((u) => typeof u === 'string' && u.length > 0 && !u.includes('/'))
  // getAll() throws on an empty ref list — short-circuit.
  if (clean.length === 0) {
    return { ok: true, budgets: [] }
  }

  try {
    const refs = clean.map((u) => rateBudgetsRef().doc(u))
    const snaps = await adminDb.getAll(...refs)

    const budgets: RateBudgetSummary[] = []
    for (const snap of snaps) {
      if (!snap.exists) continue
      const b = snap.data() as RateBudgetDoc
      budgets.push({
        uid: snap.id,
        requestCount: b.requestCount ?? 0,
        tokenCount: b.tokenCount ?? 0,
        expired: isWindowExpired(b.windowStart as Date),
      })
    }
    return { ok: true, budgets }
  } catch {
    return { ok: false, error: 'unknown' }
  }
}
