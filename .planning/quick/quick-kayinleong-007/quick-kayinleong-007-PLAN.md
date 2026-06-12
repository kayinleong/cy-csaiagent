---
quick_id: quick-kayinleong-007
slug: fix-chat-stream-render
description: Fix chat UI not rendering streamed assistant text — client SSE parser decoded v4 data-stream format, route emits v5 UI Message Stream JSON.
mode: quick
status: planned
must_haves:
  truths:
    - parseTextDelta extracts text from v5 UI Message Stream lines ({"type":"text-delta","delta":"…"}).
    - The old v4 format (0:"token") no longer matches (it is dead — the route never emits it).
    - Non-text chunks (start, text-start, finish, tool-*) return null and are ignored.
    - Malformed / non-JSON lines return null without throwing.
    - chat-input.tsx imports the parser from the new pure module; no behavior change beyond the parse fix.
  artifacts:
    - app/[lang]/chat/decode-stream-chunk.ts
    - app/[lang]/chat/decode-stream-chunk.test.ts
    - app/[lang]/chat/chat-input.tsx
  key_links:
    - app/api/chat/route.ts
    - node_modules/ai/dist/index.d.ts
---

# Plan — quick-kayinleong-007: Fix chat stream render

## Decision summary

- **Why a new file:** `chat-input.tsx` is a `'use client'` island that imports Firebase at
  module top-level, so it can't be unit-tested in vitest without side effects. The project
  already solved this for the decode bridge by extracting pure helpers into
  `decode-stream-chunk.ts`'s sibling `decode-structured-output.ts` (quick-005). Follow that
  precedent: extract the pure SSE-chunk parsing so the fix is lockable with a test.
- **Minimal behavior change:** only `parseTextDelta`'s body changes (v4 regex → v5 JSON parse).
  `isHandoffChunk` moves unchanged. No other logic in the streaming loop changes.

## Task 1 — Extract + fix the parser

**files:** `app/[lang]/chat/decode-stream-chunk.ts` (new), `app/[lang]/chat/chat-input.tsx`

**action:**
- Create `decode-stream-chunk.ts` exporting `parseTextDelta(line)` and `isHandoffChunk(line)`.
  Rewrite `parseTextDelta`: `JSON.parse` the line; if it is an object with
  `type === 'text-delta'` and `typeof delta === 'string'`, return `delta`; else `null`.
  Non-JSON → `null` (caught). `isHandoffChunk` unchanged (substring check on raw line).
- In `chat-input.tsx`, delete the two in-file functions and import them from the new module.

**verify:** `npx tsc --noEmit` clean; the streaming loop still calls `parseTextDelta(dataLine)`.

**done:** chat-input compiles importing the pure helpers; v5 deltas decode.

## Task 2 — Unit test

**files:** `app/[lang]/chat/decode-stream-chunk.test.ts` (new)

**action:** Cover: text-delta → delta string; start/text-start/text-end/finish/finish-step → null;
tool-input-delta → null; malformed JSON → null; empty string → null; old v4 `0:"token"` → null
(proves the dead format); handoff substring detection true/false.

**verify:** `npx vitest run app/[lang]/chat/decode-stream-chunk.test.ts` green.

**done:** all cases pass; full `npx vitest run` shows no regressions.

## Regression surface

- Coach plain-text turns — PRIMARY fix (was empty, now renders).
- Reply/Finder card decode (quick-005) — depended on the same `assistantContent`; also restored.
- `isHandoffChunk` — moved verbatim; unaffected.
- No other module imports `parseTextDelta` (grep-confirmed only chat-input.tsx).
- Existing `decode-structured-output.test.ts` — untouched, must still pass.
