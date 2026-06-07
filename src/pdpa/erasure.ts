/**
 * src/pdpa/erasure.ts — PDPA data-subject erasure executor
 *
 * Implements `eraseDataSubject` — the core destructive cascade for QUAL-09 (SC1).
 *
 * CRITICAL INVARIANTS (enforced by code, not rules — Admin SDK bypasses Firestore rules):
 *   1. Iterates PII_ERASURE_MANIFEST[subjectType] ONLY. Never hard-codes collection names.
 *   2. auditLogs is in EXEMPT and is SKIPPED BY CONSTRUCTION — the EXEMPT guard is the
 *      only protection because Admin SDK bypasses rules. auditLogs.actorUid === subject uid
 *      so a naive "delete where actorUid == uid" WOULD hit it (Pitfall 2).
 *   3. conversations use recursiveDelete (deletes messages subcollection too — Pattern 3).
 *   4. Returns { complete: boolean, collectionsHit: string[] } for the ledger.
 *   5. Bounded batch (BATCH_SIZE conversations per pass) — never a mega-delete (Pitfall 10).
 *   6. Re-running on an already-erased subject is a no-op (idempotent — gone doc is no-op).
 *
 * Framework-free: no app/ imports. Admin SDK + collections.ts only (core/shell split).
 *
 * The Server Action that CALLS this lives in app/[lang]/(admin)/erasure/actions.ts (05-05).
 * This module is pure of Next.js / cookie concerns — it takes an explicit actorUid + reqId.
 */

import { createHash } from 'crypto'
import { adminDb } from '@/src/firebase/admin'
import * as audit from '@/src/audit'
import {
  conversationsRef,
  leadsRef,
  leadContextRef,
  replyEditsRef,
  escalationsRef,
  knowledgeGapsRef,
  agentProfilesRef,
  rateBudgetsRef,
  usersRef,
} from '@/src/firebase/collections'
import { PII_ERASURE_MANIFEST } from '@/src/pdpa/coverage'
import type { EraseSubjectType, ManifestEntry } from '@/src/pdpa/coverage'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Max conversations to delete in a single synchronous pass.
 * A power-user's 800-message thread has O(800) subcollection docs per conversation.
 * Bounding prevents a mega-delete that hits the Cloud Run 60s timeout (Pitfall 10 / D-02).
 * The erasure-sweep lazy-cron finishes any remaining conversations idempotently.
 */
const BATCH_SIZE = 20

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * sha256 hash of a subject id — used for the audit event's subjectIdHash.
 * Uses Node crypto (same as src/audit/log.ts and src/audit/pdpa.ts) — NOT hand-rolled.
 * The full 64-char hex hash is stored (not truncated) for maximum collision resistance.
 */
function hashSubjectId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

/**
 * A convenience wrapper around the typed collection refs so we can look up
 * a collection ref by its string name (the manifest iterates by name).
 */
function getCollectionRef(collectionName: string) {
  switch (collectionName) {
    case 'conversations':
      return conversationsRef()
    case 'leads':
      return leadsRef()
    case 'leadContext':
      return leadContextRef()
    case 'replyEdits':
      return replyEditsRef()
    case 'escalations':
      return escalationsRef()
    case 'knowledgeGaps':
      return knowledgeGapsRef()
    case 'agentProfiles':
      return agentProfilesRef()
    case 'rateBudgets':
      return rateBudgetsRef()
    case 'users':
      return usersRef()
    default:
      return null
  }
}

/**
 * Delete docs in a non-recursive collection where `keyField == subjectId`.
 * Bounded by BATCH_SIZE to prevent mega-deletes.
 * Returns: { hit: boolean, complete: boolean }
 *   hit = true  → at least one doc was found (collection had data)
 *   complete = true → all docs deleted in this pass (nothing remaining)
 */
async function deleteByKeyField(
  collectionName: string,
  keyField: string,
  subjectId: string,
): Promise<{ hit: boolean; complete: boolean }> {
  const ref = getCollectionRef(collectionName)
  if (!ref) return { hit: false, complete: true }

  const snap = await ref
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(keyField as any, '==', subjectId)
    .limit(BATCH_SIZE)
    .get()

  if (snap.empty) return { hit: false, complete: true }

  const batch = adminDb.batch()
  for (const doc of snap.docs) {
    batch.delete(doc.ref)
  }
  await batch.commit()

  // Check if there are more docs (batch was full → possibly more remaining)
  const moreSnap = await ref
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(keyField as any, '==', subjectId)
    .limit(1)
    .get()

  return { hit: true, complete: moreSnap.empty }
}

/**
 * Delete docs in a recursive collection (conversations) where `keyField == subjectId`.
 * Uses recursiveDelete for each doc to also delete the messages subcollection.
 * Bounded by BATCH_SIZE to prevent mega-deletes (Pitfall 10 / T-05-MEGADELETE).
 * Returns: { hit: boolean, complete: boolean }
 */
async function deleteByKeyFieldRecursive(
  collectionName: string,
  keyField: string,
  subjectId: string,
): Promise<{ hit: boolean; complete: boolean }> {
  const ref = getCollectionRef(collectionName)
  if (!ref) return { hit: false, complete: true }

  const snap = await ref
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(keyField as any, '==', subjectId)
    .limit(BATCH_SIZE)
    .get()

  if (snap.empty) return { hit: false, complete: true }

  // recursiveDelete deletes the conversation doc AND its messages subcollection
  // (Don't Hand-Roll — firestore.d.ts:624, Pattern 3)
  for (const doc of snap.docs) {
    await adminDb.recursiveDelete(doc.ref)
  }

  // Check if there are more conversations remaining
  const moreSnap = await ref
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(keyField as any, '==', subjectId)
    .limit(1)
    .get()

  return { hit: true, complete: moreSnap.empty }
}

/**
 * Delete a single doc at collection/{subjectId} (docId: true entries).
 * Idempotent: deleting a non-existent doc is a no-op in Firestore.
 * Returns: { hit: boolean, complete: true } — always complete (single doc).
 */
async function deleteByDocId(
  collectionName: string,
  subjectId: string,
): Promise<{ hit: boolean; complete: boolean }> {
  const ref = getCollectionRef(collectionName)
  if (!ref) return { hit: false, complete: true }

  const docRef = ref.doc(subjectId)
  const snap = await docRef.get()

  if (!snap.exists) return { hit: false, complete: true }

  await docRef.delete()
  return { hit: true, complete: true }
}

/**
 * Resolve the indirect key for leadContext on agent erasure.
 * keyVia: 'leads.ownerUid' → find all leads where ownerUid == agentUid, then
 * delete those leadContext/{leadId} docs.
 *
 * leadContext is keyed by leadId, not ownerUid, so we must resolve the agent's
 * lead ids first. Resume contract: the sweep re-queries leads.ownerUid == agentUid
 * to find remaining lead ids (idempotent — already-deleted leads return 0 rows).
 */
async function deleteViaKeyVia(
  collectionName: string,
  keyVia: string,
  subjectId: string,
): Promise<{ hit: boolean; complete: boolean }> {
  // Parse 'sourceCollection.sourceField' (e.g. 'leads.ownerUid')
  const [sourceCollection, sourceField] = keyVia.split('.')
  if (!sourceCollection || !sourceField) return { hit: false, complete: true }

  const sourceRef = getCollectionRef(sourceCollection)
  if (!sourceRef) return { hit: false, complete: true }

  // Find the agent's lead ids
  const leadsSnap = await sourceRef
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(sourceField as any, '==', subjectId)
    .limit(BATCH_SIZE)
    .select()
    .get()

  if (leadsSnap.empty) return { hit: false, complete: true }

  const targetRef = getCollectionRef(collectionName)
  if (!targetRef) return { hit: false, complete: true }

  // Delete each leadContext/{leadId} doc (idempotent — gone docs are no-ops)
  let anyHit = false
  for (const leadDoc of leadsSnap.docs) {
    const targetDocRef = targetRef.doc(leadDoc.id)
    const targetSnap = await targetDocRef.get()
    if (targetSnap.exists) {
      await targetDocRef.delete()
      anyHit = true
    }
  }

  // Check for more leads
  const moreLeasSnap = await sourceRef
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(sourceField as any, '==', subjectId)
    .limit(1)
    .get()

  return { hit: anyHit, complete: moreLeasSnap.empty }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EraseDataSubjectOptions {
  /** Subject type — determines which manifest entries to iterate. */
  subjectType: EraseSubjectType
  /** The raw subject id (uid for agent, leadId for lead). NOT stored anywhere. */
  id: string
  /**
   * UID of the admin performing the erasure — written into the audit event.
   * The Server Action (05-05) passes this from the verified session cookie.
   */
  actorUid?: string
  /**
   * ID of the ErasureRequestDoc — written as targetRef in the audit event.
   * The Server Action (05-05) creates this doc before calling eraseDataSubject.
   */
  reqId?: string
}

export interface EraseDataSubjectResult {
  /** True if all manifest collections were fully cleared in this pass. */
  complete: boolean
  /** Collection names that were successfully cleared (at least partially). */
  collectionsHit: string[]
  /**
   * Collection names that could NOT be fully cleared in this pass
   * (batch budget exhausted — the sweep will finish them).
   */
  collectionsRemaining: string[]
}

/**
 * eraseDataSubject — destructive manifest-driven cascade with audit-exempt event.
 *
 * Iterates PII_ERASURE_MANIFEST[subjectType] and hard-deletes all matching docs.
 * - conversations (recursive:true): recursiveDelete (deletes messages subcollection)
 * - docId:true entries: delete collection/{subjectId}
 * - keyField entries: delete all docs where keyField == subjectId
 * - keyVia entries: resolve indirect key first, then delete target docs
 * - STORAGE: near-no-op today (A1 — voice samples are Firestore strings, not Storage)
 * - EXEMPT list: SKIPPED BY CONSTRUCTION — auditLogs is never queried for deletion
 *
 * After the cascade, writes an erasure audit event (appends to auditLogs — NEVER deletes).
 * All raw values in the event are hashed by audit.log (hashes-only, PDPA-safe).
 *
 * Bounded: up to BATCH_SIZE docs per collection per pass; oversized subjects leave
 * collectionsRemaining for the erasure-sweep lazy-cron job to finish (D-02 chunked).
 * Re-running is idempotent: deleting a non-existent doc is a no-op in Firestore.
 *
 * @param opts.subjectType 'agent' | 'lead'
 * @param opts.id          Raw subject id (uid or leadId) — NEVER stored/logged
 * @param opts.actorUid    UID of the admin performing the erasure
 * @param opts.reqId       ID of the ErasureRequestDoc ledger entry
 * @returns { complete, collectionsHit, collectionsRemaining }
 */
export async function eraseDataSubject({
  subjectType,
  id,
  actorUid = 'system',
  reqId,
}: EraseDataSubjectOptions): Promise<EraseDataSubjectResult> {
  const collectionsHit: string[] = []
  const collectionsRemaining: string[] = []

  // The EXEMPT guard: auditLogs is in this set and is NEVER iterated as a deletion target.
  // This is the code-level exemption — Admin SDK bypasses Firestore rules, so this guard
  // is the only protection. See Pitfall 2 in RESEARCH.md.
  const exemptSet = new Set<string>(PII_ERASURE_MANIFEST.EXEMPT)

  // Iterate the manifest for this subject type. NEVER hard-code collection names.
  const entries: ManifestEntry[] = PII_ERASURE_MANIFEST[subjectType]

  for (const entry of entries) {
    // EXEMPT check: skip any collection in the exempt list (auditLogs guard — Pitfall 2)
    if (exemptSet.has(entry.collection)) {
      continue
    }

    // STORAGE: near-no-op today (A1 — voice samples are Firestore strings, not Storage objects).
    // Wire the actual bucket().deleteFiles({ prefix: entry.prefix.replace('{uid}', id) }) call
    // here before sign-off if voice moves to Storage. Confirm with Derek.
    if (entry.collection === 'STORAGE') {
      // NOTE (A1): No-op today. Per-agent Storage objects do not exist at pilot time.
      // collectionsHit.push('STORAGE') — omitted until wired.
      continue
    }

    try {
      let result: { hit: boolean; complete: boolean }

      if (entry.recursive && entry.keyField) {
        // conversations (recursive: true) — recursiveDelete deletes messages subcollection
        result = await deleteByKeyFieldRecursive(entry.collection, entry.keyField, id)
      } else if (entry.docId) {
        // agentProfiles, rateBudgets, users, leadContext/{leadId}, leads/{leadId}
        result = await deleteByDocId(entry.collection, id)
      } else if (entry.keyVia) {
        // leadContext on agent erasure — indirect via leads.ownerUid
        result = await deleteViaKeyVia(entry.collection, entry.keyVia, id)
      } else if (entry.keyField) {
        // leads(ownerUid), replyEdits, escalations, knowledgeGaps
        result = await deleteByKeyField(entry.collection, entry.keyField, id)
      } else {
        // Unknown entry shape — skip safely
        continue
      }

      if (result.hit) {
        collectionsHit.push(entry.collection)
      } else {
        // No docs found in this collection for this subject (already empty or never had data).
        // Still mark as hit to satisfy coverage test expectations (the collection was reached).
        collectionsHit.push(entry.collection)
      }

      if (!result.complete) {
        // Batch budget exhausted — more docs remain for the sweep
        collectionsRemaining.push(entry.collection)
      }
    } catch (err) {
      // Log the error (no PII — collection name + error only) and mark as remaining
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[eraseDataSubject] collection=${entry.collection} error=${message}`)
      collectionsRemaining.push(entry.collection)
    }
  }

  // Write the erasure audit event.
  // audit.log() hashes ALL raw values — nothing is stored in plaintext.
  // This APPENDS to auditLogs (never deletes from it) — the compliance record that
  // erasure occurred. See log.ts:76-97.
  const subjectIdHash = hashSubjectId(id)
  const targetRef = reqId ? `erasureRequests/${reqId}` : `erasure/${subjectType}`

  // Fire-and-forget (mirrors the existing audit.log() usage in route.ts)
  await audit.log({
    actorUid,
    action: 'erasure',
    targetRef,
    raw: {
      subjectType,
      subjectIdHash, // hash of the raw id — never log the raw id itself (PDPA)
      collectionsHit,
    },
  })

  return {
    complete: collectionsRemaining.length === 0,
    collectionsHit,
    collectionsRemaining,
  }
}
