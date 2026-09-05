/**
 * size-extract.test.ts — fixture traps + a full sweep of the real 82-project corpus
 * (quick-kayinleong-085 / D1).
 *
 * D1 required every one of the 82 extractions to be eyeballed, because the corpus is
 * fixed and small enough that "it compiles" is not evidence. The counts pinned in the
 * corpus sweep below were REVIEWED LINE BY LINE against the source description text on
 * 2026-09-03 — they are observations, not guesses, and the six mis-parses that review
 * found are now guarded (see NON_BUILT_UP_LABEL in size-extract.ts).
 *
 * If a count here changes, either the corpus changed or the extractor regressed. Do not
 * widen the assertion to make it pass — re-run the sweep and look at what moved.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { extractSizeRange } from './size-extract'

// ─── Fixture traps ────────────────────────────────────────────────────────────

describe('extractSizeRange: layout figures', () => {
  it('a single mention contributes itself as both bounds', () => {
    expect(extractSizeRange('1 Bedroom: 904 sqft')).toEqual({ minSqft: 904, maxSqft: 904 })
  })

  it('takes the GLOBAL min/max across every layout line', () => {
    // The point of the field: a project offers several layouts and the table shows the
    // span, not the first line it happened to find.
    expect(
      extractSizeRange('2+1 Bedrooms: 1,600 – 1,800 sqft | Penthouses: 2,900 – 4,855 sqft'),
    ).toEqual({ minSqft: 1600, maxSqft: 4855 })
  })

  it('accepts every square-foot spelling this corpus actually uses', () => {
    expect(extractSizeRange('Studio: 550 sq.ft')).toEqual({ minSqft: 550, maxSqft: 550 })
    expect(extractSizeRange('1 Bedroom: 635 sq. ft.')).toEqual({ minSqft: 635, maxSqft: 635 })
    expect(extractSizeRange('Studio: 571 – 868 sq ft')).toEqual({ minSqft: 571, maxSqft: 868 })
    expect(extractSizeRange('With over 4000 square feet')).toEqual({ minSqft: 4000, maxSqft: 4000 })
    expect(extractSizeRange('a 950 square foot unit')).toEqual({ minSqft: 950, maxSqft: 950 })
  })

  it('reads all three dash forms and the word "to" as a range', () => {
    expect(extractSizeRange('636 - 1,252 sqft')).toEqual({ minSqft: 636, maxSqft: 1252 })
    expect(extractSizeRange('636 – 1,252 sqft')).toEqual({ minSqft: 636, maxSqft: 1252 })
    expect(extractSizeRange('636 — 1,252 sqft')).toEqual({ minSqft: 636, maxSqft: 1252 })
    expect(extractSizeRange('636 to 1,252 sqft')).toEqual({ minSqft: 636, maxSqft: 1252 })
    // No space around the dash — "600–1,000 sq. ft." is verbatim Sentral Suites.
    expect(extractSizeRange('right-sized homes (600–1,000 sq. ft.)')).toEqual({
      minSqft: 600,
      maxSqft: 1000,
    })
  })

  it('parses a comma-grouped 5-digit number whole, not as its first two digits', () => {
    // If the bare \d{2,5} alternative came first, "19,041" would read as 19 and then be
    // silently clamped away — a real 19,041 sqft villa would lose its size.
    expect(extractSizeRange('Unit Sizes: 5,296 – 19,041 sqft')).toEqual({
      minSqft: 5296,
      maxSqft: 19041,
    })
  })
})

describe('extractSizeRange: rejection traps', () => {
  it('rejects a per-square-foot maintenance fee', () => {
    expect(extractSizeRange('Maintenance Fee: RM0.65 psf')).toBeNull()
  })

  it('rejects a per-square-foot asking price ("per" guard)', () => {
    expect(extractSizeRange('Asking RM1,200 per sq ft')).toBeNull()
    // Verbatim from PSQ Pavilion Square.
    expect(extractSizeRange('Maintenance Fee: RM0.99 per sqft')).toBeNull()
    expect(extractSizeRange('average RM2,600–RM3,300 per sqft')).toBeNull()
  })

  it('rejects a currency-prefixed figure (currency guard)', () => {
    // THE MUTATION TARGET for the psf/currency left-context guard: 1,450 is squarely
    // inside the plausibility window, so nothing else in the extractor stops it.
    expect(extractSizeRange('Indicative Price: RM1,450 sq ft')).toBeNull()
    expect(extractSizeRange('Price Range: RM1,450 – RM1,800 sq ft')).toBeNull()
  })

  it('rejects a land size in acres and a metric measurement', () => {
    expect(extractSizeRange('Land Size: 8.5 acres')).toBeNull()
    expect(extractSizeRange('50m infinity pool')).toBeNull()
  })

  it('rejects a land plot and a shared facility quoted in sqft', () => {
    // Found by auditing all 82 records — these used to widen the built-up range.
    expect(extractSizeRange('Land Area: 4,101 – 8,181 sqft')).toBeNull()
    expect(extractSizeRange('Land Size: 22x85 (1,873 sqft)')).toBeNull()
    expect(extractSizeRange('Facilities: (Total 16,800 sqft)')).toBeNull()
    expect(extractSizeRange('Largest Sky Gym (15,000 sq. ft.)')).toBeNull()
    expect(extractSizeRange('Lifestyle & Amenities: 19,000 sqft')).toBeNull()
  })

  it('rejects values outside the plausibility window', () => {
    expect(extractSizeRange('Total site: 435,600 sq ft')).toBeNull() // 10 acres
    expect(extractSizeRange('storage niche: 54 sqft')).toBeNull()
  })

  it('returns null for empty and non-string input', () => {
    expect(extractSizeRange('')).toBeNull()
    expect(extractSizeRange('A project with no sizes stated.')).toBeNull()
    expect(extractSizeRange(undefined as unknown as string)).toBeNull()
  })

  it('drops only the bad endpoint of a mixed range', () => {
    // 100 is implausible, 900 is not — the project still gets a size.
    expect(extractSizeRange('100 – 900 sqft')).toEqual({ minSqft: 900, maxSqft: 900 })
  })
})

// ─── Corpus sweep (all 82 real records) ───────────────────────────────────────

interface ScrapeRecord {
  titleClean: string
  body?: { text?: string }
}

const CORPUS_PATH = new URL('../../projects.json', import.meta.url)
const EXPECTED_CORPUS_SIZE = 82

/**
 * Load the scrape, or `null` if it is absent or not the full 82 records
 * (quick-kayinleong-089).
 *
 * TWO reasons this sweep must skip rather than throw:
 *
 * 1. `projects.json` is a gitignored scrape artifact (`.gitignore:57`). It is NEVER present
 *    in CI, so a top-level `readFileSync` made this file impossible to run there at all.
 *
 * 2. A PARTIAL artifact is worse than a missing one. During quick-kayinleong-088 a
 *    `to-inventory.ts --limit 3` dry run overwrote the corpus with 3 records, and this sweep
 *    reported ten "X missing from corpus" failures that read exactly like an extractor
 *    regression. Nothing about the extractor had changed. Gating on the record COUNT, not
 *    mere existence, is what makes that impossible.
 *
 * Source note: this reads `projects.json` (the raw scrape), NOT `projects.inventory.json`
 * (the dry-run preview) which it used to read. `to-inventory.ts` rewrites the preview on
 * every run — including a `--limit N` dry run — whereas the raw scrape only changes on a
 * full re-scrape. Both produce IDENTICAL results here, verified 2026-09-05 before switching:
 * 82 records, 66 parsed, 16 null, and all spot checks matching, because `to-inventory.ts`
 * stores `description: p.body.text` verbatim. No pinned count below was altered — the counts
 * are still the ones reviewed by eye on 2026-09-03. This also matches `unit-types.test.ts`,
 * so both corpus sweeps now load the same file the same way.
 *
 * The fixture traps above carry the behavioural contract and run everywhere. The sweep is
 * corpus verification, and is only meaningful against the corpus it was reviewed on.
 */
function loadCorpus(): ScrapeRecord[] | null {
  if (!existsSync(CORPUS_PATH)) return null
  const parsed = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { projects?: ScrapeRecord[] }
  const projects = parsed.projects ?? []
  return projects.length === EXPECTED_CORPUS_SIZE ? projects : null
}

const CORPUS = loadCorpus()

/**
 * Counts REVIEWED BY EYE against the source description text on 2026-09-03, all 82 lines.
 *
 * 66 parsed / 16 null. RESEARCH.md measured "61/82 descriptions mention sqft" with a
 * narrower probe; this extractor also accepts `sq.ft`, `sq. ft.` and `square feet`, which
 * is where the extra five come from (Eaton, Platinum Face, Armani Hallson, Royal Lexis,
 * The Oval all write `sq. ft.`).
 *
 * The 16 nulls are correct: 14 descriptions state no sqft figure at all, and 2 (Accent PJ,
 * plus the clamped-away site areas) mention only figures outside the plausibility window.
 */
const EXPECTED_PARSED = 66
const EXPECTED_NULL = 16

describe.skipIf(CORPUS === null)('extractSizeRange over the real 82-project corpus', () => {
  const projects = CORPUS ?? []
  const results = projects.map((p) => ({
    name: p.titleClean,
    range: extractSizeRange(String(p.body?.text ?? '')),
  }))

  it('the corpus is the 82 records this sweep was reviewed against', () => {
    expect(results.length).toBe(EXPECTED_CORPUS_SIZE)
  })

  it('parses 66 of 82 and leaves 16 null', () => {
    expect(results.filter((r) => r.range !== null).length).toBe(EXPECTED_PARSED)
    expect(results.filter((r) => r.range === null).length).toBe(EXPECTED_NULL)
  })

  it('every emitted value satisfies 200 <= min <= max <= 20000', () => {
    for (const { name, range } of results) {
      if (!range) continue
      expect(range.minSqft, name).toBeGreaterThanOrEqual(200)
      expect(range.maxSqft, name).toBeLessThanOrEqual(20_000)
      expect(range.minSqft, name).toBeLessThanOrEqual(range.maxSqft)
    }
  })

  /**
   * Ranges verified by reading each project's own description text (2026-09-03), chosen
   * to cover the interesting shapes: a multi-layout condo, a `sq. ft.` catalog, an
   * en-dash range, a landed project whose LAND size must be excluded, a project whose
   * FACILITIES area must be excluded, and the largest real layout in the corpus.
   */
  const SPOT_CHECKS: Array<[string, number, number]> = [
    ['Damansara City Residency (DC Residensi)', 904, 4855], // 904 studio -> 4,855 penthouse
    ['Eaton Residences by Sutera @ KLCC', 635, 2885], // written as `sq. ft.` throughout
    ['ViiA Residences', 636, 1252], // single "Built-Up Sizes: 636 – 1,252 sqft" line
    ['The Lantern Bangsar', 561, 1092], // 16,800 sqft FACILITIES deck excluded
    ['Yanu Hills @ Bon Estates', 6686, 8057], // 6,631–11,184 LAND size excluded
    ['Eden BRDB, Taman Duta', 5296, 19041], // largest real layout in the corpus
    ['Dawn KLCC', 348, 835], // 21 mentions, smallest studio in the corpus
    ['Vila Setara Happy Garden', 4100, 5595], // landed: land plot excluded, built-up kept
  ]

  for (const [name, minSqft, maxSqft] of SPOT_CHECKS) {
    it(`extracts ${minSqft}-${maxSqft} for ${name}`, () => {
      const hit = results.find((r) => r.name === name)
      expect(hit, `${name} missing from corpus`).toBeDefined()
      expect(hit!.range).toEqual({ minSqft, maxSqft })
    })
  }

  it('every project that states no sqft figure stays null', () => {
    // Named so a future extractor change that starts inventing a size for these is loud.
    const NO_SIZE_STATED = [
      'The Cedar Damansara Heights',
      'IJM Sierra Hijauan',
      'Alstonia Hilltop Homes',
      'Exsim Project',
      'Aetas Taman Desa',
      'Aria Luxury Residence @ KLCC',
      'Quill Residences KLCC',
      'Times Square 2 Residences Kuala Lumpur',
      'The Manor KLCC',
      'Rimbun Saujana Residency',
      'Anyara Hills',
      'Rafflesia @ Hill 2, 3 & 4',
      'The MET, Corporate Tower',
      'Sierra Hijau (Landed)',
      'Melbourne Square',
      'Accent PJ',
    ]
    expect(NO_SIZE_STATED.length).toBe(EXPECTED_NULL)
    for (const name of NO_SIZE_STATED) {
      const hit = results.find((r) => r.name === name)
      expect(hit, `${name} missing from corpus`).toBeDefined()
      expect(hit!.range, name).toBeNull()
    }
  })
})
