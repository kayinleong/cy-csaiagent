/**
 * src/memory/leadContext.ts — Agent-scoped leadContext slot writer.
 *
 * `leadContext/{leadId}` is ONE shared doc with three agent-scoped write slots:
 *   - `coachSlot`  — written by the Coach agent only
 *   - `finderSlot` — written by the Finder agent only
 *   - `replySlot`  — written by the Reply agent only
 *
 * Phase 1 wires the Coach slot only. The Finder/Reply slots exist in the schema
 * from day 1 but no agent writes to them yet.
 *
 * Security (T-01-21 — Tampering):
 *   writeLeadSlot is slot-scoped — a single call updates ONLY the named slot
 *   (plus `rollingSummary` if provided, and `updatedAt`). This prevents one pillar
 *   from overwriting another pillar's context by accident or by injection.
 *   Firestore rules (01-03) enforce owner-only writes at the DB level.
 *
 * References: TSD §4, RESEARCH §Pattern 4, FND-05.
 */

import { leadContextRef } from '@/src/firebase/collections'
import type { LeadContextDoc } from '@/src/firebase/collections'
import { FieldValue } from 'firebase-admin/firestore'

/** The writable agent slots on a leadContext document. */
export type LeadSlot = 'coachSlot' | 'finderSlot' | 'replySlot'

/**
 * Update a single agent-scoped slot on `leadContext/{leadId}`.
 *
 * ONLY the named slot (+ optionally rollingSummary + updatedAt) is written.
 * Other slots are untouched — this is the slot-isolation contract.
 *
 * @param leadId   The lead document ID.
 * @param slot     Which slot to write ('coachSlot' | 'finderSlot' | 'replySlot').
 * @param value    The slot value (arbitrary JSON — typed as the slot's record type).
 * @param summary  Optional: if provided, also updates `rollingSummary`.
 */
export async function writeLeadSlot(
  leadId: string,
  slot: LeadSlot,
  value: LeadContextDoc[LeadSlot],
  summary?: string
): Promise<void> {
  // Build a slot-scoped update object — only the named slot is touched.
  const update: Partial<LeadContextDoc> & { updatedAt: FieldValue } = {
    [slot]: value,
    updatedAt: FieldValue.serverTimestamp(),
  } as Partial<LeadContextDoc> & { updatedAt: FieldValue }

  // Only include rollingSummary if the caller provides one.
  // An empty-string summary is a deliberate clear — undefined means "leave as-is".
  if (summary !== undefined) {
    (update as Record<string, unknown>)['rollingSummary'] = summary
  }

  await leadContextRef().doc(leadId).update(update as Record<string, unknown>)
}
