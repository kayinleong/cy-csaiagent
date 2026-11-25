/**
 * quick-facts.test.ts — the per-project summary builders (quick-kayinleong-106).
 *
 * Run: npx vitest run src/inventory/quick-facts.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { UnitTypeEntry } from '@/src/firebase/collections'
import {
  quickFactsExcerpt,
  summaryLayouts,
  MAX_SUMMARY_LAYOUTS,
  QUICK_FACTS_MAX_CHARS,
} from './quick-facts'

const WRITE_UP = `Project PIC: Alex Tan (wa.me/60123456789)
Project Leader: Sam Lee +60 12-345 6789
Project WhatsApp Link: https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv?mode=ems_copy_c
Call me on 012 345 6789 for the latest price

Quick Facts:
Developer: Pavilion Damansara (Impian Ekspresi Sdn Bhd)

Land Size: 15.92 acres
Title: Freehold
Completion: 2028 - 2030
Sales gallery: https://example.com/gallery
Email sales@example.com
Co-leader: Jo
Total Units: 1,314
`

describe('quickFactsExcerpt', () => {
  it('starts at the Quick Facts heading, so the preamble never enters', () => {
    const out = quickFactsExcerpt(WRITE_UP)
    expect(out.startsWith('Quick Facts:')).toBe(true)
    expect(out).not.toContain('Alex Tan')
    expect(out).not.toContain('Sam Lee')
  })

  it('strips phone numbers, wa.me, chat.whatsapp, URLs, e-mail and PIC / leader lines', () => {
    const out = quickFactsExcerpt(WRITE_UP)
    expect(out).not.toMatch(/wa\.me/i)
    expect(out).not.toMatch(/chat\.whatsapp/i)
    expect(out).not.toMatch(/https?:\/\//i)
    expect(out).not.toContain('@')
    expect(out).not.toMatch(/\d{3}[\s-]?\d{3}[\s-]?\d{4}/)
    expect(out).not.toMatch(/co-?leader|leader|PIC/i)
  })

  it('keeps the facts, including a year range, and collapses blank lines', () => {
    const out = quickFactsExcerpt(WRITE_UP)
    expect(out).toContain('Developer: Pavilion Damansara (Impian Ekspresi Sdn Bhd)')
    expect(out).toContain('Title: Freehold')
    expect(out).toContain('Completion: 2028 - 2030')
    expect(out).toContain('Total Units: 1,314')
    expect(out).not.toMatch(/\n\n/)
  })

  it('caps the excerpt at 700 characters by default and at maxChars when given', () => {
    const long = `Quick Facts:\n${Array.from({ length: 80 }, (_, i) => `Facility ${i}: pool and gym`).join('\n')}`
    expect(quickFactsExcerpt(long).length).toBeLessThanOrEqual(QUICK_FACTS_MAX_CHARS)
    expect(quickFactsExcerpt(long).length).toBeGreaterThan(600)
    expect(quickFactsExcerpt(long, 50).length).toBeLessThanOrEqual(50)
  })

  it("returns '' for an empty, missing or heading-less description", () => {
    expect(quickFactsExcerpt('')).toBe('')
    expect(quickFactsExcerpt(undefined)).toBe('')
    expect(quickFactsExcerpt(null)).toBe('')
    expect(quickFactsExcerpt('PIC: Alex\nTitle: Freehold')).toBe('')
  })
})

function unit(over: Partial<UnitTypeEntry>): UnitTypeEntry {
  return {
    label: 'Type A',
    sizeSqft: 1_000,
    bedrooms: 2,
    priceMinRM: 1_000_000,
    priceMaxRM: 1_200_000,
    raw: 'Type A, 2 bed, 1000 sqft, RM1.0m-1.2m (verbatim source line)',
    ...over,
  }
}

describe('summaryLayouts', () => {
  it('drops `raw`', () => {
    const [l] = summaryLayouts([unit({})])
    expect('raw' in l).toBe(false)
    expect(l).toMatchObject({ label: 'Type A', sizeSqft: 1_000, bedrooms: 2, soldOut: false })
  })

  it('puts available layouts before sold-out ones', () => {
    const out = summaryLayouts([
      unit({ label: 'Sold', soldOut: true }),
      unit({ label: 'Open' }),
    ])
    expect(out.map((l) => l.label)).toEqual(['Open', 'Sold'])
  })

  it('puts the requested bedroom count first within the available layouts', () => {
    const out = summaryLayouts(
      [unit({ label: 'S', bedrooms: 1 }), unit({ label: 'T', bedrooms: 3 }), unit({ label: 'U', bedrooms: 2 })],
      3,
    )
    expect(out.map((l) => l.label)).toEqual(['T', 'S', 'U'])
  })

  it('keeps the stored order with no bedroom request, and does not filter by it', () => {
    const out = summaryLayouts([unit({ label: 'S', bedrooms: 1 }), unit({ label: 'T', bedrooms: 3 })], null)
    expect(out.map((l) => l.label)).toEqual(['S', 'T'])
    expect(summaryLayouts([unit({ bedrooms: 1 })], 5)).toHaveLength(1)
  })

  it('caps at 6 layouts', () => {
    const many = Array.from({ length: 10 }, (_, i) => unit({ label: `L${i}` }))
    expect(summaryLayouts(many)).toHaveLength(MAX_SUMMARY_LAYOUTS)
    expect(MAX_SUMMARY_LAYOUTS).toBe(6)
  })

  it('keeps soldOut, and never carries a price for a sold-out layout', () => {
    const [l] = summaryLayouts([
      unit({ soldOut: true, priceMinRM: 900_000, priceMaxRM: 950_000, grossMinRM: 1_000_000, grossMaxRM: 1_100_000 }),
    ])
    expect(l.soldOut).toBe(true)
    expect([l.priceMinRM, l.priceMaxRM, l.grossMinRM, l.grossMaxRM]).toEqual([null, null, null, null])
  })

  it('turns a null or zero price into null, never 0', () => {
    const [l] = summaryLayouts([unit({ priceMinRM: 0, priceMaxRM: null, grossMinRM: undefined, sizeSqft: 0 })])
    expect(l.priceMinRM).toBeNull()
    expect(l.priceMaxRM).toBeNull()
    expect(l.grossMinRM).toBeNull()
    expect(l.sizeSqft).toBeNull()
  })

  it('returns [] for no layouts', () => {
    expect(summaryLayouts([])).toEqual([])
    expect(summaryLayouts(undefined)).toEqual([])
  })
})
