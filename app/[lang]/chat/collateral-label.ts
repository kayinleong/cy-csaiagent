/**
 * app/[lang]/chat/collateral-label.ts — turn a collateral URL into something an agent can
 * read (quick-kayinleong-062).
 *
 * Every attachment on a match card used to be labelled with the raw `type` field off the
 * collateral document, which for a WhatsApp import is the string "whatsapp-media" for all
 * of them. Three identical chips, and the only way to tell the sales kit from a floor-plan
 * photo was to open all three.
 *
 * The filename is already in the URL — a Firebase download URL percent-encodes the storage
 * path — so this recovers it rather than asking anyone to re-tag 12,000 assets.
 *
 * Pure, no React, no Firebase: match-list.tsx is a client component and importing the
 * server-side collateral helpers would drag the AI SDK and Admin SDK into the browser
 * bundle (the same reason `isWebUrl` is inlined there).
 */

/** Coarse file class — drives the icon and the suffix badge. */
export type CollateralKind = 'pdf' | 'image' | 'video' | 'doc' | 'sheet' | 'folder' | 'link'

export interface CollateralPresentation {
  /** What the agent reads. Never empty. */
  label: string
  kind: CollateralKind
  /** Short uppercase tag ("PDF", "JPG"). Empty when there is no meaningful extension. */
  ext: string
}

const KIND_BY_EXT: Record<string, CollateralKind> = {
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image',
  mp4: 'video', mov: 'video', avi: 'video', webm: 'video', mkv: 'video',
  doc: 'doc', docx: 'doc', txt: 'doc', rtf: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet',
  ppt: 'doc', pptx: 'doc',
}

/**
 * The last path segment of a URL, percent-decoded, with the query string dropped.
 * Returns '' when there is nothing usable — a bare origin, a folder link, or a malformed
 * URL.
 */
function fileNameFromUrl(url: string): string {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return ''
  }

  const last = pathname.split('/').filter(Boolean).pop() ?? ''
  if (!last) return ''

  // A Firebase download URL keeps the whole storage path in ONE segment, percent-encoded:
  // /o/collateral%2F<id>%2Fwhatsapp%2FSales%20Kit.pdf
  let decoded: string
  try {
    decoded = decodeURIComponent(last)
  } catch {
    decoded = last
  }
  return decoded.split('/').filter(Boolean).pop() ?? ''
}

/** "whatsapp-media" -> "WhatsApp media"; "project-info" -> "Project info". */
function humanizeType(type: string): string {
  const spaced = type.replace(/[-_]+/g, ' ').trim()
  if (!spaced) return 'Attachment'
  const cased = spaced.charAt(0).toUpperCase() + spaced.slice(1)
  // One special case worth spelling correctly — it is on most of this KB.
  return cased.replace(/\bwhatsapp\b/i, 'WhatsApp')
}

/**
 * Tidy a raw filename into something readable: drop the extension, collapse separators,
 * and trim the export noise WhatsApp bakes into every file it saves.
 */
function tidy(stem: string): string {
  let out = stem
    // IMG-20250421-WA0051 / VID-20250317-WA0058 — a date and a counter, no information.
    .replace(/^(IMG|VID|AUD|DOC)-\d{8}-WA\d+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // A trailing "-1" / "(1)" from a duplicate download adds nothing.
  out = out.replace(/[\s-]*\(?\d\)?$/, '').trim()
  return out
}

/**
 * Present one collateral item.
 *
 * Falls back to the item's `type` when the URL carries no usable filename (a Drive folder
 * link, for instance) — it is a weak label but it is the only true one available, and
 * inventing a nicer name would be describing a file this code has never seen.
 */
export function presentCollateral(item: { type: string; url: string }): CollateralPresentation {
  // A Drive folder link ends in an opaque folder ID, never a filename. Decided first so
  // "1auoNymTGsg_oBHV1zjHtgEuLWxO34i3L" can never reach the card as a label.
  if (/drive\.google\.com\/drive\/folders/i.test(item.url)) {
    return { label: humanizeType(item.type), kind: 'folder', ext: '' }
  }

  const name = fileNameFromUrl(item.url)
  const dot = name.lastIndexOf('.')
  const rawExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const ext = rawExt.length > 0 && rawExt.length <= 5 ? rawExt : ''
  const stem = dot > 0 ? name.slice(0, dot) : name

  const tidied = tidy(stem)
  const kind = KIND_BY_EXT[ext] ?? 'link'

  // An extensionless, space-free, long token is an opaque ID, not a name. Showing it would
  // be the same defect as showing the projectId instead of the project name.
  const looksLikeAnId = ext === '' && tidied.length > 20 && !tidied.includes(' ')

  if (tidied.length === 0 || looksLikeAnId) {
    return { label: humanizeType(item.type), kind, ext: ext.toUpperCase() }
  }

  return { label: tidied, kind, ext: ext.toUpperCase() }
}
