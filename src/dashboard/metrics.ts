/**
 * src/dashboard/metrics.ts — Pure training-funnel and ramp-time metric derivation.
 *
 * All functions are PURE (no I/O). They accept plain data structures and return
 * numbers / aggregated objects. This makes them directly unit-testable offline.
 *
 * SCOPE (Pitfall 8 — Phase-2 only):
 *   - Training-stage funnel: how many agents are at each journey stage.
 *   - Days-in-journey: elapsed days since last activity.
 *   - Checkpoint velocity: index of the agent's current checkpoint in the full
 *     journey as a ramp-time proxy (CDASH-07 — days to checkpoint-N).
 *   - NO lead/close fields — Property Finder and close-tracking land in Phase 3.
 *
 * References:
 *   - 02-06-PLAN.md Task 1 (metrics.ts, daysInJourney, checkpointVelocity, trainingFunnel)
 *   - CDASH-05 (training-stage funnel, Phase-2 scope only)
 *   - CDASH-07 (60→7-10 day ramp — ramp proxy from checkpoint progression)
 *   - Pitfall 8 (funnel scoped to training metrics in P2; no lead/close)
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import type { JourneyConfig } from '@/src/coach/journey/config'

// ─── daysInJourney ────────────────────────────────────────────────────────────

/**
 * Compute the number of whole days elapsed since `profile.lastActiveAt`.
 *
 * Used as a "days into onboarding" proxy for the ramp-time report (CDASH-07).
 * Clock skew guard: if lastActiveAt is in the future, returns 0.
 *
 * @param profile   An object with a `lastActiveAt` Date.
 * @param now       The reference time (injectable for unit-testability).
 * @returns         Non-negative integer number of days.
 */
export function daysInJourney(
  profile: { lastActiveAt: Date },
  now: Date,
): number {
  const diffMs = now.getTime() - profile.lastActiveAt.getTime()
  if (diffMs < 0) return 0
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

// ─── checkpointVelocity ───────────────────────────────────────────────────────

/**
 * Derive the agent's current position index in the full journey checkpoint list.
 *
 * Used as a ramp-time proxy: an agent at checkpoint index N has completed N
 * checkpoints. Comparing this to a target index gives a "days to checkpoint-N"
 * metric (CDASH-07).
 *
 * Returns 0 for agents at the entry sentinel ('start') or on a checkpoint not
 * found in the config (data integrity guard).
 *
 * NO lead/close metrics — those are Phase 3 (Pitfall 8).
 *
 * @param profile   Object with { journeyStage, currentCheckpoint }.
 * @param config    The D2_JOURNEY config (injected for testability).
 * @returns         0-based index of the agent's current checkpoint in the journey.
 */
export function checkpointVelocity(
  profile: { journeyStage: string; currentCheckpoint: string },
  config: JourneyConfig,
): number {
  const { journeyStage, currentCheckpoint } = profile

  // Entry sentinel — not yet started a real checkpoint
  if (currentCheckpoint === 'start') return 0

  // Build flat ordered list of all checkpoints
  const allCheckpoints: Array<{ stage: string; id: string }> = []
  for (const stage of config.stages) {
    for (const cp of stage.checkpoints) {
      allCheckpoints.push({ stage: stage.id, id: cp.id })
    }
  }

  // Find the 0-based index of the agent's current checkpoint
  const index = allCheckpoints.findIndex(
    (cp) => cp.stage === journeyStage && cp.id === currentCheckpoint,
  )

  // Unknown checkpoint — return 0 (data integrity guard)
  if (index === -1) return 0

  // Return 1-based position (index 0 = first checkpoint completed → velocity 1)
  return index + 1
}

// ─── trainingFunnel ───────────────────────────────────────────────────────────

/**
 * Aggregate a list of agent profiles into a training-stage funnel (CDASH-05).
 *
 * Returns:
 *   - `stages`: a count of agents per journeyStage (e.g. { onboarding: 3, training: 1 }).
 *   - `stallRate`: the proportion of agents whose stage is 'onboarding' and checkpoint
 *     is 'start' (proxy for agents who haven't begun, used as a stall indicator).
 *
 * SCOPE: Phase-2 only — no `leads` or `closes` fields (Pitfall 8 / Phase 3).
 *
 * @param profiles   Array of objects with { journeyStage, currentCheckpoint }.
 * @returns          { stages, stallRate }
 */
export function trainingFunnel(
  profiles: Array<{ journeyStage: string; currentCheckpoint: string }>,
): {
  stages: Record<string, number>
  stallRate: number
} {
  if (profiles.length === 0) {
    return { stages: {}, stallRate: 0 }
  }

  // Count agents per stage
  const stages: Record<string, number> = {}
  let stalledCount = 0

  for (const profile of profiles) {
    const { journeyStage, currentCheckpoint } = profile

    // Increment stage bucket
    stages[journeyStage] = (stages[journeyStage] ?? 0) + 1

    // Stall proxy: agent has not begun (still at sentinel 'start') OR is in 'onboarding'
    // and hasn't moved past the entry checkpoint. For Phase 2 purposes, 'start' = stalled.
    if (currentCheckpoint === 'start') {
      stalledCount++
    }
  }

  const stallRate = stalledCount / profiles.length

  return { stages, stallRate }
}
