/**
 * Inventory search engine — two-stage searchProjects + queryInventory.
 *
 * The LOAD-BEARING rule (FIND-01/03/06/07/09/10, T-03-04, T-03-05, T-03-06):
 *
 *   STAGE A (deterministic — NEVER skipped):
 *     Firestore filters enforce `status:'active'` + eligibility (bumiQuota/foreignEligible)
 *     + optional priceBand equality pre-filter BEFORE any vector work.
 *     Sold-out, hidden, bumi-reserved, and foreign-ineligible projects are physically
 *     unreachable — the gate is code, not prompt-controlled (T-03-05).
 *
 *   LOCATION GATE (quick-kayinleong-050 — hard filter + honest refusal):
 *     `locationPref` used to be display-only: it never filtered and never scored, so a
 *     "2-bedroom in Cheras" query returned every active project and the model dutifully
 *     presented a RM6.4M Ampang unit. It is now a HARD in-memory filter against
 *     `name + locationText` (see `locationNeedles` for the exact matching rule).
 *     An empty post-gate set → {found:false, reason:'no_match'} — the Finder refuses
 *     rather than substituting a different area.
 *
 *   PRICE GATE (quick-kayinleong-050, loosened by quick-kayinleong-085 / D2):
 *     `priceMin` / `priceMax` were likewise never applied — "budget 800k" did nothing.
 *     They are now hard in-memory bounds on `priceValue`. Projects with an UNKNOWN price
 *     (`priceValue <= 0`, 32 of the 82 imported) are ADMITTED — "unknown" is not "out of
 *     range" — and `matchedCriteria.priceMax` is nulled per project so none of them
 *     claims a budget match. See `projectMatchesPrice` for the two invariants that makes
 *     safe.
 *
 *   AFFORDABILITY (FIND-10 — T-03-06):
 *     `affordabilityCeiling(monthlyIncome)` filters the Stage-A set in-memory by priceValue.
 *     An all-unaffordable eligible set → {found:false, reason:'ineligible', why:'financing'}.
 *     Never a stretch match (Pitfall 3). Runs AFTER the location/price gates so that
 *     'ineligible'/'financing' still means income was the eliminator, not the budget.
 *
 *   STAGE B (vector re-rank WITHIN eligible+affordable set):
 *     Embed criteria.freeText via embedText({inputType:'query'}).
 *     Compute dot-product in-memory against each candidate's embedding vector.
 *     Sort by score descending. Inventory is assumed ≤ a few hundred projects (A5 in
 *     03-RESEARCH.md) so in-memory scoring is viable and avoids the findNearest
 *     range-filter limitation (Pitfall 6).
 *     A MIN_RELEVANCE floor then drops noise, and MAX_MATCHES caps the payload.
 *
 *   SEGMENT WEIGHTS (FIND-09):
 *     applySegmentWeights() reorders Stage-B output WITHIN a relevance tier:
 *       - 'investment': boosts vpStatus:true (VP completed = yield-ready) + priceValue rank
 *       - 'own_stay': boosts bedroom count
 *     Relevance tier is the PRIMARY key, so segment intent can no longer float a
 *     semantically irrelevant project to top-1 (it used to be a full re-sort with the
 *     vector score demoted to tertiary behind `locationText.length`).
 *     Investment vs own-stay MUST still produce a different top-1/top-3 for the same
 *     eligible set (Pitfall 4).
 *
 *   GROUNDING (`matchedCriteria`):
 *     `matchedCriteria` echoes ONLY criteria that were genuinely applied to that project.
 *     It previously asserted "within budget (max RM800k)" and "location preference: Cheras"
 *     on projects where neither was ever evaluated — a false grounding claim rendered by
 *     `buildRationale` (src/agents/finder/index.ts) and badged in the chat UI.
 *
 *   RETURNING-CLIENT (FIND-06):
 *     Optional `since?: Date` parameter in ParsedCriteria.
 *     Applied in-memory BEFORE vector scoring: only eligible projects with
 *     `createdAt > since` (using vpDate if createdAt absent) pass through.
 *
 *   queryInventory (FIND-07):
 *     Structured Firestore query (status + vpDate + priceBand etc.) — NO vector search.
 *     The embedText function is NEVER called from queryInventory.
 *
 * DSR_MULTIPLE constant:
 *   affordabilityCeiling = monthlyIncome * 12 * DSR_MULTIPLE.
 *   DSR_MULTIPLE defaults to 4.5 (a conservative Malaysian DSR proxy for v1).
 *   Export it so Derek/A2 can confirm or revise the financing rule without touching
 *   other logic. The gate logic (all-exceed → ineligible refusal) is correct regardless
 *   of the constant (03-RESEARCH.md A2).
 *
 * Core/shell rule: NO imports from app/ or next.
 * References:
 *   - 03-02-PLAN.md
 *   - 03-RESEARCH.md Pattern 4 (two-stage), Pitfalls 1/3/4/6
 *   - src/rag/search.ts (findNearest pattern — inventory uses in-memory dot-product instead
 *     because range filters cannot be combined with findNearest: Pitfall 6)
 *   - src/firebase/collections.ts (ProjectDoc, projectsRef, priceBandFor, PRICE_BANDS)
 *   - src/rag/embed.ts (embedText 1024-d Gemini)
 */

import { projectsRef } from '@/src/firebase/collections'
import type { PriceBand, ProjectDoc } from '@/src/firebase/collections'
import { embedText } from '@/src/rag/embed'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The Finder agent's criteria-parser output.
 * Defined here so 03-04 (Finder agent tools.ts) imports from @/src/inventory/search.
 *
 * CRITICAL: Fields default to null/unknown — the parser MUST NOT invent missing values.
 * Missing eligibility-critical fields (nationality, income) → the agent asks, not guesses
 * (03-RESEARCH.md Pitfalls 23/36).
 */
export interface ParsedCriteria {
  /** FIND-09 ranking branch — drives segment weighting in Stage B */
  segment: 'investment' | 'own_stay' | 'unknown'
  priceMin: number | null
  priceMax: number | null
  /** FIND-10: affordability ceiling derived from income × DSR. null = no ceiling. */
  monthlyIncome: number | null
  /** Eligibility — foreignEligible filter (Stage A) */
  nationality: 'malaysian' | 'foreign' | 'unknown'
  /** Eligibility — bumiQuota filter (Stage A). null = unknown (do not filter) */
  bumiputera: boolean | null
  locationPref: string | null
  bedrooms: number | null
  /** Raw free-text criteria → feeds the Stage-B query vector */
  freeText: string
  /** FIND-06 returning-client: only surface projects created/activated after this date. */
  since?: Date
}

/** A single match in searchProjects results — includes all fields the agent's rationale cites. */
export interface ProjectMatch {
  projectId: string
  name: string
  priceBand: PriceBand
  priceValue: number
  tenure: string
  vpStatus: boolean
  bumiQuota: boolean
  foreignEligible: boolean
  bedrooms: number
  locationText: string
  /** Dot-product score from Stage B (normalized unit vectors → range 0–1). */
  score: number
  /** Criteria fields that drove this match — grounding citation. */
  matchedCriteria: {
    segment: ParsedCriteria['segment']
    priceMax: number | null
    nationality: ParsedCriteria['nationality']
    bumiputera: boolean | null
    locationPref: string | null
    bedrooms: number | null
  }
}

export type SearchResult =
  | { found: true; matches: ProjectMatch[] }
  | { found: false; reason: 'no_match' }
  | { found: false; reason: 'ineligible'; why: 'financing' }

/** Filters accepted by queryInventory (FIND-07). All fields optional. */
export interface InventoryFilters {
  /** Include only projects with vpDate >= vpDateFrom (FIND-07 "completed VP this year") */
  vpDateFrom?: Date
  /** Include only projects with vpDate <= vpDateTo */
  vpDateTo?: Date
  /** Equality filter on discrete price band */
  priceBand?: PriceBand
  /** Include only projects with vpStatus === vpStatus */
  vpStatus?: boolean
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Debt-service ratio multiple for affordability ceiling v1.
 * affordabilityCeiling = monthlyIncome × 12 × DSR_MULTIPLE.
 *
 * Default: 4.5 (conservative Malaysian DSR proxy).
 * Export so Derek can confirm or revise (03-RESEARCH.md A2).
 * Gate logic (all-exceed → ineligible refusal) is correct regardless.
 */
export const DSR_MULTIPLE = 4.5

/**
 * Minimum Stage-B dot-product score for a project to be returned (quick-kayinleong-050).
 *
 * Mirrors `MIN_SIMILARITY` in src/rag/search.ts, but deliberately set LOWER (0.20 vs 0.35):
 *
 *   1. A false negative here is invisible — the Finder simply looks like it has no
 *      inventory. In the KB retriever a marginal chunk becomes a confidently-wrong
 *      grounded answer, so that floor must be strict. Here the model can only cite a
 *      projectId the tool returned, so a marginal match cannot become a fabrication.
 *   2. The pairing is length-asymmetric: a short lead-criteria phrase scored against a
 *      ~2,500-char marketing write-up (description is ~97% of the embedded text). That
 *      depresses dot product relative to the KB's question-to-chunk pairing.
 *   3. The correctness work is done by the deterministic location/price gates above, not
 *      by this number. This floor is a noise/payload guard.
 *
 * ⚠ MEASURED, AND CURRENTLY A NO-OP. The distribution has now been captured against the
 * real 83-project corpus with real Gemini query embeddings (quick-kayinleong-050):
 *
 *   "nice condo for a small family"              top 0.628  median 0.600  min 0.558
 *   "a 2-bedroom in Bangsar under 900k"          top 0.719  median 0.638  min 0.590
 *   "quantum chromodynamics lattice gauge theory" top 0.499  median 0.468  min 0.448
 *   "banana bread recipe"                        top 0.494  median 0.458  min 0.427
 *
 * Every project clears 0.20 for every query, including deliberate nonsense — 83/83 in all
 * four cases. So this floor filters NOTHING today; MAX_MATCHES below is doing all of the
 * payload work, and the hard location/price gates do the correctness work.
 *
 * It is left at 0.20 deliberately rather than retuned on four probe queries. A floor in
 * the 0.50-0.55 window WOULD separate the observed relevant scores (min 0.558) from the
 * observed irrelevant ones (max 0.499), but that gap is narrow, Gemini similarity ranges
 * are compressed, and a floor set too high produces silent false negatives on a real
 * agent's oddly-phrased query — the worst failure mode here, because it is invisible.
 * Raising it needs a proper eval set, not four samples.
 *
 * The constant is kept (not deleted) so the seam exists, but do NOT read it as an active
 * guard. Assuming a safety net that does not exist is exactly what left 11,774 collateral
 * docs as dead links in this same claim.
 */
export const MIN_RELEVANCE = 0.20

/**
 * Maximum number of projects returned to the model (quick-kayinleong-050).
 *
 * Sizing: the previous uncapped result was all 83 active projects ≈ 36,400 chars
 * ≈ 10,100 tokens, and the tool result is re-sent on EVERY step of the Finder's
 * `stopWhen: stepCountIs(5)` loop — so one Finder turn could burn ~50k tokens on
 * inventory payload alone. At ~122 tokens/project, 8 matches is ~1,000 tokens/step.
 *
 * Why 8 and not 3: the model still has to apply segment/eligibility judgement and to
 * narrate a shortlist, and a hard cap of 3 leaves no headroom when the top entries are
 * poor narrative fits. 8 is enough to choose from, ~90% smaller than the status quo.
 */
export const MAX_MATCHES = 8

/**
 * Width of a "relevance tier" for segment weighting (quick-kayinleong-050).
 *
 * Segment intent (FIND-09) orders projects WITHIN a tier; it can never promote a project
 * from a lower tier above a more relevant one. 0.05 is roughly the granularity at which
 * two dot-product scores are practically indistinguishable, so genuinely comparable
 * projects still get segment-aware ordering.
 */
const RELEVANCE_TIER_WIDTH = 0.05

// ─── Location matching (quick-kayinleong-050) ────────────────────────────────

/**
 * Tokens that identify a city/state/country or are pure prose filler.
 *
 * Matching on these is indistinguishable from not filtering at all — "Kuala Lumpur"
 * appears in 23+ of 82 `locationText` values. If a location preference reduces to
 * nothing but these, the gate is SKIPPED (we cannot discriminate) and `matchedCriteria`
 * reports `locationPref: null` so the model never claims a location match it did not make.
 */
const LOCATION_QUALIFIER_TOKENS = new Set([
  'kl', 'kuala', 'lumpur', 'malaysia', 'wilayah', 'persekutuan', 'wp', 'selangor',
  'area', 'areas', 'near', 'nearby', 'around', 'in', 'at', 'the', 'of', 'and', 'or',
  'city', 'centre', 'center', 'town', 'district', 'region', 'zone', 'side', 'within',
])

/**
 * Multi-token REGION names that contain essentially the whole D2 corpus
 * (quick-kayinleong-085 / D4).
 *
 * `LOCATION_QUALIFIER_TOKENS` above handles the single-token case ("KL", "Selangor").
 * It cannot handle "Klang Valley", because neither word is a qualifier on its own — so
 * the gate matched it as a literal substring of `name + locationText` and behaved like a
 * narrow neighbourhood filter. MEASURED against the real 82-project corpus:
 * "Klang Valley" survived 5 of 82 projects, and 3 of 82 once a RM1,000,000 budget was
 * applied. That was the reported defect ("show me a list of 1mil property within Klang
 * Valley" returned almost nothing), NOT the MAX_MATCHES cap — the cap never engaged.
 *
 * Every active D2 project sits inside this region, so a region name carries no
 * discriminating information. The correct behaviour is identical to the existing bare
 * "Kuala Lumpur" handling: nothing discriminating survives, so the gate is SKIPPED (all
 * candidates pass) and `matchedCriteria.locationPref` stays null so no row claims a
 * location match it cannot back up.
 *
 * This is deliberately NOT a region-to-area mapping table. No adjacency or drive-time
 * data exists anywhere in this codebase and inventing one was ruled out of scope (D4 and
 * the KNOWN LIMITATION note on `locationNeedles` below). Adding a region here means
 * "do not filter on this", never "expand this into a list of areas".
 */
const REGION_ALIASES = new Set([
  'klang valley',
  'greater kl',
  'greater kuala lumpur',
  'lembah klang',
  '巴生谷',
])

/**
 * Generic place-type prefixes (Malay + property boilerplate).
 *
 * These are excluded from the SINGLE-TOKEN fallback tier only — never from the phrase
 * tier. "Bukit Jalil" and "Bukit Bintang" are different places; falling back to the bare
 * token "bukit" would conflate them. The phrase "bukit jalil" still matches exactly.
 */
const PLACE_TYPE_TOKENS = new Set([
  'bukit', 'taman', 'jalan', 'lorong', 'kampung', 'kg', 'sungai', 'batu', 'seksyen',
  'section', 'persiaran', 'desa', 'sri', 'seri', 'pusat', 'bandar', 'pantai', 'tanjung',
  'lembah', 'mont', 'residence', 'residences', 'residensi', 'condo', 'condominium',
  'apartment', 'apartments', 'suites', 'phase', 'block',
])

/**
 * Case-, punctuation- and diacritic-insensitive normalization.
 *
 * `\p{L}\p{N}` (not `[a-z0-9]`) so CJK location names survive normalization instead of
 * being silently erased into an empty needle — an empty needle would disable the gate and
 * reinstate the exact "returns everything" defect for the zh locale.
 */
function normalizeLocationText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * A `locationText` clause that describes what a project is NEAR, not where it IS.
 *
 * THIS IS THE FALSE-POSITIVE GUARD. `locationText` is prose that name-drops surrounding
 * landmarks, so a naive substring match is badly wrong: filtering for "KLCC" would match
 * "Bangsar Hill Park", whose locationText reads
 *   "Lorong Maarof, Bangsar, 400m to Bangsar LRT Station & 450m to Bangsar Village
 *    Shopping Mall, near KLCC and Bangsar CBD"
 * 27 of 83 active projects mention KLCC; only some of them are in KLCC.
 *
 * Any clause matching this pattern — a proximity phrase or a distance/time measure — is
 * DROPPED before matching, so only the clauses that assert the project's own address
 * remain. In the example above that leaves "Lorong Maarof, Bangsar": still a Bangsar hit,
 * no longer a KLCC hit.
 */
const PROXIMITY_CLAUSE =
  /\b(?:near|nearby|close\s+to|next\s+to|beside|opposite|adjacent|adjoining|facing|overlooking|walking\s+distance|walk\s+to|steps?\s+to|access\s+to|direct\s+link|link\s+bridge|linked\s+to|connected\s+to|integrated\s+with|surrounded\s+by|minutes?\s+to|mins?\s+to|stops?\s+from|views?)\b|\d+[\s-]*(?:m|km|mins?|minutes?|stops?)\b/i

/**
 * Build the space-padded haystack a location needle is tested against.
 *
 * Haystack is `name` + the NON-proximity clauses of `locationText`:
 *   - `name` is included whole because D2 project names commonly carry the area
 *     ("Pinnacle Bangsar Residence", "Aria Luxury Residence @ KLCC"). This also rescues
 *     projects whose only in-clause area mention sits inside a "near X" phrase.
 *   - `description` is deliberately EXCLUDED. It is a ~2,500-char marketing write-up
 *     (~97% of the embedded text) that mentions every landmark within driving distance;
 *     including it would make the gate a no-op.
 *
 * If every clause looks like a proximity clause we fall back to the full text — a false
 * positive is preferable to dropping the project entirely.
 */
function locationHaystack(doc: ProjectDoc): string {
  const raw = doc.locationText ?? ''
  // Split on clause separators. ASCII hyphen is NOT a separator (it appears inside
  // names and in "3-min"); en/em dashes are.
  const clauses = raw.split(/[,;.|–—]/).filter((c) => c.trim().length > 0)
  const addressClauses = clauses.filter((c) => !PROXIMITY_CLAUSE.test(c))
  const areaText = (addressClauses.length > 0 ? addressClauses : clauses).join(' , ')
  return ` ${normalizeLocationText(`${doc.name ?? ''} , ${areaText}`)} `
}

/**
 * Whole-word containment test against a space-padded haystack.
 *
 * CJK is not space-separated, so a space-padded probe can never match there. For a
 * non-ASCII needle we fall back to a plain substring test.
 */
function containsNeedle(paddedHaystack: string, needle: string): boolean {
  return /^[ -~]+$/.test(needle)
    ? paddedHaystack.includes(` ${needle} `)
    : paddedHaystack.includes(needle)
}

/** One comma-separated segment of a location preference, compiled into match needles. */
export interface LocationNeedleGroup {
  /** The segment's meaningful tokens joined — matched as a contiguous whole-word phrase. */
  phrase: string
  /** The same tokens minus generic place types — ALL must be present to match. */
  tokens: string[]
}

/**
 * Derive match needles from a free-text location preference.
 *
 * THE MATCHING RULE (deliberate, and deliberately NOT a geographic taxonomy — no area
 * list, no adjacency and no drive-time data exists anywhere in this codebase, and
 * inventing one was ruled out of scope):
 *
 *   1. Split on comma / slash / semicolon / "or". Malaysian addresses run
 *      most-specific-first ("Cheras, Kuala Lumpur"), so each segment becomes its own
 *      group and ANY group matching is a match.
 *   2. Strip LOCATION_QUALIFIER_TOKENS from each segment. A segment that is nothing but
 *      qualifiers ("KL", "city centre") yields no needle and is dropped — matching on
 *      those is indistinguishable from not filtering.
 *   3. PHRASE tier: the segment's surviving tokens joined, matched as a contiguous
 *      whole-word phrase. This keeps "Bukit Jalil" from matching "Bukit Bintang".
 *   4. TOKEN tier (fallback, order-independent): requires **ALL** of the segment's tokens
 *      to be present, in any position. This absorbs word-order and filler variance
 *      without conflating distinct areas. Two guards, both learned from the real corpus:
 *        - ALL, not ANY. With ANY, "Petaling Jaya" matched "Aster Hill Sri Petaling" and
 *          "Luminar Residence Subang [Jaya]" — different areas that merely share a word.
 *        - The tier is DISABLED entirely when the segment leans on a generic place-type
 *          prefix (PLACE_TYPE_TOKENS) or 1–2 char ASCII noise, because the remainder is
 *          not discriminating on its own: "Sri Petaling" would reduce to "petaling" and
 *          match Petaling Jaya. Such a segment must match its exact phrase.
 *
 * Returns `null` when nothing discriminating survives — the caller then SKIPS the gate
 * rather than filtering to zero.
 *
 * KNOWN LIMITATION: there is no alias table. "KLCC" works only because the corpus
 * literally contains "KLCC", and a CJK-script area name will not match a romanized
 * `locationText`. An alias/taxonomy pass is explicitly out of scope for this claim.
 */
export function locationNeedles(pref: string): LocationNeedleGroup[] | null {
  const groups: LocationNeedleGroup[] = []

  for (const rawSegment of pref.split(/[,/;|]|\bor\b/i)) {
    const segment = normalizeLocationText(rawSegment)
    if (segment.length === 0) continue

    // REGION tier (quick-kayinleong-085 / D4). A segment that IS a region name carries no
    // discriminating information — see REGION_ALIASES. Dropped exactly like an
    // all-qualifier segment, so a pref made only of regions yields no groups and this
    // function returns null (gate skipped).
    if (REGION_ALIASES.has(segment)) continue

    const meaningful = segment
      .split(' ')
      .filter((t) => t.length > 0 && !LOCATION_QUALIFIER_TOKENS.has(t))
    if (meaningful.length === 0) continue

    // Also drop a segment that REDUCES to a region once qualifier tokens are removed, so
    // "in the Klang Valley area" behaves the same as bare "Klang Valley". Checked after
    // the raw check above because the two catch different phrasings: "greater kl" only
    // matches raw (its "kl" is a qualifier), "in the klang valley area" only matches here.
    if (REGION_ALIASES.has(meaningful.join(' '))) continue

    const tokens = meaningful.filter(
      (t) =>
        !PLACE_TYPE_TOKENS.has(t) &&
        // Drop 1–2 char ASCII fragments (noise); keep short CJK, where 2 chars is a word.
        !(t.length < 3 && /^[ -~]+$/.test(t)),
    )

    groups.push({
      phrase: meaningful.join(' '),
      // Token tier is only trustworthy when nothing was stripped — see rule 4 above.
      tokens: tokens.length === meaningful.length ? tokens : [],
    })
  }

  return groups.length > 0 ? groups : null
}

/** Does this project sit IN the requested location (not merely near it)? */
export function projectMatchesLocation(doc: ProjectDoc, needles: LocationNeedleGroup[]): boolean {
  const haystack = locationHaystack(doc)
  return needles.some(
    (group) =>
      containsNeedle(haystack, group.phrase) ||
      (group.tokens.length > 0 && group.tokens.every((t) => containsNeedle(haystack, t))),
  )
}

// ─── Price bounds (quick-kayinleong-050) ─────────────────────────────────────

/**
 * Hard price-bound test against the project's real `priceValue` field (RM).
 * Both bounds are INCLUSIVE — a project priced at exactly `priceMax` is within budget.
 *
 * UNPRICED PROJECTS (`priceValue <= 0`) PASS the bound test (quick-kayinleong-085 / D2).
 * 32 of 82 active projects carry priceValue 0, which means UNKNOWN, not free — and
 * "unknown" is not the same as "out of range".
 *
 * This reverses the earlier call. Until 085 this function returned false for them
 * whenever a bound was stated, and the comment here said "the remedy is to backfill
 * priceValue, not to loosen the gate". THE USER WAS SHOWN THAT TRADEOFF AND CHOSE TO
 * LOOSEN IT: excluding an unpriced project turns a DATA GAP into an invisible project,
 * and for the driving query ("1mil within Klang Valley") that silently hid 32 of 82
 * projects — 18 priced survivors versus 50 with unpriced admitted.
 *
 * The choice is only safe because of two HARD INVARIANTS enforced elsewhere. Breaking
 * either one turns this into a false grounding claim:
 *   1. `matchedCriteria.priceMax` is set PER PROJECT in `searchProjects` below — the
 *      requested bound only when this project's own `priceValue` is a real positive
 *      number, null otherwise. An unpriced survivor must never report a verified budget
 *      match.
 *   2. The price cell renders EMPTY for these rows (`formatPrice` in
 *      app/[lang]/chat/match-table.tsx returns null for `priceValue <= 0`), and
 *      `priceBand` is never used as a price fallback anywhere. `priceBand` is derived via
 *      `priceBandFor(priceValue)` at import and `priceBandFor(0) === 'under_500k'`, so it
 *      labels every unpriced project as the cheapest band. That is why `priceBand` is
 *      excluded from `FinderRow` entirely — a client that never receives it cannot render
 *      an unpriced project as cheap.
 *
 * Known prices are still compared exactly, and both bounds remain INCLUSIVE — a project
 * priced at exactly `priceMax` is within budget.
 *
 * Exported so `tests/finder-corpus-gates.test.ts` can run it directly over the real
 * 82-project corpus.
 */
export function projectMatchesPrice(doc: ProjectDoc, priceMin: number | null, priceMax: number | null): boolean {
  if (priceMin === null && priceMax === null) return true
  const price = doc.priceValue
  // Unknown price — admitted, not asserted. See invariants 1 and 2 above.
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return true
  if (priceMax !== null && price > priceMax) return false
  if (priceMin !== null && price < priceMin) return false
  return true
}

// ─── Affordability helper ────────────────────────────────────────────────────

/**
 * Derive a price ceiling from monthly income (FIND-10).
 *
 * ceiling = monthlyIncome × 12 × DSR_MULTIPLE
 * Returns Infinity when monthlyIncome is null (no ceiling applied).
 */
export function affordabilityCeiling(monthlyIncome: number | null): number {
  if (monthlyIncome === null) return Infinity
  return monthlyIncome * 12 * DSR_MULTIPLE
}

// ─── Segment weighting ────────────────────────────────────────────────────────

/**
 * Reorder Stage-B ranked candidates based on buyer segment (FIND-09).
 *
 * RELEVANCE TIER IS THE PRIMARY KEY (quick-kayinleong-050). Segment intent orders projects
 * WITHIN a tier and can no longer promote a semantically irrelevant project above a
 * relevant one.
 *
 * This function used to be a FULL re-sort with the vector score demoted to tertiary:
 *   - investment sorted by vpStatus then priceValue DESC — which is what floated a
 *     RM6.4M Ampang unit to top-1 for a "2-bedroom, budget 800k" query;
 *   - own_stay sorted by bedrooms then by `locationText.length` — the character count of
 *     the location string, a "location richness" proxy with no relationship to WHERE the
 *     project is. That key is removed.
 * Because `priceValue` and `bedrooms` are near-unique across the corpus, the tertiary
 * vector score was effectively never reached, so the semantic signal was dead for any
 * segmented query.
 *
 * investment: within a tier, prefer vpStatus:true (VP completed = yield-ready), then
 *             higher priceValue (premium units → higher yield potential).
 * own_stay:   within a tier, prefer a higher bedroom count (family-size proxy).
 * unknown:    return Stage-B order unchanged.
 *
 * Must still produce a different top-1/top-3 for 'investment' vs 'own_stay' given the same
 * eligible set (Pitfall 4 — segment-blind ranking).
 */
function applySegmentWeights(
  ranked: Array<{ doc: ProjectDoc; score: number; id: string }>,
  segment: ParsedCriteria['segment'],
): Array<{ doc: ProjectDoc; score: number; id: string }> {
  // 'unknown': Stage-B vector score order unchanged
  if (segment === 'unknown') return ranked

  return [...ranked].sort((a, b) => {
    // PRIMARY: relevance tier. Segment intent never crosses a tier boundary.
    const tierDelta = relevanceTier(b.score) - relevanceTier(a.score)
    if (tierDelta !== 0) return tierDelta

    if (segment === 'investment') {
      if (a.doc.vpStatus !== b.doc.vpStatus) {
        return a.doc.vpStatus ? -1 : 1
      }
      if (a.doc.priceValue !== b.doc.priceValue) {
        return b.doc.priceValue - a.doc.priceValue
      }
    } else {
      // own_stay — bedrooms only. `bedrooms` is 0 ("unknown") on 29 of 83 projects, so
      // this is a soft preference inside a tier, never a filter.
      if (a.doc.bedrooms !== b.doc.bedrooms) {
        return b.doc.bedrooms - a.doc.bedrooms
      }
    }

    // Final tiebreak: raw vector score.
    return b.score - a.score
  })
}

/** Bucket a dot-product score into a coarse relevance tier (higher = more relevant). */
function relevanceTier(score: number): number {
  return Math.floor(score / RELEVANCE_TIER_WIDTH)
}

// ─── Dot-product scoring ──────────────────────────────────────────────────────

/**
 * Score a single document embedding against the query vector using dot product.
 * Both vectors are assumed to be normalized unit vectors (Gemini guarantees this).
 * DOT_PRODUCT on unit vectors == cosine similarity.
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

// ─── Main search function ────────────────────────────────────────────────────

/**
 * Two-stage project search (FIND-01/03/06/09/10).
 *
 * STAGE A: deterministic Firestore filter (never skipped).
 * STAGE B: in-memory dot-product re-rank within eligible+affordable set.
 *
 * @param criteria ParsedCriteria from the Finder agent's criteria parser.
 * @returns        SearchResult — found:true with matches, or found:false with a reason signal.
 */
export async function searchProjects(criteria: ParsedCriteria): Promise<SearchResult> {
  // ── STAGE A: Deterministic eligibility/availability gate (NEVER skipped) ────
  //
  // Start unconditionally with status:'active' — the most critical gate.
  // All sold_out and hidden projects are unreachable from this point.
  // (T-03-04: deterministic filter runs BEFORE any vector work — T-03-05: code gate,
  //  not prompt-controlled.)
  let q = projectsRef().where('status', '==', 'active')

  // Eligibility: foreign buyer → only foreignEligible:true projects
  if (criteria.nationality === 'foreign') {
    q = q.where('foreignEligible', '==', true)
  }

  // Eligibility: non-bumiputera buyer → exclude bumi-reserved projects
  if (criteria.bumiputera === false) {
    q = q.where('bumiQuota', '==', false)
  }

  // priceBand equality pre-filter (optional, findNearest-safe):
  // If a maximum price is specified AND it maps to a specific band, we could add
  // where('priceBand','==',band) — BUT this would only filter to ONE band.
  // We skip the priceBand Firestore filter here and handle range in-memory via
  // affordabilityCeiling (Pitfall 6: findNearest pre-filters are equality-only,
  // and range filters on priceBand would miss adjacent bands).

  const eligibleSnap = await q.get()

  if (eligibleSnap.empty) {
    return { found: false, reason: 'no_match' }
  }

  // Collect eligible docs with their IDs
  const eligibleDocs = eligibleSnap.docs.map((d) => ({
    id: d.id,
    doc: d.data() as ProjectDoc,
  }))

  // ── RETURNING-CLIENT filter (FIND-06) ────────────────────────────────────
  // Applied in-memory before affordability and vector scoring.
  // Uses createdAt if present (Phase-3 schema adds it); falls back to vpDate.
  let candidates = eligibleDocs
  if (criteria.since !== undefined) {
    const since = criteria.since
    candidates = eligibleDocs.filter(({ doc }) => {
      // createdAt is a runtime field — check if it exists on the doc
      // We treat the raw Firestore value as unknown and extract Date safely
      const rawDoc = doc as unknown as Record<string, unknown>
      const createdAtRaw = rawDoc['createdAt']
      if (createdAtRaw) {
        if (createdAtRaw instanceof Date) return createdAtRaw > since
        // Firestore Timestamp has a .toDate() method
        if (typeof createdAtRaw === 'object' && createdAtRaw !== null && 'toDate' in createdAtRaw) {
          const asTimestamp = createdAtRaw as { toDate: () => Date }
          return asTimestamp.toDate() > since
        }
      }
      // Fallback: vpDate (present when VP is completed)
      const vpDateRaw = rawDoc['vpDate']
      if (vpDateRaw) {
        if (vpDateRaw instanceof Date) return vpDateRaw > since
        if (typeof vpDateRaw === 'object' && vpDateRaw !== null && 'toDate' in vpDateRaw) {
          const asTimestamp = vpDateRaw as { toDate: () => Date }
          return asTimestamp.toDate() > since
        }
      }
      return false // no date field → exclude from returning-client results
    })
  }

  // ── LOCATION gate (quick-kayinleong-050) ─────────────────────────────────
  // HARD filter: `locationPref` used to be display-only, which is why "a 2-bedroom in
  // Cheras" returned every active project. In-memory because Firestore cannot do
  // substring matching on `locationText`.
  //
  // `needles` is null when the preference carries nothing discriminating (e.g. bare
  // "KL", which 23+ projects share). In that case the gate is SKIPPED rather than
  // filtering to zero — and `locationApplied` stays false so `matchedCriteria` does not
  // claim a location match that never happened.
  const needles = criteria.locationPref !== null ? locationNeedles(criteria.locationPref) : null
  const locationApplied = needles !== null
  if (needles !== null) {
    candidates = candidates.filter(({ doc }) => projectMatchesLocation(doc, needles))
    if (candidates.length === 0) {
      // Honest refusal: D2 has no active inventory in the requested area. The Finder
      // must NOT substitute projects from a different area (the reported defect).
      return { found: false, reason: 'no_match' }
    }
  }

  // ── PRICE gate (quick-kayinleong-050) ────────────────────────────────────
  // HARD filter: priceMin/priceMax were never applied, so "budget 800k" did nothing.
  const priceApplied = criteria.priceMin !== null || criteria.priceMax !== null
  if (priceApplied) {
    candidates = candidates.filter(({ doc }) =>
      projectMatchesPrice(doc, criteria.priceMin, criteria.priceMax),
    )
    if (candidates.length === 0) {
      // No active project in range. This is a budget miss, NOT a financing refusal —
      // 'ineligible'/'financing' is reserved for the income-derived ceiling below.
      return { found: false, reason: 'no_match' }
    }
  }

  // ── AFFORDABILITY gate (FIND-10 — T-03-06) ──────────────────────────────
  // In-memory because range filters cannot be combined with findNearest (Pitfall 6).
  // Runs AFTER the location/price gates so 'ineligible'/'financing' still means income
  // was the eliminator.
  const ceiling = affordabilityCeiling(criteria.monthlyIncome)
  const affordableDocs = criteria.monthlyIncome !== null
    ? candidates.filter(({ doc }) => doc.priceValue <= ceiling)
    : candidates

  if (affordableDocs.length === 0) {
    if (criteria.monthlyIncome !== null) {
      // All eligible projects exceed the affordability ceiling
      return { found: false, reason: 'ineligible', why: 'financing' }
    }
    // No income specified but since-filter or other in-memory filter eliminated all candidates
    return { found: false, reason: 'no_match' }
  }

  // ── STAGE B: Vector re-rank WITHIN the eligible+affordable set ─────────
  //
  // Embed the freeText query with Gemini (inputType:'query').
  // Score each candidate by dot product against its stored embedding.
  // In-memory scoring is viable for ≤ a few hundred projects (A5 in 03-RESEARCH.md)
  // and avoids the findNearest range-filter limitation (Pitfall 6).
  const queryVector = await embedText(criteria.freeText, { inputType: 'query' })

  const scored = affordableDocs.map(({ id, doc }) => ({
    id,
    doc,
    score: doc.embedding.length > 0 ? dotProduct(queryVector, doc.embedding) : 0,
  }))

  // ── RELEVANCE FLOOR (quick-kayinleong-050) ───────────────────────────────
  // Mirrors the KB retriever's MIN_SIMILARITY gate (src/rag/search.ts). Inventory had
  // no equivalent, so a project scoring 0.05 was returned identically to one at 0.8.
  const relevant = scored.filter(({ score }) => score >= MIN_RELEVANCE)
  if (relevant.length === 0) {
    return { found: false, reason: 'no_match' }
  }

  // Sort by score descending (highest dot product = most similar)
  relevant.sort((a, b) => b.score - a.score)

  // ── SEGMENT WEIGHTING (FIND-09) ──────────────────────────────────────────
  // ── TOP-N CAP (quick-kayinleong-050) ─────────────────────────────────────
  // Uncapped, this returned all 83 active projects ≈ 10,100 tokens, re-sent on every
  // step of the Finder's 5-step loop. See MAX_MATCHES for the sizing.
  const reranked = applySegmentWeights(relevant, criteria.segment).slice(0, MAX_MATCHES)

  // ── Map to ProjectMatch ──────────────────────────────────────────────────
  const matches: ProjectMatch[] = reranked.map(({ id, doc, score }) => ({
    projectId: id,
    name: doc.name,
    priceBand: doc.priceBand,
    priceValue: doc.priceValue,
    tenure: doc.tenure,
    vpStatus: doc.vpStatus,
    bumiQuota: doc.bumiQuota,
    foreignEligible: doc.foreignEligible,
    bedrooms: doc.bedrooms,
    locationText: doc.locationText,
    score,
    // GROUNDING (quick-kayinleong-050): echo ONLY criteria genuinely applied to THIS
    // project. This object is rendered under the heading "Matched criteria" by
    // buildRationale (src/agents/finder/index.ts) and badged in the chat UI, and it is
    // handed to the model verbatim — so an unapplied criterion here is a false grounding
    // claim, e.g. "within budget (max RM800k); location preference: Cheras" on a RM2.5M
    // Bangsar project. Nulling the unapplied fields makes those call sites correct
    // without changing them (both are null-guarded).
    matchedCriteria: {
      segment: criteria.segment,
      // Only when the price gate ran AND this project's own price is actually known
      // (quick-kayinleong-085 / D2). The gate now ADMITS unpriced projects, so the old
      // blanket `priceApplied ? criteria.priceMax : null` would have made a project whose
      // price we do not hold claim a verified budget match — the exact false grounding
      // claim `matchedCriteria` exists to prevent. This is invariant 1 of two named in
      // the projectMatchesPrice doc comment above.
      priceMax:
        priceApplied &&
        typeof doc.priceValue === 'number' &&
        Number.isFinite(doc.priceValue) &&
        doc.priceValue > 0
          ? criteria.priceMax
          : null,
      nationality: criteria.nationality,
      bumiputera: criteria.bumiputera,
      // Only when the location gate ran — and every survivor passed it.
      locationPref: locationApplied ? criteria.locationPref : null,
      // Bedrooms is NOT a filter (0 means "unknown" on 29 of 83 projects, so filtering
      // would drop real inventory). It is only a genuine match when this project's own
      // bedroom count equals the request.
      bedrooms: criteria.bedrooms !== null && doc.bedrooms === criteria.bedrooms
        ? criteria.bedrooms
        : null,
    },
  }))

  return { found: true, matches }
}

// ─── Structured inventory query ───────────────────────────────────────────────

/**
 * Structured filtered query over the projects collection (FIND-07).
 *
 * Answers questions like "which projects completed VP this year" without any
 * vector search. embedText is NEVER called from this function.
 *
 * Always enforces status:'active' as the base filter — sold_out/hidden projects
 * are excluded from structured queries too.
 *
 * @param filters  Optional structured filters (vpDateFrom, vpDateTo, priceBand, vpStatus).
 * @returns        Array of matching projects (raw ProjectDoc shape + projectId).
 */
export async function queryInventory(
  filters: InventoryFilters,
): Promise<Array<ProjectDoc & { projectId: string }>> {
  // Always active-only — same deterministic gate as searchProjects
  let q = projectsRef().where('status', '==', 'active')

  // VP-date range filters (FIND-07)
  if (filters.vpDateFrom !== undefined) {
    q = q.where('vpDate', '>=', filters.vpDateFrom)
  }
  if (filters.vpDateTo !== undefined) {
    q = q.where('vpDate', '<=', filters.vpDateTo)
  }

  // Equality filter on discrete price band (findNearest-safe — but this is structured, no vector)
  if (filters.priceBand !== undefined) {
    q = q.where('priceBand', '==', filters.priceBand)
  }

  // VP status boolean filter
  if (filters.vpStatus !== undefined) {
    q = q.where('vpStatus', '==', filters.vpStatus)
  }

  const snap = await q.get()
  return snap.docs.map((d) => ({
    ...(d.data() as ProjectDoc),
    projectId: d.id,
  }))
}
