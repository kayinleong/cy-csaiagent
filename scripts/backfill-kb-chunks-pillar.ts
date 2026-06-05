/**
 * scripts/backfill-kb-chunks-pillar.ts
 *
 * One-time / idempotent backfill: stamp a `pillar` value on all existing
 * kbChunks that have no `pillar` field (pre-Phase-4 ingestion did not denormalize
 * pillar onto chunks — see src/firebase/collections.ts KbChunkDoc.pillar and
 * src/kb/ingest/pipeline.ts processBatch, both extended in Plan 04-03).
 *
 * This is required so the 04-03 pillar-filtered retrieval
 * (where('pillar','==','reply')) does not silently exclude existing chunks and so
 * retrieveReplySop never returns Coach onboarding chunks (REPLY-01, Pitfall B).
 *
 * Each chunk's pillar is read from its parent kbDocs/{docId}.pillar. If the parent
 * doc is missing or has no pillar, the chunk defaults to 'coach' (D-08 default —
 * all pre-Reply content is Coach content).
 *
 * IDEMPOTENT: chunks that already carry a `pillar` value are left unchanged
 * (the filter is `pillar === undefined` — it only touches chunks with no pillar).
 * Safe to re-run.
 *
 * SECURITY: Admin-SDK only (service-account); cannot run from a client path.
 * Logs COUNTS ONLY — never chunk text or any PII (global secrets-hygiene rules).
 *
 * Usage:
 *   npx tsx scripts/backfill-kb-chunks-pillar.ts [--dry-run]
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT set in env.
 *   - The target project must be the production D2 Firebase project.
 *
 * NEVER commit this script to a CI pipeline that runs against production automatically.
 * It is a one-time operator script — run once, verify, then retire.
 *
 * References:
 *   - 04-03-PLAN.md Task 2: backfill existing chunks to pillar:'coach' (idempotent)
 *   - 04-RESEARCH.md §Q7 / §Runtime State Inventory: kbChunks.pillar migration
 *   - scripts/backfill-kb-status.ts: the idempotent one-time backfill pattern
 *   - src/firebase/collections.ts: KbChunkDoc.pillar?, KbDocDoc.pillar
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

/** D-08 default: all pre-Reply content is Coach content. */
type Pillar = 'coach' | 'finder' | 'reply'
const DEFAULT_PILLAR: Pillar = 'coach'

// ─── Backfill ─────────────────────────────────────────────────────────────────

async function backfill(): Promise<void> {
  console.log(`[backfill-kb-chunks-pillar] DRY_RUN=${DRY_RUN}`)

  // Cache parent-doc pillars so we do not re-read the same kbDoc per chunk.
  const docPillarCache = new Map<string, Pillar>()

  async function pillarForDoc(docId: string): Promise<Pillar> {
    if (!docId) return DEFAULT_PILLAR
    const cached = docPillarCache.get(docId)
    if (cached !== undefined) return cached
    let pillar: Pillar = DEFAULT_PILLAR
    try {
      const parentSnap = await db.collection('kbDocs').doc(docId).get()
      const parentPillar = parentSnap.exists ? (parentSnap.data()?.pillar as Pillar | undefined) : undefined
      if (parentPillar === 'coach' || parentPillar === 'finder' || parentPillar === 'reply') {
        pillar = parentPillar
      }
    } catch {
      // Defensive: any read error falls back to the coach default (D-08).
      pillar = DEFAULT_PILLAR
    }
    docPillarCache.set(docId, pillar)
    return pillar
  }

  let kbChunksPatched = 0
  let kbChunksSkipped = 0

  console.log('[backfill-kb-chunks-pillar] Fetching kbChunks without pillar...')
  const kbChunksSnap = await db.collection('kbChunks').get()

  for (const chunk of kbChunksSnap.docs) {
    const data = chunk.data()
    // Idempotent: only touch chunks that have NO pillar set.
    if (data.pillar !== undefined) {
      kbChunksSkipped++
      continue
    }
    const docId = (data.docId as string) ?? ''
    const pillar = await pillarForDoc(docId)
    if (!DRY_RUN) {
      await chunk.ref.update({ pillar })
    }
    kbChunksPatched++
    // COUNTS / ids only — never log chunk text or PII.
    console.log(`  kbChunks/${chunk.id} → pillar:${pillar}${DRY_RUN ? ' (dry-run)' : ''}`)
  }

  console.log(
    `[backfill-kb-chunks-pillar] Done. kbChunks patched: ${kbChunksPatched}, already-set skipped: ${kbChunksSkipped}${DRY_RUN ? ' (dry-run — no writes)' : ''}`,
  )
}

backfill().catch((err) => {
  console.error('[backfill-kb-chunks-pillar] Error:', err)
  process.exit(1)
})
