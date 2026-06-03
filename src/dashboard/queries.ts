/**
 * src/dashboard/queries.ts — Downline-scoped Firestore reads for the senior-coach dashboard.
 *
 * AUTH-06 compliance (T-02-28 / D-11):
 *   Every query in this file applies an EXPLICIT `where('seniorCoachId','==',coachUid)`
 *   server-side filter. This is the FIRST gate. Firestore rules (added in 02-01) are
 *   the SECOND gate. Neither gate alone is sufficient — both must hold.
 *
 * PDPA compliance (T-02-29 / TSD §5.1):
 *   Every downline read calls `auditDrilldown(coachUid, <collection>)` to write an
 *   immutable hashes-only audit row. No raw transcript data is returned — the dashboard
 *   shows escalation bundles + summaries only (A6, Pitfall 5).
 *
 * Admin override:
 *   Pass `{ adminAll: true }` to skip the seniorCoachId filter. The read is still
 *   audited (admin drilldown of downline data is also logged).
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * References:
 *   - TSD §4 agentProfiles, escalations, knowledgeGaps
 *   - 02-06-PLAN.md Task 1 (downline query helpers, AUTH-06)
 *   - CDASH-01 (downline list), CDASH-02 (stall inbox), CDASH-03 (knowledge-gap feed)
 */

import { agentProfilesRef, escalationsRef, knowledgeGapsRef } from '@/src/firebase/collections'
import { auditDrilldown } from '@/src/audit/log'

// Re-export auditDrilldown so callers can import it from here (TDD test expects it)
export { auditDrilldown }

// ─── Timestamp normalization ────────────────────────────────────────────────────
// The Admin SDK returns Firestore `Timestamp` objects for timestamp fields, but the
// result types below declare `Date`. The shared converter casts raw (no conversion),
// so we normalize here at the boundary — matching the defensive idiom used in
// src/escalation/detect.ts and src/ratelimit/window.ts. Downstream consumers
// (page.tsx .toISOString(), metrics.daysInJourney .getTime()) then get real Dates.
function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  return new Date(value as string | number)
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A resolved agent profile document with its Firestore document ID. */
export interface DownlineAgent {
  id: string
  data: {
    tenantId: string
    journeyStage: string
    currentCheckpoint: string
    lastActiveAt: Date
    activeLeadIds: string[]
    seniorCoachId: string
  }
}

/** A resolved escalation document with its Firestore document ID. */
export interface StallEscalation {
  id: string
  data: {
    tenantId: string
    agentUid: string
    seniorCoachId: string
    reason: string
    contextBundle: Record<string, unknown>
    status: 'open' | 'resolved' | 'escalated'
    openedAt: Date
  }
}

/** A resolved knowledge-gap document with its Firestore document ID. */
export interface KnowledgeGapItem {
  id: string
  data: {
    tenantId: string
    seniorCoachId: string
    agentUid: string
    topicHash: string
    topicLabel: string
    lang: string
    count: number
    lastSeenAt: Date
  }
}

export interface QueryOptions {
  /** If true, an admin is reading all records (skip seniorCoachId filter — still audited). */
  adminAll?: boolean
}

// ─── getDownline ──────────────────────────────────────────────────────────────

/**
 * Fetch all agent profiles in the coach's downline (CDASH-01 / AUTH-06).
 *
 * Applies `where('seniorCoachId', '==', coachUid)` server-side (AUTH-06 gate 1).
 * Writes an audit row for the coach drilldown (PDPA / TSD §5.1).
 *
 * @param coachUid   UID of the senior coach whose downline to read.
 * @param opts       Optional: { adminAll: true } to skip filter (admin reads all).
 */
export async function getDownline(
  coachUid: string,
  opts?: QueryOptions,
): Promise<DownlineAgent[]> {
  // PDPA: audit this read before the data is returned
  await auditDrilldown(coachUid, 'agentProfiles')

  let query = agentProfilesRef() as unknown as {
    where: (field: string, op: string, value: unknown) => typeof query
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
  }

  // AUTH-06: apply downline filter unless admin is reading all
  if (!opts?.adminAll) {
    query = query.where('seniorCoachId', '==', coachUid)
  }

  const snap = await query.get()

  return snap.docs.map((doc) => {
    const data = doc.data() as DownlineAgent['data']
    return {
      id: doc.id,
      data: { ...data, lastActiveAt: toDate(data.lastActiveAt) },
    }
  })
}

// ─── getOpenStalls ────────────────────────────────────────────────────────────

/**
 * Fetch all open stall escalations for the coach's downline (CDASH-02 / AUTH-06).
 *
 * Uses the composite index on (seniorCoachId, status) — declared in 02-01.
 * Applies `where('seniorCoachId', '==', coachUid).where('status', '==', 'open')`.
 * Writes an audit row (PDPA / TSD §5.1).
 *
 * @param coachUid   UID of the senior coach.
 * @param opts       Optional: { adminAll: true } for admin reads.
 */
export async function getOpenStalls(
  coachUid: string,
  opts?: QueryOptions,
): Promise<StallEscalation[]> {
  // PDPA: audit this read
  await auditDrilldown(coachUid, 'escalations')

  let query = escalationsRef() as unknown as {
    where: (field: string, op: string, value: unknown) => typeof query
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
  }

  // AUTH-06: apply downline filter unless admin is reading all
  if (!opts?.adminAll) {
    query = query.where('seniorCoachId', '==', coachUid)
  }

  // Filter to open stalls only
  query = query.where('status', '==', 'open')

  const snap = await query.get()

  return snap.docs.map((doc) => {
    const data = doc.data() as StallEscalation['data']
    return {
      id: doc.id,
      data: { ...data, openedAt: toDate(data.openedAt) },
    }
  })
}

// ─── getKnowledgeGaps ─────────────────────────────────────────────────────────

/**
 * Fetch the knowledge-gap feed for the coach's downline (CDASH-03 / AUTH-06).
 *
 * Reads the `knowledgeGaps` collection ordered by `lastSeenAt desc`.
 * The composite index (seniorCoachId + lastSeenAt) is declared in 02-01.
 * Writes an audit row (PDPA / TSD §5.1).
 *
 * PDPA: the knowledge-gap store only contains topicLabel (PDPA-safe short label)
 * and topicHash — no raw query text, no agent PII (A3, T-02-32).
 *
 * @param coachUid   UID of the senior coach.
 * @param opts       Optional: { adminAll: true } for admin reads.
 */
export async function getKnowledgeGaps(
  coachUid: string,
  opts?: QueryOptions,
): Promise<KnowledgeGapItem[]> {
  // PDPA: audit this read
  await auditDrilldown(coachUid, 'knowledgeGaps')

  let query = knowledgeGapsRef() as unknown as {
    where: (field: string, op: string, value: unknown) => typeof query
    orderBy: (field: string, direction: 'asc' | 'desc') => typeof query
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
  }

  // AUTH-06: apply downline filter unless admin
  if (!opts?.adminAll) {
    query = query.where('seniorCoachId', '==', coachUid)
  }

  // Order by most-recently-seen first
  query = query.orderBy('lastSeenAt', 'desc')

  const snap = await query.get()

  return snap.docs.map((doc) => {
    const data = doc.data() as KnowledgeGapItem['data']
    return {
      id: doc.id,
      data: { ...data, lastSeenAt: toDate(data.lastSeenAt) },
    }
  })
}
