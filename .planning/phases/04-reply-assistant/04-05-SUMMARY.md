---
phase: 04-reply-assistant
plan: 05
subsystem: api
tags: [reply-agent, ai-sdk-v5, zod, rag, leadContext, grounding, trilingual]

# Dependency graph
requires:
  - phase: 03-finder-routing
    provides: "finderAgent shape (frozen as const + read-only tools + Zod output schema + offline run); FinderSlot/readFinderSlot; coach retrieveKnowledge rag-facade wrapper"
  - phase: 04-reply-assistant (Plan 03)
    provides: "pillar-parameterized rag retrieve facade (opts { pillar, category }); kbChunks.pillar denormalization"
  - phase: 04-reply-assistant (Plan 01)
    provides: "Wave-0 RED tests (reply.test.ts; memory readReplySlot contract)"
provides:
  - "replyAgent frozen object (buildSystemPrompt / makeTools / outputSchema / offline run) mirroring finderAgent"
  - "ReplyOutputSchema (draft | noSopMatch | clarifyingQuestion) with non-empty sopDocIds grounding trail"
  - "Reply read-only tools: retrieveReplySop (pillar:'reply'), fetchVoiceSamples (org-voice doc, D-12), fetchLeadContext (readReplySlot)"
  - "ReplySlot type + readReplySlot (per-lead isolation, empty-object->null)"
affects: [04-06 (chat-route 3-pillar dispatch + replySlot onFinish), 04-08 (reply draft card), 04-09 (judge rubric + gold sets)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reply agent core mirrors Finder agent shape line-for-line (grow, don't fork)"
    - "Offline run() with injected tool-result (injectedSopResult) exercises the grounding/refusal gate without Firestore or Anthropic"
    - "App-level XOR invariant (draft XOR noSopMatch XOR clarifyingQuestion) enforced in index.ts, validated by ReplyOutputSchema.parse"
    - "Read-only tools; slot write deferred to route onFinish (Pitfall 23/36)"

key-files:
  created:
    - src/agents/reply/schema.ts
    - src/agents/reply/prompt.ts
    - src/agents/reply/tools.ts
    - src/agents/reply/index.ts
  modified:
    - src/memory/leadContext.ts
    - src/memory/memory.test.ts
    - src/agents/reply/reply.test.ts

key-decisions:
  - "injectedSopResult typed as a structural InjectedSopResult (found:boolean) so plain Wave-0 test fixtures type-check; run() narrows on found at runtime"
  - "Offline run() emits deterministic, classification-correct grounded draft text (cold-prospect = qualifying questions); the real model-authored draft is produced by the streaming path in Plan 06"
  - "retrieveReplySop applies category narrowing in-memory in the tool AND forwards pillar to the rag facade (defense in depth, no second index)"

patterns-established:
  - "Reply pillar = Finder pillar template: frozen as const agent, read-only tools, Zod output schema, offline run()"
  - "Grounded refusal on no_sop_match (D-11): a retrieval miss returns noSopMatch, never a fabricated draft"
  - "Per-lead isolation via leadId-keyed readReplySlot + draft built only from the current turn's inputs"

requirements-completed: [REPLY-01, REPLY-02, REPLY-03, REPLY-05, REPLY-06, REPLY-07, REPLY-08]

# Metrics
duration: ~8min
completed: 2026-06-05
---

# Phase 4 Plan 05: Reply Assistant Agent Core Summary

**Reply Assistant agent core mirroring Finder — `ReplyOutputSchema` (draft | noSopMatch | clarifyingQuestion), three read-only tools (retrieveReplySop/fetchVoiceSamples/fetchLeadContext), frozen `replyAgent` with an offline grounding-gate `run()`, plus `ReplySlot`/`readReplySlot` per-lead context.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-05T20:37Z (local +08)
- **Completed:** 2026-06-05T20:45Z (local +08)
- **Tasks:** 2 (both TDD)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `src/agents/reply/{index,prompt,schema,tools}.ts` created as a faithful line-for-line mirror of `src/agents/finder/*` — frozen `replyAgent as const` with `buildSystemPrompt` / `makeTools` / `outputSchema` / offline `run()`.
- `ReplyOutputSchema` enforces the grounding trail: a `draft` requires a NON-EMPTY `sopDocIds` array; the XOR (draft | noSopMatch | clarifyingQuestion) is enforced at the app level in `index.ts` then validated by `ReplyOutputSchema.parse`.
- Three READ-ONLY tools: `retrieveReplySop` (rag facade `retrieve(query, userLang, { pillar:'reply' })` + in-memory category narrowing, `[SOP:doc-id]` citations, `no_sop_match` on a miss), `fetchVoiceSamples` (curated org-voice KB doc whole-doc read, D-12), `fetchLeadContext` (wraps `readReplySlot`, per-lead scoped). No `.set/.add/.update` in any `execute`.
- `ReplySlot` type + `readReplySlot` added to `src/memory/leadContext.ts` (copied from `readFinderSlot`, reading `data.replySlot`, empty-object→null first-touch semantics).
- The grounded refusal path (D-11) is unit-covered: an injected SOP miss yields `noSopMatch` and never a draft; cold-prospect drafts use qualifying questions (REPLY-05); parallel-lead isolation holds (Lead B's draft never contains Lead A content).

## Task Commits

Each task was committed atomically (TDD: implementation + flipped RED→GREEN tests in one commit per task, since the Wave-0 RED suite already existed):

1. **Task 1: ReplyOutputSchema + reply prompt builder + ReplySlot/readReplySlot** - `0e236f7` (feat)
2. **Task 2: Reply read-only tools + replyAgent frozen object with offline run()** - `6d9670f` (feat)

**Plan metadata:** _(this SUMMARY + STATE/ROADMAP — committed by the orchestrator)_

## Files Created/Modified
- `src/agents/reply/schema.ts` (created) - `ReplyOutputSchema` + `ReplyDraftSchema`/`ReplyNoSopMatchSchema` + `ReplyOutput` type; draft.sopDocIds non-empty; app-level XOR note.
- `src/agents/reply/prompt.ts` (created) - `buildReplySystemPrompt(options?)` + `REPLY_SYSTEM_PROMPT`; grounding mandate (`[SOP:` cite, `no_sop_match` refusal), cold-prospect qualifying questions, org-voice injection (D-12), Tone/Language baseline.
- `src/agents/reply/tools.ts` (created) - `makeRetrieveReplySopTool` / `makeFetchVoiceSamplesTool` / `makeFetchLeadContextTool` (all READ-ONLY) + tool-result types.
- `src/agents/reply/index.ts` (created) - frozen `replyAgent` + `ReplyRunArgs`/`InjectedSopResult` + offline `buildOutputFromSopResult`/`buildDraftText`.
- `src/memory/leadContext.ts` (modified) - added `ReplySlot` interface + `readReplySlot`.
- `src/memory/memory.test.ts` (modified) - added `readReplySlot` recall (exists / first-touch / empty-object) + replySlot-isolation tests.
- `src/agents/reply/reply.test.ts` (modified) - flipped 11 Wave-0 `it.fails` RED guards to GREEN assertions; added empty-`sopDocIds` reject + `clarifyingQuestion`-only schema cases.

## Decisions Made
- **`injectedSopResult` typed as a structural `InjectedSopResult` (`found: boolean`)** rather than the strict `ReplySopResult` discriminated union. The Wave-0 fixtures use `found: true` without `as const` (so it widens to `boolean`); accepting the structural shape keeps the contract honest while `run()` narrows on `found` at runtime. The tools file still exports the strict `ReplySopResult` union for the live path.
- **Offline `run()` emits deterministic, classification-correct grounded draft text** (cold-prospect → qualifying questions with a `?`; objection → acknowledge-then-reframe; financing → defer rates to bank), each citing the real injected SOP doc IDs. This is intentional: the live, model-authored draft is produced by the streaming path in Plan 06 (`modelFor('reply')` resolved in the route — the core never calls `modelFor`).
- **`retrieveReplySop` narrows `category` in-memory in the tool AND forwards `pillar` to the rag facade** — defense in depth; the facade already supports both, no second composite index needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded the read-only header comment so the plan's grep guard passes**
- **Found during:** Task 2 (verify step)
- **Issue:** The plan's automated guard is `! grep -rE "\.(set|add|update)\(" src/agents/reply/tools.ts`. The copied Finder header doc-comment contained the literal substring `(no .set(), .add(), .update())`, which matched the regex and failed the guard even though no `execute` performs a write.
- **Fix:** Reworded the comment to "no Firestore mutations (no set/add/update)" — preserves the read-only intent without tripping the literal grep.
- **Files modified:** `src/agents/reply/tools.ts`
- **Verification:** `! grep -rE "\.(set|add|update)\(" src/agents/reply/tools.ts` → GUARD_PASS.
- **Committed in:** `6d9670f` (Task 2 commit)

**2. [Rule 3 - Blocking] Loosened `ReplyRunArgs.injectedSopResult` to a structural type to satisfy `tsc`**
- **Found during:** Task 2 (typecheck)
- **Issue:** The Wave-0 test fixtures pass `{ found: true, citations, context }` (no `as const`), so `found` widens to `boolean` and would not assign to the strict `ReplySopResult` discriminated union — `tsc --noEmit` failed.
- **Fix:** Introduced `InjectedSopResult { found: boolean; citations?; context?; reason? }` for the offline `run()` input; `buildOutputFromSopResult` narrows on `found` and reads `citations ?? []`.
- **Files modified:** `src/agents/reply/index.ts`
- **Verification:** `npm run typecheck` exits 0; all 13 reply tests pass.
- **Committed in:** `6d9670f` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking). Both were necessary to satisfy the plan's own automated verify gates (grep guard + typecheck). No scope creep; no behavior change beyond what the plan specifies.

## Issues Encountered
- The plan's Task-1 verify (`npx vitest run src/memory/memory.test.ts`) referenced a `readReplySlot` behavior, but the Wave-0 `memory.test.ts` had no `readReplySlot` test yet (only `readFinderSlot`). Per the orchestrator note ("relevant `src/memory/memory.test.ts` additions"), I added the `readReplySlot` recall + replySlot-isolation tests (mirroring the `readFinderSlot` block) as the TDD coverage for the new reader. Resolved within Task 1.

## Known Stubs
None. The offline `run()` produces deterministic grounded draft text rather than model output, but that is by design — the model-authored draft is the streaming path's job (Plan 06). The agent core is fully wired (read-only tools call the live rag facade / Firestore refs / `readReplySlot`); nothing is hardcoded-empty awaiting a future plan.

## TDD Gate Compliance
Both tasks are `tdd="true"`. The RED phase was established in Wave-0 Plan 04-01 (`reply.test.ts` `it.fails` guards + the `memory.test.ts` `readFinderSlot` pattern this plan extends). This plan executed the GREEN phase: implemented the modules and flipped the RED guards to passing assertions in the same task commits. Per-task commits are `feat(...)` (GREEN); no separate `test(...)` RED commit was created in this plan because the RED suite pre-existed from 04-01 — this is the expected continuation pattern for a Wave-0/Wave-2 split, not a gate violation.

## User Setup Required
None - no external service configuration required for this plan. (Note: the `kbChunks (pillar,...)` vector index deploy + chunk pillar backfill from Plan 04-03 remain prerequisites for live `retrieveReplySop` retrieval — already flagged in `04-03-SUMMARY.md`.)

## Next Phase Readiness
- `replyAgent` + `readReplySlot` are ready for Plan 04-06 (3-pillar chat-route dispatch): the route adds an `else if (pillar === 'reply')` branch reading `storedReplySlot = await readReplySlot(leadId)`, building `replyAgent.buildSystemPrompt({ replySlot, incoming, voiceSamples, leadId })` + `replyAgent.makeTools(userLang, uid, leadId)`, resolving `modelFor('reply')`, and writing `replySlot` in `onFinish` (the write the read-only tools deliberately omit).
- `ReplyOutputSchema` is ready for the draft card (Plan 04-08) and the judge rubric / gold sets (Plan 04-09).
- `npm run test` exits 0 (487 passed | 14 expected-fail (downstream Wave 3-6 RED stubs) | 107 skipped | 0 failed); `npm run typecheck` clean; `eslint` 0 errors.

## Self-Check: PASSED

- Created files verified on disk: `src/agents/reply/{index,prompt,schema,tools}.ts`, `src/memory/leadContext.ts` (grown), `.planning/phases/04-reply-assistant/04-05-SUMMARY.md`.
- Commit hashes verified in git: `0e236f7` (Task 1), `6d9670f` (Task 2).

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
