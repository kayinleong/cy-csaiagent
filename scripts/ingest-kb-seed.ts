/**
 * scripts/ingest-kb-seed.ts — ingest the seed KB documents in docs/kb-seed/
 * (quick-kayinleong-078).
 *
 * WHY: Coach held 3 documents / 35 chunks and Reply held NOTHING, so every non-property
 * question ("how do I follow up a WhatsApp lead?", "walk me through my first viewing") came
 * back as an honest kb_miss, and any Reply turn answered no_sop_match even with a lead
 * attached. This loads starter content so those paths have something to ground on.
 *
 * These documents are EXAMPLES. They are titled "[Example]" and each opens with a line
 * saying so, because they describe D2's operating procedures and were not written by D2.
 * Derek owns the knowledge base and should edit or replace them; the markdown sources are
 * committed so he can, rather than having to reverse-engineer what the bot said.
 *
 * Re-runnable: a document whose title already exists is SKIPPED, so running this twice does
 * not duplicate the corpus. Use --force to ingest anyway.
 *
 * DRY RUN by default.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-kb-seed.ts
 *   npx tsx --env-file=.env.local scripts/ingest-kb-seed.ts --apply
 *
 * Flags:
 *   --apply   actually write (default: dry run)
 *   --force   ingest even if a document with the same title exists
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { adminDb } from '@/src/firebase/admin'
import { createDoc } from '@/src/kb/crud'
import { processBatch } from '@/src/kb/ingest/pipeline'
import type { AuthenticatedUser } from '@/src/firebase/auth'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')

const SEED_DIR = join(process.cwd(), 'docs', 'kb-seed')

/** Chunks embedded per processBatch call — the same bounded shape the browser poller uses. */
const BATCH = 5

interface SeedDoc {
  file: string
  title: string
  pillar: 'coach' | 'finder' | 'reply'
  lang: 'en' | 'ms' | 'zh'
  category?: string
  content: string
}

/** Parse the small front-matter block at the top of each seed file. */
function parseSeed(file: string): SeedDoc {
  const raw = readFileSync(join(SEED_DIR, file), 'utf8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error(`${file}: missing front matter`)

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':')
    if (at === -1) continue
    meta[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }

  const pillar = meta.pillar as SeedDoc['pillar']
  if (!['coach', 'finder', 'reply'].includes(pillar)) {
    throw new Error(`${file}: bad pillar ${meta.pillar}`)
  }

  return {
    file,
    title: meta.title,
    pillar,
    lang: (meta.lang as SeedDoc['lang']) ?? 'en',
    ...(meta.category ? { category: meta.category } : {}),
    content: match[2].trim(),
  }
}

async function main() {
  console.log('═══ KB seed ingestion ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}${FORCE ? '  --force' : ''}`)
  console.log()

  const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.md')).sort()
  const seeds = files.map(parseSeed)

  // Existing titles, so a re-run does not duplicate the corpus.
  const existing = new Set<string>()
  const snap = await adminDb.collection('kbDocs').limit(2000).get()
  for (const d of snap.docs) {
    const t = (d.data() as Record<string, unknown>).title
    if (typeof t === 'string') existing.add(t)
  }

  // The pipeline gates on role, not identity — this is a local admin script.
  const user = { uid: 'kb-seed-script', role: 'admin', tenantId: 'd2' } as AuthenticatedUser

  let ingested = 0
  let skipped = 0
  let chunks = 0

  for (const seed of seeds) {
    const dup = existing.has(seed.title)
    const label = `${seed.pillar}/${seed.category ?? '—'}`
    if (dup && !FORCE) {
      console.log(`  SKIP  ${label.padEnd(24)} ${seed.title}`)
      console.log(`        (already in the KB — pass --force to ingest anyway)`)
      skipped++
      continue
    }

    if (!APPLY) {
      console.log(`  would ingest  ${label.padEnd(24)} ${seed.title}`)
      console.log(`        ${seed.content.length} chars from ${seed.file}`)
      ingested++
      continue
    }

    const result = await createDoc(user, {
      title: seed.title,
      content: seed.content,
      lang: seed.lang,
      pillar: seed.pillar,
      ...(seed.category ? { category: seed.category } : {}),
    })

    // Drive the same chunked poll loop the browser does, to completion.
    let remaining = result.remaining
    while (remaining > 0) {
      const batch = await processBatch(result.jobId, BATCH)
      if (batch.remaining >= remaining) break // no progress — stop rather than spin
      remaining = batch.remaining
    }

    console.log(`  OK    ${label.padEnd(24)} ${seed.title}`)
    console.log(`        docId=${result.docId}  ${result.total} chunks`)
    ingested++
    chunks += result.total
  }

  console.log()
  console.log('── summary ──')
  console.log(`  ingested: ${ingested}${APPLY ? '' : ' (would)'}   skipped: ${skipped}   chunks: ${chunks}`)

  if (APPLY) {
    console.log()
    for (const p of ['coach', 'reply'] as const) {
      const n = (await adminDb.collection('kbChunks').where('pillar', '==', p).count().get()).data().count
      console.log(`  kbChunks pillar=${p}: ${n}`)
    }
  } else {
    console.log()
    console.log('  Dry run. Re-run with --apply to write.')
  }
  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('seed ingestion failed:', (e as Error).message)
    process.exit(1)
  })
