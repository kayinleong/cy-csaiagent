# Claim: quick-kayinleong-057
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
