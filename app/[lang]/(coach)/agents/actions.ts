'use server'

/**
 * app/[lang]/(coach)/agents/actions.ts — Record-first-close Server Action
 * (CLOSE-01 / D-20 / D-21).
 *
 * Lives under the (coach) route group: the (admin) group layout redirects a
 * senior-coach to /dashboard, so a coach-OR-admin surface (D-05) MUST live here —
 * the (coach) layout admits senior-coach + admin.
 *
 * recordFirstClose(agentUid):
 *   - ACCESS (D-21): senior-coach (own-downline) + admin. A non-downline coach →
 *     {ok:false, error:'Forbidden'}. Role + downline read from the VERIFIED token
 *     (never args, T-07-10). Admin may record for any agent.
 *   - IDEMPOTENT (D-21): sets firstCloseAt ONLY when ABSENT. A second call when
 *     firstCloseAt is already set is a NO-OP (records the FIRST close only) →
 *     {ok:false, error:'already-recorded'}; the write never overwrites.
 *   - AUDITED: an action:'record-first-close' audit row is written on the set.
 *
 * NO journey-edit path (D-04): this only stamps firstCloseAt; it never mutates
 * journeyStage / currentCheckpoint.
 *
 * References:
 *   - CLOSE-01 (record first close), D-20 (firstCloseAt signal), D-21 (idempotent + access)
 *   - dashboard/actions.ts:80-89 (resolveStall coach-or-admin gate analog)
 *   - T-07-11 (double-record tampering — idempotency mitigation)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { agentProfilesRef } from '@/src/firebase/collections'
import * as audit from '@/src/audit'

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Mirrors dashboard/actions.ts:48-61 (getSessionUser pattern).
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/coach/agents', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordFirstCloseResult {
  ok: true
}

export type RecordFirstCloseError = {
  ok: false
  error: string
}

export type RecordFirstCloseUnion = RecordFirstCloseResult | RecordFirstCloseError

// ─── recordFirstClose ───────────────────────────────────────────────────────────

/**
 * Record an agent's FIRST close (CLOSE-01 / D-21). Idempotent; audited.
 *
 * @param agentUid  The agent (downline member) whose first close to record.
 */
export async function recordFirstClose(agentUid: string): Promise<RecordFirstCloseUnion> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Role gate: senior-coach or admin only (read-only / new-agent denied).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  const docRef = agentProfilesRef().doc(agentUid)

  let snap: Awaited<ReturnType<typeof docRef.get>>
  try {
    snap = await docRef.get()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read agent profile'
    return { ok: false, error: msg }
  }

  if (!snap.exists) {
    return { ok: false, error: 'Forbidden' }
  }

  const profile = snap.data()

  // D-21 downline gate: a non-admin coach may only record for their OWN downline.
  if (user.role !== 'admin' && profile?.seniorCoachId !== user.uid) {
    return { ok: false, error: 'Forbidden' }
  }

  // D-21 idempotency: a first close is recorded ONCE. If already set, no-op the
  // write (never overwrite — records the FIRST close only, T-07-11).
  if (profile?.firstCloseAt) {
    return { ok: false, error: 'already-recorded' }
  }

  try {
    await docRef.update({ firstCloseAt: FieldValue.serverTimestamp() })

    await audit.log({
      actorUid: user.uid,
      action: 'record-first-close',
      targetRef: `agentProfiles/${agentUid}`,
      raw: { agentUid },
    })

    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to record first close'
    return { ok: false, error: msg }
  }
}
