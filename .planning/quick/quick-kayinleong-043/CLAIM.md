# Claim: quick-kayinleong-043
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-043-coach-multistep
- started: 2026-07-24
- status: in-progress
- summary: Coach returns an EMPTY response on any question that triggers retrieval, because the chat route caps the Coach pillar at stepCountIs(1) — the loop halts after the retrieveKnowledge tool call before the model can write the grounded answer. Give Coach a multi-step budget (retrieve → answer).

## Context / Symptom

In Coach mode, "tell me about Core Residence @ TRX" streamed:
`retrieveKnowledge → {found:false,reason:'kb_miss'} → finish (finishReason:"tool-calls")`
with ZERO assistant text. The user sees nothing.

Root cause: `app/api/chat/route.ts:502`
`stopWhen: pillar === 'finder' || pillar === 'reply' ? stepCountIs(5) : stepCountIs(1)`
→ Coach = `stepCountIs(1)`. The Coach is a retrieve-then-answer agent: its prompt
(`src/agents/coach/prompt.ts` "Grounding (MANDATORY)") requires it to call
`retrieveKnowledge` (or getCurrentCheckpoint/getCheckpointContent) BEFORE answering and
cite the returned chunk IDs. With a 1-step cap, step 1 is the tool call, `stopWhen`
(stepCount==1) is satisfied, the loop stops, and the model never reaches step 2 to write
the answer. So EVERY Coach turn that triggers a tool call returns empty — the bug affects
Coach's primary purpose (D2-knowledge Q&A), not just this property query. It was masked
because the offline `coachAgent.run()` path (used in unit tests) exercises the full flow
with injected results, while the live streaming path's stepCount was never end-to-end
tested with a tool-calling model.

(The specific query is also a property question asked in Coach mode → retrieval correctly
misses. A separate "nudge to Finder on kb_miss" UX enhancement is possible but OUT OF
SCOPE here — this claim only fixes the empty-response bug. Router accuracy for Auto mode
was handled in quick-kayinleong-041.)

## What will change

- `app/api/chat/route.ts`: give the Coach pillar a multi-step budget so retrieve→answer
  completes (Coach can chain getCurrentCheckpoint → getCheckpointContent/retrieveKnowledge
  → answer, so it needs ≥3; unify to `stepCountIs(5)` like Finder/Reply). Update the stale
  token-accounting comment that assumed Coach is single-step.
- `app/api/chat/route.test.ts`: add a regression assertion that the Coach path is given a
  stopWhen allowing ≥2 steps (so it can answer after a tool call).

## What has changed

_(filled during execution)_

## Verification

_(filled before done)_
