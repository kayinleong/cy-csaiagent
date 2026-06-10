---
phase: 06-console-ia-v2
plan: 01
subsystem: test-scaffold
wave: 0
tags: [wave-0-red, read-only-role, rules-matrix, i18n-parity, ia-restructure, tdd-red]
requires: []
provides:
  - "syntheticReadOnly fixture + extended Role union (read-only) in tests/fixtures/synthetic-users.ts"
  - "readOnlyCtx() rules-test context in rules-helpers.ts"
  - "RO-01 collection-by-collection read-only rules matrix (RED) in rules.test.ts"
  - "read-only role-union claim test (RED) in auth.test.ts"
  - "assignRole read-only Forbidden case in roles/actions.test.ts"
  - "requireRole + VALID_ROLES('read-only') gate test (RED) in role-helper.test.ts"
  - "6-section sidebar role-filter test (RED) in app-sidebar-nav.test.ts"
  - "integrations no-send static invariant (RED) in integrations-shell.test.ts"
  - "per-coach pivot scoping test (RED) in per-coach-pivot.test.ts"
  - "real en/ms/zh i18n parity test (GREEN) in i18n-parity.test.ts"
affects: [downstream-waves-1-4, ap-01, sc-01]
tech-stack:
  added: []
  patterns:
    - "logic-only Vitest RED scaffolds (no @testing-library/react — not installed)"
    - "variable-specifier dynamic import to keep typecheck clean while a not-yet-built module stays runtime-RED"
    - "emulator-gated rules suite (describe.skip without FIRESTORE_EMULATOR_HOST)"
key-files:
  created:
    - "src/i18n/__tests__/i18n-parity.test.ts"
    - "src/firebase/__tests__/role-helper.test.ts"
    - "app/[lang]/_components/app-sidebar-nav.test.ts"
    - "app/[lang]/(admin)/integrations/integrations-shell.test.ts"
    - "app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts"
  modified:
    - "tests/fixtures/synthetic-users.ts"
    - "src/firebase/__tests__/rules-helpers.ts"
    - "src/firebase/__tests__/rules.test.ts"
    - "src/firebase/auth.test.ts"
    - "app/[lang]/(admin)/roles/actions.test.ts"
decisions:
  - "i18n parity compares TRANSLATABLE keys only — top-level _-prefixed metadata (_review/_note, D-08 machine-draft markers in ms/zh) is excluded so the invariant is about UI strings, not per-catalog review annotations. With that exclusion parity holds today → the parity test is real and GREEN (6/6)."
  - "Not-yet-built modules (app-sidebar-nav, per-coach-pivot) and not-yet-exported symbols (requireRole, VALID_ROLES) are loaded via a variable-specifier dynamic import / Record<string,unknown> cast so the test files TYPECHECK clean while staying runtime-RED until their wave lands."
  - "No production code modified — Wave 0 is test/fixture-only by mandate (brownfield no-regression rule)."
metrics:
  duration: "~15m"
  completed: "2026-06-10"
  commits: 3
  files-changed: 10
  tasks: 3
---

# Phase 6 Plan 01: Console IA v2 Wave-0 Failing-Test Scaffold (RED) Summary

Created the Wave-0 RED test scaffold for Phase 6 (Console IA v2 — Restructure + Read-only Role): a 4th synthetic read-only user + `readOnlyCtx()`, the full RO-01 collection-by-collection rules matrix, the read-only role-union claim test, an `assignRole` Forbidden case, a centralized `requireRole`/`VALID_ROLES` gate test, a 6-section sidebar role-filter test, an Integrations no-send static invariant, a per-coach pivot scoping test, and a real (non-stub) en/ms/zh i18n parity test. Every Wave-0 gap in 06-VALIDATION.md now has a corresponding RED/pending test (i18n-parity is GREEN today); no production code was touched and no v1 test was weakened.

## Tasks Completed

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | 4th synthetic read-only user + readOnlyCtx fixture | `3d358e3` | tests/fixtures/synthetic-users.ts, src/firebase/__tests__/rules-helpers.ts |
| 2 | Read-only rules matrix + role-union + assignRole Forbidden (RED) | `ac8ec60` | src/firebase/__tests__/rules.test.ts, src/firebase/auth.test.ts, app/[lang]/(admin)/roles/actions.test.ts |
| 3 | Logic-only RED scaffolds (sidebar/requireRole/integrations/pivot) + real i18n parity | `02d3438` | src/i18n/__tests__/i18n-parity.test.ts, src/firebase/__tests__/role-helper.test.ts, app/[lang]/_components/app-sidebar-nav.test.ts, app/[lang]/(admin)/integrations/integrations-shell.test.ts, app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts |

## RED-by-design state (the executable acceptance contract)

Offline `npm run test`: **564 passed · 168 skipped · 21 failed** across the 5 Wave-0 scaffold files. The 21 failures are the intended RED bar:

| File | Failing specs | Turns GREEN in | Why RED today |
|------|---------------|----------------|---------------|
| `auth.test.ts` (Behavior 3c) | 1 | Wave 1 (RO-01) | `'read-only'` not yet in `VALID_ROLES` → `setUserClaims('read-only')` throws |
| `role-helper.test.ts` | 3 | Wave 1 (RO-01) | `requireRole` + exported `VALID_ROLES('read-only')` do not exist yet |
| `app-sidebar-nav.test.ts` | 5 | Wave 4 (IA-01) | pure `app-sidebar-nav` SECTIONS module not extracted yet |
| `integrations-shell.test.ts` | 8 | SC-01 | `(admin)/integrations/page.tsx` does not exist yet (ENOENT) |
| `per-coach-pivot.test.ts` | 4 | AP-01 | `resolvePivotScope` helper does not exist yet |

Emulator-gated rules assertions (the RO-01 matrix in `rules.test.ts`) `describe.skip` offline and execute RED under `firebase emulators:exec --only firestore "npm run test:rules"` until Wave 2/3 add `isAnalyticsReader()` to `firestore.rules`.

`i18n-parity.test.ts` is a REAL implemented test and passes **6/6 today** (en/ms/zh translatable-key parity holds).

## RO-01 rules matrix encoded (Pitfall 2 / T-06-01 honored)

`rules.test.ts` block "read-only role — RO-01 analytics-reader matrix":
- **ALLOW read** (assertSucceeds, RED until rules land): `usageRollups`, `usageEvents`, `evals`, `projects`, `collateral`, `kbDocs`, `kbChunks`, `kbIngestionJobs`.
- **DENY read** (assertFails): `auditLogs`, `conversations`, `conversations/{cid}/messages`, `leads`, `leadContext`, `erasureRequests`, `rateBudgets`, `knowledgeGaps`, `escalations`, `users` (incl. its own row), `agentProfiles`.
- **DENY write** (assertFails): `usageRollups`, `usageEvents`, `evals`, `kbDocs`, `projects`, `collateral`, `leadContext`, `users`.
- **Pitfall 2 / T-06-01 invariant verified:** zero `assertSucceeds` on any PII collection within the read-only block (scoped grep returned 0). The 9 whole-file PII `assertSucceeds` matches are all pre-existing v1 per-role tests (an agent/admin reading their own data), not read-only.

## Deviations from Plan

### 1. [Rule 1 — Benign] `assignRole` read-only Forbidden case is GREEN, not RED
- **Found during:** Task 2.
- **Issue:** The plan anticipated the `assignRole` read-only Forbidden case might be RED ("AssignableRole/gate not present yet"). In fact `app/[lang]/(admin)/roles/actions.ts` already exists (the 05-03 implementation landed) and its admin-only gate returns `{ok:false, error:'Forbidden'}` for ANY non-admin caller — so a `role:'read-only'` caller is already Forbidden.
- **Resolution:** No fix needed. The success criterion ("a test exists asserting read-only is Forbidden on assignRole") is satisfied; the test passes (6/6 in `roles/actions.test.ts`) because the server gate already denies. This is stronger than RED — the RO-01 write-deny invariant for `assignRole` is proven GREEN today.
- **Files:** app/[lang]/(admin)/roles/actions.test.ts. **Commit:** `ac8ec60`.

### 2. [Plan-discretion] i18n parity excludes top-level `_`-prefixed metadata keys
- **Found during:** Task 3.
- **Issue:** `ms.json`/`zh.json` carry top-level `_review`/`_note` markers (D-08 "machine-assisted draft awaiting native review") that `en.json` intentionally lacks. A naive deep-key comparison would report these as a parity violation (a false RED on documentation metadata, not a missing UI string).
- **Resolution:** The parity test excludes top-level `_`-prefixed keys, so the invariant is over TRANSLATABLE UI keys only. With that scoping, parity holds today → the test is real and GREEN (the plan's intent: "real and stays green forever once parity holds"). Documented in the test header.
- **Files:** src/i18n/__tests__/i18n-parity.test.ts. **Commit:** `02d3438`.

### 3. [Plan/PATTERNS fallback] Sidebar & integrations are logic-only, not render tests
- **Per 06-PATTERNS.md "No Analog Found":** `@testing-library/react` is NOT installed (verified — not in dependencies or devDependencies). Per the plan/PATTERNS fallback, the sidebar visibility and integrations no-send checks are written as logic-only Vitest assertions over the SECTIONS filter data / static source string, NOT JSX render tests. This is the prescribed approach, recorded as a deviation per the executor convention.

## STATE / ROADMAP

Per the orchestrator's ownership rule, `.planning/STATE.md` and `.planning/ROADMAP.md` were **not** modified by this executor. `.planning/config.json` (`_auto_chain_active`) was left unstaged (orchestrator-owned).

## Verification

- `npm run typecheck` → exit 0 (all 10 changed files compile; the not-yet-built modules are loaded via variable-specifier dynamic import so there are no TS2307 errors).
- `npm run test` (offline) → 564 passed, 168 skipped, 21 failed. The 21 failures are exactly the 5 Wave-0 scaffold files (RED-by-design); i18n-parity passes 6/6. No pre-existing v1 test file regressed — `auth.test.ts` keeps its 3 original specs green and adds only the 1 RED Behavior 3c + a green guard.
- `git diff --name-only` across the 3 commits → **test/fixture files only**; zero production source modified (brownfield no-regression rule honored).
- Emulator path (run at wave merge): `firebase emulators:exec --only firestore "npm run test:rules"` exercises the RO-01 matrix (RED until Wave 2/3 land the rules) — not run here (offline).

## Self-Check: PASSED

Created files (all confirmed present):
- FOUND: src/i18n/__tests__/i18n-parity.test.ts
- FOUND: src/firebase/__tests__/role-helper.test.ts
- FOUND: app/[lang]/_components/app-sidebar-nav.test.ts
- FOUND: app/[lang]/(admin)/integrations/integrations-shell.test.ts
- FOUND: app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts

Commits (all confirmed in git log):
- FOUND: 3d358e3 (Task 1 — fixtures)
- FOUND: ac8ec60 (Task 2 — rules matrix + role union + Forbidden)
- FOUND: 02d3438 (Task 3 — logic-only scaffolds + i18n parity)
