/**
 * project-details.test.ts — the server-built full details (quick-kayinleong-107).
 * SYNTHETIC fixtures shaped like the real write-ups; the contact lines are fake.
 *
 * Run: npx vitest run src/inventory/project-details.test.ts
 */

import { describe, expect, it } from 'vitest'
import {
  buildProjectDetails,
  clipValue,
  MAX_DETAIL_ITEMS,
  MAX_DETAIL_SECTIONS,
  MAX_DETAIL_TOTAL_CHARS,
  MAX_DETAIL_VALUE_CHARS,
  type DetailSection,
} from './project-details'
import { summaryLayouts, MAX_DETAIL_LAYOUTS } from './quick-facts'
import type { UnitTypeEntry } from '@/src/firebase/collections'

const WRITE_UP = `Project PIC: Test Person (wa.me/60120000000)
Group: https://chat.whatsapp.com/ABCDEFGHIJKL1234
Quick Facts:
Developer: Old Developer Sdn Bhd
Location: Jalan Test, Bangsar
Land Tenure: Freehold
Land Title: Residential Strata
Target Completion: Q2 2028
Maintenance Fee: RM0.39 psf
Project Leader: Someone Else
Main Unit Layouts:
Type A: 570 sqft
Type B: 765 sqft
Price & Maintenance Fee:
Price: RM1,400 psf (Gross)
Facilities:
Swimming pool
Gymnasium
- Sky garden
Furnishing & Finishes:
Fully fitted kitchen
Developer's Incentives:
SPA legal fees: Free by developer
💥 Top 8+8 Reasons Why Test Residence 💥
8 Reasons You'll Love It:
✅ Walk to the LRT
✅ Resort facilities
Sales Resources Folder:
Marketing Resources:
Click the links to access
FB Ads
Reels
Showroom Photos, Videos & Walkthrough
FPV & Drone Footage
Booking & Payment Terms:
Booking fee: RM5,000`

const UNIT_TYPES: UnitTypeEntry[] = [{ label: 'Type A', sizeSqft: 570, soldOut: false } as UnitTypeEntry]

function kinds(s: DetailSection[]) {
  return s.map((x) => (x.kind === 'other' ? `other:${x.title}` : x.kind))
}
function all(s: DetailSection[]) {
  return JSON.stringify(s)
}
const find = (s: DetailSection[], kind: string, title?: string) =>
  s.find((x) => x.kind === kind && (title === undefined || x.title === title))

describe('buildProjectDetails: parsing', () => {
  const s = buildProjectDetails({ description: WRITE_UP })

  it('sections come in source order, titled by the write-up heading', () => {
    expect(kinds(s)).toEqual([
      'quickFacts',
      'pricesFees',
      'other:Main Unit Layouts',
      'other:Facilities',
      'other:Furnishing & Finishes',
      "other:Developer's Incentives",
      'other:Booking & Payment Terms',
      'topReasons',
    ])
  })

  it('label lines become {label,value}; plain lines {value}; bullets are stripped', () => {
    const qf = find(s, 'quickFacts')!
    expect(qf.items).toContainEqual({ label: 'Location', value: 'Jalan Test, Bangsar' })
    const fac = find(s, 'other', 'Facilities')!
    expect(fac.items).toEqual([{ value: 'Swimming pool' }, { value: 'Gymnasium' }, { value: 'Sky garden' }])
    expect(find(s, 'other', "Developer's Incentives")!.items).toEqual([
      { label: 'SPA legal fees', value: 'Free by developer' },
    ])
  })

  it('the contact lines and the sales-resources block are dropped whole', () => {
    const t = all(s)
    for (const bad of ['Test Person', 'wa.me', 'whatsapp', 'Someone Else', 'FB Ads', 'Reels', 'Drone', 'Showroom', 'Click the link', 'Resources']) {
      expect(t.toLowerCase()).not.toContain(bad.toLowerCase())
    }
    // ...and the section after the dropped block is back to normal.
    expect(find(s, 'other', 'Booking & Payment Terms')!.items).toEqual([{ label: 'Booking fee', value: 'RM5,000' }])
  })

  it('a client / buyer / agent record section is dropped whole', () => {
    const d = buildProjectDetails({ description: 'Quick Facts:\nTenure: Freehold\nClient name:\nNationality: Malaysian\nAgent: Test Person\nFacilities:\nPool' })
    expect(all(d)).not.toContain('Test Person')
    expect(all(d)).not.toContain('Nationality')
    expect(d.map((x) => x.title)).toContain('Facilities')
  })

  it('the reasons heading lines start a section; their lines merge into one topReasons', () => {
    expect(find(s, 'topReasons')!.items.map((i) => i.value)).toEqual(['✅ Walk to the LRT', '✅ Resort facilities'])
  })

  it('the write-up price section merges into Prices & Fees (not repeated as other)', () => {
    const prices = find(s, 'pricesFees')!
    expect(prices.items).toContainEqual({ label: 'Price', value: 'RM1,400 psf (Gross)' })
    expect(kinds(s)).not.toContain('other:Price & Maintenance Fee')
  })

  it('without clientFacts, the write-up maintenance line moves to Prices & Fees under a fixed key', () => {
    expect(find(s, 'pricesFees')!.items[0]).toEqual({ key: 'maintenanceFee', value: 'RM0.39 psf' })
    expect(find(s, 'quickFacts')!.items.some((i) => i.label === 'Maintenance Fee')).toBe(false)
  })
})

describe('buildProjectDetails: clientFacts authority', () => {
  const s = buildProjectDetails({
    description: WRITE_UP,
    clientFacts: {
      developer: 'Sheet Developer Bhd',
      tenure: 'Leasehold 99 years',
      completion: '2029',
      maintenanceFee: 'RM0.45 psf',
      topReasons: 'Near MRT\nGood school zone',
      focusLists: ['Bangsar picks', 'Under RM1.5m'],
    },
  })

  it('its facts come first, in fixed order and with fixed keys', () => {
    const qf = find(s, 'quickFacts')!
    expect(qf.items.slice(0, 3)).toEqual([
      { key: 'developer', value: 'Sheet Developer Bhd' },
      { key: 'tenure', value: 'Leasehold 99 years' },
      { key: 'completion', value: '2029' },
    ])
  })

  it("the write-up's lines for a stated fact are dropped (synonyms), others kept", () => {
    const qf = find(s, 'quickFacts')!
    const labels = qf.items.map((i) => i.label)
    expect(labels).not.toContain('Developer')
    expect(labels).not.toContain('Land Tenure')
    expect(labels).not.toContain('Target Completion')
    // clientFacts has no landTitle: the write-up line stays.
    expect(qf.items).toContainEqual({ label: 'Land Title', value: 'Residential Strata' })
    expect(all(s)).not.toContain('Old Developer')
  })

  it('a bare "Title", "No. of Units" or "Completion Date" line is the same fact as the sheet\'s', () => {
    const d = buildProjectDetails({
      description: 'Quick Facts:\nTitle: Freehold\nNo. of Units: 1,314\nCompletion Date: 2025\nLand Size: 15.92 acres',
      clientFacts: { landTitle: 'Commercial under HDA', totalUnits: '1314', completion: 'Completed 2025' },
    })
    const labels = find(d, 'quickFacts')!.items.map((i) => i.label).filter(Boolean)
    expect(labels).toEqual(['Land Size'])
  })

  it('maintenance fee comes from the sheet, and the write-up line is gone', () => {
    const prices = find(s, 'pricesFees')!
    expect(prices.items).toContainEqual({ key: 'maintenanceFee', value: 'RM0.45 psf' })
    expect(all(s)).not.toContain('RM0.39')
  })

  it('sheet reasons win over the write-up reasons; focus lists come last', () => {
    expect(find(s, 'topReasons')!.items.map((i) => i.value)).toEqual(['Near MRT', 'Good school zone'])
    expect(all(s)).not.toContain('Walk to the LRT')
    expect(s[s.length - 1]).toEqual({ kind: 'focusLists', items: [{ value: 'Bangsar picks' }, { value: 'Under RM1.5m' }] })
  })

  it('a heading section that states a sheet fact is dropped too', () => {
    const t = buildProjectDetails({
      description: 'Quick Facts:\nTenure: Freehold\nCarparks:\nAll units 2 car parks\nFacilities:\nPool',
      clientFacts: { carPark: '2 per unit' },
    })
    expect(kinds(t)).toEqual(['quickFacts', 'other:Facilities'])
  })
})

describe('buildProjectDetails: safety net', () => {
  it('drops a bare domain and an account number the line cleaning would let through', () => {
    const s = buildProjectDetails({
      description: 'Quick Facts:\nTenure: Freehold\nBooking Details:\nAccount No: 1234567890123\nBank: Test Bank\nGallery: sales-gallery.com.my\nOffice hours: 9 to 5',
    })
    const t = JSON.stringify(s)
    expect(t).not.toContain('1234567890123')
    expect(t).not.toContain('sales-gallery')
    expect(t).toContain('Test Bank')
    expect(t).toContain('9 to 5')
  })
})

describe('buildProjectDetails: layouts and prices', () => {
  it('drops the write-up layout sections only when unitTypes is non-empty', () => {
    const withTypes = buildProjectDetails({ description: WRITE_UP, unitTypes: UNIT_TYPES })
    const without = buildProjectDetails({ description: WRITE_UP, unitTypes: [] })
    expect(kinds(withTypes)).not.toContain('other:Main Unit Layouts')
    expect(kinds(without)).toContain('other:Main Unit Layouts')
    expect(kinds(buildProjectDetails({ description: WRITE_UP }))).toContain('other:Main Unit Layouts')
  })

  it('prices: from price and psf, formatted, never RM 0, never psf x size', () => {
    const s = buildProjectDetails({ description: '', priceValue: 1_200_000, pricePsfMin: 1_100, pricePsfMax: 1_300 })
    expect(find(s, 'pricesFees')!.items).toEqual([
      { key: 'fromPrice', value: 'RM 1,200,000' },
      { key: 'psfRate', value: 'RM 1,100–1,300 psf' },
    ])
    const one = buildProjectDetails({ pricePsfMin: 1_400, pricePsfMax: 1_400 })
    expect(find(one, 'pricesFees')!.items).toEqual([{ key: 'psfRate', value: 'RM 1,400 psf' }])
    expect(all(buildProjectDetails({ priceValue: 0, pricePsfMin: 0, pricePsfMax: 50 }))).toBe('[]')
    // a psf rate with a size on the doc never becomes a total
    const sized = buildProjectDetails({ pricePsfMin: 1_000, pricePsfMax: 1_000, unitTypes: [{ label: 'A', sizeSqft: 1_000 } as UnitTypeEntry] })
    expect(all(sized)).not.toContain('1,000,000')
    expect(all(sized)).not.toContain('RM 0')
  })

  it('summaryLayouts takes a cap: 40 for the details path, sold out last', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `T${i}`, sizeSqft: 500 + i, soldOut: i === 0 }) as UnitTypeEntry)
    const l = summaryLayouts(many, null, MAX_DETAIL_LAYOUTS)
    expect(l).toHaveLength(40)
    expect(l[l.length - 1].soldOut).toBe(false)
    expect(summaryLayouts(many)).toHaveLength(6)
  })
})

describe('buildProjectDetails: degenerate input and caps', () => {
  it("'' / missing description yields only clientFacts and prices", () => {
    expect(buildProjectDetails({})).toEqual([])
    expect(buildProjectDetails({ description: '' })).toEqual([])
    expect(buildProjectDetails({ description: 'no heading here\nDeveloper: X' })).toEqual([])
    const s = buildProjectDetails({ description: '', clientFacts: { area: 'Bangsar' }, priceValue: 900_000 })
    expect(kinds(s)).toEqual(['quickFacts', 'pricesFees'])
  })

  it('clips a value at a word boundary with an ellipsis', () => {
    const long = Array.from({ length: 200 }, () => 'word').join(' ')
    const c = clipValue(long)
    expect(c.length).toBeLessThanOrEqual(MAX_DETAIL_VALUE_CHARS)
    expect(c.endsWith('…')).toBe(true)
    expect(c).not.toMatch(/wor…$/)
    expect(clipValue('short')).toBe('short')
  })

  it('caps items per section, sections, and total characters', () => {
    const items = Array.from({ length: 60 }, (_, i) => `Item ${i}`).join('\n')
    const s1 = buildProjectDetails({ description: `Quick Facts:\nTenure: Freehold\nFacilities:\n${items}` })
    expect(find(s1, 'other', 'Facilities')!.items).toHaveLength(MAX_DETAIL_ITEMS)

    const heads = Array.from({ length: 30 }, (_, i) => `Heading ${i}:\nline ${i}`).join('\n')
    const s2 = buildProjectDetails({ description: `Quick Facts:\nTenure: Freehold\n${heads}`, clientFacts: { focusLists: ['x'] } })
    expect(s2.length).toBeLessThanOrEqual(MAX_DETAIL_SECTIONS)
    expect(s2[0].kind).toBe('quickFacts')
    expect(s2[s2.length - 1].kind).toBe('focusLists')

    const fat = Array.from({ length: 12 }, (_, i) => `Section ${i}:\n${Array.from({ length: 25 }, (_, j) => `Line ${j} ${'y'.repeat(250)}`).join('\n')}`).join('\n')
    const s3 = buildProjectDetails({ description: `Quick Facts:\nTenure: Freehold\n${fat}`, clientFacts: { topReasons: 'a\nb' } })
    expect(JSON.stringify(s3).length).toBeLessThan(MAX_DETAIL_TOTAL_CHARS * 1.3)
    const chars = s3.reduce((n, x) => n + (x.title?.length ?? 0) + x.items.reduce((m, i) => m + (i.label?.length ?? 0) + (i.key?.length ?? 0) + i.value.length, 0), 0)
    expect(chars).toBeLessThanOrEqual(MAX_DETAIL_TOTAL_CHARS)
    // trailing 'other' sections went first: quick facts and reasons survive
    expect(s3[0].kind).toBe('quickFacts')
    expect(find(s3, 'topReasons')).toBeDefined()
  })
})
