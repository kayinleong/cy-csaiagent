/**
 * scripts/list-whatsapp-imports.ts — list (and optionally download) the raw WhatsApp export
 * archives the admin import surface now keeps (quick-kayinleong-088).
 *
 * The WhatsApp-import form uploads the untouched .zip to
 * `whatsapp-imports/<timestamp>__<name>.zip` before ingesting. This is the counterpart: it
 * finds those archives server-side so a re-ingest never depends on the operator still
 * having the file.
 *
 * WHY IT MATTERS: 20 WhatsApp kbDocs hold zero chunks. `KbDocDoc` stores no text, so their
 * content is unrecoverable from Firestore — the only way back is the original export. Going
 * forward, that export is here.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/list-whatsapp-imports.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/list-whatsapp-imports.ts --download <dir>
 *   node_modules/.bin/tsx --env-file=.env.local scripts/list-whatsapp-imports.ts --download <dir> --only <substring>
 *
 * Flags:
 *   --download <dir>   also download each archive into <dir> (created if missing)
 *   --only <substring> restrict to objects whose name contains this (case-insensitive)
 *   --peek             print the .zip's internal entry names (needs --download, or it
 *                      downloads to a temp buffer) WITHOUT printing message content
 *
 * PDPA: prints object names, sizes, timestamps and (with --peek) the zip's internal FILE
 * NAMES. It never prints message text. A downloaded archive is unredacted personal data —
 * put it somewhere outside the repo and delete it when done.
 */

import { getStorage } from 'firebase-admin/storage'
import '@/src/firebase/admin'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PREFIX = 'whatsapp-imports/'

const args = process.argv.slice(2)
const dlIdx = args.indexOf('--download')
const DOWNLOAD_DIR = dlIdx !== -1 ? args[dlIdx + 1] : null
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1]?.toLowerCase() : null
const PEEK = args.includes('--peek')

function human(bytes: number): string {
  if (!bytes) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

async function main() {
  // src/firebase/admin.ts initializes WITHOUT a storageBucket (it only needs Firestore and
  // Auth), so getStorage().bucket() has no default and throws. Name it explicitly from the
  // same env var the client build uses, so both halves target one bucket.
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  if (!bucketName) {
    console.error('No storage bucket configured.')
    console.error('Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) in .env.local.')
    process.exit(1)
  }
  const bucket = getStorage().bucket(bucketName)
  console.log(`bucket:  ${bucket.name}`)
  console.log(`prefix:  ${PREFIX}\n`)

  const [files] = await bucket.getFiles({ prefix: PREFIX })
  const archives = files
    .filter((f) => !f.name.endsWith('/'))
    .filter((f) => !ONLY || f.name.toLowerCase().includes(ONLY))

  if (archives.length === 0) {
    console.log('No archives found.')
    console.log('Upload one via the admin WhatsApp-import page — it archives the .zip on parse.')
    console.log('(If an upload seemed to succeed, confirm storage.rules is DEPLOYED:')
    console.log(' firebase deploy --only storage)')
    return
  }

  // Newest first — a re-ingest almost always wants the most recent export.
  archives.sort((a, b) => String(b.metadata.updated ?? '').localeCompare(String(a.metadata.updated ?? '')))

  let total = 0
  if (DOWNLOAD_DIR) mkdirSync(DOWNLOAD_DIR, { recursive: true })

  for (const f of archives) {
    const size = Number(f.metadata.size ?? 0)
    total += size
    const meta = (f.metadata.metadata ?? {}) as Record<string, string>
    console.log(`• ${f.name}`)
    console.log(`    size ${human(size)} · updated ${f.metadata.updated ?? '?'}`)
    if (meta.originalName) console.log(`    originalName: ${meta.originalName}`)
    if (meta.uploadedBy) console.log(`    uploadedBy(uid): ${meta.uploadedBy}`)

    let buf: Buffer | null = null
    if (DOWNLOAD_DIR || PEEK) {
      const [contents] = await f.download()
      buf = contents
    }
    if (DOWNLOAD_DIR && buf) {
      const dest = join(DOWNLOAD_DIR, f.name.slice(PREFIX.length).replace(/[\\/]/g, '_'))
      writeFileSync(dest, buf)
      console.log(`    downloaded → ${dest}`)
    }
    if (PEEK && buf) {
      // Entry NAMES only. Never read _chat.txt contents here — that is message data.
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buf)
      const entries = Object.values(zip.files).filter((z) => !z.dir)
      const chat = entries.filter((z) => /\.txt$/i.test(z.name)).map((z) => z.name)
      console.log(`    entries: ${entries.length} (text: ${chat.length})`)
      for (const n of entries.slice(0, 8)) console.log(`      - ${n}`)
      if (entries.length > 8) console.log(`      … ${entries.length - 8} more`)
    }
    console.log()
  }

  console.log(`${archives.length} archive(s), ${human(total)} total`)
  if (DOWNLOAD_DIR) {
    console.log(`\n⚠ Downloaded archives are UNREDACTED personal data (names, phone numbers,`)
    console.log(`  message bodies). Keep them outside the repo and delete them when done.`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
