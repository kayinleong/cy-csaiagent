---
phase: 06-console-ia-v2
plan: 03
subsystem: auth
tags: [firestore-rules, rbac, read-only-role, pdpa, least-privilege, rules-unit-testing]

# Dependency graph
requires:
  - phase: 06-01
    provides: Wave-0 read-only rules matrix (RED), readOnlyCtx() + 4th synthetic read-only user
  - phase: 06-02
    provides: 'read-only' role added to Role union + VALID_ROLES + AssignableRole; requireRole helper
provides:
  - isAnalyticsReader() Firestore-rules helper (admin OR read-only && sameTenant) applied to evals/usageEvents/usageRollups read rules
  - isReadOnlyRole() guard excluding read-only from the broad isSelf/signed-in grants on users + leadContext (defense-in-depth PII deny)
  - read-only Firestore-rules matrix GREEN on the emulator (analytics allow, KB read inherited, every PII/owner read+write denied)
  - seed() test-harness fix that unblocks ALL 19 collection rules suites under @firebase/rules-unit-testing v5
affects: [06-04, 06-05, 06-06, 06-07, 06-08, read-only-gates, home-surface, analytics-surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern E: a single analytics-reader rules helper applied to analytics-aggregate collections only (never PII)"
    - "isReadOnlyRole() exclusion guard on broad signed-in/isSelf grants for a least-privilege role"
    - "seed via env.withSecurityRulesDisabled(callback) — all writes inside the callback (rules-unit-testing v5)"

key-files:
  created: []
  modified:
    - firestore.rules
    - src/firebase/__tests__/rules.test.ts
    - .gitignore

key-decisions:
  - "isAnalyticsReader() applied to read rules of evals/usageEvents/usageRollups ONLY; all writes stay `if false` (Pitfall 2 honoured — no PII rule widened)"
  - "Added isReadOnlyRole() guard on users (isSelf read+write) and leadContext (signed-in read+write) — the pre-existing broad grants admitted the new read-only role, violating the LOCKED PII-deny matrix (Rule 2)"
  - "Fixed seed() to write inside withSecurityRulesDisabled() — rules-unit-testing v5 invalidates a returned context (Rule 3 blocker)"

patterns-established:
  - "Pattern E (analytics-reader helper) — admin + read-only on analytics aggregates only"
  - "Least-privilege exclusion guard for a read-only role on broad PII grants"

requirements-completed: [RO-03]

# Metrics
duration: ~25min
completed: 2026-06-10
---

# Phase 6 Plan 03: Read-only Analytics-Reader Firestore Rules Summary

**isAnalyticsReader() admits the read-only stakeholder on the 3 analytics-aggregate collections only (evals/usageEvents/usageRollups), with an isReadOnlyRole() guard closing two pre-existing broad PII grants (users, leadContext) — the read-only rules matrix is GREEN (151/151) on the Firestore emulator with zero 3-role regression.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-10T16:05Z
- **Completed:** 2026-06-10T16:22Z
- **Tasks:** 1 (TDD: RED authored in Wave-0 `ac8ec60`; GREEN this plan)
- **Files modified:** 3 (`firestore.rules`, `src/firebase/__tests__/rules.test.ts`, `.gitignore`)

## Accomplishments
- Added `isAnalyticsReader()` (`(hasRole('admin') || hasRole('read-only')) && sameTenant()`) and applied it to the **read** rules of `evals`, `usageEvents`, `usageRollups` only — exactly 4 references (1 def + 3 applications). All writes remain `if false`.
- Closed two pre-existing PII leaks the LOCKED matrix asserts against: `users` (read-only could read/write its own row via `isSelf`) and `leadContext` (read-only could read/write via the broad `coachSlot != null && isSignedIn()` / `isSignedIn() && incomingTenant()` grants). Added `isReadOnlyRole()` exclusion guards — no change to new-agent / senior-coach / admin paths.
- Fixed the `seed()` test helper so the rules suite can actually execute under `@firebase/rules-unit-testing@5.0.1` (the prior helper returned an invalidated context, throwing in every seeded `beforeAll`).
- Verified **151/151** rules tests GREEN on the live Firestore emulator (analytics allow + KB read inherited + every PII/owner read+write denied for read-only + 3-role regression intact). `tsc --noEmit`: 0 errors.

## Task Commits

Each change was committed atomically:

1. **Task 1 (RED gate — Wave 0):** `ac8ec60` (test) — read-only rules matrix authored RED (pre-existing, prior plan)
2. **Task 1 (blocker fix):** `7ddf692` (fix) — seed inside withSecurityRulesDisabled callback (unblocks the rules suite on the emulator)
3. **Task 1 (GREEN gate):** `d868b44` (feat) — isAnalyticsReader() + isReadOnlyRole() guards in firestore.rules
4. **Hygiene:** `6f4f262` (chore) — gitignore firebase/firestore emulator debug logs

_TDD note: the RED `test()` commit (`ac8ec60`) predates this plan (Wave 0); this plan supplies the GREEN `feat()` (`d868b44`). RED→GREEN gate sequence satisfied across the wave._

## Files Created/Modified
- `firestore.rules` — added `isAnalyticsReader()` + `isReadOnlyRole()` helpers; applied `isAnalyticsReader()` to evals/usageEvents/usageRollups read rules; guarded `users` (isSelf read+write) and `leadContext` (signed-in read+write) against the read-only role.
- `src/firebase/__tests__/rules.test.ts` — rewrote `seed()` to write inside `env.withSecurityRulesDisabled(callback)`; removed unused `adminContext` import.
- `.gitignore` — ignore `firebase-debug.log` / `firestore-debug.log` / `ui-debug.log` (emulator runtime artifacts).
- `.planning/phases/06-console-ia-v2/deferred-items.md` — appended the 06-03 entry (pre-existing RED scaffolds unchanged; seed-harness fix noted).

## Emulator Test Status

**The rules tests RAN under the Firestore emulator (NOT emulator-gated for this plan).** `firebase` CLI (15.13.0) and `java` (OpenJDK 26) are both available on this machine. The standard `firebase emulators:exec --only firestore "npm run test:rules"` path failed due to an unrelated bundled-Node/ESM quirk in `emulators:exec` (npm `stdin` error; pkg-bundled Node can't `require()` vitest's ESM). Worked around by starting the emulator (`firebase emulators:start --only firestore`) and running `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run src/firebase/__tests__/rules` — the same `RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)` signal the suite gates on.

- **Before (RED baseline):** every seeded suite threw in `beforeAll` (invalid context) — harness blocker.
- **After harness fix, before guard fix:** 147 passed, 4 read-only DENY failures (leadContext read+write, users read+write own-row) — pre-existing permissive PII grants exposed.
- **After guard fix:** **151 passed / 151** — full read-only matrix GREEN, all 3-role tests still GREEN.

**Live-gated (per phase convention, NOT done here):** `firebase deploy --only firestore:rules` to activate in production. The repo edit + emulator rules-tests are the in-phase work; the production deploy remains a Derek-gated step.

## Decisions Made
- **Apply `isAnalyticsReader()` to analytics read rules only.** evals/usageEvents/usageRollups reads → `isAnalyticsReader()`; writes untouched (`if false`). KB collections already allow signed-in-tenant read, so read-only inherits — no new KB branch added (Pitfall 2: no PII rule widened).
- **Close the two broad PII grants for read-only (Rule 2).** The plan said "keep existing predicate," but those predicates (`isSelf` on `users`, `coachSlot != null && isSignedIn()` / `isSignedIn() && incomingTenant()` on `leadContext`) ADMITTED the new read-only role, contradicting the LOCKED 06-VALIDATION matrix (read-only DENY read+write on both, incl. its own users row). Honoured the plan's stated INTENT (read-only denied) over its literal wording, with a surgical `isReadOnlyRole()` exclusion that leaves the other three roles unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed seed() returning an invalidated RulesTestContext**
- **Found during:** Task 1 (RED-baseline emulator run)
- **Issue:** `seed()` called `adminContext()` (which returns the context AFTER its `withSecurityRulesDisabled` callback resolves). Under `@firebase/rules-unit-testing@5.0.1` that context is invalid, so `.firestore()` threw "This RulesTestContext is no longer valid" in EVERY seeded `beforeAll` — the rules suite could not execute at all (not just read-only). This blocked the plan's core verification.
- **Fix:** Rewrote `seed()` to perform the write inside `env.withSecurityRulesDisabled(async (ctx) => { ... })` via `getTestEnv()`; removed the now-unused `adminContext` import.
- **Files modified:** `src/firebase/__tests__/rules.test.ts`
- **Verification:** All 19 collection suites then ran (147 passed before the guard fix); `tsc` 0 errors.
- **Committed in:** `7ddf692`

**2. [Rule 2 - Missing Critical / PDPA] Closed pre-existing read-only PII read+write on users and leadContext**
- **Found during:** Task 1 (post-harness-fix emulator run — 4 DENY failures)
- **Issue:** The pre-existing `users` rule (`isSelf(uid)`) admitted the read-only stakeholder to read AND write its own users row (incl. a role-escalation write); the pre-existing `leadContext` rule admitted any signed-in user (incl. read-only) to read+write cross-pillar lead PII. Both contradict the LOCKED matrix (read-only DENY read+write). NOT caused by the `isAnalyticsReader()` change (which never touches these collections) — surfaced only once the harness fix let the matrix tests run. This is an information-disclosure / least-privilege defect (Pitfall 2's inverse).
- **Fix:** Added an `isReadOnlyRole()` helper and `&& !isReadOnlyRole()` guards on the `isSelf` grant in `users` (read + write) and the broad signed-in grant in `leadContext` (read + write). The new-agent / senior-coach / admin paths are unchanged (their grants don't depend on the read-only role).
- **Files modified:** `firestore.rules`
- **Verification:** read-only DENY tests for users + leadContext now pass; all existing 3-role users/leadContext tests still pass (151/151 on emulator).
- **Committed in:** `d868b44` (same commit as the `isAnalyticsReader()` feature)

**3. [Rule 3 - Hygiene] Gitignored emulator debug logs**
- **Found during:** Post-commit untracked-file check
- **Issue:** The emulator run emits `firebase-debug.log` / `firestore-debug.log` at the repo root (runtime artifacts) — not gitignored.
- **Fix:** Added them to `.gitignore`.
- **Files modified:** `.gitignore`
- **Committed in:** `6f4f262`

---

**Total deviations:** 3 auto-fixed (1 blocking harness fix, 1 missing-critical PII deny, 1 hygiene).
**Impact on plan:** All three were necessary for correctness/security/verification. Deviation #2 widens the plan's edit beyond the 3 analytics collections, but ONLY to NARROW (deny) the new read-only role on two PII collections — it honours the LOCKED matrix and Pitfall 2 (no PII rule widened to ADMIT read-only) and changes no other role's behaviour. No scope creep into other plans' surfaces.

## Out-of-Scope (logged, not fixed)
17 offline (`npm run test`) failures remain in three Wave-0 RED scaffold files — `app-sidebar-nav.test.ts` (IA-01), `per-coach-pivot.test.ts` (AP-01), `integrations-shell.test.ts` (SC-01). **Verified unchanged by 06-03** (none are in this plan's diff; same failures documented during 06-02). They turn GREEN in their owning later plans (06-04..06-08). Logged in `deferred-items.md`.

## Issues Encountered
- `firebase emulators:exec --only firestore "npm run test:rules"` fails on this machine (bundled-Node `stdin` / ESM `require()` of vitest). Resolved by running the emulator detached and pointing vitest at `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` — the canonical signal the suite gates on. Flagged for the orchestrator/CI: prefer `emulators:start` + `FIRESTORE_EMULATOR_HOST` over `emulators:exec` for this repo's vitest rules suite.

## User Setup Required
None for this plan. Production activation is live-gated: `firebase deploy --only firestore:rules` (Derek-gated, per phase convention) — not performed here.

## Next Phase Readiness
- Database-tier read-only enforcement (the independent 2nd gate) is in place and emulator-proven. The route-group layout gate (the 1st gate) is widened in Wave 3 (06-04+).
- The seed-harness fix means the full rules suite now runs cleanly on the emulator for all subsequent rules work in this phase.

## Self-Check: PASSED

- `firestore.rules` exists and contains `function isAnalyticsReader` — FOUND
- `grep -c "isAnalyticsReader()" firestore.rules` = 4 (1 def + 3 applications) — VERIFIED
- read-only literal token appears ONLY inside helper bodies (isAnalyticsReader, isReadOnlyRole) — VERIFIED
- No PII/owner match block references `isAnalyticsReader` — VERIFIED
- Commits exist: `7ddf692` (fix), `d868b44` (feat), `6f4f262` (chore) — FOUND in `git log`
- Rules matrix: 151/151 GREEN on the Firestore emulator — VERIFIED
- `tsc --noEmit`: 0 errors — VERIFIED

---
*Phase: 06-console-ia-v2*
*Completed: 2026-06-10*
