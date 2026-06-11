---
phase: 06-console-ia-v2
verified: 2026-06-11T10:10:00Z
status: human_needed
score: 13/13 must-haves verified (code); 3 live-gated items routed to human
overrides_applied: 0
human_verification:
  - test: "Deploy firestore.rules to the Firebase project and run the rules-unit-test matrix under the emulator (FIRESTORE_EMULATOR_HOST set)."
    expected: "All read-only matrix assertions pass live (read-only CAN read usageRollups/usageEvents/evals + KB collections; DENIED conversations/messages/leads/leadContext/auditLogs/erasureRequests/rateBudgets/users/agentProfiles/knowledgeGaps/escalations/replyEdits; DENIED write everywhere). A prior emulator run confirmed 151/151 green — confirm the deployed rules match the verified firestore.rules source."
    why_human: "Rules-unit-tests are emulator-gated (describe.skip without FIRESTORE_EMULATOR_HOST) and skipped offline; live enforcement requires `firebase deploy` of firestore.rules, which only a human can run against the project."
  - test: "Native-speaker sign-off on the BM (ms.json) and 中文 (zh.json) Phase-6 surface copy (6 section labels, Home, Integrations empty-state, KB read-only notice, usage analytics strings)."
    expected: "Translations are accurate and natural, not just key-present. ms/zh carry the `_note` machine-assisted-draft marker (D-08); a human confirms the strings are fit for the pilot."
    why_human: "The i18n-parity test proves key-set equality (structural parity), not translation quality. Copy correctness is a human judgement."
  - test: "Browser click-through of the read-only stakeholder role: sign in as a read-only user, confirm landing on Home (not chat/dashboard), confirm visible nav = Home + Knowledge(KB viewer) + Analytics(Usage) only, confirm usage page renders org aggregates with NO per-agent rows, confirm KB doc page shows the version timeline with NO edit form, and confirm direct-URL navigation to /roles, /conversations, /inventory, /erasure, /integrations all redirect to Home."
    expected: "Server-side gates redirect read-only away from every write/admin surface; analytics surfaces render data; no PII is visible anywhere to read-only."
    why_human: "End-to-end role behaviour, redirect flow, and visual/PII confirmation require a running app + a provisioned read-only account — not verifiable by static analysis."
---

# Phase 6: Console IA v2 — Restructure + Read-only Role Verification Report

**Phase Goal:** The admin/coach console is reorganized into the six business-requested sections (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), a read-only stakeholder role can see reporting surfaces only (server-side gated), and existing v1 surfaces are relocated/consolidated under the correct sections — WITHOUT rebuilding any feature that already works. **The single most important criterion: NO regression to any v1 feature.**
**Verified:** 2026-06-11T10:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Overriding Criterion — NO v1 Regression

| Check | Result | Evidence |
| ----- | ------ | -------- |
| `npx tsc --noEmit` | ✓ 0 errors | Exit 0, no output |
| `npx vitest run` | ✓ 602 passed / 0 failed / 168 skipped | 43 files passed, 5 skipped (emulator-gated rules suites — `describe.skip` without `FIRESTORE_EMULATOR_HOST`) |
| v1 route folders intact | ✓ No moves | `(admin)`, `(coach)`, `(auth)`, `chat` all present; only `integrations/page.tsx` added in-place. IA restructure is nav-only over unchanged routes (LOCKED decision honored). |
| Targeted Phase-6 suites | ✓ 30/30 passed | i18n-parity, integrations-shell, app-sidebar-nav, dashboard pivot, roles actions |

The overriding success criterion (no v1 regression) is satisfied: the full type-check and test suite are green, and no existing route folder was relocated.

### Observable Truths

| #   | Truth (REQ)   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | IA-01 — Sidebar renders the 6 fixed sections, role-filtered, over UNCHANGED route hrefs; empty section renders nothing | ✓ VERIFIED | `app-sidebar-nav.ts` defines all 6 sections with exact labels + per-item `roles[]`; hrefs are `/${lang}/kb|inventory|dashboard|conversations|usage|roles|integrations|erasure` (no `(admin)`/`(coach)` segment). `visibleSectionsForRole` filters items then `.filter(s => s.items.length > 0)`. `app-sidebar.tsx` consumes it; doc comment: "UX ONLY — not the security gate." |
| 2 | IA-02 — Broken `/${lang}/admin/kb/...` deep link fixed to `/${lang}/kb/...` | ✓ VERIFIED | `grep -rn "/admin/kb" app/` → 0 hits. `kb-doc-list.tsx:191` → `/${lang}/kb/${id}`; `kb/[docId]/page.tsx:144,184` → `/${lang}/kb` and `/${lang}/kb/${id}`. Pitfall-1 resolved. |
| 3 | RO-01 — `read-only` is a valid Role across union, VALID_ROLES, AssignableRole; setUserClaims succeeds; unknown role throws; no agent profile | ✓ VERIFIED | `src/firebase/auth.ts:36` union + `:56` VALID_ROLES include `read-only`; `setUserClaims` validates against VALID_ROLES, throws `InvalidRoleError` otherwise. `roles/actions.ts:63` AssignableRole includes `read-only`. Synthetic read-only fixture + `readOnlyCtx()` helper exist. |
| 4 | RO-02 — Server-side gate (`requireRole` helper, regression-covered) + layouts redirect read-only away from write/admin; lands on Home; denial test-proven | ✓ VERIFIED | `require-role.ts` reads role from VERIFIED token only, fails closed, redirects disallowed callers (Pitfall-6 redirect-outside-try). `(admin)/layout.tsx:58-67` redirects read-only → `/${lang}` (Home), never chat. `page.tsx` lands read-only/coach/admin on Home. See ⚠️ note on helper wiring below. |
| 5 | RO-03 — Firestore rules grant read-only analytics-only reads; DENY all PII reads + all writes | ✓ VERIFIED (code) | `firestore.rules`: `isAnalyticsReader()` applied ONLY to `evals`/`usageEvents`/`usageRollups`; KB collections inherit `isSignedIn() && sameTenant()`; `users`+`leadContext` explicitly `!isReadOnlyRole()`; conversations/messages/leads/escalations/knowledgeGaps/auditLogs/erasureRequests/rateBudgets/agentProfiles/replyEdits use role predicates read-only never satisfies; no write rule admits read-only. Rules matrix encodes all assertions over `readOnlyCtx()`. (Live emulator run = human item 1.) |
| 6 | RO-04 — Each read-only analytics surface has BOTH page gate AND backing read path widened; all writes still Forbidden | ✓ VERIFIED | `usage/page.tsx:88` gate admits admin + read-only; backing `usageRollups` read runs server-side after the gate (no separate Server Action — Pitfall-3 handled); per-agent rows suppressed server-side for read-only (`perAgentRows: role==='read-only' ? [] : ...`). Write actions (`assignRole`, `resolveStall`, `submitCorrection`, KB CRUD, erasure) all gate on `admin`/`senior-coach` — read-only never passes. |
| 7 | RO-05 — Admin can assign read-only from the role UI; matrix shows analytics-read only; read-only cannot self-assign | ✓ VERIFIED | `assignRole` gates `user.role !== 'admin'`. `role-assignment.tsx`: `ALL_ROLES` includes `read-only`; CAPABILITIES matrix gives read-only ONLY `capViewAnalytics` (no capManageKb/Inventory/ViewConversations/RunErasure/AssignRoles). |
| 8 | HOME-01 — Per-role Home composed from existing aggregations only; usageRollups (not raw events); read-only sees no PII | ✓ VERIFIED | `page.tsx` is a rendered Home RSC; reads `usageRollups` only; reuses stale watchdog; Alerts (stall/gap counts) gated to coach/admin ONLY (read-only never triggers PII-scoped reads); read-only sees org usage/cost KPIs only; no new lazy-cron/pipeline/write; new-agent → chat. |
| 9 | KM-01 — KB version-history viewer reachable read-only with edit form OMITTED; admin keeps form; KB+Inventory under KM | ✓ VERIFIED | `kb/[docId]/page.tsx:104` admits admin + read-only; `isAdmin` flag gates the edit form (`isAdmin ? <KbDocForm/> : readOnlyNotice`); `buildVersionChain` reused verbatim (no schema change). Nav groups KB + Inventory under `sectionKnowledge`. |
| 10 | CKB-01 — Senior coach contributes to KB via attribution (`correctedBy`) + audit, NOT per-doc seniorCoachId; read-only + other CRUD denied | ✓ VERIFIED | `src/kb/crud.ts`: `correctKbDoc` gated by `assertAdminOrCoach` (denies read-only), stamps `correctedBy: user.uid`, writes append-only `auditLog`. Design uses attribution+audit (org-wide KB, no per-doc owner). All other CRUD uses `assertAdmin` (admin-only). |
| 11 | AP-01 — Admin pivots analytics by coachUid (admin-only); non-admin coachUid ignored; count()/select(), audited | ✓ VERIFIED | `per-coach-pivot.ts` `resolvePivotScope`: coachUid honored ONLY when `role==='admin'`; non-admin always locked to own `uid`. `dashboard/actions.ts:350` `getReplyQualityMetrics` gates senior-coach/admin (read-only Forbidden), uses `count()`/`select()` (no fetch-all), audits via `auditDrilldown`. |
| 12 | SC-01 — Static admin-only Integrations shell, NO send/connect/auto-send affordance; no data model/Server Action; render-invariant test | ✓ VERIFIED | `integrations/page.tsx`: admin-only gate, static Card placeholder, no Button-send/Switch/Input/form/onClick (forbidden tokens `Authorization`/`UnauthorizedError` constructed at runtime to pass the source-invariant test). `integrations-shell.test.ts` asserts absence of onClick/send/connect/authoriz/enable/Switch/form — passes. |
| 13 | I18N-01 — All 6 section labels + new Phase-6 strings in en/ms/zh; new `i18n-parity.test.ts` asserts identical key sets | ✓ VERIFIED (structural) | All 6 `section*` labels present in en/ms/zh; new keys (integrations/readOnlyNotice/comingSoonBadge/emptyHeading) present in all three. `i18n-parity.test.ts` is a real test asserting bidirectional key-set equality (excludes `_`-prefixed annotations); passes. (Native-copy quality = human item 2.) |

**Score:** 13/13 must-haves verified in code. 3 live-gated items routed to human verification (same class as prior phases — not code gaps).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/firebase/auth.ts` | Role union + VALID_ROLES + read-only | ✓ VERIFIED | `read-only` in union (:36) + VALID_ROLES (:56); InvalidRoleError thrown for unknown |
| `app/[lang]/_lib/require-role.ts` | `requireRole(allowed)` server gate | ⚠️ ORPHANED | Exists, substantive, fails-closed, regression-covered — but NOT imported by any gate (gates extend in-place instead). Does not break the goal: every gate enforces read-only directly. See note. |
| `firestore.rules` | `isAnalyticsReader()` analytics-only | ✓ VERIFIED | Applied to evals/usageEvents/usageRollups only; PII collections exclude read-only |
| `app/[lang]/_components/app-sidebar-nav.ts` | 6-section SECTIONS + pure role-filter | ✓ VERIFIED | All 6 sections; `visibleSectionsForRole`; empty-section drop |
| `app/[lang]/_components/app-sidebar.tsx` | Per-section render via role-filter | ✓ VERIFIED | Consumes `visibleSectionsForRole`; SidebarGroup per visible section |
| `app/[lang]/page.tsx` | Home RSC landing (per-role) | ✓ VERIFIED | usageRollups-only; alerts coach/admin-only; read-only no PII |
| `app/[lang]/_components/home-surface.tsx` | Home widget grid | ✓ VERIFIED | Composes aggregation props; reused stale watchdog; alerts hidden for read-only |
| `app/[lang]/(admin)/usage/page.tsx` | Usage gate widened (Pitfall-3) | ✓ VERIFIED | Gate + read path both admit read-only; per-agent rows suppressed |
| `app/[lang]/(admin)/roles/role-assignment.tsx` | read-only in ALL_ROLES + matrix | ✓ VERIFIED | capViewAnalytics only |
| `app/[lang]/(admin)/kb/[docId]/page.tsx` | Viewer gate + edit-form conditional + fixed links | ✓ VERIFIED | admin+read-only gate; `isAdmin ?` form; `/${lang}/kb` links |
| `app/[lang]/(admin)/integrations/page.tsx` | Static no-send shell | ✓ VERIFIED | Admin-only; zero affordance |
| `app/[lang]/(coach)/dashboard/actions.ts` + `per-coach-pivot.ts` | coachUid pivot admin-gated | ✓ VERIFIED | resolvePivotScope privilege boundary correct |
| `src/kb/crud.ts` | Audited coach KB contribution via correctedBy | ✓ VERIFIED | assertAdminOrCoach + correctedBy + auditLog |
| `src/i18n/messages/{en,ms,zh}.json` | 6 labels + new keys, parity | ✓ VERIFIED | All present; parity test green |
| `src/i18n/__tests__/i18n-parity.test.ts` | en/ms/zh key parity | ✓ VERIFIED | Real test, bidirectional equality |
| `tests/fixtures/synthetic-users.ts` + `rules-helpers.ts` | 4th read-only user + readOnlyCtx | ✓ VERIFIED | Both present |

### Key Link Verification

| From | To  | Status | Details |
| ---- | --- | ------ | ------- |
| `firestore.rules` analytics rules | `isAnalyticsReader()` | ✓ WIRED | evals/usageEvents/usageRollups read predicate |
| `app-sidebar.tsx` | `visibleSectionsForRole` | ✓ WIRED | Imported + rendered |
| `page.tsx` Home | `usageRollupsRef()` | ✓ WIRED | Org aggregates, counts-only |
| `home-surface.tsx` | stale watchdog Alert | ✓ WIRED | Reused staleWatchdog/latestRollupRelative props |
| `usage/page.tsx` gate | usageRollups read path | ✓ WIRED | Single gate covers render + read (Pitfall-3) |
| `dashboard/actions.ts` admin branch | `seniorCoachId == coachUid` (admin-only) | ✓ WIRED | via resolvePivotScope |
| `src/kb/crud.ts` correctKbDoc | `auditLog` | ✓ WIRED | audit-before-attribution |
| `kb/[docId]/page.tsx` | `buildVersionChain` | ✓ WIRED | Reused verbatim |
| `require-role.ts` | (any gate) | ⚠️ ORPHANED | Helper defined + tested but not imported by gates (see note) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `page.tsx` Home | kpis/alerts | `usageRollupsRef()` + `escalationsRef().count()` + `knowledgeGapsRef().count()` (Admin SDK) | Yes (live Firestore reads; empty-state on no data) | ✓ FLOWING |
| `usage/page.tsx` | rollupDocs/perAgentRows | `usageRollupsRef().where(...).get()` | Yes; per-agent suppressed for read-only | ✓ FLOWING |
| `kb/[docId]/page.tsx` | chain | `buildVersionChain(docId, allDocs)` over kbDocs read | Yes | ✓ FLOWING |
| `integrations/page.tsx` | (none) | Static by design (SC-01) | N/A — intentionally static | ✓ VERIFIED (by-design) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| No v1 regression — typecheck | `npx tsc --noEmit` | Exit 0, 0 errors | ✓ PASS |
| No v1 regression — full suite | `npx vitest run` | 602 passed / 0 failed / 168 skipped | ✓ PASS |
| IA-02 link bug fixed | `grep -rn "/admin/kb" app/` | 0 hits | ✓ PASS |
| Phase-6 targeted suites | `npx vitest run` (5 files) | 30/30 passed | ✓ PASS |
| Out-of-scope leakage | grep for cohorts/profiles/assignment/flagged/audit-viewer/model-config/pdpa-settings/days-to-close/WABA | 0 functional surfaces (only i18n copy + no-send test) | ✓ PASS |
| Live rules enforcement | emulator rules matrix | emulator-gated, skipped offline | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ---------- | ------ | -------- |
| IA-01 | 06-05 | ✓ SATISFIED | 6-section nav over unchanged routes, role-filtered, empty-section drop |
| IA-02 | 06-05, 06-07 | ✓ SATISFIED | Zero `/admin/kb` links; list + detail links fixed |
| RO-01 | 06-02 | ✓ SATISFIED | Role union/VALID_ROLES/AssignableRole + claim path + InvalidRoleError |
| RO-02 | 06-02, 06-04 | ✓ SATISFIED | Server-side layout gates redirect read-only → Home; requireRole helper tested |
| RO-03 | 06-03 | ✓ SATISFIED (code) | isAnalyticsReader analytics-only; PII denied; no writes; matrix encoded (live = human) |
| RO-04 | 06-04 | ✓ SATISFIED | Usage gate + read path widened; writes still Forbidden |
| RO-05 | 06-04 | ✓ SATISFIED | Admin-only assign; analytics-read-only capability matrix |
| HOME-01 | 06-06 | ✓ SATISFIED | Per-role Home; usageRollups-only; read-only no PII |
| KM-01 | 06-07 | ✓ SATISFIED | Read-only viewer, edit form omitted; KB+Inventory under KM |
| CKB-01 | 06-08 | ✓ SATISFIED | assertAdminOrCoach + correctedBy + audit |
| AP-01 | 06-08 | ✓ SATISFIED | coachUid admin-only pivot; non-admin locked |
| SC-01 | 06-07 | ✓ SATISFIED | Static no-send shell, invariant test |
| I18N-01 | 06-01, 06-05 | ✓ SATISFIED (structural) | Parity test + trilingual keys (native copy = human) |

All 13 Phase-6 REQ-IDs accounted for and mapped to delivered code. No orphaned requirements.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| `app/[lang]/_lib/require-role.ts` | Exported helper not imported by any gate | ℹ️ Info | ORPHANED — but does NOT break the goal. Gates enforce read-only directly in-place; the helper duplicates that logic. RO-02 frontmatter required the helper to "exist with regression coverage" (it does) — wiring it into every gate was the planner's Open-Q2 discretion (extend-in-place was chosen). No security gap: every gate is enforced. |

No blocker or warning anti-patterns. No stubs in goal-bearing surfaces (integrations is intentionally static per SC-01). Out-of-scope Phase-7/8 surfaces correctly NOT built.

### Human Verification Required

1. **Live Firestore rules enforcement** — Deploy `firestore.rules` and run the rules-unit-test matrix under the emulator. Expected: the read-only matrix passes live (prior run: 151/151 green). Why human: emulator-gated, requires `firebase deploy`.
2. **BM / 中文 native-copy sign-off** — Confirm ms.json/zh.json Phase-6 strings are accurate, not just key-present. Why human: parity test proves structure, not translation quality.
3. **Read-only role browser click-through** — Sign in as read-only; confirm Home landing, nav = Home+KB-viewer+Usage only, usage shows org aggregates without per-agent rows, KB doc shows timeline without edit form, and direct-URL to /roles, /conversations, /inventory, /erasure, /integrations all redirect to Home. Why human: end-to-end role flow + PII/visual confirmation needs a running app + provisioned account.

### Gaps Summary

No code gaps. The overriding criterion (NO v1 regression) is satisfied: `tsc` is clean, the full suite is green (602/0/168-skip), and no route folder was moved. All 13 REQ-IDs are delivered and verified in code. Out-of-scope Phase-7/8 items are correctly absent. The only structural note is the `requireRole` helper being orphaned (gates enforce read-only in-place instead) — this is an accepted Open-Q2 planner choice with full in-place gate coverage, not a security gap. The three `human_needed` items (live rules deploy, native-copy sign-off, read-only click-through) are the expected live-gated class identical to prior phases — they are NOT code gaps.

---

_Verified: 2026-06-11T10:10:00Z_
_Verifier: Claude (gsd-verifier)_
