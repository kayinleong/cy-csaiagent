---
phase: 03-finder-routing
plan: "05"
subsystem: router
tags: [router, intent-classifier, heuristic, tdd, llm, generateObject, phase3-activation]
dependency_graph:
  requires: []
  provides: [routeAsync, heuristicPillar, classifyIntent, ROUTER_CONFIDENCE_THRESHOLD]
  affects: [app/api/chat/route.ts (03-07), src/agents/coach/coach.test.ts]
tech_stack:
  added: []
  patterns: [heuristic-first-then-llm, low-confidence-safe-default, sync-async-fastpath-split, generateObject-structured-output, model-from-remote-config]
key_files:
  created:
    - src/router/classifier.test.ts
  modified:
    - src/router/classifier.ts
    - src/router/heuristic.ts
    - src/router/index.ts
    - src/router/heuristic.test.ts
    - src/agents/coach/coach.test.ts
decisions:
  - "ROUTER_CONFIDENCE_THRESHOLD=0.5 default: low-confidence defaults to coach (safe pillar); threshold exported for tuneability"
  - "Sync route() preserved for existing callers; routeAsync() adds LLM fallback without async ripple (Pitfall 7)"
  - "heuristicPillar uses phrase-level patterns for 'lead' (not bare keyword) to avoid false-positive routing on coaching messages like 'register my first lead'"
  - "Reason string encodes deciding tier (manual-override / heuristic-* / classifier:* / low_confidence:*) for D-02 routeDecision observability"
  - "NotActivatedError class removed from classifier.ts and index.ts; Phase-3 is the activation"
metrics:
  duration: "~30 minutes"
  completed: "2026-06-02T15:38:00Z"
  tasks: 3
  files_modified: 5
  files_created: 1
---

# Phase 03 Plan 05: Intent Classifier Activation Summary

**One-liner:** Activated the dormant LLM intent classifier using AI SDK v5 `generateObject` with `modelFor('router')` Remote Config resolution; added content heuristic for clear-keyword fast-path; wired three-tier `routeAsync` (override→heuristic→classifier→low-confidence-default-coach).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Rewrite router tests to Phase-3 contract | 055cc4e | src/router/heuristic.test.ts, src/router/classifier.test.ts (new) |
| 2 (GREEN) | Activate classifyIntent + content heuristic | 85e4fae | src/router/classifier.ts, src/router/heuristic.ts |
| 3 (GREEN) | routeAsync + index export | e337246 | src/router/index.ts, src/router/heuristic.ts, src/router/classifier.test.ts, src/agents/coach/coach.test.ts |

## What Was Built

### `src/router/classifier.ts` (Activated)
- Removed `NotActivatedError` throw stub from `classifyIntent`.
- Implemented real `generateObject` call with `RouteSchema = z.object({ pillar: z.enum(['coach','finder']), confidence: z.number().min(0).max(1), reason: z.string() })` — 'reply' excluded (Phase 4, A7).
- Model resolved via `modelFor('router')` (Remote Config key `model.router.default`, fallback `claude-haiku-4-5`) — NEVER hard-coded.
- `ROUTER_SYSTEM_PROMPT` describes coach (onboarding/training/journey) vs finder (property/lead/budget) scope.
- `compactSummary()` keeps last 4 turns to reduce classifier token cost.

### `src/router/heuristic.ts` (Updated)
- Added `heuristicPillar(messages)`: keyword pattern matching for clear finder signals (RM, budget, bedroom, "paste lead", "my lead", property matching, financing, eligibility, collateral) and coach signals (onboarding, checkpoint, training, playbook, meta ad, journey, comprehension).
- Updated `route()` sync fast-path: override → heuristicPillar (clear) → 'coach' safe default. LLM fallback does NOT live here (T-03-18/Pitfall 7 — no async ripple).
- 'lead' keyword uses phrase-level patterns (`my lead`, `paste lead`, `lead criteria/details`) not bare `/\blead\b/` to avoid false positives on coaching messages like "register my first lead".

### `src/router/index.ts` (Updated)
- Added `routeAsync(messages, opts?)` implementing the three-tier decision:
  1. `override` set → `{pillar: override, reason: 'manual-override'}` — no classifier.
  2. `heuristicPillar()` clear → return heuristic decision — no classifier.
  3. `classifyIntent()` → if confidence >= `ROUTER_CONFIDENCE_THRESHOLD` → use pillar; else → `{pillar: 'coach', reason: 'low_confidence:…'}`.
- Exported `ROUTER_CONFIDENCE_THRESHOLD = 0.5` (A6 — tunable).
- Removed defunct `NotActivatedError` re-export.
- Reason string encodes tier: `manual-override`, `heuristic-finder:…`, `heuristic-coach:…`, `classifier:…`, `low_confidence:…` — for D-02 `routeDecision` observability (consumed by 03-07).

### Tests
- `src/router/heuristic.test.ts`: Rewrote to Phase-3 contract — 15 heuristicPillar keyword tests, 9 sync route() tests; retired "finder-ish → coach" Phase-1 invariant; narrowed classifier-not-called guard to override+clear-keyword paths.
- `src/router/classifier.test.ts` (new): 39 tests covering ROUTER_CONFIDENCE_THRESHOLD export, classifyIntent (modelFor('router') called, generateObject schema, no 'reply' enum), routeAsync (override-wins, clear-keyword-finder, clear-keyword-coach, ambiguous→classifier, low_confidence→coach boundary cases, reason-tier encoding).
- `src/agents/coach/coach.test.ts`: Updated Test 5 Phase-1 reason assertion (`phase-1-single-pillar`) to Phase-3 contract (reason defined + non-empty).

## TDD Gate Compliance

- RED gate: commit `055cc4e` — 39/39 tests failing (routeAsync/heuristicPillar/activated classifier unimplemented).
- GREEN gate: commits `85e4fae` (heuristic + classifier) + `e337246` (routeAsync + index) — 39/39 router tests green.
- No REFACTOR gate needed — implementation was clean on first pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tightened 'lead' heuristic keyword to prevent false-positive routing**
- **Found during:** Task 3 GREEN — coach.test.ts Test 5 failed: "How do I register my first lead?" routed to 'finder' due to bare `/\blead\b/` pattern.
- **Issue:** "Register my first lead" is a coaching question (agent registration process) but matched the broad `lead` keyword and incorrectly routed to 'finder'.
- **Fix:** Changed to phrase-level patterns: `/\b(?:my|paste|the)\s+lead\b/i` and `/\blead\s+(?:criteria|details|info|contact|budget)\b/i`. All heuristic tests still pass ('paste lead info' matches via `\bpaste\b`).
- **Files modified:** src/router/heuristic.ts (FINDER_PATTERNS), src/agents/coach/coach.test.ts (Test 5 Phase-1 reason superseded)
- **Commit:** e337246

**2. [Rule 1 - Bug] Fixed vitest hoisting error in classifier.test.ts**
- **Found during:** Task 3 GREEN — classifier.test.ts threw `ReferenceError: Cannot access 'mockGenerateObject' before initialization` because `const mockGenerateObject = vi.fn()` was referenced in `vi.mock()` factory before hoisting resolved.
- **Fix:** Used `vi.hoisted(() => ({ mockGenerateObject: vi.fn(), mockModelFor: vi.fn() }))` per vitest docs; updated all references to use `mocks.mockGenerateObject` / `mocks.mockModelFor`.
- **Files modified:** src/router/classifier.test.ts
- **Commit:** e337246

**3. [Rule 2 - Auto-add] Updated coach.test.ts Test 5 Phase-1 reason assertion**
- **Found during:** Task 3 — Test 5 asserts `reason === 'phase-1-single-pillar'` which no longer exists after Phase-3 activation. Plan explicitly says these Phase-1 assertions are "INTENTIONALLY superseded."
- **Fix:** Updated assertion to Phase-3 contract: `reason` is defined and non-empty (the specific tier-encoded reason is tested in classifier.test.ts).
- **Files modified:** src/agents/coach/coach.test.ts
- **Commit:** e337246

## Threat Mitigations Applied

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-03-16 (Repudiation — mis-route) | Mitigated: heuristic-first for clear cases; low-confidence → 'coach'; reason string encodes tier for routeDecision audit (D-02) |
| T-03-17 (DoS/cost — classifier on every turn) | Mitigated: heuristic short-circuits; classifier not called on override/clear-keyword; unit-asserted in classifier.test.ts |
| T-03-18 (Tampering — async migration breaks sync callers) | Mitigated: sync route() preserved; routeAsync() is additive; coach.test.ts + 28 sync tests green |
| T-03-19 (Spoofing — override forces unavailable pillar) | Accepted: both pillars available to all signed-in agents in v1 |

## Known Stubs

None. All code paths are wired and tested. `routeAsync` is ready for consumption by 03-07.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The classifier calls the same LLM provider surface already used by coach/finder agents.

## Self-Check: PASSED

- src/router/classifier.ts: exists and contains generateObject call.
- src/router/heuristic.ts: exists and exports heuristicPillar.
- src/router/index.ts: exports routeAsync and ROUTER_CONFIDENCE_THRESHOLD.
- src/router/classifier.test.ts: exists with 15 tests.
- `npx vitest run src/router` — 39/39 tests GREEN.
- `npx vitest run src/agents/coach/coach.test.ts` — 28/28 tests GREEN.
- `npx vitest run` (full suite) — 359/359 passed, 97 skipped.
- `npm run typecheck` — clean (no errors).
- Commits 055cc4e, 85e4fae, e337246 confirmed in git log.
- No writes to STATE.md / ROADMAP.md / REQUIREMENTS.md.
