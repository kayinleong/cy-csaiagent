'use server'

/**
 * app/[lang]/(admin)/coach-assignment/actions.ts — Admin-only coach reassignment
 * via an atomic dual-write (ASSIGN-01 / ASSIGN-02 / D-06 / D-07 / D-08).
 *
 * assignCoach(agentUid, newCoachUid):
 *   - ADMIN-ONLY (D-07): a senior-coach can NEVER reassign their own downline.
 *     The role is read from the VERIFIED token (T-07-10) — never from args. A
 *     non-admin caller (senior-coach OR read-only) → {ok:false, error:'Forbidden'}.
 *   - ATOMIC DUAL-WRITE (D-06): a single adminDb.batch() updates BOTH
 *     agentProfiles/{agentUid}.seniorCoachId AND users/{agentUid}.uplineCoachId,
 *     then commit() — the two denormalized pointers can never drift apart.
 *   - AUDITED: an action:'coach-assign' audit row is written on success.
 *
 * D-08 / ASSIGN-02 — NO HISTORICAL BACKFILL:
 *   Historical denormalized `seniorCoachId` rows on replyEdits / knowledgeGaps /
 *   escalations / conversationFlags are INTENTIONALLY NOT rewritten on reassign.
 *   Only FUTURE rows pick up the new coach. Past analytics keep their original
 *   coach attribution (the reassign confirm dialog states this to the admin).
 *   Backfilling would corrupt historical per-coach attribution — out of scope.
 *
 * References:
 *   - ASSIGN-01 (admin-only atomic dual-write), ASSIGN-02 (no historical backfill, D-08)
 *   - D-06 (atomic), D-07 (admin-only; no coach self-reassign), D-24 (read-only denied)
 *   - roles/actions.ts:43-56 (getSessionUser pattern, verbatim)
 *   - T-07-27 (senior-coach reassigns own downline), T-07-10 (role from verified token)
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminDb } from '@/src/firebase/admin'
import { agentProfilesRef, usersRef } from '@/src/firebase/collections'
import * as audit from '@/src/audit'

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Verbatim copy of roles/actions.ts:43-56 (getSessionUser pattern).
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/coach-assignment', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignCoachResult {
  ok: true
}

export type AssignCoachError = {
  ok: false
  error: string
}

export type AssignCoachUnion = AssignCoachResult | AssignCoachError

// ─── assignCoach ──────────────────────────────────────────────────────────────

/**
 * Reassign an agent to a new senior coach (ASSIGN-01 / D-06 / D-07).
 *
 * @param agentUid     The agent whose coach is being changed.
 * @param newCoachUid  The UID of the new senior coach.
 */
export async function assignCoach(
  agentUid: string,
  newCoachUid: string,
): Promise<AssignCoachUnion> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // D-07: coach reassignment is ADMIN-ONLY. A senior-coach (or read-only) is
  // rejected — a coach can NEVER reassign their own downline (T-07-27). Role is
  // read from the verified token, never from args (T-07-10).
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // D-06: atomic dual-write of the two denormalized coach pointers.
    // agentProfiles.seniorCoachId is the read-scope key (rules + queries); the
    // users.uplineCoachId mirror keeps the user doc consistent. One batch, one
    // commit — they can never drift apart.
    const batch = adminDb.batch()
    batch.update(agentProfilesRef().doc(agentUid), { seniorCoachId: newCoachUid })
    batch.update(usersRef().doc(agentUid), { uplineCoachId: newCoachUid })
    await batch.commit()

    await audit.log({
      actorUid: user.uid,
      action: 'coach-assign',
      targetRef: `agentProfiles/${agentUid}`,
      raw: { agentUid, newCoachUid },
    })

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reassign coach'
    return { ok: false, error: msg }
  }
}
