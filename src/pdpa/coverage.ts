/**
 * src/pdpa/coverage.ts — PII Erasure Manifest
 *
 * SINGLE SOURCE OF TRUTH for PDPA data-subject erasure coverage (QUAL-09 / SC1).
 *
 * This file is consumed by THREE distinct consumers — all must stay in sync:
 *   1. src/pdpa/erasure.ts   — the destructive executor (eraseDataSubject)
 *   2. src/pdpa/sweep.ts     — the idempotent chunked completer (erasureSweep)
 *   3. src/pdpa/coverage.test.ts — the QUAL-09 coverage proof test
 *
 * DO NOT hard-code collection names anywhere else. If a new PII-bearing collection
 * is added to collections.ts, it MUST also be added to PII_ERASURE_MANIFEST here
 * before shipping — the coverage test will fail otherwise (Pitfall 1 guard).
 *
 * Key fields verified against src/firebase/collections.ts (2026-06-07):
 *   conversations.ownerUid  — ConversationDoc (:80)
 *   conversations.leadId    — ConversationDoc (:84)
 *   leads.ownerUid          — LeadDoc (:111)
 *   replyEdits.agentUid     — ReplyEditDoc (:461)
 *   replyEdits.leadId       — ReplyEditDoc (:449)
 *   escalations.agentUid    — EscalationDoc (:346)
 *   knowledgeGaps.agentUid  — KnowledgeGapDoc (:389)
 *   agentProfiles/{uid}     — docId = uid (:551)
 *   rateBudgets/{uid}       — docId = uid (:641 ref)
 *   users/{uid}             — docId = uid (:546)
 *   leadContext/{leadId}    — docId = leadId (:583)
 *   leads/{leadId}          — docId = leadId (:578)
 *
 * Framework-free: this module uses no app/ imports (core/shell split: src/ never
 * imports from app/). Admin SDK types only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subject types supported for erasure.
 *   'agent' — a D2 agent identified by their Firebase Auth uid
 *   'lead'  — a lead identified by their leadId
 */
export type EraseSubjectType = 'lead' | 'agent'

/**
 * A single entry in the PII erasure manifest, describing how to find and delete
 * all documents in a collection that belong to a given subject.
 *
 * Exactly one of keyField, docId, keyVia, or prefix must be set (discriminated union).
 */
export type ManifestEntry =
  | {
      /** Collection name (top-level Firestore collection). */
      collection: string
      /**
       * The field on documents in this collection that stores the subject's id.
       * All documents where keyField == subjectId are deleted.
       * Used for conversations (with recursive:true), leads, replyEdits, escalations, knowledgeGaps.
       */
      keyField: string
      /**
       * If true, use recursiveDelete (deletes the doc AND all descendant subcollections).
       * Required for conversations/{cid} which has a messages subcollection (Pitfall 2 / Pattern 3).
       */
      recursive?: boolean
      docId?: never
      keyVia?: never
      prefix?: never
    }
  | {
      collection: string
      /**
       * If true, the subject id IS the document id (e.g. agentProfiles/{uid}, users/{uid}).
       * Delete the single doc at collection/{subjectId}.
       */
      docId: true
      keyField?: never
      recursive?: never
      keyVia?: never
      prefix?: never
    }
  | {
      collection: string
      /**
       * Indirect key: resolve the subject id via a related collection first.
       * Used for leadContext on agent erasure — leadContext is keyed by leadId, not ownerUid,
       * so we must first find the agent's lead ids, then delete those leadContext/{leadId} docs.
       * Format: 'sourceCollection.sourceField' where sourceField == subject id.
       */
      keyVia: string
      recursive?: boolean
      keyField?: never
      docId?: never
      prefix?: never
    }
  | {
      collection: 'STORAGE'
      /**
       * Cloud Storage prefix for per-subject objects.
       * Placeholder for future per-agent voice/media storage.
       *
       * NOTE (A1): Per-agent voice samples are stored as Firestore strings
       * (users.voiceSamples[]) today, NOT as Storage objects at pilot time.
       * This entry is a near-no-op — wire the actual deleteFiles() call before
       * sign-off if voice moves to Storage. Confirm with Derek.
       */
      prefix: string
      keyField?: never
      docId?: never
      keyVia?: never
      recursive?: never
    }

// ─── Manifest ─────────────────────────────────────────────────────────────────

/**
 * PII_ERASURE_MANIFEST — the declarative registry of every PII-bearing collection.
 *
 * All entries are verified against the actual schema fields in collections.ts
 * (see file:line references in the module docblock above).
 *
 * ADDING A NEW COLLECTION: add it here before shipping, then update the coverage
 * test. Failure to do so = residual PII = PDPA breach (Pitfall 1).
 */
export const PII_ERASURE_MANIFEST = {
  /**
   * Subject type: 'agent' — identified by Firebase Auth uid.
   * Covers all Firestore (and Cloud Storage) locations that store an agent's PII.
   */
  agent: [
    /**
     * conversations/{cid} — each conversation keyed by ownerUid.
     * recursive:true because conversations have a messages/{mid} subcollection
     * that must also be deleted (RESEARCH Pattern 3 — use recursiveDelete, Don't Hand-Roll).
     * keyField verified: ConversationDoc.ownerUid (collections.ts:80)
     */
    { collection: 'conversations', keyField: 'ownerUid', recursive: true },
    /**
     * leads/{leadId} — each lead record keyed by ownerUid (the agent who owns the lead).
     * keyField verified: LeadDoc.ownerUid (collections.ts:111)
     */
    { collection: 'leads', keyField: 'ownerUid' },
    /**
     * leadContext/{leadId} — keyed by leadId, NOT by ownerUid.
     * Agent erasure must first resolve the agent's leads (leads.ownerUid == uid),
     * then delete those leadContext/{leadId} docs.
     * keyVia format: 'sourceCollection.sourceField' — see erasure.ts for the two-step logic.
     */
    { collection: 'leadContext', keyVia: 'leads.ownerUid', recursive: false },
    /**
     * replyEdits/{eventId} — edit-as-signal events keyed by agentUid.
     * keyField verified: ReplyEditDoc.agentUid (collections.ts:461)
     */
    { collection: 'replyEdits', keyField: 'agentUid' },
    /**
     * escalations/{eid} — escalation rows keyed by agentUid.
     * keyField verified: EscalationDoc.agentUid (collections.ts:346)
     * NOTE (A3): No lead-keyed escalations exist today. If added, lead erasure would need updating.
     */
    { collection: 'escalations', keyField: 'agentUid' },
    /**
     * knowledgeGaps/{gapId} — knowledge-gap signals keyed by agentUid.
     * keyField verified: KnowledgeGapDoc.agentUid (collections.ts:389)
     */
    { collection: 'knowledgeGaps', keyField: 'agentUid' },
    /**
     * agentProfiles/{uid} — profile doc with docId == uid.
     * docId verified: agentProfilesRef() at collections.ts:551 (collection 'agentProfiles')
     */
    { collection: 'agentProfiles', docId: true as const },
    /**
     * rateBudgets/{uid} — rate-budget doc with docId == uid.
     * docId verified: rateBudgetsRef() at collections.ts:641 (collection 'rateBudgets')
     */
    { collection: 'rateBudgets', docId: true as const },
    /**
     * users/{uid} — user record with docId == uid.
     * docId verified: usersRef() at collections.ts:546 (collection 'users')
     */
    { collection: 'users', docId: true as const },
    /**
     * STORAGE — per-agent Cloud Storage objects (voice samples prefix).
     *
     * NEAR-NO-OP TODAY (A1): users.voiceSamples[] are Firestore strings, NOT Storage
     * objects at pilot time. Wire the actual bucket().deleteFiles({ prefix }) call
     * in erasure.ts before sign-off if voice moves to Storage. Confirm with Derek.
     */
    { collection: 'STORAGE', prefix: 'voice/{uid}/' },
  ] as ManifestEntry[],

  /**
   * Subject type: 'lead' — identified by leadId.
   * Covers all Firestore locations that store a lead's PII.
   */
  lead: [
    /**
     * conversations/{cid} — Finder/Reply conversations keyed by leadId.
     * One lead == one Finder/Reply conversation (RESEARCH Open Question 2).
     * recursive:true because conversations have a messages/{mid} subcollection.
     * keyField verified: ConversationDoc.leadId (collections.ts:84)
     */
    { collection: 'conversations', keyField: 'leadId', recursive: true },
    /**
     * leadContext/{leadId} — lead context doc with docId == leadId.
     * docId verified: leadContextRef() at collections.ts:583 (collection 'leadContext')
     */
    { collection: 'leadContext', docId: true as const },
    /**
     * leads/{leadId} — lead record with docId == leadId.
     * docId verified: leadsRef() at collections.ts:578 (collection 'leads')
     */
    { collection: 'leads', docId: true as const },
    /**
     * replyEdits/{eventId} — edit events keyed by leadId.
     * keyField verified: ReplyEditDoc.leadId (collections.ts:449)
     */
    { collection: 'replyEdits', keyField: 'leadId' },
  ] as ManifestEntry[],

  /**
   * EXEMPT — collections that are NEVER deleted by the erasure cascade.
   *
   * auditLogs is hashes-only — the legal record that erasure occurred — and MUST
   * survive as the compliance artifact (D-01, QUAL-09 / SC1 gate, Pitfall 2).
   *
   * CRITICAL: auditLogs.actorUid === the agent's uid, so a naive "delete where
   * actorUid == uid" WOULD match audit rows. The EXEMPT list + the executor's
   * skip-by-construction guard (not Firestore rules — Admin SDK bypasses rules)
   * is the ONLY protection. Do not remove auditLogs from this list.
   */
  EXEMPT: ['auditLogs'] as const,
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * manifestCollections — list all collection names for a subject type.
 *
 * Used to seed collectionsRemaining on the ErasureRequestDoc when a request is
 * created (the ledger that the sweep uses to resume idempotently).
 *
 * STORAGE is intentionally included so the sweep ledger is complete;
 * the erasure.ts executor handles it as a no-op today (A1).
 *
 * @param subjectType 'agent' | 'lead'
 * @returns Array of collection name strings
 */
export function manifestCollections(subjectType: EraseSubjectType): string[] {
  return PII_ERASURE_MANIFEST[subjectType].map((entry) => entry.collection)
}
