# Claim: quick-kayinleong-007

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-12
- status: done
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

- **NEW** `app/[lang]/chat/decode-stream-chunk.ts` — pure `parseTextDelta` / `isHandoffChunk`
  helpers, extracted out of the `'use client'` island (mirrors `decode-structured-output.ts`).
  `parseTextDelta` now `JSON.parse`s each SSE data line and returns `delta` ONLY for
  `{"type":"text-delta", … , "delta": string}` chunks; every other chunk type and any
  malformed/non-JSON line (including the v5 `[DONE]` sentinel and the dead v4 `0:"token"`
  format) returns `null` without throwing. `isHandoffChunk` moved verbatim.
- `app/[lang]/chat/chat-input.tsx` — deleted the in-file `parseTextDelta`/`isHandoffChunk` and
  imported them from the new module. The streaming loop is otherwise untouched (still calls
  `parseTextDelta(dataLine)` / `isHandoffChunk(dataLine)` exactly as before).
- **NEW** `app/[lang]/chat/decode-stream-chunk.test.ts` — 9 tests: text-delta extraction,
  whitespace/escape preservation, empty-string delta, all lifecycle chunks ignored, tool/error
  chunks ignored, legacy v4 format no longer matches, malformed/non-JSON → null, handoff detection.

## Verification

**Self-audit of the diff (regression-prevention):** `git diff` on `chat-input.tsx` shows ONLY
the import line added + the two function definitions removed — zero change to the streaming
loop, the POST body, the decode bridge, or any gate. The two extracted functions are
byte-identical for `isHandoffChunk` and a body-only rewrite for `parseTextDelta`. The v5
`[DONE]` end sentinel and any tool/finish chunk safely return `null` (verified by test).

**Automated gates (HEAD):**
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **648 passed | 186 skipped | 0 failed** (55 files). The new
  `decode-stream-chunk.test.ts` (9 tests) is green; `decode-structured-output.test.ts` (14)
  still green.
- `npx eslint` on the 3 touched files → **0 errors**. 2 warnings remain on `chat-input.tsx`
  (`onAuthStateChanged` unused import L29; one unused eslint-disable directive) — both
  PRE-EXISTING and documented out-of-scope in the quick-005 SUMMARY; neither introduced here
  (my deletion only shifted the disable directive's line number). New files lint clean.

**Regression surface (each ruled out):**
- *Coach plain-text turns* — PRIMARY fix. Were rendering an empty bubble; the v5 `text-delta`
  chunks now decode so streamed text appears. (This was the reported UAT symptom.)
- *Reply/Finder card decode (quick-005)* — `assistantContent` is accumulated from
  `parseTextDelta` output, so it was silently receiving nothing. Restored by the same fix; the
  decode-gate tests still pass.
- *Handoff toast (D-10)* — `isHandoffChunk` moved verbatim (substring check on the raw line);
  unaffected. Covered by new tests.
- *Other consumers* — grep confirms `parseTextDelta`/`isHandoffChunk` are imported only by
  `chat-input.tsx`. No other call site.
- *Streaming buffer / SSE `data:` stripping / POST gates* — untouched.

**Not verified by automated gates:** the live browser render (no E2E run in this session). The
unit test reproduces the exact failing wire format from the UAT EventStream
(`{"type":"text-delta","id":"0","delta":"Hello"}`), so the fix is locked at the parse layer;
a manual `npm run dev` "say hi → see streamed text" check is the remaining human confirmation.
