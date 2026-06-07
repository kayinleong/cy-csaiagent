/**
 * src/usage/rollup.ts — usageEvents → usageRollups aggregation.
 *
 * rollupUsage(day) aggregates all usageEvents for a given day into
 * per-(uid, pillar) usageRollups documents using Firestore server-side
 * AggregateField.sum()/count() — NEVER fetch-all-then-sum (Pitfall 4).
 *
 * Key design decisions:
 *   - GROUP DISCOVERY via a bounded select('uid','pillar') projection (mirrors
 *     getReplyQualityMetrics :402-407). Never fetch full docs.
 *   - ONE aggregation per (uid, pillar) group (RESEARCH Pattern 2). The
 *     (day, uid, pillar) composite index (05-02) makes each aggregation 1 read-unit.
 *   - IDEMPOTENT via set(merge:true) keyed `${day}__${uid}__${pillar}` — re-running
 *     overwrites the rollup doc with the recomputed-from-source value; never accumulates
 *     (Pitfall 3 double-count guard).
 *   - RESOLUTION TIME from escalations where resolvedAt is set (openedAt→resolvedAt delta),
 *     scoped to the (uid, pillar) pair.
 *   - ESCALATION RATE reuses the computeEscalationRate-style open/total count.
 *
 * Called by the 'usage-rollup' lazy-cron JOB_REGISTRY entry in runDueJobs.ts.
 * The runJob DUE-gate txn gives exactly-once-per-window — the rollup body only
 * needs to be idempotent (which it is, via set-merge recompute-from-source).
 *
 * Requirements: QUAL-08, ADMIN-08, D-05, RESEARCH Pattern 2, Pitfall 3/4,
 *               05-PATTERNS.md §rollup.ts, 05-01 rollup.test.ts contract.
 */

import { AggregateField, FieldValue } from 'firebase-admin/firestore'
import {
  usageEventsRef,
  usageRollupsRef,
  escalationsRef,
  TENANT_ID,
} from '@/src/firebase/collections'
import { dayKey } from '@/src/usage/types'
import type { Pillar } from '@/src/usage/types'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Group key extracted during group-discovery phase. */
interface Group {
  uid: string
  pillar: Pillar
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Aggregate usageEvents for `day` into idempotent per-(uid, pillar) usageRollups.
 *
 * Uses AggregateField.sum()/count() — NEVER reads full usageEvent docs.
 * Each call produces the same result (recompute-from-source + set-merge).
 *
 * @param day  'YYYY-MM-DD' string (Asia/Kuala_Lumpur) — the rollup grouping key.
 */
export async function rollupUsage(day: string): Promise<void> {
  // ── Step 1: Discover distinct (uid, pillar) groups for this day ──────────────
  // Mirror getReplyQualityMetrics :402-407 — select() projection, never fetch-all.
  // This returns lightweight projection docs (only uid + pillar fields).
  const projSnap = await usageEventsRef()
    .where('day', '==', day)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('uid', 'pillar' as any)
    .get()

  // Collect distinct (uid, pillar) pairs into a Set (group key = uid + '__' + pillar)
  const groupMap = new Map<string, Group>()
  for (const doc of projSnap.docs) {
    const data = doc.data() as { uid?: string; pillar?: string }
    const uid = data.uid
    const pillar = data.pillar as Pillar | undefined
    if (!uid || !pillar) continue
    const key = `${uid}__${pillar}`
    if (!groupMap.has(key)) {
      groupMap.set(key, { uid, pillar })
    }
  }

  if (groupMap.size === 0) {
    // No events for this day — nothing to roll up.
    return
  }

  // ── Step 2: For each group, aggregate tokens + msg count ─────────────────────
  // RESEARCH Pattern 2: ONE aggregation query per group = 1 read-unit each.
  // The (day, uid, pillar) composite index (05-02) makes this efficient at 400 agents.
  for (const [, { uid, pillar }] of groupMap) {
    // -- Aggregation query --
    const aggSnap = await usageEventsRef()
      .where('day', '==', day)
      .where('uid', '==', uid)
      .where('pillar', '==', pillar)
      .aggregate({
        msgCount: AggregateField.count(),
        inTok: AggregateField.sum('inputTokens'),
        outTok: AggregateField.sum('outputTokens'),
        cachedTok: AggregateField.sum('cachedInputTokens'),
        cacheWrite: AggregateField.sum('cacheCreationInputTokens'),
      })
      .get()

    const { msgCount, inTok, outTok, cachedTok, cacheWrite } = aggSnap.data()

    // -- Optional: resolution time from escalations for this (uid, pillar, day) --
    // Resolution time = openedAt → resolvedAt delta in ms (D-05 / Open Question 3).
    // Only defined when escalations for this uid have resolvedAt set (05-04 Task 3).
    const resolutionTimeMs = await computeResolutionTimeMs(uid, pillar, day)

    // -- Optional: escalation rate for this uid + pillar --
    const escalationRate = await computeEscalationRateForGroup(uid, pillar)

    // -- Step 3: Write the rollup doc with set(merge:true) — IDEMPOTENT ──────────
    // Key: `${day}__${uid}__${pillar}` (Pitfall 3 guard).
    // set(merge:true) = recompute-from-source overwrite — never accumulates.
    const rollupKey = `${day}__${uid}__${pillar}`

    const rollupData = {
      tenantId: TENANT_ID,
      day,
      uid,
      pillar,
      msgCount,
      inputTokens: inTok,
      outputTokens: outTok,
      cachedInputTokens: cachedTok,
      cacheCreationInputTokens: cacheWrite,
      updatedAt: FieldValue.serverTimestamp(),
      // Optional resolution-time and escalation-rate fields
      ...(resolutionTimeMs !== undefined && { resolutionTimeMs }),
      ...(escalationRate !== undefined && { escalationRate }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await usageRollupsRef().doc(rollupKey).set(rollupData as any, { merge: true })
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute average resolution time in ms for escalations belonging to `uid` + `pillar`
 * that were resolved on the given `day` (resolvedAt is set).
 *
 * Resolution time = (resolvedAt - openedAt) delta per escalation.
 * Returns undefined if no resolved escalations exist for this group/day.
 *
 * Uses a small projection read (not full doc fetch) — only openedAt + resolvedAt fields.
 * This is bounded by the pilot agent count and is not on a hot path.
 *
 * (RESEARCH Open Question 3 — resolution time enablement requires resolvedAt on
 * EscalationDoc, added in 05-02, written by resolveStall in 05-04 Task 3.)
 */
async function computeResolutionTimeMs(
  uid: string,
  pillar: Pillar,
  day: string,
): Promise<number | undefined> {
  // Scope: escalations where agentUid == uid AND status == 'resolved' AND resolvedAt is set.
  // We filter by agentUid (the affected agent's uid) — escalations are keyed by agentUid.
  // pillar is not stored on EscalationDoc (escalations are agent-level, not pillar-level),
  // so we use uid only. Resolution time is per-agent per-day.
  try {
    // Query resolved escalations for this agent that were resolved today.
    // Use a select() projection to only fetch openedAt + resolvedAt (no content).
    // NOTE: 'day' correlation here is approximate — resolvedAt date matching day.
    // For v1 pilot scale, a bounded read of resolved escalations per agent is acceptable.
    const escSnap = await escalationsRef()
      .where('agentUid', '==', uid)
      .where('status', '==', 'resolved')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('openedAt', 'resolvedAt' as any)
      .get()

    if (escSnap.empty) return undefined

    // Compute delta for each resolved escalation, filter to those on this day
    const dayPrefix = day // 'YYYY-MM-DD'
    let totalMs = 0
    let count = 0

    for (const doc of escSnap.docs) {
      const data = doc.data() as {
        openedAt?: Date | { toMillis?: () => number; toDate?: () => Date }
        resolvedAt?: Date | { toMillis?: () => number; toDate?: () => Date }
      }
      const { openedAt, resolvedAt } = data
      if (!openedAt || !resolvedAt) continue

      // Convert Firestore Timestamp or Date to ms
      const openedMs =
        typeof (openedAt as { toMillis?: () => number }).toMillis === 'function'
          ? (openedAt as { toMillis: () => number }).toMillis()
          : (openedAt as Date).getTime?.() ?? 0
      const resolvedMs =
        typeof (resolvedAt as { toMillis?: () => number }).toMillis === 'function'
          ? (resolvedAt as { toMillis: () => number }).toMillis()
          : (resolvedAt as Date).getTime?.() ?? 0

      // Filter to escalations resolved on this day.
      // IN-02 fix: format resolvedMs with dayKey() (Asia/Kuala_Lumpur) to match the
      // MYT day key used for rollup grouping — UTC toISOString() would diverge by up
      // to 8 hours from the MYT bucket boundary.
      const resolvedDate = dayKey(new Date(resolvedMs))
      if (resolvedDate !== dayPrefix) continue

      const delta = resolvedMs - openedMs
      if (delta >= 0) {
        totalMs += delta
        count++
      }
    }

    return count > 0 ? Math.round(totalMs / count) : undefined
  } catch {
    // Non-fatal — resolution time is an optional rollup field.
    return undefined
  }
}

/**
 * Compute escalation rate (open / total) for escalations belonging to `uid`.
 * Mirrors computeEscalationRate in dashboard/actions.ts:460.
 *
 * Returns undefined if there are no escalations (avoids division by zero).
 * pillar is not stored on EscalationDoc — rate is per-agent.
 */
async function computeEscalationRateForGroup(
  uid: string,
  _pillar: Pillar,
): Promise<number | undefined> {
  try {
    const totalSnap = await escalationsRef()
      .where('agentUid', '==', uid)
      .count()
      .get()
    const total = totalSnap.data().count
    if (total === 0) return undefined

    const openSnap = await escalationsRef()
      .where('agentUid', '==', uid)
      .where('status', '==', 'open')
      .count()
      .get()
    const open = openSnap.data().count
    return open / total
  } catch {
    // Non-fatal — escalation rate is an optional rollup field.
    return undefined
  }
}
