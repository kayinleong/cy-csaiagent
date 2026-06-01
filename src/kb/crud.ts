/**
 * src/kb/crud.ts
 *
 * KB document CRUD operations — admin-only.
 *
 * Supports multi-doc KB management with versioning:
 *   - createDoc: create a new kbDocs document.
 *   - updateDoc: create a new version that supersedes an existing doc.
 *   - listDocs:  list all kbDocs for the tenant.
 *   - deleteDoc: soft-delete a kbDocs document.
 *
 * All mutations:
 *   - Write via kbDocsRef() (tenantId stamped automatically by the converter).
 *   - Guard on admin role — callers pass the verified requireUser result;
 *     Server Actions re-check the role before calling these functions.
 *
 * IMPORTANT: createDoc and updateDoc chunk the content and trigger ingestion
 * via shardJob(). Full embedding of the chunks is deferred to the browser-
 * driven /api/kb/ingest/process poll loop (TSD §3.4).
 *
 * References:
 *   - TSD §4 kbDocs (versioned, supersedesId, only published chunks retrievable)
 *   - TSD §5.1 roles (admin CRUD)
 *   - 01-10-PLAN.md Task 2 action
 *   - D-10: multi-doc-capable
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { kbDocsRef, TENANT_ID, type KbDocDoc } from '@/src/firebase/collections'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { shardJob, type ShardJobResult } from '@/src/kb/ingest/pipeline'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDocInput {
  title: string
  /** Plain text content (will be chunked + ingested) */
  content: string
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'
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

  // Create the kbDocs document (unpublished until ingestion completes)
  const docRef = kbDocsRef().doc()
  const docId = docRef.id

  const docData: Omit<KbDocDoc, 'tenantId'> = {
    title: input.title,
    sourcePath: `kb/${docId}`,
    version: 1,
    lang: input.lang,
    pillar: input.pillar,
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

  // Create the kbDocs document (unpublished until ingestion completes)
  const docRef = kbDocsRef().doc()
  const docId = docRef.id

  const docData: Omit<KbDocDoc, 'tenantId'> = {
    title: input.title,
    sourcePath: `kb/${docId}/${input.file.name}`,
    version: 1,
    lang: input.lang,
    pillar: input.pillar,
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

// ─── updateDoc ───────────────────────────────────────────────────────────────

/**
 * Update a KB document by creating a new version that supersedes the existing one.
 *
 * If `content` is provided, a new ingestion job is created to re-embed the content.
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to update.
 * @param patch  Fields to update.
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

    const newDocData: Omit<KbDocDoc, 'tenantId'> = {
      title: patch.title ?? existing.title,
      sourcePath: `kb/${newDocId}`,
      version: (existing.version ?? 1) + 1,
      supersedesId: docId,
      lang: patch.lang ?? existing.lang,
      pillar: patch.pillar ?? existing.pillar,
      publishedAt: FieldValue.serverTimestamp(),
    }

    await newDocRef.set({ ...newDocData, tenantId: TENANT_ID } as KbDocDoc)

    // Shard the new content
    const lang = patch.lang ?? existing.lang
    const pillar = patch.pillar ?? existing.pillar
    const job = await shardJobForContent(patch.content, newDocId, lang, pillar)

    return { docId, newDocId, jobId: job.jobId, total: job.total, remaining: job.remaining }
  } else {
    // Metadata-only update (no new ingestion needed)
    const metaPatch: Partial<KbDocDoc> = {}
    if (patch.title !== undefined) metaPatch.title = patch.title
    if (patch.lang !== undefined) metaPatch.lang = patch.lang
    if (patch.pillar !== undefined) metaPatch.pillar = patch.pillar

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

// ─── deleteDoc ───────────────────────────────────────────────────────────────

/**
 * Delete a KB document (hard delete — removes the kbDocs/{docId} doc).
 *
 * Note: associated kbChunks are NOT automatically deleted in v1 (Phase 2
 * cleanup job). The doc removal means the chunks will not be retrievable
 * because retrieval is keyed by docId in kbChunks.
 *
 * @param user   Verified user from requireUser() — must have role 'admin'.
 * @param docId  The kbDocs document ID to delete.
 */
export async function deleteDoc(user: AuthenticatedUser, docId: string): Promise<void> {
  assertAdmin(user)
  await kbDocsRef().doc(docId).delete()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertAdmin(user: AuthenticatedUser): void {
  if (user.role !== 'admin') {
    throw new Error('Forbidden: admin role required for KB CRUD operations')
  }
}

async function shardJobForContent(
  content: string,
  docId: string,
  lang: 'en' | 'ms' | 'zh',
  pillar: 'coach' | 'finder' | 'reply',
): Promise<ShardJobResult> {
  return shardJob({
    buffer: Buffer.from(content, 'utf-8'),
    name: `${docId}.txt`,
    mimeType: 'text/plain',
    docId,
    lang,
    pillar,
  })
}
