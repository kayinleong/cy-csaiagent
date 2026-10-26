/**
 * scripts/fix-uat-location-and-type.plan.ts — the pure planner behind the quick-kayinleong-098
 * data patch. No Firebase and no network, so it is unit-tested directly
 * (scripts/fix-uat-location-and-type.test.ts) and the CLI can load it before any credentials.
 *
 * WHAT IT CORRECTS, AND WHY THESE RECORDS ONLY
 *
 * Location text. Each of the four strings below carries a region tag that contradicts the
 * client's own project sheet (Raw Data, 20 Oct 2026) or the project's real address. The tags
 * pull the projects into searches for areas they are not in:
 *   - Alstonia Hilltop Homes: "KL North (Mont Kiara/Dutamas region)" put a Sungai Buloh project
 *     in a North Kiara search (UAT F5). The client sheet says "Bukit Rahman Putra (BRP), Sungai
 *     Buloh, Selangor".
 *   - St. Regis Residences: "(Mont Kiara/Dutamas area, KL North)" on a KL Sentral address.
 *   - Rimbun Saujana Residency: "KL West/PJ/Subang region" on a Shah Alam project put it in
 *     Subang searches. The client sheet says "Shah Alam, Selangor".
 *   - d'Brightton titiwangsa: "near Taman Tasik Titiwangsa, KLCC" read as a KLCC address
 *     (UAT F9). The code fix in src/inventory/search.ts already handles it; joining the two
 *     landmarks with "and" makes the record unambiguous on its own.
 * Every correction is gated on the stored text still being exactly the 2026-10-20 value. A
 * record an admin has edited since is reported and left alone.
 *
 * Property type. The four non-residential projects are tagged 'commercial'. Untagged projects
 * already resolve to residential through `propertyTypeOf`, and these four would resolve to
 * commercial by name too. The explicit tag makes the record correct without depending on its
 * name.
 *
 * Deliberately NOT here: the OAKA price (D-014, Derek's call), Binastra Cochrane (not loaded;
 * it would flip F11/F19) and appending the client sheet's Area everywhere (deferred by 096).
 */

export type PatchField = 'locationText' | 'propertyType'

export interface PlannedChange {
  docId: string
  name: string
  field: PatchField
  /** The stored value now. null = the field is absent. */
  before: string | null
  /** The value to write. null = delete the field (restore of an absent value only). */
  after: string | null
  why: string
}

export interface SkippedChange {
  docId: string
  name: string
  field: PatchField
  reason: string
}

export interface LocationFix {
  docId: string
  name: string
  /** The exact 2026-10-20 value. The fix applies only while the record still holds it. */
  expectedBefore: string
  after: string
  why: string
}

export const LOCATION_FIXES: readonly LocationFix[] = [
  {
    docId: 'ZAtRBLvFIfa04tuOnDcr',
    name: 'Alstonia Hilltop Homes',
    expectedBefore: 'Bukit Rahman Putra, Sungai Buloh, KL North (Mont Kiara/Dutamas region)',
    after: 'Bukit Rahman Putra (BRP), Sungai Buloh, Selangor',
    why: 'Sungai Buloh is not in the Mont Kiara/Dutamas region (UAT F5). Text is the client sheet Area.',
  },
  {
    docId: '8UKNRsEYVyFqZFp0wt5Q',
    name: 'St. Regis Residences Kuala Lumpur',
    expectedBefore: 'KL Sentral, Kuala Lumpur (Mont Kiara/Dutamas area, KL North)',
    after: 'KL Sentral, Kuala Lumpur',
    why: 'A KL Sentral project tagged as Mont Kiara/Dutamas passes a North Kiara search.',
  },
  {
    docId: 'gxA6UXHk7dRuQToxKwP4',
    name: 'Rimbun Saujana Residency',
    expectedBefore: 'Shah Alam, KL West/PJ/Subang region',
    after: 'Shah Alam, Selangor',
    why: 'A Shah Alam project tagged "PJ/Subang region" passes a Subang search. Text is the client sheet Area.',
  },
  {
    docId: 'y28FP6lqDrEuGEbz9u3u',
    name: "d'Brightton titiwangsa",
    expectedBefore: 'Jalan Tiara Titiwangsa, KL East; near Taman Tasik Titiwangsa, KLCC',
    after: 'Jalan Tiara Titiwangsa, KL East; near Taman Tasik Titiwangsa and KLCC',
    why: 'The trailing ", KLCC" read as a KLCC address (UAT F9). KLCC stays, as a landmark.',
  },
]

export const COMMERCIAL_PROJECTS: ReadonlyArray<{ docId: string; name: string; why: string }> = [
  { docId: 'UyAt3rBJpmkv1GXZg73E', name: 'Aspire office @ KL ecocity', why: 'Office development (UAT N2).' },
  { docId: '8vxV90uXgjCKUvmJKQT7', name: 'The Stride Office @ BBCC', why: 'Office development.' },
  {
    docId: 'Dqv8WfbY7tRC9plczVtZ',
    name: 'E&O – City of Elmina (Laman Embun Commercial)',
    why: '2–3 storey commercial shops on commercial land.',
  },
  { docId: 'pSgeXCmr9VEVl1ha6uvG', name: 'The MET, Corporate Tower', why: 'Grade A office tower.' },
]

/** The slice of a stored project the planner reads. */
export interface StoredProject {
  name?: string
  locationText?: string
  propertyType?: string
}

function current(doc: StoredProject | undefined, field: PatchField): string | null {
  const v = doc?.[field]
  return typeof v === 'string' ? v : null
}

/** Plan the forward patch against the live records. Pure. */
export function planPatch(docs: ReadonlyMap<string, StoredProject>): {
  changes: PlannedChange[]
  skipped: SkippedChange[]
} {
  const changes: PlannedChange[] = []
  const skipped: SkippedChange[] = []

  for (const fix of LOCATION_FIXES) {
    const doc = docs.get(fix.docId)
    const now = current(doc, 'locationText')
    if (!doc) {
      skipped.push({ docId: fix.docId, name: fix.name, field: 'locationText', reason: 'record not found' })
    } else if (now === fix.after) {
      skipped.push({ docId: fix.docId, name: fix.name, field: 'locationText', reason: 'already corrected' })
    } else if (now !== fix.expectedBefore) {
      skipped.push({
        docId: fix.docId,
        name: fix.name,
        field: 'locationText',
        reason: 'location text changed since 2026-10-20; left alone for a human to review',
      })
    } else {
      changes.push({ docId: fix.docId, name: fix.name, field: 'locationText', before: now, after: fix.after, why: fix.why })
    }
  }

  for (const p of COMMERCIAL_PROJECTS) {
    const doc = docs.get(p.docId)
    const now = current(doc, 'propertyType')
    if (!doc) {
      skipped.push({ docId: p.docId, name: p.name, field: 'propertyType', reason: 'record not found' })
    } else if (now === 'commercial') {
      skipped.push({ docId: p.docId, name: p.name, field: 'propertyType', reason: 'already tagged commercial' })
    } else {
      changes.push({ docId: p.docId, name: p.name, field: 'propertyType', before: now, after: 'commercial', why: p.why })
    }
  }

  return { changes, skipped }
}

/**
 * Plan the inverse of an applied patch, from its backup. Pure.
 *
 * A field is restored only while it still holds the value the patch wrote. Anything edited
 * since is reported and left alone, so a restore cannot clobber a later human edit.
 */
export function planRestore(
  backup: ReadonlyArray<PlannedChange>,
  docs: ReadonlyMap<string, StoredProject>,
): { changes: PlannedChange[]; skipped: SkippedChange[] } {
  const changes: PlannedChange[] = []
  const skipped: SkippedChange[] = []
  for (const c of backup) {
    const now = current(docs.get(c.docId), c.field)
    if (now !== c.after) {
      skipped.push({ docId: c.docId, name: c.name, field: c.field, reason: 'value changed since the patch; left alone' })
    } else {
      changes.push({ ...c, before: now, after: c.before, why: `restore: ${c.why}` })
    }
  }
  return { changes, skipped }
}

/**
 * Canonical serialisation the fingerprint is taken over. Order-independent, and it covers
 * exactly what will be written (doc, field, before, after).
 */
export function fingerprintInput(changes: ReadonlyArray<PlannedChange>): string {
  return JSON.stringify(
    changes
      .map((c) => [c.docId, c.field, c.before, c.after] as const)
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
  )
}
