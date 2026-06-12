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
 * Detect a KB-miss handoff signal in a raw stream line (D-10). Substring check on the raw
 * line so it works regardless of where in the chunk the marker appears.
 */
export function isHandoffChunk(line: string): boolean {
  return line.includes('kb_miss') || line.includes('handoff')
}
