/**
 * tests/finder-corpus-gates.test.ts — the location and price gates run over the REAL
 * 82-project corpus (quick-kayinleong-085 / D4 + D2).
 *
 * WHY A CORPUS TEST AND NOT MORE FIXTURES: the reported defect was invisible to fixtures.
 * "show me a list of 1mil property within Klang Valley" returned almost nothing, and the
 * assumed cause was `MAX_MATCHES = 8`. It was not. Measured against `projects.inventory.json`
 * BEFORE this claim:
 *
 *   "Klang Valley"                        ->  5 of 82 survived the location gate
 *   "Klang Valley" + priceMax 1,000,000   ->  3 of 82 survived
 *
 * The cap never engaged — there were never 8 candidates to cap. Only a test that runs the
 * real gates over the real corpus can pin that, so this file exists to keep the region
 * skip and the unpriced admission honest against the data they were measured on.
 *
 * `projects.inventory.json` is the import payload for the live `projects` collection:
 * `{ count: 82, records: [{ input: <ProjectDoc-shaped> }] }`. Records carry no `embedding`
 * and no `priceBand`, which is fine — the gates under test read only `name`,
 * `locationText` and `priceValue`.
 *
 * The three vi.mock blocks below mirror src/inventory/search.test.ts:277-301. They are
 * required, not decorative: importing `@/src/inventory/search` pulls in Firebase Admin and
 * the Gemini embed client, and the default `npx vitest run` must stay green with no
 * credentials.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ProjectDoc } from '@/src/firebase/collections'

vi.mock('@/src/rag/embed', () => ({
  embedText: vi.fn(async () => Array.from({ length: 1024 }, () => 0)),
  EMBED_DIM: 1024,
}))

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { collection: vi.fn(() => ({ where: vi.fn() })) },
}))

vi.mock('@/src/firebase/collections', () => ({
  projectsRef: vi.fn(() => ({ where: vi.fn() })),
  PRICE_BANDS: ['under_500k', '500k_800k', '800k_1.2m', 'above_1.2m'],
  priceBandFor: vi.fn(() => 'under_500k'),
}))

import {
  locationNeedles,
  projectMatchesLocation,
  projectMatchesPrice,
} from '@/src/inventory/search'

const CORPUS = JSON.parse(
  readFileSync(new URL('../projects.inventory.json', import.meta.url), 'utf8'),
) as { count: number; records: Array<{ input: ProjectDoc }> }

const PROJECTS: ProjectDoc[] = CORPUS.records.map((r) => r.input)

/** How many projects survive a location preference. A null needle set = gate skipped. */
function locationSurvivors(pref: string): number {
  const needles = locationNeedles(pref)
  if (needles === null) return PROJECTS.length
  return PROJECTS.filter((doc) => projectMatchesLocation(doc, needles)).length
}

describe('the corpus this file was measured against', () => {
  it('is 82 active-import records', () => {
    expect(CORPUS.count).toBe(82)
    expect(PROJECTS.length).toBe(82)
  })

  it('has 32 unpriced projects and 50 with a known price', () => {
    // The number D2 turns on: 32 of 82 carry priceValue 0, which means UNKNOWN.
    expect(PROJECTS.filter((p) => p.priceValue === 0).length).toBe(32)
    expect(PROJECTS.filter((p) => p.priceValue > 0).length).toBe(50)
  })
})

// ─── D4: region qualifiers skip the gate ──────────────────────────────────────

describe('D4: a region name is not a location filter', () => {
  it('every Klang Valley phrasing yields a null needle set', () => {
    // THE REGRESSION THIS PINS: pre-fix, locationNeedles('Klang Valley') returned
    // [{ phrase: 'klang valley', tokens: ['klang','valley'] }] and 5 of 82 projects
    // matched it as a literal substring of name + locationText.
    expect(locationNeedles('Klang Valley')).toBeNull()
    expect(locationNeedles('greater KL')).toBeNull()
    expect(locationNeedles('Greater Kuala Lumpur')).toBeNull()
    expect(locationNeedles('Lembah Klang')).toBeNull()
    expect(locationNeedles('巴生谷')).toBeNull()
    // Qualifier tokens stripped first, so the phrasing does not matter.
    expect(locationNeedles('in the Klang Valley area')).toBeNull()
    expect(locationNeedles('within Klang Valley')).toBeNull()
  })

  it('all 82 projects survive a Klang Valley preference (was 5 of 82)', () => {
    expect(locationSurvivors('Klang Valley')).toBe(82)
    expect(locationSurvivors('in the Klang Valley area')).toBe(82)
    expect(locationSurvivors('greater KL')).toBe(82)
  })

  it('D4 does NOT disable real area filtering', () => {
    // If the region skip were over-broad these would all become 82 and the Finder would
    // start answering a Cheras request with Bangsar projects — the quick-050 defect.
    expect(locationNeedles('Cheras')).not.toBeNull()
    expect(locationSurvivors('Cheras')).toBe(0) // D2 holds no active Cheras inventory
    expect(locationSurvivors('Bangsar')).toBe(8)
    expect(locationSurvivors('Petaling Jaya')).toBe(4)
  })

  it('a region combined with a real area still filters on the area', () => {
    // "Bangsar, Klang Valley" — the region segment drops out, the area segment stays.
    expect(locationSurvivors('Bangsar, Klang Valley')).toBe(8)
  })
})

// ─── D2: unpriced projects are admitted, never asserted ───────────────────────

describe('D2: the price gate admits an unknown price', () => {
  const unpriced = { priceValue: 0 } as ProjectDoc
  const inBudget = { priceValue: 950_000 } as ProjectDoc
  const overBudget = { priceValue: 1_500_000 } as ProjectDoc

  it('an unpriced project passes a stated bound', () => {
    expect(projectMatchesPrice(unpriced, null, 1_000_000)).toBe(true)
    expect(projectMatchesPrice(unpriced, 500_000, null)).toBe(true)
  })

  it('a known price is still compared exactly, inclusive at the bound', () => {
    expect(projectMatchesPrice(inBudget, null, 1_000_000)).toBe(true)
    expect(projectMatchesPrice(overBudget, null, 1_000_000)).toBe(false)
    expect(projectMatchesPrice({ priceValue: 1_000_000 } as ProjectDoc, null, 1_000_000)).toBe(true)
  })

  it('no bound stated means every project passes', () => {
    expect(projectMatchesPrice(overBudget, null, null)).toBe(true)
  })
})

// ─── The driving prompt, end to end through both gates ────────────────────────

describe('the driving prompt: "show me a list of 1mil property within Klang Valley"', () => {
  it('82 candidates survive the (skipped) location gate, 50 survive the budget', () => {
    // Pre-fix this chain was 5 -> 3. The complaint was "5 cards"; the truth was 3 rows.
    const afterLocation = PROJECTS.filter((doc) => {
      const needles = locationNeedles('Klang Valley')
      return needles === null || projectMatchesLocation(doc, needles)
    })
    expect(afterLocation.length).toBe(82)

    const afterPrice = afterLocation.filter((doc) => projectMatchesPrice(doc, null, 1_000_000))
    expect(afterPrice.length).toBe(50)
  })

  it('the 50 survivors are 18 priced within budget plus 32 unpriced', () => {
    const survivors = PROJECTS.filter((doc) => projectMatchesPrice(doc, null, 1_000_000))
    expect(survivors.filter((p) => p.priceValue > 0).length).toBe(18)
    expect(survivors.filter((p) => p.priceValue === 0).length).toBe(32)
  })
})
