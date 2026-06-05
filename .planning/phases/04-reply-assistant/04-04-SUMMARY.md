---
phase: 04-reply-assistant
plan: 04
subsystem: api
tags: [router, intent-classification, reply-pillar, heuristic, zod, ai-sdk, remote-config]

# Dependency graph
requires:
  - phase: 04-reply-assistant (Plan 04-01, Wave 0)
    provides: Wave-0 RED guards — `heuristic.test.ts` reply-routing `it.fails` cases + `classifier.test.ts:95` inverted reply-rejection `it.fails` assertion
  - phase: 03-finder-routing
    provides: `heuristicPillar` + `route`/`routeAsync` + `RouteSchema`/`classifyIntent` (two-pillar seam; `Pillar` type already includes `'reply'`)
provides:
  - "heuristicPillar returns 'reply' for inbound-paste / 'draft a reply' / 'lead said' structural signals"
  - "Reply structural signals checked BEFORE the Finder keyword scan (no mis-route on RM/financing pastes — Pitfall C)"
  - "Ternary RouteSchema enum ['coach','finder','reply'] — the LLM classifier can now return 'reply'"
  - "ROUTER_SYSTEM_PROMPT Reply paragraph (paste incoming WhatsApp → draft a reply)"
affects: [04-06 (3-pillar chat-route dispatch), 04-08 (override-chip widening to 'reply'), reply-assistant routing-quality evals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Precedence-ordered heuristic: structural Reply signals scanned before generic Finder keyword scan"
    - "Inbound-block heuristic: multi-line/quoted paste + reply-trigger word as a structural (not keyword) routing signal"
    - "Binary→ternary Zod enum widening with Remote-Config model resolution preserved (no hard-coded model ID)"

key-files:
  created: []
  modified:
    - src/router/heuristic.ts
    - src/router/heuristic.test.ts
    - src/router/classifier.ts
    - src/router/classifier.test.ts

key-decisions:
  - "Reply structural patterns checked BEFORE FINDER_PATTERNS so RM/financing pastes that are reply requests route to 'reply' (Pitfall C / A6)"
  - "Added a conservative inbound-block heuristic (2+ newlines OR a quote marker AND a reply trigger word) so multi-line pastes without a single regex hit still route to reply, while pure multi-line Finder criteria pastes do NOT trip it"
  - "Classifier model stays modelFor('router') from Remote Config — no literal model ID added (QUAL-01 / T-04-ROUTE-b)"
  - "Did NOT touch the sync route() decision logic or routeAsync() — only the heuristicPillar return union widened, which is backward-compatible (Pitfall 7 / T-03-18)"

patterns-established:
  - "Pattern 1: Reply-precedence ordering — structural reply signals win over keyword-based Finder/Coach matches in heuristicPillar"
  - "Pattern 2: Structural paste detection (looksLikeInboundPaste) as a routing signal independent of explicit keywords"

requirements-completed: [REPLY-10]

# Metrics
duration: ~6min
completed: 2026-06-05
---

# Phase 4 Plan 04: Intent Router 3-Pillar Activation Summary

**Activated the third pillar in the intent router — heuristicPillar now detects Reply structural signals (with precedence over Finder keywords to defeat RM/financing mis-routes) and the LLM classifier RouteSchema widened binary→ternary, with Remote-Config model resolution preserved.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-05T20:30Z
- **Completed:** 2026-06-05T20:34Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `heuristicPillar` returns `pillar:'reply'` for `draft a reply` / `reply to this` / `what should I reply` / `lead said …` structural signals, plus an inbound-block heuristic for multi-line/quoted pastes carrying a reply-trigger word.
- Reply structural signals are checked BEFORE the `FINDER_PATTERNS` loop, so a pasted inbound mentioning `RM`/`financing` routes to `'reply'`, not `'finder'` (Pitfall C / REPLY-10). A pure Finder query with no reply signal still routes to `'finder'` (regression guard).
- `RouteSchema` enum widened to `['coach','finder','reply']`; `classifyIntent` return type updated; `ROUTER_SYSTEM_PROMPT` gained a parallel Reply paragraph. `modelFor('router')` resolution untouched (no hard-coded model ID).
- Flipped all 5 Wave-0 `it.fails` RED guards in the two router test files to real passing assertions (3 in `heuristic.test.ts`, 2 inverted assertions in `classifier.test.ts`) and added a Finder-precedence-preserved regression test.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend heuristicPillar with Reply patterns (correct precedence)** — `bebd52a` (feat)
2. **Task 2: Widen the classifier to 3 pillars (Remote Config preserved)** — `e8868f2` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + CLAIM update)

_Note: both tasks are `tdd="true"` Wave-0 GREEN-turn tasks — the RED tests already existed (Plan 04-01); this plan flipped the `it.fails` guards to real assertions in the same commit as the implementation that satisfies them._

## Files Created/Modified
- `src/router/heuristic.ts` — Added `REPLY_PATTERNS` array + `looksLikeInboundPaste` inbound-block heuristic; `heuristicPillar` checks Reply structural signals before `FINDER_PATTERNS`; return union widened to `'coach'|'finder'|'reply'`.
- `src/router/heuristic.test.ts` — Flipped 3 `it.fails` reply-routing RED guards to real assertions; added a "pure Finder query still routes to finder" precedence-preserved regression test.
- `src/router/classifier.ts` — `RouteSchema` enum widened to ternary; `classifyIntent` return type includes `'reply'`; `ROUTER_SYSTEM_PROMPT` Reply paragraph added; `modelFor('router')` preserved.
- `src/router/classifier.test.ts` — Inverted the 2 `it.fails` "schema rejects 'reply'" RED guards to real "schema accepts 'reply'" passing assertions.

## Decisions Made
- **Precedence ordering (A6 / Pitfall C):** Reply structural signals scanned first because a pasted inbound mentioning `RM`/`financing` is a Reply-draft request, not a Finder query. The override chip + LLM classifier remain the ambiguity safety net.
- **Conservative inbound-block heuristic:** Requires BOTH a paste shape (2+ newlines OR a quote marker) AND a reply-trigger word, so multi-line Finder criteria pastes (no reply trigger) fall through to the Finder scan unchanged.
- **No model-ID literal:** Classifier model stays `modelFor('router')` (Remote Config). The only `claude-haiku-4-5` reference is a pre-existing doc-comment describing the fallback.
- **Backward-compatible union widening:** Only `heuristicPillar`'s return union changed; the sync `route()` decision logic and `routeAsync()` were untouched, so existing Coach/Finder sync callers (coach.test.ts, stall-detect job) are unaffected.

## Deviations from Plan

None - plan executed exactly as written. The two tasks, their files, behaviors, and verification commands matched the plan; both `<automated>` verifies and the plan-level `<verification>` block passed without any auto-fixes.

## Issues Encountered
None. The Wave-0 RED guards were already in place and correctly targeted the unmet contracts; the implementation flipped them GREEN on the first run.

## TDD Gate Compliance
Both tasks are `tdd="true"` and operate as Wave-0 GREEN-turn tasks: the RED tests were authored in Plan 04-01 (committed `cb8ba1e`/`c2cd157`/`e34d2a9` per CLAIM) as `it.fails` guards. This plan supplied the implementation and flipped the guards to real assertions atomically per task. Baseline confirmed RED-equivalent before edits (38 pass + 5 expected-fail), GREEN after (44 pass, 0 expected-fail in router files).

## Verification

- **Task 1:** `npx vitest run src/router/heuristic.test.ts` → 28 passed (0 fail); `npm run typecheck` → exit 0.
- **Task 2:** `npx vitest run src/router/classifier.test.ts` → 16 passed (0 fail); `npm run typecheck` → exit 0.
- **Plan-level:** `npx vitest run src/router/heuristic.test.ts src/router/classifier.test.ts` → 44 passed (0 fail); `npm run test` → **31 passed / 1 skipped files; 470 passed | 25 expected-fail | 107 skipped | 0 failed (EXIT 0)**; `npm run typecheck` → exit 0.
- **No hard-coded model ID:** `grep -nE "claude-(haiku|sonnet|opus)-[0-9]" src/router/classifier.ts` → only a doc-comment fallback note; `modelFor('router')` preserved at line 87.
- **No Phase-3 regression:** coach tests 28/28 pass; full suite green covers `route.test.ts` + jobs; sync `route()` contract unchanged.

## Regression Report (per global CLAUDE.md)
- **Regression surface:** sync `route()` callers (coach.test.ts, stall-detect job), `routeAsync` (chat-route dispatch + classifier consumers), the broad `Pillar`-typed return contract.
- **What was tested:** full offline suite (470 pass / 0 fail), both router test files (44 pass), coach agent tests (28/28).
- **What passed:** all pre-existing tests stay green; new Reply assertions + the Finder-precedence regression test pass.
- **Ruled out:** (1) The heuristic return union widened from `'coach'|'finder'` to `'coach'|'finder'|'reply'` — `RouteDecision.pillar` was already `Pillar` (includes `'reply'`), so `route()`/`routeAsync()` type unchanged; tsc clean confirms no caller breakage. (2) Reply patterns are conservative structural signals; the new "pure Finder query → finder" test confirms Finder traffic is not stolen. (3) `routeAsync`'s decision tree and `ROUTER_CONFIDENCE_THRESHOLD` logic untouched; classifier widening is enum-only + prompt-only, behind the existing ambiguous-only call path. No PII logging, no model-ID hard-coding introduced.

## Next Phase Readiness
- The router now reaches all three pillars in both the sync heuristic and the LLM classifier — this unblocks Plan 04-06's 3-pillar chat-route dispatch and Plan 04-08's override-chip widening to `'reply'`.
- Note for 04-06: the override allow-list security control (`route.ts:206-210`) is widened to accept `'reply'` THERE, not here, per the plan's `<interfaces>` note.
- 25 Wave-0 `it.fails` RED guards remain across other Phase-4 plans (agents/reply, diff, replyEdits rules, route dispatch, gold sets, e2e) — expected, to be flipped by their owning plans.

## Self-Check: PASSED

- FOUND: `.planning/phases/04-reply-assistant/04-04-SUMMARY.md`
- FOUND commit: `bebd52a` (Task 1 — heuristic Reply patterns + precedence)
- FOUND commit: `e8868f2` (Task 2 — classifier ternary RouteSchema)

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
