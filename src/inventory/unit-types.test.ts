/**
 * unit-types.test.ts — fixture traps + a full sweep of the real project corpus
 * (quick-kayinleong-088).
 *
 * The corpus is fixed and small, so "it compiles" is not evidence. Every count pinned in
 * the sweep below was REVIEWED LINE BY LINE against the source description text on
 * 2026-09-05, and the four mis-parses that review found are now guarded and regression-
 * tested by name (Golden Crown's show-unit line, Rimbun Saujana's "3+1R", The Atera's
 * double-tabulated types, Royal Lexis's three-way size list).
 *
 * FALSE POSITIVES ARE THE FAILURE MODE THAT MATTERS. A layout the write-up never stated
 * reads as authoritative fact to an agent quoting it to a client — the same harm as the
 * fabricated prices this claim exists to undo. The rejection block is therefore larger
 * than the acceptance block, and the sweep asserts on the projects that must stay EMPTY,
 * not just on the ones that must parse.
 *
 * If a count here changes, either the corpus changed or the extractor regressed. Do not
 * widen the assertion to make it pass — re-run the sweep and look at what moved.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { extractUnitTypes } from './unit-types'

// ─── The shapes named in the claim brief ──────────────────────────────────────

describe('extractUnitTypes: size-first rows with a mil-suffixed price range', () => {
  it('reads size, label, bedrooms and both price endpoints', () => {
    expect(extractUnitTypes('504sf Studio - From RM1.24 - 1.8mil')).toEqual([
      {
        label: 'Studio',
        sizeSqft: 504,
        bedrooms: 0,
        priceMinRM: 1_240_000,
        priceMaxRM: 1_800_000,
        raw: '504sf Studio - From RM1.24 - 1.8mil',
      },
    ])
  })

  it('applies the SECOND number’s unit suffix to BOTH endpoints', () => {
    // "RM1.8 - 2.7mil" means 1,800,000-2,700,000. Read literally, the first number is 1.8
    // ringgit. This is the single most load-bearing rule in the price parser.
    const [entry] = extractUnitTypes('770sf 1+1Room - From RM1.8 - 2.7mil')
    expect(entry).toMatchObject({ priceMinRM: 1_800_000, priceMaxRM: 2_700_000 })
  })

  it('counts a "1+1" layout as ONE bedroom, not two', () => {
    // The "+1" is a study/utility. Counting it inflates matches against a client's
    // bedroom requirement (documented on UnitTypeEntry.bedrooms).
    expect(extractUnitTypes('770sf 1+1Room - From RM1.8 - 2.7mil')[0]?.bedrooms).toBe(1)
    expect(extractUnitTypes('3380sft Type H1 (North Wing) 4+1rooms')[0]?.bedrooms).toBe(4)
  })

  it('parses a whole brief-shaped table', () => {
    const table = [
      '504sf Studio - From RM1.24 - 1.8mil',
      '770sf 1+1Room - From RM1.8 - 2.7mil',
      '966sf 2Room - From RM2.4 - 3.3mil',
      '1255sf 3Room -  From RM3.2 - 4.6mil',
    ].join('\n')

    expect(extractUnitTypes(table)).toEqual([
      { label: 'Studio', sizeSqft: 504, bedrooms: 0, priceMinRM: 1_240_000, priceMaxRM: 1_800_000, raw: '504sf Studio - From RM1.24 - 1.8mil' },
      { label: '1+1Room', sizeSqft: 770, bedrooms: 1, priceMinRM: 1_800_000, priceMaxRM: 2_700_000, raw: '770sf 1+1Room - From RM1.8 - 2.7mil' },
      { label: '2Room', sizeSqft: 966, bedrooms: 2, priceMinRM: 2_400_000, priceMaxRM: 3_300_000, raw: '966sf 2Room - From RM2.4 - 3.3mil' },
      // `raw` collapses runs of whitespace — the brief's fourth row has a double space.
      { label: '3Room', sizeSqft: 1255, bedrooms: 3, priceMinRM: 3_200_000, priceMaxRM: 4_600_000, raw: '1255sf 3Room - From RM3.2 - 4.6mil' },
    ])
  })

  it('keeps the type code and its disambiguating parenthetical as the label', () => {
    expect(extractUnitTypes('3380sft Type H1 (North Wing) 4+1rooms')).toEqual([
      {
        label: 'Type H1 (North Wing)',
        sizeSqft: 3380,
        bedrooms: 4,
        priceMinRM: null,
        priceMaxRM: null,
        raw: '3380sft Type H1 (North Wing) 4+1rooms',
      },
    ])
  })
})

describe('extractUnitTypes: unit and separator spellings', () => {
  it('accepts sf / sft / sqft / sq ft / sq. ft.', () => {
    const sizes = [
      '600sf Studio',
      '600sft Studio',
      '600sqft Studio',
      'Studio: 600 sq ft',
      'Studio: 600 sq. ft.',
      'Studio: 600 sq.ft',
    ].map((l) => extractUnitTypes(l)[0]?.sizeSqft)
    expect(sizes).toEqual([600, 600, 600, 600, 600, 600])
  })

  it('parses thousands separators whole, not as the first group', () => {
    // Without the comma-grouped alternative first, "14,869" reads as 14 and the largest
    // penthouse in the corpus silently loses its size.
    expect(extractUnitTypes('Duplex Penthouse C1: 14,869 sqft (6+2 Rooms)')[0]).toMatchObject({
      label: 'Penthouse C1',
      sizeSqft: 14_869,
      bedrooms: 6,
    })
  })

  it('tolerates stray whitespace around every token', () => {
    expect(extractUnitTypes('   Type   A :   1,199   sqft   |   3R   2B   ')[0]).toMatchObject({
      label: 'Type A',
      sizeSqft: 1199,
      bedrooms: 3,
    })
  })

  it('takes the LOW endpoint of a size range as the layout’s "from" size', () => {
    expect(extractUnitTypes('2+1 rooms: 943 – 1,093 sqft')[0]).toMatchObject({
      sizeSqft: 943,
      bedrooms: 2,
    })
    expect(extractUnitTypes('3+1 Bedrooms: 2,700 - 2,900 sqft | 3 car park bays')[0]?.sizeSqft).toBe(2700)
  })

  it('reads / and & size lists, and a three-way list, down to their lowest figure', () => {
    // Verbatim Eaton ("775 / 840"), Tria ("764 & 797") and Royal Lexis (three-way).
    expect(extractUnitTypes('1 + 1 Flexi Room: 775 / 840 sq. ft.')[0]?.sizeSqft).toBe(775)
    expect(extractUnitTypes('Type C – 1,053 / 1,085 / 1,225 sq. ft. (Dual Key – 2 Bedrooms)')[0]).toMatchObject({
      label: 'Type C',
      sizeSqft: 1053,
      bedrooms: 2,
    })
  })
})

describe('extractUnitTypes: bedroom counts', () => {
  it('reads every count spelling in the corpus', () => {
    const cases: Array<[string, number | null]> = [
      ['Studio: 820 sqft', 0],
      ['1 Bedroom: 904 sqft', 1],
      ['2 Rooms: 817 sqft', 2],
      ['Type A1: 350 sqft | 1 bed, 1 bath', 1],
      ['Type C1 1367sf - 2rooms, 2 baths', 2], // no space at all
      ['Type A — 1 flexi room, 1 bath: 485 sqft', 1], // intervening adjective
      ['Type A: 1,199 sqft | 3R 2B | 2 CP', 3], // compact code
      ['Type A: 147 m² (1,582 sqft) — 4R3B', 4], // compact code, no spaces
      ['Type C1 - 3+1R 3B with Balcony. 1,894sf', 3], // "+1R" is not 1 bedroom
      ['Type A — 549 sqft | 1 bed+1, 1 bath', 1], // "+1" written after the noun
    ]
    for (const [line, expected] of cases) {
      expect(extractUnitTypes(line)[0]?.bedrooms, line).toBe(expected)
    }
  })

  it('never reads a BATHroom count as a bedroom count', () => {
    // "5+1 rooms, 5+1 bathrooms" — `rooms` matches inside `bathrooms` under a naive regex.
    expect(extractUnitTypes('Villa A — 3,703 sqft | 5+1 rooms, 5+1 bathrooms')[0]?.bedrooms).toBe(5)
    // Nothing but baths stated: bedrooms is UNKNOWN, which is null and never 0.
    expect(extractUnitTypes('Type B: 550 sqft | Dual key, 2 baths')[0]?.bedrooms).toBeNull()
    expect(extractUnitTypes('Type A1: 852 sqft')[0]?.bedrooms).toBeNull()
  })

  it('lets an explicit room count outrank the word "studio"', () => {
    // Verbatim The Reya Type C: a 4-bedroom layout with a studio annexe, not a studio.
    expect(extractUnitTypes('Type C — 2,210 sqft | 4+1 rooms + 1 studio, 5 baths')[0]?.bedrooms).toBe(4)
  })

  it('leaves bedrooms null rather than defaulting to 0', () => {
    // THE MUTATION TARGET for the nullability contract: 0 means studio, and a project
    // whose bedroom count is merely unstated must not be filed as a studio.
    for (const e of extractUnitTypes('Type A: 776 sq.ft (224 units)\nType B: 406 sq.ft (672 units)')) {
      expect(e.bedrooms).toBeNull()
    }
  })
})

describe('extractUnitTypes: prices', () => {
  it('reads k / m / mil / mill / million suffixes', () => {
    const cases: Array<[string, number]> = [
      ['Type A: 667sf - RM761k', 761_000],
      ['Type C1: 1367sf - RM1.403m', 1_403_000],
      ['Studio: 820 sqft — from RM2.28 million', 2_280_000],
      ['Type SU1: 1,558 sqft | 4R 3B — From RM1.03 million', 1_030_000],
      ['1,292 sf | 3+1 rooms | From RM1.2M', 1_200_000],
      ['Type A: 900 sqft, 3 rooms — RM2.6mill', 2_600_000],
    ]
    for (const [line, expected] of cases) {
      expect(extractUnitTypes(line)[0]?.priceMinRM, line).toBe(expected)
    }
  })

  it('reads a plain comma-grouped range', () => {
    expect(extractUnitTypes('Type A: 1,199 sqft | 3R 2B | 2 CP — From RM785,000 – RM819,000')[0]).toMatchObject({
      priceMinRM: 785_000,
      priceMaxRM: 819_000,
    })
  })

  it('sets both endpoints to the single stated figure when no range is given', () => {
    expect(extractUnitTypes('Type B — 2 rooms, 707 sqft — from RM563,160')[0]).toMatchObject({
      priceMinRM: 563_160,
      priceMaxRM: 563_160,
    })
  })

  it('takes the FIRST price on the line, not a trailing add-on', () => {
    // Verbatim Southpoint. RM100k clears the plausibility floor on its own, so ordering
    // is the only thing that keeps the ID package out of the price column.
    expect(
      extractUnitTypes('Type C — 1,119 sqft, 2 beds — from RM1.74 million (optional ID package at RM100k)')[0],
    ).toMatchObject({ priceMinRM: 1_740_000, priceMaxRM: 1_740_000 })
  })

  it('never turns a psf RATE into a price', () => {
    // THE DEFECT THIS WHOLE CLAIM EXISTS TO UNDO. An extractor LLM read "RM1,400 psf" and
    // stored RM798,800 by multiplying it by a square footage it invented.
    expect(extractUnitTypes('Type A1: 570 sqft — Price: RM1,400 psf (Gross)')[0]).toMatchObject({
      priceMinRM: null,
      priceMaxRM: null,
    })
    expect(extractUnitTypes('Type A: 917 sqft, 2 rooms — RM900-1000psf')[0]).toMatchObject({
      priceMinRM: null,
      priceMaxRM: null,
    })
    expect(extractUnitTypes('Type A1: 4,677 sqft — 4+1 rooms — Package A (Bare Unit): ~RM1,100 psf')[0]).toMatchObject({
      priceMinRM: null,
      priceMaxRM: null,
    })
  })

  it('never turns a FEE into a price', () => {
    for (const line of [
      'Type A: 570 sqft, 1 room — Booking Fee: RM5,000',
      'Type A: 570 sqft, 1 room — Maintenance Fee: RM650,000 sinking fund reserve',
      'Type A: 570 sqft, 1 room — stamp duty RM120,000 waived',
    ]) {
      expect(extractUnitTypes(line)[0]?.priceMinRM, line).toBeNull()
    }
  })

  it('leaves price null rather than 0 when the row states none', () => {
    for (const e of extractUnitTypes('Type A1: 852 sqft\nType B1: 1,043 sqft')) {
      expect(e.priceMinRM).toBeNull()
      expect(e.priceMaxRM).toBeNull()
    }
  })
})

// ─── Rejection traps: the expensive errors ────────────────────────────────────

describe('extractUnitTypes: rejection traps', () => {
  it('rejects a per-square-foot maintenance fee line', () => {
    // `psf` ENDS IN `sf`, and this extractor deliberately accepts a bare `sf` unit. Every
    // one of these would become a unit size without the letter-before-unit guard.
    expect(extractUnitTypes('Maintenance Fee: RM0.88 psf')).toEqual([])
    expect(extractUnitTypes('Maintenance Fee: RM0.65 psf for 2 rooms')).toEqual([])
    expect(extractUnitTypes('Sinking Fund: RM0.22 psf | Studio')).toEqual([])
    expect(extractUnitTypes('Maintenance Fee: RM0.99 per sqft, 3 rooms')).toEqual([])
  })

  it('rejects a per-square-foot rate written as "per sq ft"', () => {
    // THE MUTATION TARGET for the `per` gap guard. No currency marker and no fee word, so
    // neither the currency guard nor the fee guard covers this — and 1,200 sits squarely
    // inside the plausible built-up window, so the clamp does not either.
    expect(extractUnitTypes('1,200 per sq ft | 3 rooms')).toEqual([])
    expect(extractUnitTypes('Type A — 2,600 per sqft, 2 rooms')).toEqual([])
  })

  it('rejects a comparables list of competitor psf rates', () => {
    // Verbatim Bangsar Hill Park. Nothing here is a D2 layout.
    expect(
      extractUnitTypes('Nadi Bangsar RM1300psf / Alfa Bangsar RM1300psf / TNB Gold Pantai RM1200psf'),
    ).toEqual([])
  })

  it('rejects a competitor SIZE comparison', () => {
    // Verbatim Accent PJ. Real sizes, real project names, someone else’s buildings.
    expect(extractUnitTypes('Atwater: mostly 703–1,052 sf (corner units only 1,400 sf)')).toEqual([])
    expect(extractUnitTypes('Ryan & Miho: 678–818 sf')).toEqual([])
    expect(extractUnitTypes('Centre Stage: mostly 459–799 sf')).toEqual([])
  })

  it('rejects a prose paragraph that happens to name a size and a bedroom count', () => {
    const prose =
      'Set in the heart of Bangsar, this development offers generously proportioned homes ' +
      'from 950 sqft upwards, with 3 bedrooms in the most popular configuration, and has ' +
      'become the reference point for buyers comparing new launches in the area.'
    expect(extractUnitTypes(prose)).toEqual([])
  })

  it('rejects a THRESHOLD size rather than reading it as a layout', () => {
    // Verbatim TRX Residences and Pavilion Damansara. Both carry a bedroom/unit word and
    // exactly one plausible size, so nothing but the comparison-operator guard stops them.
    expect(extractUnitTypes('Only 3 bedrooms > 1,345sf given side by side 2 carparks')).toEqual([])
    expect(extractUnitTypes('Units below 1,300 sqft: 1 car park')).toEqual([])
    expect(extractUnitTypes('Studios over 500 sqft come with 1 car park')).toEqual([])
  })

  it('rejects shared facilities, land plots and terraces quoted in sqft', () => {
    expect(extractUnitTypes('Facilities: (Total 16,800 sqft) for all 3 bedrooms towers')).toEqual([])
    expect(extractUnitTypes('Largest Sky Gym (15,000 sq. ft.) — 2 rooms away')).toEqual([])
    expect(extractUnitTypes('Land Size: 22x85 (1,873 sqft) | 4+1 rooms')).toEqual([])
    expect(extractUnitTypes('Private Terrace: 409 sf | Type H')).toEqual([])
  })

  it('rejects a show-unit ANNOUNCEMENT while keeping a layout row annotated as one', () => {
    // Golden Crown: the first size is killed by the label guard and the second is not, so
    // exactly one survives and the row pairs "Type A1" with 926 sqft. Type A1 is 624 sqft.
    expect(extractUnitTypes('Show Units: Type A1 (624 sf), Type B1/B2 (926 sf)')).toEqual([])
    expect(extractUnitTypes('Show unit: Type B (1,045 sqft, 3 rooms)')).toEqual([])
    // The Reya, by contrast, is a genuine row that merely notes the display unit.
    expect(extractUnitTypes('Type A1 — 1,350 sqft | 3+1 rooms, 2 baths (Show unit)')[0]).toMatchObject({
      label: 'Type A1',
      sizeSqft: 1350,
      bedrooms: 3,
    })
  })

  it('rejects a row stating TWO sizes, because that is not one layout', () => {
    expect(extractUnitTypes('• Type H: 1,227 sq. ft. (409 sf terrace)')).toEqual([])
    expect(extractUnitTypes('Accent offers 1,500 sf and 1,880 sf units')).toEqual([])
  })

  it('rejects a bare size with no layout marker', () => {
    expect(extractUnitTypes('Windsor: 568 units — 614 – 1,831 sqft')).toEqual([])
    expect(extractUnitTypes('Tower A: 47 storeys, 210 units (typical: 1,408 – 1,905 sqft)')).toEqual([])
    expect(extractUnitTypes('Unit Sizes: 5,296 – 19,041 sqft')).toEqual([])
  })

  it('rejects a currency-prefixed figure written with an area unit', () => {
    expect(extractUnitTypes('Indicative Price: RM1,450 sq ft for 2 rooms')).toEqual([])
    expect(extractUnitTypes('Studio price range: RM1,450 – RM1,800 sq ft')).toEqual([])
  })

  it('rejects sizes outside the plausibility window', () => {
    expect(extractUnitTypes('Type A: 435,600 sq ft')).toEqual([]) // 10 acres
    expect(extractUnitTypes('Studio storage niche: 54 sqft')).toEqual([])
  })

  it('returns [] for empty, whitespace and non-string input', () => {
    expect(extractUnitTypes('')).toEqual([])
    expect(extractUnitTypes('   \n\n  ')).toEqual([])
    expect(extractUnitTypes('A project with no layout table stated.')).toEqual([])
    expect(extractUnitTypes(undefined as unknown as string)).toEqual([])
    expect(extractUnitTypes(null as unknown as string)).toEqual([])
  })
})

describe('extractUnitTypes: dedupe', () => {
  it('collapses a layout tabulated twice, keeping the richer row', () => {
    // Verbatim The Atera, which lists its types once with sizes and once with bedrooms.
    const entries = extractUnitTypes(
      ['Type B — 775 sqft | 2 rooms, 2 baths', 'Type B (775 sqft) — 2 rooms, 2 baths'].join('\n'),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ label: 'Type B', sizeSqft: 775, bedrooms: 2 })
  })

  it('keeps the mention that states MORE', () => {
    const entries = extractUnitTypes(['Type A1: 570 sqft', 'Type A1: 570 sqft (1 Room, 1 Bath)'].join('\n'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.bedrooms).toBe(1)
  })

  it('keeps same-labelled rows that state DIFFERENT sizes', () => {
    // Rafflesia tabulates "Type E & E1" at two sizes; both are real.
    expect(extractUnitTypes(['Type E & E1 - 3,879sf', 'Type E & E1 - 3,964sf'].join('\n'))).toHaveLength(2)
  })
})

// ─── Corpus sweep (all 87 live records) ───────────────────────────────────────

/**
 * The sweep runs over `projects.json` — the raw Skool scrape, 82 records — because it is
 * the committed artifact the other extractor test already uses and needs no credentials.
 *
 * The live `projects` collection holds 87 docs (82 imported + 5 added later) and its
 * `description` field is verbatim `body.text` from this file, so the parse is identical
 * for the 82 shared records. Live figures quoted in the claim report were measured
 * separately against Firestore on 2026-09-05.
 */
interface ScrapeRecord {
  titleClean: string
  body?: { text?: string }
}

const CORPUS_PATH = new URL('../../projects.json', import.meta.url)
const EXPECTED_CORPUS_SIZE = 82

/**
 * `projects.json` is a GITIGNORED scrape artifact (.gitignore:58), so it is absent in CI
 * and can be regenerated at any moment by the scraper scripts. `size-extract.test.ts` has
 * the same dependency and hard-fails when the artifact is missing or partial — which
 * happened for real during this claim, when a concurrent scraper run truncated
 * `projects.inventory.json` to 3 records and took ten of its assertions down with it.
 *
 * This sweep therefore SKIPS rather than fails when the artifact is not the full scrape.
 * The fixture traps above carry the behavioural contract and run everywhere; the sweep is
 * corpus verification and is only meaningful against the corpus it was reviewed on.
 */
function loadCorpus(): ScrapeRecord[] | null {
  if (!existsSync(CORPUS_PATH)) return null
  const parsed = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { projects?: ScrapeRecord[] }
  const projects = parsed.projects ?? []
  return projects.length === EXPECTED_CORPUS_SIZE ? projects : null
}

const CORPUS = loadCorpus()

/**
 * Counts REVIEWED BY EYE against the source text on 2026-09-05, every parsed row.
 *
 * 50 of the 82 scraped write-ups tabulate at least one layout. That is far more than the
 * "most projects have no per-layout table" the `ProjectDoc.unitTypes` comment anticipated
 * — the per-layout table is the NORM in this corpus, not the exception, which is the main
 * finding of this extraction.
 */
const EXPECTED_PROJECTS_WITH_LAYOUTS = 50

describe.skipIf(CORPUS === null)('extractUnitTypes: real corpus sweep', () => {
  const projects = CORPUS ?? []
  const results = projects.map((p) => ({
    name: p.titleClean,
    entries: extractUnitTypes(String(p.body?.text ?? '')),
  }))

  it('sweeps the whole scrape', () => {
    expect(results.length).toBe(EXPECTED_CORPUS_SIZE)
  })

  it(`finds a layout table in exactly ${EXPECTED_PROJECTS_WITH_LAYOUTS} projects`, () => {
    expect(results.filter((r) => r.entries.length > 0).length).toBe(EXPECTED_PROJECTS_WITH_LAYOUTS)
  })

  it('honours every field invariant on every row', () => {
    for (const { name, entries } of results) {
      for (const e of entries) {
        expect(e.label.length, name).toBeGreaterThan(0)
        expect(e.raw.length, name).toBeGreaterThan(0)
        // Never 0, never a guess — null is the only "unstated".
        expect(e.sizeSqft === null || (e.sizeSqft >= 200 && e.sizeSqft <= 20_000), name).toBe(true)
        expect(e.bedrooms === null || (e.bedrooms >= 0 && e.bedrooms <= 12), name).toBe(true)
        if (e.priceMinRM !== null) {
          expect(e.priceMinRM, name).toBeGreaterThanOrEqual(100_000)
          expect(e.priceMaxRM, name).toBeGreaterThanOrEqual(e.priceMinRM)
        } else {
          expect(e.priceMaxRM, name).toBeNull()
        }
      }
    }
  })

  it('keeps `raw` a verbatim substring of the source description', () => {
    // The audit trail for grounding: every rendered figure must be traceable to a line
    // the write-up actually contains, modulo whitespace collapsing.
    for (const p of projects) {
      const flat = String(p.body?.text ?? '').replace(/\s+/g, ' ')
      for (const e of extractUnitTypes(String(p.body?.text ?? ''))) {
        expect(flat.includes(e.raw), `${p.titleClean}: ${e.raw}`).toBe(true)
      }
    }
  })

  /**
   * Rows verified by reading each project's own text (2026-09-05), chosen to cover the
   * interesting shapes: a bedroom-labelled table, a type-code table, a table with prices,
   * a compact "3R 2B" table, a size-first table, and a metric-plus-imperial table.
   */
  const SPOT_CHECKS: Array<[string, number, Record<string, unknown>]> = [
    // Bedroom-labelled, size ranges, car-park noise on every row.
    ['Damansara City Residency (DC Residensi)', 4, { label: '1 Bedroom', sizeSqft: 904, bedrooms: 1, priceMinRM: null }],
    // Type code + price, the shape the Finder detail view most wants.
    ['Padang Residences', 7, { label: 'Type A', sizeSqft: 1199, bedrooms: 3, priceMinRM: 785_000, priceMaxRM: 819_000 }],
    // Bedroom-labelled with a stated total price.
    ['St. Regis Residences Kuala Lumpur', 4, { label: 'Studio', sizeSqft: 820, bedrooms: 0, priceMinRM: 2_280_000 }],
    // Compact "3R 2B" codes and a "3+1R" that must not read as 1.
    ['Rimbun Saujana Residency', 6, { label: 'Type A1', sizeSqft: 1173, bedrooms: 2 }],
    // Size-first rows: the label has to come from the type code AFTER the size.
    ['PDH: Imperial Residences RA', 4, { label: 'Type H1 (North Wing)', sizeSqft: 3380, bedrooms: null }],
    // Metric alongside imperial — only the sqft figure may be read.
    ['Tangen Residences', 4, { label: 'Type A', sizeSqft: 1582, bedrooms: 4 }],
    // Largest table in the corpus.
    ['Dawn KLCC', 21, { label: 'Type A1', sizeSqft: 350, bedrooms: 1 }],
  ]

  for (const [name, count, firstRow] of SPOT_CHECKS) {
    it(`extracts ${count} layouts for ${name}`, () => {
      const hit = results.find((r) => r.name === name)
      expect(hit, `${name} missing from corpus`).toBeDefined()
      expect(hit!.entries.length, name).toBe(count)
      expect(hit!.entries[0]).toMatchObject(firstRow)
    })
  }

  /**
   * Projects that must stay EMPTY. Named individually so a future extractor change that
   * starts inventing layouts for them is loud rather than silent — these are the write-ups
   * that carry sizes, bedroom words and psf rates in PROSE, which is exactly the material
   * a looser parser turns into fabricated rows.
   */
  it('invents no layouts for prose-only write-ups', () => {
    // NOTE: Bangsar Hill Park is deliberately NOT here. Its write-up carries the psf
    // comparables list this extractor must reject ("Nadi Bangsar RM1300psf") AND a real
    // six-row layout table ("917 sqft — 2 rooms, 2 baths"). Rejecting the whole project
    // would be the wrong fix; the comparables line is asserted on directly above.
    const NO_TABLE = [
      'Accent PJ', // competitor size comparison, four other projects by name
      'TRX Residences', // "Only 3 bedrooms > 1,345sf" threshold statement
      'The MET, Corporate Tower', // office floor plates, no residential layouts
      'Eden BRDB, Taman Duta', // a single "Unit Sizes: 5,296 – 19,041 sqft" span
      'Pavilion Damansara Heights', // tower breakdowns and car-park allocation rules
    ]
    for (const name of NO_TABLE) {
      const hit = results.find((r) => r.name === name)
      expect(hit, `${name} missing from corpus`).toBeDefined()
      expect(hit!.entries, name).toEqual([])
    }
  })

  it('never emits a bedroom count of 0 for a non-studio row', () => {
    // 0 is a meaningful value here (studio), unlike in `ProjectDoc.bedrooms` where it is
    // the unknown sentinel. Guard the distinction: a 0 must be backed by the word.
    for (const { name, entries } of results) {
      for (const e of entries) {
        if (e.bedrooms === 0) expect(/studio/i.test(e.raw), `${name}: ${e.raw}`).toBe(true)
      }
    }
  })
})
