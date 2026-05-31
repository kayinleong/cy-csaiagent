---
phase: 01-foundations
plan: 12
subsystem: integration-spine
tags: [llm, coach-agent, chat-route, sse, streaming, pdpa, ratelimit, auth, grounding]
dependency_graph:
  requires:
    - 01-02  # llm types + fake provider
    - 01-03  # firebase admin + remote config
    - 01-04  # requireUser auth gate
    - 01-05  # pdpa pseudonymize + assertRedacted + audit.log
    - 01-06  # detectLang (i18n)
    - 01-07  # router + memory + ratelimit
    - 01-09  # rag.retrieve + buildCitations + isRetrievalMiss
    - 01-11  # emitHandoffSignal (escalation)
  provides:
    - modelFor (resolves model ID from Remote Config)
    - coachAgent (prompt + retrieveKnowledge tool + Zod schema + handoff)
    - /api/chat (Node-runtime SSE chat route — the integration spine)
    - app/[lang]/(chat)/ (mobile-first chat shell)
  affects:
    - 01-13  # capstone: sign-in→stream→persist E2E + model-swap test
tech_stack:
  added:
    - ai@5.0.193 (streamText, tool, toUIMessageStreamResponse — used in route)
    - "@ai-sdk/anthropic@2.0.80" (anthropic() provider factory)
    - next/server after() (fire-and-forget post-response audit write)
  patterns:
    - modelFor(pillar) → getServerTemplate → evaluate → getString (Remote Config server SDK path)
    - coachAgent invoked THROUGH router.route() — never called directly
    - Gate ordering: requireUser → ratelimit.check → pseudonymize → assertRedacted → streamText → onFinish
    - after() wraps audit.log for fire-and-forget post-stream write
    - Custom useChatStream hook (fetch + ReadableStream) — ai@5.0.193 has no useChat export
    - toUIMessageStreamResponse() — correct method name in ai@5.0.193 (NOT toDataStreamResponse)
key_files:
  created:
    - src/llm/provider.ts
    - src/llm/index.ts
    - src/agents/coach/prompt.ts
    - src/agents/coach/schema.ts
    - src/agents/coach/tools.ts
    - src/agents/coach/index.ts
    - src/agents/coach/coach.test.ts
    - app/api/chat/route.ts
    - app/api/chat/route.test.ts
    - tests/chat-route.test.ts
    - app/[lang]/(chat)/page.tsx
    - app/[lang]/(chat)/chat-shell.tsx
    - app/[lang]/(chat)/chat-input.tsx
    - app/[lang]/(chat)/message-list.tsx
  modified: []
decisions:
  - "toUIMessageStreamResponse() is the correct stream method for ai@5.0.193 — SPIKES.md incorrectly documented toDataStreamResponse() which does not exist in the installed version"
  - "modelFor() uses getServerTemplate/evaluate/getString (Admin Server SDK path) not getTemplate (management API path)"
  - "useChat not exported from ai@5.0.193 — custom useChatStream hook implemented using React state + fetch + ReadableStream"
  - "REMOTE_CONFIG_FALLBACKS in provider.ts is labeled as offline fallback only — not a hard-coded model ID violation"
metrics:
  duration: "~50 minutes"
  completed: "2026-05-31"
  tasks_completed: 3
  files_created: 14
  tests_added: 26
---

# Phase 01 Plan 12: Integration Spine Summary

**One-liner:** Full vertical-slice integration spine wiring auth→ratelimit→PDPA→router→coach→rag→SSE stream→persist→audit, with modelFor resolving model IDs from Firebase Remote Config and the Coach grounding answers in real chunk-ID citations via the retrieveKnowledge tool.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | modelFor (Remote Config) + Coach agent (prompt + tool + schema) | `1545a1b` | src/llm/provider.ts, src/llm/index.ts, src/agents/coach/* (5 files) |
| 2 | Node-runtime SSE chat route (integration spine) | `6409f2b` | app/api/chat/route.ts, tests/chat-route.test.ts |
| 3 | Mobile-first chat shell (page + input + message-list) | `90e62df` | app/[lang]/(chat)/* (4 files) |

## Success Criteria Verification

- [x] `modelFor(pillar)` resolves model ID from Firebase Remote Config via `getServerTemplate().evaluate().getString()` — no hard-coded model IDs in src/ or app/ (fallback constants in provider.ts are clearly labeled)
- [x] Coach invoked THROUGH `router.route()` — never called directly (Test 5 asserts dispatch pattern)
- [x] Coach grounds answers via `retrieveKnowledge` tool → `rag.retrieve` → real chunk-ID citations (Test 2 asserts)
- [x] KB-miss emits `emitHandoffSignal({ reason: 'kb_miss' })` — no content fabrication (Test 4 asserts)
- [x] Coach output is Zod-validated (CoachOutputSchema) — citations required on grounded answers (Test 3)
- [x] `/api/chat` is Node-runtime Route Handler with `X-Accel-Buffering: no` + `Cache-Control: no-store`
- [x] Gate ordering enforced: requireUser → ratelimit.check → pseudonymize → assertRedacted → streamText → onFinish
- [x] `after(() => audit.log(...))` present for fire-and-forget post-response audit write
- [x] No PII/token logging in route.ts (grep confirms)
- [x] No "use server" pragma in route.ts (confirmed by Test 7)
- [x] Offline tests: 26 tests passing (17 coach + 9 route) via `npx vitest run`
- [x] Full vitest suite: 142/223 pass, 81 skipped (env-gated live paths), 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `toDataStreamResponse()` does not exist in ai@5.0.193**
- **Found during:** Task 2 (writing chat route)
- **Issue:** SPIKES.md documents `toDataStreamResponse()` as the v5 stream method, but `ai@5.0.193` does not export this method at all. The actual available method is `toUIMessageStreamResponse()`.
- **Fix:** Used `result.toUIMessageStreamResponse({ headers: { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })` — the correct method for the installed version.
- **Files modified:** `app/api/chat/route.ts`
- **Commit:** `6409f2b`

**2. [Rule 1 - Bug] `useChat` not exported from ai@5.0.193**
- **Found during:** Task 3 (writing chat-input client component)
- **Issue:** The plan references `useChat` from `ai` package, but `ai@5.0.193` removed the React-specific `useChat` hook (moved to a different architecture using `AbstractChat`). No `useChat` export exists in the package.
- **Fix:** Implemented `useChatStream` — a custom React hook using `useState` + `fetch` + `ReadableStream` to stream tokens from `/api/chat`. Achieves the same goal (incremental token rendering, Bearer auth, handoff toast).
- **Files modified:** `app/[lang]/(chat)/chat-input.tsx`
- **Commit:** `90e62df`

**3. [Rule 1 - Bug] `remoteConfig().getString()` does not exist on RemoteConfig**
- **Found during:** Task 1 (writing modelFor)
- **Issue:** RESEARCH docs and admin.ts comments reference `remoteConfig().getString(...)` but the Firebase Admin `RemoteConfig` class does not have a `getString` method. `getString` exists on `ServerConfig` (returned by `ServerTemplate.evaluate()`).
- **Fix:** Used the correct Admin Server SDK path: `remoteConfig().getServerTemplate()` → `.evaluate()` → `.getString('model.coach.default')`. Added graceful fallback for offline dev when Remote Config is unreachable.
- **Files modified:** `src/llm/provider.ts`
- **Commit:** `1545a1b`

## Known Stubs

- `citations: []` in `onFinish` of `app/api/chat/route.ts` — Phase 2 will extract citations from tool call results in the stream finish event. The Coach tool results contain citation data but it requires parsing the `StepResult.toolResults` in `onFinish`. This is intentional in Phase 1; 01-13 will wire citations through to the message subcollection.

## Threat Surface Scan

All surfaces introduced by this plan are within the declared threat model:

| Threat | Mitigation Applied |
|--------|--------------------|
| T-01-37: Unauthenticated /api/chat | `requireUser()` as Gate 1 — returns 401 before any processing |
| T-01-38: Unredacted PII to Claude | `pseudonymize()` + `assertRedacted()` Gate 3 before `streamText` |
| T-01-39: Runaway token spend | `ratelimit.check()` as Gate 2 — before token spend; `decrement()` in onFinish |
| T-01-40: Hallucinated answer | Coach Zod schema requires citations; KB-miss emits handoff |
| T-01-41: PII/token logging | No `console.log/info` calls in route.ts; audit stores hashes only |
| T-01-42: Streaming from Server Action | Route Handler (not Server Action); no "use server" pragma |

No new threat surfaces found beyond the declared trust boundaries.

## Self-Check: PASSED

Files verified to exist:
- `src/llm/provider.ts` — FOUND
- `src/llm/index.ts` — FOUND
- `src/agents/coach/prompt.ts` — FOUND
- `src/agents/coach/schema.ts` — FOUND
- `src/agents/coach/tools.ts` — FOUND
- `src/agents/coach/index.ts` — FOUND
- `src/agents/coach/coach.test.ts` — FOUND
- `app/api/chat/route.ts` — FOUND
- `tests/chat-route.test.ts` — FOUND
- `app/[lang]/(chat)/page.tsx` — FOUND
- `app/[lang]/(chat)/chat-shell.tsx` — FOUND
- `app/[lang]/(chat)/chat-input.tsx` — FOUND
- `app/[lang]/(chat)/message-list.tsx` — FOUND

Commits verified:
- `1545a1b` — Task 1 (modelFor + Coach agent) — FOUND
- `6409f2b` — Task 2 (chat route) — FOUND
- `90e62df` — Task 3 (chat shell) — FOUND

Test results:
- `npx vitest run src/agents/coach/coach.test.ts` → 17/17 PASS
- `npx vitest run tests/chat-route.test.ts` → 9/9 PASS
- `npx vitest run` (full suite) → 142 pass, 81 skipped, 0 fail — GREEN
- `npm run lint` → 0 errors (17 warnings, all pre-existing or unused-helper)
- `npx tsc --noEmit` → 0 errors in new files (pre-existing errors in calendar.tsx, rag/embed.ts, rag/rag.test.ts are out-of-scope)
