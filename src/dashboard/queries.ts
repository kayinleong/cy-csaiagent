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

import {
  agentProfilesRef,
  escalationsRef,
  knowledgeGapsRef,
  usageRollupsRef,
} from '@/src/firebase/collections'
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

// Normalize any Firestore Timestamp values nested inside an escalation's
// contextBundle to plain Dates. The bundle is a flat Record<string, unknown>
// (e.g. { lastActiveAt } for stalls, { topic, lang, conversationId } for kb_miss)
// that page.tsx passes straight into the StallInbox client island — and a raw
// Timestamp is a class instance that cannot cross the RSC→Client boundary
// ("Only plain objects… can be passed to Client Components"). A Timestamp is
// detected by its toDate() method and converted via toDate(); every non-Timestamp
// value (strings/numbers/booleans) is preserved verbatim. `Date` is a supported
// serializable built-in, so the returned bundle is fully serializable.
function serializeContextBundle(
  bundle: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!bundle) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(bundle)) {
    out[key] =
      value && typeof (value as { toDate?: () => Date }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : value
  }
  return out
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
      data: {
        ...data,
        openedAt: toDate(data.openedAt),
        contextBundle: serializeContextBundle(data.contextBundle),
      },
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

// ─── Agent profile (PROF-01 / PROF-02 / D-04 / D-05) ────────────────────────────

/**
 * Error thrown when a non-downline coach tries to read an agent's profile (D-05).
 * The page gate (requireRole) is gate 1; this seniorCoachId match is the app-side
 * downline gate; the agentProfiles Firestore rule is gate 3 (AUTH-06 double-gate).
 */
export class NotInDownlineError extends Error {
  constructor(msg = 'Agent is not in your downline') {
    super(msg)
    this.name = 'NotInDownlineError'
  }
}

/**
 * A composed, READ-ONLY agent profile (D-04 — NO journey-edit path anywhere).
 *
 * Composes EXISTING data only: the agentProfiles doc (+ cohortId / firstCloseAt),
 * that agent's usageRollups, escalation + knowledge-gap counts, and the read-time
 * days-to-first-close. There is intentionally NO write surface here — the profile
 * is a pure projection (PROF-01 / D-04).
 */
export interface AgentProfile {
  id: string
  journeyStage: string
  currentCheckpoint: string
  seniorCoachId: string
  lastActiveAt: Date
  activeLeadIds: string[]
  /** Cohort membership (COH-02 / D-02) — absent on pre-Phase-7 agents. */
  cohortId: string | null
  /** First-close signal (CLOSE-01 / D-20) — null when no close recorded. */
  firstCloseAt: Date | null
  /** Onboarding start = the agentProfiles doc createTime (Pitfall 4, zero-migration). */
  onboardingStart: Date | null
  /** Read-time days-to-first-close (CLOSE-02 / D-22) — null when no close → em-dash. */
  daysToFirstClose: number | null
  /** Count of escalations attributed to this agent (counts only — no content). */
  escalationCount: number
  /** Count of knowledge-gap rows attributed to this agent (counts only). */
  knowledgeGapCount: number
  /** Total tokens across this agent's usageRollups (counts only). */
  totalTokens: number
}

/**
 * Read-time days-to-first-close (CLOSE-02 / D-22).
 *
 * = firstCloseAt − onboardingStart, in WHOLE days. Returns null when there is no
 * recorded close (absent firstCloseAt → the UI renders an em-dash, NOT 0/N/A).
 *
 * onboardingStart MUST be the agentProfiles doc `createTime` (Admin SDK metadata —
 * Pitfall 4 / Open Q1 zero-migration default). NEVER lastActiveAt (which drifts
 * every session and would understate ramp time). Computed read-time — no stored
 * metric (D-22).
 *
 * @param onboardingStart  The agentProfiles doc createTime.
 * @param firstCloseAt     The recorded first-close timestamp, or undefined.
 */
export function daysToFirstClose(onboardingStart: Date, firstCloseAt?: Date): number | null {
  if (!firstCloseAt) return null
  const ms = firstCloseAt.getTime() - onboardingStart.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/**
 * Compose a single agent's read-only profile (PROF-01 / PROF-02 / D-04 / D-05).
 *
 * AUTH-06 / D-05 (downline gate, gate 1): a non-admin coach may only read an agent
 * whose `agentProfiles.seniorCoachId === coachUid`; otherwise NotInDownlineError.
 * Admin reads any agent via `opts.adminAll`.
 *
 * PDPA / PROF-02 (T-02-29): `auditDrilldown(coachUid, 'agentProfiles')` is written
 * BEFORE the doc is read — the audit ALWAYS precedes data access.
 *
 * The profile is a pure read-time composition of existing collections. There is NO
 * journey-state write path here (D-04) — the route renders no edit affordance.
 *
 * @param coachUid   The reading coach's (or admin's) UID — the audit actor + downline key.
 * @param agentUid   The agent whose profile to compose.
 * @param opts       { adminAll: true } to skip the downline gate (admin reads all).
 */
export async function getAgentProfile(
  coachUid: string,
  agentUid: string,
  opts?: QueryOptions,
): Promise<AgentProfile> {
  // PROF-02: audit the drilldown BEFORE any read (ordering, T-02-29).
  await auditDrilldown(coachUid, 'agentProfiles')

  const profileDocRef = (agentProfilesRef() as unknown as {
    doc: (id: string) => {
      get: () => Promise<{
        exists: boolean
        createTime?: { toDate: () => Date }
        data: () => Record<string, unknown> | undefined
      }>
    }
  }).doc(agentUid)

  const snap = await profileDocRef.get()
  if (!snap.exists) {
    throw new NotInDownlineError('Agent profile not found')
  }

  const data = (snap.data() ?? {}) as {
    journeyStage?: string
    currentCheckpoint?: string
    seniorCoachId?: string
    lastActiveAt?: unknown
    activeLeadIds?: string[]
    cohortId?: string
    firstCloseAt?: unknown
  }

  // D-05 downline gate (gate 1): a non-admin coach is denied a non-downline agent.
  if (!opts?.adminAll && data.seniorCoachId !== coachUid) {
    throw new NotInDownlineError()
  }

  // onboardingStart = doc createTime (Pitfall 4 zero-migration); NEVER lastActiveAt.
  const onboardingStart = snap.createTime ? snap.createTime.toDate() : null
  const firstCloseAt = data.firstCloseAt ? toDate(data.firstCloseAt) : null
  const days =
    onboardingStart && firstCloseAt
      ? daysToFirstClose(onboardingStart, firstCloseAt)
      : null

  // ── Compose counts from existing collections (counts only — no PII content) ──
  type CountableRef = {
    where: (field: string, op: string, value: unknown) => CountableRef
    get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }>
  }

  const escSnap = await (escalationsRef() as unknown as CountableRef)
    .where('agentUid', '==', agentUid)
    .get()
  const gapSnap = await (knowledgeGapsRef() as unknown as CountableRef)
    .where('agentUid', '==', agentUid)
    .get()
  const usageSnap = await (usageRollupsRef() as unknown as CountableRef)
    .where('uid', '==', agentUid)
    .get()

  const totalTokens = usageSnap.docs.reduce((sum, d) => {
    const data = d.data()
    const inTok = typeof data.inputTokens === 'number' ? data.inputTokens : 0
    const outTok = typeof data.outputTokens === 'number' ? data.outputTokens : 0
    return sum + inTok + outTok
  }, 0)

  return {
    id: agentUid,
    journeyStage: data.journeyStage ?? 'onboarding',
    currentCheckpoint: data.currentCheckpoint ?? 'start',
    seniorCoachId: data.seniorCoachId ?? '',
    lastActiveAt: toDate(data.lastActiveAt),
    activeLeadIds: data.activeLeadIds ?? [],
    cohortId: data.cohortId ?? null,
    firstCloseAt,
    onboardingStart,
    daysToFirstClose: days,
    escalationCount: escSnap.docs.length,
    knowledgeGapCount: gapSnap.docs.length,
    totalTokens,
  }
}

// ─── days-to-first-close aggregate (CLOSE-02 / D-22) ────────────────────────────

/** Org/cohort aggregate of days-to-first-close over agents WITH a recorded close. */
export interface DaysToCloseAggregate {
  /** Mean days-to-first-close over agents with a close — null when none. */
  avg: number | null
  /** Median days-to-first-close over agents with a close — null when none. */
  median: number | null
  /** Count of agents with a recorded close (the denominator). */
  closedCount: number
}

/**
 * Aggregate days-to-first-close across a set of per-agent samples (D-22).
 *
 * Only agents WITH a recorded close contribute (a null sample = no close yet and
 * is excluded — never counted as 0, which would understate ramp time). Returns
 * { avg: null, median: null, closedCount: 0 } when no agent has closed.
 *
 * @param samples  Per-agent daysToFirstClose values (null = no close → excluded).
 */
export function aggregateDaysToFirstClose(samples: Array<number | null>): DaysToCloseAggregate {
  const closed = samples.filter((s): s is number => s !== null)
  if (closed.length === 0) {
    return { avg: null, median: null, closedCount: 0 }
  }
  const avg = closed.reduce((a, b) => a + b, 0) / closed.length
  const sorted = [...closed].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return { avg, median, closedCount: closed.length }
}

/**
 * Org/cohort days-to-first-close aggregate over ALL agent profiles (CLOSE-02 / D-22).
 *
 * Read-time composition (NO stored metric, NO new pipeline — D-22): reads the
 * agentProfiles collection, computes each agent's days-to-first-close from the doc
 * `createTime` (onboardingStart, Pitfall 4 zero-migration) + `firstCloseAt`, and
 * folds them through `aggregateDaysToFirstClose`. Agents with no recorded close are
 * excluded from the average (never counted as 0 — that would understate ramp time);
 * the UI renders an em-dash when `closedCount === 0`.
 *
 * Admin scope only (the org/cohort aggregate is an admin Analytics surface — D-24).
 * Caller is expected to have gated to admin before invoking.
 *
 * @param opts.cohortId  Optional cohort filter — aggregate over one cohort only.
 */
export async function getOrgDaysToFirstClose(opts?: {
  cohortId?: string
}): Promise<DaysToCloseAggregate> {
  let query = agentProfilesRef() as unknown as {
    where: (field: string, op: string, value: unknown) => typeof query
    get: () => Promise<{
      docs: Array<{
        createTime?: { toDate: () => Date }
        data: () => Record<string, unknown>
      }>
    }>
  }

  if (opts?.cohortId) {
    query = query.where('cohortId', '==', opts.cohortId)
  }

  let snap: Awaited<ReturnType<typeof query.get>>
  try {
    snap = await query.get()
  } catch {
    // Non-blocking — surface the empty aggregate (em-dash) on a read failure.
    return { avg: null, median: null, closedCount: 0 }
  }

  const samples = snap.docs.map((doc) => {
    const data = (doc.data() ?? {}) as { firstCloseAt?: unknown }
    const onboardingStart = doc.createTime ? doc.createTime.toDate() : null
    const firstCloseAt = data.firstCloseAt ? toDate(data.firstCloseAt) : undefined
    return onboardingStart ? daysToFirstClose(onboardingStart, firstCloseAt) : null
  })

  return aggregateDaysToFirstClose(samples)
}
