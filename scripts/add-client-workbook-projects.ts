/**
 * scripts/add-client-workbook-projects.ts — create the client-sheet projects that are not in
 * the inventory yet (quick-kayinleong-101): Binastra Cochrane, Lagenda Tunku (Villa Gemilang)
 * and Ashbourne, which claim 096 skipped.
 *
 * DRY RUN by default: it checks that none of the pinned document IDs exists and that no
 * live project already carries one of the names, plans each record with
 * `planNewProject`, writes NEW-PROJECTS-DRYRUN.md and prints the fingerprint. It writes
 * nothing to Firestore.
 *
 *   node_modules/.bin/tsx --env-file=.env scripts/add-client-workbook-projects.ts
 *   node_modules/.bin/tsx --env-file=.env scripts/add-client-workbook-projects.ts \
 *       --apply --expect-plan <fingerprint>
 *
 * Apply embeds each record, writes it with create() (which fails if the ID exists, so it can
 * never overwrite), audits it, and re-reads it to confirm. The fact sheets go in afterwards
 * through the existing path:
 *
 *   node_modules/.bin/tsx --env-file=.env scripts/ingest-client-factsheets.ts \
 *       --manifest .planning/quick/quick-kayinleong-101/new-projects/factsheets/index.json
 *
 * To undo, delete the three documents listed in NEW-PROJECTS-APPLY.md. That is a delete
 * and needs the user's explicit go-ahead.
 *
 * SAFETY ORDER, as in scripts/import-client-workbook.ts: `assertSafeTarget` runs first and
 * the Firebase-touching modules are imported afterwards. Output is ids, names, field names
 * and the fingerprint. Only the presence of the Gemini key is checked.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { assertSafeTarget } from '@/src/inventory/client-workbook-safety'

const CLAIM_DIR = '.planning/quick/quick-kayinleong-101'
const DEFAULT_SHEET = `${CLAIM_DIR}/new-projects/client-sheet.new.json`
const ACTOR = 'client-workbook-new-projects-101'
const KNOWN_FLAGS = ['--apply', '--expect-plan', '--sheet']
const EMBED_DIM = 1024

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`)
  return v
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function main(): Promise<number> {
  // 1. Env guard, before anything can initialise the Admin SDK.
  const target = assertSafeTarget(process.env)

  const args = process.argv.slice(2)
  for (const a of args) {
    if (a.startsWith('--') && !KNOWN_FLAGS.includes(a)) throw new Error(`unknown flag ${a}`)
  }
  const apply = args.includes('--apply')
  const expectPlan = flagValue(args, '--expect-plan')
  const sheetPath = resolve(flagValue(args, '--sheet') ?? DEFAULT_SHEET)
  if (expectPlan !== undefined && !apply) throw new Error('--expect-plan only applies together with --apply')
  if (apply && expectPlan === undefined) throw new Error('refusing to apply without --expect-plan')
  const hasEmbeddingKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '') !== ''
  if (apply && !hasEmbeddingKey) throw new Error('refusing to apply: GOOGLE_GENERATIVE_AI_API_KEY is not set')

  // 2. Only now load the Firebase-touching modules.
  const [{ adminDb }, workbook, planner, embedText, audit] = await Promise.all([
    import('@/src/firebase/admin'),
    import('@/src/inventory/client-workbook'),
    import('@/src/inventory/client-workbook-new'),
    import('@/src/inventory/embedText'),
    import('@/src/audit/log'),
  ])

  // 3. Inputs, re-validated on load (schema + invariants).
  const sheet = workbook.parseClientSheet(JSON.parse(readFileSync(sheetPath, 'utf8')))
  const importedAt = new Date()
  const plans = sheet.projects.map((p) =>
    planner.planNewProject({ sheet: p, sourceLabel: sheet.meta.source_label, importedAt }),
  )
  const fingerprint = planner.newProjectsFingerprint(plans, sheet.meta.workbook_sha256)

  // 4. Live checks: the pinned IDs are free and no live project has the name already.
  const projects = adminDb.collection('projects')
  const liveNames = new Map<string, string>()
  for (const d of (await projects.select('name').get()).docs) liveNames.set(norm(d.get('name')), d.id)
  const problems: string[] = []
  for (const p of plans) {
    if ((await projects.doc(p.docId).get()).exists) problems.push(`${p.name}: document ${p.docId} already exists`)
    const clash = liveNames.get(norm(p.name))
    if (clash) problems.push(`${p.name}: a live project (${clash}) already has this name`)
  }

  const mode = apply ? 'apply' : 'dry-run'
  console.log('═══ client workbook: new projects ═══')
  console.log(`  mode:    ${mode}`)
  console.log(`  target:  ${target}`)
  console.log(`  embedding key present: ${hasEmbeddingKey ? 'yes' : 'no'}`)
  console.log(`  live projects: ${liveNames.size}`)

  const report: string[] = [
    `# New projects from the client sheet — ${mode}`,
    '',
    `- Target: ${target}`,
    `- Sheet: ${sheetPath.replace(process.cwd() + '/', '')} (workbook sha256 ${sheet.meta.workbook_sha256})`,
    `- Fingerprint: \`${fingerprint}\``,
    '',
  ]
  for (const p of plans) {
    const r = p.record
    const fields = Object.keys(r).filter((k) => k !== 'description').sort()
    report.push(`## ${p.name} (\`${p.docId}\`)`, '')
    report.push(`- status ${r.status}, tenure ${r.tenure}, priceValue ${r.priceValue} (${r.priceProvenance}), vpStatus ${r.vpStatus}`)
    report.push(`- bumiQuota ${r.bumiQuota}, foreignEligible ${r.foreignEligible}, bedrooms ${r.bedrooms}`)
    report.push(`- sizes ${r.sizeMinSqft ?? '—'}–${r.sizeMaxSqft ?? '—'} sqft, layouts ${Array.isArray(r.unitTypes) ? r.unitTypes.length : 0}`)
    report.push(`- locationText: ${r.locationText}`)
    report.push(`- clientWorkbookFields: ${JSON.stringify(r.clientWorkbookFields ?? [])}`)
    report.push(`- fields: ${fields.join(', ')}`)
    for (const w of p.warnings) report.push(`- warning ${w.code}: ${w.message}`)
    report.push('', '```', String(r.description), '```', '')
  }
  if (problems.length) report.push('## Refused', '', ...problems.map((x) => `- ${x}`), '')
  const reportPath = `${CLAIM_DIR}/${apply ? 'NEW-PROJECTS-APPLY.md' : 'NEW-PROJECTS-DRYRUN.md'}`

  const finish = (code: number) => {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, report.join('\n') + '\n')
    console.log(`  report:  ${reportPath}`)
    return code
  }

  for (const p of plans) {
    const r = p.record
    console.log(`  ${p.docId}  ${p.name}  layouts=${Array.isArray(r.unitTypes) ? r.unitTypes.length : 0} tenure=${r.tenure}`)
  }
  if (problems.length) {
    for (const x of problems) console.log(`  REFUSED: ${x}`)
    return finish(1)
  }
  console.log(`\n  fingerprint: ${fingerprint}`)
  if (!apply) return finish(0)

  // 5. Apply.
  if (expectPlan !== fingerprint) {
    report.push('## Refused', '', `- the live plan fingerprint ${fingerprint} differs from the approved ${expectPlan}`)
    console.log('  REFUSED: the fingerprint differs from the approved one; re-run the dry run')
    return finish(1)
  }
  report.push('## Written', '')
  for (const p of plans) {
    const embedding = await embedText.embedProject(p.record as unknown as import('@/src/firebase/collections').ProjectDoc)
    if (!Array.isArray(embedding) || embedding.length !== EMBED_DIM) {
      report.push(`- ${p.name}: embedding has ${embedding?.length} dims, stopped before writing`)
      return finish(1)
    }
    // A plain number[] like every other project embedding (see scripts/import-client-workbook.ts).
    await projects.doc(p.docId).create({ ...p.record, embedding })
    await audit.log({
      actorUid: ACTOR,
      action: 'project.create',
      targetRef: `projects/${p.docId}`,
      raw: { docId: p.docId, fingerprint },
    })
    const back = await projects.doc(p.docId).get()
    const data = back.data() ?? {}
    const bad = ['name', 'status', 'tenure', 'locationText', 'priceValue', 'bumiQuota', 'foreignEligible'].filter(
      (k) => data[k] !== p.record[k],
    )
    if (!back.exists || bad.length || (data.embedding as unknown[] | undefined)?.length !== EMBED_DIM) {
      report.push(`- ${p.name}: re-read mismatch on ${bad.join(', ') || 'embedding'}`)
      return finish(1)
    }
    report.push(`- ${p.name}: created \`projects/${p.docId}\`, re-read matches`)
    console.log(`  created ${p.docId}  ${p.name}`)
  }
  report.push('', 'Undo: delete the three documents above (needs explicit approval).')
  return finish(0)
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  },
)
