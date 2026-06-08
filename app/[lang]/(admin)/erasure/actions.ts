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
import { z } from 'zod'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { erasureRequestsRef, TENANT_ID } from '@/src/firebase/collections'
import { manifestCollections, PII_ERASURE_MANIFEST } from '@/src/pdpa/coverage'
import type { ManifestEntry } from '@/src/pdpa/coverage'
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
 * Used for subjectIdHash stored on the request doc.
 * T-05-RAWID: the raw subject id is retained TRANSIENTLY on the admin-only
 * `erasureRequests` ledger (admin-read-only via Firestore rules; never returned
 * to clients — the row mapper omits it) solely so the chunked erasure-sweep
 * can resume querying Firestore for this subject.  It is CLEARED
 * (`FieldValue.delete()`) the moment the request reaches `complete`, within
 * the <72h SLA.  v2 hardening option: encrypt-at-rest with a Secret-Manager key.
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

  // Create the erasureRequests ledger doc.
  // T-05-RAWID: rawSubjectId is retained TRANSIENTLY on the server-only ledger so the
  // chunked erasure-sweep can resume querying Firestore for this subject.  It is NEVER
  // returned to clients (the row mapper in listErasureRequests omits it).  It is CLEARED
  // (`FieldValue.delete()`) when the request reaches `complete` — see the completion
  // branch below.  v2 hardening option: encrypt-at-rest with a Secret-Manager key.
  const reqRef = erasureRequestsRef().doc()
  const slaDeadline = Date.now() + 72 * 60 * 60 * 1000 // <72h SLA (D-02)
  const collectionsRemaining = manifestCollections(subjectType)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (reqRef as any).set({
    tenantId: TENANT_ID,
    subjectType,
    subjectIdHash: hashId(id),
    // rawSubjectId: transient server-only field — retained so the chunked sweep can
    // re-query Firestore for this subject.  Cleared (FieldValue.delete()) when the
    // request reaches 'complete'.  Never returned to clients (row mapper omits it).
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

  // Update the request doc to reflect the core's result.
  // CR-01 fix: when the request is complete, CLEAR rawSubjectId via FieldValue.delete()
  // so the raw subject id is not retained beyond the erasure lifecycle.  In-flight
  // ('sweeping') requests retain rawSubjectId because the sweep still needs it.
  const newStatus = coreResult.complete ? 'complete' : 'sweeping'
  const updateData: Record<string, unknown> = {
    status: newStatus,
    collectionsRemaining: coreResult.collectionsRemaining,
  }
  if (coreResult.complete) {
    updateData.completedAt = FieldValue.serverTimestamp()
    // Clear the transient rawSubjectId — no longer needed once erasure is complete.
    updateData.rawSubjectId = FieldValue.delete()
  }
  await reqRef.update(updateData)

  return { ok: true, reqId: reqRef.id, status: newStatus }
}

// NOTE: do NOT add an `export { eraseDataSubjectAction as eraseDataSubject }` alias here.
// This is a 'use server' module — Turbopack's Server Actions transform collapses a
// dual-export of the same function to ONE client-proxy name, which made the client
// import of `eraseDataSubjectAction` fail at runtime (erasure page 500). The action
// has exactly one exported name: eraseDataSubjectAction. Tests + the form both use it.

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

  // Return per-collection counts scoped to THIS subject — NO deletion, NO doc content.
  // WR-02 fix: iterate manifest ENTRIES (not just collection names) and apply the same
  // key strategy the executor uses so the count reflects docs that WILL be deleted for
  // this subject, not the whole collection.
  //   - keyField entry: where(keyField, '==', id).count() — direct equality filter
  //   - keyVia entry:   two-step (resolve via source collection first), same strategy
  //   - docId entry:    existence check on collection/{id} → 0 or 1
  //   - STORAGE / auditLogs: skipped (EXEMPT or outside Firestore count scope)
  const counts: Record<string, number> = {}
  const { adminDb } = await import('@/src/firebase/admin')

  const entries: ManifestEntry[] = PII_ERASURE_MANIFEST[subjectType] as ManifestEntry[]
  for (const entry of entries) {
    // Skip non-Firestore entries and EXEMPT collections
    if (entry.collection === 'STORAGE' || entry.collection === 'auditLogs') continue

    try {
      if ('docId' in entry && entry.docId) {
        // docId strategy: the subject id IS the document id — existence check → 0 or 1
        const ref = adminDb.collection(entry.collection).doc(id)
        const snap = await ref.get()
        counts[entry.collection] = snap.exists ? 1 : 0
      } else if ('keyVia' in entry && entry.keyVia) {
        // keyVia strategy: two-step — first resolve intermediate ids from source collection,
        // then count docs in target collection keyed by those intermediate ids.
        // Format: 'sourceCollection.sourceField' where sourceField == subject id.
        const [sourceCollection, sourceField] = entry.keyVia.split('.')
        const intermediateSnap = await adminDb
          .collection(sourceCollection)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(sourceField as any, '==', id)
          .select() // projection — no fields needed, just doc ids
          .get()
        counts[entry.collection] = intermediateSnap.size
      } else if ('keyField' in entry && entry.keyField) {
        // keyField strategy: where(keyField, '==', id).count()
        const aggSnap = await adminDb
          .collection(entry.collection)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(entry.keyField as any, '==', id)
          .count()
          .get()
        counts[entry.collection] = aggSnap.data().count
      }
    } catch {
      counts[entry.collection] = 0
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
