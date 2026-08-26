# Claim: quick-kayinleong-055
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: 19 assistant responses are missing from Firestore (26% of conversations). onFinish is the ONLY thing that persists an assistant message, so any turn that errors or aborts saves the user's question and nothing else — the user sees their own messages with no replies when they revisit a chat.

## Evidence (live Firestore)

    conversations: 39   with MISSING assistant replies: 10 (26%)
    messages: 151   user=85   assistant=66   => 19 LOST responses
    usageEvents: 64   assistant messages: 66

The user reported it directly with a screenshot: a restored conversation showing two
user bubbles and zero replies (`chat-23e76625…`, user=2 assistant=0).

**`onFinish` never ran for these turns.** `recordUsageEvent` is written at the END of
onFinish, so if onFinish had run and only `appendMessage` failed, usageEvents would
OUTNUMBER assistant messages. They do not (64 ≤ 66). Combined with the user message being
present — it is written BEFORE the model call since quick-046 — the turn started, the
model call did not complete cleanly, and nothing after it ever ran.

Ruled out: the rate-limit (429) and PDPA (422) gates both return BEFORE the user-message
write, so they cannot orphan a turn. The onFinish body is also not at fault — the
quick-053 health check is try/caught and `appendMessage` is the first write after it.

## The design flaw

`onFinish` is the SINGLE persistence path for an assistant message. Every other
termination route — a model/stream error, a client disconnect, an aborted request, a
timeout — writes nothing. quick-046 added `consumeStream()` to survive a client
disconnect, and deliberately did NOT pair it with `onAbort` ("only one may own the
assistant write"). That reasoning was right about double-writes and wrong about coverage:
it left every failure path silent.

Worse, quick-046's RC-3 fix renders an error bubble CLIENT-side when a stream errors —
so the agent sees something at the time, but nothing is ever written. On revisit the turn
has vanished entirely, which is exactly what was reported.

## What will change

- Accumulate the streamed text server-side (extend the existing `onStepFinish`, which
  already tracks grounding).
- A single idempotent `persistAssistantOnce()` guarded by a flag, so the assistant message
  is written exactly once regardless of which callback fires first.
- Call it from `onFinish` (unchanged behaviour), and additionally from `onError` and
  `onAbort` so a failed or aborted turn still persists what the model produced, marked so
  it is not mistaken for a complete answer.
- Wire `abortSignal: req.signal` so `onAbort` can actually fire.

## Verification

_(pending)_
