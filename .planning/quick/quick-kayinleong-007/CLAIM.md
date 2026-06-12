# Claim: quick-kayinleong-007

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-12
- status: in-progress
- summary: Fix the chat UI never rendering streamed assistant text — the client SSE parser decoded the old AI SDK v4 data-stream format while the route emits the v5 UI Message Stream JSON format, so every text delta was dropped.

## What will change

**Symptom (UAT):** A user sends "hi"; the `/api/chat` SSE stream completes correctly
(DevTools EventStream shows `start → text-delta… → text-end → finish`), but no assistant
text ever appears — only an empty bubble + the "Thinking…" indicator.

**Root cause:** `app/[lang]/chat/chat-input.tsx` `parseTextDelta()` parses the **old AI SDK
v4 data-stream** protocol (`0:"token"`) via `line.match(/^[0-9a-f]:"…"$/)`. The route
(`app/api/chat/route.ts:670`) returns `result.toUIMessageStreamResponse()`, which emits the
**v5 UI Message Stream** format — each SSE `data:` line is a JSON object
`{"type":"text-delta","id":"0","delta":"…"}` (confirmed against `ai@5.0.193`
`uiMessageChunkSchema`, `node_modules/ai/dist/index.d.ts:1734`). A line starting with `{`
never matches the v4 regex, so `parseTextDelta` returns `null` for every chunk → the
assistant message `content` stays `''` → nothing renders.

This also silently broke the quick-005 decode bridge: `assistantContent` (used by
`decodeReplyOutput`/`decodeFinderOutput`) is accumulated from `parseTextDelta` output, so
Reply/Finder card decode never received any text either.

**Planned edits:**
- NEW `app/[lang]/chat/decode-stream-chunk.ts` — pure, unit-testable parsing helpers
  (`parseTextDelta`, `isHandoffChunk`) extracted out of the `'use client'` island so they can
  be tested without React/Firebase (mirrors the quick-005 `decode-structured-output.ts` pattern).
  `parseTextDelta` rewritten to JSON-parse each SSE data line and return `delta` only when
  `type === 'text-delta'`.
- `app/[lang]/chat/chat-input.tsx` — remove the in-file `parseTextDelta`/`isHandoffChunk` and
  import them from the new module. No other behavior changes.
- NEW `app/[lang]/chat/decode-stream-chunk.test.ts` — RED→GREEN coverage locking the v5 format
  and proving the v4 format no longer matches.

## What has changed

_(filled on completion)_

## Verification

_(filled on completion — Regression Report)_
