# Claim: quick-kayinleong-034

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-034-coach-help-guidance
- started: 2026-07-19
- status: done
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

- `src/agents/coach/prompt.ts` — added a "Greetings, help, and 'what can you do' (meta questions)" section: for greetings/help/capability/meta messages the Coach answers directly with a short overview of the three modes (Coach / Finder / Reply) + how Auto routing and the mode chips work, and does NOT call retrieveKnowledge or emit a handoff. Retitled the grounding section to "Grounding (MANDATORY — for D2-knowledge questions)" and scoped the kb_miss rule to D2-knowledge questions, so meta questions never trigger the "no article / coach notified" alert.

## Verification

**Automated**
- `src/agents/coach/coach.test.ts` — 28/28 pass. All prompt-content assertions preserved (Test 7: `KB:`, `retrieveKnowledge`, `D2`, `handoff`, `D2-specific`; journey `getCheckpointContent`; `comprehension` + `free-text paraphrase`). The `run()` kb_miss path (Test 4) is unchanged.
- `tsc --noEmit` — clean. `eslint src/agents/coach/prompt.ts` — clean.

**Behavioral proof is live-model + auth gated** (the chat route redirects unauthenticated users to sign-in and needs an API key). To confirm: sign in as a New Agent, type "what can you do" / "hi" → expect a short guidance reply describing Coach/Finder/Reply and how to use Auto + the mode chips, with NO "coach notified" alert. Then ask a real D2-knowledge question absent from the KB → the kb_miss handoff alert should STILL fire (grounding preserved).

**Regression Report**
- *Surface:* the Coach system prompt only — no route, schema, client, or tool change. Grounding + kb_miss remain mandatory for D2-knowledge questions (test-asserted substrings intact; 28 coach tests green), so genuine KB misses still escalate. Finder/Reply, persistence, audit, and the client `isHandoffChunk` detection are untouched.
- *Router placement:* "what can you do" carries no Finder/Reply keywords → routes to Coach (default), so the Coach prompt is the correct single fix point.
- *Residual risk:* the fix is prompt-driven (depends on model compliance) — a standard, high-compliance carve-out. The guidance instruction avoids the literal `kb_miss`/`handoff` tokens the client detects. If ever unreliable, a deterministic router-level "help" fast-path is the follow-up.
- *Not changed (intentional):* pinned Finder/Reply modes still answer in-mode; only the default Coach landing gains meta-question guidance.
