/**
 * scripts/import-client-workbook.ts — stage 2 of the client project info sheet ingest
 * (quick-kayinleong-096): merge the normalised sheet into the EXISTING `projects` records.
 *
 * DRY RUN by default. It reads every mapped project, plans the merge with the T1 planner,
 * writes IMPORT-DRYRUN.md (per-field before -> after, the merge outcome per project and the
 * warnings; no description, no location text, no existing raw line, no contact details) and
 * prints the plan fingerprint. It writes nothing to Firestore.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts \
 *       --apply --expect-plan <IMPORT fingerprint>
 *   node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts \
 *       --restore .planning/quick/quick-kayinleong-096/backups/<stamp>/projects-backup.json
 *   node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts \
 *       --restore <backup> --apply --expect-plan <RESTORE fingerprint>
 *
 * Flags:
 *   --apply              write (default: dry run). Refuses without a matching --expect-plan.
 *   --expect-plan SHA    the fingerprint the user approved from the dry run. The fingerprint
 *                        is recomputed from live state at apply time (T-096-11).
 *   --restore BACKUP     plan the inverse of a backup. With --apply it restores, with the same
 *                        --expect-plan, re-read, audit and re-embed rules.
 *   --sheet PATH         default .planning/quick/quick-kayinleong-096/client-sheet.normalized.json
 *   --mapping PATH       default .planning/quick/quick-kayinleong-096/project-mapping.json
 *   --holds PATH         default .planning/quick/quick-kayinleong-096/review-holds.json;
 *                        absent = no holds. Format {"holds": {"<docId>": ["price", ...]}}
 *   --delay MS           pace the re-embed calls (default 120)
 *
 * Reports: IMPORT-DRYRUN.md, IMPORT-APPLY.md, RESTORE-DRYRUN.md, RESTORE-APPLY.md in the
 * claim directory. Backups (full docs minus the embedding, so they hold description prose
 * with contact details) go to .planning/quick/quick-kayinleong-096/backups/, which is
 * gitignored. Never commit it.
 *
 * SAFETY ORDER (D13, T-096-05). The only static imports are node built-ins and the
 * import-free safety module. `assertSafeTarget` runs FIRST; the Admin SDK, the planner, the
 * runner, the embedder and the audit writer are imported dynamically afterwards, so a wrong
 * environment never holds live credentials. The live project must be `cy-csaiagent`, or the
 * Firestore emulator on a `demo-` project.
 *
 * Output is counts, docIds, names, field names, paths and the fingerprint. It never prints a
 * record, a description or a cell value. Only the PRESENCE of the Gemini key is checked.
 * The embedding is written as a plain number[] (never the Firestore vector wrapper):
 * see commit ac7cd28 and scripts/reembed-projects.ts.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { assertSafeTarget } from '@/src/inventory/client-workbook-safety'

const CLAIM_DIR = '.planning/quick/quick-kayinleong-096'
const KNOWN_FLAGS = ['--apply', '--expect-plan', '--restore', '--sheet', '--mapping', '--holds', '--delay']

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`)
  return v
}

async function main(): Promise<number> {
  // 1. Env guard, before anything can initialise the Admin SDK.
  const target = assertSafeTarget(process.env)

  const args = process.argv.slice(2)
  for (const a of args) {
    if (a.startsWith('--') && !KNOWN_FLAGS.includes(a)) throw new Error(`unknown flag ${a}`)
  }
  const apply = args.includes('--apply')
  const expectPlan = flagValue(args, '--expect-plan')
  const restoreFrom = flagValue(args, '--restore')
  const sheetPath = resolve(flagValue(args, '--sheet') ?? `${CLAIM_DIR}/client-sheet.normalized.json`)
  const mappingPath = resolve(flagValue(args, '--mapping') ?? `${CLAIM_DIR}/project-mapping.json`)
  const holdsPath = resolve(flagValue(args, '--holds') ?? `${CLAIM_DIR}/review-holds.json`)
  const delayMs = Number(flagValue(args, '--delay') ?? '120')
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay must be a non-negative number')
  if (expectPlan !== undefined && !apply) throw new Error('--expect-plan only applies together with --apply')

  const restoring = restoreFrom !== undefined
  const mode = restoring ? (apply ? 'restore-apply' : 'restore-dry-run') : apply ? 'apply' : 'dry-run'
  const reportName = {
    'dry-run': 'IMPORT-DRYRUN.md',
    apply: 'IMPORT-APPLY.md',
    'restore-dry-run': 'RESTORE-DRYRUN.md',
    'restore-apply': 'RESTORE-APPLY.md',
  }[mode]
  // Repo-relative on purpose: the report and the printed backup path then carry no
  // machine-specific absolute path, and `git check-ignore` works on the printed value.
  const reportPath = `${CLAIM_DIR}/${reportName}`
  const backupDir = `${CLAIM_DIR}/backups`

  // 2. Presence only, never the value. Re-embedding needs the Gemini Developer API key.
  const hasEmbeddingKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '') !== ''

  // 3. Only now load the Firebase-touching modules.
  const [{ adminDb }, firestore, workbook, run, embedText, audit] = await Promise.all([
    import('@/src/firebase/admin'),
    import('firebase-admin/firestore'),
    import('@/src/inventory/client-workbook'),
    import('@/src/inventory/client-workbook-run'),
    import('@/src/inventory/embedText'),
    import('@/src/audit/log'),
  ])

  // 4. Inputs. The sheet is re-validated on load (schema + the ten invariants).
  const mappingBytes = readFileSync(mappingPath)
  const mappingSha256 = createHash('sha256').update(mappingBytes).digest('hex')
  const sheet = workbook.parseClientSheet(JSON.parse(readFileSync(sheetPath, 'utf8')))
  const mapping = run.ProjectMappingSchema.parse(JSON.parse(mappingBytes.toString('utf8')))
  const holds = existsSync(holdsPath)
    ? run.parseHoldsFile(JSON.parse(readFileSync(holdsPath, 'utf8')))
    : {}

  const deps = run.buildFirestoreDeps({
    db: adminDb as unknown as import('@/src/inventory/client-workbook-run').FirestoreLike,
    deleteSentinel: () => firestore.FieldValue.delete(),
    audit: (entry) => audit.log(entry),
    embed: (doc) => embedText.embedProject(doc as unknown as import('@/src/firebase/collections').ProjectDoc),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    },
    readFile: (path) => readFileSync(path, 'utf8'),
  })

  console.log('═══ client workbook import ═══')
  console.log(`  mode:    ${mode}`)
  console.log(`  target:  ${target}`)
  console.log(`  holds:   ${Object.keys(holds).length} project(s)`)
  console.log(`  embedding key present: ${hasEmbeddingKey ? 'yes' : 'no'}`)

  const result = await run.runClientWorkbookImport(deps, {
    mode,
    expectPlan,
    sheet,
    mapping,
    mappingSha256,
    holds,
    backupDir,
    restoreFrom,
    reportPath,
    target,
    delayMs,
    hasEmbeddingKey,
  })

  console.log('\n── summary ──')
  console.log(`  projects in plan:  ${result.docsInPlan}`)
  console.log(`  projects changed:  ${result.docsChanged}`)
  console.log(`  field changes:     ${result.fieldsChanged}`)
  console.log(`  to re-embed:       ${result.reembedPlanned}`)
  if (apply) {
    console.log(`  written:           ${result.written}`)
    console.log(`  re-read asserted:  ${result.asserted}`)
    console.log(`  audit rows:        ${result.auditRows ?? 'not counted'}`)
    console.log(`  re-embedded:       ${result.reembedded} (${result.reembedFailed.length} failed)`)
    if (result.backupPath) console.log(`  backup:            ${result.backupPath}`)
  }
  console.log(`  report:            ${result.reportPath}`)
  const label = restoring ? 'RESTORE' : 'IMPORT'
  console.log(`\n  ${label} fingerprint: ${result.fingerprint}`)
  if (!apply) console.log('\n  Dry run. Nothing was written.')
  for (const p of result.problems) console.error(`  PROBLEM: ${p}`)
  console.log('\n═══ done ═══')
  return result.ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
