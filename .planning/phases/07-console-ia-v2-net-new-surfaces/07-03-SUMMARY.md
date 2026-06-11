---
phase: 07-console-ia-v2-net-new-surfaces
plan: 03
subsystem: ui
tags: [server-actions, cohorts, coach-assignment, agent-profile, days-to-first-close, audit, downline-scope, read-only-gate, next-intl, shadcn]

# Dependency graph
requires:
  - phase: 07-02
    provides: "CohortDoc + cohortsRef() (Collection 21); AgentProfileDoc.cohortId?/firstCloseAt? wired converters; deny-by-default cohort rules (read-only DENIED)"
  - phase: 07-01
    provides: "Wave-0 RED contracts: coach-assignment dual-write, recordFirstClose idempotency, getAgentProfile audit-before-read, daysToFirstClose math; ci-guard 5 (no journey-edit on the [uid] route)"
provides:
  - "createCohort/updateCohort/deleteCohort — admin-only audited cohort CRUD Server Actions"
  - "assignCoach — admin-only atomic adminDb.batch() dual-write (agentProfiles.seniorCoachId + users.uplineCoachId), audited (D-06/D-07)"
  - "recordFirstClose — coach own-downline/admin, idempotent (no overwrite), audited (D-21)"
  - "getAgentProfile composer (audit-before-read, downline-gated, read-only) + daysToFirstClose + aggregateDaysToFirstClose (read-time, D-22)"
  - "Routes: /[lang]/cohorts + /[lang]/coach-assignment (admin group); /[lang]/agents index + /[lang]/agents/[uid] drill-in (coach group) — NAV-01 href now resolves"
affects: [07-04, 07-05, 07-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getSessionUser (cookie → synthetic Request → requireUser) admin-gate verbatim from roles/actions.ts in two new action modules"
    - "atomic adminDb.batch() dual-write of two denormalized pointers (D-06) — never drift apart"
    - "read-time metric composition with NO stored field (daysToFirstClose off snapshot.createTime, D-22)"
    - "requireRole({ allowed }) page gate finally consumed (Wave-0 helper) — read-only excluded from every allow-list (D-24)"
    - "(coach)-group placement for coach-or-admin surfaces (the (admin) layout redirects senior-coach to /dashboard)"
    - "vi.hoisted() for captured mock refs referenced inside hoisted vi.mock() factories (TDZ-safe)"

key-files:
  created:
    - "app/[lang]/(admin)/cohorts/actions.ts"
    - "app/[lang]/(admin)/cohorts/page.tsx"
    - "app/[lang]/(admin)/cohorts/cohort-management.tsx"
    - "app/[lang]/(admin)/coach-assignment/actions.ts"
    - "app/[lang]/(admin)/coach-assignment/page.tsx"
    - "app/[lang]/(admin)/coach-assignment/coach-reassign.tsx"
    - "app/[lang]/(coach)/agents/actions.ts"
    - "app/[lang]/(coach)/agents/page.tsx"
    - "app/[lang]/(coach)/agents/agent-list.tsx"
    - "app/[lang]/(coach)/agents/[uid]/page.tsx"
    - "app/[lang]/(coach)/agents/[uid]/record-first-close.tsx"
  modified:
    - "src/dashboard/queries.ts"
    - "src/dashboard/queries.test.ts"
    - "app/[lang]/(admin)/coach-assignment/actions.test.ts"

key-decisions:
  - "totalTokens on the profile sums inputTokens + outputTokens (UsageRollupDoc has no `tokens` field)"
  - "cohort write payloads stamp tenantId: TENANT_ID explicitly (the converter also stamps it) to satisfy WithFieldValue<CohortDoc> — mirrors the reply-edit/knowledgeGaps writers"
  - "Page gates use the relative `../../_lib/require-role` import (bracket-dir route group); read-only excluded from every allow-list (D-24)"
  - "agent-list index reuses getDownline verbatim (does NOT rebuild the downline list) — minimal W2 reachability shim only"

patterns-established:
  - "Pattern: NotInDownlineError thrown by getAgentProfile for a non-downline coach (gate 1); RSC catches → renders an Empty denied state"
  - "Pattern: the only write on a read-only profile is a separate idempotent action island (record-first-close) — no journey-state path (D-04)"

requirements-completed: [COH-03, PROF-01, PROF-02, ASSIGN-01, ASSIGN-02, CLOSE-02]

# Metrics
duration: 12min
completed: 2026-06-11
---

# Phase 7 Plan 03: Agents & Cohorts Cluster Summary

**Admin-only audited cohort CRUD + an atomic admin-only coach-reassignment dual-write, a read-only downline-gated agent-profile drill-in with read-time days-to-first-close (off the agentProfiles doc `createTime`, never `lastActiveAt`) and an idempotent record-first-close action, plus the `/[lang]/agents` index that finally makes the NAV-01 href resolve — turning the Wave-0 ASSIGN-01 / PROF-02 / CLOSE-01/02 RED contracts GREEN with zero schema change.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-11T14:01:00Z
- **Completed:** 2026-06-11T14:13:00Z
- **Tasks:** 3
- **Files modified:** 14 (11 created, 3 modified)

## Accomplishments
- **Cohort CRUD (COH-03):** `createCohort`/`updateCohort`/`deleteCohort` — admin-only (role from the verified token), each audited (`cohort-create`/`-update`/`-delete`); a D-08 no-cascade-clear note documents the denormalized `cohortId` policy.
- **Coach reassignment (ASSIGN-01/02):** `assignCoach` is ADMIN-ONLY (D-07 — a senior-coach/read-only caller → `Forbidden`; a coach can NEVER reassign their own downline). On admin success a single `adminDb.batch()` updates `agentProfiles.seniorCoachId` AND `users.uplineCoachId`, then `commit()` (atomic, D-06); audited `coach-assign`. A comment documents D-08 (historical denorm rows are NOT backfilled).
- **Agent profile (PROF-01/02):** `getAgentProfile` writes `auditDrilldown(coachUid,'agentProfiles')` BEFORE the doc read (ordering asserted), gates a non-admin coach by `seniorCoachId == coachUid` (throws `NotInDownlineError` otherwise), and composes existing data only (usageRollups token totals + escalation/knowledge-gap counts + cohortId/firstCloseAt). NO journey-edit path anywhere (D-04; ci-guard 5 GREEN).
- **days-to-first-close (CLOSE-02):** `daysToFirstClose(onboardingStart, firstCloseAt?)` = whole-day delta off the agentProfiles doc `snapshot.createTime` (Pitfall 4 zero-migration), NEVER `lastActiveAt`; `null` when no close → em-dash in the UI. `aggregateDaysToFirstClose` returns avg + median over agents WITH a close (D-22).
- **record-first-close (CLOSE-01):** coach own-downline + admin; idempotent — a second call when `firstCloseAt` is set is a no-op (`already-recorded`); audited `record-first-close`.
- **Four reachable, correctly-gated surfaces:** cohorts + coach-assignment under `(admin)` (`requireRole(['admin'])`, read-only DENIED); the agents index + the `[uid]` profile under `(coach)` (`['admin','senior-coach']`, read-only DENIED). The index reuses `getDownline` and deep-links each row to `/[lang]/agents/[uid]`, so the NAV-01 `/[lang]/agents` href resolves (W2 — no 404).

## Task Commits

Each task was committed atomically:

1. **Task 1: Cohort CRUD + coach-assignment Server Actions** — `4d44930` (feat)
2. **Task 2: Agent-profile composer + days-to-first-close + record-first-close** — `e2c1ec3` (feat)
3. **Task 3: Cohort/coach-assignment/agents-index/agent-profile pages + components** — `533ce0a` (feat)

**Plan metadata:** _(final docs commit — STATE.md + ROADMAP.md + this SUMMARY)_

## Files Created/Modified
- `app/[lang]/(admin)/cohorts/actions.ts` — admin-only audited cohort CRUD + bounded `listCohorts`
- `app/[lang]/(admin)/cohorts/page.tsx` — RSC `requireRole(['admin'])`; loads cohorts server-side
- `app/[lang]/(admin)/cohorts/cohort-management.tsx` — table + create/edit dialog + destructive delete AlertDialog
- `app/[lang]/(admin)/coach-assignment/actions.ts` — admin-only atomic `assignCoach` dual-write (D-06/D-07/D-08)
- `app/[lang]/(admin)/coach-assignment/page.tsx` — RSC admin-only gate; loads the user roster
- `app/[lang]/(admin)/coach-assignment/coach-reassign.tsx` — agent/coach Select + neutral-primary reassign confirm (states D-08)
- `app/[lang]/(coach)/agents/actions.ts` — idempotent audited `recordFirstClose`
- `app/[lang]/(coach)/agents/page.tsx` — RSC coach/admin index; reuses `getDownline`
- `app/[lang]/(coach)/agents/agent-list.tsx` — table whose rows `<Link>` to `/[lang]/agents/[uid]`
- `app/[lang]/(coach)/agents/[uid]/page.tsx` — read-only profile drill-in (card grid + metric tiles + em-dash days-to-first-close)
- `app/[lang]/(coach)/agents/[uid]/record-first-close.tsx` — the only write island (record-first-close AlertDialog)
- `src/dashboard/queries.ts` — `getAgentProfile`, `daysToFirstClose`, `aggregateDaysToFirstClose`, `NotInDownlineError`
- `src/dashboard/queries.test.ts` — Wave-0 test (test-only TDZ fix; see Deviations)
- `app/[lang]/(admin)/coach-assignment/actions.test.ts` — Wave-0 test (test-only TDZ fix; see Deviations)

## Decisions Made
- `totalTokens` sums `inputTokens + outputTokens` from `usageRollups` (there is no `tokens` field on `UsageRollupDoc`).
- Cohort writes stamp `tenantId: TENANT_ID` explicitly to satisfy `WithFieldValue<CohortDoc>` (the converter also stamps it — idempotent, mirrors the reply-edit/knowledgeGaps writers).
- Page gates import `requireRole` via the relative `../../_lib/require-role` path (the route-group brackets make the `@/`-alias specifier ambiguous in module resolution); read-only is excluded from every allow-list (D-24).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TDZ crash in two Wave-0 test harnesses**
- **Found during:** Task 1 (coach-assignment test) and Task 2 (queries test)
- **Issue:** Each Wave-0 test declared its captured mock refs (`mockBatch`/`mockAuditDrilldown`/`mockProfileDoc`/…) as plain top-level `const`s and referenced them inside `vi.mock()` factories. Vitest hoists `vi.mock()` above those `const` declarations, so the factories ran while the consts were in their temporal dead zone → `ReferenceError: Cannot access 'mockBatch' before initialization`. The test could NEVER pass — even with a correct implementation — because the suite failed to load.
- **Fix:** Wrapped the captured refs in `vi.hoisted(() => …)` (the standard vitest idiom) so they are initialized before the hoisted factories run. Every assertion is preserved verbatim — only the harness setup changed. In `queries.test.ts` the mutable `fakeProfile` stays a module-scope `let` (the spies read it at call time); its `get` spy uses `mockImplementation` (survives `clearAllMocks`).
- **Files modified:** `app/[lang]/(admin)/coach-assignment/actions.test.ts`, `src/dashboard/queries.test.ts`
- **Verification:** Both suites now load and pass (coach-assignment 4/4, queries 4/4). `recordFirstClose`'s test (`agents/actions.test.ts`) had no such harness bug.
- **Committed in:** `4d44930` (Task 1) + `e2c1ec3` (Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug — test-harness TDZ).
**Impact on plan:** Necessary to turn the RED contracts GREEN; the fix is confined to test setup and changes no assertion or behavior. No scope creep.

## Issues Encountered
None beyond the test-harness TDZ above. The plan's Task-3 `<verify>` runs `app-sidebar-nav.test.ts` as a build probe; that test (the 8 nav items + i18n keys) is **07-06 scope** (per 07-01) and remains RED-by-design — it is NOT a 07-03 contract. Likewise `audit-log/actions.test.ts` + `model-config/actions.test.ts` are **07-05** Wave-0 stubs (still RED). No NEW regression: the full suite went 614 → 626 passing.

## Known Stubs
- **i18n keys referenced, not yet authored.** All new surfaces use `next-intl` `t('…')` keys under the `adminCohorts` / `adminCoachAssignment` / `agentsIndex` / `agentProfile` namespaces. The plan defers the catalog entries (EN/BM/中文) to **07-06**; at runtime a missing key renders the key string (no crash). This is the intended cross-plan split — the keys are wired here and authored in 07-06.
- **Nav entries for these surfaces** (the `agentProfiles` / `cohorts` / `coachAssignment` items) land in **07-06** (the `app-sidebar-nav.ts` source is unchanged here). The routes are reachable directly by URL today; the sidebar links appear in 07-06.

## Verification
- `npx tsc --noEmit` — clean across all 14 files (the only remaining tsc errors are the unrelated 07-05 Wave-0 `./actions` stub imports — pre-existing, out of scope).
- `npx vitest run` (targeted) — **coach-assignment 4/4, queries 4/4, agents/actions 4/4 GREEN**; ci-guards 6/6 GREEN (Guard 5 confirms NO journey-edit symbol on the `[uid]` route — D-04).
- Full suite: 626 passed / 186 skipped (emulator-gated) / 3 RED files all out-of-scope (07-05 audit-log + model-config, 07-06 nav). No new regression vs. 614 at 07-01.

## Threat Coverage Realized (GREEN)

| Threat | Realized by |
|--------|-------------|
| T-07-07 (read-only EoP into cohorts/coach-assignment/agent-profile) | `requireRole` allow-lists exclude `read-only` on all three pages (D-24) |
| T-07-08 (coach reads a non-downline agent) | `getAgentProfile` gates `seniorCoachId == coachUid` → `NotInDownlineError` (app gate 1; rules = gate 2) |
| T-07-09 (coach drilldown not logged) | `auditDrilldown(coachUid,'agentProfiles')` BEFORE the read (ordering asserted) |
| T-07-10 (role forged via action args) | every action reads role from the verified token (getSessionUser), never from args |
| T-07-11 (days-to-first-close double-record) | `recordFirstClose` idempotent (read-before-write; second call no-op) |
| T-07-27 (senior-coach reassigns own downline) | `assignCoach` admin-ONLY; a senior-coach token → `Forbidden` |
| T-07-SC (package installs) | accept — no new packages this plan |

## Next Phase Readiness
- **07-04** (coach-scoped flag queue): the (coach)/(admin) gating + audit-before-read pattern and the `requireRole` page-gate consumption are now exercised end-to-end; consumes `conversationFlagsRef` + the (seniorCoachId,status) index from 07-02.
- **07-05** (audit-log viewer + model-config): the new audit actions (`cohort-*`, `coach-assign`, `record-first-close`) write rows the viewer will surface; its Wave-0 stubs remain RED until 07-05.
- **07-06** (8 nav items + i18n): must (a) author the `adminCohorts`/`adminCoachAssignment`/`agentsIndex`/`agentProfile` catalogs in EN/BM/中文, and (b) add the sidebar nav entries (including the `agentProfiles` → `/[lang]/agents` item) — both turn `app-sidebar-nav.test.ts` GREEN.

## Self-Check: PASSED

- All 11 created files + `src/dashboard/queries.ts` + this SUMMARY verified present on disk.
- All 3 task commits verified in git history (`4d44930`, `e2c1ec3`, `533ce0a`).

---
*Phase: 07-console-ia-v2-net-new-surfaces*
*Completed: 2026-06-11*
