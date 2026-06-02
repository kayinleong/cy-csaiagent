'use server'

/**
 * app/[lang]/(coach)/dashboard/actions.ts — Server Actions for the coach dashboard.
 *
 * Action: resolveStall(eid) — mark an escalation as resolved (CDASH-02).
 * Action: submitCorrection(docId, content) — inline KB correction (CDASH-04).
 *
 * Security:
 *   - Each action reads the __session cookie → requireUser() — uid + role from
 *     the verified token, NEVER from the action arguments (T-02-31).
 *   - resolveStall: requires role ∈ {'senior-coach', 'admin'}.
 *   - submitCorrection: delegates to correctKbDoc which enforces role ∈ {'admin','senior-coach'}.
 *
 * Pattern mirrors app/[lang]/(admin)/kb/actions.ts (getSessionUser + role check).
 *
 * References:
 *   - CDASH-02 (resolve stall escalation)
 *   - CDASH-04 (inline AI correction → versioned KB re-ingest)
 *   - D-12 (correction → versioned KB re-ingest with attribution)
 *   - T-02-30 (inline correction tamper mitigation)
 *   - T-02-31 (role from verified token, not from client)
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { escalationsRef } from '@/src/firebase/collections'
import { correctKbDoc } from '@/src/kb/crud'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Throws UnauthorizedError if the session is missing or invalid.
 * This is the same pattern used in (admin)/kb/actions.ts.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/coach/dashboard', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── resolveStall ─────────────────────────────────────────────────────────────

export interface ResolveStallResult {
  ok: boolean
  error?: string
}

/**
 * Mark an open stall escalation as resolved (CDASH-02 resolve action).
 *
 * Role gate: senior-coach or admin only.
 * The escalation document is looked up by eid — the coach can only resolve
 * escalations visible to them (the dashboard only shows their downline's stalls
 * — server-side downline filter on read). The write updates the status field.
 *
 * @param eid  The escalation document ID to resolve.
 */
export async function resolveStall(eid: string): Promise<ResolveStallResult> {
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
    await escalationsRef().doc(eid).update({ status: 'resolved' })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to resolve stall'
    return { ok: false, error: msg }
  }
}

// ─── submitCorrection ─────────────────────────────────────────────────────────

export interface SubmitCorrectionResult {
  ok: boolean
  docId?: string
  newDocId?: string
  jobId?: string
  total?: number
  remaining?: number
  error?: string
}

/**
 * Inline KB correction — a coach submits corrected content for a KB doc (CDASH-04).
 *
 * Delegates to correctKbDoc (src/kb/crud.ts) which:
 *   - Enforces role ∈ {'admin', 'senior-coach'} (assertAdminOrCoach).
 *   - Stamps correctedBy: user.uid on the new version (D-12 attribution).
 *   - Creates a new versioned kbDoc that supersedes the old one.
 *   - Shards the corrected content into a re-ingest job.
 *
 * Returns job metadata so the client dialog can poll /api/kb/ingest/process
 * until remaining === 0 (reusing the kb-doc-form poll pattern from 02-08).
 *
 * @param docId    The kbDocs document ID to correct.
 * @param content  The corrected plain-text content.
 */
export async function submitCorrection(
  docId: string,
  content: string,
): Promise<SubmitCorrectionResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // correctKbDoc internally enforces admin|senior-coach — but we check here too
  // for a fast fail before hitting Firestore (T-02-31: role from verified token).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    const result = await correctKbDoc(user, docId, content)
    return {
      ok: true,
      docId: result.docId,
      newDocId: result.newDocId,
      jobId: result.jobId,
      total: result.total,
      remaining: result.remaining,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Correction failed'
    return { ok: false, error: msg }
  }
}
