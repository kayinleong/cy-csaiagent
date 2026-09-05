/**
 * tools.test.ts — the searchProjects cap SPLIT (quick-kayinleong-085).
 *
 * `searchProjects` now returns up to `MAX_ROWS` (100) matches so the client table can show
 * every relevant project. That array must never reach the model: the tool result is
 * re-sent on EVERY step of the Finder's 5-step loop, and 82 uncapped projects measured
 * ~10,100 tokens per step — ~50k tokens on one turn against a 300,000/24h TOKEN_CAP.
 *
 * So there are two paths out of `execute`, and this file pins both:
 *   - `toModelOutput` bounds what the MODEL sees at `MAX_MATCHES` (8).
 *   - the request-scoped SINK holds every row, for the route to put on `messageMetadata`
 *     and into the persisted envelope.
 * Neither is redundant. Deleting either one is the failure this file exists to catch.
 *
 * Mock pattern mirrors src/inventory/search.test.ts and fetch-collateral.test.ts — the
 * default `npx vitest run` must stay green with no credentials.
 *
 * Run: npx vitest run src/agents/finder/tools.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectMatch, SearchResult } from '@/src/inventory/search'

const mocks = vi.hoisted(() => ({
  mockSearchProjects: vi.fn(),
  mockQueryInventory: vi.fn(),
  mockCollateralGet: vi.fn(async () => ({ empty: true, docs: [] })),
}))

vi.mock('@/src/rag/embed', () => ({
  embedText: vi.fn(async () => []),
  EMBED_DIM: 1024,
}))

vi.mock('@/src/firebase/admin', () => ({ adminDb: {}, adminAuth: {}, remoteConfig: vi.fn() }))

vi.mock('@/src/inventory/search', () => ({
  searchProjects: mocks.mockSearchProjects,
  queryInventory: mocks.mockQueryInventory,
  getProjectDetail: vi.fn(),
  // The real value — the projection under test consumes it.
  MAX_MATCHES: 8,
}))

vi.mock('@/src/firebase/collections', () => ({
  collateralRef: vi.fn(() => ({ where: vi.fn(() => ({ get: mocks.mockCollateralGet })) })),
  projectsRef: vi.fn(),
  TENANT_ID: 'd2',
}))

import { makeSearchProjectsTool, type FinderRowSink } from './tools'
import { FinderRowSchema } from './schema'

const MAX_MATCHES = 8
const ROW_COUNT = 60

/** A ProjectMatch with the full server-side shape, including the fields FinderRow drops. */
function makeMatch(i: number): ProjectMatch {
  return {
    projectId: `proj-${i}`,
    name: `Project ${i}`,
    priceBand: i % 3 === 0 ? 'under_500k' : '800k_1.2m',
    // Every third project is unpriced — priceValue 0 means UNKNOWN (D2).
    priceValue: i % 3 === 0 ? 0 : 600_000 + i * 1_000,
    tenure: 'Freehold',
    vpStatus: i % 2 === 0,
    bumiQuota: false,
    foreignEligible: true,
    bedrooms: i % 4,
    locationText: `Area ${i}, Kuala Lumpur — near an LRT station`,
    sizeMinSqft: 600 + i,
    sizeMaxSqft: 1_200 + i,
    score: 0.9 - i * 0.001,
    matchedCriteria: {
      segment: 'unknown',
      priceMax: i % 3 === 0 ? null : 1_000_000,
      nationality: 'unknown',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
    },
  }
}

const BIG_RESULT: SearchResult = {
  found: true,
  matches: Array.from({ length: ROW_COUNT }, (_, i) => makeMatch(i)),
}

const INPUT = {
  segment: 'unknown' as const,
  priceMin: null,
  priceMax: 1_000_000,
  monthlyIncome: null,
  financingNote: null,
  nationality: 'unknown' as const,
  bumiputera: null,
  locationPref: 'Klang Valley',
  tenurePref: null,
  bedrooms: null,
  freeText: 'show me a list of 1mil property within Klang Valley',
}

async function runTool(result: SearchResult, sink?: FinderRowSink) {
  mocks.mockSearchProjects.mockResolvedValue(result)
  const t = makeSearchProjectsTool('en', sink)
  const execute = t.execute as NonNullable<typeof t.execute>
  const output = await execute(INPUT, {} as never)
  return { tool: t, output }
}

describe('searchProjects tool: the client gets every row', () => {
  beforeEach(() => {
    mocks.mockSearchProjects.mockReset()
    mocks.mockCollateralGet.mockReset()
    mocks.mockCollateralGet.mockResolvedValue({ empty: true, docs: [] })
  })

  it('execute returns all 60 matches', async () => {
    const { output } = await runTool(BIG_RESULT)
    expect(output).toMatchObject({ found: true })
    expect((output as { matches: unknown[] }).matches.length).toBe(ROW_COUNT)
  })

  it('the sink holds all 60 rows', async () => {
    const sink: FinderRowSink = { rows: [] }
    await runTool(BIG_RESULT, sink)
    expect(sink.rows.length).toBe(ROW_COUNT)
    expect(sink.rows[0].projectId).toBe('proj-0')
    expect(sink.rows[ROW_COUNT - 1].projectId).toBe(`proj-${ROW_COUNT - 1}`)
  })

  it('sink rows preserve the server ranking and validate against FinderRowSchema', async () => {
    const sink: FinderRowSink = { rows: [] }
    await runTool(BIG_RESULT, sink)
    expect(sink.rows.map((r) => r.projectId)).toEqual(
      BIG_RESULT.found ? BIG_RESULT.matches.map((m) => m.projectId) : [],
    )
    for (const row of sink.rows) {
      expect(FinderRowSchema.safeParse(row).success).toBe(true)
    }
  })

  it('the sink is REPLACED by a second search, not appended to', async () => {
    // The prompt tells the model only the CURRENT search result counts, so a narrowed
    // re-search must not leave the query it replaced stacked underneath it in the table.
    const sink: FinderRowSink = { rows: [] }
    await runTool(BIG_RESULT, sink)
    expect(sink.rows.length).toBe(ROW_COUNT)
    await runTool({ found: true, matches: [makeMatch(999)] }, sink)
    expect(sink.rows.length).toBe(1)
    expect(sink.rows[0].projectId).toBe('proj-999')
  })

  it('a found:false result leaves the sink untouched', async () => {
    const sink: FinderRowSink = { rows: [] }
    await runTool({ found: false, reason: 'no_match' }, sink)
    expect(sink.rows).toEqual([])
  })

  it('a row carries the stored size fields and NOT priceBand/description/embedding', async () => {
    const sink: FinderRowSink = { rows: [] }
    await runTool(BIG_RESULT, sink)
    const row = sink.rows[1] as Record<string, unknown>
    expect(row.sizeMinSqft).toBe(601)
    expect(row.sizeMaxSqft).toBe(1_201)
    // THE D2 INVARIANT, closed at the data layer: priceBandFor(0) === 'under_500k', so a
    // band on the wire would let a client render an unpriced project as the cheapest.
    // Asserted on the projection AND on the schema below, because either one alone can be
    // satisfied while the other leaks.
    expect('priceBand' in row).toBe(false)
    expect('description' in row).toBe(false)
    expect('embedding' in row).toBe(false)
  })
})

describe('FinderRowSchema is an allowlist', () => {
  it('has exactly the twelve intended keys — no priceBand', () => {
    const keys = Object.keys(FinderRowSchema.shape).sort()
    expect(keys).toEqual(
      [
        'bedrooms',
        'bumiQuota',
        'foreignEligible',
        'locationText',
        'name',
        'priceValue',
        'projectId',
        'score',
        'sizeMaxSqft',
        'sizeMinSqft',
        'tenure',
        'vpStatus',
      ].sort(),
    )
    // Spelled out separately so the failure message names the actual hazard.
    expect(keys).not.toContain('priceBand')
    expect(keys).not.toContain('description')
    expect(keys).not.toContain('embedding')
  })

  it('strips an unknown key rather than passing it through', () => {
    const parsed = FinderRowSchema.parse({
      projectId: 'p1',
      name: 'N',
      priceValue: 0,
      bedrooms: 0,
      tenure: 'Freehold',
      locationText: 'KL',
      vpStatus: false,
      bumiQuota: false,
      foreignEligible: true,
      score: 0.5,
      priceBand: 'under_500k',
      description: 'x'.repeat(2_553),
    })
    expect('priceBand' in parsed).toBe(false)
    expect('description' in parsed).toBe(false)
    // Size defaults to null, so a pre-backfill project decodes.
    expect(parsed.sizeMinSqft).toBeNull()
    expect(parsed.sizeMaxSqft).toBeNull()
  })
})

describe('searchProjects tool: the MODEL gets a bounded view', () => {
  beforeEach(() => {
    mocks.mockSearchProjects.mockReset()
    mocks.mockCollateralGet.mockReset()
    mocks.mockCollateralGet.mockResolvedValue({ empty: true, docs: [] })
  })

  it('toModelOutput caps a 60-row result at MAX_MATCHES', async () => {
    const { tool: t, output } = await runTool(BIG_RESULT)
    const toModelOutput = t.toModelOutput as NonNullable<typeof t.toModelOutput>
    const view = toModelOutput(output as never) as { type: string; value: { matches: unknown[] } }
    expect(view.type).toBe('json')
    expect(view.value.matches.length).toBe(MAX_MATCHES)
  })

  it("the model's serialized view of a 60-row result is under 8,000 characters", async () => {
    // The token-budget guard. Uncapped this same result serializes to many times that.
    const { tool: t, output } = await runTool(BIG_RESULT)
    const toModelOutput = t.toModelOutput as NonNullable<typeof t.toModelOutput>
    const serialized = JSON.stringify(toModelOutput(output as never))
    expect(serialized.length).toBeLessThan(8_000)
    // And prove the assertion is not vacuous: the FULL result really is much bigger.
    expect(JSON.stringify(output).length).toBeGreaterThan(8_000)
  })

  it("the model's view carries no embedding and no description", async () => {
    const { tool: t, output } = await runTool(BIG_RESULT)
    const toModelOutput = t.toModelOutput as NonNullable<typeof t.toModelOutput>
    const serialized = JSON.stringify(toModelOutput(output as never))
    expect(serialized).not.toContain('embedding')
    expect(serialized).not.toContain('description')
  })

  it('a found:false result passes through toModelOutput untouched', async () => {
    // The refusal signal IS the payload — projecting it would drop the reason the model
    // needs in order to explain the gate instead of inventing a match.
    const refusal: SearchResult = { found: false, reason: 'ineligible', why: 'financing' }
    const { tool: t, output } = await runTool(refusal)
    const toModelOutput = t.toModelOutput as NonNullable<typeof t.toModelOutput>
    expect(toModelOutput(output as never)).toEqual({ type: 'json', value: refusal })
  })
})

// ─── queryInventory: the 1024-float embedding never reaches the model ─────────
//
// quick-kayinleong-088. `queryInventory` returned the raw `ProjectDoc` — including the
// 1024-float `embedding` and the full ~2,150-char `description` — for EVERY active
// project, with no cap of any kind, and the result is re-sent on every step of the
// stepCountIs(5) loop. `searchProjects` was capped for exactly this reason in quick-050
// and again in quick-085; this path was simply missed.
//
// MEASURED LIVE against 83 active projects, one call:
//   full rows                  2,067,567 chars  ≈ 558,800 tokens
//   embedding stripped           254,375 chars  ≈  68,750 tokens  (-87.7%)
//   + description capped @300     59,469 chars  ≈  16,073 tokens  (-97.1%)
// Per project: embedding 21,857 chars, description 2,150, everything else 416 — the
// vector was 98% of the payload, and nothing could use it. TOKEN_CAP is 300,000 per
// agent per 24h, so ONE broad call could exceed a full day's budget nearly ten times.
//
// These tests reproduce the OLD payload from the same fixtures before asserting the new
// one, so the reduction is demonstrated rather than claimed.

describe('queryInventory strips the embedding (quick-kayinleong-088)', () => {
  const EMBED_DIM = 1024
  const DESCRIPTION_CHARS = 2_150 // the live per-project average

  /** A project as Firestore actually returns it — vector, write-up and all. */
  function makeProjectDoc(i: number) {
    return {
      projectId: `proj-${i}`,
      tenantId: 'd2' as const,
      name: `Project ${i}`,
      status: 'active' as const,
      priceBand: '800k_1.2m' as const,
      priceValue: 900_000,
      tenure: 'Freehold',
      vpStatus: false,
      vpDate: null,
      bumiQuota: false,
      foreignEligible: true,
      description: `Quick Facts for project ${i}. `.padEnd(DESCRIPTION_CHARS, 'x'),
      locationText: 'Kuala Lumpur',
      bedrooms: 2,
      embedding: Array.from({ length: EMBED_DIM }, (_, d) => (d + i) / 3_301),
    }
  }

  const LIVE_PROJECT_COUNT = 83
  const DOCS = Array.from({ length: LIVE_PROJECT_COUNT }, (_, i) => makeProjectDoc(i))

  it('the OLD payload really was enormous — the baseline is not hypothetical', () => {
    const before = JSON.stringify(DOCS).length
    // Same order of magnitude as the live measurement (2,067,567 chars over 83 projects).
    expect(before).toBeGreaterThan(1_500_000)
    // And it is the vector, not the prose: ~22k chars of embedding per project.
    expect(JSON.stringify(DOCS[0].embedding).length).toBeGreaterThan(15_000)
  })

  it('projecting the rows cuts the payload by more than 95%', async () => {
    const { toInventoryRows } = await import('./tools')
    const before = JSON.stringify(DOCS).length
    const after = JSON.stringify(toInventoryRows(DOCS)).length

    expect(after).toBeLessThan(before * 0.05)
    // Absolute guard too, so a future fixture change cannot make the ratio pass trivially.
    expect(after).toBeLessThan(80_000)
  })

  it('no row carries an embedding, by key or by content', async () => {
    const { toInventoryRows } = await import('./tools')
    const rows = toInventoryRows(DOCS)
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('embedding')
    for (const row of rows) {
      expect('embedding' in row).toBe(false)
    }
    // Prove the assertion is not vacuous: the input rows DO carry one.
    expect(JSON.stringify(DOCS)).toContain('embedding')
  })

  it('the write-up is excerpted, with a flag telling the model to look further', async () => {
    const { toInventoryRows, INVENTORY_DESCRIPTION_CHARS } = await import('./tools')
    const rows = toInventoryRows(DOCS)
    expect(rows[0].descriptionExcerpt.length).toBe(INVENTORY_DESCRIPTION_CHARS)
    expect(rows[0].descriptionExcerpt).toBe(
      DOCS[0].description.slice(0, INVENTORY_DESCRIPTION_CHARS),
    )
    // The flag is what stops the excerpt from reading as the whole record — projectDetail
    // is the path that carries the full write-up.
    expect(rows[0].descriptionTruncated).toBe(true)
    expect('description' in rows[0]).toBe(false)
  })

  it('a short write-up is not flagged as truncated', async () => {
    const { toInventoryRows } = await import('./tools')
    const rows = toInventoryRows([{ ...makeProjectDoc(0), description: 'Short.' }])
    expect(rows[0].descriptionExcerpt).toBe('Short.')
    expect(rows[0].descriptionTruncated).toBe(false)
  })

  it('the scalar fields the tool exists to answer with all survive', async () => {
    const { toInventoryRows } = await import('./tools')
    const row = toInventoryRows(DOCS)[0]
    // FIND-07 is "which projects completed VP this year" — dropping vpStatus/vpDate or
    // the identity fields to save tokens would break the tool instead of bounding it.
    expect(row).toMatchObject({
      projectId: 'proj-0',
      name: 'Project 0',
      status: 'active',
      priceValue: 900_000,
      vpStatus: false,
      tenure: 'Freehold',
      locationText: 'Kuala Lumpur',
      bedrooms: 2,
    })
  })

  it('the tool execute returns the projected rows, not the raw docs', async () => {
    // The wiring assertion: a correct projection that execute never calls is worthless.
    const { makeQueryInventoryTool } = await import('./tools')
    mocks.mockQueryInventory.mockResolvedValue(DOCS)
    const t = makeQueryInventoryTool('en')
    const execute = t.execute as NonNullable<typeof t.execute>
    const out = await execute({}, {} as never)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('embedding')
    expect(serialized.length).toBeLessThan(80_000)
    expect((out as Array<{ descriptionTruncated: boolean }>)[0].descriptionTruncated).toBe(true)
  })
})
