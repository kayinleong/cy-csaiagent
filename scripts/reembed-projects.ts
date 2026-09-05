/**
 * scripts/reembed-projects.ts — refresh every project's 1024-d vector after a bulk field
 * change that bypassed `updateProject` (quick-kayinleong-088).
 *
 * WHY THIS EXISTS
 * ---------------
 * `composeProjectEmbeddingText` (src/inventory/embedText.ts) includes `priceBand` — a
 * human-readable affordability tier is genuine semantic content, so a buyer asking for
 * "something under 500k" matches on it. `priceValue` is deliberately excluded.
 *
 * `scripts/fix-fabricated-prices.ts` rewrote `priceValue` and recomputed `priceBand` for
 * 57 of 87 projects by writing to Firestore directly. That is the correct way to do a bulk
 * data correction, but it bypasses `updateProject`'s embed-on-relevant-change guard
 * (`EMBEDDING_RELEVANT_FIELDS` in src/inventory/crud.ts, which lists `priceValue` precisely
 * so this cannot be forgotten). The stored vectors therefore still encode the OLD band.
 *
 * The failure that leaves behind is the original reported symptom wearing a new hat: 36
 * projects with no price on record were embedded as `under_500k`, so a semantic query for
 * cheap stock keeps matching them even though their band is now `price_unknown`. Fixing the
 * field without refreshing the vector fixes the filter and leaves the semantics lying.
 *
 * SCOPE — re-embeds ALL projects, not a computed subset. Nothing records which text produced
 * a stored vector, so staleness is not detectable after the fact. 87 embeddings is cheap
 * (~130k input tokens, embedding-priced) and a full pass is verifiable; a clever subset is
 * neither. Re-running is harmless.
 *
 * NOT triggered by `unitTypes` / `sizeMinSqft` / `sizeMaxSqft`: those are deliberately
 * absent from EMBEDDING_RELEVANT_FIELDS per D1 — the sqft prose already sits inside the
 * embedded `description`, so numeric mirrors would force a needless re-embed. Do not add
 * them without re-deciding that.
 *
 * DRY RUN by default — prints what it would do and writes nothing.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/reembed-projects.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/reembed-projects.ts --apply
 *
 * Flags:
 *   --apply        actually write (default: dry run)
 *   --limit <n>    stop after n projects
 *   --delay <ms>   pace the embedding calls (default 120ms; Gemini rate limits)
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY (src/rag/embed.ts reads it).
 * PDPA: prints project names and vector dimensions only — never chunk text, never PII.
 */

import { adminDb } from '@/src/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ProjectDoc } from '@/src/firebase/collections'
import { composeProjectEmbeddingText, embedProject } from '@/src/inventory/embedText'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity
const delayIdx = args.indexOf('--delay')
const DELAY_MS = delayIdx !== -1 ? Number(args[delayIdx + 1]) : 120

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('═══ projects.embedding refresh ═══')
  console.log(`  mode:  ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  limit: ${LIMIT === Infinity ? 'all' : LIMIT}`)
  console.log(`  delay: ${DELAY_MS}ms between embeddings`)
  console.log()

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error('GOOGLE_GENERATIVE_AI_API_KEY is not set — embedding would fail. Aborting.')
    process.exit(1)
  }

  const snap = await adminDb.collection('projects').get()
  console.log(`  ${snap.size} projects in the collection\n`)

  let done = 0
  let failed = 0
  let dimMismatch = 0
  const bandCount: Record<string, number> = {}

  for (const doc of snap.docs) {
    if (done + failed >= LIMIT) break
    const project = doc.data() as ProjectDoc
    const band = String(project.priceBand ?? '(unset)')
    bandCount[band] = (bandCount[band] || 0) + 1

    try {
      const vec = await embedProject(project)
      if (vec.length !== 1024) {
        dimMismatch++
        console.log(`  ✗ ${project.name?.slice(0, 46)} — got ${vec.length} dims, expected 1024; SKIPPED`)
        failed++
        continue
      }
      if (APPLY) {
        // FieldValue.vector() is mandatory: a plain number[] is not covered by a vector
        // index, which is exactly the defect that made 25,153 kbChunks unretrievable.
        await doc.ref.update({ embedding: FieldValue.vector(vec) })
      }
      done++
      if (done % 10 === 0) console.log(`  … ${done} embedded`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${project.name?.slice(0, 46)} — ${(e as Error).message.slice(0, 90)}`)
    }
    await sleep(DELAY_MS)
  }

  console.log('\n── summary ──')
  console.log(`  embedded:      ${done}${APPLY ? '' : ' (would embed)'}`)
  console.log(`  failed:        ${failed}`)
  console.log(`  dim mismatch:  ${dimMismatch}`)
  console.log(`  priceBand distribution now: ${JSON.stringify(bandCount)}`)
  if (!APPLY) console.log('\n  Dry run. Re-run with --apply to write.')

  // A sample of the text actually being embedded — the thing under repair.
  const first = snap.docs[0]?.data() as ProjectDoc | undefined
  if (first) {
    console.log(`\n  sample embedding text (${first.name?.slice(0, 40)}):`)
    console.log(`    ${composeProjectEmbeddingText(first).slice(0, 180).replace(/\s+/g, ' ')}…`)
  }

  console.log('\n═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
