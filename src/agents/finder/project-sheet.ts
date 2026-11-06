/**
 * src/agents/finder/project-sheet.ts — the project sheet shown with a details answer
 * (quick-kayinleong-103).
 *
 * The user asked for a project's details to read like its Skool page: the PIC and the
 * project WhatsApp group at the top, the quick facts, then the project and marketing
 * links an agent can pass on. The quick facts are the model's answer (see the DETAIL
 * REQUEST section of prompt.ts). Everything an agent clicks or contacts comes from here.
 * It is parsed from the stored write-up and the collateral records, the same way
 * `unitTypes` and `sizeMinSqft` are, so the model never types out a link or a name.
 *
 * Measured on the live corpus (2026-11-06, 86 active projects):
 *   - 72 write-ups have a "Project WhatsApp Link:" line. 58 carry the invite URL on that
 *     line, and the rest add a note or put the URL after the line.
 *   - 70 have a PIC / project leader / co-leader line. Many of those also hold a personal
 *     phone number or a wa.me link, which this module strips. Only names leave it.
 *   - The Skool "Sales Resources" and "Marketing Resources" links are the collateral that
 *     is not `whatsapp-media`, typed by their Skool label (project-info, fb-ads, reels,
 *     drone-footage, demand-gen, …) by scripts/scrape-skool/to-inventory.ts.
 *
 * Pure: no Firestore and no SDK. Core/shell rule: must NOT import from app/ or next.
 */

import type { ProjectSheet } from './schema'

/** A WhatsApp group invite anywhere in the write-up. The capture is the invite code. */
const WHATSAPP_INVITE = /https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]{10,40})/

/**
 * The project WhatsApp group invite, without its query string ("?mode=ems_copy_c" is a
 * share-tracking tag, and the invite works without it). null when the write-up has none.
 */
export function extractWhatsappGroupUrl(description: string): string | null {
  const m = WHATSAPP_INVITE.exec(description ?? '')
  return m ? `https://chat.whatsapp.com/${m[1]}` : null
}

/** "Project PIC:", "PIC:", "Project Leader:", "Project Co-leader:", "Co-leader:". */
const CONTACT_LINE =
  /^\s*(?:project\s+)?(pic|person\s+in\s+charge|co[\s-]?leader|leader)\s*:(.*)$/i

const MAX_CONTACTS = 6
const MAX_CONTACT_NAME = 60

/**
 * The name part of a contact line, or null. Strips links (wa.me), bracketed remarks,
 * phone numbers and any digit left over, so a phone number cannot survive in any format
 * the corpus uses ("+60 12-345 6789", "0123456789", "012 345 6789").
 */
export function cleanContactName(raw: string): string | null {
  const name = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\([^)]*\)?/g, ' ')
    .replace(/\+?\d[\d\s-]{5,}\d/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[|,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s&/+-]+|[\s&/+-]+$/g, '')
    .trim()
  if (!/\p{L}/u.test(name) || name.length > MAX_CONTACT_NAME) return null
  return name
}

/**
 * The PIC and project leaders named in the write-up, in the order they appear, names only.
 * Reads the value on the label's own line. A label with nothing after it is skipped: in the
 * corpus the next line is then another label, not a name.
 */
export function extractProjectContacts(description: string): ProjectSheet['contacts'] {
  const out: ProjectSheet['contacts'] = []
  const seen = new Set<string>()
  for (const line of (description ?? '').split('\n')) {
    const m = CONTACT_LINE.exec(line)
    if (!m) continue
    const label = m[1].toLowerCase().replace(/\s+/g, ' ')
    const role: ProjectSheet['contacts'][number]['role'] = label.startsWith('co')
      ? 'co_leader'
      : label === 'leader'
        ? 'leader'
        : 'pic'
    const name = cleanContactName(m[2])
    if (!name) continue
    const key = `${role}:${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ role, name })
    if (out.length >= MAX_CONTACTS) break
  }
  return out
}

/** Skool "Marketing Resources" link types. Everything else curated is a project link. */
const MARKETING_TYPES = new Set([
  'fb-ads',
  'reels',
  'drone-footage',
  'showroom-video',
  'demand-gen',
  'teaser',
])

/**
 * Collateral that comes from the WhatsApp archives, not from the Skool page: photos, voice
 * notes and forwarded files, often hundreds per project. The sheet leaves those out. The
 * agent asked for the project and marketing links, and those are the curated ones.
 */
const ARCHIVE_TYPE = 'whatsapp-media'

const MAX_SHEET_LINKS = 12

/** Only http(s) URLs reach the sheet. A bucket path or a malformed string is dropped. */
function isWebUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The project's curated links, project links first, each group in stored order, deduped
 * by URL, capped at MAX_SHEET_LINKS.
 */
export function sheetLinks(collateral: Array<{ type: string; url: string }>): ProjectSheet['links'] {
  const seen = new Set<string>()
  const curated = collateral.filter((c) => {
    if (!c || c.type === ARCHIVE_TYPE || !isWebUrl(c.url) || seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
  const tagged = curated.map((c) => ({
    type: c.type,
    url: c.url,
    group: MARKETING_TYPES.has(c.type) ? ('marketing' as const) : ('project' as const),
  }))
  return [
    ...tagged.filter((l) => l.group === 'project'),
    ...tagged.filter((l) => l.group === 'marketing'),
  ].slice(0, MAX_SHEET_LINKS)
}

/** Build the sheet for one project from its stored record and its unranked collateral. */
export function buildProjectSheet(
  project: { projectId: string; name: string; description: string },
  collateral: Array<{ type: string; url: string }>,
): ProjectSheet {
  return {
    projectId: project.projectId,
    name: project.name,
    contacts: extractProjectContacts(project.description),
    whatsappGroupUrl: extractWhatsappGroupUrl(project.description),
    links: sheetLinks(collateral),
  }
}

/** True when the sheet has anything to show beyond the project's name. */
export function sheetHasContent(sheet: ProjectSheet): boolean {
  return sheet.contacts.length > 0 || sheet.whatsappGroupUrl !== null || sheet.links.length > 0
}
