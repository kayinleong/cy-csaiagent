---
phase: 06-console-ia-v2
plan: 02
subsystem: auth / role-system
tags: [rbac, read-only-role, requireRole, server-gate, RO-01, RO-02]
wave: 1
requirements: [RO-01, RO-02]
dependency_graph:
  requires:
    - "06-01 (Wave-0 RED scaffolds: auth.test.ts read-only case, role-helper.test.ts)"
    - "src/firebase/auth.ts (Role union, VALID_ROLES, requireUser, setUserClaims)"
  provides:
    - "Role union + exported VALID_ROLES including 'read-only' (single source of truth)"
    - "AssignableRole including 'read-only' (admin-assignable)"
    - "requireRole({ lang, allowed, fallback? }) centralized server-gate helper (Pattern A)"
  affects:
    - "Wave 3 / 06-04 (gate widening) — will rewire existing gates through requireRole"
    - "Firestore rules wave (isAnalyticsReader) — read-only role now provisionable"
tech_stack:
  added: []
  patterns:
    - "Pattern A (cookies → requireUser via synthetic Bearer → redirect) factored into one tested helper"
    - "Pitfall 6: redirect() called OUTSIDE try/catch (resolve role inside, branch outside)"
    - "core/shell split: app/_lib helper imports src/, never the reverse"
key_files:
  created:
    - "app/[lang]/_lib/require-role.ts — requireRole(allowed) server gate helper"
  modified:
    - "src/firebase/auth.ts — Role union + exported VALID_ROLES + 'read-only'; setUserClaims JSDoc"
    - "src/firebase/collections.ts — UserDoc.role widened to admit 'read-only'"
    - "app/[lang]/(admin)/roles/actions.ts — AssignableRole + UserWithRole.role widened to 'read-only'"
    - "src/firebase/auth.test.ts — read-only success GREEN + no-agentProfiles guard"
    - "src/firebase/__tests__/role-helper.test.ts — rewritten to the async requireRole contract"
decisions:
  - "Exported VALID_ROLES from auth.ts (was private const) so the gate helper + tests reference one source of truth (additive, no behaviour change)"
  - "Widened UserDoc.role / UserWithRole.role to the 4-role union (Rule 3 blocking type fix — a provisioned read-only user legitimately stores role:'read-only')"
  - "UserDoc.role inlines the union literal (not import Role from auth) to avoid a collections↔auth circular import"
  - "requireRole takes an options object { lang, allowed, fallback? } (not positional) so callers read clearly and fallback is optional (default /lang/chat = existing Pattern A)"
  - "Did NOT rewire any existing gate through requireRole — gate widening is Wave 3 / 06-04; this task proves the helper in isolation so a regression surfaces pre-IA"
metrics:
  duration: ~25m
  tasks_completed: 2
  files_created: 1
  files_modified: 5
  completed_date: 2026-06-11
---

# Phase 6 Plan 02: Read-only Role + requireRole Gate Helper Summary

**One-liner:** Added a 4th least-privilege `read-only` role to the auth core's single source of truth (Role union + exported VALID_ROLES + AssignableRole) and introduced a regression-covered centralized `requireRole(allowed)` server-gate helper replicating Pattern A — both BEFORE any gate is widened, so a regression is caught in isolation.

## What Was Built

### Task 1 — `read-only` across the role type system (commit `36b56bd`)
- `src/firebase/auth.ts:36` — `Role` union now `'new-agent' | 'senior-coach' | 'admin' | 'read-only'`.
- `src/firebase/auth.ts:46` — `VALID_ROLES` now exported (was a private const) and includes `'read-only'`. `setUserClaims` auto-validates against it, so `setUserClaims(uid, 'read-only')` resolves while an unknown role still throws `InvalidRoleError`.
- `setUserClaims` for `read-only` upserts only `users/{uid}` — NOT `agentProfiles/{uid}` (that branch stays new-agent-only by design). Asserted by a new guard test (1 write vs 2 writes).
- `app/[lang]/(admin)/roles/actions.ts:60` — `AssignableRole` includes `'read-only'` (admin can assign it; the `assignRole`/`listUsersWithRoles` gates stay admin-only — read-only cannot self-assign).
- Blocking type fixes (Rule 3): `UserDoc.role` (`src/firebase/collections.ts:63`) and `UserWithRole.role` widened to admit `'read-only'`, since a provisioned read-only user's `users/{uid}` doc now carries that role.

### Task 2 — `requireRole(allowed)` centralized gate helper (commit `fb39fc5`)
- New `app/[lang]/_lib/require-role.ts` exporting `async requireRole({ lang, allowed, fallback? }): Promise<AuthenticatedUser>`.
- Replicates Pattern A verbatim: `await cookies()` → read `__session` → build synthetic `Bearer` `Request` → `await requireUser(req)`. Role is read from the VERIFIED token only (T-06-04 Spoofing/EoP).
- **Pitfall 6 honoured:** the role is resolved INSIDE the try/catch (only an `unauthorized` intent flag is set there); EVERY `redirect()` is called OUTSIDE the try/catch. Fails closed — a non-`UnauthorizedError` is rethrown, never swallowed into allow.
- Default fallback `/${lang}/chat` (matches existing Pattern A); overridable for read-only surfaces (e.g. `/${lang}` Home).
- **No existing gate rewired** — proven in isolation (Wave 3 / 06-04 widens gates through it).

## Verification

- `npx tsc --noEmit` → **0 errors**.
- `npx vitest run src/firebase/auth.test.ts src/firebase/__tests__/role-helper.test.ts` → **17 passed** (read-only union + requireRole Wave-0 RED stubs now GREEN; InvalidRoleError guard intact).
- `npx vitest run src/firebase/__tests__` → no existing auth/rules-helper test broken (rules.test.ts auto-skips without the emulator — pre-existing, unchanged).
- Grep acceptance: Role union, `VALID_ROLES`, `AssignableRole` all contain `read-only`; `setCustomUserClaims` count in `roles/actions.ts` = 0 (claim path still routes through `setUserClaims` only); `export async function requireRole` present; helper has 0 `@/app` self-imports (imports only `@/src`).
- No file deletions in either commit.

## Regression Report (CLAUDE.md)

**Regression surface:** the role type system (every consumer of `Role` / `UserDoc.role`) and the claim path.

- **Existing 3-role behaviour unchanged:** adding a 4th union member is additive; `setUserClaims` for `new-agent`/`senior-coach`/`admin` still behaves identically (auth.test.ts Behaviour 3a green). The `new-agent`-only `agentProfiles` upsert is unchanged (guard test proves read-only gets none).
- **No gate widened:** `assignRole`/`listUsersWithRoles` gates, route-group layouts, and all per-page gates are UNTOUCHED — `read-only` is denied everywhere until Wave 3. Verified by `git diff` (no layout/page gate files in this plan's diff).
- **Type widening audited:** `UserDoc.role` and `UserWithRole.role` widening only admits an additional valid literal; no narrowing, no `any`. tsc passes with 0 errors across the whole repo.
- **Circular-import risk ruled out:** `UserDoc.role` inlines the union literal rather than importing `Role` from `auth.ts` (which imports `collections.ts`).
- **core/shell split intact:** the helper imports `@/src` only; no production `src/` code imports the `app/` helper (the one `src/` reference is a JSDoc comment in auth.ts; the test under `src/__tests__` legitimately imports the unit under test).
- **Full-suite check:** 3 other test files (`app-sidebar-nav.test.ts`, `per-coach-pivot.test.ts`, `integrations-shell.test.ts`) remain RED — **proven pre-existing** by checking out commit `8c3aed5` (before this plan) where they failed identically (17 failures). They are Wave-0 RED stubs owned by later 06-xx plans (IA-01 / AP-01 / SC-01), logged in `deferred-items.md`. Not a regression from 06-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened `UserDoc.role` to admit `'read-only'`**
- **Found during:** Task 1 (tsc error TS2322 at `auth.ts:177`).
- **Issue:** `setUserClaims` builds a `UserDoc` with `role: Role`; `UserDoc.role` was the narrow 3-role union → type assignment failed once `Role` included `read-only`.
- **Fix:** Widened `src/firebase/collections.ts:63` `UserDoc.role` to the 4-role union (inlined literal to avoid a circular import, with a comment tying it to the canonical `Role`).
- **Files modified:** `src/firebase/collections.ts`
- **Commit:** `36b56bd`

**2. [Rule 3 - Blocking] Widened `UserWithRole.role` to `Role`**
- **Found during:** Task 1.
- **Issue:** `listUsersWithRoles` maps `data.role` (now `Role`) into `UserWithRole.role` (narrow 3-role union) → type error; a provisioned read-only user would be unrepresentable in the matrix row.
- **Fix:** `app/[lang]/(admin)/roles/actions.ts` — `UserWithRole.role` now uses the canonical `Role` type (runtime behaviour unchanged).
- **Files modified:** `app/[lang]/(admin)/roles/actions.ts`
- **Commit:** `36b56bd`

**3. [Rule 2 - Critical/correctness] Exported `VALID_ROLES`**
- **Found during:** Task 1 / Task 2.
- **Issue:** The Wave-0 `role-helper.test.ts` asserts `VALID_ROLES.includes('read-only')`, but `VALID_ROLES` was a private const → resolved `undefined`. The role-aware gate helper + tests need one referenceable source of truth.
- **Fix:** Exported `VALID_ROLES` from `auth.ts` (additive; no behaviour change).
- **Files modified:** `src/firebase/auth.ts`
- **Commit:** `36b56bd`

**4. [Test contract] Rewrote `role-helper.test.ts` from the Wave-0 synchronous stub to the async `requireRole` contract**
- **Found during:** Task 2.
- **Issue:** The Wave-0 RED stub imported a synchronous `requireRole(user, allowed)` from `@/src/firebase/auth`. The plan's Task 2 `<action>` mandates the real helper be the async `requireRole({ lang, allowed, fallback? })` in `app/[lang]/_lib/require-role.ts` (cookies/redirect). The stub was a placeholder shape, explicitly slated for rewrite by the plan.
- **Fix:** Rewrote the test to import the async helper from its real location and mock `requireUser` + `next/navigation` redirect + `next/headers` cookies — asserting allowed→user, disallowed→fallback redirect, no-session/invalid-token→sign-in, non-Unauthorized error rethrow, Bearer-from-cookie, and `VALID_ROLES` includes `read-only`.
- **Files modified:** `src/firebase/__tests__/role-helper.test.ts`
- **Commit:** `fb39fc5`

## Threat Surface

No NEW security surface beyond the plan's `<threat_model>`. The helper mitigates T-06-04 (role read from verified token only; disallowed→redirect proven by test). T-06-05 (read-only added to AssignableRole, assignRole gate stays admin-only) and T-06-06 (no direct `setCustomUserClaims` introduced; grep = 0) hold.

## Known Stubs

None introduced by this plan. (The 3 out-of-scope RED stubs for later 06-xx plans are pre-existing and tracked in `deferred-items.md`.)

## Self-Check: PASSED

- Files created/modified all exist on disk (6/6 verified).
- Commits `36b56bd` and `fb39fc5` exist in git history.
- tsc 0 errors; auth + role-helper tests 17/17 green; no existing test broken (3 unrelated RED stubs proven pre-existing).
