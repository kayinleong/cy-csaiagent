# Claim: quick-kayinleong-034

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-034-coach-help-guidance
- started: 2026-07-19
- status: in-progress
- summary: A meta/help question ("what can u do") triggers the Coach's KB-miss "no article / coach notified" alert. Make the Coach recognize greetings/help/capability questions and answer with guidance on how to use the chat (Auto / Coach / Finder / Reply) instead of emitting a handoff.

## Cause

The live chat route streams the Coach via `streamText` with `coachAgent.buildSystemPrompt()`. The Coach prompt mandates KB grounding and says: *"If retrieveKnowledge returns no results, respond ONLY with the handoff signal."* A meta/help question (e.g. "what can you do", "hi") is not a D2-knowledge question, so retrieval misses → the model emits a `kb_miss`/`handoff` signal → `chat-input.tsx` detects the `kb_miss`/`handoff` substring in the stream and shows the "I couldn't find a D2 knowledge base article… coach notified" toast. Poor UX for a capability/greeting question.

## Fix

Update the Coach system prompt (`src/agents/coach/prompt.ts`) to carve out **greetings / help / "what can you do" / meta** questions:
- For these, do NOT call `retrieveKnowledge` and do NOT emit a handoff.
- Answer directly (in the agent's language) with a short overview of the three modes — **Coach** (onboarding/training Q&A), **Finder** (paste lead criteria → ranked D2 matches + collateral), **Reply** (paste a WhatsApp message → drafted reply) — and how to use them (type naturally → Auto routes, or tap the mode chips).
- Scope the existing grounding + kb_miss mandate explicitly to **D2-knowledge questions**, so meta questions never trigger a handoff.

Router placement: "what can you do" has no Finder/Reply keywords → routes to Coach (default), so the Coach prompt is the correct single point of fix. Prompt-only change; no schema/route/client change.

## What will change

- `src/agents/coach/prompt.ts` — add a "greetings / help / meta questions" section; scope the grounding/kb_miss mandate to D2-knowledge questions.

## What has changed

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
