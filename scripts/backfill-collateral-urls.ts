/**
 * scripts/backfill-collateral-urls.ts — quick-kayinleong-050
 *
 * Backfills `externalUrl` onto the ~11,774 `collateral` docs that hold a Firebase
 * Storage bucket key (`storagePath`) and nothing web-addressable.
 *
 * WHY
 * ---
 * `app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx` discarded the
 * `uploadBytes` result, so every WhatsApp-ingested brochure / sales kit / FAQ was
 * written with `storagePath` only. Nothing in this repo ever resolved a bucket key
 * to a URL, so `src/agents/finder/tools.ts` handed the model a raw key like
 * `collateral/<pid>/whatsapp/brochure.pdf`, which rendered as dead text in chat and
 * as a relative (404) href on the Finder card. The ingestion path is now fixed; this
 * script repairs the docs already written.
 *
 * HOW THE URL IS PRODUCED (no IAM signing, no expiry)
 * ---------------------------------------------------
 * Objects uploaded through the Firebase **web** SDK are stamped with a
 * `firebaseStorageDownloadTokens` custom-metadata value. The canonical download URL
 * that `getDownloadURL()` returns is a pure function of (bucket, object path, token):
 *
 *   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded path>?alt=media&token=<token>
 *
 * So the Admin SDK only needs ONE metadata read per object — no `getSignedUrl`, no
 * `iam.serviceAccountTokenCreator`, no expiring URL that would re-break the link later.
 * This stays inside the Firebase Admin SDK surface (no GCP expansion, no Drive API).
 *
 * SAFETY
 * ------
 *   - DRY-RUN BY DEFAULT. `--apply` is required to write anything.
 *   - Idempotent + resumable: docs that already have a usable `externalUrl` are
 *     skipped, and a ledger records every doc already handled.
 *   - Bounded concurrency (default 8) — never 11,774 parallel metadata reads.
 *   - Missing objects and token-less objects are counted and reported, never fatal.
 *   - Logs COUNTS + object PATHS only. Download tokens are capability secrets and are
 *     ALWAYS redacted in output (global secrets-hygiene rule) — the URL shape is still
 *     visible so a dry run proves what would be written.
 *
 * ⚠ ACCESS-MODEL NOTE (Derek sign-off, see RESEARCH-collateral.md § Security tradeoff):
 * a Firebase download URL is an unguessable **capability URL** that BYPASSES
 * `storage.rules`. Persisting it makes the object effectively link-public. That is
 * almost certainly intended (agents forward brochures to leads who have no D2 account),
 * but it is an explicit widening of access over today's `allow read: if isSignedIn()`.
 *
 * USAGE
 * -----
 *   npx tsx --env-file=.env.local scripts/backfill-collateral-urls.ts                 # dry-run, all docs
 *   npx tsx --env-file=.env.local scripts/backfill-collateral-urls.ts --limit 20      # dry-run, 20 candidates
 *   npx tsx --env-file=.env.local scripts/backfill-collateral-urls.ts --apply         # WRITE
 *   ... --concurrency 8        # metadata reads in flight (default 8)
 *   ... --mint-tokens          # with --apply: give token-less objects a new token
 *
 * ENV
 * ---
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) — target bucket
 *   Firebase credentials resolve through the app's normal ADC path (src/firebase/admin).
 *   BACKFILL_COLLATERAL_LEDGER — override the ledger path (defaults to the OS temp dir
 *   so a run never leaves an untracked file in the repo).
 *
 * Operator script: run it, verify, retire it. Never wire into CI against production.
 */

import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { adminDb } from '@/src/firebase/admin'
import { getStorage } from 'firebase-admin/storage'

// ─── Flags ────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply')
const MINT_TOKENS = process.argv.includes('--mint-tokens')

function numFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const LIMIT = numFlag('--limit', Number.POSITIVE_INFINITY)
const CONCURRENCY = Math.min(numFlag('--concurrency', 8), 32)
const PAGE_SIZE = 500

const LEDGER =
  process.env.BACKFILL_COLLATERAL_LEDGER ||
  path.join(os.tmpdir(), 'backfill-collateral-urls-ledger.json')

const BUCKET_NAME = (
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  ''
).replace(/^gs:\/\//, '')

const TAG = '[backfill-collateral-urls]'

// ─── URL construction ─────────────────────────────────────────────────────────

/**
 * Build the canonical Firebase download URL for an object path + token.
 * Byte-identical to what the web SDK's `getDownloadURL()` returns.
 */
function downloadUrlFor(bucket: string, objectPath: string, token: string): string {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucket}` +
    `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
  )
}

/**
 * Strip the download token before anything reaches a log. The token is a capability
 * secret — anyone holding it can read the object. The redacted form still shows the
 * bucket, the encoded path and the token length, which is what a dry run needs to prove.
 */
function redactToken(url: string): string {
  return url.replace(/([?&]token=)([^&]+)/, (_m, p1: string, tok: string) => `${p1}<redacted:${tok.length}>`)
}

/** True only for a complete http(s) URL — mirrors the guard in src/agents/finder/tools.ts. */
function isWebAddressable(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// ─── Ledger (idempotent + resumable) ──────────────────────────────────────────

type Status =
  | 'backfilled'
  | 'would-backfill'
  | 'missing-object'
  | 'no-token'
  | 'error'

interface LedgerFile {
  updatedAt: string
  applied: boolean
  /** docId → terminal status of the last attempt. */
  entries: Record<string, Status>
}

function loadLedger(): LedgerFile {
  if (!existsSync(LEDGER)) return { updatedAt: '', applied: APPLY, entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(LEDGER, 'utf8')) as LedgerFile
    return { updatedAt: parsed.updatedAt ?? '', applied: APPLY, entries: parsed.entries ?? {} }
  } catch {
    console.warn(`${TAG} ledger unreadable — starting a fresh one at ${LEDGER}`)
    return { updatedAt: '', applied: APPLY, entries: {} }
  }
}

function saveLedger(ledger: LedgerFile): void {
  ledger.updatedAt = new Date().toISOString()
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
}

// ─── Counters ─────────────────────────────────────────────────────────────────

const stats = {
  scanned: 0,
  alreadyUrl: 0,
  noStoragePath: 0,
  candidates: 0,
  resumeSkipped: 0,
  backfilled: 0,
  wouldBackfill: 0,
  missingObject: 0,
  noToken: 0,
  mintedTokens: 0,
  errors: 0,
}

// ─── Per-doc work ─────────────────────────────────────────────────────────────

interface Candidate {
  docId: string
  storagePath: string
}

/**
 * Read the object's metadata, reconstruct its download URL, and (with --apply)
 * write it to `collateral/{docId}.externalUrl`.
 *
 * Every failure mode is classified and counted — a missing object or a token-less
 * object must not abort a 12k-document run.
 */
async function processCandidate(
  bucketHandle: ReturnType<ReturnType<typeof getStorage>['bucket']>,
  c: Candidate,
  sampleSink: string[],
): Promise<Status> {
  const file = bucketHandle.file(c.storagePath)

  let meta: Record<string, unknown>
  try {
    const [m] = await file.getMetadata()
    meta = m as unknown as Record<string, unknown>
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code === 404) {
      // The collateral doc points at an object that is not in the bucket. Nothing
      // can be constructed; leave the doc untouched so the tools.ts guard omits it.
      stats.missingObject += 1
      console.log(`  ! missing object — ${c.storagePath}`)
      return 'missing-object'
    }
    stats.errors += 1
    console.log(`  x metadata error (${code ?? 'n/a'}) — ${c.storagePath}`)
    return 'error'
  }

  const custom = (meta.metadata ?? {}) as Record<string, unknown>
  const rawTokens = typeof custom.firebaseStorageDownloadTokens === 'string'
    ? custom.firebaseStorageDownloadTokens
    : ''
  let token = rawTokens.split(',')[0]?.trim() ?? ''

  if (!token) {
    // Object exists but was never given a download token (e.g. written by a server
    // SDK rather than the web SDK). Reconstructing a URL is impossible without one.
    if (APPLY && MINT_TOKENS) {
      token = randomUUID()
      try {
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
        stats.mintedTokens += 1
      } catch (err) {
        stats.errors += 1
        console.log(`  x could not mint token — ${c.storagePath}: ${(err as Error).message.slice(0, 120)}`)
        return 'error'
      }
    } else {
      stats.noToken += 1
      console.log(
        `  ~ no download token — ${c.storagePath}` +
          (APPLY ? ' (re-run with --mint-tokens to grant one)' : ''),
      )
      return 'no-token'
    }
  }

  const url = downloadUrlFor(BUCKET_NAME, c.storagePath, token)
  if (sampleSink.length < 3) sampleSink.push(redactToken(url))

  if (!APPLY) {
    stats.wouldBackfill += 1
    console.log(`  ✓ would set externalUrl — ${c.storagePath}`)
    return 'would-backfill'
  }

  try {
    // Only `externalUrl` is written. storagePath stays as the canonical object identity.
    await adminDb.collection('collateral').doc(c.docId).update({ externalUrl: url })
    stats.backfilled += 1
    console.log(`  ✓ collateral/${c.docId} ← externalUrl (${c.storagePath})`)
    return 'backfilled'
  } catch (err) {
    stats.errors += 1
    console.log(`  x Firestore update failed — collateral/${c.docId}: ${(err as Error).message.slice(0, 120)}`)
    return 'error'
  }
}

/** Fixed-size worker pool — bounds in-flight metadata reads against the bucket. */
async function runPool(
  items: Candidate[],
  worker: (c: Candidate) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!BUCKET_NAME) {
    throw new Error(
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) is not set — cannot build download URLs.',
    )
  }
  if (MINT_TOKENS && !APPLY) {
    console.log(`${TAG} --mint-tokens is ignored without --apply (dry-run writes nothing).`)
  }

  console.log(`${TAG} mode=${APPLY ? 'APPLY (writes Firestore)' : 'DRY-RUN (no writes)'}`)
  console.log(`${TAG} bucket=${BUCKET_NAME} concurrency=${CONCURRENCY} limit=${LIMIT}`)
  console.log(`${TAG} ledger=${LEDGER}`)
  console.log('')

  const ledger = loadLedger()
  const bucketHandle = getStorage().bucket(BUCKET_NAME)
  const samples: string[] = []

  // Page through `collateral` by document id. Firestore cannot query for a MISSING
  // field, so candidate selection happens client-side on each page.
  let cursor: string | null = null
  let processed = 0

  for (;;) {
    let q = adminDb
      .collection('collateral')
      .orderBy('__name__')
      .limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)

    const page = await q.get()
    if (page.empty) break
    cursor = page.docs[page.docs.length - 1].id

    const candidates: Candidate[] = []
    for (const doc of page.docs) {
      stats.scanned += 1
      const data = doc.data() as { storagePath?: unknown; externalUrl?: unknown }

      if (isWebAddressable(data.externalUrl)) {
        stats.alreadyUrl += 1
        continue
      }
      const storagePath = typeof data.storagePath === 'string' ? data.storagePath.trim() : ''
      if (!storagePath) {
        // Neither field usable — nothing this script can do.
        stats.noStoragePath += 1
        continue
      }
      stats.candidates += 1

      // Resume: a previous run already reached a terminal verdict for this doc.
      const prior = ledger.entries[doc.id]
      if (prior === 'backfilled' || (!APPLY && prior === 'would-backfill')) {
        stats.resumeSkipped += 1
        continue
      }

      if (processed + candidates.length >= LIMIT) break
      candidates.push({ docId: doc.id, storagePath })
    }

    if (candidates.length > 0) {
      await runPool(candidates, async (c) => {
        const status = await processCandidate(bucketHandle, c, samples)
        ledger.entries[c.docId] = status
      })
      processed += candidates.length
      saveLedger(ledger)
    }

    if (processed >= LIMIT) break
    if (page.size < PAGE_SIZE) break
  }

  saveLedger(ledger)

  console.log('')
  console.log(`${TAG} ── summary ──`)
  console.log(`  scanned docs            : ${stats.scanned}`)
  console.log(`  already had a URL       : ${stats.alreadyUrl}`)
  console.log(`  no storagePath at all   : ${stats.noStoragePath}`)
  console.log(`  candidates seen         : ${stats.candidates}`)
  console.log(`  skipped (ledger resume) : ${stats.resumeSkipped}`)
  console.log(`  processed this run      : ${processed}`)
  console.log(`  ${APPLY ? 'backfilled              ' : 'would backfill          '}: ${APPLY ? stats.backfilled : stats.wouldBackfill}`)
  console.log(`  missing object (404)    : ${stats.missingObject}`)
  console.log(`  no download token       : ${stats.noToken}`)
  if (APPLY && MINT_TOKENS) console.log(`  tokens minted           : ${stats.mintedTokens}`)
  console.log(`  errors                  : ${stats.errors}`)
  if (samples.length > 0) {
    console.log('')
    console.log(`${TAG} sample URL shape (token redacted — it is a capability secret):`)
    for (const s of samples) console.log(`  ${s}`)
  }
  console.log('')
  console.log(
    `${TAG} ${APPLY ? 'APPLIED' : 'DRY-RUN COMPLETE — nothing was written. Re-run with --apply to write.'}`,
  )
}

main().catch((err) => {
  console.error(`${TAG} fatal:`, err instanceof Error ? err.message : err)
  process.exit(1)
})
