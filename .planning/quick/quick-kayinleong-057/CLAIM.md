# Claim: quick-kayinleong-057
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: quick-055 introduced a latch bug that LOSES a completed reply on client disconnect — fix the writer and stop cancelling the model when the browser goes away

## What will change

User: "the chat history still not save, revisit still doesnt show the meesasge".

Found by re-reading my own 055 code, not by guessing: `persistAssistantOnce` sets
`persisted = true` BEFORE it checks for empty text, and 055 also wired
`abortSignal: req.signal`. So a client disconnect fires `onAbort` with nothing accumulated
yet -> the flag latches -> `consumeStream()` keeps the model running -> `onFinish` arrives
with the FULL reply and is refused by its own guard. Nothing is written. Before 055 that
same disconnect was saved.

Planned:
1. Latch only on an ACTUAL write, never on an empty one.
2. Drop `abortSignal: req.signal` — it cancels the very model call `consumeStream()` exists
   to finish. The two were contradictory; 046 chose finish-and-save, 055 silently reversed it.
3. Let a later, longer text UPGRADE the row so a partial can never shadow a complete turn.
4. One writer, used by onFinish too — the duplicate copy in onFinish is how the latch bug
   came to have two implementations.

## What has changed

`app/api/chat/route.ts` + a new `updateMessage` in `src/memory/conversation.ts`.

**The defect was mine, introduced by quick-055.** Two changes in that claim combined into a
new way to lose a reply:

```
persistAssistantOnce(text, outcome) {
  if (persisted) return
  persisted = true          // <-- latches BEFORE the empty check
  if (text.trim() === '') return
```

plus `abortSignal: req.signal`. A client that refreshes, navigates away, or sends another
message mid-stream aborts the request -> `onAbort` fires with `turnText` still empty ->
the flag latches -> `consumeStream()` keeps the model call alive -> `onFinish` arrives with
the COMPLETE reply and is refused by `if (!persisted)`. Nothing is written. Before 055 that
same disconnect was saved, because onFinish was unconditional.

1. **Latch only on an actual write.** The empty branch returns without claiming anything.
2. **`abortSignal: req.signal` removed.** It cancels the very model call `consumeStream()`
   exists to finish; 046 chose finish-and-save and 055 silently reversed that. `onAbort` is
   kept as a net for any other abort source.
3. **A later, longer text upgrades the row in place** (`updateMessage`, `createdAt`
   untouched) so a partial can never shadow a completed turn, and a shorter one can never
   truncate what is stored.
4. **One writer.** onFinish now calls `persistAssistantOnce` too, supplying the real
   citations and token count. Its duplicate copy of the guard is how the latch bug came to
   exist in two places at once.
5. Writes are serialised on a promise chain (three independent callbacks can overlap) and
   the fire-and-forget calls go through `after()` instead of a bare floating promise.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1026 passed**, 197 skipped, **0 failed** (was 1021; **+5**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### The test that proves it
`onAbort with NO text does not block the onFinish write` fails on the 055 code and passes
on this one — that is the reported bug, reduced. Also pinned: the same for `onError`; an
in-place UPGRADE rather than a second bubble; a shorter later text never overwriting a
longer stored one; and `abortSignal` no longer being passed to `streamText`.

The five quick-055 tests still pass unchanged. They missed this because the "exactly once"
case fired onError and onFinish with the SAME text — never an empty callback followed by a
full one.

### Regression surface
- **Double-write**, the risk 046 named: still prevented, now by `persistedMid` plus the
  length check, and hardened by serialising the callbacks.
- **Token cost:** a turn whose client disconnected now runs to completion. That was already
  046's accepted tradeoff via `consumeStream()`; 055 changed it without saying so.
- **`updateMessage`** uses `set(..., { merge: true })` and never touches `createdAt`, so an
  upgraded message keeps its transcript position.
- The normal path still writes exactly one message with the real token count and citations.

## Honest gaps

1. **This does not explain the losses recorded BEFORE 055 landed** (deficit of 23 across
   41 conversations). `abortSignal` did not exist then, so those had another cause. What it
   does mean is that 055 alone would not have fixed them and would have added a new one.
2. **Not verified live.** Proven against the route's mocks; no authenticated
   refresh-mid-stream reproduction.
3. Live data cannot yet distinguish "the fix is deployed and working" from "the deployment
   does not have the fix" — a normal turn writes identically either way.
