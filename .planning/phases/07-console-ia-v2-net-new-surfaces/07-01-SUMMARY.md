---
phase: 07-console-ia-v2-net-new-surfaces
plan: 01
subsystem: testing-scaffold
tags: [wave-0, red-scaffold, firestore-rules, ci-guards, server-actions, nav, tdd]
dependency_graph:
  requires: []
  provides:
    - "cohorts + conversationFlags rules matrices (RED until 07-02)"
    - "AgentProfileDoc.cohortId? + firstCloseAt? optional fields (type-level, GREEN)"
    - "coach-assignment / audit-log / model-config / record-close Server-Action contracts (RED)"
    - "getAgentProfile + daysToFirstClose query contracts (RED)"
    - "8-item nav placement + read-only-blindness contract (RED)"
    - "scripts/ci-guards.test.ts — 6 invariant guards (Guard 2/6 GREEN, 1/3/4/5 RED-by-design)"
  affects:
    - "07-02 (rules + collections turn the rules matrices GREEN)"
    - "07-03 (coach-assignment, record-close, getAgentProfile, agent-profile route)"
    - "07-05 (audit-log viewer, model-config publish)"
    - "07-06 (8 nav items, i18n)"
tech_stack:
  added: []
  patterns:
    - "Wave-0 RED-by-construction test scaffold (mirrors Phase-5/6 convention, D-27)"
    - "emulator-gated rulesSuite (describe.skip offline) + CI anti-vacuous guard"
    - "comment-line-filtered grep guards via fast-glob"
key_files:
  created:
    - "app/[lang]/(admin)/coach-assignment/actions.test.ts"
    - "app/[lang]/(admin)/audit-log/actions.test.ts"
    - "app/[lang]/(admin)/model-config/actions.test.ts"
    - "app/[lang]/(coach)/agents/actions.test.ts"
    - "src/dashboard/queries.test.ts"
    - "scripts/ci-guards.test.ts"
  modified:
    - "src/firebase/collections.ts"
    - "src/firebase/__tests__/rules.test.ts"
    - "app/[lang]/_components/app-sidebar-nav.test.ts"
    - "vitest.config.ts"
decisions:
  - "Guard 2 (src/→app/) excludes *.test.ts: colocated tests legitimately import the app/ module they verify; the portable core production code is genuinely app/-clean (Rule-1 fix on the guard predicate)."
  - "src/dashboard/queries.test.ts created NEW (files_modified named it; only dashboard.test.ts existed) — keeps Phase-7 contracts isolated from the Phase-2 dashboard.test.ts."
  - "Guard 6 implemented via approach (b): CI=true ⇒ assert FIRESTORE_EMULATOR_HOST set (no isEmulatorAvailable() export exists in rules-helpers)."
  - "scripts/**/*.test.ts added to vitest include — the guard suite was otherwise never collected."
metrics:
  duration_min: 18
  completed_date: 2026-06-11
  tasks: 3
  files: 10
  commits: 3
---

# Phase 7 Plan 01: Wave-0 RED Scaffold Summary

**One-liner:** Established the Nyquist verification floor for Phase 7 — failing (RED) tests for both new collections' rules matrices (read-only DENY + cross-coach DENY + client-write DENY), the four sensitive Server-Action contracts (coach-assignment dual-write, audit-log no-self-audit, model-config ETag/no-force, record-close idempotency), the agent-profile audit-before-read + days-to-first-close math, the 8-item nav read-only-blindness, plus a 6-guard CI suite that fails on a hard-coded model ID, a src/→app/ import, a read-only rule grant, a `{force:true}` publish, a journey-edit symbol on the agent-profile route, and (under CI) a vacuously-skipped rules emulator.

## What Was Built

### Task 1 — New-collection rules matrices + field-type stubs (commit `6b83cd9`)
- Extended `src/firebase/__tests__/rules.test.ts`:
  - Added `cohorts` + `conversationFlags` to the deny-by-default unauthenticated loop.
  - New `conversationFlags collection` suite: senior-coach reads own-downline (assertSucceeds), CANNOT read a stranger flag (cross-coach DENY, T-07-02), admin reads any, new-agent denied, and ALL client create/update/delete DENIED (Admin-SDK-only, D-09).
  - New `cohorts collection` suite: admin read+write SUCCEEDS, senior-coach reads metadata, non-admin (new-agent + senior-coach) writes DENIED (D-03).
  - RO-01 matrix extended: read-only DENIED read+write on both `cohorts` and `conversationFlags` (D-24 / T-07-01).
  - Offline-safe type-level test block: a doc literal omitting both new fields still typechecks (backward-compat) and one with both typechecks (Phase-7 shape).
- `src/firebase/collections.ts`: added `AgentProfileDoc.cohortId?` (COH-02/D-02) and `firstCloseAt?: Date | FieldValue` (CLOSE-01/D-20), mirroring the `EscalationDoc.resolvedAt?` optional-field precedent. No converters/refs (those are 07-02).

### Task 2 — Server-Action + query + nav contracts (commit `13757f1`)
- `coach-assignment/actions.test.ts` (ASSIGN-01): admin-gate; atomic `adminDb.batch()` dual-write of `agentProfiles.seniorCoachId` + `users.uplineCoachId`; `coach-assign` audit; non-admin/read-only → Forbidden (D-06/D-07).
- `audit-log/actions.test.ts` (AUDIT-01): admin-gate; `orderBy('ts','desc').limit(50)`; asserts `auditDrilldown` is NEVER called (no self-audit, D-14); metadata-only rows, no `hashes` (D-12).
- `model-config/actions.test.ts` (MODEL-02): uses `getTemplate()` not `getServerTemplate()`; mutates ONLY the one `model.{pillar}.default` key; `publishTemplate` WITHOUT `{force:true}`; reject → `{ok:false,error:'conflict'}`; invalid pillar rejected; admin-gate; `model_config_publish` audit (D-15/D-16/D-17).
- `(coach)/agents/actions.test.ts` (CLOSE-01): `recordFirstClose` sets `firstCloseAt` when absent, no-ops on a second call (idempotent, D-21); admin + own-downline coach allowed; non-downline coach → Forbidden. Lives under `(coach)` per the routing correction (admin group redirects coaches).
- `src/dashboard/queries.test.ts` (PROF-02 + CLOSE-02): `getAgentProfile` calls `auditDrilldown(coachUid,'agentProfiles')` BEFORE the doc read (ordering asserted) + non-downline coach rejected; `daysToFirstClose` = whole-day delta, `null` when `firstCloseAt` absent.
- `app-sidebar-nav.test.ts` (NAV-01): 8 new keys placed per D-25 sections for admin; senior-coach sees only `flags` + `agentProfiles`; read-only sees NONE of the 8 (D-24).

### Task 3 — CI grep guards + Nyquist anti-vacuous guard (commit `d225d73`)
- `scripts/ci-guards.test.ts` (6 guards, each filtering comment lines):
  1. No hard-coded `claude-*`/`gemini-*` literal in model-config/cohorts surfaces (provider.ts `REMOTE_CONFIG_FALLBACKS` excluded by glob) — RED-by-design until 07-05.
  2. No `src/ → app/` import — **GREEN today** (production core verified app/-clean).
  3. No read-only grant token in the cohorts/conversationFlags rule blocks — RED-by-design until 07-02.
  4. No `publishTemplate(... force:true ...)` — RED-by-design until 07-05.
  5. No journey-edit symbol (`setJourneyStage`/`updateJourney`/`advanceCheckpoint`/`recordCheckpoint`/`journeyStage:` write/…) on the agent-profile route — RED-by-design until 07-03 (PROF-01/D-04).
  6. **Anti-vacuous (T-07-28):** under `CI=true`, FAIL if `FIRESTORE_EMULATOR_HOST` is unset (the rules matrices would `describe.skip` and pass vacuously); no-op offline. Verified failing under `CI=true` without the host and passing with it.
- `vitest.config.ts`: registered `scripts/**/*.test.ts` so the guard suite is collected.

## Verification

- `npx tsc --noEmit` — production code compiles; only the 4 intended Wave-0 `./actions` RED-stub imports are unresolved (the documented Wave-0 convention).
- `npx vitest run` full suite — **614 passed, 186 skipped (emulator-gated rules), 6 RED scaffold files** (the intended failing state). No pre-existing test regressed.
- `npx vitest run scripts/ci-guards.test.ts` — 6/6 GREEN offline; Guard 6 confirmed FAILS under `CI=true` without the emulator and PASSES with it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Guard 2 false-positive on colocated test files**
- **Found during:** Task 3 (first ci-guards run)
- **Issue:** The src/→app/ guard, scanning all `src/**/*.{ts,tsx}`, flagged two pre-existing TEST files (`src/reply/reply-edit-actions.test.ts`, `src/firebase/__tests__/role-helper.test.ts`) that import the app/ module they verify — making Guard 2 RED today, contradicting the acceptance criterion "Guard 2 passes today."
- **Fix:** Excluded `**/*.test.ts`/`**/*.test.tsx` from Guard 2's glob. Verified the production core is genuinely app/-clean (`grep` of non-test `src/` → NONE). The core/shell rule governs portable core code, not colocated tests.
- **Files modified:** `scripts/ci-guards.test.ts`
- **Commit:** `d225d73`

**2. [Rule 3 - Blocking] scripts/ not in vitest include**
- **Found during:** Task 3
- **Issue:** `vitest.config.ts` `include` covered `src/`, `tests/`, `app/` but not `scripts/` — the guard suite would never be collected/run.
- **Fix:** Added `scripts/**/*.test.ts` to the include array.
- **Files modified:** `vitest.config.ts`
- **Commit:** `d225d73`

**3. [Plan clarification] queries.test.ts created new**
- The plan's `files_modified` named `src/dashboard/queries.test.ts` as an extension, but only `src/dashboard/dashboard.test.ts` existed. Created `queries.test.ts` as a new file (the named path), isolating Phase-7 contracts from the Phase-2 dashboard tests. Not a behavioral deviation.

## Known Stubs

This entire plan IS the RED stub scaffold (Wave 0). Every assertion in the 6 new/extended test files is RED-by-construction (imports not-yet-existing symbols or asserts not-yet-deployed rules) and turns GREEN in its implementation plan:
- rules matrices → 07-02
- coach-assignment, record-close, getAgentProfile, agent-profile route → 07-03
- audit-log viewer, model-config publish → 07-05
- 8 nav items → 07-06

This is the intended Wave-0 state per D-27 (mirrors Phase-5/6) and is NOT a defect.

## Threat Coverage Pinned (RED)

| Threat | Pinned by |
|--------|-----------|
| T-07-01 (read-only EoP into Phase-7 collections) | RO-01 matrix DENY read+write on cohorts + conversationFlags |
| T-07-02 (cross-coach flag read) | conversationFlags suite — stranger-flag read DENIED |
| T-07-03 (client forges flag/cohort write) | ALL client create/update/delete DENIED on conversationFlags; non-admin cohort write DENIED |
| T-07-04 (hard-coded model id / {force:true} / src→app) | ci-guards 1/2/4 |
| T-07-28 (vacuous rules-suite skip in CI) | ci-guard 6 (Nyquist) |

## No new packages installed (07-RESEARCH §Package Legitimacy Audit: none) — `fast-glob` is already a transitive dependency.

## Self-Check: PASSED

- All 10 created/modified files verified present on disk.
- All 3 task commits verified in git history (`6b83cd9`, `13757f1`, `d225d73`).
