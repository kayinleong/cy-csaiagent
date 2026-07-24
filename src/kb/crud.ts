/**
 * src/kb/crud.ts
 *
 * KB document CRUD operations.
 *
 * Authorization model:
 *   - createDoc / updateDoc / listDocs / deleteDoc / publishDoc / unpublishDoc — admin only.
 *   - correctKbDoc — admin OR senior-coach (CDASH-04 correction path).
 *
 * Supports multi-doc KB management with versioning:
 *   - createDoc:        create a new kbDocs document with status:'published'.
 *   - updateDoc:        create a new version superseding an existing doc.
 *   - listDocs:         list all kbDocs for the tenant.
 *   - deleteDoc:        hard-delete a kbDocs document AND its kbChunks (orphan fix).
 *   - publishDoc:       set kbDoc + its kbChunks to status:'published'.
 *   - unpublishDoc:     set kbDoc + its kbChunks to status:'unpublished'.
 *   - markSuperseded:   set old kbDoc + its kbChunks to status:'superseded' (called
 *                       on ingest completion — see trigger choice in 02-02-SUMMARY.md).
 *   - correctKbDoc:     senior-coach correction path — calls updateDoc with correctedBy.
 *
 * All mutations:
 *   - Write via kbDocsRef() (tenantId stamped automatically by the converter).
 *   - Guard on assertAdmin or assertAdminOrCoach (see below).
 *   - Server Actions re-check the role before calling these functions.
 *
 * kbChunks.status denormalization:
 *   - Always kept in sync with the parent kbDoc.status.
 *   - New ingests are published (processBatch stamps status:'published').
 *   - Supersede / publish / unpublish must bulk-update chunks to match.
 *
 * Trigger for markSuperseded (DESIGN DECISION documented in 02-02-SUMMARY.md):
 *   markSuperseded is called by the /api/kb/ingest/process Route Handler when
 *   remaining hits 0 — i.e. after the new version is fully embedded. This ensures
 *   the old version stays retrievable until the new version is ready. The old doc's
 *   supersedesId is the docId passed to updateDoc; the Route Handler receives the
 *   old docId in the job doc and can call markSuperseded(oldDocId, newDocId).
 *
 * IMPORTANT: createDoc and updateDoc chunk the content and trigger ingestion
 * via shardJob(). Full embedding of the chunks is deferred to the browser-
 * driven /api/kb/ingest/process poll loop (TSD §3.4).
 *
 * References:
 *   - TSD §4 kbDocs (versioned, supersedesId, only published chunks retrievable)
 *   - TSD §5.1 roles (admin CRUD; senior-coach correction path)
 *   - 02-02-PLAN.md Task 2: supersede cascade, publish/unpublish, correction attribution
 *   - D-12: correction → versioned KB re-ingest, attributed
 *   - D-13: publish/unpublish (admin CRUD stays admin-only)
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  kbDocsRef,
  kbChunksRef,
  kbIngestionJobsRef,
  TENANT_ID,
  type KbDocDoc,
  type KbIngestionJobDoc,
} from '@/src/firebase/collections'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { shardJob, type ShardJobResult } from '@/src/kb/ingest/pipeline'
import { log as auditLog } from '@/src/audit/log'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDocInput {
  title: string
  /** Plain text content (will be chunked + ingested) */
  content: string
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'
  /**
   * SOP category metadata (D-09) — optional. Reply canonical values:
   * 'cold-prospect' | 'objection-handling' | 'financing' | 'voice'.
   * Free-form open string; persisted on the kbDoc when present.
   */
  category?: string
}

export interface CreateDocFromFileInput {
  title: string
  /** The uploaded file to extract text from and shard */
  file: {
    buffer: Buffer
    name: string
    mimeType: string
  }
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'
}

export interface UpdateDocInput {
  title?: string
  content?: string
  lang?: 'en' | 'ms' | 'zh'
  pillar?: 'coach' | 'finder' | 'reply'
  /** SOP category metadata (D-09) — optional; persisted on the new version when present. */
  category?: string
  /** UID of the actor who created this correction version (CDASH-04 attribution). */
  correctedBy?: string
}

export interface CorrectKbDocInput {
  lang?: 'en' | 'ms' | 'zh'
  pillar?: 'coach' | 'finder' | 'reply'
}

export interface KbDocWithId {
  id: string
  data: KbDocDoc
}

export interface CreateDocResult {
  docId: string
  jobId: string
  total: number
  remaining: number
}

// ─── createDoc ───────────────────────────────────────────────────────────────

/**
 * Create a new KB document and shard it into an ingestion job.
 *
 * @param user     Verified user from requireUser() — must have role 'admin'.
 * @param input    Title, content, lang, pillar.
 * @returns        docId + job metadata for the browser poll loop.
 */
export async function createDoc(
  user: AuthenticatedUser,
  input: CreateDocInput,
): Promise<CreateDocResult> {
  assertAdmin(user)

  // Create the kbDocs document — status:'published' because new docs are live once ingested.
  // kbChunks get status:'published' when processBatch writes them (pipeline.ts).
  const docRef = kbDocsRef().doc()
  const docId = docRef.id

  const docData: Omit<KbDocDoc, 'tenantId'> = {
    title: input.title,
    sourcePath: `kb/${docId}`,
    version: 1,
    lang: input.lang,
    pillar: input.pillar,
    // Persist SOP category metadata only when provided (D-09).
    ...(input.category !== undefined ? { category: input.category } : {}),
    status: 'published',
    publishedAt: FieldValue.serverTimestamp(),
  }

  await docRef.set({ ...docData, tenantId: TENANT_ID } as KbDocDoc)

  // Shard the content into a kbIngestionJobs doc
  const job = await shardJobForContent(input.content, docId, input.lang, input.pillar)

  return { docId, jobId: job.jobId, total: job.total, remaining: job.remaining }
}

// ─── createDocFromFile ────────────────────────────────────────────────────────

/**
 * Create a new KB document by sharding a real uploaded file.
 *
 * Unlike createDoc (which accepts plain text content), this function accepts
 * a raw file buffer and delegates text extraction to extractText via shardJob.
 * The upload Route Handler calls this after receiving a multipart/form-data POST.
 *
 * @param user     Verified user from requireUser() — must have role 'admin'.
 * @param input    Title, file (buffer + name + mimeType), lang, pillar.
 * @returns        docId + job metadata for the browser poll loop.
 */
export async function createDocFromFile(
  user: AuthenticatedUser,
  input: CreateDocFromFileInput,
): Promise<CreateDocResult> {
  assertAdmin(user)

  // Create the kbDocs document — status:'published' (chunks published on ingest)
  const docRef = kbDocsRef().doc()
  const docId = docRef.id

  const docData: Omit<KbDocDoc, 'tenantId'> = {
    title: input.title,
    sourcePath: `kb/${docId}/${input.file.name}`,
    version: 1,
    lang: input.lang,
    pillar: input.pillar,
    status: 'published',
    publishedAt: FieldValue.serverTimestamp(),
  }

  await docRef.set({ ...docData, tenantId: TENANT_ID } as KbDocDoc)

  // Shard the file into a kbIngestionJobs doc (text extraction happens inside shardJob)
  const job = await shardJob({
    buffer: input.file.buffer,
    name: input.file.name,
    mimeType: input.file.mimeType,
    docId,
    lang: input.lang,
    pillar: input.pillar,
  })

  return { docId, jobId: job.jobId, total: job.total, remaining: job.remaining }
}

// ─── updateDocFromFile ────────────────────────────────────────────────────────

/**
 * Update a KB document by uploading a new file version.
 *
 * Creates a new versioned kbDocs document that supersedes the existing one,
 * then shards the uploaded file. markSuperseded fires on ingest completion
 * (same as the text updateDoc path).
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID being superseded.
 * @param input  New title (optional, falls back to existing), file buffer + metadata.
 * @returns      docId + newDocId + job metadata for the browser poll loop.
 */
export async function updateDocFromFile(
  user: AuthenticatedUser,
  docId: string,
  input: { title?: string; file: CreateDocFromFileInput['file']; lang?: 'en' | 'ms' | 'zh'; pillar?: 'coach' | 'finder' | 'reply' },
): Promise<{ docId: string; newDocId: string; jobId: string; total: number; remaining: number }> {
  assertAdmin(user)

  const existingSnap = await kbDocsRef().doc(docId).get()
  if (!existingSnap.exists) {
    throw new Error(`updateDocFromFile: kbDoc "${docId}" not found`)
  }

  const existing = existingSnap.data()!

  const newDocRef = kbDocsRef().doc()
  const newDocId = newDocRef.id

  const newDocData: Omit<KbDocDoc, 'tenantId'> = {
    title: input.title ?? existing.title,
    sourcePath: `kb/${newDocId}/${input.file.name}`,
    version: (existing.version ?? 1) + 1,
    supersedesId: docId,
    lang: input.lang ?? existing.lang,
    pillar: input.pillar ?? existing.pillar,
    status: 'published',
    publishedAt: FieldValue.serverTimestamp(),
  }

  await newDocRef.set({ ...newDocData, tenantId: TENANT_ID } as KbDocDoc)

  const job = await shardJob({
    buffer: input.file.buffer,
    name: input.file.name,
    mimeType: input.file.mimeType,
    docId: newDocId,
    lang: input.lang ?? existing.lang,
    pillar: input.pillar ?? existing.pillar,
    supersedesId: docId,
  })

  return { docId, newDocId, jobId: job.jobId, total: job.total, remaining: job.remaining }
}

// ─── updateDoc ───────────────────────────────────────────────────────────────

/**
 * Update a KB document by creating a new version that supersedes the existing one.
 *
 * If `content` is provided, a new ingestion job is created to re-embed the content.
 * The old doc is NOT immediately superseded here — supersession happens when the
 * new version completes ingestion (remaining=0 in /api/kb/ingest/process), at which
 * point the Route Handler calls markSuperseded(oldDocId, newDocId).
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to update.
 * @param patch  Fields to update. May include correctedBy for CDASH-04 attribution.
 * @returns      { docId } + optional job metadata if content was updated.
 */
export async function updateDoc(
  user: AuthenticatedUser,
  docId: string,
  patch: UpdateDocInput,
): Promise<{ docId: string; newDocId?: string; jobId?: string; total?: number; remaining?: number }> {
  assertAdmin(user)

  // Read the current document to get its version
  const existingSnap = await kbDocsRef().doc(docId).get()
  if (!existingSnap.exists) {
    throw new Error(`updateDoc: kbDoc "${docId}" not found`)
  }

  const existing = existingSnap.data()!

  if (patch.content !== undefined) {
    // Create a new versioned document that supersedes the old one
    const newDocRef = kbDocsRef().doc()
    const newDocId = newDocRef.id

    // Carry the category forward: prefer the patch value, else the existing doc's.
    const nextCategory = patch.category ?? existing.category
    const newDocData: Omit<KbDocDoc, 'tenantId'> = {
      title: patch.title ?? existing.title,
      sourcePath: `kb/${newDocId}`,
      version: (existing.version ?? 1) + 1,
      supersedesId: docId,
      lang: patch.lang ?? existing.lang,
      pillar: patch.pillar ?? existing.pillar,
      // Persist SOP category metadata only when present (D-09).
      ...(nextCategory !== undefined ? { category: nextCategory } : {}),
      status: 'published',
      publishedAt: FieldValue.serverTimestamp(),
      // Attribution: stamp the correcting actor's uid if provided (CDASH-04)
      ...(patch.correctedBy ? { correctedBy: patch.correctedBy } : {}),
    }

    await newDocRef.set({ ...newDocData, tenantId: TENANT_ID } as KbDocDoc)

    // Shard the new content
    const lang = patch.lang ?? existing.lang
    const pillar = patch.pillar ?? existing.pillar
    const job = await shardJobForContent(patch.content, newDocId, lang, pillar, docId)

    return { docId, newDocId, jobId: job.jobId, total: job.total, remaining: job.remaining }
  } else {
    // Metadata-only update (no new ingestion needed)
    const metaPatch: Partial<KbDocDoc> = {}
    if (patch.title !== undefined) metaPatch.title = patch.title
    if (patch.lang !== undefined) metaPatch.lang = patch.lang
    if (patch.pillar !== undefined) metaPatch.pillar = patch.pillar
    if (patch.category !== undefined) metaPatch.category = patch.category

    if (Object.keys(metaPatch).length > 0) {
      await kbDocsRef().doc(docId).update(metaPatch)
    }

    return { docId }
  }
}

// ─── listDocs ─────────────────────────────────────────────────────────────────

/**
 * List all KB documents for the tenant.
 *
 * @param user  Verified user from requireUser() — must have role 'admin'.
 */
export async function listDocs(user: AuthenticatedUser): Promise<KbDocWithId[]> {
  assertAdmin(user)

  const snap = await kbDocsRef().get()
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}

// ─── listDocsForReview ─────────────────────────────────────────────────────────

/**
 * List KB documents for the coach correction picker (CDASH-04).
 *
 * Read-only, gated to admin OR senior-coach (same gate as correctKbDoc), so a
 * coach can browse and pick a document to correct WITHOUT knowing its Firestore
 * doc ID — without exposing the admin-only /kb management surface. Excludes
 * already-superseded versions (they are not the live document).
 *
 * @param user  Verified user from requireUser() — must be 'admin' or 'senior-coach'.
 */
export async function listDocsForReview(user: AuthenticatedUser): Promise<KbDocWithId[]> {
  assertAdminOrCoach(user)

  const snap = await kbDocsRef().get()
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((d) => d.data.status !== 'superseded')
}

// ─── listDocsForViewer ─────────────────────────────────────────────────────────

/**
 * Read ALL KB documents for the version-history VIEWER (KM-01, read-only RO-01).
 *
 * Read-only path: permitted for 'admin' OR 'read-only' (the two roles the KB
 * detail/viewer route admits). Read-only may read kbDocs as a signed-in tenant
 * user (the least-privilege analytics+KB-read matrix); this is a pure read with
 * NO mutation, so it does NOT use assertAdmin (which would 404 the read-only
 * viewer — CR-01/WR-02). KB WRITE/CRUD stays admin-only via assertAdmin.
 *
 * Unlike listDocsForReview (correction picker, admin|coach, hides superseded),
 * this returns EVERY version (incl. superseded) so the version chain renders fully.
 *
 * @param user  Verified user — must be 'admin' or 'read-only'.
 */
export async function listDocsForViewer(user: AuthenticatedUser): Promise<KbDocWithId[]> {
  if (user.role !== 'admin' && user.role !== 'read-only') {
    throw new Error('Forbidden: admin or read-only role required for the KB version viewer')
  }

  const snap = await kbDocsRef().get()
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}

// ─── readIngestedContent ───────────────────────────────────────────────────────

/**
 * A read-only, RSC-serializable view of what a KB document actually ingested
 * (quick-kayinleong-042). The KB doc stores only metadata — the ingested text lives
 * in `kbChunks`. This reconstructs it so an admin can VERIFY ingestion on the edit page.
 *
 * All fields are plain JSON (strings / numbers / null) — safe across the RSC→Client
 * boundary (no Firestore Timestamps leak out).
 */
export interface IngestedContentView {
  /** Reconstructed document text: every chunk's `text`, ordered by chunkIndex, blank-line joined. */
  text: string
  /** Number of chunks currently stored for this docId (0 = nothing indexed). */
  chunkCount: number
  /** Sum of `tokens` across chunks — a rough "how much was indexed" signal. */
  totalTokens: number
  /** Status of the latest ingestion job for this doc, or null if no job doc exists. */
  jobStatus: 'pending' | 'processing' | 'complete' | 'error' | null
  /** Chunks still to embed in the latest job (progress), or null. */
  jobRemaining: number | null
  /** Total chunks the latest job will produce, or null. */
  jobTotal: number | null
}

/** Coerce a Firestore createdAt (Timestamp on read) to epoch millis for in-memory sort. */
function createdAtMillis(value: KbIngestionJobDoc['createdAt']): number {
  if (value instanceof Date) return value.getTime()
  // On read the field is a Firestore Timestamp (has toMillis); the declared FieldValue
  // union member only exists on the write path — go via unknown to probe safely.
  const maybe = value as unknown as { toMillis?: () => number }
  if (maybe && typeof maybe.toMillis === 'function') {
    return maybe.toMillis()
  }
  return 0
}

/**
 * Read the reconstructed ingested content + ingestion status for one KB document.
 *
 * Authz mirrors `listDocsForViewer`: admin OR read-only may READ (pure read, no mutation).
 * KB WRITE/CRUD stays admin-only via `assertAdmin` on the mutating paths.
 *
 * Queries are equality-only (`docId ==`) so NO composite index is required; ordering
 * (chunkIndex, job createdAt) is done in-memory — consistent with the rest of this module.
 *
 * @param user   Verified user — must be 'admin' or 'read-only'.
 * @param docId  The kbDocs document ID to reconstruct content for.
 */
export async function readIngestedContent(
  user: AuthenticatedUser,
  docId: string,
): Promise<IngestedContentView> {
  if (user.role !== 'admin' && user.role !== 'read-only') {
    throw new Error('Forbidden: admin or read-only role required to read ingested KB content')
  }

  // Chunks — equality-only filter; order by chunkIndex in-memory (no composite index).
  const chunksSnap = await kbChunksRef().where('docId', '==', docId).get()
  const chunks = chunksSnap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))

  const text = chunks.map((c) => c.text).join('\n\n')
  const chunkCount = chunks.length
  const totalTokens = chunks.reduce((sum, c) => sum + (c.tokens ?? 0), 0)

  // Latest ingestion job for this doc — pick newest by createdAt in-memory.
  const jobsSnap = await kbIngestionJobsRef().where('docId', '==', docId).get()
  let latest: KbIngestionJobDoc | null = null
  let latestMs = -1
  for (const doc of jobsSnap.docs) {
    const job = doc.data()
    const ms = createdAtMillis(job.createdAt)
    if (ms >= latestMs) {
      latestMs = ms
      latest = job
    }
  }

  return {
    text,
    chunkCount,
    totalTokens,
    jobStatus: latest?.status ?? null,
    jobRemaining: latest?.remaining ?? null,
    jobTotal: latest?.total ?? null,
  }
}

// ─── deleteDoc ───────────────────────────────────────────────────────────────

/**
 * Hard-delete a KB document AND all its associated kbChunks.
 *
 * This closes the orphan-chunk gap noted in Phase 1. Deleting without cleaning up
 * kbChunks would leave stale chunks in the collection that could be retrieved if
 * the status filter is ever relaxed or if a future doc reuses the docId.
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to delete.
 */
export async function deleteDoc(user: AuthenticatedUser, docId: string): Promise<void> {
  assertAdmin(user)

  // Delete the kbDocs document
  await kbDocsRef().doc(docId).delete()

  // Hard-delete all associated kbChunks (close the orphan-chunk note from Phase 1)
  const chunksSnap = await kbChunksRef().where('docId', '==', docId).get()
  await Promise.all(chunksSnap.docs.map((chunk) => chunk.ref.delete()))
}

// ─── publishDoc ──────────────────────────────────────────────────────────────

/**
 * Publish a KB document — sets the doc and all its kbChunks to status:'published'.
 *
 * This makes the doc's chunks retrievable by the Coach. Typically called after
 * an admin reviews and approves content, or to re-publish a previously unpublished doc.
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to publish.
 */
export async function publishDoc(user: AuthenticatedUser, docId: string): Promise<void> {
  assertAdmin(user)
  await setDocAndChunksStatus(docId, 'published')
}

// ─── unpublishDoc ─────────────────────────────────────────────────────────────

/**
 * Unpublish a KB document — sets the doc and all its kbChunks to status:'unpublished'.
 *
 * This hides the doc's chunks from retrieval without deleting them, allowing
 * them to be re-published later. Used for content review or temporary removal.
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to unpublish.
 */
export async function unpublishDoc(user: AuthenticatedUser, docId: string): Promise<void> {
  assertAdmin(user)
  await setDocAndChunksStatus(docId, 'unpublished')
}

// ─── markSuperseded ──────────────────────────────────────────────────────────

/**
 * Mark an old KB document and all its chunks as superseded by a new version.
 *
 * TRIGGER CHOICE: Called by the /api/kb/ingest/process Route Handler when the
 * new version's ingestion completes (remaining === 0). This ensures the old doc
 * remains retrievable until the replacement is fully embedded and ready — the Coach
 * can still answer from the old content during the brief ingest window.
 *
 * The Route Handler reads oldDocId from the job doc (kbIngestionJobs.supersedesId)
 * and calls markSuperseded(oldDocId, newDocId) on completion.
 *
 * @param oldDocId  The kbDocs document ID being superseded.
 * @param newDocId  The new version's kbDocs document ID that supersedes it.
 */
export async function markSuperseded(oldDocId: string, newDocId: string): Promise<void> {
  // Update the old kbDoc: mark superseded + record the new doc ID
  await kbDocsRef().doc(oldDocId).update({
    status: 'superseded',
    supersededBy: newDocId,
  })

  // Bulk-update the old kbChunks to superseded so they fall out of retrieval
  const chunksSnap = await kbChunksRef().where('docId', '==', oldDocId).get()
  await Promise.all(chunksSnap.docs.map((chunk) => chunk.ref.update({ status: 'superseded' })))
}

// ─── correctKbDoc ────────────────────────────────────────────────────────────

/**
 * Inline correction path (CDASH-04) — a senior coach corrects KB content.
 *
 * Creates an attributed new KB version (new kbDocs + re-ingest via shardJob),
 * recording the correcting actor's uid in correctedBy. Admin oversight is provided
 * by the versioning chain (supersedesId). The correction goes through the same
 * chunker/pipeline as any other ingest — no privileged bypass (T-02-06).
 *
 * Unlike createDoc/updateDoc/deleteDoc/publishDoc/unpublishDoc, this function
 * is accessible to role 'senior-coach' in addition to 'admin'. All other KB
 * CRUD functions remain admin-only.
 *
 * @param user     Verified user — must have role 'admin' or 'senior-coach'.
 * @param docId    The kbDocs document ID to correct.
 * @param content  The corrected content (plain text; will be re-chunked + embedded).
 * @param opts     Optional lang/pillar overrides.
 * @returns        docId + newDocId + job metadata for the browser poll loop.
 */
export async function correctKbDoc(
  user: AuthenticatedUser,
  docId: string,
  content: string,
  opts?: CorrectKbDocInput,
): Promise<{ docId: string; newDocId?: string; jobId?: string; total?: number; remaining?: number }> {
  assertAdminOrCoach(user)

  // Delegate to updateDoc with correctedBy stamped from the correcting actor's uid.
  // updateDoc validates the existing doc exists and creates the new version.
  // Note: updateDoc uses assertAdmin internally — we bypass it by calling the
  // internal implementation directly below rather than calling updateDoc (which
  // would reject the senior-coach). We replicate the relevant updateDoc logic here.
  const existingSnap = await kbDocsRef().doc(docId).get()
  if (!existingSnap.exists) {
    throw new Error(`correctKbDoc: kbDoc "${docId}" not found`)
  }

  const existing = existingSnap.data()!

  const newDocRef = kbDocsRef().doc()
  const newDocId = newDocRef.id

  const newDocData: Omit<KbDocDoc, 'tenantId'> = {
    title: existing.title,
    sourcePath: `kb/${newDocId}`,
    version: (existing.version ?? 1) + 1,
    supersedesId: docId,
    lang: opts?.lang ?? existing.lang,
    pillar: opts?.pillar ?? existing.pillar,
    status: 'published',
    publishedAt: FieldValue.serverTimestamp(),
    correctedBy: user.uid,
  }

  await newDocRef.set({ ...newDocData, tenantId: TENANT_ID } as KbDocDoc)

  // CKB-01 — attribute + audit the contribution. KB docs are ORG-WIDE knowledge
  // with no per-doc owner field: the downline-accountability control is
  // (a) correctedBy:user.uid stamped above and (b) this append-only audit row, so a
  // senior coach's injected content is traceable via the version chain + audit log.
  // Hashes-only writer (PDPA): we pass identifiers to be hashed, never content.
  await auditLog({
    actorUid: user.uid,
    action: 'kb_contribution',
    targetRef: `kbDocs/${docId}`,
    raw: { contributorUid: user.uid, role: user.role, docId, newDocId },
  })

  const lang = opts?.lang ?? existing.lang
  const pillar = opts?.pillar ?? existing.pillar
  const job = await shardJobForContent(content, newDocId, lang, pillar, docId)

  return { docId, newDocId, jobId: job.jobId, total: job.total, remaining: job.remaining }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Assert admin role. Throws if the user is not an admin.
 * Used for all standard KB CRUD operations (createDoc/updateDoc/deleteDoc/
 * publishDoc/unpublishDoc).
 */
function assertAdmin(user: AuthenticatedUser): void {
  if (user.role !== 'admin') {
    throw new Error('Forbidden: admin role required for KB CRUD operations')
  }
}

/**
 * Assert admin OR senior-coach role.
 * Used exclusively for correctKbDoc (CDASH-04 correction path).
 */
function assertAdminOrCoach(user: AuthenticatedUser): void {
  if (user.role !== 'admin' && user.role !== 'senior-coach') {
    throw new Error('Forbidden: admin or senior-coach role required for KB correction')
  }
}

/**
 * Bulk-update the status of a kbDoc and all its kbChunks.
 * Used by publishDoc and unpublishDoc.
 */
async function setDocAndChunksStatus(
  docId: string,
  status: 'published' | 'unpublished',
): Promise<void> {
  // Update the kbDoc status
  await kbDocsRef().doc(docId).update({ status })

  // Bulk-update all kbChunks for this doc to match
  const chunksSnap = await kbChunksRef().where('docId', '==', docId).get()
  await Promise.all(chunksSnap.docs.map((chunk) => chunk.ref.update({ status })))
}

async function shardJobForContent(
  content: string,
  docId: string,
  lang: 'en' | 'ms' | 'zh',
  pillar: 'coach' | 'finder' | 'reply',
  supersedesId?: string,
): Promise<ShardJobResult> {
  return shardJob({
    buffer: Buffer.from(content, 'utf-8'),
    name: `${docId}.txt`,
    mimeType: 'text/plain',
    docId,
    lang,
    pillar,
    ...(supersedesId ? { supersedesId } : {}),
  })
}
