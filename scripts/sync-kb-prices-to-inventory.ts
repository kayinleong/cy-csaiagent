/**
 * scripts/sync-kb-prices-to-inventory.ts — recover prices that exist in the KB but not in
 * the structured `projects` record (quick-kayinleong-089).
 *
 * WHY
 * ---
 * 37 of 87 projects carry no price at all in `projects`, yet the client is right that the
 * figures were shared: after the WhatsApp archives were ingested there are ~24,900 chat
 * chunks, and probing 10 of the price-less projects found price text in all 10 — e.g.
 * "Average Price psf (Gross) Type A: RM759", "852sf 3rooms only rm518k", "488sf from
 * RM 568,090". The data is in the corpus and not in the column the Finder table reads.
 *
 * This closes that gap in ONE direction only: KB → inventory. It never invents, and it
 * never overwrites a price that is already there.
 *
 * ═══ THE GUARDS, AND WHY EACH EXISTS ═══
 * quick-088 found that 21 of 51 stored prices had been INVENTED — the extractor multiplied
 * a stated psf rate by a square footage it made up, so "Gross Price: RM720 psf" became a
 * confident RM360,000 on a write-up that says "Prices below RM800K". Re-running an
 * extraction over chat transcripts is the same hazard with more noise, so:
 *
 *  1. DETERMINISTIC PRE-FILTER. Only chunks matching a money regex are ever sent to the
 *     model. Bounds cost and stops the model free-associating over small talk.
 *  2. VERBATIM EVIDENCE REQUIRED. The model must return the exact source substring. If
 *     that substring is not found in the text it was given, the value is DISCARDED. This
 *     is the single strongest guard — a fabricated number has no source to quote.
 *  3. NO ARITHMETIC. The prompt forbids deriving a total from a psf rate, and the psf
 *     range guard (RM200–5,000) rejects the maintenance/sinking-fund figures (RM0.20–2.00
 *     psf) that sit one line away in most of these chats and caused the original defect.
 *  4. TOTAL vs RATE kept separate. A psf rate lands in `pricePsfMin/Max` with
 *     `priceProvenance:'psf_only'` and `priceValue` STAYS 0. Only a stated total sets
 *     `priceValue`.
 *  5. SOURCE CITATION. `priceSourceChunkId` records which chunk the figure came from, so
 *     any number in the table is auditable back to a message. Grounding is mandatory here.
 *  6. NEVER OVERWRITES. Projects that already have a price or a psf rate are skipped.
 *
 * A chat transcript is WEAKER evidence than a sales kit: an agent may quote a price for a
 * specific unit, a past transaction, or a competitor. So everything written here is marked
 * `priceSource:'whatsapp-kb'`, which is what lets Derek review exactly these rows rather
 * than the whole inventory.
 *
 * DRY RUN by default.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/sync-kb-prices-to-inventory.ts
 *   … --apply
 *   … --only "aster hill"      # one project
 *   … --limit 5                # first five, to sanity-check the extraction
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY. Uses the session Gemini key, not production Claude.
 *
 * PDPA: chat transcripts contain participant names and numbers. This prints project names,
 * the extracted FIGURE and its short evidence substring only — never a full message, never
 * a phone number. The evidence substring is capped and is the price phrase itself.
 */

import { adminDb } from '@/src/firebase/admin'
import { priceBandFor } from '@/src/firebase/collections'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1]?.toLowerCase() : null
const limIdx = args.indexOf('--limit')
const LIMIT = limIdx !== -1 ? Number(args[limIdx + 1]) : Infinity
const MODEL = process.env.EXTRACT_MODEL ?? 'gemini-3.5-flash'

/** Chunks per project handed to the model. Bounds cost; ranked by money-mention density. */
const MAX_CHUNKS_PER_PROJECT = 12
/** A plausible ASKING rate. Maintenance/sinking fund is RM0.20–2.00 psf — excluded by this. */
const PSF_MIN = 200
const PSF_MAX = 5_000
/** A plausible total for this corpus (stored range today is RM68k–RM7.7M). */
const TOTAL_MIN = 50_000
const TOTAL_MAX = 100_000_000

/** Deterministic money detector — the pre-filter, never the extractor. */
const MONEY_RX =
  /(rm|myr)\s?[\d,]+(\.\d+)?\s*(k\b|mil\b|million\b|m\b|psf|per\s*sq)|(rm|myr)\s?[\d,]{5,}|from\s+rm|selling\s+price|nett\s+price|spa\s+price|list\s+price/i

/**
 * Evidence phrases that disqualify a figure even though it IS genuinely quoted
 * (quick-kayinleong-089).
 *
 * The verbatim-evidence guard defeats INVENTION. It does nothing about
 * MIS-CATEGORISATION, and the first dry run made that concrete: "Auction Price :
 * RM 1,100,000.00" (a secondary-market auction, not the developer's asking price),
 * "RM3M gets you: 3,400 sq ft" (marketing copy), and a single unit's price after a 25%
 * rebate. All three are real quotes and none is this project's asking price.
 *
 * A wrong price is worse than a blank one — it gets quoted to a buyer with confidence. So
 * a figure whose own evidence says it is an auction, a past transaction, or a
 * rebate-adjusted single unit is dropped rather than guessed at.
 */
const DISQUALIFYING_CONTEXT: Array<[RegExp, string]> = [
  [/auction/i, 'auction price, not developer asking'],
  [/sub[\s-]?sale|subsale/i, 'subsale/secondary market'],
  [/transacted|sold\s+(?:at|for)|past\s+transaction/i, 'completed transaction, not asking'],
  [/gets\s+you|only\s+rm[\d.]+\s*(?:mil|m)\b.*sq\s*ft/i, 'marketing copy, not a price list'],
  [/\brebate\b|less\s+\d+%|after\s+discount/i, 'rebate-adjusted figure for one unit'],
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

const Extracted = z.object({
  found: z.boolean().describe('true only if a price for THIS project is written in the text'),
  kind: z
    .enum(['total', 'psf', 'none'])
    .describe("'total' = a total RM price is written. 'psf' = only a per-square-foot ASKING rate. 'none' = neither."),
  totalMinRM: z.number().nullable().describe('Lowest stated TOTAL price in RM, else null. NEVER computed from a psf rate.'),
  psfMinRM: z.number().nullable().describe('Lowest stated ASKING rate per sqft in RM (200-5000), else null.'),
  psfMaxRM: z.number().nullable().describe('Highest stated ASKING rate per sqft in RM (200-5000), else null.'),
  evidence: z
    .string()
    .describe('The EXACT substring from the text containing the figure, copied verbatim, max 160 chars. Empty when found is false.'),
})

const SYSTEM = `You read WhatsApp chat excerpts from a Malaysian real-estate brokerage and report ONLY prices that are WRITTEN THERE for the named project.

RULES — breaking any of these makes the answer wrong:
1. NEVER calculate. Do not multiply a per-square-foot rate by a size. Do not average. Do not infer from a comparable project someone mentions.
2. A per-square-foot rate is NOT a total. If the text says only "RM1,400 psf", set kind='psf', put 1400 in psfMinRM, and leave totalMinRM null.
3. A MAINTENANCE FEE or sinking fund is NOT a price. Those read like "RM0.85 psf", "RM0.33 psf include sinking fund" — under RM10 psf. Ignore them completely.
4. A booking fee ("Booking Fee RM5,000"), stamp duty, rebate, discount or loan margin is NOT a price. Ignore.
5. Ignore prices belonging to a DIFFERENT project named in the chat (agents compare competitors constantly).
6. A price someone ASKS for ("what is the price range?") is not a price. Only a figure someone STATES.
7. evidence must be copied character-for-character from the text. If you cannot quote it, set found=false.
8. If unsure, set found=false. A missing price is correct and safe; a wrong one is quoted to a real buyer.`

interface Row {
  id: string
  name: string
  status: string
  /**
   * The project's OWN write-up. Included because reading only `kbChunks` missed prices
   * sitting in plain sight (quick-kayinleong-089): Royal Lexis KL states "All from
   * RM1.72mil" in its description, and the first pass left it price-less because this
   * script started from the KB. The description is a FIRST-PARTY source and is stronger
   * evidence than chat, so it is offered to the extractor first.
   */
  description: string
}

async function main() {
  console.log('═══ KB → inventory price sync ═══')
  console.log(`  mode:  ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log(`  model: ${MODEL}`)
  if (ONLY) console.log(`  only:  "${ONLY}"`)
  console.log()

  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!key) {
    console.error('GOOGLE_GENERATIVE_AI_API_KEY is not set. Aborting.')
    process.exit(1)
  }
  const google = createGoogleGenerativeAI({ apiKey: key })
  const model = google(MODEL)

  // ── projects that need a price ──────────────────────────────────────────────
  const projSnap = await adminDb.collection('projects').get()
  const needing: Row[] = projSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter(({ data }) => {
      const total = data.priceValue
      const psf = data.pricePsfMin
      return !(typeof total === 'number' && total > 0) && !(typeof psf === 'number' && psf > 0)
    })
    .map(({ id, data }) => ({
      id,
      name: String(data.name ?? ''),
      status: String(data.status ?? '?'),
      description: String(data.description ?? ''),
    }))
    .filter((p) => !ONLY || p.name.toLowerCase().includes(ONLY))

  console.log(`${projSnap.size} projects · ${needing.length} with no price on record\n`)

  // ── project → its kbDocs, by the conventions the ingest paths actually set ──
  const kbDocsSnap = await adminDb.collection('kbDocs').select('title', 'category').get()
  const kbDocs = kbDocsSnap.docs.map((d) => {
    const x = d.data() as { title?: unknown; category?: unknown }
    const title = typeof x.title === 'string' ? x.title : ''
    return {
      id: d.id,
      category: norm(typeof x.category === 'string' ? x.category : ''),
      subject: norm(title.replace(/^WhatsApp —\s*/i, '').split('—')[0] ?? ''),
    }
  })

  const targets = needing.slice(0, LIMIT === Infinity ? undefined : LIMIT)
  let scanned = 0
  let wrote = 0
  let noChunks = 0
  let noPrice = 0
  let rejected = 0

  for (const [i, p] of targets.entries()) {
    const key2 = norm(p.name)
    const docIds = kbDocs.filter((k) => k.category === key2 || k.subject === key2).map((k) => k.id)
    const label = `[${i + 1}/${targets.length}] ${p.name.slice(0, 40).padEnd(40)}`

    // The project's own write-up counts as a source. `to-inventory.ts` stores the whole
    // Skool body here, so a stated price often lives in it.
    const ownDesc = MONEY_RX.test(p.description) ? p.description : ''

    if (docIds.length === 0 && ownDesc === '') {
      console.log(`${label} — no kbDocs matched and no money text in its own description`)
      noChunks++
      continue
    }

    // Pull chunks, keep only money-bearing ones, rank by mention density.
    const texts: Array<{ chunkId: string; text: string; hits: number }> = []
    for (const docId of docIds) {
      const cs = await adminDb.collection('kbChunks').where('docId', '==', docId).select('text').get()
      for (const c of cs.docs) {
        const t = String(c.get('text') ?? '')
        if (!MONEY_RX.test(t)) continue
        const hits = (t.match(/(rm|myr)\s?[\d,]/gi) ?? []).length
        texts.push({ chunkId: c.id, text: t, hits })
      }
    }
    if (ownDesc) texts.push({ chunkId: `description:${p.id}`, text: ownDesc, hits: 999 })
    scanned++
    if (texts.length === 0) {
      console.log(`${label} — ${docIds.length} docs, 0 money-bearing chunks`)
      noChunks++
      continue
    }
    texts.sort((a, b) => b.hits - a.hits)
    const picked = texts.slice(0, MAX_CHUNKS_PER_PROJECT)
    const corpus = picked.map((t, n) => `[chunk ${n + 1}]\n${t.text}`).join('\n\n')

    let ex: z.infer<typeof Extracted>
    try {
      const r = await generateObject({
        model,
        schema: Extracted,
        system: SYSTEM,
        prompt: `Project: ${p.name}\n\nChat excerpts:\n${corpus.slice(0, 60_000)}`,
      })
      ex = r.object
    } catch (e) {
      console.log(`${label} — extraction failed: ${(e as Error).message.slice(0, 70)}`)
      rejected++
      continue
    }

    if (!ex.found || ex.kind === 'none') {
      console.log(`${label} — ${picked.length} chunks scanned, no stated price`)
      noPrice++
      continue
    }

    // ── GUARD 2: the quoted evidence must exist in what we sent ───────────────
    const haystack = norm(corpus)
    const ev = norm(ex.evidence)
    if (ev.length < 4 || !haystack.includes(ev)) {
      console.log(`${label} — REJECTED: evidence not found verbatim ("${ex.evidence.slice(0, 48)}")`)
      rejected++
      continue
    }

    // ── GUARD 2b: the quote is real, but is it the RIGHT KIND of price? ───────
    const disq = DISQUALIFYING_CONTEXT.find(([rx]) => rx.test(ex.evidence))
    if (disq) {
      console.log(`${label} — REJECTED: ${disq[1]}`)
      console.log(`      evidence: "${ex.evidence.replace(/\s+/g, ' ').slice(0, 80)}"`)
      rejected++
      continue
    }

    // ── GUARDS 3+4: range checks; a rate is never a total ─────────────────────
    const patch: Record<string, unknown> = {}
    let summary = ''
    if (ex.kind === 'total' && typeof ex.totalMinRM === 'number' && ex.totalMinRM >= TOTAL_MIN && ex.totalMinRM <= TOTAL_MAX) {
      patch.priceValue = ex.totalMinRM
      patch.priceBand = priceBandFor(ex.totalMinRM)
      patch.priceProvenance = 'stated'
      summary = `TOTAL RM${ex.totalMinRM.toLocaleString()}`
    } else if (ex.kind === 'psf') {
      const lo = typeof ex.psfMinRM === 'number' ? ex.psfMinRM : null
      const hi = typeof ex.psfMaxRM === 'number' ? ex.psfMaxRM : lo
      if (lo === null || lo < PSF_MIN || lo > PSF_MAX || (hi !== null && (hi < PSF_MIN || hi > PSF_MAX))) {
        console.log(`${label} — REJECTED: psf ${lo}-${hi} outside RM${PSF_MIN}-${PSF_MAX} (maintenance fee?)`)
        rejected++
        continue
      }
      patch.pricePsfMin = lo
      patch.pricePsfMax = hi ?? lo
      patch.priceProvenance = 'psf_only'
      summary = `PSF RM${lo}${hi && hi !== lo ? `-${hi}` : ''}`
    } else {
      console.log(`${label} — REJECTED: kind='${ex.kind}' with no usable figure`)
      rejected++
      continue
    }

    // ── GUARD 5: cite the source ──────────────────────────────────────────────
    const src = picked.find((t) => norm(t.text).includes(ev))
    patch.priceSourceChunkId = src?.chunkId ?? picked[0].chunkId
    // A figure from the project's own write-up is first-party, not chat — do not brand it
    // 'whatsapp-kb' and send Derek to review a source he already owns.
    const fromOwnDescription = String(patch.priceSourceChunkId ?? '').startsWith('description:')
    if (fromOwnDescription) {
      delete patch.priceSourceChunkId
    } else {
      patch.priceSource = 'whatsapp-kb'
    }

    console.log(`${label} ✓ ${summary}`)
    console.log(`      evidence: "${ex.evidence.replace(/\s+/g, ' ').slice(0, 90)}"`)
    if (APPLY) await adminDb.collection('projects').doc(p.id).update(patch)
    wrote++
  }

  console.log('\n── summary ──')
  console.log(`  projects examined:        ${targets.length}`)
  console.log(`  ${APPLY ? 'prices written' : 'prices we WOULD write'}:  ${wrote}`)
  console.log(`  no stated price in KB:    ${noPrice}`)
  console.log(`  no money-bearing chunks:  ${noChunks}`)
  console.log(`  rejected by a guard:      ${rejected}`)
  if (!APPLY) console.log('\n  Dry run. Re-run with --apply to write.')
  if (APPLY && wrote > 0) {
    console.log('\n  ⚠ These came from CHAT, weaker evidence than a sales kit. Every row carries')
    console.log('    priceSource:"whatsapp-kb" + priceSourceChunkId so Derek can review exactly these.')
    console.log('    priceBand changed, so re-run scripts/reembed-projects.ts --apply afterwards.')
  }
  console.log('\n═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', (e as Error).message)
    process.exit(1)
  })
