/**
 * src/memory/agentProfile.ts — Agent journey-state seam (D-10).
 *
 * Writes to `agentProfiles/{uid}` — the journey state machine document.
 *
 * Fields:
 *   - `journeyStage`      — current stage in the D2 onboarding journey
 *   - `currentCheckpoint` — last completed checkpoint within the stage
 *   - `lastActiveAt`      — timestamp of last coach interaction (stall-detect signal)
 *
 * Phase 1: The seam is REAL but thin — it writes the fields but does not drive
 * any UI state machine (Phase 2) or trigger escalations (01-10 job reads this).
 *
 * The stall-detect job (01-10) reads `lastActiveAt` to identify stalled agents.
 * It is therefore critical that `touchLastActive` is called on every chat turn.
 *
 * References: TSD §4 agentProfiles, D-10, FND-05.
 */

import { agentProfilesRef } from '@/src/firebase/collections'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Update the journey stage (and optionally the current checkpoint) for an agent.
 * Also updates `lastActiveAt` — the stall-detect signal.
 *
 * @param uid         The agent's user ID.
 * @param stage       The new journey stage (e.g. 'onboarding', 'training', 'qualified').
 * @param checkpoint  Optional: the specific checkpoint within the stage.
 */
export async function updateJourneyStage(
  uid: string,
  stage: string,
  checkpoint?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    journeyStage: stage,
    lastActiveAt: FieldValue.serverTimestamp(),
  }

  // Only set currentCheckpoint when explicitly provided — undefined means "leave as-is".
  if (checkpoint !== undefined) {
    update['currentCheckpoint'] = checkpoint
  }

  await agentProfilesRef().doc(uid).update(update)
}

/**
 * Bump `lastActiveAt` for an agent without changing their journey stage.
 *
 * Call this on every chat turn so the stall-detect job (01-10) has an up-to-date
 * signal even when the stage hasn't changed.
 *
 * @param uid  The agent's user ID.
 */
export async function touchLastActive(uid: string): Promise<void> {
  await agentProfilesRef().doc(uid).update({
    lastActiveAt: FieldValue.serverTimestamp(),
  })
}
