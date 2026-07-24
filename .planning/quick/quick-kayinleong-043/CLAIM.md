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

- `app/api/chat/route.ts`:
  - Changed `stopWhen` from `pillar === 'finder' || pillar === 'reply' ? stepCountIs(5)
    : stepCountIs(1)` to `stepCountIs(5)` for ALL pillars. Coach can now complete
    retrieve→answer (and chain getCurrentCheckpoint → getCheckpointContent →
    retrieveKnowledge → answer) instead of halting after the first tool call.
  - Rewrote the `stopWhen` comment to explain all three pillars are retrieve-then-answer
    and need ≥2 steps; noted the quick-043 root cause inline.
  - Updated the token-accounting REGRESSION-NOTE: all pillars are now multi-step, so the
    last-step rate-limit decrement undercounts Coach too (pre-existing TOKEN_CAP issue,
    still a separate claim); clarified usage CAPTURE uses `final.totalUsage` (accurate).
- `app/api/chat/route.test.ts`: added Test 4b — asserts the Coach path is handed
  `stopWhen = stepCountIs(n)` with `n >= 2` (regression guard against re-capping Coach
  to a single step).

## Verification

**Regression surface:** the single `streamText` call (shared by all three pillars), the
Coach dispatch branch, Coach onFinish citation extraction (iterates all steps — unaffected
/ now captures the answer step too), and per-pillar step budgets (Finder/Reply were
already 5 — behavior unchanged; only Coach 1→5 changed).

**What was tested / ruled out:**
- `npx vitest run app/api/chat/route.test.ts` → 40 passed (incl. new Test 4b). Coach path
  now receives a ≥2-step budget.
- `npx vitest run tests/chat-route.test.ts src/agents/coach` → 37 passed. Coach agent +
  integration behavior unaffected.
- `npx tsc --noEmit` → 0. `npx eslint app/api/chat/route.ts(+test)` → 0 errors (4
  pre-existing warnings in the test file: makeStreamResponse/_opts unused + 2 unused
  eslint-disable directives — none in my diff).
- Finder/Reply ruled out as regressed: they were already `stepCountIs(5)`; unifying the
  ternary to `stepCountIs(5)` leaves their budget identical.
- Citation extraction ruled index/loop-safe: `extractCitationChunkIds` already iterates
  every `final.steps[*].toolResults`, so a multi-step Coach turn's citations are still
  collected (now alongside a real answer step).

**Not verifiable here:** the live Coach answer render needs an auth'd chat session + a
real tool-calling model + ingested Coach KB (the streaming path is admin/auth-gated;
`next dev` only 307→sign-in). The empty-response → answers-after-retrieval fix is proven
by the step-budget regression test; a production smoke-test (ask Coach a D2-training
question, confirm it retrieves AND answers with [KB:…] citations) is the final check.

NOTE (out of scope, optional follow-up): for an out-of-scope question in Coach mode (e.g.
a property query → kb_miss), Coach will now respond with a grounded "not in training
materials" message. A softer "this looks like a Finder question — switch to Finder" nudge
on kb_miss is a possible UX enhancement, deferred (the user chose router-accuracy in
quick-041 over a redirect/fallback approach).

- status: done
