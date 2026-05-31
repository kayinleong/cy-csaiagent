/**
 * Firestore typed collection refs — SINGLE SOURCE OF TRUTH.
 *
 * Every Firestore collection used by the platform is declared exactly once
 * here. Each collection ref uses a FirestoreDataConverter that stamps
 * `tenantId: TENANT_ID` on every document write — no caller can write
 * without the tenant field (TSD §4, CLAUDE.md tenantId mandate).
 *
 * Collections (TSD §4 — 14 collections + rateBudgets):
 *   1.  users/{uid}
 *   2.  agentProfiles/{uid}
 *   3.  conversations/{cid}
 *   4.  conversations/{cid}/messages/{mid}   ← subcollection (never inline array)
 *   5.  leads/{leadId}
 *   6.  leadContext/{leadId}
 *   7.  projects/{pid}
 *   8.  collateral/{coid}
 *   9.  kbDocs/{docId}
 *   10. kbChunks/{chunkId}
 *   11. kbIngestionJobs/{jobId}
 *   12. escalations/{eid}
 *   13. auditLogs/{alid}
 *   14. evals/{runId}
 *   15. rateBudgets/{uid}  ← de-facto 15th (TSD §9 ratelimit; ruled + consumed by 01-07)
 *
 * Import pattern (always use the @/ alias):
 *   import { usersRef, rateBudgetsRef } from '@/src/firebase/collections'
 *
 * IMPORTANT: This file uses adminDb (server-side only). Do NOT import this
 * file from client components — use the clientDb from '@/src/firebase/client'
 * with collection() directly for client-side reads.
 */

import {
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type FieldValue,
  type WithFieldValue,
} from 'firebase-admin/firestore'
import { adminDb } from '@/src/firebase/admin'

// ─── Tenant constant ────────────────────────────────────────────────────────

/**
 * The single-tenant identifier.
 * Every document write stamps this value — see each converter's toFirestore().
 * Changing tenants in future requires only updating this constant + rules.
 */
export const TENANT_ID = 'd2' as const
export type TenantId = typeof TENANT_ID

// ─── Document types ─────────────────────────────────────────────────────────

export interface UserDoc {
  tenantId: TenantId
  role: 'new-agent' | 'senior-coach' | 'admin'
  /** ID of this agent's senior coach (new-agent only) */
  uplineCoachId?: string
  /** User's preferred language for responses */
  lang: 'en' | 'ms' | 'zh'
  /** Reserved in Phase 1; populated in Phase 2 onboarding (D-10) */
  voiceSamples: string[]
}

export interface AgentProfileDoc {
  tenantId: TenantId
  journeyStage: string
  currentCheckpoint: string
  lastActiveAt: Date | FieldValue
  activeLeadIds: string[]
  /** UID of the senior coach managing this agent */
  seniorCoachId: string
}

export interface ConversationDoc {
  tenantId: TenantId
  ownerUid: string
  pillar: 'coach' | 'finder' | 'reply'
  /** Associated lead ID — present for Finder and Reply pillars */
  leadId?: string
  lang: 'en' | 'ms' | 'zh'
  createdAt: Date | FieldValue
  /** Rolling summary updated by memory module */
  summary: string
}

/**
 * Messages live in a SUBCOLLECTION: conversations/{cid}/messages/{mid}
 * Never an inline array (1 MB doc-size trap, TSD §4).
 */
export interface MessageDoc {
  tenantId: TenantId
  role: 'user' | 'assistant' | 'system'
  content: string
  /** KB chunk IDs cited (grounding mandate — answers must cite source IDs) */
  citations: string[]
  /** Which pillar/agent handled this turn */
  routeDecision: string
  /** Token count for this message turn */
  tokens: number
  /** true if PDPA pseudonymization was applied before sending to the model */
  redacted: boolean
}

export interface LeadDoc {
  tenantId: TenantId
  ownerUid: string
  /** Lead name pseudonymized at the Claude boundary (e.g. <LEAD_ID:...>) */
  name: string
  phoneHash: string
  consentFlag: boolean
  nationality: string
  segment: string
}

export interface LeadContextDoc {
  tenantId: TenantId
  /** Coach agent's write slot — other agents must not overwrite this */
  coachSlot: Record<string, unknown>
  /** Finder agent's write slot */
  finderSlot: Record<string, unknown>
  /** Reply agent's write slot */
  replySlot: Record<string, unknown>
  /** Rolling summary shared across all pillars */
  rollingSummary: string
  updatedAt: Date | FieldValue
}

export interface ProjectDoc {
  tenantId: TenantId
  name: string
  status: 'active' | 'sold_out' | 'hidden'
  priceBand: string
  tenure: string
  vpStatus: boolean
  bumiQuota: boolean
  foreignEligible: boolean
  /** 1024-d normalized vector (Voyage voyage-3-large) */
  embedding: number[]
}

export interface CollateralDoc {
  tenantId: TenantId
  projectId: string
  type: string
  storagePath: string
  lang: 'en' | 'ms' | 'zh'
}

export interface KbDocDoc {
  tenantId: TenantId
  title: string
  sourcePath: string
  version: number
  /** ID of the KB doc this supersedes (versioning) */
  supersedesId?: string
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'
  publishedAt: Date | FieldValue
}

export interface KbChunkDoc {
  tenantId: TenantId
  docId: string
  text: string
  lang: 'en' | 'ms' | 'zh'
  /** Collection this chunk belongs to (for pre-filter in findNearest) */
  ownerCollection: string
  /** 1024-d normalized vector (Voyage voyage-3-large, DOT_PRODUCT) */
  embedding: number[]
  tokens: number
}

export interface KbIngestionJobDoc {
  tenantId: TenantId
  fileHash: string
  total: number
  remaining: number
  status: 'pending' | 'processing' | 'complete' | 'error'
}

export interface EscalationDoc {
  tenantId: TenantId
  agentUid: string
  seniorCoachId: string
  reason: string
  contextBundle: Record<string, unknown>
  status: 'open' | 'resolved' | 'escalated'
  openedAt: Date | FieldValue
}

export interface AuditLogDoc {
  tenantId: TenantId
  actorUid: string
  action: string
  targetRef: string
  /** Hashes of any PII-bearing fields — NEVER raw PII (TSD §5.3) */
  hashes: Record<string, string>
  ts: Date | FieldValue
}

export interface EvalDoc {
  tenantId: TenantId
  suite: string
  lang: 'en' | 'ms' | 'zh'
  score: number
  judgeModel: string
  failures: string[]
}

/**
 * Per-agent rate-budget document (de-facto 15th collection, TSD §9).
 *
 * Owner-scoped: an agent reads/writes only `rateBudgets/{own-uid}`.
 * Cross-agent access is denied by Firestore rules (T-01-10).
 * Consumed by 01-07 ratelimit module — declared here as the single
 * source of truth so 01-07 builds against a real, ruled collection.
 */
export interface RateBudgetDoc {
  tenantId: TenantId
  ownerUid: string
  requestCount: number
  tokenCount: number
  windowStart: Date | FieldValue
}

// ─── Converter factory ───────────────────────────────────────────────────────

/**
 * Build a typed FirestoreDataConverter that stamps tenantId on every write.
 *
 * toFirestore: merges the caller's data with `{ tenantId: TENANT_ID }` so no
 * write ever escapes without the tenant field.
 *
 * fromFirestore: casts the raw Firestore document back to the TypeScript shape.
 * The cast is safe because writes go through toFirestore (type-checked) first.
 *
 * Admin SDK fromFirestore signature takes only a QueryDocumentSnapshot (no
 * SnapshotOptions — that is a web SDK concept).
 */
function makeConverter<T extends { tenantId: TenantId }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): WithFieldValue<DocumentData> {
      return {
        ...(data as DocumentData),
        tenantId: TENANT_ID, // stamp — no caller can omit this
      }
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return snapshot.data() as T
    },
  }
}

// ─── Per-collection converters ───────────────────────────────────────────────

export const userConverter = makeConverter<UserDoc>()
export const agentProfileConverter = makeConverter<AgentProfileDoc>()
export const conversationConverter = makeConverter<ConversationDoc>()
export const messageConverter = makeConverter<MessageDoc>()
export const leadConverter = makeConverter<LeadDoc>()
export const leadContextConverter = makeConverter<LeadContextDoc>()
export const projectConverter = makeConverter<ProjectDoc>()
export const collateralConverter = makeConverter<CollateralDoc>()
export const kbDocConverter = makeConverter<KbDocDoc>()
export const kbChunkConverter = makeConverter<KbChunkDoc>()
export const kbIngestionJobConverter = makeConverter<KbIngestionJobDoc>()
export const escalationConverter = makeConverter<EscalationDoc>()
export const auditLogConverter = makeConverter<AuditLogDoc>()
export const evalConverter = makeConverter<EvalDoc>()
export const rateBudgetConverter = makeConverter<RateBudgetDoc>()

// ─── Ref factories ───────────────────────────────────────────────────────────
// Export one named factory per collection.
// Callers use these — never string literals — to access collections.
// adminDb.collection() is the Admin SDK instance method (not a module-level
// function like the web SDK) — this is the correct pattern for firebase-admin.

/** Collection 1: users/{uid} */
export function usersRef(): CollectionReference<UserDoc> {
  return adminDb.collection('users').withConverter(userConverter)
}

/** Collection 2: agentProfiles/{uid} */
export function agentProfilesRef(): CollectionReference<AgentProfileDoc> {
  return adminDb.collection('agentProfiles').withConverter(agentProfileConverter)
}

/** Collection 3: conversations/{cid} */
export function conversationsRef(): CollectionReference<ConversationDoc> {
  return adminDb.collection('conversations').withConverter(conversationConverter)
}

/**
 * Collection 4: conversations/{cid}/messages/{mid}
 *
 * SUBCOLLECTION — intentionally NOT an inline array on the conversation doc.
 * An inline messages array would hit the 1 MB Firestore doc-size limit
 * in long conversations (TSD §4 trap note).
 *
 * @param cid The parent conversation document ID.
 */
export function messagesRef(cid: string): CollectionReference<MessageDoc> {
  return adminDb
    .collection('conversations')
    .doc(cid)
    .collection('messages')
    .withConverter(messageConverter)
}

/** Collection 5: leads/{leadId} */
export function leadsRef(): CollectionReference<LeadDoc> {
  return adminDb.collection('leads').withConverter(leadConverter)
}

/** Collection 6: leadContext/{leadId} */
export function leadContextRef(): CollectionReference<LeadContextDoc> {
  return adminDb.collection('leadContext').withConverter(leadContextConverter)
}

/** Collection 7: projects/{pid} */
export function projectsRef(): CollectionReference<ProjectDoc> {
  return adminDb.collection('projects').withConverter(projectConverter)
}

/** Collection 8: collateral/{coid} */
export function collateralRef(): CollectionReference<CollateralDoc> {
  return adminDb.collection('collateral').withConverter(collateralConverter)
}

/** Collection 9: kbDocs/{docId} */
export function kbDocsRef(): CollectionReference<KbDocDoc> {
  return adminDb.collection('kbDocs').withConverter(kbDocConverter)
}

/** Collection 10: kbChunks/{chunkId} */
export function kbChunksRef(): CollectionReference<KbChunkDoc> {
  return adminDb.collection('kbChunks').withConverter(kbChunkConverter)
}

/** Collection 11: kbIngestionJobs/{jobId} */
export function kbIngestionJobsRef(): CollectionReference<KbIngestionJobDoc> {
  return adminDb.collection('kbIngestionJobs').withConverter(kbIngestionJobConverter)
}

/** Collection 12: escalations/{eid} */
export function escalationsRef(): CollectionReference<EscalationDoc> {
  return adminDb.collection('escalations').withConverter(escalationConverter)
}

/**
 * Collection 13: auditLogs/{alid}
 *
 * APPEND-ONLY. Client writes are denied by Firestore rules.
 * Written exclusively via adminDb in src/audit/log.ts (TSD §5.2).
 */
export function auditLogsRef(): CollectionReference<AuditLogDoc> {
  return adminDb.collection('auditLogs').withConverter(auditLogConverter)
}

/** Collection 14: evals/{runId} */
export function evalsRef(): CollectionReference<EvalDoc> {
  return adminDb.collection('evals').withConverter(evalConverter)
}

/**
 * Collection 15: rateBudgets/{uid}
 *
 * De-facto 15th collection (TSD §9). Owner-scoped: each agent reads/writes
 * only rateBudgets/{own-uid}. Cross-agent access is denied by Firestore rules
 * (match /rateBudgets/{uid} — isSelf(uid) only).
 *
 * Declared here as single source of truth. Consumed by 01-07 (src/ratelimit/).
 */
export function rateBudgetsRef(): CollectionReference<RateBudgetDoc> {
  return adminDb.collection('rateBudgets').withConverter(rateBudgetConverter)
}
