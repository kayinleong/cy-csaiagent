/**
 * src/coach/journey/transition.ts — Pure journey transition logic (COACH-01/03).
 *
 * Exports:
 *   - nextCheckpoint(config, stage, checkpoint): Step | null
 *   - advance(config, current): { stage, checkpoint } | null
 *   - commitAdvance(uid, next): Promise<void>
 *
 * Design principles:
 *   - nextCheckpoint and advance are PURE functions — no I/O, no framework imports.
 *     They are directly unit-testable without any mocking.
 *   - commitAdvance is the ONLY function that touches I/O — it calls updateJourneyStage.
 *   - The 'start' sentinel (set on new agents by setUserClaims) is treated as a
 *     special entry that yields the FIRST real checkpoint in the first stage.
 *   - State lives in agentProfiles.journeyStage / currentCheckpoint (Firestore).
 *     The AI SDK tools are READ-ONLY; advance writes happen via Server Actions.
 *
 * Security (T-02-15):
 *   - Advance is server-side and gated by a passing comprehension grade.
 *   - The AI SDK tool cannot self-advance (tools are read-only — no Firestore writes).
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import type { JourneyConfig, Step } from './config'
import { updateJourneyStage } from '@/src/memory/agentProfile'

/** The sentinel checkpoint ID assigned to all new agents by setUserClaims. */
const ENTRY_SENTINEL = 'start'

/**
 * Return the next checkpoint step from the given (stage, checkpoint) position.
 *
 * - If checkpoint is the entry sentinel ('start'), returns the FIRST checkpoint
 *   of the first stage in the config.
 * - If checkpoint is the last in a stage, advances to the first checkpoint of the
 *   NEXT stage (cross-stage advancement).
 * - Returns null if the given checkpoint is the last in the entire journey, or
 *   if the (stage, checkpoint) pair is not found in the config.
 *
 * @param config      The journey configuration.
 * @param stage       The agent's current journeyStage.
 * @param checkpoint  The agent's current checkpoint (or 'start' for new agents).
 * @returns           The next Step, or null if at the end of the journey.
 */
export function nextCheckpoint(
  config: JourneyConfig,
  stage: string,
  checkpoint: string,
): Step | null {
  // Handle the entry sentinel: return the very first checkpoint in the journey.
  // The stage must also be valid (must exist in the config) to avoid spoofed entry.
  if (checkpoint === ENTRY_SENTINEL) {
    if (config.stages.length === 0) return null
    const matchedStage = config.stages.find((s) => s.id === stage)
    if (!matchedStage) return null
    // Return the first checkpoint of the matched stage (day-one-pairing for 'onboarding').
    if (matchedStage.checkpoints.length === 0) return null
    return matchedStage.checkpoints[0]
  }

  // Build a flat ordered list of all checkpoints for traversal.
  const allCheckpoints: Step[] = []
  for (const s of config.stages) {
    for (const cp of s.checkpoints) {
      allCheckpoints.push(cp)
    }
  }

  // Find the current checkpoint position.
  const index = allCheckpoints.findIndex(
    (cp) => cp.stage === stage && cp.id === checkpoint,
  )

  if (index === -1) {
    // Unknown (stage, checkpoint) pair — cannot advance.
    return null
  }

  if (index >= allCheckpoints.length - 1) {
    // Already at the last checkpoint in the journey.
    return null
  }

  return allCheckpoints[index + 1]
}

/**
 * Pure transition: given the current (stage, checkpoint) state, compute the
 * next { stage, checkpoint } object, or null if at the end of the journey.
 *
 * Does NOT write to Firestore. Use commitAdvance() to persist the result.
 *
 * @param config   The journey configuration.
 * @param current  The agent's current { stage, checkpoint } state.
 * @returns        The next { stage, checkpoint }, or null at the journey end.
 */
export function advance(
  config: JourneyConfig,
  current: { stage: string; checkpoint: string },
): { stage: string; checkpoint: string } | null {
  const next = nextCheckpoint(config, current.stage, current.checkpoint)
  if (!next) return null
  return { stage: next.stage, checkpoint: next.id }
}

/**
 * Persist a journey advancement to Firestore via updateJourneyStage.
 *
 * This is the ONLY I/O function in the transition module. It should be called
 * from a Server Action (after a passing comprehension grade), never from inside
 * an AI SDK tool execute() (tools are read-only — T-02-15).
 *
 * @param uid   The agent's UID.
 * @param next  The result of advance() — { stage, checkpoint } or null.
 *              If null (end of journey), this function is a no-op.
 */
export async function commitAdvance(
  uid: string,
  next: { stage: string; checkpoint: string } | null,
): Promise<void> {
  if (!next) return
  await updateJourneyStage(uid, next.stage, next.checkpoint)
}
