# Claim: quick-kayinleong-048
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: claimed
- summary: A Finder turn shows NO loading indicator during its tool call (the bubble half-writes then freezes), its multi-step text runs together with no paragraph break ("Let me search now.The search returned"), and tool-use narration leaks as prose instead of the JSON envelope — so the MatchList card never renders.

## Context / Symptom

"Find me a 2-bedroom in Cheras, budget 800k" → after two clarifying rounds the final
bubble rendered:

  "Got it. Let me search now.The search returned results, but none are in Cheras and
   none are a clean 2-bedroom within RM800k from Cheras specifically. Let me identify
   the closest qualifying matches — ..."

User: "this message will stop at here without loading indicator, then only append the
rest of the message once it got the response. if u look into that whole message, it's
not properly formatted as well."

NOT a defect: the trailing half-sentence in the screenshot is simply where the stream had
reached (the user describes it appending afterwards) — not a truncation. No step-budget or
maxOutputTokens change is warranted.

Three real root causes:

1. **No indicator during a tool call.** `app/[lang]/chat/chat-shell.tsx:168-170` derives
   `isStreaming` as "last message is an assistant AND content === ''". The instant the
   first token lands, content is non-empty and the indicator disappears — so the entire
   `searchProjects` round-trip between step 1's text and step 2's text has no feedback at
   all. `useChatStream` (`chat-input.tsx:128`) owns the REAL streaming state and never
   propagates it upward, so chat-shell is guessing from message shape.

2. **Multi-step text concatenated with no separator.** In the AI SDK v5 UI Message
   Stream each step's text is its own block: `text-start` carries an `id`, and every
   `text-delta` carries that same `id` (`ai/dist/index.d.ts:1730-1736`).
   `parseTextDelta` (`decode-stream-chunk.ts`) ignores the id and returns only the
   delta, so the caller appends step 2's first token straight onto step 1's last
   character → "Let me search now.The search returned".

3. **Tool-use narration leaks and the card never renders.**
   `src/agents/finder/prompt.ts` has NO instruction against narrating tool use and no
   "return only the JSON object" rule — the same gap the Coach prompt had before
   quick-046. So the model emits conversational prose ("Got it. Let me search now.",
   "Let me identify the closest qualifying matches") instead of a clean FinderOutput
   envelope, `decodeFinderOutput` fails to parse it, and message-list falls back to a raw
   prose bubble instead of the MatchList card. Reply has the same gap.

## What will change

- `app/[lang]/chat/chat-input.tsx` + `chat-shell.tsx`: propagate the real `isStreaming`
  from the hook that owns it, replacing chat-shell's message-shape guess, so the
  indicator stays up for the whole turn including tool calls.
- `app/[lang]/chat/decode-stream-chunk.ts`: add a block-id-aware parser so a new text
  block after a tool call is separated by a paragraph break. `parseTextDelta` kept
  byte-identical for its existing tests.
- `src/agents/finder/prompt.ts` + `src/agents/reply/prompt.ts`: forbid tool-use narration
  and require the bare JSON object (no preamble, no code fence), mirroring the Coach
  output-contract fix from quick-046.
- Tests for all three.

## What has changed

_(pending)_

## Verification

_(pending)_
