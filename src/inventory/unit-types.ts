/**
 * src/inventory/unit-types.ts — deterministic per-layout extraction from a project
 * description (quick-kayinleong-088).
 *
 * WHY THIS EXISTS: `priceValue` + `sizeMinSqft`/`sizeMaxSqft` collapse a project down to
 * one price and one size span. That cannot answer the question a D2 agent actually gets
 * asked ("what does the 2-bedroom cost?"), and the pressure to answer it anyway is exactly
 * what produced the defect this claim exists to fix — an extractor LLM multiplying a
 * stated psf rate by a square footage it invented. The per-layout table is already written
 * in the source text, one layout per line:
 *
 *   Type A: 1,199 sqft | 3R 2B | 2 CP — From RM785,000 – RM819,000
 *   Studio: 820 sqft — from RM2.28 million
 *   504sf Studio - From RM1.24 - 1.8mil
 *
 * So it is parsed, not inferred. Deterministic regex only — NO model, mirroring the
 * `size-extract.ts` / D1 precedent: the corpus is a fixed ~87 records, every extraction is
 * eyeballable, and a regex gives the same answer on every run. `UnitTypeEntry.raw` keeps
 * the verbatim source line so every rendered figure stays auditable back to the write-up.
 *
 * ⚠ PRECISION OVER RECALL, DELIBERATELY. A missed layout renders nothing. A fabricated
 * layout renders as authoritative fact to an agent quoting it to a client — the same class
 * of harm as the fabricated prices. Every guard below therefore prefers `[]` to a guess,
 * and `null` to a default. Three line-level rules carry most of that weight:
 *   1. a line must carry a LAYOUT MARKER (a type code, "Studio", or a bedroom count) —
 *      a bare size is a threshold, a facility or a competitor comparable, not a layout;
 *   2. a line must state EXACTLY ONE plausible size — two means it is a show-unit list, a
 *      size-plus-terrace row or a competitor comparison, none of which is one layout;
 *   3. a line must be short enough to be a table row (MAX_LINE_CHARS) — this is what
 *      keeps a prose paragraph that happens to name a size out of the result.
 *
 * Pure module: ZERO imports, so it is unit-testable in the `node` vitest environment and
 * safe to import from a script, a Server Component or a client component alike.
 */

/**
 * A number as written in this corpus: comma-grouped ("1,600") or a bare 2–5 digit run.
 *
 * The comma-grouped alternative MUST come first, or "19,041" matches as "19" and a
 * 19,041 sqft villa reads as 19 sqft. Same trap documented in `size-extract.ts`.
 */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d{2,5}`

/**
 * A square-foot unit, INCLUDING the bare `sf` / `sft` forms that `size-extract.ts`
 * deliberately refuses. Longest alternative first so `sqft` never matches as `sf` + junk.
 *
 * ⚠ WHY THE BARE `sf` IS SAFE HERE AND NOT THERE. `size-extract.ts` documents that a bare
 * `sf` alternative is a defect in its extractor, because this corpus writes per-square-foot
 * PRICES as `psf` ("Maintenance Fee: RM0.65 psf", "RM1300psf") and its pattern admits an
 * arbitrary gap between the number and the unit. Accepting `sf` is nonetheless mandatory
 * here — "504sf Studio", "3380sft Type H1" and "1,292–1,496 sf | 3+1 rooms" are all real
 * layout rows.
 *
 * The trap is disarmed STRUCTURALLY rather than by a guard: `SIZE_MENTION` requires the
 * unit to follow the digits with nothing between but whitespace or the word "per", so the
 * `p` of `psf` always blocks the match. That is an argument, not a proof, which is why
 * `psf` rejection has its own tests — a mutation run confirmed a left-context "is the
 * preceding character a letter" guard here is UNREACHABLE (the character before the unit
 * is always a digit or a space), so keeping one would have been untested dead weight
 * pretending to be a defence.
 */
const UNIT = String.raw`sqft|sq\.?\s*ft\.?|sft|sf`

/** A range separator. All three dash characters, because the corpus prefers en dashes. */
const RANGE_SEP = String.raw`-|–|—|to`

/**
 * A size range separator. Wider than `RANGE_SEP` because a layout row states alternative
 * sizes with `/` or `&` as often as with a dash — "1 + 1 Flexi Room: 775 / 840 sq. ft."
 * (Eaton), "1,324 / 1,313 sqft (Dual Key)" (d'Brightton), "Type X5 & X4: 764 & 797 sqft"
 * (Tria). Without these the row keeps only its SECOND figure, so the "from" size — the one
 * an agent quotes — is the one that goes missing.
 */
const SIZE_RANGE_SEP = String.raw`-|–|—|/|&|to`

/**
 * One size mention on a line: any number of leading range endpoints, then the number the
 * unit is actually attached to, the gap, then the unit.
 *
 * Capture groups: 1 = the whole leading-endpoint run (may hold several numbers —
 * "1,053 / 1,085 / 1,225 sq. ft." is verbatim Royal Lexis Type C), 2 = the number the
 * unit belongs to, 3 = the gap (inspected by the "per" guard). Group 1 is re-scanned for
 * numbers rather than captured per endpoint, because a repeated capture group keeps only
 * its last iteration.
 *
 * The gap deliberately admits an intervening "per" so that "1,200 per sq ft" MATCHES and
 * is then REJECTED by a guard. Making it unmatchable instead would look equivalent but
 * leaves the psf guard untestable — and an untested guard is the thing this repo has
 * shipped before (same reasoning as `size-extract.ts` SQFT_MENTION).
 */
const SIZE_MENTION = new RegExp(
  String.raw`((?:(?:${NUMBER})\s*(?:${SIZE_RANGE_SEP})\s*)+)?(${NUMBER})(\s*(?:per\s+)?)(?:${UNIT})\b`,
  'gi',
)

/** Pulls every endpoint out of a `SIZE_MENTION` group-1 run. */
const NUMBER_RUN = new RegExp(NUMBER, 'g')

/** Left context that makes the number a PRICE, not an area ("Indicative Price: RM1,450 sq ft"). */
const CURRENCY_TAIL = /(?:rm|myr|\$)\s*$/i

/** Right context that makes the number a per-square-foot rate. */
const PSF_HEAD = /^\s*(?:psf|p\.s\.f|per\s+sq)/i

/**
 * A "per" sitting between the number and the unit — a per-square-foot RATE, not an area.
 *
 * Scoped to the gap rather than to the whole line, because a genuine layout row may
 * legitimately mention psf elsewhere ("4,000 sqft built-up, 5+1 bedrooms — from RM3.6M
 * (~RM900+ psf)" is a real Puncak Wangsamas row and must survive).
 */
const PER_GAP = /per/i

/**
 * A comparison operator immediately before the size, which makes it a THRESHOLD rather
 * than a stated layout area.
 *
 * FOUND ON REAL RECORDS: "Only 3 bedrooms > 1,345sf given side by side 2 carparks" (TRX
 * Residences) and "Units below 1,300 sqft: 1 car park" (Pavilion Damansara) both carry a
 * bedroom/unit word AND exactly one plausible size, so nothing else in this extractor
 * stops them. They are allocation rules, not layouts.
 */
const THRESHOLD_LEFT =
  /(?:[><≥≤]|\bover\b|\babove\b|\bbelow\b|\bunder\b|\bmore\s+than\b|\bless\s+than\b|\bup\s+to\b|\bstarting\s+from\b|\bfrom\s+as\s+little\s+as\b)[^a-z0-9]{0,4}$/i

/** How much text before a mention the currency / threshold guards inspect. */
const LEFT_CONTEXT_CHARS = 24

/**
 * A left context labelling the figure as something other than a purchasable unit's
 * built-up area. Same census-derived list as `size-extract.ts` NON_BUILT_UP_LABEL, plus
 * the terrace / garden / show-unit cases that only matter at line grain.
 */
const NON_LAYOUT_LABEL =
  /\b(?:land\s+(?:size|area)|facilit\w*|amenit\w*|gym|clubhouse|pool|garden|terrace|balcon\w*|lobby|retail|car\s*park|show\s*(?:unit|units|gallery)|net\s+floor\s+area|gross\s+floor\s+area|total\s+site)\b[^.]{0,24}$/i

/** Plausibility window for a Malaysian built-up area, in sqft. Same bounds as D1. */
const MIN_PLAUSIBLE_SQFT = 200
const MAX_PLAUSIBLE_SQFT = 20_000

/**
 * A layout label: a type/villa/penthouse code, optionally with the parenthetical that
 * disambiguates it ("Type H1 (North Wing)", "Type B1 (Duplex)").
 *
 * The code token may not itself be one of the keywords, so "Duplex Penthouse C1" labels as
 * "Penthouse C1" rather than stopping at "Duplex Penthouse" and dropping the code.
 */
const TYPE_CODE =
  /\b(?:Type|Villa|Penthouse|Duplex|Suite)\s+(?!(?:Type|Villa|Penthouse|Duplex|Suite)\b)[A-Z0-9][A-Za-z0-9./&+-]*(?:\s*(?:&|\/)\s*[A-Z0-9][A-Za-z0-9./+-]*)*(?:\s*\([^)]{1,32}\))?/

/** A standalone studio label. Lowest-precedence bedroom signal — see `readBedrooms`. */
const STUDIO = /\bstudio\b/i

/**
 * A bedroom count as this corpus writes it, most explicit form first.
 *
 * `(?<![a-z])rooms?\b` deliberately does NOT match inside "bathrooms" — the `r` there is
 * preceded by a letter — which is what keeps "5+1 rooms, 5+1 bathrooms" reading as 5 and
 * not as a bathroom count. A LETTER lookbehind rather than a word boundary, because the
 * corpus also writes the count with no space at all ("2rooms", "1+1Room", "4+1rooms") and
 * `\b` fails between a digit and a letter. One optional intervening adjective is allowed
 * so "1 flexi room" (Parkside Type A) parses.
 */
const BEDROOM_PATTERNS: readonly RegExp[] = [
  /(\d)\s*\+\s*\d\s*(?:[a-z]+\s+)?(?<![a-z])(?:bedrooms?|rooms?|beds?)\b/i,
  /(\d)\s*(?:[a-z]+\s+)?(?<![a-z])(?:bedrooms?|rooms?|beds?)\b/i,
  // Compact "3R 2B" / "4R3B" / "3+1R 3B" form. Last, because a bare R is the weakest
  // signal: the negative lookahead is what stops it firing on the `r` of "1 room" or
  // "Regent". The `+N` variant comes first or "3+1R" reads as 1 — measured on Rimbun
  // Saujana ("3+1R 3B with Balcony") and Padang Residences ("2+1R 2B").
  /(\d)\s*\+\s*\d\s*R(?![a-z])/,
  /(\d)\s*R(?![a-z])/,
]

/**
 * A layout marker — the line must have one. Without this rule a bare size on a line
 * ("Ryan & Miho: 678–818 sf", a COMPETITOR comparable from the Accent PJ write-up;
 * "Windsor: 568 units — 614 – 1,831 sqft", a tower breakdown) becomes a fake layout.
 */
const LAYOUT_MARKERS: readonly RegExp[] = [TYPE_CODE, STUDIO, ...BEDROOM_PATTERNS]

/**
 * Maximum length of a line that can be a layout row.
 *
 * A table row is terse; the longest real row measured in this corpus is 92 characters
 * ("1,076 sqft — 3 rooms, 2 baths, 2 car parks, 2 balconies (KLCC / … view)"). A prose
 * sentence that happens to name a size and a bedroom count runs longer, and this is the
 * cheapest reliable way to tell the two apart. A shape heuristic, not a law — if a future
 * import writes long rows they will be skipped, which is the safe direction.
 */
const MAX_LINE_CHARS = 140

/**
 * Minimum rows for a result to be returned at all.
 *
 * SET TO 1 ON EVIDENCE, NOT BY DEFAULT. A floor of 2 is the intuitive precision guard —
 * "a table has more than one row" — and it was tried first. Measured against the live
 * 87-project corpus on 2026-09-05 it discarded exactly five single-row matches, and all
 * five were REAL layouts, correctly parsed:
 *
 *   Jewel by Oxley KLCC        "2+1 Rooms: 1,173 sqft (109 sqm)"
 *   One Eleven Menerung        "3,714 sqft (Type L): 3 car parks"
 *   Puncak Wangsamas Phase 2   "4,000 sqft built-up, 5+1 bedrooms … from RM3.6M"
 *   Platinum Face Suite 2      "3 Bedrooms: 1,625 sq.ft"
 *   Setia Sky Seputeh          "2,300 sqft — 3+1 bedrooms, Type A, B & F"
 *
 * Zero false-positive singles were found, so the floor bought nothing and cost five
 * projects their only layout. Precision here comes from the PER-LINE guards, not from a
 * row count. The constant stays so the tradeoff is visible and one edit away if a future
 * import proves otherwise.
 */
const MIN_TABLE_ENTRIES = 1

/**
 * A line that ANNOUNCES the show units rather than tabulating layouts.
 *
 * FOUND ON A REAL RECORD: "Show Units: Type A1 (624 sf), Type B1/B2 (926 sf)" (Golden
 * Crown). Its first size is killed by NON_LAYOUT_LABEL and its second is not — the label
 * window only reaches back 24 characters — so exactly one size survives, the one-size rule
 * passes, and the row pairs "Type A1" with 926 sqft. Type A1 is 624 sqft. That is the
 * fabrication failure mode in miniature: a plausible number attached to the wrong label.
 *
 * Anchored at line start on purpose. "Type A1 — 1,350 sqft | 3+1 rooms, 2 baths (Show
 * unit)" (The Reya) is a genuine layout row that merely notes which type is on display,
 * and an unanchored reject would silently drop it.
 */
const SHOW_UNIT_HEADER = /^show\s*(?:unit|gallery|suite|room)s?\b/i

/**
 * A leading segment too generic to be a layout label ("Built-Up: 4,100 sqft | 6+1 rooms").
 * These fall through to the bedroom phrase instead.
 */
const GENERIC_HEAD = /^(?:built[\s-]?up|unit\s+sizes?|sizes?|layouts?|price|typical|available)\b/i

/** Defensive ceiling: no real write-up tabulates more layouts than this. */
const MAX_TABLE_ENTRIES = 40

/**
 * A price mention: `RM` then an amount, optionally a range, optionally a k/m/mil suffix.
 *
 * Capture groups: 1 = first amount, 2 = first amount's own suffix (usually absent),
 * 3 = range high amount, 4 = the governing suffix.
 *
 * "From RM1.24 - 1.8mil" means 1,240,000–1,800,000: the suffix on the SECOND number
 * governs BOTH, which is why group 4 is applied to group 1 when group 2 is absent.
 */
const PRICE_MENTION =
  /(?:RM|MYR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(mill?ion|mil|mill|m|k)?\s*(?:(?:-|–|—|to)\s*(?:RM|MYR)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(mill?ion|mil|mill|m|k)?)?/gi

/**
 * Plausibility window for a UNIT price in RM.
 *
 * Floor 100,000: the cheapest real total in this corpus is RM563,160 (Kensho Type B). The
 * floor's real job is to reject a psf RATE that slipped past the suffix guards —
 * "RM1,400 psf" parses to 1,400 and dies here, which is the second of two independent
 * layers stopping the fabrication defect from re-entering through this parser.
 * Ceiling 100,000,000: the priciest real layout is RM10.97M (St. Regis 3-bed).
 */
const MIN_PLAUSIBLE_PRICE_RM = 100_000
const MAX_PLAUSIBLE_PRICE_RM = 100_000_000

/**
 * A left context that makes an RM figure a FEE or an add-on, not the unit's asking price.
 * "(optional ID package at RM100k)" clears the price floor on its own.
 */
const FEE_LEFT =
  /\b(?:maintenance|sinking|booking|stamp\s+duty|legal|mot|loan|rebate|deposit|fee|package\s+at|discount|rental|psf)\b[^.]{0,24}$/i

/** "1,600" / "1.24" -> number. NaN for anything unparseable. */
function toNumber(raw: string | undefined): number {
  if (raw === undefined) return Number.NaN
  return Number(raw.replace(/,/g, ''))
}

/** Apply a k/m/mil suffix. No suffix means the number is already in RM. */
function applySuffix(value: number, suffix: string | undefined): number {
  if (!Number.isFinite(value)) return Number.NaN
  const s = (suffix ?? '').toLowerCase()
  if (s === '') return value
  if (s === 'k') return value * 1_000
  return value * 1_000_000
}

/** Split into candidate rows. Bullets, list glyphs and leading punctuation are noise. */
function toLines(description: string): string[] {
  return description
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•▪●○*\-–—>|]+/, '').trim())
    .filter((l) => l.length > 0)
}

/** The single plausible size on a line, or null when there are zero or several. */
function readSize(line: string): number | null {
  const pattern = new RegExp(SIZE_MENTION.source, SIZE_MENTION.flags)
  const found: number[] = []

  for (const m of line.matchAll(pattern)) {
    const at = m.index ?? 0

    // GUARD — "1,200 per sq ft": a per-square-foot rate whose number is condo-sized and
    // would otherwise sail straight through the plausibility clamp.
    if (PER_GAP.test(m[3] ?? '')) continue

    const left = line.slice(Math.max(0, at - LEFT_CONTEXT_CHARS), at)
    // GUARD — currency prefix: the number is a price written with an area unit.
    if (CURRENCY_TAIL.test(left)) continue
    // GUARD — a threshold ("> 1,345sf", "Units below 1,300 sqft").
    if (THRESHOLD_LEFT.test(left)) continue
    // GUARD — a facility, land plot, terrace or show unit rather than a layout.
    if (NON_LAYOUT_LABEL.test(left)) continue
    // GUARD — a trailing psf marker ("1,200 sq ft psf").
    if (PSF_HEAD.test(line.slice(at + m[0].length))) continue

    // A range contributes its LOW endpoint: a row like "2+1 rooms: 943 – 1,093 sqft"
    // covers several stacks of one layout, and the "from" size is the honest single
    // figure — the one an agent quotes. The full range stays visible in `raw`.
    const leading = (m[1] ?? '').match(NUMBER_RUN) ?? []
    const endpoints = [...leading, m[2]]
      .map(toNumber)
      .filter((v) => Number.isFinite(v) && v >= MIN_PLAUSIBLE_SQFT && v <= MAX_PLAUSIBLE_SQFT)
    if (endpoints.length === 0) continue
    found.push(Math.min(...endpoints))
  }

  // Exactly one. Two sizes on a line means it is not a single layout row — it is a show
  // unit list ("Type A1 (624 sf), Type B1/B2 (926 sf)"), a size-plus-terrace row, or a
  // competitor comparison ("mostly 703–1,052 sf (corner units only 1,400 sf)").
  return found.length === 1 ? found[0]! : null
}

/**
 * Bedrooms stated on a line, or null.
 *
 * An explicit room count OUTRANKS "Studio", because "4+1 rooms + 1 studio" is a 4-bedroom
 * layout with a studio annexe, not a studio. A `1+1` layout stores 1 — the "+1" is a
 * study/utility, and counting it inflates matches against a client's bedroom requirement
 * (documented on `UnitTypeEntry.bedrooms`).
 */
function readBedrooms(line: string): number | null {
  for (const pattern of BEDROOM_PATTERNS) {
    const m = line.match(pattern)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n >= 0 && n <= 12) return n
    }
  }
  if (STUDIO.test(line)) return 0
  return null
}

/** The layout's price range in RM, or nulls when the line states none. */
function readPrice(line: string): { min: number | null; max: number | null } {
  const pattern = new RegExp(PRICE_MENTION.source, PRICE_MENTION.flags)

  for (const m of line.matchAll(pattern)) {
    const at = m.index ?? 0
    const left = line.slice(Math.max(0, at - LEFT_CONTEXT_CHARS), at)
    if (FEE_LEFT.test(left)) continue
    if (PSF_HEAD.test(line.slice(at + m[0].length))) continue

    // The suffix on the range HIGH governs both endpoints: "RM1.24 - 1.8mil".
    const governing = m[4] ?? m[2]
    const low = applySuffix(toNumber(m[1]), m[2] ?? governing)
    const high = m[3] !== undefined ? applySuffix(toNumber(m[3]), m[4]) : low

    const ok = (v: number) =>
      Number.isFinite(v) && v >= MIN_PLAUSIBLE_PRICE_RM && v <= MAX_PLAUSIBLE_PRICE_RM
    if (!ok(low) || !ok(high)) continue

    // FIRST plausible price on the line wins. That is what makes "from RM1.74 million
    // (optional ID package at RM100k)" read 1.74M rather than the add-on.
    return { min: Math.min(low, high), max: Math.max(low, high) }
  }

  return { min: null, max: null }
}

/**
 * The layout's label, most specific signal first: the developer's own type code, then the
 * row's leading segment, then the bedroom phrase, then "Studio".
 *
 * The leading segment outranks the bedroom phrase because a developer's name for a layout
 * is more useful to an agent than a restatement of its bedroom count — "Semi-D", "Zero Lot
 * Bungalow" and "Superlink" (Senja) all beat "5+1 rooms". It is skipped when it is the
 * size itself (a size-first row like "917 sqft — 2 rooms") or too generic to identify
 * anything (see GENERIC_HEAD).
 */
function readLabel(line: string, sizeSqft: number): string {
  const type = line.match(TYPE_CODE)
  if (type) {
    // Drop a trailing parenthetical that is only the size — "Type B (775 sqft)" and
    // "Type B" are the same layout, and keeping both labels defeats the dedupe (The Atera
    // tabulates its types twice, once each way).
    return type[0]
      .replace(new RegExp(String.raw`\s*\([\d,\s./&–—-]*(?:${UNIT})\.?\s*\)$`, 'i'), '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const head = (line.split(/[:|—–]|\s-\s/)[0] ?? '').replace(/\s+/g, ' ').trim()
  const headIsSize = new RegExp(String.raw`^[\d,\s./&–—-]*(?:${UNIT})\b`, 'i').test(head)
  if (head.length > 0 && head.length <= 48 && !headIsSize && !GENERIC_HEAD.test(head)) {
    return head
  }

  // Only the `N+M rooms` / `N rooms` forms make readable labels; the compact "3R" code
  // does not, so BEDROOM_PATTERNS is sliced to its first two entries here.
  for (const pattern of BEDROOM_PATTERNS.slice(0, 2)) {
    const m = line.match(pattern)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }

  if (STUDIO.test(line)) return 'Studio'

  return `${sizeSqft} sqft`
}

/**
 * Extract the per-layout table stated in a project description.
 *
 * Scans line by line. A line becomes a `UnitTypeEntry` only if it is short enough to be a
 * table row, carries a layout marker, and states exactly one plausible built-up size.
 * Bedrooms and price are read when stated and left `null` otherwise — never 0, never a
 * guess. `raw` is the verbatim (whitespace-collapsed) source line.
 *
 * Returns `[]` when the description has no per-layout table, which is the common case:
 * most D2 write-ups are prose. `[]` means "nothing to show", never "no layouts exist".
 *
 * Duplicate rows are collapsed on (label, size) keeping the richest entry, because several
 * write-ups tabulate the same layout twice — once with sizes, once with prices or bedroom
 * counts (The Lantern Bangsar, Lunar Seputeh).
 */
export function extractUnitTypes(description: string): Array<{
  label: string
  sizeSqft: number | null
  bedrooms: number | null
  priceMinRM: number | null
  priceMaxRM: number | null
  raw: string
}> {
  if (typeof description !== 'string' || description.length === 0) return []

  const byKey = new Map<
    string,
    {
      label: string
      sizeSqft: number | null
      bedrooms: number | null
      priceMinRM: number | null
      priceMaxRM: number | null
      raw: string
    }
  >()

  for (const line of toLines(description)) {
    if (line.length > MAX_LINE_CHARS) continue
    if (SHOW_UNIT_HEADER.test(line)) continue
    if (!LAYOUT_MARKERS.some((p) => p.test(line))) continue

    const sizeSqft = readSize(line)
    if (sizeSqft === null) continue

    const price = readPrice(line)
    const entry = {
      label: readLabel(line, sizeSqft),
      sizeSqft,
      bedrooms: readBedrooms(line),
      priceMinRM: price.min,
      priceMaxRM: price.max,
      raw: line.replace(/\s+/g, ' ').trim(),
    }

    const key = `${entry.label.toLowerCase()}|${entry.sizeSqft}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, entry)
      continue
    }
    // Keep whichever row states more. A second mention of the same layout usually adds
    // the bedroom count or the price the first mention omitted.
    //
    // Typed by the two fields it actually reads, NOT `typeof entry`. `entry.sizeSqft` is
    // narrowed to `number` by the `sizeSqft === null` guard above, while `existing` comes
    // back from the map as `number | null` — so `typeof entry` rejected `existing` and the
    // production build failed to type check. Naming the real dependency is both correct and
    // honest about what "richness" means. Kept as a structural literal so this module stays
    // import-free and portable.
    const richness = (e: { bedrooms: number | null; priceMinRM: number | null }) =>
      Number(e.bedrooms !== null) + Number(e.priceMinRM !== null)
    if (richness(entry) > richness(existing)) byKey.set(key, entry)
  }

  const entries = [...byKey.values()]
  if (entries.length < MIN_TABLE_ENTRIES) return []
  return entries.slice(0, MAX_TABLE_ENTRIES)
}
