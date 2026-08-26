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

  const { matches, refusal, clarifyingQuestion, answer } = result.data
  // `answer` is the conversational branch (quick-kayinleong-051) — a populated state in
  // its own right, so a prose reply about a known project decodes instead of falling
  // through to a raw-JSON bubble.
  if (matches.length === 0 && !refusal && !clarifyingQuestion && !answer) return null

  return result.data
}

/**
 * Last-resort salvage: pull readable prose out of a structured envelope that will NOT
 * decode (quick-kayinleong-051).
 *
 * The envelope can fail to parse for reasons the user should never have to see — most
 * commonly it arrived truncated, so the JSON has no closing brace. When that happens the
 * raw text falls through to MarkdownMessage and the agent gets a wall of
 * `{"matches":[{"projectId":...` in a code block. That is the reported symptom.
 *
 * This does NOT try to reconstruct the object. It looks for the first human-readable
 * string field — the ones the model actually writes prose into — and returns its decoded
 * contents so the agent gets the words that were generated for them, formatted, instead of
 * machine noise.
 *
 * Returns null when the content is not an envelope, or when nothing readable can be
 * recovered — the caller should then leave the content alone rather than invent anything.
 */
const SALVAGE_KEYS = ['answer', 'rationale', 'explanation', 'clarifyingQuestion', 'message', 'text']

export function salvageStructuredText(content: string): string | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '')
  // Only touch things that look like an envelope; ordinary prose is not our business.
  if (!trimmed.startsWith('{')) return null

  for (const key of SALVAGE_KEYS) {
    const at = trimmed.indexOf(`"${key}"`)
    if (at === -1) continue

    // Find the opening quote of the VALUE (after the colon).
    const colon = trimmed.indexOf(':', at + key.length + 2)
    if (colon === -1) continue
    const open = trimmed.indexOf('"', colon + 1)
    if (open === -1) continue

    // Walk to the closing quote, respecting backslash escapes. A truncated envelope has
    // no closing quote, so fall through to the end of the buffer.
    let end = -1
    for (let i = open + 1; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (ch === '\\') { i++; continue }
      if (ch === '"') { end = i; break }
    }
    const raw = trimmed.slice(open, end === -1 ? trimmed.length : end + 1)

    // Re-parse as a JSON string so \n, \" and \uXXXX come back as real characters.
    // A truncated slice has no closing quote, so add one before parsing.
    try {
      const asJson = end === -1 ? `${raw}"` : raw
      const decoded = JSON.parse(asJson) as unknown
      if (typeof decoded === 'string' && decoded.trim().length > 0) return decoded
    } catch {
      // Unparseable even with a synthetic terminator — try the next key.
    }
  }

  return null
}
