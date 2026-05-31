/**
 * src/agents/coach/schema.ts — Zod output schema for the D2 Onboarding Coach.
 *
 * Grounding mandate (TSD §6, D-09):
 *   - `citations` is required whenever the Coach answers from retrieved content.
 *   - An empty citations array is only valid with a `handoff` (kb_miss signal).
 *   - The schema is used with `experimental_output` in streamText for structured
 *     output parsing in Phase 2; in Phase 1 it documents the contract and is used
 *     for test assertions.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { z } from 'zod'

/**
 * A single citation reference attached to a grounded Coach answer.
 * chunkId must come from the retrieval result — never fabricated.
 */
export const CitationSchema = z.object({
  /** The Firestore kbChunks/{chunkId} document ID — the citation source. */
  chunkId: z.string().min(1),
})

/**
 * The handoff signal emitted when retrieval returns nothing.
 * The Coach emits this instead of hallucinating (TSD §6 grounding mandate, D-10).
 */
export const HandoffSchema = z.object({
  reason: z.literal('kb_miss'),
})

/**
 * The validated output schema for the Coach agent.
 *
 * Invariants enforced by the schema:
 *   1. `answer` must be a non-empty string.
 *   2. `citations` is always present (may be empty only when handoff is present).
 *   3. When grounded (no handoff), citations must be non-empty (at least one source).
 *
 * Note: The "citations required when grounded" invariant is enforced at the
 * application level (coach/index.ts) after schema parsing — Zod schemas cannot
 * express conditional required-ness for cross-field constraints cleanly.
 * The test suite asserts this invariant explicitly (Test 3 / Test 4).
 */
export const CoachOutputSchema = z.object({
  /** The Coach's response to the agent's query. Cites KB chunks inline [KB:id]. */
  answer: z.string().min(1),
  /**
   * Citations from the KB chunks used to ground this answer.
   * Must be non-empty when the Coach answers from retrieved content.
   * Empty only when a handoff is present (retrieval miss).
   */
  citations: z.array(CitationSchema),
  /**
   * Present ONLY on a retrieval miss — never fabricate content on a miss.
   * When handoff is present, answer should be a brief "no info found" message.
   */
  handoff: HandoffSchema.optional(),
})

export type CoachOutput = z.infer<typeof CoachOutputSchema>
export type Citation = z.infer<typeof CitationSchema>
export type Handoff = z.infer<typeof HandoffSchema>
