/**
 * src/inventory/quick-facts.ts — the per-project summary data shown under the Finder table
 * (quick-kayinleong-106).
 *
 * Two pure builders, both computed on the SERVER from a project's stored fields:
 *
 *   - `quickFactsExcerpt`: the cleaned "Quick Facts" part of the stored write-up. The model
 *     reads it to write the two short prose fields ("Best for", "Key selling points"). It is
 *     allowlist-minded: it starts at the "Quick Facts" heading, so the preamble (PIC, phone
 *     numbers, WhatsApp group) never enters, and any line below that still carries a link, a
 *     phone number, an e-mail or a contact label is dropped whole. The raw `description` is
 *     never put on a `ProjectMatch`: the AI SDK streams the raw tool output to the browser.
 *   - `summaryLayouts`: the "Layouts & sizing" rows, built from `unitTypes`. The model never
 *     writes these, which is what keeps the 105 rule (never say which layouts fit a budget)
 *     intact. Sold-out layouts carry no price at all.
 *
 * Also home of the contact / WhatsApp patterns that `src/agents/finder/project-sheet.ts`
 * used to hold alone, moved here so `src/inventory` never imports from `src/agents`.
 *
 * Pure: no Firestore, no SDK. Core/shell rule: must NOT import from app/ or next.
 */

import type { UnitTypeEntry } from '@/src/firebase/collections'

/** A WhatsApp group invite anywhere in the write-up. The capture is the invite code. */
export const WHATSAPP_INVITE = /https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]{10,40})/

/** "Project PIC:", "PIC:", "Project Leader:", "Project Co-leader:", "Co-leader:". */
export const CONTACT_LINE =
  /^\s*(?:project\s+)?(pic|person\s+in\s+charge|co[\s-]?leader|leader)\s*:(.*)$/i

/** Characters of excerpt the model gets per project. */
export const QUICK_FACTS_MAX_CHARS = 700

/** At most this many layouts per summary (available first, sold out last). */
export const MAX_SUMMARY_LAYOUTS = 6

const MAX_LABEL_CHARS = 60

const QUICK_FACTS_HEADING = /quick\s*facts/i

/** A line that must never reach the model or the browser, whatever else it says. */
const UNSAFE_LINE: RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\bwa\.me\b/i,
  /chat\.whatsapp\.com/i,
  /whats\s*app/i,
  /@/,
  // a phone number in any corpus format: "+60 12-345 6789", "0123456789", "012 345 6789"
  // (one separator at most, so a year range such as "2028 - 2030" is not mistaken for one)
  /\+?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/,
  CONTACT_LINE,
  /^\s*(?:contact|tel|telephone|phone|mobile|hp|call)\b/i,
]

/**
 * The cleaned Quick Facts excerpt of a stored write-up, capped at `maxChars`.
 *
 * Starts at the first "Quick Facts" heading. A write-up with no such heading yields '' (5 of
 * 86 on the 2026-11-25 corpus): without the heading there is no boundary between the facts
 * and the contact preamble, and the safe answer is nothing. Blank lines are collapsed.
 * Returns '' for a missing or non-string description.
 */
export function quickFactsExcerpt(
  description: string | null | undefined,
  maxChars: number = QUICK_FACTS_MAX_CHARS,
): string {
  if (typeof description !== 'string' || description.length === 0) return ''
  const at = description.search(QUICK_FACTS_HEADING)
  if (at < 0) return ''
  const lines = description
    .slice(at)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !UNSAFE_LINE.some((re) => re.test(l)))
  return lines.join('\n').slice(0, Math.max(0, maxChars)).trimEnd()
}

/** One layout of the "Layouts & sizing" line. `raw` (the verbatim source line) is dropped. */
export interface SummaryLayout {
  label: string
  sizeSqft: number | null
  bedrooms: number | null
  priceMinRM: number | null
  priceMaxRM: number | null
  grossMinRM: number | null
  grossMaxRM: number | null
  soldOut: boolean
}

function positiveOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The layouts to show for a project: available ones first, then (within each group) the
 * requested bedroom count first, then the stored order. At most `MAX_SUMMARY_LAYOUTS`.
 *
 * Never filtered by budget, only ordered by bedrooms. A sold-out layout keeps its label,
 * size and bedrooms but has every price nulled: a sold-out layout is never priced. A price
 * that is null, zero or not a number is null, so no consumer can print "RM 0".
 */
export function summaryLayouts(
  unitTypes: UnitTypeEntry[] | null | undefined,
  bedrooms?: number | null,
): SummaryLayout[] {
  if (!Array.isArray(unitTypes)) return []
  const want = typeof bedrooms === 'number' && bedrooms > 0 ? bedrooms : null
  const layouts: SummaryLayout[] = []
  for (const u of unitTypes) {
    if (!u || typeof u.label !== 'string') continue
    const label = u.label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS)
    if (label.length === 0) continue
    const soldOut = u.soldOut === true
    layouts.push({
      label,
      sizeSqft: positiveOrNull(u.sizeSqft),
      bedrooms: typeof u.bedrooms === 'number' && Number.isFinite(u.bedrooms) ? u.bedrooms : null,
      priceMinRM: soldOut ? null : positiveOrNull(u.priceMinRM),
      priceMaxRM: soldOut ? null : positiveOrNull(u.priceMaxRM),
      grossMinRM: soldOut ? null : positiveOrNull(u.grossMinRM),
      grossMaxRM: soldOut ? null : positiveOrNull(u.grossMaxRM),
      soldOut,
    })
  }
  const rank = (l: SummaryLayout) => (l.soldOut ? 2 : 0) + (want !== null && l.bedrooms === want ? 0 : 1)
  // Array.prototype.sort is stable, so ties keep the stored order.
  return layouts.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SUMMARY_LAYOUTS)
}
