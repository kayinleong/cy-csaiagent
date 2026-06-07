/**
 * src/pdpa/sweep.ts — Idempotent chunked erasure sweep (QUAL-09 / D-02)
 *
 * `erasureSweep` is the lazy-cron job body registered in src/jobs/runDueJobs.ts
 * under the 'erasure-sweep' entry (windowMs: 1h, DUE-gated by runJob's txn).
 *
 * Purpose: finish pending/sweeping erasureRequests that the synchronous Server
 * Action pass (05-05) could not complete (e.g., batch budget exhausted, transient
 * error). The sweep re-queries each manifest collection for residual docs and
 * deletes them, then marks the request 'complete' once nothing remains.
 *
 * INVARIANTS:
 *   1. Idempotent: re-running is a no-op when nothing remains (deleting a gone
 *      doc is a no-op in Firestore — Pattern 3).
 *   2. Chunked: each call processes only one batch per collection per request
 *      (mirrors loadRecent's bounded read — Pitfall 10 / T-05-MEGADELETE).
 *   3. Resume contract: the ErasureRequestDoc.collectionsRemaining field lists
 *      which collections still have docs. The sweep updates this as it progresses.
 *      NOTE: deletion needs the RAW subject key. Since ErasureRequestDoc stores only
 *      subjectIdHash (never the raw id), the sweep re-queries based on the manifest
 *      key strategy (keyField / docId / keyVia) that the executor used — Firestore
 *      returns 0 docs for an already-erased subject, so this is safe and idempotent.
 *      The rawSubjectId must be passed down from the original Server Action call;
 *      the sweep CANNOT reconstruct it from the hash. See the LIMITATION note below.
 *
 * TRANSIENT RAWSUBJECTID DESIGN (matches D-02 / CR-01 resolution):
 *   The TypeScript ErasureRequestDoc interface (collections.ts) does NOT include
 *   rawSubjectId — it is a server-only field not surfaced to clients.  In practice:
 *
 *   - The Server Action (actions.ts) writes rawSubjectId onto the initial 'pending'
 *     doc so the sweep can re-query Firestore for this subject.
 *   - The sweep reads rawSubjectId from the raw Firestore data (not the typed shape).
 *   - When the request reaches 'complete' — EITHER in the Server Action OR here in
 *     the sweep — rawSubjectId is CLEARED via FieldValue.delete().  A completed
 *     request never retains the raw subject id.
 *   - 'failed' and in-progress 'sweeping' requests retain rawSubjectId (still needed
 *     for retry or continued sweep passes).
 *   - Firestore rules deny all client reads on erasureRequests (admin-only read via
 *     Admin SDK).  rawSubjectId is never returned to clients by any action.
 *   - v2 hardening option: encrypt rawSubjectId at rest with a Secret-Manager key.
 *
 *   If rawSubjectId is absent on a pending/sweeping request (e.g. older requests
 *   created before this design), the sweep marks the request 'failed'.
 *
 * Framework-free: no app/ imports. Admin SDK + collections.ts + erasure.ts only.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { erasureRequestsRef } from '@/src/firebase/collections'
import { eraseDataSubject } from '@/src/pdpa/erasure'
import type { ErasureRequestDoc } from '@/src/firebase/collections'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * erasureSweep — finish all pending/sweeping erasureRequests in bounded batches.
 *
 * Called by the 'erasure-sweep' lazy-cron job (windowMs: 1h). The runJob txn
 * DUE-gate (runDueJobs.ts:229-265) gives exactly-once-per-window semantics for free
 * under concurrency — even if two visitors both trigger the sweep, only one wins
 * the transaction and runs the body (Pitfall 3 / T-05-DOUBLESWEEP).
 *
 * The sweep is safe to run concurrently: even if two concurrent sweeps process the
 * same request, they are both idempotent (deleting a gone doc is a no-op). The
 * 'complete' transition is idempotent too (writing 'complete' twice is harmless).
 *
 * @returns Promise<void> — always resolves (errors are caught per-request)
 */
export async function erasureSweep(): Promise<void> {
  // Query all requests that still need work (pending = never processed, sweeping = partial)
  // Pattern: mirrors the erasure test expectation (status in ['pending', 'sweeping'])
  const snap = await erasureRequestsRef()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where('status' as any, 'in', ['pending', 'sweeping'])
    .get()

  if (snap.empty) {
    // Nothing to sweep — idempotent no-op (Pattern 3 / Pitfall 3)
    return
  }

  for (const doc of snap.docs) {
    const req = doc.data() as ErasureRequestDoc

    try {
      // Resume contract: the raw subject id is needed to re-query Firestore.
      // The request doc was written by the Server Action (05-05) which also stores
      // a rawSubjectId field (server-side only — not in the ErasureRequestDoc
      // TypeScript interface, which is the *client-visible* schema).
      //
      // We read it from the raw Firestore data (doc.data() is the typed shape;
      // the raw Firestore data may have additional server-only fields).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawData = doc.data() as any
      const rawSubjectId: string | undefined = rawData.rawSubjectId

      if (!rawSubjectId) {
        // Missing rawSubjectId — cannot re-query Firestore without the raw id.
        // Mark as failed with an explanatory message (no PII in the error field).
        await doc.ref.update({
          status: 'failed',
          error: 'sweep-cannot-resume: rawSubjectId not stored on request doc',
        })
        continue
      }

      // Re-run the erasure batch for this subject (bounded — BATCH_SIZE per collection).
      // Idempotent: if the subject was already fully erased, all collections return
      // 0 docs and the result is { complete: true, collectionsHit: [...], collectionsRemaining: [] }.
      const result = await eraseDataSubject({
        subjectType: req.subjectType,
        id: rawSubjectId,
        actorUid: 'erasure-sweep', // system actor — the sweep job
        reqId: doc.id,
      })

      if (result.complete) {
        // All collections cleared — mark the request complete with a timestamp.
        // completedAt is the <72h SLA marker (D-02).
        // CR-01 fix: also CLEAR rawSubjectId so the raw subject id is not retained
        // beyond the erasure lifecycle.  FieldValue.delete() removes the field from
        // the doc — a completed request no longer needs it for sweep re-queries.
        await doc.ref.update({
          status: 'complete',
          collectionsRemaining: [],
          completedAt: FieldValue.serverTimestamp(),
          rawSubjectId: FieldValue.delete(),
        })
      } else {
        // Some collections still have docs — keep sweeping in the next window.
        // Update collectionsRemaining so the sweep can resume accurately.
        await doc.ref.update({
          status: 'sweeping',
          collectionsRemaining: result.collectionsRemaining,
        })
      }
    } catch (err) {
      // Unexpected error — mark this request as failed, continue to next.
      // Error message must NOT contain PII (collection names + error class only).
      const message = err instanceof Error ? err.message : String(err)
      try {
        await doc.ref.update({
          status: 'failed',
          error: message.slice(0, 500), // truncate to prevent doc-size issues
        })
      } catch {
        // Best-effort: if we can't even mark it failed, log and move on.
        console.error(`[erasureSweep] failed to mark request ${doc.id} as failed: ${message}`)
      }
    }
  }
}
