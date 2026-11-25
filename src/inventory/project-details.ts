/**
 * src/inventory/project-details.ts — the "Full details" of one project, built on the SERVER
 * from its stored fields (quick-kayinleong-107). No model call.
 *
 * The Finder shows every listed project's information under the result table, in the same
 * sections as the Details answer (Quick Facts, Built-Up Sizes & Layouts, Prices & Fees,
 * Facilities, then any other write-up section). `buildProjectDetails` returns everything
 * except the layouts (the UI renders those from the structured `layouts`).
 *
 * Sources, in authority order:
 *   1. `clientFacts` (the client project info sheet): where it states a fact, the write-up's
 *      line for the same fact is dropped.
 *   2. the stored write-up, cleaned like `quickFactsExcerpt` (start at "Quick Facts"; every
 *      line with a link, WhatsApp, e-mail, phone number or contact label is gone) but uncapped.
 *   3. the structured price fields. A price is never "RM 0" and a psf rate is never
 *      multiplied by a size.
 *
 * The sales-resources block (folders, FB Ads, Reels, Drone Footage…) is dropped whole.
 *
 * Pure. Core/shell rule: must NOT import from app/ or next.
 */

import type { ClientFacts, ProjectDoc } from '@/src/firebase/collections'
import { scanForContactDetails } from './client-workbook-safety'
import { cleanedWriteUpLines } from './quick-facts'

export type DetailKind = 'quickFacts' | 'pricesFees' | 'topReasons' | 'focusLists' | 'other'

export interface DetailItem {
  /** A fixed i18n label key ('developer', 'fromPrice'…); the UI translates it. */
  key?: string
  /** The write-up's own label, shown as stored. */
  label?: string
  value: string
}

export interface DetailSection {
  kind: DetailKind
  /** The write-up's own heading; for 'other' sections only. */
  title?: string
  items: DetailItem[]
}

export const MAX_DETAIL_SECTIONS = 14
export const MAX_DETAIL_ITEMS = 30
export const MAX_DETAIL_VALUE_CHARS = 300
export const MAX_DETAIL_TOTAL_CHARS = 7_000

const MAX_HEADING_CHARS = 80
const MAX_LABEL_CHARS = 40

type FactKey =
  | 'area'
  | 'developer'
  | 'landTitle'
  | 'tenure'
  | 'totalUnits'
  | 'floors'
  | 'completion'
  | 'furnishing'
  | 'carPark'
  | 'maintenanceFee'

/** Fixed display order of the clientFacts in Quick Facts (maintenanceFee is a price). */
const QUICK_FACT_ORDER: FactKey[] = [
  'area',
  'developer',
  'landTitle',
  'tenure',
  'totalUnits',
  'floors',
  'completion',
  'furnishing',
  'carPark',
]

const SYNONYMS: Array<[FactKey, RegExp]> = [
  ['area', /^area$/],
  ['developer', /^developer$/],
  // A bare "Title" in a write-up names the land title or tenure ("Title: Freehold").
  ['landTitle', /^(land )?title$/],
  ['tenure', /^(land )?tenure$/],
  ['totalUnits', /^(total |no of |number of )?units$/],
  ['floors', /^(total )?(storeys|floors)$/],
  ['completion', /^(target |expected )?completion( status| date)?$|^(expected )?vacant possession$|^vp( date)?$/],
  ['maintenanceFee', /^maintenance( fee)?$/],
  ['furnishing', /^furnishing$/],
  ['carPark', /^car ?parks?( allocation)?$/],
]

const RESOURCES_HEADING = /resources|folder|click the link/i
/**
 * A deal or person record inside a write-up ("Client name:", "Client:", "Buyer:", "Agent:"),
 * dropped whole (quick-kayinleong-107): it describes one past buyer or agent, not the
 * project, and can carry a person's name the contact scan does not recognise.
 */
const PERSON_HEADING = /^(client|buyer|purchaser|agent|owner)s?( name| details?| info)?$/i
const LAYOUT_HEADING = /layout|unit type|built-up|sizes/i
const PRICE_HEADING = /price|pricing/i

function factKeyOf(label: string): FactKey | null {
  const norm = label
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [key, re] of SYNONYMS) if (re.test(norm)) return key
  return null
}

function stated(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

/** Clip at a word boundary with "…" when over `max`. */
export function clipValue(text: string, max: number = MAX_DETAIL_VALUE_CHARS): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`
}

function stripBullet(line: string): string {
  return line.replace(/^[-•*]\s+/, '').trim()
}

function rm(n: number): string {
  return `RM ${Math.round(n).toLocaleString('en-US')}`
}

type Raw = { kind: 'quickFacts' | 'price' | 'layout' | 'reasons' | 'other' | 'drop'; title?: string; items: DetailItem[] }

type DetailDoc = Partial<
  Pick<ProjectDoc, 'description' | 'unitTypes' | 'priceValue' | 'pricePsfMin' | 'pricePsfMax' | 'clientFacts'>
>

/** Parse the cleaned write-up into raw sections, source order. */
function parseWriteUp(lines: string[], facts: ClientFacts): Raw[] {
  const sections: Raw[] = [{ kind: 'quickFacts', items: [] }]
  let cur = sections[0]
  let first = true
  for (const rawLine of lines) {
    const line = stripBullet(rawLine)
    if (!line) continue
    if (first) {
      first = false
      if (/^quick\s*facts[^:]*:?$/i.test(line)) continue
    }
    const isHeading = line.endsWith(':') && line.length <= MAX_HEADING_CHARS
    const isReasonsHeading =
      !line.includes(':') &&
      line.length <= MAX_HEADING_CHARS &&
      /reason/i.test(line) &&
      !/^[✅⭕]/u.test(line)
    if (isHeading || isReasonsHeading) {
      const title = line.replace(/:$/, '').trim()
      let kind: Raw['kind']
      const fk = factKeyOf(title)
      if (RESOURCES_HEADING.test(title) || PERSON_HEADING.test(title.trim())) kind = 'drop'
      else if (/reason/i.test(title)) kind = 'reasons'
      else if (LAYOUT_HEADING.test(title)) kind = 'layout'
      else if (PRICE_HEADING.test(title)) kind = 'price'
      else if (fk && stated(facts[fk])) kind = 'drop'
      else if (fk === 'maintenanceFee') kind = 'price'
      else kind = 'other'
      cur = { kind, title, items: [] }
      sections.push(cur)
      continue
    }
    if (cur.kind === 'drop' || /click the link/i.test(line)) continue
    const colon = line.indexOf(':')
    if (colon > 0 && colon <= MAX_LABEL_CHARS && line.slice(colon + 1).trim().length > 0) {
      cur.items.push({ label: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
    } else {
      cur.items.push({ value: line })
    }
  }
  return sections
}

function totalChars(sections: DetailSection[]): number {
  let n = 0
  for (const s of sections) {
    n += s.title?.length ?? 0
    for (const i of s.items) n += (i.label?.length ?? 0) + (i.key?.length ?? 0) + i.value.length
  }
  return n
}

/**
 * The detail sections for one project (everything but the layouts). Empty sections are
 * dropped; see the module comment for sources and caps.
 */
export function buildProjectDetails(doc: DetailDoc): DetailSection[] {
  const facts: ClientFacts = doc.clientFacts && typeof doc.clientFacts === 'object' ? doc.clientFacts : {}
  const raw = parseWriteUp(cleanedWriteUpLines(doc.description), facts)
  const hasLayouts = Array.isArray(doc.unitTypes) && doc.unitTypes.length > 0

  // ── Quick Facts: the client sheet first, then the write-up lines it does not state.
  const quickItems: DetailItem[] = []
  for (const key of QUICK_FACT_ORDER) {
    const v = stated(facts[key])
    if (v) quickItems.push({ key, value: v })
  }
  const movedMaintenance: DetailItem[] = []
  const factsMaintenance = stated(facts.maintenanceFee)
  for (const item of raw[0].items) {
    const fk = item.label ? factKeyOf(item.label) : null
    if (fk === 'maintenanceFee') {
      if (!factsMaintenance) movedMaintenance.push({ key: 'maintenanceFee', value: item.value })
      continue
    }
    if (fk && stated(facts[fk])) continue
    quickItems.push(item)
  }

  // ── Prices & Fees.
  const priceItems: DetailItem[] = []
  if (typeof doc.priceValue === 'number' && Number.isFinite(doc.priceValue) && doc.priceValue > 0) {
    priceItems.push({ key: 'fromPrice', value: rm(doc.priceValue) })
  }
  const psf = [doc.pricePsfMin, doc.pricePsfMax].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 100,
  )
  if (psf.length > 0) {
    const lo = Math.min(...psf)
    const hi = Math.max(...psf)
    priceItems.push({
      key: 'psfRate',
      value:
        Math.round(lo) === Math.round(hi)
          ? `${rm(lo)} psf`
          : `${rm(lo)}–${Math.round(hi).toLocaleString('en-US')} psf`,
    })
  }
  if (factsMaintenance) priceItems.push({ key: 'maintenanceFee', value: factsMaintenance })
  priceItems.push(...movedMaintenance)
  for (const s of raw) {
    if (s.kind !== 'price') continue
    for (const item of s.items) {
      const fk = item.label ? factKeyOf(item.label) : null
      if (fk === 'maintenanceFee' && factsMaintenance) continue
      priceItems.push(item)
    }
  }

  // ── Other write-up sections, source order.
  const others: DetailSection[] = []
  for (const s of raw) {
    if (s.kind === 'other' || (s.kind === 'layout' && !hasLayouts)) {
      others.push({ kind: 'other', title: s.title?.slice(0, MAX_HEADING_CHARS), items: s.items })
    }
  }

  // ── Top reasons: the client sheet wins over the write-up.
  const sheetReasons = (stated(facts.topReasons) ? String(facts.topReasons) : '')
    .split(/\r?\n/)
    .map((l) => stripBullet(l.replace(/\s+/g, ' ').trim()))
    .filter((l) => l.length > 0)
  const reasonItems: DetailItem[] =
    sheetReasons.length > 0
      ? sheetReasons.map((value) => ({ value }))
      : raw.filter((s) => s.kind === 'reasons').flatMap((s) => s.items)

  const focusItems: DetailItem[] = (Array.isArray(facts.focusLists) ? facts.focusLists : [])
    .map(stated)
    .filter((v) => v.length > 0)
    .map((value) => ({ value }))

  let sections: DetailSection[] = [
    { kind: 'quickFacts', items: quickItems },
    { kind: 'pricesFees', items: priceItems },
    ...others,
    { kind: 'topReasons', items: reasonItems },
    { kind: 'focusLists', items: focusItems },
  ]

  // ── Safety net: the stricter workbook scanner (bare domains, account numbers) on top of
  // the write-up cleaning. A hit drops that item, or the whole section when its title hits.
  sections = sections
    .filter((s) => !s.title || scanForContactDetails(s.title).length === 0)
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => scanForContactDetails(`${i.label ?? ''} ${i.value}`).length === 0),
    }))

  // ── Caps.
  sections = sections
    .map((s) => ({
      ...s,
      items: s.items
        .slice(0, MAX_DETAIL_ITEMS)
        .map((i) => ({ ...i, value: clipValue(i.value) }))
        .filter((i) => i.value.length > 0),
    }))
    .filter((s) => s.items.length > 0)

  const dropLastOther = (): boolean => {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].kind === 'other') {
        sections.splice(i, 1)
        return true
      }
    }
    return false
  }
  while (sections.length > MAX_DETAIL_SECTIONS && dropLastOther()) {
    /* dropped */
  }
  sections = sections.slice(0, MAX_DETAIL_SECTIONS)
  while (totalChars(sections) > MAX_DETAIL_TOTAL_CHARS) {
    if (dropLastOther()) continue
    // No 'other' left: trim from the tail (focus lists, then reasons, then the rest).
    const last = sections[sections.length - 1]
    if (!last) break
    last.items.pop()
    if (last.items.length === 0) sections.pop()
  }
  return sections
}
