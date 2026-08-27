/**
 * src/kb/ingest/pipeline.ts
 *
 * Chunked, idempotent KB ingestion pipeline.
 *
 * Two-function API:
 *
 *   shardJob(file) — uploads intent:
 *     1. Compute sha256(buffer) as the idempotency key.
 *     2. Query kbIngestionJobs for an existing job with the same fileHash.
 *     3. If found: return the existing job's metadata (idempotent — no duplicate).
 *     4. If not found: chunk the text, create a kbIngestionJobs/{jobId} doc with
 *        total=chunkCount, remaining=total, status:'pending', and all chunkTexts.
 *
 *   processBatch(jobId, limit) — poll worker:
 *     1. Read the kbIngestionJobs/{jobId} doc.
 *     2. Take the first `limit` unprocessed chunk texts (chunkTexts[:remaining] tail).
 *     3. For each chunk: embedText(text, {inputType:'document'}) → write to kbChunks.
 *     4. Decrement remaining in the job doc.
 *     5. When remaining === 0: set status:'complete' on both the job and the kbDoc.
 *     6. Return { remaining }.
 *
 * ANTI-PATTERNS AVOIDED (TSD §3.4 + RESEARCH §Anti-Patterns):
 *   - Never embed a large file in one request (Cloud Run timeout trap).
 *   - Never do embedding inside after() — this is the caller Route Handler.
 *   - Never run unbounded work in a single call.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { FieldValue } from 'firebase-admin/firestore'
import crypto from 'crypto'
import { kbIngestionJobsRef, kbChunksRef, kbDocsRef, TENANT_ID } from '@/src/firebase/collections'
import { embedText } from '@/src/rag/embed'
import { chunk } from '@/src/kb/ingest/chunker'
import { extractText } from '@/src/kb/ingest/pdf'
import { countTokens } from 'gpt-tokenizer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IngestFile {
  /** Raw file bytes */
  buffer: Buffer
  /** File name (for mime-type detection if mimeType not provided) */
  name: string
  /** MIME type of the file */
  mimeType: string
  /** The kbDocs/{docId} this file belongs to */
  docId: string
  /** Language of the document */
  lang: 'en' | 'ms' | 'zh'
  /** Which pillar this KB document belongs to */
  pillar: 'coach' | 'finder' | 'reply'
  /** If this is a NEW VERSION, the old kbDoc ID to mark superseded on ingest completion. */
  supersedesId?: string
}

export interface ShardJobResult {
  jobId: string
  fileHash: string
  total: number
  remaining: number
  status: 'pending' | 'processing' | 'complete' | 'error'
  /** true if an existing job with the same hash was found (idempotent re-use) */
  isExisting: boolean
}

export interface ProcessBatchResult {
  remaining: number
}

// ─── shardJob ─────────────────────────────────────────────────────────────────

/**
 * Shard a file into a kbIngestionJobs document.
 *
 * Idempotent: if a job with the same sha256 fileHash already exists,
 * returns its metadata without creating a duplicate job or chunks.
 *
 * @param file   File buffer + metadata.
 * @returns      Job metadata: jobId, fileHash, total, remaining, status.
 */
/**
 * An ingestion failure whose message is SAFE to show the user (quick-kayinleong-060).
 *
 * The process Route Handler echoes only this class's message; anything else becomes a
 * generic 500, because a raw Firestore error carries the internal database path.
 */
export class IngestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestionError'
  }
}

export async function shardJob(file: IngestFile): Promise<ShardJobResult> {
  // Step 1: compute sha256 idempotency key
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex')

  // Step 2: check for existing job with the same hash (idempotency)
  const existingSnap = await kbIngestionJobsRef()
    .where('fileHash', '==', fileHash)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]
    const data = existingDoc.data()

    // The SAME file is being ingested for a DIFFERENT kbDoc (quick-kayinleong-060).
    // Delete a KB doc and re-upload its file and you land here: createDocFromFile has
    // already made a NEW kbDoc, but this short-circuit used to hand back the old job
    // still bound to the DELETED one. Chunks were then embedded against a dangling docId,
    // the new doc stayed empty, and the completion update() died with
    // "5 NOT_FOUND: No document to update: …/kbDocs/…".
    //
    // Re-point the job instead of returning it as-is. The expensive part — text extraction
    // and chunking — is already stored in chunkTexts, so this keeps the idempotency win
    // while making the job describe the ingestion actually being asked for.
    if (data.docId !== file.docId) {
      await existingDoc.ref.update({
        docId: file.docId,
        lang: file.lang,
        pillar: file.pillar,
        remaining: data.total,
        status: 'pending',
        // supersedesId belongs to THIS request; a stale one would retire the wrong doc.
        supersedesId: file.supersedesId ?? FieldValue.delete(),
      })
      return {
        jobId: existingDoc.id,
        fileHash,
        total: data.total,
        remaining: data.total,
        status: 'pending',
        isExisting: true,
      }
    }

    // Genuine idempotency: same file, same target doc (a double submit).
    return {
      jobId: existingDoc.id,
      fileHash,
      total: data.total,
      remaining: data.remaining,
      status: data.status,
      isExisting: true,
    }
  }

  // Step 3: extract text from the file (pass name for extension-first dispatch)
  const { text } = await extractText(file.buffer, file.mimeType, file.name)

  // Step 4: chunk the text
  const chunks = chunk(text)
  const chunkTexts = chunks.map((c) => c.text)
  const total = chunkTexts.length

  if (total === 0) {
    throw new Error(`shardJob: no chunks produced from file "${file.name}" — empty or unparseable content`)
  }

  // Step 5: create the kbIngestionJobs document
  // Use a deterministic job ID based on fileHash to make the creation idempotent
  const jobId = `job-${fileHash.slice(0, 16)}`

  const jobDoc = {
    fileHash,
    total,
    remaining: total,
    status: 'pending' as const,
    chunkTexts,
    docId: file.docId,
    lang: file.lang,
    pillar: file.pillar,
    // Carry the supersede target so processBatch can retire the old version on completion.
    ...(file.supersedesId ? { supersedesId: file.supersedesId } : {}),
    tenantId: TENANT_ID,
    createdAt: new Date(),
  }

  await kbIngestionJobsRef().doc(jobId).set(jobDoc)

  return {
    jobId,
    fileHash,
    total,
    remaining: total,
    status: 'pending',
    isExisting: false,
  }
}

// ─── processBatch ─────────────────────────────────────────────────────────────

/**
 * Process the next `limit` unembedded chunks for a given job.
 *
 * This is the function called by the /api/kb/ingest/process Route Handler
 * on each browser poll. It processes exactly `limit` chunks, writes them
 * to kbChunks, decrements remaining, and marks the job/doc complete when done.
 *
 * NEVER call this inside after() — it must run synchronously in the Route
 * Handler so the response carries the updated `remaining` count.
 *
 * @param jobId   The kbIngestionJobs document ID.
 * @param limit   Maximum chunks to process in this call.
 * @returns       { remaining } — the poll client loops until remaining === 0.
 */
export async function processBatch(jobId: string, limit: number): Promise<ProcessBatchResult> {
  // Read the job document
  const jobDoc = kbIngestionJobsRef().doc(jobId)
  const jobSnap = await jobDoc.get()

  if (!jobSnap.exists) {
    throw new Error(`processBatch: job "${jobId}" not found`)
  }

  const jobData = jobSnap.data()!
  const {
    chunkTexts,
    remaining,
    total,
    docId,
    lang,
    pillar,
    supersedesId,
  } = jobData

  if (remaining <= 0) {
    return { remaining: 0 }
  }

  // Determine the slice of chunks to process in this batch.
  // chunkTexts is the full array (index 0 = first chunk).
  // Already-processed chunks are the first (total - remaining).
  const processedCount = total - remaining
  const batchTexts = chunkTexts.slice(processedCount, processedCount + limit)
  const batchSize = batchTexts.length

  // Embed and write each chunk
  const chunksRef = kbChunksRef()
  for (let i = 0; i < batchSize; i++) {
    const text = batchTexts[i]
    const chunkIndex = processedCount + i

    // Embed via Gemini gemini-embedding-001 (document inputType for KB chunks, per TSD §2.3)
    const embedding = await embedText(text, {
      inputType: 'document',
    })

    const tokens = countTokens(text)

    // status:'published' — new ingests are published once embedded (Pitfall 3 fix, 02-02).
    // pillar — denormalized from the parent job/kbDoc so retrieveReplySop can pre-filter
    // findNearest by pillar (REPLY-01, 04-03 / 04-RESEARCH §Q7). Both fields are
    // denormalized from the parent kbDoc and must stay in sync on publish/supersede/unpublish
    // (see src/kb/crud.ts markSuperseded / publishDoc / unpublishDoc).
    await chunksRef.add({
      docId,
      text,
      lang,
      pillar,
      ownerCollection: 'kbDocs',
      // FieldValue.vector(), NOT the bare array (quick-kayinleong-066). A Firestore vector
      // index only covers fields stored as the VECTOR type — a plain number[] is silently
      // skipped, so findNearest returns zero rows with no error anywhere and every Coach
      // and Reply retrieval reports kb_miss. All 25,167 chunks written before this line
      // changed were invisible to the index.
      embedding: FieldValue.vector(embedding),
      tokens,
      tenantId: TENANT_ID,
      chunkIndex,
      status: 'published' as const,
    })
  }

  const newRemaining = remaining - batchSize

  // Update the job document
  if (newRemaining <= 0) {
    // Job is complete — mark both the job and the kbDoc
    await jobDoc.update({ remaining: 0, status: 'complete' })

    // Also mark the kbDoc as published (its chunks are now retrievable).
    // Checked rather than blind-updated (quick-kayinleong-060): the doc can be deleted
    // while its chunks are still embedding, and a raw Firestore NOT_FOUND reached the
    // browser verbatim — including the internal projects/…/databases/… path.
    if (docId) {
      const target = kbDocsRef().doc(docId)
      if ((await target.get()).exists) {
        await target.update({ publishedAt: new Date() })
      } else {
        await jobDoc.update({ status: 'error' })
        throw new IngestionError(
          'The knowledge-base document for this upload no longer exists. Re-upload the file to start a fresh ingestion.',
        )
      }
    }

    // New version is fully embedded → retire the old version it supersedes so the
    // Coach stops retrieving stale chunks (CDASH-04/ADMIN-03). Inlined here (rather
    // than importing crud.markSuperseded) to avoid a circular import: crud → pipeline.
    if (supersedesId && supersedesId !== docId) {
      await kbDocsRef().doc(supersedesId).update({
        status: 'superseded',
        supersededBy: docId,
      })
      const oldChunks = await kbChunksRef().where('docId', '==', supersedesId).get()
      await Promise.all(
        oldChunks.docs.map((chunk) => chunk.ref.update({ status: 'superseded' })),
      )
    }

    return { remaining: 0 }
  } else {
    await jobDoc.update({ remaining: newRemaining, status: 'processing' })
    return { remaining: newRemaining }
  }
}
