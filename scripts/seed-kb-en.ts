/**
 * scripts/seed-kb-en.ts
 *
 * Seeds ONE English KB document (the Phase-1 proof-slice content) through the
 * createDoc pipeline, runs full ingestion so its chunks exist in kbChunks,
 * and prints the docId.
 *
 * Purpose: The 01-12 proof slice and the 01-13 Coach-grounding test retrieve
 * against this seeded document. Without it, `rag.retrieve()` returns [] and
 * the Coach cannot cite any KB source.
 *
 * Usage:
 *   npx tsx scripts/seed-kb-en.ts
 *
 * Environment requirements:
 *   - GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY
 *   - FIREBASE_PROJECT_ID
 *   - VOYAGE_API_KEY
 *
 * The script runs the full ingestion in process (not via the poll loop) by
 * calling processBatch repeatedly until remaining === 0. This is intentional
 * for a seed script — the browser loop is for the interactive admin UI.
 *
 * No real PII is included — all content is synthetic D2-flavored training
 * material (see tests/fixtures/seed-kb-en.ts for the source text).
 *
 * References:
 *   - TSD §3.4 (ingestion model)
 *   - D-07 (EN is the proof-slice language)
 *   - 01-10-PLAN.md Task 2 (seed-kb-en.ts)
 *   - tests/fixtures/seed-kb-en.ts (source fixture content)
 */

import { adminDb } from '../src/firebase/admin'
import { kbDocsRef, kbChunksRef, TENANT_ID } from '../src/firebase/collections'
import { shardJob, processBatch } from '../src/kb/ingest/pipeline'
import { seedKbChunksEn, seedKbDocEn } from '../tests/fixtures/seed-kb-en'

/** The full proof-slice text used for seeding (assembled from the fixture chunks) */
const SEED_CONTENT = seedKbChunksEn.map((c) => c.text).join('\n\n')

const SEED_TITLE = seedKbDocEn.title
const SEED_LANG = 'en' as const
const SEED_PILLAR = 'coach' as const

async function seed() {
  console.log('Seeding KB with one English proof-slice document…')
  console.log('Content preview:', SEED_CONTENT.slice(0, 120) + '…')

  // ── Step 1: create the kbDocs document ──────────────────────────────────
  const docRef = kbDocsRef().doc()
  const docId = docRef.id

  const now = new Date()
  await docRef.set({
    tenantId: TENANT_ID,
    title: SEED_TITLE,
    sourcePath: `kb/${docId}`,
    version: 1,
    lang: SEED_LANG,
    pillar: SEED_PILLAR,
    publishedAt: now,
  })

  console.log(`Created kbDocs/${docId}`)

  // ── Step 2: shard the content into a kbIngestionJobs doc ─────────────────
  const job = await shardJob({
    buffer: Buffer.from(SEED_CONTENT, 'utf-8'),
    name: 'seed-kb-en.txt',
    mimeType: 'text/plain',
    docId,
    lang: SEED_LANG,
    pillar: SEED_PILLAR,
  })

  console.log(`Created ingestion job ${job.jobId}: ${job.total} chunks, hash=${job.fileHash.slice(0, 16)}…`)

  if (job.isExisting) {
    console.log('IDEMPOTENT: This file was already seeded (same sha256 hash). Skipping ingestion.')
    console.log(`DOC_ID=${docId}`)
    return
  }

  // ── Step 3: run processBatch in a loop until remaining === 0 ─────────────
  // This is the server-side equivalent of the browser poll loop.
  // In production, the browser calls /api/kb/ingest/process; here we call
  // processBatch directly.
  let { remaining } = job
  const BATCH_LIMIT = 5

  while (remaining > 0) {
    const result = await processBatch(job.jobId, BATCH_LIMIT)
    remaining = result.remaining
    console.log(`  Processed batch: remaining=${remaining}/${job.total}`)
  }

  // ── Step 4: verify the chunks exist ──────────────────────────────────────
  const chunksSnap = await kbChunksRef().where('docId', '==', docId).get()
  console.log(`Verified: ${chunksSnap.docs.length} chunks written to kbChunks for docId=${docId}`)

  console.log('')
  console.log('Seed complete.')
  console.log(`DOC_ID=${docId}`)
  console.log('The Coach agent can now retrieve knowledge from this document via rag.retrieve().')

  // Graceful shutdown
  await adminDb.terminate()
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
