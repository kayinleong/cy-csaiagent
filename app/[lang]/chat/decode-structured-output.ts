/**
 * app/[lang]/chat/decode-structured-output.ts — client-side decode bridge.
 *
 * The Reply and Finder agents emit their structured output as a JSON object in the
 * final assistant text (see src/agents/{reply,finder}/prompt.ts "Output Format").
 * The /api/chat route streams that JSON as text deltas. This module decodes the
 * accumulated text on stream completion so message-list can render the interactive
 * card (ReplyDraftCard / MatchList) instead of a raw-JSON text bubble.
 *
 * Pure (no React, no Firebase) so it is unit-testable without a browser.
 *
 * The caller gates by pillar (pillarOverride) — Reply turns decode ReplyOutput, Finder
 * turns decode FinderOutput — so the schemas' shared all-optional `clarifyingQuestion`
 * field can never cross-render one pillar's output as the other's card.
 */

import { ReplyOutputSchema, type ReplyOutput } from '@/src/agents/reply/schema'
import { FinderOutputSchema, type FinderOutput } from '@/src/agents/finder/schema'

/**
 * Extract a JSON object from the model's final text. Tolerates a ```json … ``` code
 * fence and stray leading/trailing prose by also trying the first-`{`-to-last-`}` slice.
 * Returns null when nothing parses.
 */
function extractJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const candidates = [unfenced]
  const first = unfenced.indexOf('{')
  const last = unfenced.lastIndexOf('}')
  if (first !== -1 && last > first) {
    candidates.push(unfenced.slice(first, last + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next candidate
    }
  }
  return null
}

/**
 * Decode a Reply turn's accumulated text into a ReplyOutput, or null if it isn't one.
 * Requires a populated branch — an empty `{}` (or a stripped non-Reply object) is not a card.
 */
export function decodeReplyOutput(content: string): ReplyOutput | null {
  const obj = extractJsonObject(content)
  if (!obj || typeof obj !== 'object') return null

  const result = ReplyOutputSchema.safeParse(obj)
  if (!result.success) return null

  const { draft, noSopMatch, clarifyingQuestion } = result.data
  if (!draft && !noSopMatch && !clarifyingQuestion) return null

  return result.data
}

/**
 * Decode a Finder turn's accumulated text into a FinderOutput, or null if it isn't one.
 * Requires a populated state — no matches AND no refusal AND no question is not a card.
 */
export function decodeFinderOutput(content: string): FinderOutput | null {
  const obj = extractJsonObject(content)
  if (!obj || typeof obj !== 'object') return null

  const result = FinderOutputSchema.safeParse(obj)
  if (!result.success) return null

  const { matches, refusal, clarifyingQuestion } = result.data
  if (matches.length === 0 && !refusal && !clarifyingQuestion) return null

  return result.data
}
