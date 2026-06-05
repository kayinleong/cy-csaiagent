/**
 * src/memory/leadContext.ts — Agent-scoped leadContext slot writer + finderSlot primitives.
 *
 * `leadContext/{leadId}` is ONE shared doc with three agent-scoped write slots:
 *   - `coachSlot`  — written by the Coach agent only
 *   - `finderSlot` — written by the Finder agent only  ← Phase 3 wires this
 *   - `replySlot`  — written by the Reply agent only
 *
 * Phase 1 wires the Coach slot only. Phase 3 (03-06) wires the Finder slot:
 *   - `FinderSlot` typed shape: {criteria, discussedProjectIds, lastRankedAt}
 *   - `readFinderSlot(leadId)`: returns the stored FinderSlot or null (FIND-06)
 *   - `mergeFinderCriteria(stored, delta)`: merges a criteria delta (FIND-08 re-rank without re-typing)
 *   - `mergeDiscussed(prev, next)`: dedup-union of discussedProjectIds (FIND-06)
 *
 * Security (T-01-21 / T-03-20 — Tampering):
 *   writeLeadSlot is slot-scoped — a single call updates ONLY the named slot
 *   (plus `rollingSummary` if provided, and `updatedAt`). This prevents one pillar
 *   from overwriting another pillar's context by accident or by injection.
 *   Firestore rules (01-03) enforce owner-only writes at the DB level.
 *
 * Core/shell rule: NO imports from app/ or next.
 * References: TSD §4, RESEARCH §Pattern 4/5, FIND-05/06/08, D-06.
 */

import { leadContextRef } from '@/src/firebase/collections'
import type { LeadContextDoc } from '@/src/firebase/collections'
import type { ParsedCriteria } from '@/src/inventory/search'
import { FieldValue } from 'firebase-admin/firestore'

/** The writable agent slots on a leadContext document. */
export type LeadSlot = 'coachSlot' | 'finderSlot' | 'replySlot'

// ─── FinderSlot typed shape (FIND-05, D-06) ────────────────────────────────────

/**
 * Typed shape of the Finder agent's write slot on `leadContext/{leadId}`.
 *
 * Stored and read by the Finder agent only. Enables:
 *   - Mid-conversation re-rank without re-typing (FIND-08 / SC2): `criteria` is the
 *     merged result of all preference shifts so far — the chat route calls
 *     `mergeFinderCriteria(stored, delta)` then `writeLeadSlot('finderSlot', updated)`.
 *   - Returning-client new-launch surfacing (FIND-06): `discussedProjectIds` is the
 *     accumulated set of project IDs already shown so the Finder skips them; paired
 *     with `criteria.since` to surface only new launches.
 *
 * `lastRankedAt` is epoch milliseconds (Date.now()) — framework-free for tests,
 * no Firestore Timestamp dependency in the shape itself.
 */
export interface FinderSlot {
  /** Merged parsed criteria — represents the lead's current expressed preferences. */
  criteria: ParsedCriteria
  /** All project IDs surfaced to this lead so far (dedup union across turns). */
  discussedProjectIds: string[]
  /**
   * Epoch milliseconds of the most recent re-rank.
   * Stored as a plain number (not Firestore Timestamp) so merge + test logic
   * stay framework-free. Set to Date.now() by the chat route after each rank.
   */
  lastRankedAt: number
}

// ─── ReplySlot typed shape (REPLY-03, D-06) ────────────────────────────────────

/**
 * Typed shape of the Reply agent's write slot on `leadContext/{leadId}`.
 *
 * Stored and read by the Reply agent only. Enables per-lead reply context isolation
 * (REPLY-03 / SC2) — the slot is keyed by `leadContext/{leadId}`, so cross-lead bleed
 * is structurally impossible (the same isolation Finder proved). The slot holds:
 *   - `classification`: the parsed inbound classification for this lead.
 *   - `latestDraft`: the last model draft (already PDPA-redacted).
 *   - `sopDocIds`: the SOPs cited by the latest draft (grounding trail).
 *   - `lastDraftedAt`: epoch milliseconds of the most recent draft (mirror lastRankedAt).
 *
 * The slot WRITE happens in the chat route's onFinish (Plan 06), NOT inside a tool —
 * Reply tools are read-only (Pitfall 23/36). This module only provides the reader.
 *
 * `lastDraftedAt` is a plain number (Date.now()) — framework-free for tests, no
 * Firestore Timestamp dependency in the shape itself (mirror FinderSlot.lastRankedAt).
 */
export interface ReplySlot {
  /** Parsed inbound classification for this lead's most recent reply turn. */
  classification: 'cold-prospect' | 'objection' | 'financing' | 'other'
  /** The last model draft for this lead (already PDPA-redacted). */
  latestDraft: string
  /** SOP doc IDs cited by the latest draft (grounding trail). */
  sopDocIds: string[]
  /** Epoch milliseconds of the most recent draft (Date.now()). */
  lastDraftedAt: number
}

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

// ─── readFinderSlot (FIND-06 — returning-client recall) ────────────────────────

/**
 * Read the Finder agent's write slot from `leadContext/{leadId}`.
 *
 * Returns the stored `FinderSlot` for returning-client recall:
 *   - Non-null  → Finder has run before; use stored criteria + discussedProjectIds.
 *   - null      → First touch; no stored criteria yet.
 *
 * Considers the slot "absent" when the doc is missing OR when `finderSlot`
 * is an empty object (the schema default written by Firestore rules bootstrap).
 *
 * @param leadId  The lead document ID (owner of this leadContext doc).
 * @returns       The stored `FinderSlot`, or `null` if absent/empty.
 */
export async function readFinderSlot(leadId: string): Promise<FinderSlot | null> {
  const snap = await leadContextRef().doc(leadId).get()
  if (!snap.exists) return null

  const data = snap.data()
  if (!data) return null

  const slot = data.finderSlot as Record<string, unknown>

  // Empty object = Finder has never written to this slot yet (first-touch)
  if (!slot || Object.keys(slot).length === 0) return null

  return slot as unknown as FinderSlot
}

// ─── readReplySlot (REPLY-03 — per-lead reply context recall) ──────────────────

/**
 * Read the Reply agent's write slot from `leadContext/{leadId}`.
 *
 * Returns the stored `ReplySlot` for per-lead reply context recall:
 *   - Non-null  → Reply has drafted for this lead before; use stored classification.
 *   - null      → First touch; no stored reply context yet.
 *
 * Considers the slot "absent" when the doc is missing OR when `replySlot` is an
 * empty object (the schema default written by Firestore rules bootstrap). This is
 * the SAME empty-object→null semantics as readFinderSlot — copied exactly, reading
 * `data.replySlot` instead of `data.finderSlot`.
 *
 * Per-lead isolation (REPLY-03 / SC2): the slot is keyed by leadId, so reading
 * lead-B never returns lead-A content.
 *
 * @param leadId  The lead document ID (owner of this leadContext doc).
 * @returns       The stored `ReplySlot`, or `null` if absent/empty.
 */
export async function readReplySlot(leadId: string): Promise<ReplySlot | null> {
  const snap = await leadContextRef().doc(leadId).get()
  if (!snap.exists) return null

  const data = snap.data()
  if (!data) return null

  const slot = data.replySlot as Record<string, unknown>

  // Empty object = Reply has never written to this slot yet (first-touch)
  if (!slot || Object.keys(slot).length === 0) return null

  return slot as unknown as ReplySlot
}

// ─── mergeFinderCriteria (FIND-08 — re-rank without re-typing) ─────────────────

/**
 * Merge a criteria delta into stored criteria.
 *
 * Only fields that are explicitly set (not null, not undefined) in `delta`
 * override the `stored` value. This is the "re-rank without re-typing" semantic:
 * when a lead says "my budget is now RM700k", the caller provides
 * `{priceMax: 700_000}` — all other stored fields are preserved.
 *
 * A null/undefined field in `delta` is treated as "no change" and does NOT
 * clobber the stored value. (Compare: `{priceMax: null}` in delta → leave
 * stored.priceMax as-is; only explicit non-null/undefined values apply.)
 *
 * @param stored  The currently-stored `ParsedCriteria` from `readFinderSlot`.
 * @param delta   Partial criteria containing ONLY the fields that changed.
 * @returns       New `ParsedCriteria` with delta fields merged in.
 */
export function mergeFinderCriteria(
  stored: ParsedCriteria,
  delta: Partial<ParsedCriteria>,
): ParsedCriteria {
  // Collect only the delta entries where the value is explicitly defined
  // (not undefined). We intentionally skip undefined — null is a valid
  // "clear" signal in some fields (e.g., priceMin: null), so null passes through
  // only when explicitly provided. The guard below drops undefined-keyed entries.
  const definedDelta = Object.fromEntries(
    Object.entries(delta).filter(([, v]) => v !== undefined),
  ) as Partial<ParsedCriteria>

  return { ...stored, ...definedDelta }
}

// ─── mergeDiscussed (FIND-06 — discussed-project accumulation) ─────────────────

/**
 * Dedup-union of two discussed-projectId arrays.
 *
 * Call this after each Finder turn to accumulate the projects that have been
 * shown to the lead. The returning-client flow compares the stored union
 * against current inventory to surface only NEW launches.
 *
 * @param prev  Previously accumulated project IDs from `finderSlot.discussedProjectIds`.
 * @param next  Project IDs surfaced in the current turn.
 * @returns     Deduped union of both arrays (order: prev first, then new entries from next).
 */
export function mergeDiscussed(prev: string[], next: string[]): string[] {
  const seen = new Set(prev)
  const result = [...prev]
  for (const id of next) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}
