/**
 * client-workbook-safety.ts — the import-free safety kernel of the client project info
 * sheet ingest (quick-kayinleong-096).
 *
 * WHY THIS FILE HAS NO RUNTIME IMPORTS. `src/firebase/collections.ts` imports `adminDb` at
 * module load, so ANY value import from it initialises the Firebase Admin SDK. The CLIs
 * must run `assertSafeTarget` BEFORE that happens, otherwise a wrong environment would
 * already hold live credentials by the time the guard refuses. This module therefore uses
 * `import type` only (erased at compile time) and may be loaded first, safely.
 *
 * It holds four things:
 *   - the actor / source constants shared by the importer and the backfill guards;
 *   - `assertSafeTarget`  — the env guard (emulator needs a `demo-` id, live needs the
 *                           one production project id, anything else refuses);
 *   - `isClientWorkbookField` — the re-run guard the three backfill scripts consult;
 *   - `scanForContactDetails` — the contact-detail scanner (class names only, never the
 *                           matched text), kept semantically identical to the Python
 *                           `scan_contact_details` in the claim directory.
 *
 * The guard never reads or prints any credential variable. It looks only at the two
 * project-id variables and the emulator host.
 */

import type { ClientWorkbookField } from '@/src/firebase/collections'

/** `ProjectDoc.priceSource` value written when the lowest nett price came from the sheet. */
export const CLIENT_WORKBOOK_SOURCE = 'client-workbook' as const

/** Synthetic audit actor for project writes (precedent: `skool-import-039`). */
export const CLIENT_WORKBOOK_ACTOR = 'client-workbook-import-096'

/** Synthetic audit actor for the fact-sheet ingest. */
export const CLIENT_FACTSHEET_ACTOR = 'client-factsheets-096'

/** The one production Firebase project the live path may touch. */
export const LIVE_PROJECT_ID = 'cy-csaiagent'

export type SafeTarget = 'emulator' | 'live'

/**
 * Refuse to run unless the target is the Firestore emulator on a `demo-` project, or the
 * single production project.
 *
 *  - `FIRESTORE_EMULATOR_HOST` non-empty: the project id (`FIREBASE_PROJECT_ID`, else
 *    `GCLOUD_PROJECT`) must start with `demo-`. An emulator host paired with a real
 *    project id is refused, because that combination is how a test run ends up pointed
 *    at production data with an emulator-shaped confidence.
 *  - otherwise `FIREBASE_PROJECT_ID === LIVE_PROJECT_ID` means 'live'.
 *  - anything else throws.
 */
export function assertSafeTarget(
  env: Readonly<Record<string, string | undefined>>,
): SafeTarget {
  const emulatorHost = (env.FIRESTORE_EMULATOR_HOST ?? '').trim()
  if (emulatorHost !== '') {
    const projectId = (env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || '').trim()
    if (projectId.startsWith('demo-')) return 'emulator'
    throw new Error(
      `refusing to run: FIRESTORE_EMULATOR_HOST is set but the project id is ` +
        `"${projectId === '' ? 'unset' : projectId}"; an emulator run needs a demo- project id`,
    )
  }
  const projectId = env.FIREBASE_PROJECT_ID
  if (projectId === LIVE_PROJECT_ID) return 'live'
  throw new Error(
    `refusing to run: FIREBASE_PROJECT_ID is "${
      projectId === undefined || projectId === '' ? 'unset' : projectId
    }"; expected ${LIVE_PROJECT_ID} or the emulator`,
  )
}

/** The price group: a client-workbook `priceSource` protects all four of these. */
const PRICE_GROUP: ReadonlySet<ClientWorkbookField> = new Set<ClientWorkbookField>([
  'priceValue',
  'priceBand',
  'priceProvenance',
  'priceSource',
])

/**
 * True when `field` of this project doc is owned by the client sheet, so a re-run script
 * must leave it alone (D4). Each guard checks exactly the field it would write.
 *
 *  - `data.clientWorkbookFields` is an array containing `field`; or
 *  - `field` is in the price group and `data.priceSource === 'client-workbook'`.
 */
export function isClientWorkbookField(
  data: Readonly<Record<string, unknown>>,
  field: ClientWorkbookField,
): boolean {
  const list = data.clientWorkbookFields
  if (Array.isArray(list) && list.includes(field)) return true
  if (PRICE_GROUP.has(field) && data.priceSource === CLIENT_WORKBOOK_SOURCE) return true
  return false
}

/**
 * Contact-detail classes, in the order they are reported. Same patterns as the Python
 * `scan_contact_details`; all case-insensitive. The patterns live here, not in
 * `src/audit/pdpa.ts`, because that module's regexes are private and miss local-format
 * numbers ("012-000 0000") and URLs.
 */
const CONTACT_PATTERNS: ReadonlyArray<readonly [string, readonly RegExp[]]> = [
  ['email', [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i]],
  [
    'url',
    [
      /https?:\/\/\S+/i,
      /\bwww\.\S+/i,
      /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|my|net|org|io|co|biz|info|asia)(?:\.[a-z]{2})?\b/i,
    ],
  ],
  ['wa.me', [/\bwa\.me\b/i]],
  [
    'phone',
    [
      /(?<![0-9A-Za-z,.])\+?\d(?:[ -]?\d){8,12}(?![0-9A-Za-z,])/i,
      /\(0\d{1,2}\)\s?\d{3,4}[ -]?\d{4}/i,
    ],
  ],
  ['ic', [/(?<!\d)\d{6}-\d{2}-\d{4}(?!\d)/i]],
]

/**
 * Report which classes of contact detail a string contains. Returns CLASS NAMES ONLY,
 * never the matched text, so the result is safe to log and to put in an error message.
 */
export function scanForContactDetails(text: string): string[] {
  const hits: string[] = []
  for (const [name, patterns] of CONTACT_PATTERNS) {
    if (patterns.some((p) => p.test(text))) hits.push(name)
  }
  return hits
}
