/**
 * Firestore typed collection refs — SINGLE SOURCE OF TRUTH.
 *
 * Every Firestore collection used by the platform is declared exactly once
 * here. Each collection ref uses a FirestoreDataConverter that stamps
 * `tenantId: TENANT_ID` on every document write — no caller can write
 * without the tenant field (TSD §4, CLAUDE.md tenantId mandate).
 *
 * Collections (TSD §4 — 14 collections + rateBudgets + knowledgeGaps):
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
 *   16. knowledgeGaps/{gapId} ← Phase-2 knowledge-gap store (CDASH-03; server/Admin-SDK writes only)
 *   17. replyEdits/{eventId}  ← Phase-4 reply edit-as-signal store (REPLY-09/ADMIN-06; append-only, server-only writes)
 *   18. usageEvents/{eventId} ← Phase-5 per-turn usage counts (QUAL-08; server/Admin-SDK writes; 90d TTL proposed)
 *   19. usageRollups/{key}    ← Phase-5 idempotent daily rollup (QUAL-08/ADMIN-08; server/Admin-SDK writes)
 *   20. erasureRequests/{reqId} ← Phase-5 PDPA erasure ledger (QUAL-09/D-02; server/Admin-SDK writes)
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
  // MUST mirror the canonical Role union in src/firebase/auth.ts:36.
  // Inlined (not imported) to avoid a collections↔auth circular import —
  // auth.ts imports this module. RO-01 (Phase 6) added 'read-only'.
  role: 'new-agent' | 'senior-coach' | 'admin' | 'read-only'
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
  /**
   * Phase-7 COH-02: one-cohort-per-agent membership (D-02). Denormalized
   * cohort reference (NOT a UID array on the cohort doc — 1 MB trap; NOT a
   * join collection — YAGNI). Cohort filtering reuses `where('cohortId','==',cid)`.
   * OPTIONAL — absent on pre-Phase-7 docs (backward-compat, no backfill;
   * mirrors the EscalationDoc.resolvedAt optional-field precedent below).
   */
  cohortId?: string
  /**
   * Phase-7 CLOSE-01: first-close signal (D-20). Set by an audited, idempotent
   * "record first close" Server Action (D-21 — records the FIRST close only;
   * subsequent calls no-op). Absent = no close yet. days-to-first-close (CLOSE-02)
   * = firstCloseAt − onboarding start, computed read-time (no stored metric).
   * OPTIONAL — absent on pre-Phase-7 docs (backward-compat, no backfill).
   */
  firstCloseAt?: Date | FieldValue
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

/**
 * Discrete price-band labels for equality-filterable Firestore pre-filters.
 *
 * Firestore `findNearest` pre-filters are equality-only — range filters cannot
 * be combined with `findNearest` (Pitfall 6 / research Pattern 4). Storing the
 * discrete band enables `where('priceBand','==',band).findNearest(embedding,…)`
 * as an equality pre-filter, while the numeric `priceValue` is used for
 * in-memory affordability ceiling comparisons (FIND-10).
 *
 * Wave-2 `src/inventory/search.ts` and Wave-3 admin reuse these constants —
 * no magic strings in callers.
 */
export const PRICE_BANDS = [
  'under_500k',
  '500k_800k',
  '800k_1.2m',
  'above_1.2m',
] as const
export type PriceBand = typeof PRICE_BANDS[number]

/**
 * Derive the discrete `PriceBand` label from a numeric asking price in RM.
 *
 * This is the single source of truth for band assignment. All paths that write
 * a `ProjectDoc` (crud, import, admin Server Actions) MUST call this helper so
 * the stored `priceBand` is always consistent with the stored `priceValue`.
 *
 * Band boundaries (v1 — confirm with Derek if revised):
 *   < 500,000         → 'under_500k'
 *   500,000 – 799,999 → '500k_800k'
 *   800,000 – 1,199,999 → '800k_1.2m'
 *   ≥ 1,200,000       → 'above_1.2m'
 */
export function priceBandFor(priceValue: number): PriceBand {
  if (priceValue < 500_000) return 'under_500k'
  if (priceValue < 800_000) return '500k_800k'
  if (priceValue < 1_200_000) return '800k_1.2m'
  return 'above_1.2m'
}

export interface ProjectDoc {
  tenantId: TenantId
  name: string
  status: 'active' | 'sold_out' | 'hidden'
  /**
   * Discrete equality-filterable price band label.
   *
   * Used as the Firestore `findNearest` pre-filter (equality-only — Pitfall 6).
   * Derived from `priceValue` via `priceBandFor()`. Both fields must be kept in
   * sync on every write (FIND-03 / D-03 / research Pattern 4 Index note).
   */
  priceBand: PriceBand
  /**
   * Numeric asking price in RM.
   *
   * Used for in-memory affordability ceiling comparisons (FIND-10). Range
   * filtering on this field happens IN MEMORY because `findNearest` pre-filters
   * are equality-only — do NOT attempt `where('priceValue','<=',x).findNearest(…)`
   * as it will throw a Firestore error (Pitfall 6).
   */
  priceValue: number
  tenure: string
  /**
   * Denormalized convenience flag: true if VP has been completed.
   * Keep for boolean queries. For date-grain queries ("completed VP this year")
   * use `vpDate` (FIND-07).
   */
  vpStatus: boolean
  /**
   * VP (Vacant Possession) completion date.
   *
   * `null` when `vpStatus === false` (VP not yet completed).
   * Backs FIND-07 `where('status','==','active').where('vpDate','>=',startOfYear)`
   * queries with the `(status, vpDate)` composite index.
   */
  vpDate: Date | FieldValue | null
  bumiQuota: boolean
  foreignEligible: boolean
  /**
   * Human-readable project description. Feeds the embedding-text composer
   * (`composeProjectEmbeddingText` in `src/inventory/embedText.ts`).
   * Note: `status` is NOT included in the embedding text — it is a hard filter,
   * not a semantic signal (research code example).
   */
  description: string
  /**
   * Location text (e.g. "Cheras, Kuala Lumpur — near LRT Taman Connaught").
   * Feeds the embedding-text composer for semantic location matching.
   */
  locationText: string
  /**
   * Number of bedrooms. Feeds the embedding-text composer and enables
   * structured bedroom-count filtering in `queryInventory` (FIND-07).
   */
  bedrooms: number
  /** 1024-d normalized vector (Gemini gemini-embedding-001) */
  embedding: number[]
}

export interface CollateralDoc {
  tenantId: TenantId
  projectId: string
  type: string
  /**
   * Firebase Storage object path (e.g. `collateral/project-id/poster.pdf`).
   *
   * D-09 / C2: This field stores a Firebase Storage path OR a plain external
   * share URL (see `externalUrl`). NEVER a Google Drive API integration —
   * the Drive API is forbidden by the no-GCP constraint.
   */
  storagePath: string
  /**
   * Optional plain share URL for assets not hosted in Firebase Storage
   * (e.g. a Google Drive public share link, OneDrive link, etc.).
   *
   * D-09 / C2: Use this field for external URLs. NEVER call the Drive API —
   * the URL is stored as a plain string; the client renders a download link.
   * Either `storagePath` is used (Firebase Storage) or `externalUrl` (external),
   * never a Drive-API integration.
   */
  externalUrl?: string
  lang: 'en' | 'ms' | 'zh'
}

export interface KbDocDoc {
  tenantId: TenantId
  title: string
  sourcePath: string
  version: number
  /** ID of the KB doc this supersedes (versioning) */
  supersedesId?: string
  /** ID of the KB doc that supersedes this one (set when a new version replaces this doc) */
  supersededBy?: string
  /**
   * Publication status — only 'published' docs are served by retrieval (Pitfall 3 fix).
   * Optional for backwards-compat with Phase-1 writers; 02-02 adds the retrieval filter
   * and a backfill that sets 'published' on all existing docs written without a status.
   */
  status?: 'published' | 'unpublished' | 'superseded'
  /**
   * UID of the senior-coach or admin who authored this correction version (CDASH-04).
   * Only set on versions created via correctKbDoc(). Enables admin oversight of
   * coach-injected content via the version history chain.
   */
  correctedBy?: string
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'
  /**
   * SOP category metadata (D-09) — net-new, optional. Existing docs have none.
   * Canonical Reply values seeded but not hard-coded: 'cold-prospect',
   * 'objection-handling', 'financing', 'voice'. Free-form open string.
   */
  category?: string
  publishedAt: Date | FieldValue
}

export interface KbChunkDoc {
  tenantId: TenantId
  docId: string
  text: string
  lang: 'en' | 'ms' | 'zh'
  /** Collection this chunk belongs to (for pre-filter in findNearest) */
  ownerCollection: string
  /**
   * Denormalized from the parent kbDoc — allows retrieval to filter to published
   * chunks only without a parent-doc JOIN (Pitfall 3 fix).
   * Must be kept in sync with the parent kbDoc.status on every re-ingest / publish / supersede.
   * Optional for backwards-compat with Phase-1 writers; 02-02 adds the retrieval filter
   * and a backfill that sets 'published' on all existing chunks written without a status.
   */
  status?: 'published' | 'unpublished' | 'superseded'
  /**
   * Denormalized from the parent kbDoc.pillar — allows retrieval to pre-filter
   * findNearest by pillar (e.g. `where('pillar','==','reply')`) without a
   * parent-doc JOIN (REPLY-01, 04-RESEARCH §Q7 / Pitfall B). Must be kept in
   * sync with the parent kbDoc.pillar on every ingest.
   * Optional for backwards-compat with pre-Phase-4 chunks written without it;
   * the 04-03 backfill (scripts/backfill-kb-chunks-pillar.ts) stamps pillar:'coach'
   * on all existing chunks that have none (D-08 default).
   */
  pillar?: 'coach' | 'finder' | 'reply'
  /** 1024-d normalized vector (Gemini gemini-embedding-001, DOT_PRODUCT) */
  embedding: number[]
  tokens: number
  /** Zero-based position of this chunk in the source document */
  chunkIndex: number
}

export interface KbIngestionJobDoc {
  tenantId: TenantId
  fileHash: string
  total: number
  remaining: number
  status: 'pending' | 'processing' | 'complete' | 'error'
  /** All chunk texts (stored so the process worker can embed them in batches) */
  chunkTexts: string[]
  /** The kbDocs document this job belongs to */
  docId: string
  /** Language of the document */
  lang: 'en' | 'ms' | 'zh'
  /** Pillar this KB doc belongs to */
  pillar: 'coach' | 'finder' | 'reply'
  /**
   * If this job ingests a NEW VERSION, the old kbDoc ID it supersedes.
   * processBatch marks the old doc + its chunks 'superseded' when remaining===0,
   * so corrected/updated content replaces the old in retrieval (CDASH-04/ADMIN-03).
   */
  supersedesId?: string
  createdAt: Date | FieldValue
}

export interface EscalationDoc {
  tenantId: TenantId
  agentUid: string
  seniorCoachId: string
  reason: string
  contextBundle: Record<string, unknown>
  status: 'open' | 'resolved' | 'escalated'
  openedAt: Date | FieldValue
  /**
   * Set when status transitions to 'resolved'. Used for resolution-time analytics
   * (D-05 rollup metric). OPTIONAL — only present on resolved escalations.
   * REGRESSION NOTE: resolveStall (dashboard/actions.ts:84) must ALSO set this
   * field when it transitions status to 'resolved' (05-PATTERNS.md flagged regression).
   */
  resolvedAt?: Date | FieldValue
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
 * Knowledge-gap record (collection 16, Phase-2 CDASH-03).
 *
 * Captures topics that agents frequently ask about but the KB cannot answer,
 * enabling the senior-coach dashboard to surface a per-coach knowledge-gap feed.
 *
 * PDPA / security notes (A3):
 *   - `topicLabel` MUST be a SHORT pseudonymized descriptor (e.g., "OC bumiputera quota"),
 *     never the raw query string or any PII. Callers must redact before writing.
 *   - `topicHash` is the sha256 dedup key (hex) — used to upsert/increment `count`.
 *   - Server / Admin-SDK writes only — `create, update, delete: if false` in Firestore rules.
 *   - Read-gated to the owning `seniorCoachId` + admin (deny-by-default, same as escalations).
 */
export interface KnowledgeGapDoc {
  tenantId: TenantId
  /** UID of the senior coach whose downline triggered this gap. */
  seniorCoachId: string
  /** UID of the agent who asked (pseudonymized — do NOT store raw name/email). */
  agentUid: string
  /**
   * SHA-256 hex of the canonical topic string (lowercase, trimmed).
   * Used as the dedup key for upsert-or-increment writes.
   */
  topicHash: string
  /**
   * Short, human-readable label for the topic (≤120 chars, no raw query text, no PII).
   * Example: "OC bumiputera quota", "meta-ads budgeting", "iProperty listing SOP"
   */
  topicLabel: string
  /** Language the question was asked in (drives per-lang gap reporting). */
  lang: 'en' | 'ms' | 'zh'
  /** How many times this topic has been hit without a KB answer. */
  count: number
  /** Timestamp of the most recent miss for this topic (used for gap-feed ordering). */
  lastSeenAt: Date | FieldValue
  /**
   * pillar discriminator (D-11) — Reply no_sop_match misses set 'reply';
   * existing/coach misses omit it (absent ⇒ treat as 'coach' for backward
   * compatibility with Phase-2 gap rows). OPTIONAL — the existing
   * recordKnowledgeGap writer keeps compiling without setting it; Plan 06's
   * Reply route onFinish sets pillar:'reply' so Derek's dashboard can separate
   * Coach training gaps from Reply SOP gaps.
   */
  pillar?: 'coach' | 'reply'
}

/**
 * Reply edit-as-signal record (collection 17, Phase-4 REPLY-09 / ADMIN-06, D-18/D-19).
 *
 * Captures the model's `originalDraft` vs the agent's `editedFinal` on EVERY Copy
 * of a Reply draft, plus a numeric `editRatio` (src/reply/diff.ts) and the cited
 * `sopDocIds`. Read-time aggregation (D-20) powers the senior-coach / admin
 * "Reply Quality" dashboard: per-SOP edit-rate, top-edited SOP, and the
 * thumbs-down rate (`count(thumbsDown==true) / count(all)`, ADMIN-06).
 *
 * Append-only, top-level collection (D-19 — NOT buried in `messages`):
 *   - Clients can NEVER write it — `create, update, delete: if false` in
 *     firestore.rules. The ONLY writer is the `captureReplyEdit` Server Action
 *     via the Admin SDK (which bypasses rules).
 *   - A row is written on EVERY Copy, including unchanged copies (`editRatio: 0`),
 *     so the per-SOP edit-rate aggregation has a denominator (Pitfall E).
 *
 * Read scoping (mirrors escalations/knowledgeGaps):
 *   - An agent reads ONLY their own rows (agentUid == auth.uid).
 *   - A senior-coach reads their downline rows — this requires `seniorCoachId`
 *     to be DENORMALIZED onto every row at write time so the rule can match
 *     `resource.data.seniorCoachId == request.auth.uid` (Pitfall D). The writer
 *     looks it up from `agentProfiles/{agentUid}.seniorCoachId`.
 *   - An admin reads all same-tenant rows.
 *
 * PDPA: `originalDraft`/`editedFinal` are STORED (residual content possible) but
 * MUST NEVER be logged — the converter stamps tenantId; only counts may be logged.
 */
export interface ReplyEditDoc {
  tenantId: TenantId
  /** The lead this draft was for (per-lead isolation — leadContext/{leadId}). */
  leadId: string
  /** Stable id for the specific draft turn the edit applies to. */
  draftId: string
  /** SOP doc IDs the draft cited — the per-SOP edit-rate group key (ARRAY_CONTAINS). */
  sopDocIds: string[]
  /** The model's original draft text (stored, never logged). */
  originalDraft: string
  /** The agent's final text at Copy time (stored, never logged). */
  editedFinal: string
  /** Normalized char-level edit metric in [0,1]; 0 on an unchanged copy. */
  editRatio: number
  /** UID of the agent who drafted/copied (read scope: agent reads own). */
  agentUid: string
  /**
   * Denormalized at write so the coach read-rule can match (Pitfall D).
   * Looked up from agentProfiles/{agentUid}.seniorCoachId; '' if absent.
   */
  seniorCoachId: string
  /** Language of the draft (drives per-lang reporting). */
  lang: 'en' | 'ms' | 'zh'
  /** Optional thumbs-down signal (ADMIN-06 KPI producer); absent when not given. */
  thumbsDown?: boolean
  /** Append-only write time (FieldValue.serverTimestamp() on write). */
  timestamp: Date | FieldValue
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

/**
 * Usage event record (collection 18, Phase-5 QUAL-08 / D-04).
 *
 * Server-only write (Admin SDK). Counts only — NEVER message/draft content
 * (PDPA, mirrors auditLogs no-PII posture). One document per chat turn, written
 * via recordUsageEvent() inside after() in app/api/chat/route.ts.
 *
 * // RETENTION: 90d TTL (rollups are the durable record) — confirm with Derek (Pitfall 4 / A5)
 *
 * PDPA: NO content fields on this doc — only token counts and metadata.
 * Client writes are denied by Firestore rules (create, update, delete: if false).
 */
export interface UsageEventDoc {
  tenantId: TenantId
  /** UID of the agent who sent the message. */
  uid: string
  /** Which agent pillar handled the turn. */
  pillar: 'coach' | 'finder' | 'reply'
  /** Input tokens for this turn (from final.totalUsage). */
  inputTokens: number
  /** Output tokens for this turn (from final.totalUsage). */
  outputTokens: number
  /** Prompt cache read tokens (Anthropic cache hit). */
  cachedInputTokens: number
  /** Prompt cache write tokens (Anthropic cache creation). */
  cacheCreationInputTokens: number
  /** Firestore read units consumed (optional — captured if available). */
  reads?: number
  /** Firestore write units consumed (optional — captured if available). */
  writes?: number
  /** Calendar date in Asia/Kuala_Lumpur timezone, format 'YYYY-MM-DD'. The rollup group key. */
  day: string
  /** Server timestamp of the turn (FieldValue.serverTimestamp() on write). */
  createdAt: Date | FieldValue
}

/**
 * Daily per-(uid, pillar) usage rollup (collection 19, Phase-5 QUAL-08/ADMIN-08 / D-05).
 *
 * Server-only write; admin-read. The single source for the ADMIN-08 cost/usage
 * dashboard and the QUAL-08 cost pass (no second pipeline).
 *
 * Doc key is `${day}__${uid}__${pillar}` — idempotent: written with { merge: true }
 * so a re-run overwrites rather than accumulating (Pitfall-3 double-count guard).
 *
 * Client writes are denied by Firestore rules (create, update, delete: if false).
 */
export interface UsageRollupDoc {
  tenantId: TenantId
  /** Calendar date, format 'YYYY-MM-DD' (Asia/Kuala_Lumpur). */
  day: string
  /** UID of the agent this rollup covers. */
  uid: string
  /** Pillar for this rollup bucket. */
  pillar: 'coach' | 'finder' | 'reply'
  /** Number of chat turns rolled up. */
  msgCount: number
  /** Sum of inputTokens across all turns in this bucket. */
  inputTokens: number
  /** Sum of outputTokens across all turns in this bucket. */
  outputTokens: number
  /** Sum of cachedInputTokens (Anthropic cache hits). */
  cachedInputTokens: number
  /** Sum of cacheCreationInputTokens (Anthropic cache writes). */
  cacheCreationInputTokens: number
  /** Sum of Firestore read units (optional). */
  reads?: number
  /** Sum of Firestore write units (optional). */
  writes?: number
  /** Average escalation resolution time in ms for this bucket (D-05, optional). */
  resolutionTimeMs?: number
  /** Escalation rate for this bucket (D-05, optional). */
  escalationRate?: number
  /** Last time this rollup doc was written / merged. */
  updatedAt: Date | FieldValue
}

/**
 * PDPA erasure request ledger entry (collection 20, Phase-5 QUAL-09 / D-02).
 *
 * Server-only write; admin-read. The erasure ledger provides idempotency and
 * resumability for the chunked sweep (D-02). Written when an admin initiates
 * erasure via the erasure Server Action; updated as the sweep progresses.
 *
 * PDPA: the public TypeScript interface below exposes `subjectIdHash` only (never
 * the raw subject id).  However, a transient server-only `rawSubjectId` field (not
 * part of this interface) IS written to the Firestore doc by the erasure Server
 * Action so the chunked sweep can re-query collections for this subject.  That field
 * is CLEARED (`FieldValue.delete()`) when the request transitions to `complete`,
 * within the <72h SLA.  It is admin-read-only (Firestore rules) and is never returned
 * to clients by any Server Action.  v2 hardening option: encrypt-at-rest with a
 * Secret-Manager key.
 *
 * Client writes are denied by Firestore rules (create, update, delete: if false).
 */
export interface ErasureRequestDoc {
  tenantId: TenantId
  /** Whether the subject is an agent (uid) or a lead (leadId). */
  subjectType: 'lead' | 'agent'
  /**
   * SHA-256 hex of the subject's id (uid or leadId). NEVER the raw id.
   * Used as the dedup key for idempotent re-runs of the sweep.
   */
  subjectIdHash: string
  /** Current processing status. */
  status: 'pending' | 'sweeping' | 'complete' | 'failed'
  /** UID of the admin who triggered this request. */
  requestedBy: string
  /** When the request was created. */
  requestedAt: Date | FieldValue
  /** Epoch ms deadline (requestedAt + 72h) for PDPA 72-hour SLA. */
  slaDeadline: number
  /** Collections still to be swept (for resumability — updated as sweep progresses). */
  collectionsRemaining: string[]
  /** Set when status transitions to 'complete'. */
  completedAt?: Date | FieldValue
  /** Error message if status is 'failed'. */
  error?: string
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
export const knowledgeGapConverter = makeConverter<KnowledgeGapDoc>()
export const replyEditConverter = makeConverter<ReplyEditDoc>()
export const usageEventConverter = makeConverter<UsageEventDoc>()
export const usageRollupConverter = makeConverter<UsageRollupDoc>()
export const erasureRequestConverter = makeConverter<ErasureRequestDoc>()

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

/**
 * Collection 16: knowledgeGaps/{gapId}
 *
 * Phase-2 knowledge-gap store (CDASH-03). Captures topics agents frequently
 * ask about without a KB answer, aggregated per seniorCoachId for the dashboard
 * knowledge-gap feed.
 *
 * Server / Admin-SDK writes ONLY — create, update, delete disabled for clients.
 * Read is scoped to the owning seniorCoachId + admin (firestore.rules).
 *
 * PDPA: topicLabel MUST be pseudonymized before writing — never raw query text.
 */
export function knowledgeGapsRef(): CollectionReference<KnowledgeGapDoc> {
  return adminDb.collection('knowledgeGaps').withConverter(knowledgeGapConverter)
}

/**
 * Collection 17: replyEdits/{eventId}
 *
 * Phase-4 reply edit-as-signal store (REPLY-09 / ADMIN-06, D-18/D-19).
 * Append-only, top-level collection — clients can NEVER write it
 * (create, update, delete: if false in firestore.rules). The ONLY writer is the
 * `captureReplyEdit` Server Action via the Admin SDK (which bypasses rules).
 *
 * Read scope (mirrors knowledgeGaps): an agent reads their own rows; a senior-coach
 * reads downline rows (requires the DENORMALIZED `seniorCoachId` on each row —
 * Pitfall D); an admin reads all same-tenant rows.
 *
 * PDPA: originalDraft / editedFinal are stored but MUST NEVER be logged — only
 * counts may be logged (CLAUDE.md no-PII-in-logs).
 */
export function replyEditsRef(): CollectionReference<ReplyEditDoc> {
  return adminDb.collection('replyEdits').withConverter(replyEditConverter)
}

/**
 * Collection 18: usageEvents/{eventId}
 *
 * Phase-5 per-turn usage counts (QUAL-08 / D-04). Server / Admin-SDK writes ONLY —
 * create, update, delete disabled for clients. Admin-read for cost auditing.
 *
 * Written via recordUsageEvent() inside after() in app/api/chat/route.ts.
 * COUNTS ONLY — NEVER message/draft content (PDPA posture mirrors auditLogs).
 * // RETENTION: 90d TTL (rollups are the durable record) — confirm with Derek (Pitfall 4 / A5)
 */
export function usageEventsRef(): CollectionReference<UsageEventDoc> {
  return adminDb.collection('usageEvents').withConverter(usageEventConverter)
}

/**
 * Collection 19: usageRollups/{key}
 *
 * Phase-5 idempotent daily per-(uid, pillar) rollup (QUAL-08/ADMIN-08 / D-05).
 * Server / Admin-SDK writes ONLY — create, update, delete disabled for clients.
 * Admin-read for the ADMIN-08 usage dashboard and QUAL-08 cost pass.
 *
 * Doc key pattern: `${day}__${uid}__${pillar}` — written with { merge: true }
 * for idempotency (Pitfall-3 double-count guard).
 */
export function usageRollupsRef(): CollectionReference<UsageRollupDoc> {
  return adminDb.collection('usageRollups').withConverter(usageRollupConverter)
}

/**
 * Collection 20: erasureRequests/{reqId}
 *
 * Phase-5 PDPA erasure ledger (QUAL-09 / D-02). Server / Admin-SDK writes ONLY —
 * create, update, delete disabled for clients. Admin-read for erasure audit/monitoring.
 *
 * Provides idempotency and resumability for the chunked sweep (D-02).
 * PDPA: stores subjectIdHash ONLY — never the raw subject id.
 */
export function erasureRequestsRef(): CollectionReference<ErasureRequestDoc> {
  return adminDb.collection('erasureRequests').withConverter(erasureRequestConverter)
}
