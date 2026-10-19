/**
 * client-workbook.test.ts — the TS core of the client project info sheet ingest
 * (quick-kayinleong-096, task T1).
 *
 * Pure tests: inline fixtures only, no Firestore, no network. The stored lists in the
 * Southpoint / Rafflesia / DC / Imperial / Puncak fixtures are copied from the
 * 2026-09-18 snapshot (labels, sizes, bedrooms and prices only: no PII).
 *
 * Run: npx vitest run src/inventory/client-workbook.test.ts
 */

import { describe, it, expect, vi } from 'vitest'

// Importing `priceBandFor` loads collections.ts, which loads the admin SDK.
// Same precedent as tests/finder-corpus-gates.test.ts.
vi.mock('@/src/firebase/admin', () => ({ adminDb: {} }))

import type { UnitTypeEntry } from '@/src/firebase/collections'
import {
  ClientSheetError,
  type ClientSheet,
  DELETE_FIELD,
  HOLD_GROUPS,
  PARTIAL_LABEL_PREFIX,
  isGroupedLabel,
  labelKey,
  mergeUnits,
  parseClientSheet,
  planProjectPatch,
  type ProjectPlan,
  type SheetProject,
  type SheetUnit,
} from '@/src/inventory/client-workbook'
import {
  CLIENT_FACTSHEET_ACTOR,
  CLIENT_WORKBOOK_ACTOR,
  CLIENT_WORKBOOK_SOURCE,
  LIVE_PROJECT_ID,
  assertSafeTarget,
  isClientWorkbookField,
  scanForContactDetails,
} from '@/src/inventory/client-workbook-safety'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const IMPORTED_AT = new Date('2026-10-19T00:00:00.000Z')

function unit(o: Partial<SheetUnit> & { label: string }): SheetUnit {
  return {
    sheetRow: 2,
    sizeSqft: null,
    bedrooms: null,
    nettMinRM: null,
    nettMaxRM: null,
    grossMinRM: null,
    grossMaxRM: null,
    psfRM: null,
    soldOut: false,
    raw: o.label,
    held: [],
    ...o,
  }
}

function project(o: Partial<SheetProject> & { units?: SheetUnit[] }): SheetProject {
  const units = o.units ?? []
  return {
    docId: 'DOC1',
    inventoryName: 'Test Project',
    sheetName: 'Test Project',
    sheetRow: 2,
    unitMode: units.length > 0 ? 'merge' : 'none',
    labelPrefix: '',
    tenure: null,
    completion: null,
    area: null,
    facts: {
      area: null,
      developer: null,
      landTitle: null,
      maintenanceFee: null,
      tenure: null,
      totalUnits: null,
      floors: null,
      completion: null,
      topReasons: null,
      furnishing: null,
      carPark: null,
    },
    focusLists: [],
    factSheet: null,
    ...o,
    units,
  }
}

function stored(
  label: string,
  sizeSqft: number | null,
  bedrooms: number | null,
  price: number | null,
  raw?: string,
): UnitTypeEntry {
  return {
    label,
    sizeSqft,
    bedrooms,
    priceMinRM: price,
    priceMaxRM: price,
    raw: raw ?? `${label} (stored)`,
  }
}

/** What the runner would leave in Firestore after applying a plan. */
function applyPlan(existing: Record<string, unknown>, plan: ProjectPlan): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing }
  for (const [k, v] of Object.entries(plan.patch)) {
    if (v === DELETE_FIELD) delete out[k]
    else out[k] = v
  }
  return out
}

function plan(
  existing: Record<string, unknown>,
  sheet: SheetProject,
  holds: string[] = [],
): ProjectPlan {
  return planProjectPatch({ docId: sheet.docId, existing, sheet, holds, importedAt: IMPORTED_AT })
}

function codes(p: ProjectPlan): string[] {
  return p.warnings.map((w) => w.code)
}

function pricedCount(list: UnitTypeEntry[]): number {
  return list.filter((e) => e.priceMinRM !== null).length
}

// ─── The sheet fixtures (modelled on the real sheet values) ───────────────────

/** ViiA-like: no stored list, five sheet units with nett and psf. */
const VIIA_UNITS: SheetUnit[] = [
  unit({
    label: 'Type A',
    sizeSqft: 570,
    bedrooms: 1,
    nettMinRM: 862_000,
    nettMaxRM: 905_000,
    psfRM: 1350,
    raw: 'Type A: 570 sf | 1 Bedroom | Nett: RM862k-RM905k | Gross: 1350psf',
  }),
  unit({
    label: 'Type B',
    sizeSqft: 721,
    bedrooms: 2,
    nettMinRM: 950_000,
    nettMaxRM: 990_000,
    raw: 'Type B: 721sft | 2 Bedrooms | Nett: 950k-990k',
  }),
]

/** DC Residensi-like: 18 sheet units, 4 available and 14 sold out. */
function dcSheetUnits(): SheetUnit[] {
  const out: SheetUnit[] = [
    unit({
      label: 'Type S1',
      sizeSqft: 904,
      bedrooms: 1,
      nettMinRM: 1_200_000,
      nettMaxRM: 1_350_000,
      grossMinRM: 1_750_000,
      grossMaxRM: 1_800_000,
      raw: 'Type S1: 904 Sqft | 84 Sqm | 1 Bedroom | Nett: RM1.2mil-RM1.35mil | Gross: RM1.75mil-RM1.8mil',
    }),
    unit({
      label: 'Type S2',
      sizeSqft: 1100,
      bedrooms: 1,
      nettMinRM: 1_350_000,
      nettMaxRM: 1_500_000,
      raw: 'Type S2: 1,100 Sqft | 1 Bedroom + 1 | Nett: RM1.35mil-RM1.5mil',
    }),
    unit({
      label: 'Type A3',
      sizeSqft: 1600,
      bedrooms: 2,
      nettMinRM: 1_800_000,
      nettMaxRM: 1_950_000,
      raw: 'Type A3: 1,600 Sqft | 2 Bedrooms | Nett: RM1.8mil-RM1.95mil',
    }),
    unit({
      label: 'Type E2',
      sizeSqft: 2982,
      bedrooms: 3,
      raw: 'Type E2: 2982 Sqft | 277 Sqm | 3 Bedrooms',
    }),
  ]
  for (let i = 0; i < 14; i++) {
    out.push(
      unit({
        label: `Type X${i + 1}`,
        // One sold-out unit far below and the rest far above the available range, so a
        // size range that wrongly includes them cannot equal 904-2982.
        sizeSqft: i === 0 ? 500 : 4000,
        bedrooms: 4,
        soldOut: true,
        raw: `Type X${i + 1}: Sold out`,
      }),
    )
  }
  return out
}

const DC_STORED: UnitTypeEntry[] = [
  stored('1 Bedroom', 904, 1, null),
  stored('1+1 Bedrooms', 1100, 1, null),
  stored('2+1 Bedrooms', 1600, 2, null),
  stored('3+1 Bedrooms', 2700, 3, null),
]

function dcExisting(): Record<string, unknown> {
  return {
    name: 'Damansara City Residency (DC Residensi)',
    status: 'active',
    priceValue: 0,
    priceBand: 'price_unknown',
    tenure: 'Freehold',
    bedrooms: 2,
    locationText: 'Damansara Heights, Kuala Lumpur',
    unitTypes: DC_STORED,
  }
}

function dcSheet(): SheetProject {
  return project({
    docId: 'DC1',
    inventoryName: 'Damansara City Residency (DC Residensi)',
    units: dcSheetUnits(),
    area: 'Damansara Height',
  })
}

const IMPERIAL_STORED: UnitTypeEntry[] = [
  stored('Type H1 (North Wing)', 3380, null, null),
  stored('Type H1A (South Wing)', 3380, null, null),
  stored('Type H2 (North Wing)', 4090, null, null),
  stored('Type IR1 (Penthouse)', 7459, null, null),
]

function imperialSheet(): SheetProject {
  return project({
    docId: 'IMP1',
    inventoryName: 'PDH: Imperial Residences RA',
    units: [
      unit({ label: 'H1', sizeSqft: 3380, bedrooms: 4, nettMinRM: 5_050_000, nettMaxRM: 5_300_000 }),
      unit({ label: 'H1a', sizeSqft: 3380, bedrooms: 4, held: ['Nett'] }),
      unit({ label: 'H2', sizeSqft: 4090, bedrooms: 5, held: ['Nett', 'Gross'] }),
      unit({ label: 'H2a', sizeSqft: 4090, bedrooms: 5, nettMinRM: 7_000_000, nettMaxRM: 7_200_000 }),
      unit({ label: 'IR1', sizeSqft: 7459, bedrooms: 5, nettMinRM: 12_000_000, nettMaxRM: 13_000_000 }),
    ],
  })
}

const SOUTHPOINT_STORED: UnitTypeEntry[] = [
  stored('Type C', 1119, 2, 1_740_000),
  stored('Type D', 1636, 3, 2_380_000),
  stored('Type E', 2282, 3, 3_210_000),
  stored('Type E1', 2303, 3, 3_260_000),
  stored('Type A3 & B3', 2347, 3, 3_490_000),
  stored('Type A2', 2809, 3, 4_270_000),
  stored('Type B2', 3477, 5, 5_260_000),
  stored('Type A1', 5210, 5, null),
  stored('Type B1', 5877, 5, null),
]

function southpointExisting(): Record<string, unknown> {
  return {
    name: 'Southpoint Residences (IGB )',
    status: 'active',
    priceValue: 1_740_000,
    priceBand: 'above_1.2m',
    tenure: 'Freehold',
    bedrooms: 2,
    sizeMinSqft: 1119,
    sizeMaxSqft: 5877,
    locationText: 'Mid Valley, Kuala Lumpur',
    unitTypes: SOUTHPOINT_STORED,
  }
}

function southpointSheet(): SheetProject {
  const u = (label: string, size: number, beds: number) =>
    unit({ label, sizeSqft: size, bedrooms: beds, raw: `${label}: ${size} Sqft | ${beds} Bedrooms` })
  return project({
    docId: 'SP1',
    inventoryName: 'Southpoint Residences (IGB )',
    units: [
      u('Type C', 1119, 2),
      u('Type D', 1636, 3),
      u('Type E', 2282, 3),
      u('Type E1', 2303, 3),
      u('Type A3', 2347, 3),
      u('Type B3', 3200, 4),
      u('Type A2', 2809, 3),
      u('Type B2', 3477, 5),
      u('Type A1', 5210, 5),
      u('Type B1', 5877, 5),
    ],
  })
}

const RAFFLESIA_STORED: UnitTypeEntry[] = [
  stored('Type A & A1', 3655, null, null),
  stored('Type B & B1', 3879, null, null),
  stored('Type C & C1', 3655, null, null),
  stored('Type D & D1', 3655, null, null),
  stored('Type E & E1', 3879, null, null),
  stored('Type E & E1', 3964, null, null),
  stored('Type F & F1', 3950, null, null),
  stored('Type G & G1', 3877, null, null),
  stored('Type H & H1', 3877, null, null),
]

function raffleExisting(): Record<string, unknown> {
  return {
    name: 'Rafflesia @ Hill 2, 3 & 4',
    status: 'active',
    priceValue: 2_900_000,
    priceBand: 'above_1.2m',
    priceProvenance: 'stated',
    tenure: 'Freehold',
    bedrooms: 5,
    sizeMinSqft: null,
    sizeMaxSqft: null,
    locationText: 'Hill 4, Kuala Lumpur',
    unitTypes: RAFFLESIA_STORED,
  }
}

function raffleSheet(): SheetProject {
  return project({
    docId: 'RAF1',
    inventoryName: 'Rafflesia @ Hill 2, 3 & 4',
    unitMode: 'partial',
    labelPrefix: PARTIAL_LABEL_PREFIX,
    units: [
      unit({
        label: 'Type E & E1',
        sizeSqft: 3964,
        bedrooms: 5,
        nettMinRM: 3_717_000,
        nettMaxRM: 3_783_000,
        psfRM: 988,
        raw: 'Type E & E1 - 3,964sf | 5 Bedrooms | Nett: Rm3.717mil-Rm3.783mil | Gross: 988psf',
      }),
      unit({
        label: 'Type G & G1',
        sizeSqft: 3877,
        bedrooms: 5,
        nettMinRM: 3_901_000,
        nettMaxRM: 4_217_000,
        psfRM: 1006,
        raw: 'Type G & G1 - 3,877sf | 5 Bedrooms | Nett: Rm3.901mil-Rm4.217mil | Gross: 1006psf',
      }),
    ],
  })
}

// ─── labelKey / isGroupedLabel ────────────────────────────────────────────────

describe('labelKey (U1)', () => {
  it.each([
    ['Type H1 (North Wing)', '', 'h1'],
    ['H1a', '', 'h1a'],
    ['Type H1A (South Wing)', '', 'h1a'],
    ['Type M1-A', '', 'm1 a'],
    ['Type A3 & B3', '', 'a3 b3'],
    ['Hill 4 · Type E & E1', PARTIAL_LABEL_PREFIX, 'e e1'],
    ['J3', '', 'j3'],
    ['Type J3', '', 'j3'],
    ['1+1 Bedrooms', '', '1 1 bedrooms'],
  ])('%j with prefix %j gives %j', (label, prefix, expected) => {
    expect(labelKey(label, prefix)).toBe(expected)
  })

  it('removes only ONE trailing parenthetical', () => {
    expect(labelKey('Type H1 (A) (B)', '')).toBe('h1 a')
  })
})

describe('isGroupedLabel (U5)', () => {
  it.each(['1 Bedroom', '1+1 Bedrooms', '2+1 Rooms', '5+1 bedrooms', 'Penthouses', 'Studio'])(
    '%j is grouped',
    (label) => {
      expect(isGroupedLabel(label, '')).toBe(true)
    },
  )
  it.each(['Type A3 & B3', 'J3', 'Type H1 (North Wing)', 'Type IR1 (Penthouse)', 'H1a'])(
    '%j is not grouped',
    (label) => {
      expect(isGroupedLabel(label, '')).toBe(false)
    },
  )
  it('removes the prefix first', () => {
    expect(isGroupedLabel('Hill 4 · Type E & E1', PARTIAL_LABEL_PREFIX)).toBe(false)
    expect(isGroupedLabel('Hill 4 · Penthouses', PARTIAL_LABEL_PREFIX)).toBe(true)
  })
})

// ─── No stored list (ViiA-like) ───────────────────────────────────────────────

describe('no stored list', () => {
  const existing = { priceValue: 846_000, priceBand: 'under_500k', locationText: 'KL', tenure: 'Freehold' }
  const p = plan(existing, project({ docId: 'VIIA', units: VIIA_UNITS }))

  it('writes the sheet entries in sheet order with nett in priceMin/Max and raw verbatim', () => {
    const list = p.patch.unitTypes as UnitTypeEntry[]
    expect(list.map((e) => e.label)).toEqual(['Type A', 'Type B'])
    expect(list[0]).toEqual({
      label: 'Type A',
      sizeSqft: 570,
      bedrooms: 1,
      priceMinRM: 862_000,
      priceMaxRM: 905_000,
      raw: VIIA_UNITS[0].raw,
    })
    // Available units carry no soldOut key at all (Firestore rejects undefined).
    expect(Object.prototype.hasOwnProperty.call(list[0], 'soldOut')).toBe(false)
  })

  it('takes priceValue from the lowest sheet nett, as stated / client-workbook', () => {
    expect(p.patch.priceValue).toBe(862_000)
    expect(p.patch.priceBand).toBe('800k_1.2m')
    expect(p.patch.priceProvenance).toBe('stated')
    expect(p.patch.priceSource).toBe(CLIENT_WORKBOOK_SOURCE)
  })

  it('plans psf from the sheet units and never multiplies it into a price', () => {
    expect(p.patch.pricePsfMin).toBe(1350)
    expect(p.patch.pricePsfMax).toBe(1350)
    expect(p.patch.priceValue).toBe(862_000)
  })
})

// ─── Southpoint (the blank-never-clears proof) ────────────────────────────────

describe('Southpoint fixture: a blank sheet cell never clears a stored unit price', () => {
  const existing = southpointExisting()
  const p = plan(existing, southpointSheet())
  const list = p.patch.unitTypes as UnitTypeEntry[]

  it('goes from 9 entries to 11', () => {
    expect(SOUTHPOINT_STORED).toHaveLength(9)
    expect(list).toHaveLength(11)
  })

  it('has 7 priced entries before and after', () => {
    expect(pricedCount(SOUTHPOINT_STORED)).toBe(7)
    expect(pricedCount(list)).toBe(7)
  })

  it('merges C, D, E, E1, A2, B2, A1, B1 in place and keeps stored prices', () => {
    const byLabel = new Map(list.map((e) => [e.label, e]))
    for (const [label, price] of [
      ['Type C', 1_740_000],
      ['Type D', 2_380_000],
      ['Type E', 3_210_000],
      ['Type E1', 3_260_000],
      ['Type A2', 4_270_000],
      ['Type B2', 5_260_000],
    ] as const) {
      const e = byLabel.get(label)!
      expect(e.priceMinRM).toBe(price)
      expect(e.priceMaxRM).toBe(price)
      expect(e.raw.endsWith(' | kept from previous record: price')).toBe(true)
    }
    // A1 / B1 had no stored price, so nothing was kept and raw is the sheet line.
    expect(byLabel.get('Type A1')!.raw).toBe('Type A1: 5210 Sqft | 5 Bedrooms')
    expect(byLabel.get('Type A1')!.priceMinRM).toBeNull()
    // Sheet size and bedrooms are written.
    expect(byLabel.get('Type D')!.sizeSqft).toBe(1636)
    expect(byLabel.get('Type D')!.bedrooms).toBe(3)
  })

  it('leaves "Type A3 & B3" untouched and appends A3 and B3 unpriced', () => {
    expect(list[4]).toEqual(SOUTHPOINT_STORED[4])
    expect(list.slice(9).map((e) => e.label)).toEqual(['Type A3', 'Type B3'])
    expect(list[9].priceMinRM).toBeNull()
    expect(list[10].priceMinRM).toBeNull()
  })

  it('plans no price, size or bedrooms keys, so the from-price stays 1,740,000', () => {
    for (const k of ['priceValue', 'priceBand', 'priceProvenance', 'priceSource', 'sizeMinSqft', 'sizeMaxSqft', 'bedrooms']) {
      expect(p.patch).not.toHaveProperty(k)
    }
    expect(p.reembed).toBe(false)
  })

  it('warns about every kept stored value', () => {
    expect(codes(p).filter((c) => c === 'kept-from-previous')).toHaveLength(6)
  })

  it('is idempotent against the post-apply doc', () => {
    const again = plan(applyPlan(existing, p), southpointSheet())
    expect(again.changes).toEqual([])
    expect(again.patch).toEqual({})
  })
})

// ─── Rafflesia (partial coverage) ─────────────────────────────────────────────

describe('Rafflesia fixture: partial coverage keeps every stored entry and the stored from-price', () => {
  const existing = raffleExisting()
  const p = plan(existing, raffleSheet())
  const list = p.patch.unitTypes as UnitTypeEntry[]

  it('keeps 9 entries and relabels the two matched ones', () => {
    expect(list).toHaveLength(9)
    const relabelled = list.filter((e) => e.label.startsWith(PARTIAL_LABEL_PREFIX)).map((e) => e.label)
    expect(relabelled).toEqual(['Hill 4 · Type E & E1', 'Hill 4 · Type G & G1'])
  })

  it('matches the E & E1 unit to the 3,964 sqft entry by size (U2 tie-break)', () => {
    expect(list[4]).toEqual(RAFFLESIA_STORED[4]) // the 3,879 entry is untouched
    expect(list[5].label).toBe('Hill 4 · Type E & E1')
    expect(list[5].sizeSqft).toBe(3964)
    expect(list[5].bedrooms).toBe(5)
    expect(list[5].priceMinRM).toBe(3_717_000)
    expect(list[5].priceMaxRM).toBe(3_783_000)
    expect(list[5].raw).toBe(raffleSheet().units[0].raw)
  })

  it('gives Type G & G1 its sheet nett and keeps the other 7 entries unchanged', () => {
    expect(list[7].label).toBe('Hill 4 · Type G & G1')
    expect(list[7].priceMinRM).toBe(3_901_000)
    expect(list[7].priceMaxRM).toBe(4_217_000)
    const unchanged = [0, 1, 2, 3, 4, 6, 8]
    for (const i of unchanged) expect(list[i]).toEqual(RAFFLESIA_STORED[i])
  })

  it('keeps priceValue at 2,900,000 with a partial-coverage warning and no price keys', () => {
    expect(p.patch).not.toHaveProperty('priceValue')
    expect(p.patch).not.toHaveProperty('priceBand')
    expect(p.patch).not.toHaveProperty('priceSource')
    expect(codes(p)).toContain('partial-coverage-price-kept')
  })

  it('plans sizes 3655/3964 and psf 988-1006, and leaves bedrooms at 5', () => {
    expect(p.patch.sizeMinSqft).toBe(3655)
    expect(p.patch.sizeMaxSqft).toBe(3964)
    expect(p.patch.pricePsfMin).toBe(988)
    expect(p.patch.pricePsfMax).toBe(1006)
    expect(p.patch).not.toHaveProperty('bedrooms')
    // The stored price survives, so the provenance is not rewritten to psf_only.
    expect(p.patch).not.toHaveProperty('priceProvenance')
  })

  it('planning again against the merged doc gives zero changes', () => {
    const again = plan(applyPlan(existing, p), raffleSheet())
    expect(again.changes).toEqual([])
    expect(codes(again)).toContain('partial-coverage-price-kept')
  })

  it('never drops a stored grouped entry in partial mode', () => {
    const m = mergeUnits({
      stored: [...RAFFLESIA_STORED, stored('Penthouses', null, null, null)],
      sheetUnits: raffleSheet().units,
      unitMode: 'partial',
      labelPrefix: PARTIAL_LABEL_PREFIX,
    })
    expect(m.dropped).toEqual([])
    expect(m.final).toHaveLength(10)
  })
})

// ─── DC, Imperial, Puncak ─────────────────────────────────────────────────────

describe('DC Residensi fixture: grouped stored entries are dropped, and holdable', () => {
  const existing = dcExisting()

  it('drops the 4 grouped entries with 4 unit-dropped warnings', () => {
    const p = plan(existing, dcSheet())
    const list = p.patch.unitTypes as UnitTypeEntry[]
    expect(list).toHaveLength(18)
    expect(list.map((e) => e.label)).not.toContain('1 Bedroom')
    expect(codes(p).filter((c) => c === 'unit-dropped')).toHaveLength(4)
  })

  it('excludes sold-out units from the price and the size range', () => {
    const p = plan(existing, dcSheet())
    const list = p.patch.unitTypes as UnitTypeEntry[]
    expect(p.patch.priceValue).toBe(1_200_000)
    expect(p.patch.priceBand).toBe('above_1.2m')
    expect(p.patch.sizeMinSqft).toBe(904)
    expect(p.patch.sizeMaxSqft).toBe(2982)
    expect(p.patch.bedrooms).toBe(1)
    const sold = list.filter((e) => e.soldOut === true)
    expect(sold).toHaveLength(14)
    for (const e of sold) {
      expect(e.priceMinRM).toBeNull()
      expect(e.priceMaxRM).toBeNull()
    }
    expect(list.filter((e) => e.soldOut !== true)).toHaveLength(4)
    expect(p.allUnitsSoldOut).toBe(false)
  })

  it('with the unitDrops hold keeps the grouped entries and recomputes over 22 entries', () => {
    const p = plan(existing, dcSheet(), ['unitDrops'])
    const list = p.patch.unitTypes as UnitTypeEntry[]
    expect(list).toHaveLength(22)
    expect(list.slice(0, 4).map((e) => e.label)).toEqual(DC_STORED.map((e) => e.label))
    expect(codes(p)).not.toContain('unit-dropped')
    expect(codes(p)).toContain('hold-applied')
    expect(p.patch.priceValue).toBe(1_200_000)
    expect(p.patch.sizeMinSqft).toBe(904)
    expect(p.patch.sizeMaxSqft).toBe(2982)
  })

  it('is idempotent against the post-apply doc', () => {
    const p = plan(existing, dcSheet())
    expect(plan(applyPlan(existing, p), dcSheet()).changes).toEqual([])
  })
})

describe('Imperial fixture: qualifier labels match', () => {
  const existing = {
    priceValue: 0,
    priceBand: 'price_unknown',
    bedrooms: 3,
    locationText: 'Pavilion Damansara Heights',
    unitTypes: IMPERIAL_STORED,
  }
  const p = plan(existing, imperialSheet())
  const list = p.patch.unitTypes as UnitTypeEntry[]

  it('matches H1, H1a, H2 and IR1, keeps their stored labels and appends H2a', () => {
    expect(list).toHaveLength(5)
    expect(list.slice(0, 4).map((e) => e.label)).toEqual(IMPERIAL_STORED.map((e) => e.label))
    expect(list[4].label).toBe('H2a')
    expect(codes(p)).not.toContain('unit-dropped')
    expect(list[0].bedrooms).toBe(4)
    expect(list[0].priceMinRM).toBe(5_050_000)
  })

  it('derives price 5,050,000 and bedrooms 4', () => {
    expect(p.patch.priceValue).toBe(5_050_000)
    expect(p.patch.bedrooms).toBe(4)
  })
})

describe('Puncak fixture: a priced grouped entry is dropped and flagged', () => {
  const existing = {
    priceValue: 3_495_000,
    priceBand: 'above_1.2m',
    locationText: 'Wangsa Maju',
    unitTypes: [stored('5+1 bedrooms', 4000, 5, 3_600_000)],
  }
  const sheet = project({
    docId: 'PUN1',
    inventoryName: 'Puncak Wangsamas Phase 2',
    units: [
      unit({ label: 'Type A1', sizeSqft: 1100, bedrooms: 3, nettMinRM: 3_200_000, nettMaxRM: 3_400_000, held: ['Gross'] }),
      unit({ label: 'Type A2', sizeSqft: 1200, bedrooms: 3, nettMinRM: 3_500_000, nettMaxRM: 3_700_000, held: ['Gross'] }),
    ],
  })
  const p = plan(existing, sheet)

  it('drops it with a warning that names the 3,600,000 price', () => {
    const w = p.warnings.find((x) => x.code === 'unit-dropped')
    expect(w).toBeDefined()
    expect(w!.message).toContain('5+1 bedrooms')
    expect(w!.message).toContain('3,600,000')
    expect((p.patch.unitTypes as UnitTypeEntry[]).map((e) => e.label)).toEqual(['Type A1', 'Type A2'])
  })

  it('takes priceValue 3,200,000 from the sheet, not the dropped entry', () => {
    expect(p.patch.priceValue).toBe(3_200_000)
  })
})

// ─── Merge field rules (U3) ───────────────────────────────────────────────────

describe('merge field rules (U3)', () => {
  const merge = (storedList: UnitTypeEntry[], sheetUnits: SheetUnit[]) =>
    mergeUnits({ stored: storedList, sheetUnits, unitMode: 'merge', labelPrefix: '' })

  it('a sheet null keeps the stored value and names it in the raw suffix', () => {
    const m = merge(
      [stored('Type A', 700, 2, 1_000_000)],
      [unit({ label: 'Type A', raw: 'Type A: size not confirmed', held: ['Size'] })],
    )
    expect(m.final[0]).toMatchObject({ sizeSqft: 700, bedrooms: 2, priceMinRM: 1_000_000 })
    expect(m.final[0].raw).toBe('Type A: size not confirmed | kept from previous record: size, bedrooms, price')
    expect(m.warnings.map((w) => w.code)).toEqual(['kept-from-previous'])
  })

  it('the suffix is empty when nothing non-null was kept (and so is idempotent)', () => {
    const m = merge([stored('Type A', null, null, null)], [unit({ label: 'Type A', sizeSqft: 800, raw: 'Type A: 800 Sqft' })])
    expect(m.final[0].raw).toBe('Type A: 800 Sqft')
  })

  it('a sheet sold-out unit nulls a stored price and sets soldOut', () => {
    const m = merge(
      [stored('Type A', 700, 2, 1_000_000)],
      [unit({ label: 'Type A', sizeSqft: 700, bedrooms: 2, soldOut: true, raw: 'Type A: Sold out' })],
    )
    expect(m.final[0].soldOut).toBe(true)
    expect(m.final[0].priceMinRM).toBeNull()
    expect(m.final[0].priceMaxRM).toBeNull()
    expect(m.final[0].raw).toBe('Type A: Sold out')
  })

  it('keeps a stored soldOut flag only when the row states no availability', () => {
    const soldStored: UnitTypeEntry = { ...stored('Type A', 700, 2, null), soldOut: true }
    const quiet = merge([soldStored], [unit({ label: 'Type A', sizeSqft: 700 })])
    expect(quiet.final[0].soldOut).toBe(true)
    expect(quiet.final[0].raw).toContain('kept from previous record: bedrooms, soldOut')
    const priced = merge([soldStored], [unit({ label: 'Type A', sizeSqft: 700, nettMinRM: 900_000, nettMaxRM: 950_000 })])
    expect(Object.prototype.hasOwnProperty.call(priced.final[0], 'soldOut')).toBe(false)
    const held = merge([soldStored], [unit({ label: 'Type A', sizeSqft: 700, held: ['Nett'] })])
    expect(Object.prototype.hasOwnProperty.call(held.final[0], 'soldOut')).toBe(false)
  })

  it('keeps a stored entry that has a type code but is not in the sheet', () => {
    const m = merge([stored('Type Z', 900, 2, null)], [unit({ label: 'Type A', sizeSqft: 700 })])
    expect(m.final.map((e) => e.label)).toEqual(['Type Z', 'Type A'])
    expect(m.keptUnmatched).toEqual(['Type Z'])
    expect(m.dropped).toEqual([])
  })

  it('two stored entries with the same key and no size tie give ambiguous-label-match and the unit is added', () => {
    const m = merge(
      [stored('Type A', 700, 2, null), stored('Type A', 800, 2, null)],
      [unit({ label: 'Type A', sizeSqft: 900 })],
    )
    expect(m.warnings.map((w) => w.code)).toContain('ambiguous-label-match')
    expect(m.final).toHaveLength(3)
    expect(m.added).toEqual(['Type A'])
  })

  it('each stored entry is matched at most once', () => {
    const m = merge([stored('Type A', 700, 2, null)], [unit({ label: 'Type A', sizeSqft: 700 }), unit({ label: 'A', sizeSqft: 710 })])
    expect(m.matched).toHaveLength(1)
    expect(m.added).toHaveLength(1)
  })

  it('never writes an undefined key', () => {
    const m = merge([], [unit({ label: 'Type A', sizeSqft: 700 })])
    expect(Object.values(m.final[0]).every((v) => v !== undefined)).toBe(true)
    expect(Object.keys(m.final[0])).not.toContain('soldOut')
  })
})

// ─── Derived values: all sold out, blanks, price, tenure, completion ─────────

describe('all units sold out', () => {
  const sheet = project({
    docId: 'SOLD1',
    units: [
      unit({ label: 'Type A', sizeSqft: 600, bedrooms: 1, soldOut: true, raw: 'Type A: Sold out' }),
      unit({ label: 'Type B', sizeSqft: 900, bedrooms: 2, soldOut: true, raw: 'Type B: Sold out' }),
    ],
  })
  const p = plan({ priceValue: 0, priceBand: 'price_unknown', status: 'active', locationText: 'KL' }, sheet)

  it('falls back to every unit for sizes and bedrooms, plans no price keys, flags it', () => {
    expect(p.patch.sizeMinSqft).toBe(600)
    expect(p.patch.sizeMaxSqft).toBe(900)
    expect(p.patch.bedrooms).toBe(1)
    for (const k of ['priceValue', 'priceBand', 'priceSource', 'priceProvenance']) expect(p.patch).not.toHaveProperty(k)
    expect(p.allUnitsSoldOut).toBe(true)
    expect(codes(p)).toContain('all-units-sold-out')
  })

  it('never plans a status change', () => {
    expect(p.patch).not.toHaveProperty('status')
    expect(p.changes.map((c) => c.field)).not.toContain('status')
  })
})

describe('a blank never clears', () => {
  it('a project with no units, tenure null and completion null yields no keys', () => {
    const existing = {
      priceValue: 900_000,
      priceBand: '800k_1.2m',
      tenure: 'Freehold',
      vpStatus: true,
      bedrooms: 2,
      sizeMinSqft: 600,
      sizeMaxSqft: 900,
      locationText: 'KL',
      unitTypes: [stored('Type A', 600, 2, 900_000)],
    }
    const p = plan(existing, project({ docId: 'BLANK1' }))
    expect(p.patch).toEqual({})
    expect(p.changes).toEqual([])
    expect(p.asserted).toEqual([])
    expect(p.reembed).toBe(false)
  })

  it('unitMode none ignores any units it was handed', () => {
    const p = plan({ unitTypes: [stored('Type A', 600, 2, 900_000)] }, project({ docId: 'N', unitMode: 'none', units: [] }))
    expect(p.patch).not.toHaveProperty('unitTypes')
  })
})

describe('price provenance (R5, R6)', () => {
  const nett = project({
    docId: 'P1',
    units: [unit({ label: 'Type A', sizeSqft: 700, nettMinRM: 1_200_000, nettMaxRM: 1_300_000 })],
  })

  it('priceBand comes from priceBandFor; stated + client-workbook', () => {
    const p = plan({ priceValue: 0, priceBand: 'price_unknown', locationText: 'KL' }, nett)
    expect(p.patch.priceValue).toBe(1_200_000)
    expect(p.patch.priceBand).toBe('above_1.2m')
    expect(p.patch.priceProvenance).toBe('stated')
    expect(p.patch.priceSource).toBe('client-workbook')
    expect(p.asserted).toEqual(expect.arrayContaining(['priceValue', 'priceBand', 'priceProvenance', 'priceSource']))
  })

  it('plans priceSourceChunkId as DELETE_FIELD only when it exists', () => {
    const withChunk = plan({ priceValue: 0, priceBand: 'price_unknown', priceSource: 'whatsapp-kb', priceSourceChunkId: 'c1' }, nett)
    expect(withChunk.patch.priceSourceChunkId).toBe(DELETE_FIELD)
    const without = plan({ priceValue: 0, priceBand: 'price_unknown' }, nett)
    expect(without.patch).not.toHaveProperty('priceSourceChunkId')
  })

  it('psf-only with an existing priceValue of 0 plans psf_only and no priceSource', () => {
    const psfOnly = project({
      docId: 'P2',
      units: [unit({ label: 'Type A', sizeSqft: 700, psfRM: 1500 })],
    })
    const p = plan({ priceValue: 0, priceBand: 'price_unknown', priceProvenance: 'unknown' }, psfOnly)
    expect(p.patch.pricePsfMin).toBe(1500)
    expect(p.patch.pricePsfMax).toBe(1500)
    expect(p.patch.priceProvenance).toBe('psf_only')
    expect(p.patch).not.toHaveProperty('priceSource')
    expect(p.patch).not.toHaveProperty('priceValue')
  })

  it('psf never counts sold-out units', () => {
    const p = plan(
      { priceValue: 0 },
      project({
        docId: 'P3',
        units: [
          unit({ label: 'Type A', sizeSqft: 700, psfRM: 1500 }),
          unit({ label: 'Type B', sizeSqft: 800, soldOut: true }),
        ],
      }),
    )
    expect(p.patch.pricePsfMax).toBe(1500)
  })

  it('a winning kept stored unit price sets priceValue without priceSource', () => {
    // Entry A already carries a stored 900k price and the sheet states none for it.
    const existing = {
      priceValue: 2_000_000,
      priceBand: 'above_1.2m',
      priceSource: 'whatsapp-kb',
      unitTypes: [stored('Type A', 700, null, 900_000)],
    }
    const q = plan(
      existing,
      project({
        docId: 'P4',
        units: [
          unit({ label: 'Type A', sizeSqft: 700 }),
          unit({ label: 'Type B', sizeSqft: 800, nettMinRM: 1_500_000, nettMaxRM: 1_600_000 }),
        ],
      }),
    )
    expect(q.patch.priceValue).toBe(900_000)
    expect(q.patch.priceProvenance).toBe('stated')
    expect(q.patch).not.toHaveProperty('priceSource')
    expect(codes(q)).toContain('price-from-kept-unit')
  })
})

describe('tenure (R7)', () => {
  const sheet = (tenure: string) => project({ docId: 'T1', tenure })

  it('"Leasehold" against an existing "Leasehold 2116" changes nothing and warns', () => {
    const p = plan({ tenure: 'Leasehold 2116' }, sheet('Leasehold'))
    expect(p.patch).toEqual({})
    expect(codes(p)).toContain('tenure-kept-specific')
  })

  it('"Freehold" against "Unknown" is a change, and it re-embeds', () => {
    const p = plan({ tenure: 'Unknown' }, sheet('Freehold'))
    expect(p.patch.tenure).toBe('Freehold')
    expect(p.reembed).toBe(true)
  })

  it('an equal tenure plans nothing', () => {
    expect(plan({ tenure: 'Freehold' }, sheet('Freehold')).patch).toEqual({})
  })

  it('a more specific sheet tenure replaces a plain one', () => {
    expect(plan({ tenure: 'Leasehold' }, sheet('Leasehold 2116')).patch.tenure).toBe('Leasehold 2116')
  })
})

describe('completion (R8)', () => {
  it('completed_year 2017 gives vpStatus true and vpDate 2017-01-01T00:00:00.000Z', () => {
    const p = plan({ vpStatus: false, vpDate: null }, project({ docId: 'C1', completion: { kind: 'completed_year', year: 2017 } }))
    expect(p.patch.vpStatus).toBe(true)
    expect((p.patch.vpDate as Date).toISOString()).toBe('2017-01-01T00:00:00.000Z')
  })

  it('completed_no_year gives vpStatus only', () => {
    const p = plan({ vpStatus: false }, project({ docId: 'C2', completion: { kind: 'completed_no_year', year: null } }))
    expect(p.patch.vpStatus).toBe(true)
    expect(p.patch).not.toHaveProperty('vpDate')
  })

  it('future_or_expected against vpStatus true plans no vp keys and warns vp-conflict', () => {
    const p = plan({ vpStatus: true }, project({ docId: 'C3', completion: { kind: 'future_or_expected', year: null } }))
    expect(p.patch).toEqual({})
    expect(codes(p)).toContain('vp-conflict')
  })

  it('ambiguous never writes a vp key', () => {
    const p = plan({ vpStatus: false }, project({ docId: 'C4', completion: { kind: 'ambiguous', year: null } }))
    expect(p.patch).toEqual({})
  })

  it('warns vp-conflict when the stored vpDate year differs, and compares a Timestamp-like by ms', () => {
    const ts = { toMillis: () => Date.UTC(2017, 0, 1) }
    const same = plan({ vpStatus: true, vpDate: ts }, project({ docId: 'C5', completion: { kind: 'completed_year', year: 2017 } }))
    // The value is already right, so only the ownership markers are written.
    expect(Object.keys(same.patch).sort()).toEqual(['clientWorkbookFields', 'clientWorkbookImportedAt'])
    expect(same.patch.clientWorkbookFields).toEqual(['vpDate', 'vpStatus'])
    const differs = plan({ vpStatus: true, vpDate: ts }, project({ docId: 'C6', completion: { kind: 'completed_year', year: 2019 } }))
    expect(codes(differs)).toContain('vp-conflict')
    expect((differs.patch.vpDate as Date).getUTCFullYear()).toBe(2019)
  })
})

// ─── Holds, markers, re-embed, area ───────────────────────────────────────────

describe('holds (R9)', () => {
  it('["price","unitTypes"] remove those groups and warn once each', () => {
    const p = plan(dcExisting(), dcSheet(), ['price', 'unitTypes'])
    for (const k of HOLD_GROUPS.price) expect(p.patch).not.toHaveProperty(k)
    expect(p.patch).not.toHaveProperty('unitTypes')
    expect(codes(p).filter((c) => c === 'hold-applied')).toHaveLength(2)
    expect(p.patch.sizeMinSqft).toBe(904) // other groups are untouched
    expect(p.asserted).not.toContain('priceValue')
    expect(p.asserted).not.toContain('unitTypes')
  })

  it('holding psf also drops a psf_only provenance', () => {
    const psfOnly = project({ docId: 'H1', units: [unit({ label: 'Type A', sizeSqft: 700, psfRM: 1500 })] })
    const p = plan({ priceValue: 0 }, psfOnly, ['psf'])
    expect(p.patch).not.toHaveProperty('pricePsfMin')
    expect(p.patch).not.toHaveProperty('priceProvenance')
  })

  it('an unknown group throws', () => {
    expect(() => plan(dcExisting(), dcSheet(), ['nonsense'])).toThrow(/unknown hold group/)
    expect(() => mergeUnits({ stored: [], sheetUnits: [], unitMode: 'merge', labelPrefix: '', holds: ['x'] })).toThrow(
      /unknown hold group/,
    )
  })
})

describe('markers (R11)', () => {
  it('clientWorkbookFields is the sorted union of the stored list and the asserted fields', () => {
    const p = plan(
      { priceValue: 0, clientWorkbookFields: ['vpDate', 'tenure'], locationText: 'KL' },
      project({ docId: 'M1', units: [unit({ label: 'Type A', sizeSqft: 700, nettMinRM: 900_000, nettMaxRM: 950_000 })] }),
    )
    const list = p.patch.clientWorkbookFields as string[]
    expect(list).toEqual([...list].sort())
    expect(list).toEqual(expect.arrayContaining(['vpDate', 'tenure', 'unitTypes', 'priceValue', 'priceSource']))
    expect(p.patch.clientWorkbookImportedAt).toEqual(IMPORTED_AT)
  })

  it('clientWorkbookImportedAt is absent when nothing changes', () => {
    const p = plan({ tenure: 'Freehold' }, project({ docId: 'M2', tenure: 'Freehold' }))
    expect(p.patch).toEqual({})
    expect(p.patch).not.toHaveProperty('clientWorkbookImportedAt')
  })

  it('re-planning against the post-apply doc gives zero changes', () => {
    const sheet = project({
      docId: 'M3',
      tenure: 'Freehold',
      completion: { kind: 'completed_year', year: 2017 },
      units: [unit({ label: 'Type A', sizeSqft: 700, bedrooms: 2, nettMinRM: 900_000, nettMaxRM: 950_000, psfRM: 1300 })],
    })
    const existing = { priceValue: 0, priceBand: 'price_unknown', tenure: 'Unknown', vpStatus: false, vpDate: null, locationText: 'KL' }
    const first = plan(existing, sheet)
    expect(first.changes.length).toBeGreaterThan(0)
    const second = plan(applyPlan(existing, first), sheet)
    expect(second.changes).toEqual([])
    expect(second.patch).toEqual({})
  })
})

describe('reembed (R12) and area (R13)', () => {
  it('is true only when priceValue, tenure or bedrooms change', () => {
    const nettOnly = project({ docId: 'E1', units: [unit({ label: 'Type A', sizeSqft: 700, nettMinRM: 900_000, nettMaxRM: 950_000 })] })
    expect(plan({ priceValue: 0 }, nettOnly).reembed).toBe(true)
    // Same price and no beds: only unitTypes, sizes and psf change.
    expect(plan({ priceValue: 900_000, priceBand: '800k_1.2m', priceProvenance: 'stated', priceSource: 'client-workbook' }, nettOnly).reembed).toBe(false)
    const beds = project({ docId: 'E2', units: [unit({ label: 'Type A', bedrooms: 3 })] })
    expect(plan({ bedrooms: 2 }, beds).reembed).toBe(true)
    expect(plan({ bedrooms: 3 }, beds).reembed).toBe(false)
  })

  it('area-not-in-location fires for "Damansara Height" against a locationText that lacks it', () => {
    const p = plan({ locationText: 'Bangsar, Kuala Lumpur' }, project({ docId: 'A1', area: 'Damansara Height' }))
    expect(codes(p)).toContain('area-not-in-location')
    const w = p.warnings.find((x) => x.code === 'area-not-in-location')!
    expect(w.message).toContain('Damansara Height')
    expect(w.message).not.toContain('Bangsar')
  })

  it('stays quiet when the area is a substring of the location, case-insensitively', () => {
    const p = plan({ locationText: 'Damansara Heights, KL' }, project({ docId: 'A2', area: 'damansara height' }))
    expect(codes(p)).not.toContain('area-not-in-location')
  })

  it('never writes area, name, description or locationText', () => {
    const p = plan(dcExisting(), dcSheet())
    for (const k of ['area', 'name', 'description', 'locationText', 'status']) expect(p.patch).not.toHaveProperty(k)
  })
})

// ─── Env guard, field guard, scanner ──────────────────────────────────────────

describe('assertSafeTarget', () => {
  it('emulator + a demo- project id is the emulator', () => {
    expect(assertSafeTarget({ FIRESTORE_EMULATOR_HOST: 'localhost:8080', FIREBASE_PROJECT_ID: 'demo-test' })).toBe('emulator')
    expect(assertSafeTarget({ FIRESTORE_EMULATOR_HOST: 'localhost:8080', GCLOUD_PROJECT: 'demo-x' })).toBe('emulator')
  })

  it('emulator + the live project id throws', () => {
    expect(() => assertSafeTarget({ FIRESTORE_EMULATOR_HOST: 'localhost:8080', FIREBASE_PROJECT_ID: LIVE_PROJECT_ID })).toThrow(/refusing to run/)
    expect(() => assertSafeTarget({ FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toThrow(/refusing to run/)
  })

  it('the live project id is live', () => {
    expect(assertSafeTarget({ FIREBASE_PROJECT_ID: 'cy-csaiagent' })).toBe('live')
  })

  it('unset or any other id throws with the expected message', () => {
    expect(() => assertSafeTarget({})).toThrow('refusing to run: FIREBASE_PROJECT_ID is "unset"; expected cy-csaiagent or the emulator')
    expect(() => assertSafeTarget({ FIREBASE_PROJECT_ID: 'other-proj' })).toThrow(
      'refusing to run: FIREBASE_PROJECT_ID is "other-proj"; expected cy-csaiagent or the emulator',
    )
    expect(() => assertSafeTarget({ FIRESTORE_EMULATOR_HOST: '', FIREBASE_PROJECT_ID: 'demo-test' })).toThrow(/refusing to run/)
  })

  it('never echoes credential variables', () => {
    try {
      assertSafeTarget({ FIREBASE_PROJECT_ID: 'x', GOOGLE_APPLICATION_CREDENTIALS: '/secret/key.json', FIREBASE_PRIVATE_KEY: 'PRIVATE-KEY-VALUE' })
    } catch (e) {
      expect(String(e)).not.toContain('PRIVATE-KEY-VALUE')
      expect(String(e)).not.toContain('/secret/key.json')
    }
    expect.assertions(2)
  })

  it('exports the actor constants', () => {
    expect(CLIENT_WORKBOOK_ACTOR).toBe('client-workbook-import-096')
    expect(CLIENT_FACTSHEET_ACTOR).toBe('client-factsheets-096')
    expect(CLIENT_WORKBOOK_SOURCE).toBe('client-workbook')
  })
})

describe('isClientWorkbookField', () => {
  it('is true when the field is in clientWorkbookFields', () => {
    expect(isClientWorkbookField({ clientWorkbookFields: ['unitTypes', 'tenure'] }, 'unitTypes')).toBe(true)
    expect(isClientWorkbookField({ clientWorkbookFields: ['unitTypes'] }, 'tenure')).toBe(false)
  })
  it('the price group is also protected by priceSource client-workbook', () => {
    const doc = { priceSource: 'client-workbook' }
    for (const f of ['priceValue', 'priceBand', 'priceProvenance', 'priceSource'] as const) {
      expect(isClientWorkbookField(doc, f)).toBe(true)
    }
    expect(isClientWorkbookField(doc, 'unitTypes')).toBe(false)
    expect(isClientWorkbookField(doc, 'sizeMinSqft')).toBe(false)
  })
  it('an unmarked doc, or a whatsapp-kb price, is not protected', () => {
    expect(isClientWorkbookField({}, 'priceValue')).toBe(false)
    expect(isClientWorkbookField({ priceSource: 'whatsapp-kb' }, 'priceValue')).toBe(false)
    expect(isClientWorkbookField({ clientWorkbookFields: 'priceValue' }, 'priceValue')).toBe(false)
  })
})

describe('scanForContactDetails', () => {
  const HIT = [
    'Call 012-000 0000',
    '+60 12-000 0000',
    'Tel 03-0000 0000',
    '(03) 0000 0000',
    'someone@example.com',
    'https://example.com/brochure',
    'www.example.com',
    'visit example.com.my',
    'wa.me/60120000000',
    '000000-00-0000',
  ]
  const MISS = [
    'RM1,243,856–RM1,784,150',
    'Type A1 BU 3899sqft  LA 4101-8181 sqft',
    'H1: 3,380 sq.ft.',
    'Leasehold till 10 March 2118 (94 years as of 2024)',
    'Completion Date: 2019/2020',
    '1,434 units',
    'Q4 2024/Q1 2025',
    'St. Regis Residences Kuala Lumpur',
    'E&O – City of Elmina',
    'RM0.65 psf (inclusive of sinking fund)',
    'd432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f',
    'Rm4.77mil – Rm6,59mil',
  ]
  it.each(HIT)('hits %j', (text) => {
    expect(scanForContactDetails(text).length).toBeGreaterThan(0)
  })
  it.each(MISS)('misses %j', (text) => {
    expect(scanForContactDetails(text)).toEqual([])
  })
  it('returns class names only, never the matched text', () => {
    const out = scanForContactDetails('mail someone@example.com or call 012-000 0000')
    expect(out).toEqual(expect.arrayContaining(['email', 'phone']))
    expect(out.join(' ')).not.toContain('example')
    expect(out.join(' ')).not.toContain('012')
  })
})

// ─── parseClientSheet ─────────────────────────────────────────────────────────

function validSheet(): ClientSheet {
  return {
    meta: {
      schema: 'client-sheet/1',
      source_label: 'D2 project info sheet supplied by the client, 19 October 2026',
      import_date: '2026-10-19',
      workbook_sha256: 'd432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f',
      mapping_sha256: '0'.repeat(64),
    },
    projects: [
      {
        docId: 'UI9V4ibcLUMuYQkd5lQK',
        inventoryName: 'Damansara City Residency (DC Residensi)',
        sheetName: 'Damansara City Residency (DC Residensi)',
        sheetRow: 2,
        unitMode: 'merge',
        labelPrefix: '',
        units: [
          {
            sheetRow: 2,
            label: 'Type S1',
            sizeSqft: 904,
            bedrooms: 1,
            nettMinRM: 1_200_000,
            nettMaxRM: 1_350_000,
            grossMinRM: 1_750_000,
            grossMaxRM: 1_800_000,
            psfRM: null,
            soldOut: false,
            raw: 'Type S1: 904 Sqft | 84 Sqm | 1 Bedroom | Nett: RM1.2mil-RM1.35mil | Gross: RM1.75mil-RM1.8mil',
            held: [],
          },
          {
            sheetRow: 3,
            label: 'Type S2',
            sizeSqft: null,
            bedrooms: null,
            nettMinRM: null,
            nettMaxRM: null,
            grossMinRM: null,
            grossMaxRM: null,
            psfRM: null,
            soldOut: true,
            raw: 'Type S2: Sold out',
            held: [],
          },
        ],
        tenure: 'Freehold',
        completion: { kind: 'completed_year', year: 2017 },
        area: 'Damansara Height',
        facts: {
          area: 'Damansara Height',
          developer: 'Some Developer Sdn Bhd',
          landTitle: 'Commercial (HDA)',
          maintenanceFee: 'RM0.65 psf (inclusive of sinking fund)',
          tenure: 'Freehold',
          totalUnits: '370',
          floors: '27 Storeys',
          completion: 'Completion Date: 2017 — Ready to Move In',
          topReasons: null,
          furnishing: null,
          carPark: null,
        },
        focusLists: ['HIGH COMM 8% OR > RM100K COMMISSION MAIN CONTRIBUTORS'],
        factSheet: 'factsheets/damansara-city-residency-dc-residensi-UI9V4i.md',
      },
    ],
    skipped: [{ sheetName: 'Ashbourne', sheetRow: 186, unitRows: 8, reason: 'new project, not in the inventory' }],
    heldBack: [
      {
        docId: 'UI9V4ibcLUMuYQkd5lQK',
        inventoryName: 'Damansara City Residency (DC Residensi)',
        sheetRow: 10,
        unit: 'Type E1',
        column: 'Size',
        sheetText: 'Type E1: 2,072 Sqft | 251 Sqm',
        reason: 'sqft and sqm disagree by more than 3% (2,072 sqft is 192 sqm, the sheet says 251)',
      },
    ],
    conflicts: [
      {
        inventoryName: 'Damansara City Residency (DC Residensi)',
        unit: 'Type B4',
        column: 'Rooms',
        sheet: '2BR+1',
        reference: '2BR+1+1',
        referenceSource: 'quick-kayinleong-094 brochure transcription',
        action: 'sheet value written',
      },
    ],
  }
}

function violationsOf(mutate: (s: ClientSheet) => void): string[] {
  const s = validSheet()
  mutate(s)
  try {
    parseClientSheet(s)
  } catch (e) {
    expect(e).toBeInstanceOf(ClientSheetError)
    return (e as ClientSheetError).violations
  }
  throw new Error('expected parseClientSheet to throw')
}

describe('parseClientSheet', () => {
  it('accepts a valid fixture', () => {
    const sheet = parseClientSheet(validSheet())
    expect(sheet.projects).toHaveLength(1)
    expect(sheet.projects[0].units[1].soldOut).toBe(true)
  })

  it('accepts a Sheet1-only project (sheetRow null) with unitMode none', () => {
    const s = validSheet()
    s.projects.push({
      ...s.projects[0],
      docId: 'AETAS1',
      sheetRow: null,
      unitMode: 'none',
      units: [],
      completion: null,
      tenure: null,
    })
    expect(() => parseClientSheet(s)).not.toThrow()
  })

  const u0 = (s: ClientSheet) => s.projects[0].units[0]

  it('rejects a wrong schema / extra key / bad hash (zod layer)', () => {
    expect(() => parseClientSheet({ ...validSheet(), meta: { ...validSheet().meta, schema: 'client-sheet/2' } })).toThrow(ClientSheetError)
    expect(() => parseClientSheet(null)).toThrow(ClientSheetError)
    const extra = violationsOf((s) => { (u0(s) as unknown as Record<string, unknown>).surprise = 1 })
    expect(extra.join('\n')).toContain('docId=UI9V4ibcLUMuYQkd5lQK')
    expect(extra.join('\n')).toContain('Type S1')
    const bad = violationsOf((s) => { s.meta.workbook_sha256 = 'nothex' })
    expect(bad.join('\n')).toContain('meta')
  })

  it('invariant 1: empty label or raw', () => {
    expect(violationsOf((s) => { u0(s).raw = '  ' }).join('\n')).toMatch(/invariant 1/)
    expect(violationsOf((s) => { u0(s).label = '' }).join('\n')).toMatch(/invariant 1/)
  })

  it('invariant 2: sizeSqft 50 and 30,001', () => {
    expect(violationsOf((s) => { u0(s).sizeSqft = 50 }).join('\n')).toMatch(/invariant 2/)
    expect(violationsOf((s) => { u0(s).sizeSqft = 30_001 }).join('\n')).toMatch(/invariant 2/)
  })

  it('invariant 3: bedrooms 11', () => {
    expect(violationsOf((s) => { u0(s).bedrooms = 11 }).join('\n')).toMatch(/invariant 3/)
  })

  it('invariant 4: nett min above max, only one side set, out of range', () => {
    expect(violationsOf((s) => { u0(s).nettMinRM = 1_500_000 }).join('\n')).toMatch(/invariant 4/)
    expect(violationsOf((s) => { u0(s).nettMaxRM = null }).join('\n')).toMatch(/invariant 4/)
    expect(violationsOf((s) => { u0(s).nettMinRM = 1000; u0(s).nettMaxRM = 2000; u0(s).grossMinRM = null; u0(s).grossMaxRM = null }).join('\n')).toMatch(/invariant 4/)
  })

  it('invariant 5: gross below nett', () => {
    expect(violationsOf((s) => { u0(s).grossMinRM = 1_000_000 }).join('\n')).toMatch(/invariant 5/)
    expect(violationsOf((s) => { u0(s).grossMaxRM = 1_300_000 }).join('\n')).toMatch(/invariant 5/)
  })

  it('invariant 6: psfRM 150', () => {
    expect(violationsOf((s) => { u0(s).psfRM = 150 }).join('\n')).toMatch(/invariant 6/)
    expect(violationsOf((s) => { u0(s).psfRM = 5001 }).join('\n')).toMatch(/invariant 6/)
  })

  it('invariant 7: soldOut with a price', () => {
    expect(violationsOf((s) => { u0(s).soldOut = true }).join('\n')).toMatch(/invariant 7/)
    expect(violationsOf((s) => { s.projects[0].units[1].psfRM = 1000 }).join('\n')).toMatch(/invariant 7/)
  })

  it('invariant 8: unitMode and labelPrefix', () => {
    expect(violationsOf((s) => { s.projects[0].labelPrefix = 'Hill 4 · ' }).join('\n')).toMatch(/invariant 8/)
    expect(violationsOf((s) => { s.projects[0].unitMode = 'partial' }).join('\n')).toMatch(/invariant 8/)
    expect(violationsOf((s) => { s.projects[0].unitMode = 'none' }).join('\n')).toMatch(/invariant 8/)
    expect(violationsOf((s) => { s.projects[0].units = [] }).join('\n')).toMatch(/invariant 8/)
    const ok = validSheet()
    ok.projects[0].unitMode = 'partial'
    ok.projects[0].labelPrefix = PARTIAL_LABEL_PREFIX
    expect(() => parseClientSheet(ok)).not.toThrow()
  })

  it('invariant 9: tenure and completion', () => {
    expect(violationsOf((s) => { s.projects[0].tenure = 'Residential (under HDA)' }).join('\n')).toMatch(/invariant 9/)
    expect(violationsOf((s) => { s.projects[0].completion = { kind: 'completed_year', year: 2026 } }).join('\n')).toMatch(/invariant 9/)
    expect(violationsOf((s) => { s.projects[0].completion = { kind: 'completed_year', year: null } }).join('\n')).toMatch(/invariant 9/)
    expect(violationsOf((s) => { s.projects[0].completion = { kind: 'ambiguous', year: 2020 } }).join('\n')).toMatch(/invariant 9/)
    const ok = validSheet()
    ok.projects[0].tenure = 'Leasehold 2116'
    ok.projects[0].completion = { kind: 'future_or_expected', year: null }
    expect(() => parseClientSheet(ok)).not.toThrow()
  })

  it('invariant 10: a synthetic phone in a fact string, a URL in a held-back row', () => {
    const phone = violationsOf((s) => { s.projects[0].facts.developer = 'Developer Sdn Bhd, call 012-000 0000' })
    expect(phone.join('\n')).toMatch(/invariant 10/)
    expect(phone.join('\n')).toContain('phone')
    expect(phone.join('\n')).not.toContain('012-000 0000')
    expect(violationsOf((s) => { s.heldBack[0].reason = 'see https://example.com/x' }).join('\n')).toMatch(/heldBack\[0\].*invariant 10/)
    expect(violationsOf((s) => { s.skipped[0].reason = 'mail someone@example.com' }).join('\n')).toMatch(/skipped\[0\].*invariant 10/)
    expect(violationsOf((s) => { s.conflicts[0].reference = 'wa.me/60120000000' }).join('\n')).toMatch(/conflicts\[0\].*invariant 10/)
  })

  it('does not scan meta (the hashes are hex)', () => {
    const s = validSheet()
    s.meta.mapping_sha256 = '1234567890'.repeat(6) + '1234'
    expect(() => parseClientSheet(s)).not.toThrow()
  })

  it('names the docId and unit, never the cell text', () => {
    const SECRET = 'SECRET-CELL-TEXT-QQ'
    const v = violationsOf((s) => {
      u0(s).raw = `Type S1: ${SECRET}`
      u0(s).psfRM = 150
      u0(s).sizeSqft = 50
    })
    const text = v.join('\n')
    expect(text).toContain('docId=UI9V4ibcLUMuYQkd5lQK')
    expect(text).toContain('unit="Type S1"')
    expect(text).not.toContain(SECRET)
    expect(v.length).toBeGreaterThanOrEqual(2)
  })

  it('reports every violation together', () => {
    const v = violationsOf((s) => {
      u0(s).psfRM = 150
      u0(s).bedrooms = 11
    })
    expect(v.filter((x) => /invariant (3|6)/.test(x))).toHaveLength(2)
  })
})
