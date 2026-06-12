---
quick_id: quick-kayinleong-007
slug: fix-chat-stream-render
status: complete
date: 2026-06-12
---

# Summary — quick-kayinleong-007: Fix chat stream render

## Outcome

The chat surface never rendered streamed assistant text (UAT: "say hi → empty bubble +
'Thinking…', stream completes fine in DevTools EventStream"). Root cause was a client/server
stream-protocol mismatch: the route emits the AI SDK v5 **UI Message Stream** JSON format
(`{"type":"text-delta","id":"0","delta":"…"}`), but the client `parseTextDelta` decoded the
legacy **v4 data-stream** format (`0:"token"`) via a regex that never matched the JSON lines, so
every delta was dropped. Fixed by rewriting the parser to JSON-parse each line and return `delta`
for `text-delta` chunks. The same bug had silently broken the quick-005 Reply/Finder card decode
(`assistantContent` is built from `parseTextDelta`); that path is restored too.

## Changes

- NEW `app/[lang]/chat/decode-stream-chunk.ts` — pure `parseTextDelta` (v5 JSON) + `isHandoffChunk`.
- `app/[lang]/chat/chat-input.tsx` — import the pure helpers; removed the dead in-file v4 parser.
- NEW `app/[lang]/chat/decode-stream-chunk.test.ts` — 9 tests locking the v5 format / dead v4 format.

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → 648 passed | 186 skipped | 0 failed.
- `npx eslint` (3 touched files) → 0 errors (2 pre-existing warnings on chat-input.tsx, out-of-scope).
- Remaining human check: live `npm run dev` "say hi → streamed text renders" (no E2E in session).

Full Regression Report in CLAIM.md.
