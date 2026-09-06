/**
 * scripts/ingest-whatsapp-archives.ts — ingest the raw WhatsApp .zip archives held in
 * Cloud Storage under `whatsapp-imports/` (quick-kayinleong-089).
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin WhatsApp-import surface is browser-driven: JSZip parses the export in the tab,
 * then the client drives `createKbDocAction` + `/api/kb/ingest/process`. That is the right
 * shape for one chat. It is not the shape for 75 archives totalling 9.5 GB — a single
 * 621 MB export would have to cross the browser twice.
 *
 * quick-088 made the form archive every uploaded .zip to Storage first. This script is the
 * server-side counterpart: it reads those archives back, extracts the transcript, and pushes
 * it through the SAME pipeline the browser uses (`createDoc` → `processBatch` to completion),
 * so there is one ingestion path and one set of invariants, not two.
 *
 * WHAT IT INGESTS
 * ---------------
 * The `_chat.txt` transcript ONLY. Media is deliberately out of scope: it is the overwhelming
 * majority of those 9.5 GB and contributes nothing to retrieval, which searches text. The
 * browser form still attaches media as collateral for a single chat when an operator wants it.
 *
 * IDEMPOTENCY — three independent layers, because re-running this must be safe:
 *   1. An archive whose matching kbDoc already has chunks is SKIPPED.
 *   2. `shardJob` keys on the sha256 of the file bytes, so an identical transcript re-uses
 *      the existing job instead of creating duplicate chunks.
 *   3. A kbDoc that exists with ZERO chunks (34 of them do — a prior import created the doc
 *      and no chunk ever followed) is DELETED before re-ingesting, so the retry does not
 *      leave a second empty doc beside the first.
 *
 * DRY RUN by default.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/ingest-whatsapp-archives.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/ingest-whatsapp-archives.ts --apply
 *   … --apply --only lunar          # one archive
 *   … --apply --limit 5             # smallest five first, to validate end to end
 *
 * Flags:
 *   --apply          actually write (default: dry run)
 *   --only <substr>  restrict to archives whose name contains this (case-insensitive)
 *   --limit <n>      stop after n archives
 *   --largest-first  process big archives first (default: SMALLEST first, so a run that is
 *                    going to fail fails cheaply and early)
 *   --force          ingest even when the kbDoc already has chunks
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY (embeddings) and admin credentials.
 *
 * MEMORY: JSZip loads a whole archive into memory. The largest here is ~622 MB, which fits
 * in Node's default heap but not comfortably beside another. Archives are therefore processed
 * strictly sequentially and the buffer is dropped before the next one. If you hit a heap
 * error, run with NODE_OPTIONS=--max-old-space-size=8192.
 *
 * PDPA: transcripts contain participant names and phone numbers. This script prints only
 * archive names, counts and sizes — never message content. The text it writes to the KB is
 * the same text the admin form already writes; this changes the transport, not the policy.
 */

import { getStorage } from 'firebase-admin/storage'
import { adminDb } from '@/src/firebase/admin'
import { createDoc, deleteDoc } from '@/src/kb/crud'
import { processBatch } from '@/src/kb/ingest/pipeline'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { parseWhatsApp, toTranscript } from '@/src/whatsapp/parse'
import JSZip from 'jszip'

const PREFIX = 'whatsapp-imports/'
/** Chunks embedded per processBatch call — the bounded shape the browser poller uses. */
const BATCH = 5
/** Server Action body cap does not apply here, but a single doc past this is a red flag. */
const MAX_TRANSCRIPT_CHARS = 5_000_000

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')
const LARGEST_FIRST = args.includes('--largest-first')
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1]?.toLowerCase() : null
const limIdx = args.indexOf('--limit')
const LIMIT = limIdx !== -1 ? Number(args[limIdx + 1]) : Infinity

const human = (b: number) => {
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(b || 1) / Math.log(1024)), 3)
  return `${(b / 1024 ** i).toFixed(1)}${u[i]}`
}

/**
 * Recover a project name from the archive filename.
 *
 * The browser form gets this from an LLM classification the operator confirms. A bulk run
 * has no operator, so it is derived deterministically from the filename instead — which is
 * why an existing kbDoc's title always WINS over this (see resolveTitle). Never let a
 * derived name silently rename a document a human already titled.
 */
function projectFromArchive(objectName: string): string {
  return objectName
    .slice(PREFIX.length)
    .replace(/^.*?__/, '')
    .replace(/\.zip$/i, '')
    .replace(/^\(Done\)\s*/i, '')
    .replace(/^_?Done_?\s*/i, '')
    .replace(/^WhatsApp Chat with\s*/i, '')
    .replace(/\bD2\s*[_&]?\s*Co\.?\b/gi, '')
    .replace(/\bD2\b/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Target {
  object: string
  size: number
  project: string
  /** Existing kbDoc with a matching title, if any. */
  existing: { id: string; title: string; chunks: number } | null
}

async function main() {
  console.log('═══ WhatsApp archive ingest ═══')
  console.log(`  mode:  ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  order: ${LARGEST_FIRST ? 'largest first' : 'smallest first'}`)
  if (ONLY) console.log(`  only:  "${ONLY}"`)
  console.log()

  if (APPLY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error('GOOGLE_GENERATIVE_AI_API_KEY is not set — embedding would fail. Aborting.')
    process.exit(1)
  }

  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  if (!bucketName) {
    console.error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set. Aborting.')
    process.exit(1)
  }
  const bucket = getStorage().bucket(bucketName)

  // ─── existing WhatsApp kbDocs + their chunk counts ──────────────────────────
  const docsSnap = await adminDb.collection('kbDocs').get()
  const chunkCounts = new Map<string, number>()
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let q = adminDb.collection('kbChunks').select('docId').orderBy('__name__').limit(2000)
    if (cursor) q = q.startAfter(cursor)
    const s = await q.get()
    if (s.empty) break
    for (const d of s.docs) {
      const id = String(d.get('docId'))
      chunkCounts.set(id, (chunkCounts.get(id) ?? 0) + 1)
    }
    cursor = s.docs[s.docs.length - 1]
    if (s.size < 2000) break
  }
  const waDocs = docsSnap.docs
    .filter((d) => String((d.data() as { title?: string }).title ?? '').startsWith('WhatsApp —'))
    .map((d) => ({
      id: d.id,
      title: String((d.data() as { title?: string }).title),
      key: String((d.data() as { title?: string }).title).replace(/^WhatsApp —\s*/, '').toLowerCase(),
      chunks: chunkCounts.get(d.id) ?? 0,
    }))

  const matchExisting = (project: string) => {
    const key = project.toLowerCase()
    const exact = waDocs.find((d) => d.key === key)
    if (exact) return exact
    const probe = key.slice(0, 14)
    return waDocs.find((d) => d.key.includes(probe) || key.includes(d.key.slice(0, 14))) ?? null
  }

  // ─── the archive list ───────────────────────────────────────────────────────
  const [files] = await bucket.getFiles({ prefix: PREFIX })
  let targets: Target[] = files
    .filter((f) => !f.name.endsWith('/'))
    .filter((f) => !ONLY || f.name.toLowerCase().includes(ONLY))
    .map((f) => {
      const project = projectFromArchive(f.name)
      return { object: f.name, size: Number(f.metadata.size ?? 0), project, existing: matchExisting(project) }
    })

  targets.sort((a, b) => (LARGEST_FIRST ? b.size - a.size : a.size - b.size))

  const todo = targets.filter((t) => FORCE || !t.existing || t.existing.chunks === 0)
  const skipped = targets.length - todo.length
  targets = todo.slice(0, LIMIT === Infinity ? undefined : LIMIT)

  const todoBytes = targets.reduce((a, t) => a + t.size, 0)
  console.log(`${files.length} archives in Storage · ${skipped} already chunked (skipped)`)
  console.log(`${targets.length} to ingest · ${human(todoBytes)} to download\n`)

  const user = { uid: 'whatsapp-archive-ingest', role: 'admin', tenantId: 'd2' } as AuthenticatedUser

  let ok = 0
  let failed = 0
  let chunksTotal = 0
  let msgsTotal = 0

  for (const [i, t] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${t.project.slice(0, 44)}`
    const state = !t.existing ? 'NEW' : t.existing.chunks === 0 ? 'EMPTY kbDoc' : `${t.existing.chunks} chunks (--force)`
    console.log(`${label}  ${human(t.size).padStart(7)}  ${state}`)

    if (!APPLY) {
      console.log(`      would download, extract _chat.txt, ingest as "WhatsApp — ${t.existing?.title.replace(/^WhatsApp —\s*/, '') ?? t.project}"`)
      ok++
      continue
    }

    let buf: Buffer | null = null
    try {
      const [contents] = await bucket.file(t.object).download()
      buf = contents
      const zip = await JSZip.loadAsync(buf)
      const entries = Object.values(zip.files).filter((z) => !z.dir)
      const chat =
        entries.find((z) => /_chat\.txt$/i.test(z.name)) ?? entries.find((z) => /\.txt$/i.test(z.name))
      if (!chat) {
        console.log('      ✗ no _chat.txt in the archive — skipped')
        failed++
        continue
      }

      const raw = await chat.async('string')
      const parsed = parseWhatsApp(raw)
      const transcript = toTranscript(parsed)
      if (transcript.length === 0 || parsed.messages.length === 0) {
        console.log('      ✗ transcript parsed to 0 messages — skipped')
        failed++
        continue
      }
      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        console.log(`      ✗ transcript is ${transcript.length} chars (> ${MAX_TRANSCRIPT_CHARS}) — skipped`)
        failed++
        continue
      }

      // An existing human-set title wins over a filename-derived one.
      const projectName = t.existing?.title.replace(/^WhatsApp —\s*/, '') ?? t.project
      const title = `WhatsApp — ${projectName}`

      // A kbDoc with zero chunks is a failed prior import. Remove it, or the retry leaves a
      // second empty doc beside the first.
      if (t.existing && t.existing.chunks === 0) {
        await deleteDoc(user, t.existing.id)
        console.log(`      removed stale empty kbDoc ${t.existing.id}`)
      }

      const result = await createDoc(user, {
        title,
        content: transcript,
        lang: 'en',
        pillar: 'finder',
      })

      // Drive the same bounded poll loop the browser does, to completion.
      let remaining = result.remaining
      let guard = 0
      while (remaining > 0 && guard < 100_000) {
        const batch = await processBatch(result.jobId, BATCH)
        if (batch.remaining >= remaining) break // no progress — stop rather than spin
        remaining = batch.remaining
        guard++
      }

      console.log(`      ✓ ${parsed.messages.length} msgs · ${parsed.participants.length} participants · ${result.total} chunks · docId=${result.docId}`)
      ok++
      chunksTotal += result.total
      msgsTotal += parsed.messages.length
    } catch (e) {
      console.log(`      ✗ ${(e as Error).message.slice(0, 120)}`)
      failed++
    } finally {
      buf = null // drop the archive before the next one
      if (global.gc) global.gc()
    }
  }

  console.log('\n── summary ──')
  console.log(`  ingested: ${ok}${APPLY ? '' : ' (would)'}   failed: ${failed}   skipped (already chunked): ${skipped}`)
  if (APPLY) console.log(`  ${chunksTotal} chunks from ${msgsTotal} messages`)
  if (!APPLY) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log('\n═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
