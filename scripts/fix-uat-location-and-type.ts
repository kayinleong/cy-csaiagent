/**
 * scripts/fix-uat-location-and-type.ts — the quick-kayinleong-098 data patch: correct four
 * location strings and tag four non-residential projects, so the live records stop feeding
 * the UAT F5/F9/N2 failures. What is changed and why lives in
 * scripts/fix-uat-location-and-type.plan.ts.
 *
 * DRY RUN by default. It reads the live projects, plans the patch, writes DATA-DRYRUN.md to
 * the claim directory (each before -> after, the records skipped and why, and which Finder
 * area searches gain or lose a project), then prints the plan fingerprint. It writes nothing
 * to Firestore.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-uat-location-and-type.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-uat-location-and-type.ts \
 *       --apply --expect-plan <fingerprint>
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-uat-location-and-type.ts \
 *       --restore .planning/quick/quick-kayinleong-098/backups/<stamp>.json
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-uat-location-and-type.ts \
 *       --restore <backup> --apply --expect-plan <restore fingerprint>
 *
 * Apply rules (the 096 importer's, scaled down):
 *   - `--apply` refuses unless `--expect-plan` equals the fingerprint recomputed from live
 *     state, so nothing is written that the user did not see in the dry run.
 *   - The backup (doc, field, before, after) is written BEFORE the first Firestore write. It
 *     holds location text and a type tag only, no description and no contact details.
 *   - A location change re-embeds the project (`locationText` is embedding-relevant). The
 *     vector is written as a plain number[], never the Firestore vector wrapper (commit
 *     ac7cd28). `propertyType` is not embedded.
 *   - Each write is re-read and checked, and gets one audit row (hashes only).
 *
 * SAFETY ORDER. The only static imports are node built-ins, the import-free safety module
 * and the pure planner. `assertSafeTarget` runs FIRST; the Admin SDK, the embedder, the
 * audit writer and the search module load afterwards. The target must be the live
 * `cy-csaiagent` project or the emulator on a `demo-` project. Only the PRESENCE of the
 * Gemini key is checked, never its value.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { assertSafeTarget } from '@/src/inventory/client-workbook-safety'
import {
  fingerprintInput,
  planPatch,
  planRestore,
  type PlannedChange,
  type SkippedChange,
  type StoredProject,
} from './fix-uat-location-and-type.plan'

const CLAIM_DIR = '.planning/quick/quick-kayinleong-098'
const ACTOR = 'uat-fix-098'
const KNOWN_FLAGS = ['--apply', '--expect-plan', '--restore', '--delay']

/** Area searches the report re-runs before and after, to show the effect of each location fix. */
const PROBE_AREAS = [
  'KLCC', 'Titiwangsa', 'North Kiara', 'Mont Kiara', 'Dutamas', 'KL North', 'KL Sentral',
  'Sungai Buloh', 'Subang', 'Petaling Jaya', 'Shah Alam', 'Bangsar',
]

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
  return v
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mdCell(v: string | null): string {
  return v === null ? '_(absent)_' : `\`${v.replace(/\|/g, '\\|')}\``
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
  const delayMs = Number(flagValue(args, '--delay') ?? '120')
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay must be a non-negative number')
  if (expectPlan !== undefined && !apply) throw new Error('--expect-plan only applies together with --apply')

  const restoring = restoreFrom !== undefined
  const mode = restoring ? (apply ? 'restore-apply' : 'restore-dry-run') : apply ? 'apply' : 'dry-run'
  const reportPath = `${CLAIM_DIR}/${
    { 'dry-run': 'DATA-DRYRUN.md', apply: 'DATA-APPLY.md', 'restore-dry-run': 'RESTORE-DRYRUN.md', 'restore-apply': 'RESTORE-APPLY.md' }[mode]
  }`

  // 2. Only now load the Firebase-touching modules.
  const [{ adminDb }, firestore, embedText, audit, search] = await Promise.all([
    import('@/src/firebase/admin'),
    import('firebase-admin/firestore'),
    import('@/src/inventory/embedText'),
    import('@/src/audit/log'),
    import('@/src/inventory/search'),
  ])

  // 3. Read the live records. Raw data, no converter: the planner only reads three fields.
  const snap = await adminDb.collection('projects').get()
  const docs = new Map<string, StoredProject & Record<string, unknown>>()
  for (const d of snap.docs) docs.set(d.id, d.data() as StoredProject & Record<string, unknown>)

  // 4. Plan.
  let changes: PlannedChange[]
  let skipped: SkippedChange[]
  if (restoring) {
    const backup = JSON.parse(readFileSync(restoreFrom, 'utf8')) as { changes: PlannedChange[] }
    ;({ changes, skipped } = planRestore(backup.changes, docs))
  } else {
    ;({ changes, skipped } = planPatch(docs))
  }
  const fingerprint = createHash('sha256').update(fingerprintInput(changes)).digest('hex')

  // 5. Effect on Finder area searches, over the active records, before vs after.
  const active = [...docs.entries()].filter(([, d]) => d.status === 'active')
  const after = new Map(active.map(([id, d]) => [id, { ...d }]))
  for (const c of changes) {
    const doc = after.get(c.docId)
    if (doc && c.field === 'locationText') doc.locationText = c.after ?? ''
  }
  const effects: string[] = []
  for (const area of PROBE_AREAS) {
    const needles = search.locationNeedles(area)
    if (!needles) continue
    const hit = (d: Record<string, unknown>) =>
      search.projectMatchesLocation(d as unknown as Parameters<typeof search.projectMatchesLocation>[0], needles)
    const lost = active.filter(([id, d]) => hit(d) && !hit(after.get(id)!)).map(([, d]) => d.name)
    const gained = active.filter(([id, d]) => !hit(d) && hit(after.get(id)!)).map(([, d]) => d.name)
    if (lost.length || gained.length) {
      effects.push(
        `| ${area} | ${lost.join(', ') || '—'} | ${gained.join(', ') || '—'} |`,
      )
    }
  }

  // 6. Report.
  const lines = [
    `# ${mode === 'dry-run' ? 'Data patch dry run' : mode === 'apply' ? 'Data patch applied' : mode === 'restore-dry-run' ? 'Restore dry run' : 'Restore applied'}: quick-kayinleong-098`,
    '',
    `- Target: ${target}`,
    `- Read at: ${new Date().toISOString()}`,
    `- Projects read: ${docs.size} (${active.length} active)`,
    `- Changes planned: ${changes.length}; skipped: ${skipped.length}`,
    `- Plan fingerprint: \`${fingerprint}\``,
    '',
    '## Changes',
    '',
    '| Project | Field | Before | After | Why |',
    '|---|---|---|---|---|',
    ...changes.map((c) => `| ${c.name} | ${c.field} | ${mdCell(c.before)} | ${mdCell(c.after)} | ${c.why} |`),
    '',
    '## Skipped',
    '',
    ...(skipped.length ? skipped.map((s) => `- ${s.name} (${s.field}): ${s.reason}`) : ['None.']),
    '',
    '## Effect on Finder area searches (location gate only, active projects)',
    '',
    ...(effects.length
      ? ['| Search | Leaves the results | Joins the results |', '|---|---|---|', ...effects]
      : ['No probed area search changes.']),
    '',
    'The property-type tags change no area search. They exclude these projects from residential searches, which the name rule in `propertyTypeOf` already does, so the tag makes the record itself correct.',
    '',
  ]

  // 7. Dry runs stop here.
  if (!apply) {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, lines.join('\n'))
    console.log(`═══ quick-kayinleong-098 data patch: ${mode} ═══`)
    console.log(`  target:      ${target}`)
    console.log(`  changes:     ${changes.length}  skipped: ${skipped.length}`)
    console.log(`  report:      ${reportPath}`)
    console.log(`  fingerprint: ${fingerprint}`)
    return 0
  }

  // 8. Apply.
  if (expectPlan !== fingerprint) {
    console.error(`refusing to apply: --expect-plan does not match the live plan fingerprint ${fingerprint}`)
    return 1
  }
  if (changes.length === 0) {
    console.log('nothing to apply')
    return 0
  }
  const needsEmbedding = changes.some((c) => c.field === 'locationText')
  if (needsEmbedding && (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '') === '') {
    console.error('refusing to apply: a location change needs a re-embed and GOOGLE_GENERATIVE_AI_API_KEY is not set')
    return 1
  }

  // Backup BEFORE the first write.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${CLAIM_DIR}/backups/${restoring ? 'restore-' : ''}${stamp}.json`
  mkdirSync(dirname(backupPath), { recursive: true })
  writeFileSync(backupPath, JSON.stringify({ kind: restoring ? 'restore' : 'patch', fingerprint, changes }, null, 2))

  const byDoc = new Map<string, PlannedChange[]>()
  for (const c of changes) byDoc.set(c.docId, [...(byDoc.get(c.docId) ?? []), c])

  let written = 0
  for (const [docId, docChanges] of byDoc) {
    const ref = adminDb.collection('projects').doc(docId)
    const update: Record<string, unknown> = {}
    for (const c of docChanges) update[c.field] = c.after === null ? firestore.FieldValue.delete() : c.after

    const loc = docChanges.find((c) => c.field === 'locationText')
    if (loc) {
      const merged = { ...docs.get(docId), locationText: loc.after ?? '' }
      const vector = await embedText.embedProject(merged as unknown as import('@/src/firebase/collections').ProjectDoc)
      update.embedding = Array.from(vector) // plain number[] — never the vector wrapper
      await sleep(delayMs)
    }

    await ref.update(update)

    // Re-read and check every field before moving on.
    const check = (await ref.get()).data() ?? {}
    for (const c of docChanges) {
      const now = typeof check[c.field] === 'string' ? check[c.field] : null
      if (now !== c.after) throw new Error(`verification failed for ${docId}.${c.field} after write`)
    }

    await audit.log({
      actorUid: ACTOR,
      action: restoring ? 'project-restore' : 'project-update',
      targetRef: `projects/${docId}`,
      raw: { fields: docChanges.map((c) => c.field), before: docChanges.map((c) => c.before), after: docChanges.map((c) => c.after) },
    })
    written++
  }

  lines.push(`## Applied`, '', `- Records written: ${written}`, `- Backup: \`${backupPath}\``, '')
  writeFileSync(reportPath, lines.join('\n'))
  console.log(`═══ quick-kayinleong-098 data patch: ${mode} ═══`)
  console.log(`  records written: ${written}`)
  console.log(`  backup:          ${backupPath}`)
  console.log(`  report:          ${reportPath}`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // Message only: a stack trace from the Admin SDK can carry request details.
    console.error(`failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)
