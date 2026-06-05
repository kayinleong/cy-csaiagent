---
phase: 04-reply-assistant
plan: 01
subsystem: testing
tags: [vitest, playwright, promptfoo, pdpa, firestore-rules, reply-assistant, red-tests, nyquist]

# Dependency graph
requires:
  - phase: 03-finder-routing
    provides: "Finder agent shape (finder.test.ts), router heuristic/classifier, rag/kb pipeline, route dispatch, escalation knowledgeGaps feed — the analogs Reply RED tests mirror"
provides:
  - "Wave-0 failing-test stubs (RED / skip-guarded) for ALL Phase-4 requirements — the Nyquist gate: every downstream task now has an automated verify"
  - "Security-critical PDPA coverage suite (IC/email/RM-financial token contracts) that fails RED today, proving the false-positive gate is real"
  - "captureReplyEdit thumbsDown:true RED producer test — guarantees the ADMIN-06 thumbs-down-rate KPI has a producer"
  - "replyEdits deny-by-default + downline (seniorCoachId) read-scoping rules tests (emulator-gated)"
  - "Three EN reply gold sets (cold-prospect/objection/financing) registered in promptfooconfig.yaml"
  - "Copy-only / no-auto-send / lead-selector / thumbs-down e2e scaffold (skip-guarded)"
affects: [04-02-pdpa-coverage, 04-03-kbchunks-pillar, 04-04-router-3pillar, 04-05-reply-agent, 04-06-route-dispatch, 04-07-replyedits-diff-action, 04-08-reply-ui, 04-10-reply-analytics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "it.fails() RED markers: expected-fail tests keep the offline suite at exit 0 while proving a contract is unmet; they flip to a real failure when the implementation lands (the RED→GREEN signal)"
    - "@ts-expect-error on future-module dynamic imports: keeps tsc green AND self-documents the wave the module arrives in (the directive errors once the module exists)"
    - "Emulator-gated rules tests (rulesSuite = describe.skip without FIRESTORE_EMULATOR_HOST): replyEdits cases skip offline, run RED against the emulator"

key-files:
  created:
    - "src/agents/reply/reply.test.ts"
    - "src/reply/diff.test.ts"
    - "src/reply/reply-edit-actions.test.ts"
    - "evals/gold/reply-cold-prospect.yaml"
    - "evals/gold/reply-objection.yaml"
    - "evals/gold/reply-financing.yaml"
    - "tests/e2e/reply-draft.spec.ts"
  modified:
    - "src/audit/pdpa.test.ts"
    - "src/router/classifier.test.ts"
    - "src/router/heuristic.test.ts"
    - "src/rag/rag.test.ts"
    - "src/kb/kb.test.ts"
    - "src/firebase/__tests__/rules.test.ts"
    - "app/api/chat/route.test.ts"
    - "evals/promptfooconfig.yaml"

key-decisions:
  - "Used Vitest it.fails() (not plain failing it()) for offline RED assertions so npm run test stays exit 0 — reconciles the plan's 'RED' intent with the success-criterion 'offline suite must exit 0'"
  - "Future-module imports guarded with @ts-expect-error + dynamic import so tsc stays clean and the directive itself becomes the RED→GREEN flip signal"
  - "replyEdits rules tests authored under the existing emulator-gated rulesSuite (skip offline) — they prove deny-by-default + downline scoping against the emulator without breaking CI"

patterns-established:
  - "RED-via-it.fails: a Wave-0 failing test is an expected-fail that keeps CI green and turns red exactly when the implementer satisfies it"
  - "Synthetic-only PII in committed gold/test fixtures, with explicit PII-gate assertions (no +60 / IC literals)"

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-06-05
---

# Phase 4 Plan 01: Wave-0 Failing-Test Stubs (Nyquist Gate) Summary

**RED / skip-guarded test stubs for every Phase-4 requirement — PDPA IC/email/RM-financial coverage, reply agent + diff + captureReplyEdit(thumbsDown), 3-pillar routing, replyEdits rules, pillar retrieval, route dispatch, three reply gold sets, and a copy-only e2e — all failing-now/passing-later while the offline suite stays exit 0.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-05 (Wave 0 execution)
- **Completed:** 2026-06-05T10:35:50Z
- **Tasks:** 3
- **Files modified/created:** 15 (7 created, 8 modified)

## Accomplishments
- Every Phase-4 requirement (REPLY-01..11, ADMIN-05/06, QUAL-02, PDPA, security) now maps to at least one failing (or skip-guarded live/e2e) test — the Nyquist gate is satisfied.
- The security-critical PDPA coverage suite fails RED today (IC `<IC_HASH:>`, email `<EMAIL_HASH:>`, RM-financial `<FIN_HASH:>` token contracts as `it.fails`), proving the false-positive gate is real (threat T-04-02); name + MY/intl phone baselines stay green as regression guards.
- The ADMIN-06 producer is guaranteed: `captureReplyEdit({…, thumbsDown:true})` has a RED test asserting a `thumbsDown:true` write (threat T-04-03) — Plan 10's `count(thumbsDown==true)/count(all)` KPI is now structurally deliverable.
- The classifier no longer asserts the schema rejects 'reply'; it asserts the opposite (`accepts "reply"`), RED until Plan 04-04 widens the enum.
- The full offline `npm run test` still EXITS 0 (457 passed | 37 expected-fail | 107 skipped | 0 failed); `tsc --noEmit` clean; eslint 0 errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: PDPA coverage + router/classifier RED tests** — `cb8ba1e` (test)
2. **Task 2: reply agent, diff, captureReplyEdit, rag/kb pillar, replyEdits rules, route dispatch RED tests** — `c2cd157` (test)
3. **Task 3: reply gold sets + promptfoo registration + copy-only e2e scaffold** — `e34d2a9` (test)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP) — committed separately.

## Files Created/Modified
- `src/audit/pdpa.test.ts` — +PDPA coverage block: IC/email/RM-financial token contracts (`it.fails`), name/phone baselines stay green.
- `src/router/classifier.test.ts` — removed the "does not include reply pillar" assertion; added `accepts "reply"` + schema-validates-reply (`it.fails`).
- `src/router/heuristic.test.ts` — +REPLY_PATTERNS RED tests incl. the Pitfall-C precedence case (RM + draft-a-reply → reply, not finder).
- `src/agents/reply/reply.test.ts` (new) — reply agent run() hit/no_sop_match/clarifying, per-classification, XOR schema, read-only tools, parallel-lead isolation.
- `src/reply/diff.test.ts` (new) — `editRatio` (REPLY-09) contract.
- `src/reply/reply-edit-actions.test.ts` (new) — captureReplyEdit incl. the `thumbsDown:true` ADMIN-06 producer + editRatio:0 denominator + omitted-thumbsDown-absent.
- `src/rag/rag.test.ts` — +pillar-filtered retrieve + in-memory category filter (REPLY-01).
- `src/kb/kb.test.ts` — +processBatch writes `kbChunks.pillar` denormalized from the job doc.
- `src/firebase/__tests__/rules.test.ts` — +`replyEdits` deny-by-default + downline (seniorCoachId) read-scoping (emulator-gated).
- `app/api/chat/route.test.ts` — +reply dispatch + required-leadId-400 + non-empty pseudonymize names[] + replySlot onFinish + parallel-lead + no_sop_match→recordKnowledgeGap(pillar:reply).
- `evals/gold/reply-{cold-prospect,objection,financing}.yaml` (new) — live-gated EN reply gold sets, synthetic-only PII.
- `evals/promptfooconfig.yaml` — registered the three `reply-` gold sets.
- `tests/e2e/reply-draft.spec.ts` (new) — skip-guarded copy-only / no-send / lead-selector / thumbs-down e2e scaffold.

## Decisions Made
- **RED via `it.fails()`:** The plan asks for RED tests while the success criterion requires `npm run test` to exit 0. Vitest's `it.fails()` reconciles both — an expected-fail captures a genuinely-failing assertion (proving the contract is unmet today) yet keeps the suite green; when the implementer satisfies it, `it.fails` turns red, signalling the RED→GREEN flip and a `.fails` removal.
- **`@ts-expect-error` on future-module dynamic imports:** Keeps `tsc --noEmit` clean for modules that land in later waves (`@/src/agents/reply`, `@/src/reply/diff`, `@/app/[lang]/chat/reply-edit-actions`); the directive itself errors once the module exists — a second self-documenting RED→GREEN signal.
- **replyEdits rules under the emulator-gated `rulesSuite`:** Mirrors the existing knowledgeGaps/escalations pattern; the 10 new cases skip offline (preserving exit 0) and run RED against the emulator until Plan 04-07 adds the `replyEdits` rule block.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Typed the new route-test mock `vi.fn` signatures to fix `tsc` tuple errors**
- **Found during:** Task 2 (route + captureReplyEdit RED tests)
- **Issue:** `mock.calls[0][0]` / `.map((c) => c[0])` on untyped `vi.fn()` mocks produced `TS2493` (tuple of length 0) because the mocks had no arg signature; `mockAdd` likewise. A broken typecheck would block the commit gate.
- **Fix:** Gave `mockAdd` a typed `(_doc: Record<string, unknown>)` arg and cast `.mock.calls` to `unknown[][]` at the three access points.
- **Files modified:** `src/reply/reply-edit-actions.test.ts`, `app/api/chat/route.test.ts`
- **Verification:** `tsc --noEmit` exits 0; the affected `it.fails` tests still register as RED.
- **Committed in:** `c2cd157` (Task 2 commit)

**2. [Rule 3 - Blocking] Tightened the classifier "can return reply" RED test to assert the real gap (schema), not a mock passthrough**
- **Found during:** Task 1 (classifier RED test)
- **Issue:** The first draft asserted `classifyIntent` *returns* `pillar:'reply'` — but the function passes the mocked `generateObject` object straight through without re-parsing, so the assertion PASSED even though the binary schema is the real gap. That made an `it.fails` unexpectedly pass (vitest turned it red).
- **Fix:** Rewrote the test to capture the schema handed to `generateObject` and assert it *validates* a reply classification — which genuinely fails RED today (binary enum rejects 'reply').
- **Files modified:** `src/router/classifier.test.ts`
- **Verification:** The file now shows the assertion as expected-fail; offline suite green.
- **Committed in:** `cb8ba1e` (Task 1 commit)

**3. [Rule 3 - Blocking] e2e spec authored at the plan-specified `tests/e2e/` path despite playwright `testDir: ./e2e`**
- **Found during:** Task 3 (e2e scaffold)
- **Issue:** The plan frontmatter + verify command + acceptance criteria all reference `tests/e2e/reply-draft.spec.ts`, but `playwright.config.ts` `testDir` is `./e2e` (existing specs live there). A file at `tests/e2e/` is NOT on the Playwright test path.
- **Fix:** Wrote the spec at the plan-specified `tests/e2e/reply-draft.spec.ts` (satisfying the verify command + acceptance) and documented in the spec header a DEVIATION NOTE that **Plan 04-08 must reconcile** the path (relocate to `e2e/` or extend `testDir`). The spec is skip-guarded on `E2E_BASE_URL`, so it is inert until then.
- **Files modified:** `tests/e2e/reply-draft.spec.ts`
- **Verification:** File exists; `grep reply-thumbs-down` passes; `tsc` + eslint clean; vitest does not pick up `.spec.ts` (include is `*.test.ts`).
- **Committed in:** `e34d2a9` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking).
**Impact on plan:** All three were mechanical correctness/path fixes needed to keep the typecheck green and honor the literal verify commands. No scope creep; no requirement coverage changed.

## Issues Encountered
- The plan's interfaces block said `tests/e2e/` was "currently EMPTY"; it did not exist at all — created the directory. Documented the playwright `testDir` mismatch (see Deviation 3) for Plan 04-08 to resolve.

## User Setup Required
None — no external service configuration required (all stubs are offline or skip-guarded; live evals/e2e are existing human-gated runs).

## Threat Flags
None — no new security surface introduced (these are tests only). The PDPA coverage suite and the captureReplyEdit thumbsDown producer are the mitigations for the plan's registered threats T-04-01/02/03 and are present and RED as designed.

## Next Phase Readiness
- **Wave 1 unblocked:** every downstream Phase-4 task has an automated verify. Plans 04-02 (PDPA coverage), 04-03 (kbChunks.pillar), 04-04 (router 3-pillar) each have RED tests waiting to turn green.
- **RED→GREEN signal for implementers:** when a wave's implementation lands, the corresponding `it.fails`/`@ts-expect-error` flips to an error — that is the cue to remove the guard and (where applicable) wire the real mocks (mirror finder.test.ts hoisted mocks for `reply.test.ts`).
- **Live/emulator-gated (carried, not blocking):** replyEdits rules run under the Firestore emulator (`npm run test:rules`); reply gold sets + the copy-only e2e run against a live deployed seeded stack — both are existing human-gated pilot steps.

## Self-Check: PASSED

- All 7 created files verified present on disk.
- All 3 task commits verified in git log (`cb8ba1e`, `c2cd157`, `e34d2a9`).
- Full offline `npm run test` exits 0 (457 passed | 37 expected-fail | 107 skipped | 0 failed); `tsc --noEmit` exits 0; eslint 0 errors.

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
