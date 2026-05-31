/**
 * src/firebase/auth.ts — Server-side authentication gate + claim-setting.
 *
 * This file is SERVER-ONLY. Never import from client components (app/ or
 * browser code). It depends on firebase-admin which is not available in the
 * browser runtime.
 *
 * Two exports:
 *   - requireUser(req)       — HARD gate: verify Firebase ID token; extract claims.
 *   - setUserClaims(uid, role) — Provision a user's role via Admin SDK.
 *
 * Security invariants (CLAUDE.md + TSD §5.1 + Threat Register T-01-10..T-01-12):
 *   - Role/tenantId are ALWAYS read from `verifyIdToken` output — NEVER from
 *     the request body (T-01-11 — client claim spoofing).
 *   - Gate fails CLOSED on any token error — an exception is thrown, not a
 *     default-allow fallback (T-01-10).
 *   - No token or claim values are logged (T-01-12, CLAUDE.md secrets hygiene).
 *     Do NOT add console.log/info/debug calls that include token strings or claims.
 *
 * Import pattern:
 *   import { requireUser, setUserClaims } from '@/src/firebase/auth'
 */

import { adminAuth } from '@/src/firebase/admin'
import {
  usersRef,
  agentProfilesRef,
  TENANT_ID,
  type UserDoc,
  type AgentProfileDoc,
} from '@/src/firebase/collections'
import type { FieldValue } from 'firebase-admin/firestore'

// ─── Types ───────────────────────────────────────────────────────────────────

export type Role = 'new-agent' | 'senior-coach' | 'admin'

/** The shape returned by requireUser — claims extracted from the verified token. */
export interface AuthenticatedUser {
  uid: string
  role: Role
  tenantId: string
}

/** Valid role values — used for runtime validation. */
const VALID_ROLES: Role[] = ['new-agent', 'senior-coach', 'admin']

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown by requireUser when the token is missing, expired, or invalid.
 * Route Handlers should catch this and return a 401 response.
 *
 * Named export so callers (and tests) can reference it:
 *   import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
 */
export class UnauthorizedError extends Error {
  readonly statusCode = 401

  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
    // Correct prototype chain for instanceof checks across transpiler targets
    Object.setPrototypeOf(this, UnauthorizedError.prototype)
  }
}

/**
 * Thrown by setUserClaims when an unknown role string is passed.
 */
export class InvalidRoleError extends Error {
  constructor(role: string) {
    super(`Invalid role: "${role}". Must be one of: ${VALID_ROLES.join(', ')}`)
    this.name = 'InvalidRoleError'
    Object.setPrototypeOf(this, InvalidRoleError.prototype)
  }
}

// ─── requireUser ─────────────────────────────────────────────────────────────

/**
 * HARD auth gate — call this at the start of every privileged Route Handler.
 *
 * Extracts the Bearer token from the `Authorization` header, verifies it
 * server-side via `adminAuth.verifyIdToken`, and returns the identity +
 * custom claims (`role`, `tenantId`) from the VERIFIED token.
 *
 * Never trusts role/tenantId from the request body or client-side headers.
 *
 * @throws {UnauthorizedError} — if the Authorization header is absent,
 *   the Bearer prefix is malformed, or verifyIdToken rejects the token.
 *
 * Usage:
 *   const user = await requireUser(req)  // throws 401 if invalid
 */
export async function requireUser(req: Request): Promise<AuthenticatedUser> {
  // Extract Bearer token from Authorization header — do NOT read from body
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header')
  }

  const idToken = authHeader.slice('Bearer '.length).trim()
  if (!idToken) {
    throw new UnauthorizedError('Empty Bearer token')
  }

  // Verify the token server-side; this will reject expired, revoked, or forged tokens.
  // SECURITY: do NOT log `idToken` or `decoded` — token hygiene (CLAUDE.md / T-01-12).
  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>
  try {
    decoded = await adminAuth.verifyIdToken(idToken)
  } catch {
    // Any verifyIdToken failure (expired, invalid, revoked) — fail closed
    throw new UnauthorizedError('Token verification failed')
  }

  // Read role and tenantId from the VERIFIED token claims — not from the body
  const role = decoded['role'] as Role | undefined
  const tenantId = decoded['tenantId'] as string | undefined

  if (!role || !tenantId) {
    throw new UnauthorizedError('Token missing required claims (role, tenantId)')
  }

  return { uid: decoded.uid, role, tenantId }
}

// ─── setUserClaims ───────────────────────────────────────────────────────────

/**
 * Provision a user's role by setting custom Firebase Auth claims.
 *
 * This is the ONLY sanctioned claim-setting path (TSD §5.1, D-11).
 * Called by:
 *   - `scripts/set-claims.ts` (thin admin/coach provisioning — no sign-in UI in Phase 1)
 *   - Any future server-side role-change logic
 *
 * SECURITY: Claims are set exclusively via the Admin SDK — never from client code.
 * T-01-13: role union validated at runtime to prevent unexpected privilege.
 *
 * @param uid     — Firebase Auth UID of the user to provision
 * @param role    — One of 'new-agent' | 'senior-coach' | 'admin'
 * @param opts    — Optional: uplineCoachId (new-agent), seniorCoachId (new-agent)
 *
 * @throws {InvalidRoleError} — if role is not in the allowed union
 */
export async function setUserClaims(
  uid: string,
  role: Role,
  opts?: { uplineCoachId?: string; seniorCoachId?: string }
): Promise<void> {
  // Runtime role validation — reject unknown roles (T-01-13)
  if (!VALID_ROLES.includes(role)) {
    throw new InvalidRoleError(role)
  }

  // Set custom claims via Admin SDK (server-only — never from client)
  await adminAuth.setCustomUserClaims(uid, { role, tenantId: TENANT_ID })

  // Upsert the users/{uid} doc with role + tenantId via the typed ref (01-03)
  const userDoc: Omit<UserDoc, 'voiceSamples'> & { voiceSamples: string[] } = {
    tenantId: TENANT_ID,
    role,
    lang: 'en',          // default lang; updated at first sign-in if needed
    voiceSamples: [],    // Phase 2 placeholder (D-10)
    ...(opts?.uplineCoachId ? { uplineCoachId: opts.uplineCoachId } : {}),
  }
  await usersRef().doc(uid).set(userDoc as UserDoc, { merge: true })

  // For new-agent: also upsert agentProfiles/{uid} (TSD §4)
  if (role === 'new-agent') {
    const profileDoc: AgentProfileDoc = {
      tenantId: TENANT_ID,
      journeyStage: 'onboarding',
      currentCheckpoint: 'start',
      lastActiveAt: new Date() as unknown as Date | FieldValue,
      activeLeadIds: [],
      seniorCoachId: opts?.seniorCoachId ?? opts?.uplineCoachId ?? '',
    }
    await agentProfilesRef().doc(uid).set(profileDoc, { merge: true })
  }
}
