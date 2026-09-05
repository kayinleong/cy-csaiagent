/**
 * scripts/fix-fabricated-prices.ts — retire the model-authored prices and store the psf
 * rates honestly (quick-kayinleong-088).
 *
 * WHY: `.planning/quick/quick-kayinleong-088/RESEARCH-price-audit.md` established that 21
 * of the 51 non-zero `priceValue`s have NO stated total in their source write-up. The
 * extractor LLM produced them by multiplying a stated per-square-foot rate by a square
 * footage it invented:
 *
 *   Luminar Residence Subang  source says only "Gross Price: RM720 psf"  -> stored 360,000
 *   The Lantern Bangsar       source says only "Price: RM1,400 psf"      -> stored 798,800
 *   Bangsar Hill Park         source says only "RM900-1000psf"           -> stored 900,000
 *   Pinnacle Bangsar          source says only "~RM1,100 psf"            -> stored 5,150,000
 *
 * A MISSING price renders an honest em-dash. A WRONG price renders as authoritative fact
 * to an agent quoting it to a client, and `matchedCriteria.priceMax` asserts a *verified
 * budget match* on it because the invariant only checks `priceValue > 0`, never its
 * provenance. That makes this the higher-severity half of the defect.
 *
 * The user's decision, verbatim: "null the fabricated prices and store psf honestly, then
 * show a report of how many properties miss which data."
 *
 * WHAT IT WRITES, per project:
 *   priceValue       0 when the source states no TOTAL price (unchanged otherwise)
 *   priceBand        ALWAYS recomputed via priceBandFor — see the note below
 *   pricePsfMin/Max  the stated asking rate, for `psf_only` projects
 *   priceProvenance  stated | psf_only | unknown, on every project it touches
 *
 * ⚠ priceBand is recomputed for every project even when priceValue does not move, because
 * `priceBandFor` itself changed in commit e299fcc: `priceBandFor(0)` returned
 * 'under_500k' and now returns 'price_unknown'. Every already-zero project is therefore
 * sitting in the wrong band and would keep being pre-filtered as the cheapest stock in the
 * inventory.
 *
 * ⚠ DOES NOT RE-EMBED. `priceBand` IS part of the embedding text
 * (`src/inventory/embedText.ts`), so every project whose band moves has a stale vector.
 * That is a deliberate scope call, mirroring the D1 decision on `sizeMinSqft`: a mass
 * re-embed of 87 projects is its own claim. The run prints the exact count that needs one.
 *
 * Nothing here goes through `updateProject`, which would trip `assertAdmin` (no signed-in
 * admin in a script) and its re-embed delta check.
 *
 * DRY RUN by default. Needs `--env-file=.env.local` for admin credentials.
 *
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-fabricated-prices.ts
 *   node_modules/.bin/tsx --env-file=.env.local scripts/fix-fabricated-prices.ts --apply
 */

import { existsSync, readFileSync } from 'node:fs'
import { adminDb } from '@/src/firebase/admin'
import { priceBandFor, type PriceBand } from '@/src/firebase/collections'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

/** Local scrape artifact, used only for projects whose live `description` is empty. */
const FALLBACK_CORPUS = 'projects.json'

// ─── Price-shape parsing ──────────────────────────────────────────────────────

/**
 * A money amount as this corpus writes it.
 *
 * ⚠ THE COMMA-GROUPED ALTERNATIVE MUST COME FIRST, AND THE BARE FORM MUST NOT BE
 * `\d{1,3}(?:,\d{3})*`. That shape looks equivalent and is not: on "RM900-1000psf" it
 * consumes only "100" of the 1000, leaves "0psf" behind, and the psf marker then fails to
 * match — so Bangsar Hill Park, whose source states exactly that rate, classified as
 * `unknown` and lost its rate entirely. Found by spot-checking the dry run against the
 * project the audit had already named.
 */
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`

/**
 * An RM amount with an optional magnitude suffix, and an optional range partner.
 *
 * Groups: 1 = amount, 2 = its own suffix, 3 = range-high amount, 4 = the governing suffix.
 * `juta` is Malay for million and appears in this corpus.
 */
const RM_AMOUNT = new RegExp(
  String.raw`(?:RM|MYR)\s*(${AMOUNT})\s*(mill?ion|mil|mill|juta|m|k)?\s*(?:(?:-|–|—|to)\s*(?:RM|MYR)?\s*(${AMOUNT})\s*(mill?ion|mil|mill|juta|m|k)?)?`,
  'gi',
)

/**
 * A per-square-foot marker following an amount.
 *
 * The `/sf` form matters: "Sale: RM1,200- RM1,300/sf" (The MET) is an asking rate written
 * with a slash, and without this branch its 1,200 looks like a total too small to be one,
 * so the project classifies `unknown` and its real rate is lost.
 */
const PSF_SUFFIX =
  /^\s*(?:\+|±)?\s*(?:psf|p\.s\.f|per\s*sq\.?\s*(?:ft|foot|feet)?\b|\/\s*(?:sqft|sq\.?\s*ft|sft|sf)\b)/i

/**
 * A word marking an RM figure as a FEE or an add-on rather than an asking price.
 *
 * Derived from the audit: every unpriced write-up in this corpus still carries several RM
 * figures, and all of them are fees. Without this the classifier calls a booking fee a
 * stated price and leaves a fabricated total in place.
 */
const FEE_WORDS =
  /\b(?:maintenance|sinking|booking|stamp\s+duty|legal|mot|loan|rebate|deposit|discount|furnish\w*|rental|lease|renovation|fees?|package\s+at|voucher|cashback|subsidy|instal+ment|monthly|per\s+month|disbursement|cancellation|charge|valuation|consent)\b/i

/**
 * A fee word sitting immediately AFTER the amount.
 *
 * "e.g. RM500,000 loan × 0.5% = RM2,500" (Sentral Suites) is a worked example of a loan
 * arrangement fee. The qualifying word trails the number, so the left-context guard never
 * sees it and the project classified `stated` on a figure that is not a price at all.
 * Anchored tight so "from RM628,000 with free legal fees" — a real price — survives.
 */
const FEE_RIGHT =
  /^\s*(?:loan|mortgage|rental|rent|per\s+month|monthly|deposit|booking|rebate|discount|voucher|cashback|instal+ment)\b/i

/**
 * A phrase making an RM figure a DELTA off some other price rather than a price.
 *
 * "Semi-furnished option available (price lower by RM400k–RM600k)" (The Ritz-Carlton) even
 * carries the word "price", so it beats the price-label tie-break and would classify the
 * project `stated` on a furnishing discount.
 */
const DELTA_WORDS = /\b(?:lower|higher|cheaper|less|more|reduced|savings?|save|off)\s+by\s*$|\bdiscount\s+of\s*$/i

/**
 * A word marking an RM figure as THE project's asking price.
 *
 * Used to break the tie when a write-up states both a psf rate and some other RM total: a
 * rate labelled "Price"/"Sale"/"Gross" IS the project's price basis, so an unlabelled
 * total elsewhere in the text is not the asking price. That tie-break is what correctly
 * classifies Luminar ("Gross Price: RM720 psf" + "Prices below RM800K"), Platinum Face
 * ("Price: Average RM2,000 ± psf" + "Budget: RM1M+") and The MET ("Sale: RM1,200/sf").
 */
const PRICE_LABEL =
  /\b(?:price|prices|pricing|sale|sales|selling|asking|gross|nett|indicative|starting|from)\b/i

/**
 * A comparison word making an RM figure a CEILING claim rather than an asking price.
 *
 * "Prices below RM800K!!" is marketing copy about a threshold; it is not a price the
 * write-up states. It is also the single line that made Luminar Residence Subang — the one
 * project whose fabricated price the user could actually see on screen — classify as
 * `stated`. "from" is deliberately NOT here: a "from RM628,000" IS a stated price.
 */
const CEILING_WORDS = /\b(?:below|under|less\s+than|no\s+more\s+than|up\s+to|max(?:imum)?)\s*$/i

/**
 * A phrase making an RM figure SOMEONE ELSE'S price — a competitor, a comparable, or this
 * project's own history.
 *
 * "Their similar project, Aetas Damansara, has risen from RM850 psf to RM1,050–1,100 psf"
 * (Accent PJ) carries the word "price" a few words earlier, so it beats the price-label
 * tie-break and widened Accent's own stated 900–950 psf band to 850–1,100. The rates in
 * that sentence belong to a different building.
 */
const COMPARABLE_WORDS =
  /\b(?:risen|rose|grown|grew|appreciat\w*|track\s+record|similar\s+project|compared|comparable|comparison|versus|vs\.?|nearby|neighbour\w*|surrounding|other\s+projects|resale|secondary\s+market|transacted|benchmark)\b/i

/** How much of the same line before an amount the guards inspect. */
const SAME_LINE_CHARS = 52

/**
 * A section header: a short line ending in a colon, which labels the lines beneath it.
 *
 * These write-ups are structured as "Booking Fee:" / "Standard unit: RM100,000" — the
 * qualifying word is on the PREVIOUS line. Without header tracking, PDH Imperial's
 * RM100,000 booking deposit reads as a stated asking price and its real "RM1,700 – RM2,300
 * psf" rate is thrown away.
 */
const SECTION_HEADER = /^[^:\n]{1,60}:\s*$/

/**
 * Plausibility window for a TOTAL asking price in RM. Floor 100,000 keeps a psf rate that
 * slipped a suffix ("RM1,400") out of the totals; ceiling 200,000,000 admits the whole
 * corpus (priciest real total is RM10.97M) without admitting a phone number.
 */
const MIN_TOTAL_RM = 100_000
const MAX_TOTAL_RM = 200_000_000

/**
 * Plausibility window for an ASKING psf rate in RM.
 *
 * ⚠ THE ONE THING NOT TO GET WRONG. RM0.20–2.00 psf is the MAINTENANCE / sinking-fund
 * charge and appears in nearly every write-up, usually one line away from the asking rate.
 * Conflating them is the easiest way to corrupt `pricePsfMin`/`pricePsfMax` — the field's
 * own doc comment says so. 200 is comfortably above every maintenance fee measured in this
 * corpus (max 2.00) and below every asking rate (min ~700).
 */
const MIN_PSF_RM = 200
const MAX_PSF_RM = 5_000

function toNumber(raw: string | undefined): number {
  if (raw === undefined) return Number.NaN
  return Number(raw.replace(/,/g, ''))
}

function applySuffix(value: number, suffix: string | undefined): number {
  if (!Number.isFinite(value)) return Number.NaN
  const s = (suffix ?? '').toLowerCase()
  if (s === '') return value
  if (s === 'k') return value * 1_000
  return value * 1_000_000
}

interface PriceEvidence {
  /** Every plausible TOTAL asking price stated in the text, in RM. */
  totals: number[]
  /** Totals whose line or section header labels them as the asking price. */
  labelledTotals: number[]
  /** Every plausible ASKING psf rate stated in the text, in RM/sqft. */
  psfRates: number[]
  /** psf rates whose line or section header labels them as the asking price. */
  labelledPsfRates: number[]
  /** The verbatim fragments the psf rates came from, for eyeball review. */
  psfQuotes: string[]
  /** The verbatim fragments the totals came from, for eyeball review. */
  totalQuotes: string[]
}

/**
 * Scan a write-up for what it ACTUALLY states about price.
 *
 * Walks LINE BY LINE, carrying the most recent section header, because these write-ups put
 * the qualifying word on the line above the number. A figure is a psf rate if a psf marker
 * follows it, a total if it does not, is not in a fee context, is not a ceiling claim, and
 * lands in the plausible-total window. A range contributes both endpoints.
 *
 * Nothing is derived, converted or multiplied — that is the entire point of this script.
 */
function readPriceEvidence(text: string): PriceEvidence {
  const out: PriceEvidence = {
    totals: [],
    labelledTotals: [],
    psfRates: [],
    labelledPsfRates: [],
    psfQuotes: [],
    totalQuotes: [],
  }
  if (typeof text !== 'string' || text.length === 0) return out

  let header = ''

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (SECTION_HEADER.test(line)) {
      header = line
      continue
    }

    for (const m of line.matchAll(new RegExp(RM_AMOUNT.source, RM_AMOUNT.flags))) {
      const at = m.index ?? 0
      const after = line.slice(at + m[0].length)
      const sameLineLeft = line.slice(Math.max(0, at - SAME_LINE_CHARS), at)
      const context = `${header} ${sameLineLeft}`
      const quote = m[0].replace(/\s+/g, ' ').trim()

      // The suffix on the range HIGH governs both endpoints ("RM1.24 - 1.8mil").
      const governing = m[4] ?? m[2]
      const low = applySuffix(toNumber(m[1]), m[2] ?? governing)
      const high = m[3] !== undefined ? applySuffix(toNumber(m[3]), m[4]) : low
      const bare = [toNumber(m[1]), m[3] !== undefined ? toNumber(m[3]) : toNumber(m[1])]

      // These three disqualify a figure in EITHER form — skip it whole.
      // A comparable belongs to another building; a ceiling ("Prices below RM800K",
      // "BOC: 90% (up to RM1,200 psf)" — a loan margin cap, not The Lantern's RM1,400
      // asking rate) and a delta ("price lower by RM400k") are not prices at all.
      if (COMPARABLE_WORDS.test(context)) continue
      if (CEILING_WORDS.test(sameLineLeft)) continue
      if (DELTA_WORDS.test(sameLineLeft)) continue

      const feeContext = FEE_WORDS.test(context)
      const priceLabelled = PRICE_LABEL.test(context) && !feeContext

      if (PSF_SUFFIX.test(after)) {
        // A psf rate is written WITHOUT a magnitude suffix in this corpus, so the bare
        // numbers are the rate. "RM900-1000psf" -> 900 and 1000. The window itself
        // separates an asking rate from a maintenance charge — see MIN_PSF_RM.
        const rates = bare.filter((v) => Number.isFinite(v) && v >= MIN_PSF_RM && v <= MAX_PSF_RM)
        if (rates.length > 0) {
          out.psfRates.push(...rates)
          if (priceLabelled) out.labelledPsfRates.push(...rates)
          out.psfQuotes.push(`${quote}${after.slice(0, 8).replace(/\s+/g, ' ')}`.trim())
        }
        continue
      }

      if (feeContext) continue
      if (FEE_RIGHT.test(after)) continue

      const totals = [low, high].filter(
        (v) => Number.isFinite(v) && v >= MIN_TOTAL_RM && v <= MAX_TOTAL_RM,
      )
      if (totals.length > 0) {
        out.totals.push(...totals)
        if (priceLabelled) out.labelledTotals.push(...totals)
        out.totalQuotes.push(quote)
      }
    }
  }

  return out
}

type Provenance = 'stated' | 'psf_only' | 'unknown'

/**
 * Decide where `priceValue` may legitimately come from.
 *
 * A LABELLED figure outranks an unlabelled one of either kind. That is the rule that stops
 * a booking deposit or a "Budget: RM1M+" aside from overriding a rate the write-up
 * explicitly presents as the price ("Gross Price: RM720 psf"). Only when neither kind is
 * labelled does raw presence decide, and a total then wins because a total is what
 * `priceValue` means.
 */
function classify(ev: PriceEvidence): Provenance {
  if (ev.labelledTotals.length > 0) return 'stated'
  if (ev.labelledPsfRates.length > 0) return 'psf_only'
  if (ev.totals.length > 0) return 'stated'
  if (ev.psfRates.length > 0) return 'psf_only'
  return 'unknown'
}

// ─── Fallback corpus ──────────────────────────────────────────────────────────

interface ScrapeRecord {
  titleClean?: string
  body?: { text?: string }
}

/** Name -> raw body text, for projects whose live `description` is empty. */
function loadFallback(): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(FALLBACK_CORPUS)) return map
  try {
    const parsed = JSON.parse(readFileSync(FALLBACK_CORPUS, 'utf8')) as { projects?: ScrapeRecord[] }
    for (const p of parsed.projects ?? []) {
      const name = (p.titleClean ?? '').trim()
      const text = String(p.body?.text ?? '')
      if (name.length > 0 && text.length > 0) map.set(name.toLowerCase(), text)
    }
  } catch {
    // A partial or regenerated artifact is not worth failing the run over — the live
    // description is the source of truth and the fallback is only for empty ones.
    return map
  }
  return map
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n === 0 ? '0' : n.toLocaleString('en-MY')
}

async function main() {
  console.log('═══ projects price provenance repair ═══')
  console.log(`  mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)
  console.log()

  const fallback = loadFallback()
  const snap = await adminDb.collection('projects').limit(500).get()

  const counts: Record<Provenance, number> = { stated: 0, psf_only: 0, unknown: 0 }
  let usedLive = 0
  let usedFallback = 0
  let noSource = 0
  let priceCleared = 0
  let bandChanged = 0
  let psfWritten = 0
  let toUpdate = 0
  let statedButStoredValueNotInSource = 0
  let statedAlsoQuotesPsf = 0
  let statedButStoredZero = 0
  const ambiguous: string[] = []
  const recoverable: string[] = []

  const writer = APPLY ? adminDb.bulkWriter() : null

  console.log(
    `  ${'provenance'.padEnd(10)} ${'priceValue before'.padStart(18)} ${'after'.padStart(12)} ${'band before'.padEnd(13)} ${'after'.padEnd(13)} psf        project`,
  )
  console.log(`  ${'─'.repeat(118)}`)

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const name = typeof data.name === 'string' ? data.name : doc.id

    // Source of truth: the live `description`, because that is what the app serves and
    // what the embedding was built from. The scrape artifact is only a fallback.
    const live = typeof data.description === 'string' ? data.description : ''
    let text = live
    if (text.trim().length > 0) usedLive++
    else {
      text = fallback.get(name.trim().toLowerCase()) ?? ''
      if (text.length > 0) usedFallback++
      else noSource++
    }

    const ev = readPriceEvidence(text)
    const provenance = classify(ev)
    counts[provenance]++

    const storedValue = typeof data.priceValue === 'number' ? data.priceValue : 0
    const storedBand = typeof data.priceBand === 'string' ? (data.priceBand as PriceBand) : undefined

    const nextValue = provenance === 'stated' ? storedValue : 0
    const nextBand = priceBandFor(nextValue)

    // LABELLED rates only, when any exist. Bangsar Hill Park states its own entry rate as
    // "RM900-1000psf" and then lists four COMPETITORS at "RM1300psf" — taking every rate
    // would store the neighbourhood's range as this project's asking rate.
    const rates = ev.labelledPsfRates.length > 0 ? ev.labelledPsfRates : ev.psfRates
    const psfMin = provenance === 'psf_only' && rates.length > 0 ? Math.min(...rates) : null
    const psfMax = provenance === 'psf_only' && rates.length > 0 ? Math.max(...rates) : null

    if (provenance === 'stated') {
      if (ev.psfQuotes.length > 0) statedAlsoQuotesPsf++
      // The source DOES state a total and we hold nothing. These are the RECOVERABLE
      // cases the audit flagged (Royal Lexis's price sat past the extractor's 6,000-char
      // prompt truncation; d'Brightton's layouts are priced but all marked SOLD OUT).
      // Not filled in here: writing a price means choosing WHICH stated total is the
      // asking price, and that is a judgement for Derek, not for a regex.
      if (storedValue === 0) {
        statedButStoredZero++
        recoverable.push(
          `${name} — holds 0, source states ${[...new Set(ev.totals)].slice(0, 5).map(fmt).join(' / ')}`,
        )
      }
      // A weaker signal than the psf_only case, reported not acted on: the stored number
      // is not one of the totals the text states. Usually legitimate (the model took the
      // "from" price, or a figure written in a shape this parser does not read), but it
      // is the population any follow-up audit should start from.
      if (storedValue > 0 && !ev.totals.includes(storedValue)) {
        statedButStoredValueNotInSource++
        ambiguous.push(`${name} — stored ${fmt(storedValue)}, source states ${ev.totals.slice(0, 4).map(fmt).join(' / ')}`)
      }
    }

    const patch: Record<string, unknown> = {}
    if (nextValue !== storedValue) {
      patch.priceValue = nextValue
      priceCleared++
    }
    if (nextBand !== storedBand) {
      patch.priceBand = nextBand
      bandChanged++
    }
    // Compared against the stored pair, not written blind, so a second run reports zero
    // writes and a run after a classifier fix repairs only what actually moved.
    const storedPsfMin = typeof data.pricePsfMin === 'number' ? data.pricePsfMin : null
    const storedPsfMax = typeof data.pricePsfMax === 'number' ? data.pricePsfMax : null
    if (psfMin !== null && (psfMin !== storedPsfMin || psfMax !== storedPsfMax)) {
      patch.pricePsfMin = psfMin
      patch.pricePsfMax = psfMax
      psfWritten++
    }
    if (data.priceProvenance !== provenance) patch.priceProvenance = provenance

    const psfCell = psfMin === null ? '—' : psfMin === psfMax ? `${psfMin}` : `${psfMin}-${psfMax}`
    console.log(
      `  ${provenance.padEnd(10)} ${fmt(storedValue).padStart(18)} ${fmt(nextValue).padStart(12)} ` +
        `${(storedBand ?? '—').padEnd(13)} ${nextBand.padEnd(13)} ${psfCell.padEnd(10)} ${name.slice(0, 44)}`,
    )
    if (provenance === 'psf_only') console.log(`             source: ${ev.psfQuotes.slice(0, 3).join(' /// ')}`)

    if (Object.keys(patch).length === 0) continue
    toUpdate++
    writer?.update(doc.ref, patch)
  }

  if (writer) await writer.close()

  console.log()
  console.log('  ── classification ──')
  console.log(`  stated   (a total price is written verbatim) : ${counts.stated}`)
  console.log(`  psf_only (only a per-sqft asking rate)      : ${counts.psf_only}`)
  console.log(`  unknown  (no price of any kind)             : ${counts.unknown}`)
  console.log(`  total docs                                  : ${snap.size}`)
  console.log()
  console.log('  ── source used ──')
  console.log(`  live Firestore \`description\` : ${usedLive}`)
  console.log(`  ${FALLBACK_CORPUS} fallback     : ${usedFallback}`)
  console.log(`  no source text at all        : ${noSource}`)
  console.log()
  console.log('  ── changes ──')
  console.log(`  priceValue -> 0                  : ${priceCleared}`)
  console.log(`  priceBand recomputed             : ${bandChanged}`)
  console.log(`  pricePsfMin/Max written          : ${psfWritten}`)
  console.log(`  docs ${APPLY ? 'updated' : 'to update'}${APPLY ? '                    ' : '                  '}: ${toUpdate}`)
  console.log()
  console.log('  ── follow-ups, NOT done here ──')
  console.log(
    `  ${bandChanged} projects need RE-EMBEDDING: priceBand is part of the embedding text\n` +
      `     (src/inventory/embedText.ts), so their stored 1024-d vector is now stale.\n` +
      `     Out of scope for this claim — mirrors the D1 decision on sizeMinSqft.`,
  )
  console.log(
    `  ${statedButStoredValueNotInSource} \`stated\` projects hold a priceValue that is not one of the totals their\n` +
      `     source text states. Left untouched: the source DOES state a total, so the\n` +
      `     number is not fabricated out of a psf rate — but it is unverified.`,
  )
  console.log(
    `  ${statedAlsoQuotesPsf} \`stated\` projects ALSO quote an asking psf rate. Their pricePsfMin/Max are\n` +
      `     left null, per the claim scope (psf fields are written for psf_only only).`,
  )
  console.log(
    `  ${statedButStoredZero} projects are \`stated\` yet hold priceValue 0 — a price EXISTS in their source\n` +
      `     and we lost it. Recoverable, but which stated total is the asking price is a\n` +
      `     judgement call for Derek, not for a regex. Listed below.`,
  )
  if (recoverable.length > 0) {
    console.log()
    console.log('  ── recoverable: source states a price, we hold 0 ──')
    for (const line of recoverable) console.log(`  • ${line}`)
  }
  if (ambiguous.length > 0) {
    console.log()
    console.log('  ── ambiguous `stated` projects (reported, not changed) ──')
    for (const line of ambiguous) console.log(`  • ${line}`)
  }
  if (!APPLY && toUpdate > 0) console.log('\n  Dry run. Re-run with --apply to write.')
  console.log()
  console.log('═══ done ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('price repair failed:', (e as Error).message)
    process.exit(1)
  })
