'use server'

/**
 * app/[lang]/(admin)/cohorts/actions.ts — Admin-only cohort CRUD Server Actions
 * (COH-03 / D-01 / D-03).
 *
 * Three-layer admin gate (mirrors roles/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: cohorts/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-24).
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED token (never args, T-02-31).
 *
 * Every cohort mutation is audited (D-03). The cohort doc carries NO member-UID
 * array (1 MB trap) — agents reference their cohort via AgentProfileDoc.cohortId.
 *
 * References:
 *   - COH-03 (admin-only audited cohort CRUD)
 *   - D-01 (cohort registry), D-03 (admin-only audited writes), D-24 (read-only denied)
 *   - roles/actions.ts:43-56 (getSessionUser pattern, verbatim)
 *   - T-07-10 (role from verified token, never args)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { cohortsRef, agentProfilesRef, TENANT_ID } from '@/src/firebase/collections'
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

  const syntheticReq = new Request('https://d2.app/admin/cohorts', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CohortInput {
  name: string
  description: string
}

export interface CohortActionResult {
  ok: true
  id?: string
}

export type CohortActionError = {
  ok: false
  error: string
}

export type CohortResult = CohortActionResult | CohortActionError

// ─── createCohort ───────────────────────────────────────────────────────────────

/**
 * Create a cohort (COH-03 / D-03). Admin-only; audited.
 *
 * @param input  { name, description } from the create dialog.
 */
export async function createCohort(input: CohortInput): Promise<CohortResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // D-03: cohort writes are admin-only — role from the VERIFIED token (T-07-10).
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // The converter stamps tenantId on every write; set it explicitly too to
    // satisfy WithFieldValue<CohortDoc> (mirrors the reply-edit/knowledgeGaps
    // writers — idempotent, single source of truth via the converter).
    const ref = await cohortsRef().add({
      tenantId: TENANT_ID,
      name: input.name,
      description: input.description,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    })

    await audit.log({
      actorUid: user.uid,
      action: 'cohort-create',
      targetRef: `cohorts/${ref.id}`,
      raw: { cohortId: ref.id, name: input.name },
    })

    return { ok: true, id: ref.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create cohort'
    return { ok: false, error: msg }
  }
}

// ─── updateCohort ───────────────────────────────────────────────────────────────

/**
 * Update a cohort's metadata (COH-03 / D-03). Admin-only; audited.
 *
 * @param cohortId  The cohort document ID.
 * @param input     { name, description } — the new metadata.
 */
export async function updateCohort(cohortId: string, input: CohortInput): Promise<CohortResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    await cohortsRef().doc(cohortId).update({
      name: input.name,
      description: input.description,
    })

    await audit.log({
      actorUid: user.uid,
      action: 'cohort-update',
      targetRef: `cohorts/${cohortId}`,
      raw: { cohortId, name: input.name },
    })

    return { ok: true, id: cohortId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update cohort'
    return { ok: false, error: msg }
  }
}

// ─── deleteCohort ───────────────────────────────────────────────────────────────

/**
 * Delete a cohort (COH-03 / D-03). Admin-only; audited.
 *
 * D-02/D-08 NOTE: agents reference their cohort via the denormalized
 * AgentProfileDoc.cohortId. Deleting the cohort doc does NOT cascade-clear that
 * field (no backfill, mirrors the D-08 reassignment denorm policy) — an agent
 * with a now-dangling cohortId simply renders no cohort. Reassigning the agent's
 * cohort is a separate, future action; this delete is metadata-only.
 *
 * @param cohortId  The cohort document ID.
 */
export async function deleteCohort(cohortId: string): Promise<CohortResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    await cohortsRef().doc(cohortId).delete()

    await audit.log({
      actorUid: user.uid,
      action: 'cohort-delete',
      targetRef: `cohorts/${cohortId}`,
      raw: { cohortId },
    })

    return { ok: true, id: cohortId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete cohort'
    return { ok: false, error: msg }
  }
}

// ─── listCohorts ──────────────────────────────────────────────────────────────

export interface CohortSummary {
  id: string
  name: string
  description: string
  createdBy: string
}

export interface ListCohortsResult {
  ok: true
  cohorts: CohortSummary[]
}

export type ListCohortsError = { ok: false; error: string }

/**
 * Bounded read of all cohorts for the management table (COH-03).
 *
 * Admin + senior-coach may read cohort metadata (the rules admit both — the doc
 * is non-PII); but this admin-surface action stays admin-only (the page gate is
 * admin-only). Read-only is DENIED (it cannot reach this surface at all).
 */
export async function listCohorts(): Promise<ListCohortsResult | ListCohortsError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // Bounded read — never fetch-all (pilot org ≤ 200 cohorts is far above reality).
    const snap = await cohortsRef().limit(200).get()
    const cohorts: CohortSummary[] = snap.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
      }
    })
    return { ok: true, cohorts }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list cohorts'
    return { ok: false, error: msg }
  }
}

// ─── listAgentCohorts (membership map) ──────────────────────────────────────────

export interface ListAgentCohortsResult {
  ok: true
  /** Map of agent uid → the cohort id they belong to (only agents WITH a cohort). */
  map: Record<string, string>
}

export type ListAgentCohortsError = { ok: false; error: string }

/**
 * Bounded read of every agent's cohort membership (quick-036). Admin-only.
 *
 * Membership is the denormalized `agentProfiles/{uid}.cohortId` (one cohort per
 * agent — no member array). Returns only agents that HAVE a cohort; the client
 * combines this with the user roster to render members + who's available to add.
 */
export async function listAgentCohorts(): Promise<ListAgentCohortsResult | ListAgentCohortsError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // Bounded read — pilot org is a few hundred agents. Filter to docs that carry
    // a cohortId in memory (avoids an inequality query + composite index).
    const snap = await agentProfilesRef().limit(1000).get()
    const map: Record<string, string> = {}
    for (const doc of snap.docs) {
      const cohortId = doc.data().cohortId
      if (typeof cohortId === 'string' && cohortId.length > 0) {
        map[doc.id] = cohortId
      }
    }
    return { ok: true, map }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list agent cohorts'
    return { ok: false, error: msg }
  }
}

// ─── setAgentCohort (add / remove membership) ───────────────────────────────────

/**
 * Add an agent to a cohort (`cohortId` non-null) or remove them (`cohortId` null).
 * Admin-only; audited (quick-036).
 *
 * Writes the denormalized `agentProfiles/{agentUid}.cohortId` (one cohort per agent
 * — adding an agent already in another cohort MOVES them). Removal deletes the field
 * so cohort filters (`where('cohortId','==',…)`) no longer match. The cohort's
 * existence is checked on add to avoid a dangling pointer.
 *
 * @param agentUid  The agent to add/remove.
 * @param cohortId  Target cohort id, or null to remove from any cohort.
 */
export async function setAgentCohort(
  agentUid: string,
  cohortId: string | null,
): Promise<CohortResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // D-03 / T-07-10: membership writes are admin-only — role from the verified token.
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  if (!agentUid) {
    return { ok: false, error: 'Missing agent' }
  }

  try {
    if (cohortId) {
      // Add / move: verify the cohort exists first (no dangling pointer).
      const cohortSnap = await cohortsRef().doc(cohortId).get()
      if (!cohortSnap.exists) {
        return { ok: false, error: 'Cohort not found' }
      }
      await agentProfilesRef()
        .doc(agentUid)
        .set({ tenantId: TENANT_ID, cohortId }, { merge: true })
    } else {
      // Remove: clear the denormalized pointer.
      await agentProfilesRef()
        .doc(agentUid)
        .set({ cohortId: FieldValue.delete() }, { merge: true })
    }

    await audit.log({
      actorUid: user.uid,
      action: cohortId ? 'cohort-member-add' : 'cohort-member-remove',
      targetRef: `agentProfiles/${agentUid}`,
      // uid + cohortId only — never email/PII (D-03).
      raw: { agentUid, cohortId: cohortId ?? null },
    })

    return { ok: true, id: agentUid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update cohort membership'
    return { ok: false, error: msg }
  }
}
