/**
 * src/router/classifier.ts — DORMANT LLM classifier seam.
 *
 * This module is NOT active in Phase 1. It is a deliberate architectural seam
 * that activates in Phase 3 when a second pillar shares the chat surface (D-06).
 *
 * In Phase 1:
 *   - `route()` in heuristic.ts does NOT import or call `classifyIntent`.
 *   - Calling `classifyIntent` will throw `NotActivatedError`.
 *
 * Phase 3 activation:
 *   - Remove the guard / swap the stub for a real LLM call via the AI SDK.
 *   - Wire into `src/router/index.ts` (the seam is the import boundary).
 *   - The heuristic still runs first; the classifier handles ambiguous cases only.
 *
 * Never hard-code a model ID here — resolve from Remote Config (CLAUDE.md).
 *
 * Design reference: TSD §3.2 router row + D-03 (deliberate stub) + D-06 (Phase 3 classifier).
 */

/** Thrown when `classifyIntent` is called before Phase 3 activation. */
export class NotActivatedError extends Error {
  constructor(message?: string) {
    super(message ?? 'LLM classifier activates in Phase 3')
    this.name = 'NotActivatedError'
  }
}

/**
 * Classify the intent of a conversation and return the appropriate pillar.
 *
 * DORMANT — do NOT call this in Phase 1.
 *
 * In Phase 3 this will:
 *   1. Build a compact conversation summary from `messages`.
 *   2. Call the Sonnet model (ID from Remote Config) with a routing system prompt.
 *   3. Return a structured `{ pillar, confidence, reason }`.
 *
 * @throws {NotActivatedError} Always — in Phase 1 this is a stub.
 */
export async function classifyIntent(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _messages: { role: string; content: string }[]
): Promise<{ pillar: 'coach' | 'finder' | 'reply'; confidence: number; reason: string }> {
  // Phase 1: DORMANT — do not activate until Phase 3 wires a second pillar.
  throw new NotActivatedError(
    'LLM classifier activates in Phase 3 when a second pillar shares the chat surface (D-06). ' +
    'Do not call classifyIntent from heuristic.ts route() in Phase 1.'
  )
}
