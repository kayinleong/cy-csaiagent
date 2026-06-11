'use server'

/**
 * app/[lang]/(coach)/flags/actions.ts — Flagged-conversation queue Server Actions (FLAG-03).
 *
 * Surface S4 (D-25 → Conversations & Escalations). Lives under the (coach) route
 * group (admits senior-coach + admin; read-only is DENIED, D-24). These actions
 * power the read + review/dismiss of the content-free conversation flags written
 * by flagConversation (07-04 Task 1, in (admin)/conversations/actions.ts).
 *
 * Security / scope:
 *   - Role gate on every action: senior-coach OR admin from the VERIFIED token,
 *     never from args (mirror dashboard/actions.ts:80-89; T-02-31). read-only is
 *     NEVER admitted (D-24 / T-07-14).
 *   - listFlags is role-scoped (HR-4 / Pitfall D): an admin reads ALL open flags;
 *     a senior-coach reads ONLY own-downline flags (where seniorCoachId == uid).
 *     The Firestore rule (07-02) is gate 2; this app filter is gate 1.
 *   - Bounded read — limit(50), never fetch-all. Uses the 07-02 composite indexes
 *     (seniorCoachId,status) / (status,createdAt) (Pitfall 6 FAILED_PRECONDITION
 *     until those indexes finish building at rollout).
 *   - reviewFlag / dismissFlag set status + reviewedBy/reviewedAt and are audited.
 *
 * PDPA / D-10: rows carry the conversationId REFERENCE only — NO message content
 * is ever read or returned here. The queue deep-links to the existing audited
 * viewer for content.
 *
 * References:
 *   - FLAG-03 (bounded scoped queue read + review/dismiss; read-only DENIED)
 *   - D-09 (Admin-SDK-only writes), D-10 (content-free), D-11 (manual only), D-24 (read-only denied)
 *   - dashboard/actions.ts (getSessionUser + coach-or-admin gate pattern)
 *   - 07-02-SUMMARY (conversationFlags collection + composite indexes)
 *   - T-07-13 (cross-coach flag read), T-07-14 (read-only EoP)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { conversationFlagsRef } from '@/src/firebase/collections'
import { log as auditLog } from '@/src/audit/log'

// ─── Session helper ─────────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Same pattern as dashboard/actions.ts:48-61 — role comes from the verified token.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/coach/flags', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type FlagStatus = 'open' | 'reviewed' | 'dismissed'

/** A single flag row for the queue — REFERENCE ONLY, never message content (D-10). */
export interface FlagRow {
  id: string
  /** The flagged conversation id — the deep-link target (no content on the flag). */
  conversationId: string
  reason: string
  status: FlagStatus
  flaggedByUid: string
  /** ISO string (serializable to the client); null when the server ts is unresolved. */
  createdAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface ListFlagsOptions {
  /** Optional status filter; when omitted, all statuses are returned (bounded). */
  status?: FlagStatus
  /** Optional createdAt cursor (ISO) for "load more" pagination (older than this). */
  cursorTs?: string
}

export interface ListFlagsResult {
  ok: boolean
  flags?: FlagRow[]
  error?: string
}

export interface FlagMutationResult {
  ok: boolean
  error?: string
}

// ─── Internal: shape a Firestore flag doc into a serializable row ───────────────

/** Convert an Admin-SDK Timestamp|Date|null to an ISO string, or null. */
function toIso(value: unknown): string | null {
  if (!value) return null
  const ts = value as { toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

// ─── listFlags ──────────────────────────────────────────────────────────────────

/**
 * Bounded, role-scoped read of conversation flags for the queue (FLAG-03).
 *
 * Scope (Pitfall D / T-07-13):
 *   - admin → all flags in the tenant (no seniorCoachId filter).
 *   - senior-coach → only own-downline flags (where seniorCoachId == user.uid).
 * read-only is NEVER admitted (D-24).
 *
 * @param opts  { status?, cursorTs? } — optional status filter + pagination cursor.
 */
export async function listFlags(opts: ListFlagsOptions = {}): Promise<ListFlagsResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Coach-or-admin gate; read-only DENIED (D-24).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    // The Admin-SDK query surface (where/orderBy/limit/startAfter/get).
    type FlagQuery = {
      where: (field: string, op: string, value: unknown) => FlagQuery
      orderBy: (field: string, dir?: 'asc' | 'desc') => FlagQuery
      startAfter: (value: unknown) => FlagQuery
      limit: (n: number) => FlagQuery
      get: () => Promise<{
        docs: Array<{
          id: string
          data: () => {
            conversationId: string
            reason: string
            status: FlagStatus
            flaggedByUid: string
            createdAt?: unknown
            reviewedBy?: string
            reviewedAt?: unknown
          }
        }>
      }>
    }

    let q = conversationFlagsRef() as unknown as FlagQuery

    // Scope: coach is downline-locked (gate 1); admin is org-wide.
    // The (seniorCoachId,status) composite index serves the coach+status path.
    if (user.role !== 'admin') {
      q = q.where('seniorCoachId', '==', user.uid)
    }

    // Optional status filter (uses the (status,createdAt) index for admin).
    if (opts.status) {
      q = q.where('status', '==', opts.status)
    }

    // Newest-first, bounded (never fetch-all).
    q = q.orderBy('createdAt', 'desc')

    if (opts.cursorTs) {
      q = q.startAfter(new Date(opts.cursorTs))
    }

    q = q.limit(50)

    const snap = await q.get()

    const flags: FlagRow[] = snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        conversationId: data.conversationId,
        reason: data.reason,
        status: data.status,
        flaggedByUid: data.flaggedByUid,
        createdAt: toIso(data.createdAt),
        reviewedBy: data.reviewedBy ?? null,
        reviewedAt: toIso(data.reviewedAt),
      }
    })

    return { ok: true, flags }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load flags'
    return { ok: false, error: msg }
  }
}

// ─── transitionFlag (shared review/dismiss writer) ──────────────────────────────

/**
 * Shared status-transition + audit for reviewFlag / dismissFlag.
 * Coach-or-admin gated; sets status + reviewedBy(=verified uid)/reviewedAt.
 */
async function transitionFlag(
  flagId: string,
  status: 'reviewed' | 'dismissed',
  auditAction: 'flag-review' | 'flag-dismiss',
): Promise<FlagMutationResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    await conversationFlagsRef().doc(flagId).update({
      status,
      reviewedBy: user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
    })

    await auditLog({
      actorUid: user.uid,
      action: auditAction,
      targetRef: `conversationFlags/${flagId}`,
      raw: { flagId },
    })

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update flag'
    return { ok: false, error: msg }
  }
}

/** Mark a flag reviewed (FLAG-03) — coach-or-admin; audited. */
export async function reviewFlag(flagId: string): Promise<FlagMutationResult> {
  return transitionFlag(flagId, 'reviewed', 'flag-review')
}

/** Dismiss a flag (FLAG-03) — coach-or-admin; audited. */
export async function dismissFlag(flagId: string): Promise<FlagMutationResult> {
  return transitionFlag(flagId, 'dismissed', 'flag-dismiss')
}
