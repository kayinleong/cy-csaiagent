/**
 * scripts/backfill-kb-status.ts
 *
 * One-time / idempotent backfill: stamp status:'published' on all existing
 * kbDocs and kbChunks that have no status field (Phase-1 writers did not set it).
 *
 * This is required so the 02-02 published-only retrieval filter
 * (where('status','==','published')) does not hide already-good content
 * that was ingested before the status field was introduced.
 *
 * IDEMPOTENT: docs/chunks that already have a status value are left unchanged
 * (the filter is `status === undefined` — it only touches documents with no status).
 *
 * Usage:
 *   npx tsx scripts/backfill-kb-status.ts [--dry-run]
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT set in env.
 *   - The target project must be the production D2 Firebase project.
 *
 * NEVER commit this script to a CI pipeline that runs against production automatically.
 * It is a one-time operator script — run once, verify, then retire.
 *
 * References:
 *   - 02-02-PLAN.md Task 1: backfill legacy chunks without a status
 *   - src/firebase/collections.ts: KbDocDoc.status?, KbChunkDoc.status?
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!getApps().length) {
  // Prefer FIREBASE_SERVICE_ACCOUNT JSON env var (CI-friendly)
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT
  if (serviceAccountEnv) {
    initializeApp({ credential: cert(JSON.parse(serviceAccountEnv)) })
  } else {
    // Fall back to GOOGLE_APPLICATION_CREDENTIALS (gcloud auth application-default)
    initializeApp()
  }
}

const db = getFirestore()
const DRY_RUN = process.argv.includes('--dry-run')

// ─── Backfill ─────────────────────────────────────────────────────────────────

async function backfill(): Promise<void> {
  console.log(`[backfill-kb-status] DRY_RUN=${DRY_RUN}`)

  let kbDocsPatched = 0
  let kbChunksPatched = 0

  // 1. Backfill kbDocs without a status field
  console.log('[backfill-kb-status] Fetching kbDocs without status...')
  const kbDocsSnap = await db.collection('kbDocs').get()

  for (const doc of kbDocsSnap.docs) {
    const data = doc.data()
    if (data.status === undefined) {
      if (!DRY_RUN) {
        await doc.ref.update({ status: 'published' })
      }
      kbDocsPatched++
      console.log(`  kbDocs/${doc.id} → status:published${DRY_RUN ? ' (dry-run)' : ''}`)
    }
  }

  // 2. Backfill kbChunks without a status field
  console.log('[backfill-kb-status] Fetching kbChunks without status...')
  const kbChunksSnap = await db.collection('kbChunks').get()

  for (const chunk of kbChunksSnap.docs) {
    const data = chunk.data()
    if (data.status === undefined) {
      if (!DRY_RUN) {
        await chunk.ref.update({ status: 'published' })
      }
      kbChunksPatched++
      console.log(`  kbChunks/${chunk.id} → status:published${DRY_RUN ? ' (dry-run)' : ''}`)
    }
  }

  console.log(
    `[backfill-kb-status] Done. kbDocs patched: ${kbDocsPatched}, kbChunks patched: ${kbChunksPatched}${DRY_RUN ? ' (dry-run — no writes)' : ''}`,
  )
}

backfill().catch((err) => {
  console.error('[backfill-kb-status] Error:', err)
  process.exit(1)
})
