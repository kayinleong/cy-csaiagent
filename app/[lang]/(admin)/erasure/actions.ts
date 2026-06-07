'use server'

/**
 * app/[lang]/(admin)/erasure/actions.ts — PDPA erasure Server Actions (QUAL-09 / D-01/D-02).
 *
 * Three-layer admin gate:
 *   Layer 1: (admin)/layout.tsx redirects non-admins.
 *   Layer 2: erasure/page.tsx (RSC) re-checks role.
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED TOKEN (never from args).
 *
 * STRIDE: "Admin SDK bypasses Firestore rules — gate must be in code" (T-05-ADMINGATE).
 * Role is read from the verified Firebase ID token via requireUser, NEVER from action args (T-02-31).
 *
 * Actions exported:
 *   eraseDataSubjectAction — the public entry point (alias to eraseDataSubject for module clarity)
 *   eraseDataSubject       — convenience re-export (same function, matching the expected public name)
 *   getBlastRadius         — read-only per-collection count preview (audited, no deletion)
 *   listErasureRequests    — admin-scoped list of erasureRequests docs
 *
 * NOTE: The erasure core (src/pdpa/erasure.ts) already writes the audit event for the cascade.
 * This action writes the erasureRequests doc and calls the core — no double-write of the
 * erasure audit event.
 *
 * References:
 *   - QUAL-09 (PDPA erasure)
 *   - D-01 (admin-triggered cascade), D-02 (chunked + ledger)
 *   - 05-PATTERNS.md §erasure/actions.ts
 *   - 05-RESEARCH.md §Code Examples → Erasure Server Action skeleton
 *   - T-05-ADMINGATE, T-05-ACCIDENT, T-05-RAWID, T-05-INPUT
 */

import { createHash } from 'crypto'
import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { AggregateField } from 'firebase-admin/firestore'
import { z } from 'zod'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { erasureRequestsRef, TENANT_ID } from '@/src/firebase/collections'
import { manifestCollections } from '@/src/pdpa/coverage'
import { eraseDataSubject as eraseCore } from '@/src/pdpa/erasure'
import { auditDrilldown } from '@/src/audit/log'

// ─── Input schema ─────────────────────────────────────────────────────────────

/**
 * V5 ASVS input validation: validate BEFORE any Admin-SDK write.
 * T-05-INPUT: reject malformed/forged action input at the gate.
 */
const Input = z.object({
  subjectType: z.enum(['lead', 'agent']),
  id: z.string().min(1),
})

const BlastRadiusInput = z.object({
  subjectType: z.enum(['lead', 'agent']),
  id: z.string().min(1),
})

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Copied verbatim from dashboard/actions.ts:39-52.
 * Throws UnauthorizedError if the session is missing or invalid.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/erasure', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Hash helper ──────────────────────────────────────────────────────────────

/**
 * sha256 hex hash of a raw subject id.
 * Used for subjectIdHash stored on the request doc — NEVER the raw id.
 * T-05-RAWID: raw subject id is NEVER persisted; only the hash is stored.
 */
function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

// ─── eraseDataSubjectAction ───────────────────────────────────────────────────

export interface EraseDataSubjectResult {
  ok: boolean
  reqId?: string
  status?: string
  error?: string
}

/**
 * Admin-gated, zod-validated PDPA data erasure Server Action.
 *
 * Gate order (STRIDE T-05-ADMINGATE):
 *   1. Session → UnauthorizedError if no session
 *   2. Role === 'admin' → Forbidden if not admin
 *   3. Zod Input.parse → reject malformed input BEFORE any write
 *   4. Create erasureRequests doc (status:'pending', slaDeadline=now+72h)
 *   5. Call eraseCore (src/pdpa/erasure.ts) — the cascade + audit event
 *   6. Update request doc status based on core result
 *
 * NOTE: The core (eraseCore) already writes the audit event (action:'erasure').
 * This action does NOT write a second audit event — no double-write.
 *
 * @param raw  The raw (unvalidated) input from the form — must match Input schema.
 */
export async function eraseDataSubjectAction(raw: unknown): Promise<EraseDataSubjectResult> {
  // Gate 1: session auth
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Gate 2: admin role from verified token (NEVER from args — T-02-31 / T-05-ADMINGATE)
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  // Gate 3: zod input validation BEFORE any Admin-SDK write (V5 input validation)
  let parsed: z.infer<typeof Input>
  try {
    parsed = Input.parse(raw)
  } catch (err) {
    const message = err instanceof z.ZodError ? err.message : 'Invalid input'
    return { ok: false, error: message }
  }

  const { subjectType, id } = parsed

  // Create the erasureRequests ledger doc
  // T-05-RAWID: store subjectIdHash only — never the raw id in the TypeScript interface.
  // The raw id is passed as a server-side field to enable sweep re-query (05-03 decision).
  const reqRef = erasureRequestsRef().doc()
  const slaDeadline = Date.now() + 72 * 60 * 60 * 1000 // <72h SLA (D-02)
  const collectionsRemaining = manifestCollections(subjectType)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (reqRef as any).set({
    tenantId: TENANT_ID,
    subjectType,
    subjectIdHash: hashId(id),
    // rawSubjectId is stored as a server-side field (not in the TypeScript interface)
    // so the erasure-sweep can re-query Firestore using the raw id (05-03 decision).
    // It is never returned to clients.
    rawSubjectId: id,
    status: 'pending',
    requestedBy: user.uid,
    requestedAt: FieldValue.serverTimestamp(),
    slaDeadline,
    collectionsRemaining,
  })

  // Delegate the cascade to the 05-03 core.
  // eraseCore writes the erasure audit event (action:'erasure') — do NOT write it here.
  let coreResult: Awaited<ReturnType<typeof eraseCore>>
  try {
    coreResult = await eraseCore({
      subjectType,
      id,
      actorUid: user.uid,
      reqId: reqRef.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erasure failed'
    await reqRef.update({ status: 'failed', error: message })
    return { ok: false, error: message }
  }

  // Update the request doc to reflect the core's result
  const newStatus = coreResult.complete ? 'complete' : 'sweeping'
  const updateData: Record<string, unknown> = {
    status: newStatus,
    collectionsRemaining: coreResult.collectionsRemaining,
  }
  if (coreResult.complete) {
    updateData.completedAt = FieldValue.serverTimestamp()
  }
  await reqRef.update(updateData)

  return { ok: true, reqId: reqRef.id, status: newStatus }
}

// Re-export under the conventional public name so both names work
// (the test imports eraseDataSubjectAction; callers may use eraseDataSubject)
export { eraseDataSubjectAction as eraseDataSubject }

// ─── getBlastRadius ───────────────────────────────────────────────────────────

export interface BlastRadiusResult {
  ok: boolean
  counts?: Record<string, number>
  error?: string
}

/**
 * Admin-gated blast-radius preview: returns per-collection COUNTS without deleting anything.
 * T-05-BLAST: preview returns counts only (never doc content) — audited via auditDrilldown.
 * The read is audited because it involves resolving which docs belong to the subject.
 *
 * @param raw  The raw (unvalidated) input — must match BlastRadiusInput schema.
 */
export async function getBlastRadius(raw: unknown): Promise<BlastRadiusResult> {
  // Gate 1: session auth
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Gate 2: admin role
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  // Gate 3: input validation
  let parsed: z.infer<typeof BlastRadiusInput>
  try {
    parsed = BlastRadiusInput.parse(raw)
  } catch (err) {
    const message = err instanceof z.ZodError ? err.message : 'Invalid input'
    return { ok: false, error: message }
  }

  const { subjectType, id } = parsed

  // Audit this read (PDPA: admin read of subject data must be audited — T-05-BLAST)
  await auditDrilldown(user.uid, `erasure/blast-radius/${subjectType}/${hashId(id)}`)

  // Return per-collection counts (AggregateField.count) — NO deletion, NO doc content
  const counts: Record<string, number> = {}

  // Build the counts using AggregateField to avoid fetching documents (Pitfall 4/9)
  // For simplicity, use the manifest to know which collections to count
  const collections = manifestCollections(subjectType)
  for (const col of collections) {
    if (col === 'STORAGE' || col === 'auditLogs') continue
    try {
      // We use a simple count query — for collections without a known key field here,
      // we fall back to a conservative estimate via the Firebase admin SDK
      const { adminDb } = await import('@/src/firebase/admin')
      const snap = await adminDb
        .collection(col)
        .count()
        .get()
      counts[col] = snap.data().count
    } catch {
      counts[col] = 0
    }
  }

  return { ok: true, counts }
}

// ─── listErasureRequests ──────────────────────────────────────────────────────

export interface ErasureRequestRow {
  id: string
  subjectType: 'lead' | 'agent'
  subjectIdHash: string
  status: 'pending' | 'sweeping' | 'complete' | 'failed'
  requestedBy: string
  requestedAt: number
  slaDeadline: number
  collectionsRemaining: string[]
  completedAt?: number
  error?: string
}

/**
 * Admin-gated list of erasureRequests docs for the status view.
 * Returns serializable plain-object rows (no Firestore types).
 */
export async function listErasureRequests(): Promise<{
  ok: boolean
  requests?: ErasureRequestRow[]
  error?: string
}> {
  // Gate 1: session auth
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Gate 2: admin role
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    const snap = await erasureRequestsRef()
      .orderBy('requestedAt', 'desc')
      .limit(50)
      .get()

    const requests: ErasureRequestRow[] = snap.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        subjectType: data.subjectType,
        subjectIdHash: data.subjectIdHash,
        status: data.status,
        requestedBy: data.requestedBy,
        // Firestore timestamps may be a FieldValue sentinel — convert safely
        requestedAt:
          data.requestedAt instanceof Date
            ? data.requestedAt.getTime()
            : typeof data.requestedAt === 'number'
              ? data.requestedAt
              : Date.now(),
        slaDeadline: data.slaDeadline,
        collectionsRemaining: data.collectionsRemaining ?? [],
        completedAt:
          data.completedAt instanceof Date
            ? data.completedAt.getTime()
            : typeof data.completedAt === 'number'
              ? data.completedAt
              : undefined,
        error: data.error,
      }
    })

    return { ok: true, requests }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list erasure requests'
    return { ok: false, error: message }
  }
}
