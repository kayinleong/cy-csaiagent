/**
 * src/inventory/size-extract.ts — deterministic built-up sqft extraction from a project
 * description (quick-kayinleong-085 / D1).
 *
 * WHY THIS EXISTS: `ProjectDoc` had no size field. The figure the agents want ("price,
 * size, rooms") lives only as prose inside `description`, as a per-layout range:
 *
 *   Built-Up Sizes & Layouts:
 *     1 Bedroom: 904 sqft | 1 car park bay
 *     2+1 Bedrooms: 1,600 – 1,800 sqft | 2 car park bays
 *     Penthouses: 2,900 – 4,855 sqft
 *
 * D1 locked BOTH halves: this deterministic extractor is the MECHANISM, and
 * `ProjectDoc.sizeMinSqft` / `sizeMaxSqft` are where its output is PERSISTED (by
 * `scripts/backfill-project-sizes.ts`). Nothing re-parses prose at render time, and
 * nothing here is model-authored — the corpus is a fixed 82 records, every extraction is
 * eyeballable, and a regex gives the same answer on every run.
 *
 * Pure module: ZERO imports, so it is unit-testable in the `node` vitest environment and
 * safe to import from a script, a Server Component or a client component alike.
 */

/**
 * A number as written in this corpus: either comma-grouped ("1,600", "19,041") or a bare
 * 2–5 digit run ("904", "12000").
 *
 * The comma-grouped alternative MUST come first — with the bare form first, "19,041"
 * would match as "19" and a 19,041 sqft bungalow would be read as 19 sqft (then dropped
 * by the plausibility clamp, silently losing the project's size).
 */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d{2,5}`

/**
 * An EXPLICIT square-foot unit. Deliberately narrow.
 *
 * There is NO bare `sf` alternative, and adding one would be a defect. This corpus writes
 * per-square-foot PRICES as `psf` — measured, 40+ occurrences: "Maintenance Fee: RM0.65
 * psf", "Price Range: RM1,700 – RM2,300 psf", "RM1300psf". `sf` matches inside every one
 * of those, so a `sf` alternative would turn a maintenance fee and an asking price into
 * built-up areas.
 */
const UNIT = String.raw`sqft|sq\.?\s*ft\.?|square\s+feet|square\s+foot`

/**
 * A range separator. The word "to" and all three dash characters, because the corpus uses
 * en dashes ("1,600 – 1,800 sqft") far more often than ASCII hyphens.
 */
const RANGE_SEP = String.raw`-|–|—|to`

/**
 * One sqft mention: an optional leading range endpoint, the number, the gap, the unit.
 *
 * Capture groups: 1 = range low (optional), 2 = the number the unit belongs to,
 * 3 = the gap between that number and the unit (inspected by the "per" guard below).
 *
 * The gap deliberately admits an intervening "per" so that "RM1,200 per sq ft" MATCHES
 * and is then REJECTED by a guard. Making it unmatchable instead would look equivalent
 * but leaves the psf guard untestable — and an untested guard is the thing this repo has
 * shipped twice already.
 */
const SQFT_MENTION = new RegExp(
  String.raw`(?:(${NUMBER})\s*(?:${RANGE_SEP})\s*)?(${NUMBER})(\s*(?:per\s+)?)(?:${UNIT})`,
  'gi',
)

/**
 * How much text before a mention is inspected by the currency guard. 24 characters is
 * enough to see "Indicative Price: RM" while staying inside the same phrase.
 */
const LEFT_CONTEXT_CHARS = 24

/** A left context that ends in a currency marker — the number is a PRICE, not an area. */
const CURRENCY_TAIL = /(?:rm|myr|\$)\s*$/i

/** A right context that opens with a per-square-foot price marker. */
const PSF_HEAD = /^\s*(?:psf|p\.s\.f|per\s+sq)/i

/**
 * How much text before a mention is inspected by the non-built-up guard. Wider than the
 * currency window because these labels sit at the start of their phrase and a figure can
 * follow a few filler words ("Facilities: (Total 16,800 sqft").
 */
const LABEL_CONTEXT_CHARS = 40

/**
 * A left context that labels the figure as something OTHER than a unit's built-up area.
 *
 * FOUND BY AUDITING ALL 82 RECORDS (quick-kayinleong-085, 2026-09-03) — without this the
 * global min/max folded shared facilities and land plots into the layout range, and the
 * table showed sizes no buyer could purchase:
 *   - "Facilities: (Total 16,800 sqft"          -> The Lantern Bangsar read 561–16,800
 *                                                  (real layouts: 561–1,092)
 *   - "Largest Sky Gym (15,000 sq. ft."         -> PSQ Pavilion Square read 504–15,000
 *   - "Lifestyle & Amenities: 19,000 sqft"      -> Aspire office read 1,152–19,000
 *   - "Land Area: 4,101 – 8,181 sqft"           -> Puncak Wangsamas read 3,326–8,181
 *   - "Land Size: 6,631 – 11,184 sqft"          -> Yanu Hills read 6,631–11,184
 *   - "Land Size: 22x85 (1,873 sqft"            -> Vila Setara read 1,873–5,595
 *
 * `sizeMinSqft`/`sizeMaxSqft` are documented as BUILT-UP, so a land plot is out of scope
 * here even for a landed project — showing it under a "Size (sqft)" header alongside
 * condo built-ups would be comparing two different measurements in one column.
 */
const NON_BUILT_UP_LABEL =
  /\b(?:land\s+(?:size|area)|facilit\w*|amenit\w*|gym|clubhouse|(?:net|gross)\s+floor\s+area|lobby|retail\s+(?:space|area)|car\s*park\s+(?:space|area))\b[^.]{0,20}$/i

/**
 * Plausibility window for a Malaysian condo/landed built-up area, in sqft.
 *
 * Lower bound 200: no habitable D2 layout is smaller, so anything under it is a stray
 * number that happened to sit next to a unit.
 * Upper bound 20,000: the largest real layout in this corpus is a 19,041 sqft double
 * storey villa, so the window has to admit that while still discarding land areas
 * (an acre is 43,560 sqft).
 *
 * This clamp is what kills a land size quoted in sqft, and it is the reason a mis-parsed
 * fragment degrades to "no size on record" rather than to a wrong number in the table.
 */
const MIN_PLAUSIBLE_SQFT = 200
const MAX_PLAUSIBLE_SQFT = 20_000

/** "1,600" -> 1600. Returns NaN for anything unparseable. */
function toNumber(raw: string | undefined): number {
  if (raw === undefined) return Number.NaN
  return Number(raw.replace(/,/g, ''))
}

/**
 * Extract the built-up sqft range stated in a project description.
 *
 * Scans for EVERY numeric sqft mention and returns the global minimum and maximum across
 * all of them, because a project offers several layouts and the table shows the span. A
 * single mention contributes itself as both bounds; a range contributes both endpoints.
 *
 * Returns null when the description states no plausible sqft figure — 16 of the 82
 * projects in the current corpus. Null means UNKNOWN and renders as an empty Size cell;
 * it never means zero.
 *
 * Guarantees: `MIN_PLAUSIBLE_SQFT <= minSqft <= maxSqft <= MAX_PLAUSIBLE_SQFT`.
 */
export function extractSizeRange(
  description: string,
): { minSqft: number; maxSqft: number } | null {
  if (typeof description !== 'string' || description.length === 0) return null

  const values: number[] = []

  // `matchAll` needs the /g flag, which carries mutable lastIndex state on a shared
  // RegExp — so this iterates a fresh clone rather than the module-level constant.
  const pattern = new RegExp(SQFT_MENTION.source, SQFT_MENTION.flags)

  for (const m of description.matchAll(pattern)) {
    const at = m.index ?? 0
    const gap = m[3] ?? ''

    // GUARD 1 — "per". Rejects "Asking RM1,200 per sq ft": a per-square-foot price, whose
    // number is roughly condo-sized and would otherwise sail through the clamp.
    if (/per/i.test(gap)) continue

    // GUARD 2 — currency prefix. Rejects "Indicative Price: RM1,450 sq ft". Same shape as
    // guard 1 without the "per", which is how this corpus writes several of its prices.
    const left = description.slice(Math.max(0, at - LEFT_CONTEXT_CHARS), at)
    if (CURRENCY_TAIL.test(left)) continue

    // GUARD 3 — trailing psf marker. Rejects "1,200 sq ft psf" style redundancy, where the
    // price unit follows the area unit.
    const right = description.slice(at + m[0].length)
    if (PSF_HEAD.test(right)) continue

    // GUARD 4 — non-built-up label. Rejects a shared facility or a land plot quoted in
    // sqft, which the clamp cannot catch because those figures are unit-sized. See
    // NON_BUILT_UP_LABEL for the six real records this was found on.
    const labelLeft = description.slice(Math.max(0, at - LABEL_CONTEXT_CHARS), at)
    if (NON_BUILT_UP_LABEL.test(labelLeft)) continue

    // GUARD 5 — plausibility clamp. Rejects a land area quoted in sqft ("435,600 sq ft" =
    // 10 acres) and any 2-digit fragment that happened to precede a unit. Applied per
    // endpoint, so a range with one bad end still contributes its good end.
    for (const candidate of [toNumber(m[1]), toNumber(m[2])]) {
      if (!Number.isFinite(candidate)) continue
      if (candidate < MIN_PLAUSIBLE_SQFT || candidate > MAX_PLAUSIBLE_SQFT) continue
      values.push(candidate)
    }
  }

  if (values.length === 0) return null

  return { minSqft: Math.min(...values), maxSqft: Math.max(...values) }
}
