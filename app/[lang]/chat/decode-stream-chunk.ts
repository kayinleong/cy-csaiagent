/**
 * app/[lang]/chat/decode-stream-chunk.ts — pure SSE stream-chunk parsers.
 *
 * Extracted out of the chat-input.tsx 'use client' island so they can be unit-tested
 * without pulling in React/Firebase (mirrors decode-structured-output.ts).
 *
 * The route returns `result.toUIMessageStreamResponse()` (app/api/chat/route.ts), which
 * emits the AI SDK v5 **UI Message Stream** format: each SSE `data:` line is a JSON object
 * `{"type":"text-delta","id":"0","delta":"…"}` (ai@5.0.193 uiMessageChunkSchema). NOT the
 * legacy v4 data-stream format (`0:"token"`).
 */

/**
 * Parse one UI Message Stream SSE data line and return its text content.
 *
 * Returns the `delta` string only for `text-delta` chunks; every other chunk type
 * (start, start-step, text-start, text-end, finish-step, finish, tool-*, error) and any
 * malformed / non-JSON line returns null.
 */
export function parseTextDelta(line: string): string | null {
  try {
    const chunk = JSON.parse(line) as unknown
    if (
      chunk !== null &&
      typeof chunk === 'object' &&
      (chunk as { type?: unknown }).type === 'text-delta' &&
      typeof (chunk as { delta?: unknown }).delta === 'string'
    ) {
      return (chunk as { delta: string }).delta
    }
    return null
  } catch {
    return null
  }
}

/**
 * @deprecated quick-kayinleong-046 — use `parseMessageMetadata(line).kbMiss` instead.
 *
 * This was a raw substring sniff for 'kb_miss' / 'handoff' anywhere in the line. It only
 * ever fired because the Coach's `{answer,citations,handoff}` JSON envelope was leaking
 * into the stream as literal text — i.e. it depended on the very bug it sat next to. It
 * also false-positived on any turn where a user or the model merely mentioned the word
 * "handoff". The server now reports the miss authoritatively from the real retrieval tool
 * results. Retained only so external callers do not break; no longer used by chat-input.
 */
export function isHandoffChunk(line: string): boolean {
  return line.includes('kb_miss') || line.includes('handoff')
}

/**
 * Parse a UI Message Stream `error` chunk and return its message.
 *
 * Stream-level failures do NOT arrive as a non-2xx response — the AI SDK has already
 * sent HTTP 200 and its headers by the time the model call fails, so the failure
 * arrives mid-stream as `{"type":"error","errorText":"…"}`. `parseTextDelta` returns
 * null for it, which is correct (it is not text) but meant the caller silently dropped
 * it: the user got an empty assistant bubble, no toast, and a latched "streaming"
 * spinner. That is the "it didn't respond" symptom (quick-kayinleong-046 / RC-3).
 *
 * Returns the errorText for `error` chunks; null for every other chunk type and for
 * malformed / non-JSON lines.
 */
export function parseStreamError(line: string): string | null {
  try {
    const chunk = JSON.parse(line) as unknown
    if (
      chunk !== null &&
      typeof chunk === 'object' &&
      (chunk as { type?: unknown }).type === 'error'
    ) {
      const text = (chunk as { errorText?: unknown }).errorText
      return typeof text === 'string' && text.length > 0 ? text : 'stream error'
    }
    return null
  } catch {
    return null
  }
}

/** Server-authoritative per-turn metadata (app/api/chat/route.ts messageMetadata). */
export interface StreamMessageMetadata {
  /** The pillar that actually answered — NOT the client's override chip. */
  pillar?: 'coach' | 'finder' | 'reply'
  /** `${pillar}:${reason}` — observability only. */
  routeDecision?: string
  /** KB chunk IDs derived server-side from real tool results. */
  citations?: string[]
  /** True when a Coach turn ran retrieval and got nothing back (D-10). */
  kbMiss?: boolean
}

/**
 * Parse the `messageMetadata` payload out of a stream line.
 *
 * The route attaches metadata to the `start` chunk (pillar, so the client can pick a
 * renderer before any text arrives) and to the `finish` chunk (pillar + citations +
 * kbMiss). The SDK may also emit it as a standalone `message-metadata` chunk, so all
 * three shapes are accepted.
 *
 * This replaces two client-side guesses that caused real bugs:
 *   - decoding gated on `pillarOverride`, which is `undefined` in Auto mode (so no
 *     decoder ran and raw JSON reached the bubble) and stale after a hero-card tap;
 *   - `isHandoffChunk`, a raw substring sniff for 'kb_miss'/'handoff' that only worked
 *     while the Coach's JSON envelope was leaking into the stream as literal text.
 *
 * Returns null when the line carries no metadata.
 */
export function parseMessageMetadata(line: string): StreamMessageMetadata | null {
  try {
    const chunk = JSON.parse(line) as unknown
    if (chunk === null || typeof chunk !== 'object') return null
    const type = (chunk as { type?: unknown }).type
    if (type !== 'start' && type !== 'finish' && type !== 'message-metadata') return null

    const meta = (chunk as { messageMetadata?: unknown }).messageMetadata
    if (meta === null || typeof meta !== 'object') return null

    const m = meta as Record<string, unknown>
    const pillar = m.pillar
    const citations = m.citations
    const out: StreamMessageMetadata = {}
    if (pillar === 'coach' || pillar === 'finder' || pillar === 'reply') out.pillar = pillar
    if (typeof m.routeDecision === 'string') out.routeDecision = m.routeDecision
    if (Array.isArray(citations)) {
      out.citations = citations.filter((c): c is string => typeof c === 'string')
    }
    if (typeof m.kbMiss === 'boolean') out.kbMiss = m.kbMiss

    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

/** One text delta plus the id of the text BLOCK it belongs to. */
export interface TextChunk {
  /** The `text-start` block id this delta belongs to. */
  id: string
  delta: string
}

/**
 * Parse a `text-delta` chunk, keeping the block id (quick-kayinleong-048).
 *
 * A multi-step turn emits ONE text block per step: `text-start` opens a block with an
 * `id`, every `text-delta` carries that same id, `text-end` closes it, and the next step
 * opens a fresh block with a NEW id (ai@5.0.193 uiMessageChunkSchema,
 * ai/dist/index.d.ts:1730-1736).
 *
 * `parseTextDelta` discards the id, so a caller that simply concatenates every delta
 * welds the last character of step 1 onto the first character of step 2 — which is how a
 * Finder turn rendered "Got it. Let me search now.The search returned results…". Keeping
 * the id lets the caller insert a paragraph break exactly at a block boundary, and
 * nowhere else (mid-block newlines must stay untouched, or markdown breaks).
 *
 * Returns null for every non-`text-delta` chunk and for malformed lines.
 */
export function parseTextChunk(line: string): TextChunk | null {
  try {
    const chunk = JSON.parse(line) as unknown
    if (
      chunk !== null &&
      typeof chunk === 'object' &&
      (chunk as { type?: unknown }).type === 'text-delta' &&
      typeof (chunk as { delta?: unknown }).delta === 'string'
    ) {
      const c = chunk as { id?: unknown; delta: string }
      return { id: typeof c.id === 'string' ? c.id : '', delta: c.delta }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Separator inserted between two adjacent text blocks of the same assistant turn.
 *
 * A blank line, not a single newline: the bubble renders through MarkdownMessage, where a
 * lone newline is only a soft break and would still read as one run-on paragraph.
 */
export const TEXT_BLOCK_SEPARATOR = '\n\n'
