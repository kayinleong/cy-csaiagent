/**
 * src/agents/reply/schema.ts — Zod output schema for the Reply Assistant agent.
 *
 * `ReplyOutputSchema` is the validated output contract for one Reply turn.
 * It mirrors `FinderOutputSchema` (src/agents/finder/schema.ts) — three optional
 * branches whose mutual exclusivity (XOR) is enforced at the APPLICATION level in
 * index.ts (Zod cannot express "exactly one of these" cleanly):
 *
 *   - `draft`             → a grounded reply draft + the SOP doc IDs it cites.
 *                           sopDocIds is NON-EMPTY: a draft with no grounding trail is
 *                           invalid (D-11 grounding mandate — never invent SOP content).
 *   - `noSopMatch`        → grounded refusal when retrieveReplySop returns no_sop_match.
 *                           NEVER a fabricated draft (mirrors Finder's no_match refusal).
 *   - `clarifyingQuestion`→ ambiguous/empty inbound → ask rather than guess.
 *
 * App-level invariant (checked in index.ts): exactly ONE of
 *   draft / noSopMatch / clarifyingQuestion is populated.
 * (Same cross-field pattern as FinderOutputSchema — finder/schema.ts:15,182-191.)
 *
 * REPLY-01/02/05/06/07, D-01/D-11.
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { z } from 'zod'

/**
 * A grounded reply draft.
 *
 * Invariant: `sopDocIds` is a NON-EMPTY array of real SOP doc IDs returned by the
 * retrieveReplySop tool — never fabricated. A draft with no cited SOP is invalid
 * (the grounding trail is mandatory; mirrors FinderMatchSchema's projectId-is-real
 * invariant at finder/schema.ts:133-166).
 */
export const ReplyDraftSchema = z.object({
  /** The drafted reply text in the agent's language. Already PDPA-redacted upstream. */
  text: z.string().min(1),
  /** Real SOP doc IDs cited by this draft (grounding trail) — never empty, never invented. */
  sopDocIds: z.array(z.string().min(1)).min(1),
})

/**
 * Grounded refusal signal — emitted when retrieveReplySop returns no_sop_match (D-11).
 * Never a fabricated draft (mirrors FinderRefusalSchema at finder/schema.ts:172-180).
 */
export const ReplyNoSopMatchSchema = z.object({
  reason: z.literal('no_sop_match'),
  /**
   * Grounded refusal message ("I don't have a D2 reply SOP for this — please draft
   * manually, or check with your senior coach."). Never invents SOP content.
   */
  message: z.string().min(1),
})

/**
 * The validated output schema for the Reply Assistant agent.
 *
 * App-level invariants (checked in index.ts):
 *   - `draft` present             → grounded reply → no noSopMatch, no clarifyingQuestion.
 *   - `noSopMatch` present        → retrieveReplySop missed → no draft.
 *   - `clarifyingQuestion` present→ ambiguous inbound → ask, don't guess → no draft.
 *
 * The Zod schema allows all three to be optional — the application-level gate in
 * index.ts enforces the XOR invariant (same pattern as FinderOutputSchema).
 */
export const ReplyOutputSchema = z.object({
  /**
   * A grounded reply draft (text + cited SOP doc IDs). Present ONLY when
   * retrieveReplySop returned a hit. Absent when noSopMatch / clarifyingQuestion.
   */
  draft: ReplyDraftSchema.optional(),

  /**
   * Present ONLY when retrieveReplySop returns no_sop_match. Grounded refusal —
   * the agent refuses to draft rather than inventing SOP content (D-11).
   */
  noSopMatch: ReplyNoSopMatchSchema.optional(),

  /**
   * Present ONLY when the inbound is ambiguous/empty. The agent asks a clarifying
   * question rather than guessing. When present, draft must be absent.
   */
  clarifyingQuestion: z.string().min(1).optional(),
})

export type ReplyOutput = z.infer<typeof ReplyOutputSchema>
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>
export type ReplyNoSopMatch = z.infer<typeof ReplyNoSopMatchSchema>
