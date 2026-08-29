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
import {
  FinderOutputSchema,
  FinderMatchSchema,
  type FinderOutput,
} from '@/src/agents/finder/schema'

// ─── Truncated-envelope repair (quick-kayinleong-056) ─────────────────────────

/**
 * Close the containers still open at `safeEnd` and return the resulting JSON text.
 * Returns null when no complete value was ever seen (nothing to salvage).
 */
function truncateToSafe(src: string, safeEnd: number, safeStack: Array<'{' | '['>): string | null {
  if (safeEnd < 0) return null
  let out = src.slice(0, safeEnd)
  for (let k = safeStack.length - 1; k >= 0; k--) out += safeStack[k] === '{' ? '}' : ']'
  return out
}

/** Number of backslashes immediately before the end of `s` — an ODD count means the
 *  final character is an open escape that would swallow a closing quote. */
function trailingBackslashes(s: string): number {
  let n = 0
  for (let i = s.length - 1; i >= 0 && s[i] === '\\'; i--) n++
  return n
}

/**
 * Repair a JSON envelope that was cut off mid-flight, so a truncated turn still renders
 * as a card instead of collapsing to a lone paragraph (quick-kayinleong-056).
 *
 * This is the dominant real-world failure: the model streams a long envelope, the turn
 * ends early, and everything after the cut is lost. quick-051 answered that by pulling out
 * the first prose field, which rescues the words but throws away the collateral links and
 * the criteria badges — the reported screenshot is exactly that, a good-looking card whose
 * last link is severed mid-token.
 *
 * Two repair strategies, chosen by WHERE the cut landed:
 *
 *   1. Cut inside a prose string ("answer", "rationale", …) → close the string. Nearly all
 *      of the text survives; a markdown link left dangling by the cut is neutralised
 *      downstream by sanitizeMarkdown().
 *   2. Cut inside a URL string → do NOT close it. A half-URL closed into a valid-looking
 *      link is the UI asserting something false — the same reason quick-050 made
 *      fetchCollateral omit pathless items. Fall back to the last COMPLETE value instead,
 *      which leaves the half-built item without its `url`; normalizeCollateral then drops
 *      it and the agent sees the links that did arrive.
 *
 * A number cut mid-token is never closed either — "priceMax": 90000 may well have been
 * 900000, and quietly under-reporting a price is worse than dropping the field.
 *
 * Returns null when the input is already complete (nothing to do) or when nothing
 * salvageable was seen. NEVER invents a key, a value or a URL.
 */
export function repairTruncatedJson(src: string): string | null {
  const n = src.length
  const stack: Array<'{' | '['> = []
  // Per-object frame: is the next string a KEY (vs a value)? Arrays push `false`.
  const expectKey: boolean[] = []
  let safeEnd = -1
  let safeStack: Array<'{' | '['> = []

  const markSafe = (end: number) => {
    if (stack.length === 0) return
    safeEnd = end
    safeStack = [...stack]
  }

  let i = 0
  while (i < n) {
    const ch = src[i]

    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      expectKey.push(ch === '{')
      i++
      // An empty container is itself a valid place to cut.
      markSafe(i)
      continue
    }

    if (ch === '}' || ch === ']') {
      stack.pop()
      expectKey.pop()
      i++
      // The document closed on its own — it was never truncated.
      if (stack.length === 0) return null
      if (stack[stack.length - 1] === '{') expectKey[expectKey.length - 1] = false
      markSafe(i)
      continue
    }

    if (ch === ',') {
      i++
      if (stack[stack.length - 1] === '{') expectKey[expectKey.length - 1] = true
      continue
    }

    if (ch === ':') {
      i++
      if (stack.length > 0) expectKey[expectKey.length - 1] = false
      continue
    }

    if (ch === '"') {
      const quoteStart = i
      let j = i + 1
      let closed = false
      for (; j < n; j++) {
        const c = src[j]
        if (c === '\\') {
          j++
          continue
        }
        if (c === '"') {
          closed = true
          break
        }
      }

      if (!closed) {
        // Strategy 2: a severed URL is dropped, not closed.
        const body = src.slice(quoteStart + 1)
        if (/^https?:\/\//i.test(body)) return truncateToSafe(src, safeEnd, safeStack)

        // Strategy 1: close the prose string. Trim a partial escape first, or the
        // backslash swallows the quote we are about to add.
        let out = src
        out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
        if (trailingBackslashes(out) % 2 === 1) out = out.slice(0, -1)
        out += '"'
        for (let k = stack.length - 1; k >= 0; k--) out += stack[k] === '{' ? '}' : ']'
        return out
      }

      i = j + 1
      const isKey = stack[stack.length - 1] === '{' && expectKey[expectKey.length - 1]
      if (!isKey) markSafe(i)
      continue
    }

    // A bare literal: number, true, false or null.
    let j = i
    while (j < n && !/[\s,\]}]/.test(src[j])) j++
    // Ran to the end of the buffer — the token itself is incomplete, so it cannot be
    // trusted (a truncated number is a WRONG number, not a missing one).
    if (j >= n) return truncateToSafe(src, safeEnd, safeStack)
    i = j
    markSafe(i)
  }

  if (stack.length === 0) return null
  return truncateToSafe(src, safeEnd, safeStack)
}

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
  // Last resort: the envelope was cut off mid-flight. Tried AFTER the intact candidates
  // so a complete envelope is never routed through the repair path (quick-056).
  if (first !== -1) {
    const repaired = repairTruncatedJson(unfenced.slice(first))
    if (repaired) candidates.push(repaired)
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
 * Repair known model drift into the canonical schema shape, BEFORE validation
 * (quick-kayinleong-053).
 *
 * Rationale: the model is not a reliable serializer. Observed in production, the JSON was
 * complete and well-formed but the wrong SHAPE — collateral came back as
 *
 *     "collateral": { "brochures": ["https://…", "https://…"] }
 *
 * where the schema wants `[{ type, url }]`. zod rejected it, the decoder returned null,
 * and the agent got the raw envelope in their chat. Prompt rules cannot guarantee a shape;
 * this can. Kept deliberately NARROW — it repairs container shape only, never invents a
 * url, a projectId or any field the model did not supply, so it cannot manufacture
 * grounding that was not there.
 *
 * Unknown shapes are left untouched for zod to reject honestly.
 */
function normalizeCollateral(value: unknown): unknown {
  if (value == null) return value

  // Already canonical-ish: an array. Repair the items.
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        // A bare url string → give it a neutral type rather than dropping it.
        if (typeof item === 'string') return { type: 'file', url: item }
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          const url = o.url ?? o.href ?? o.link
          if (typeof url !== 'string' || url.length === 0) return null
          const type = typeof o.type === 'string' && o.type.length > 0 ? o.type : 'file'
          return { type, url }
        }
        return null
      })
      .filter(Boolean)
  }

  // The observed drift: an object keyed by category, each holding urls.
  //   { brochures: [url, url], videos: [url] }  →  [{type:'brochure', url}, …]
  if (typeof value === 'object') {
    const out: Array<{ type: string; url: string }> = []
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      // Singularise the key for the chip label: "brochures" → "brochure".
      const type = key.endsWith('s') ? key.slice(0, -1) : key
      const list = Array.isArray(entry) ? entry : [entry]
      for (const item of list) {
        if (typeof item === 'string' && item.length > 0) {
          out.push({ type, url: item })
        } else if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          const url = o.url ?? o.href ?? o.link
          if (typeof url === 'string' && url.length > 0) {
            out.push({ type: typeof o.type === 'string' && o.type ? o.type : type, url })
          }
        }
      }
    }
    return out
  }

  return value
}

/**
 * Normalize a decoded Finder envelope so predictable model drift does not cost the agent
 * their whole answer (quick-kayinleong-053).
 *
 * Returns the input untouched when it is not an object — zod then rejects it as before.
 */
export function normalizeFinderShape(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }

  if (Array.isArray(obj.matches)) {
    obj.matches = obj.matches.map((m) => {
      if (!m || typeof m !== 'object') return m
      const match = { ...(m as Record<string, unknown>) }
      if ('collateral' in match) {
        const fixed = normalizeCollateral(match.collateral)
        // Drop the key entirely when nothing survived — `collateral` is optional, and an
        // empty array is a meaningful "nothing to attach" that MatchList already handles.
        if (Array.isArray(fixed) && fixed.length === 0) delete match.collateral
        else match.collateral = fixed
      }
      return match
    })
  }

  return obj
}

/**
 * Drop any match that is not renderable ON ITS OWN, rather than letting one husk fail the
 * WHOLE envelope (quick-kayinleong-056).
 *
 * A repaired truncation almost always leaves a half-built FINAL match — the cut landed
 * inside it. Before this, that husk cost the agent every complete match above it, because
 * zod validates `matches` as a unit. Validating each match against its own schema is the
 * exact test — the schema IS the definition of renderable.
 *
 * Deliberately a separate step from normalizeFinderShape, whose contract is "repair the
 * container shape, let zod reject the rest honestly". This one drops; it never fills in.
 */
export function dropUnrenderableMatches(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.matches)) return raw
  return {
    ...obj,
    matches: obj.matches.filter((m) => FinderMatchSchema.safeParse(m).success),
  }
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

  // Repair predictable shape drift BEFORE validating (quick-053). Without this, a
  // complete and well-formed envelope whose `collateral` came back as an object of
  // arrays fails zod outright and the agent sees raw JSON.
  const result = FinderOutputSchema.safeParse(dropUnrenderableMatches(normalizeFinderShape(obj)))
  if (!result.success) return null

  const { matches, refusal, clarifyingQuestion, answer } = result.data
  // `answer` is the conversational branch (quick-kayinleong-051) — a populated state in
  // its own right, so a prose reply about a known project decodes instead of falling
  // through to a raw-JSON bubble.
  if (matches.length === 0 && !refusal && !clarifyingQuestion && !answer) return null

  return result.data
}

/**
 * Attach the SERVER's collateral to a decoded Finder output (quick-kayinleong-071).
 *
 * The model used to transcribe every collateral URL into its own JSON output, and it chose
 * a different subset each time — measured over three identical queries: 19 URLs, then 10,
 * then 9, for the same projects. The agent saw "1 file to share" on one card and "2 files"
 * on the same project a moment later.
 *
 * `byProject` comes from the searchProjects / fetchCollateral tool RESULTS, so it is the
 * same deterministic, ranked, capped list every time. This is the pattern quick-046
 * established for citations, for the same stated reason: derived from real tool results is
 * "strictly more trustworthy than asking the model to restate" them.
 *
 * Pure. A projectId with no server entry keeps whatever the match already had, so an older
 * persisted turn that still carries model-emitted collateral renders unchanged.
 */
export function attachCollateral(
  output: FinderOutput,
  byProject: Record<string, Array<{ type: string; url: string }>> | undefined,
): FinderOutput {
  if (!byProject || output.matches.length === 0) return output
  return {
    ...output,
    matches: output.matches.map((m) => {
      const server = byProject[m.projectId]
      if (!server || server.length === 0) return m
      return { ...m, collateral: server }
    }),
  }
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

/**
 * Does this text actually look like a Reply/Finder envelope? Guards the prose-prefix
 * fallback below so a legitimate answer that merely CONTAINS a brace — a JSON snippet in a
 * how-to, a set in prose — is never truncated at it.
 */
const ENVELOPE_KEY = /"(?:matches|refusal|draft|noSopMatch|clarifyingQuestion|answer|projectId|sopDocIds)"/

export function salvageStructuredText(content: string): string | null {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  // Tolerate a prose PREFIX before the envelope, exactly as extractJsonObject does
  // (quick-kayinleong-053). The quick-051 version required the content to START with '{',
  // so a turn beginning "Let me run the search now.{" — the narration the quick-048 prompt
  // rule forbids but the model still emits — was declined and rendered raw. That single
  // inconsistency is why one turn degraded gracefully and the next did not.
  const brace = unfenced.indexOf('{')
  if (brace === -1) return null
  const trimmed = unfenced.slice(brace)

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

  // Nothing readable INSIDE the envelope. Fall back to the prose the model wrote BEFORE
  // it (quick-kayinleong-056). When a turn is cut off very early the envelope holds only
  // keys — no prose to lift — and the whole thing used to reach the agent as
  // `Let me pull that up.{"matches":[{"projectId":"QiQ…`. The narration is real text the
  // model produced; the braces are not something anyone should ever see.
  const prefix = unfenced.slice(0, brace).replace(/```(?:json)?\s*$/i, '').trim()
  // Machine noise = a recognisable envelope key, OR an object that never closed. A turn
  // cut off inside the very first key has no recognisable key yet — that is precisely the
  // case that leaked — and an unterminated `{` at the tail of a Reply/Finder turn is
  // machine output by contract either way. A CLOSED brace is left alone: prose legitimately
  // says "the shape { projectId, rationale }".
  const machineNoise = ENVELOPE_KEY.test(trimmed) || !trimmed.includes('}')
  return prefix.length > 0 && machineNoise ? prefix : null
}
