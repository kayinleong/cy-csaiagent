/**
 * scripts/ingest-client-factsheets.ts — stage 3 of the client project info sheet ingest
 * (quick-kayinleong-096, D1): ingest one fact sheet per project into the FINDER knowledge
 * base through the existing createDoc / updateDoc -> processBatch path.
 *
 * DRY RUN by default: it reads the KB, plans each sheet as create | update | unchanged |
 * refuse, writes FACTSHEETS-DRYRUN.md and prints the FACTSHEETS fingerprint. It writes
 * nothing to Firestore.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/ingest-client-factsheets.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/ingest-client-factsheets.ts \
 *       --apply --expect-plan <FACTSHEETS fingerprint>
 *
 * Flags:
 *   --apply              write (default: dry run). Refuses without a matching --expect-plan.
 *   --expect-plan SHA    the fingerprint the user approved from the dry run.
 *   --manifest PATH      default .planning/quick/quick-kayinleong-096/factsheets/index.json.
 *                        Each sheet's `file` is resolved relative to the manifest's PARENT
 *                        directory (the claim dir), and may not escape it.
 *                        The report is written to that same directory.
 *
 * SAFETY ORDER. The only static imports are node built-ins and the import-free safety
 * module. `assertSafeTarget` runs FIRST; the Firebase Admin SDK, the KB path and the audit
 * writer are imported dynamically afterwards, so a wrong environment never holds live
 * credentials. Output is titles, actions, counts, ids and the fingerprint: never content.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertSafeTarget, CLIENT_FACTSHEET_ACTOR } from '@/src/inventory/client-workbook-safety'

const CLAIM_DIR = '.planning/quick/quick-kayinleong-096'
const DEFAULT_MANIFEST = `${CLAIM_DIR}/factsheets/index.json`

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const expectPlan = flagValue(args, '--expect-plan')
  const manifestPath = resolve(flagValue(args, '--manifest') ?? DEFAULT_MANIFEST)

  // 1. Env guard, before anything can initialise the Admin SDK.
  const target = assertSafeTarget(process.env)

  // 2. Presence only, never the value. Embedding needs the Gemini Developer API key.
  const embeddingKeyPresent = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '') !== ''
  if (apply && !embeddingKeyPresent) {
    throw new Error('refusing to apply: GOOGLE_GENERATIVE_AI_API_KEY is not set')
  }

  // 3. Only now load the Firebase-touching modules.
  const [{ adminDb }, { createDoc, updateDoc }, { processBatch }, audit, factsheets] = await Promise.all([
    import('@/src/firebase/admin'),
    import('@/src/kb/crud'),
    import('@/src/kb/ingest/pipeline'),
    import('@/src/audit/log'),
    import('@/src/kb/client-factsheets'),
  ])

  // 4. Load and verify every sheet. Any failure refuses the whole run.
  const manifestJson: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const baseDir = resolve(dirname(dirname(manifestPath)))
  const readSheet = (rel: string): Uint8Array => {
    const abs = resolve(baseDir, rel)
    if (!abs.startsWith(baseDir + sep)) throw new Error('path escapes the claim directory')
    return readFileSync(abs)
  }
  const sheets = factsheets.loadFactSheets(manifestJson, readSheet)
  const meta = factsheets.FactSheetManifestSchema.parse(manifestJson).meta

  const kbDocs = () => adminDb.collection('kbDocs')

  const deps: import('@/src/kb/client-factsheets').RunDeps = {
    findDocsByTitle: async (title) => {
      const snap = await kbDocs().where('title', '==', title).get()
      return snap.docs.map((d) => {
        const data = d.data() as { pillar?: unknown; status?: unknown }
        return {
          id: d.id,
          pillar: typeof data.pillar === 'string' ? data.pillar : '',
          status: typeof data.status === 'string' ? data.status : '',
        }
      })
    },
    jobHashesForDoc: async (docId) => {
      const snap = await adminDb.collection('kbIngestionJobs').where('docId', '==', docId).get()
      return snap.docs
        .map((d) => (d.data() as { fileHash?: unknown }).fileHash)
        .filter((h): h is string => typeof h === 'string')
    },
    // Counted in memory so no composite index is needed.
    countPublishedChunks: async (docId) => {
      const snap = await adminDb.collection('kbChunks').where('docId', '==', docId).get()
      return snap.docs.filter((d) => (d.data() as { status?: unknown }).status === 'published').length
    },
    docStatus: async (docId) => {
      const snap = await kbDocs().doc(docId).get()
      if (!snap.exists) return null
      const status = (snap.data() as { status?: unknown }).status
      return typeof status === 'string' ? status : null
    },
    createDoc: (user, input) =>
      createDoc(user as import('@/src/firebase/auth').AuthenticatedUser, input),
    updateDoc: (user, docId, patch) =>
      updateDoc(user as import('@/src/firebase/auth').AuthenticatedUser, docId, patch),
    processBatch,
    audit: (entry) => audit.log(entry),
    countAuditRows: async () => {
      const snap = await adminDb
        .collection('auditLogs')
        .where('actorUid', '==', CLIENT_FACTSHEET_ACTOR)
        .where('action', '==', 'client_factsheet_ingest')
        .count()
        .get()
      return snap.data().count
    },
    writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
    now: () => new Date(),
    log: (line) => console.log(line),
  }

  console.log('=== client fact-sheet ingest ===')
  console.log(`  mode:   ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  target: ${target}`)
  console.log(`  sheets: ${sheets.length} loaded, all verified`)

  // Beside the manifest's sheets (quick-kayinleong-101), so a second manifest never
  // overwrites claim 096's committed reports. The default manifest still reports into 096.
  const reportPath = `${relative(process.cwd(), baseDir) || '.'}/${apply ? 'FACTSHEETS-APPLY.md' : 'FACTSHEETS-DRYRUN.md'}`
  const result = await factsheets.runFactSheetIngest(deps, {
    mode: apply ? 'apply' : 'dry-run',
    sheets,
    meta,
    target,
    reportPath,
    ...(expectPlan !== undefined ? { expectPlan } : {}),
    embeddingKeyPresent,
  })

  if (!apply) {
    for (const p of result.plan) {
      console.log(`  ${p.action.toUpperCase().padEnd(9)} ${p.title}${p.reason ? `  [${p.reason}]` : ''}`)
    }
  }
  const c = result.counts
  console.log()
  console.log(`  create ${c.create}, update ${c.update}, unchanged ${c.unchanged}, refuse ${c.refuse}`)
  console.log(`  FACTSHEETS fingerprint: ${result.fingerprint}`)
  console.log(`  report: ${result.reportPath}`)
  if (result.auditRows) {
    console.log(`  audit rows: expected ${result.auditRows.expected}, found ${result.auditRows.found}`)
  }
  if (!apply) {
    console.log()
    console.log('  Dry run. Re-run with --apply --expect-plan <fingerprint> to write.')
  }
  if (c.refuse > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
