/**
 * src/escalation/detect.ts — Stall detection over agentProfiles.lastActiveAt
 *
 * Queries `agentProfiles` for agents whose `lastActiveAt` is older than
 * `days` days.  Used by the QStash stall-detect job (/api/jobs/stall-detect).
 *
 * Clock is injectable for deterministic unit tests.
 *
 * References:
 *   - TSD §3.2 escalation row + §4 agentProfiles.lastActiveAt
 *   - 01-11 PLAN.md Task 1 (findStalled over lastActiveAt)
 *   - D-10 (escalation seam; stall-detect job reads this)
 *
 * Export: findStalled({ days, now? })
 * Consumers: app/api/jobs/stall-detect/route.ts, escalation/index.ts
 */

import { agentProfilesRef } from '@/src/firebase/collections'

export interface StalledAgent {
  agentUid: string
  seniorCoachId: string
  lastActiveAt: Date
}

export interface FindStalledOptions {
  /** Number of days of inactivity before an agent is considered stalled. */
  days: number
  /**
   * Injected clock for unit tests.
   * Defaults to `new Date()` in production.
   */
  now?: Date
}

/**
 * Return agents whose `agentProfiles.lastActiveAt` is older than `days` days.
 *
 * The Firestore query uses a less-than filter on `lastActiveAt` so only
 * truly inactive agents are returned — active agents are never included.
 *
 * @param options - `days`: inactivity threshold; `now`: injectable clock.
 * @returns Array of { agentUid, seniorCoachId, lastActiveAt } for each stalled agent.
 */
export async function findStalled(options: FindStalledOptions): Promise<StalledAgent[]> {
  const { days, now = new Date() } = options

  // Threshold: agents inactive before this date are considered stalled
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const snap = await agentProfilesRef()
    .where('lastActiveAt', '<', threshold)
    .get()

  if (snap.empty) return []

  return snap.docs.map((doc) => {
    const data = doc.data()
    // lastActiveAt may be a Firestore Timestamp (toDate()) or a plain Date
    const lastActiveAt =
      data.lastActiveAt && typeof (data.lastActiveAt as { toDate?: () => Date }).toDate === 'function'
        ? (data.lastActiveAt as { toDate: () => Date }).toDate()
        : (data.lastActiveAt as Date)

    return {
      agentUid: doc.id,
      seniorCoachId: data.seniorCoachId,
      lastActiveAt,
    }
  })
}
