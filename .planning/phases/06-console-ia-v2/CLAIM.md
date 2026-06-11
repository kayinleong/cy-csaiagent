# Claim: phase-kayinleong-06

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-10
- status: done
- summary: Plan (and, per --auto, execute) Phase 6 — Console IA v2. Restructure the admin/coach console into the 6-section IA, add a read-only stakeholder role, and consolidate/relocate existing surfaces — WITHOUT rebuilding any working v1 feature. Scope narrowed by a stakeholder split decision (2026-06-10): the heavy net-new surfaces move to a new Phase 7; WhatsApp Business API becomes its own future Phase 8 (v1 "no WABA / never auto-send" constraint stays in force for 6/7).

## What will change

This claim covers the **planning** of Phase 6 (CONTEXT/RESEARCH/UI-SPEC/PATTERNS/PLAN docs) and, because the command was invoked with `--auto`, the **execution** of the resulting plans.

### Scope decisions locked with the user (2026-06-10) — drive the split
1. **Structure:** Split the milestone-sized gap audit. **Phase 6 = IA restructure + read-only role + consolidation of existing surfaces** (lower-risk "relocate & gate" work that delivers the visible business ask). **Phase 7 (new) = net-new surfaces** (cohorts +data model, agent profile pages, coach-assignment UI, flagged queue, audit-log viewer, model-config UI, PDPA-settings read-only display, days-to-first-close).
2. **Integrations:** Build the Integrations **management shell** (console registry under System & Compliance) in Phase 6. The actual **WhatsApp Business API = its own future Phase 8** with the reply-quality graduation gate. The v1 hard constraints ("No WABA in v1", "No auto-send, ever") REMAIN in force for Phases 6 and 7.
3. **days-to-first-close:** Requires a new close/deal signal captured first → **Phase 7** (net-new).
4. **PDPA settings:** **Read-only policy display** (retention/redaction/residency shown as policy-fixed) + link to the existing erasure flow → **Phase 7** (net-new). No new configurable knobs.

### Phase 6 boundary (THIS claim)
- The 6-section navigation restructure (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), role-filtered, with existing v1 surfaces relocated under the correct section — **no regression to any v1 feature**.
- A **read-only stakeholder role** (4th role tier) that can reach reporting/analytics surfaces only, denied every write/admin surface, enforced **server-side** (route-group layout gate + Firestore rules), not just hidden in nav.
- **Home** surface (key metrics / alerts / recent activity / quick actions — composed from existing data sources where possible).
- **Consolidation:** fold KB + Inventory into Knowledge Management; move escalations beside Conversations; unify coach-dashboard + usage into Analytics & Performance.
- **Version-history viewer** UI for KB docs (data already tracked: version/supersedesId).
- **Senior-coach KB-contribution surface** (downline-scoped, audited) — beyond today's inline-correction panel.
- **Per-coach analytics pivot** (admin comparison/filter across coaches).
- **Integrations management shell** under System & Compliance (registry/placeholder; no WABA wiring).
- Trilingual (EN/BM/中文) nav + new copy; all v1 hard constraints honored.

### Explicitly deferred (recorded with rationale per Phase-6 success criterion #5)
- Net-new surfaces → **Phase 7** (cohorts, agent profiles, coach-assignment, flagged queue, audit-log viewer, model-config UI, PDPA-settings display, days-to-first-close).
- WhatsApp Business API integration → **Phase 8** (graduation-gated).

## What has changed

Planned (CONTEXT/RESEARCH/UI-SPEC/PATTERNS/VALIDATION + 8 PLANs, plan-checker PASSED) then executed all 8 plans across waves 0-4 (sequential, no-worktree per global CLAUDE.md). The first 7 plans ran via gsd-executor agents; plan 06-08 was finished inline after the executor's socket dropped twice mid-run.

- **06-01 (W0):** RED test scaffold — 4th synthetic read-only user + `readOnlyCtx()`, the RO-01 collection-by-collection rules matrix, role-union/requireRole/sidebar/integrations-no-send/per-coach-pivot stubs, and a GREEN en/ms/zh i18n parity test (none existed before).
- **06-02 (W1):** `read-only` added to `Role` union + `VALID_ROLES` + `AssignableRole`; centralized `requireRole()` gate helper (built but ultimately unused — gates extended in place per planner Open-Q2; IN-01 follow-up).
- **06-03 (W2):** `isAnalyticsReader()` in firestore.rules (read-only reads `usageRollups`/`usageEvents`/`evals` ONLY); `isReadOnlyRole()` deny-guard EXCLUDES read-only from the pre-existing `users`/`leadContext` grants (Pitfall-2). 151/151 emulator rules tests GREEN.
- **06-04 (W3):** widened the read-only-allowed server gates (sign-in/landing→Home, usage page + `usageRollups` read; per-agent PII suppressed for read-only) + read-only in the role-assignment UI. Walked the 24-site role-branch checklist (admit vs KEEP-deny).
- **06-05 (W4):** 6-section sidebar regroup OVER existing routes (no folder moved) + fixed the latent broken `/admin/kb/...` deep links + trilingual catalogs.
- **06-06 (W4):** per-role Home RSC landing composing existing aggregations only (no new lazy-cron); read-only lands on Home, analytics-only (no PII).
- **06-07 (W4):** KB read-only version-history viewer (no edit form) + static Integrations shell with NO send affordance.
- **06-08 (W4):** admin per-coach analytics pivot (`resolvePivotScope`, coachUid admin-only) + audited senior-coach KB contribution (`correctKbDoc` + `correctedBy` + `kb_contribution` audit row; KB is org-wide, no per-doc owner field).
- **Code-review fix (4658216):** resolved the gsd-code-reviewer's Critical CR-01 (the `(admin)` layout gate denied read-only before the widened page gates ran → read-only feature was unreachable) + WR-01 (admin-page redirects → Home not chat) + WR-02 (`listDocsForViewer` read path so the read-only KB viewer doesn't hit the admin-only `listDocs`).

New REQ-IDs (IA-01/02, RO-01..05, HOME-01, KM-01, CKB-01, AP-01, SC-01, I18N-01) appended to REQUIREMENTS.md.

## Verification

### Phase-level gates (HEAD)
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **605 passed / 0 failed / 168 skipped** (the 168 skipped include the emulator-gated read-only rules matrix; a prior emulator run confirmed 151/151 GREEN). Pre-Phase-6 baseline was 554 passed → +51 new Phase-6 tests GREEN, **0 regressions**.
- gsd-plan-checker: VERIFICATION PASSED (12/12 dimensions, 13/13 REQ-IDs).
- gsd-verifier (`06-VERIFICATION.md`): `human_needed`, 13/13 must-haves verified in code, 0 code gaps (live-gated items only).
- gsd-code-reviewer (`06-REVIEW.md`, status: resolved): 1 Critical + 2 feature-blocking Warnings fixed + tested; remaining Info/pre-existing-pattern warnings dispositioned as non-blocking follow-ups.

### Regression report
- **Regression surface:** the role system (4th role union + `collections.ts` type widening), `firestore.rules` (analytics-reader + read-only deny-guards), ~24 server role-gate sites + the `(admin)` route-group layout, the entire nav (`app-sidebar` regroup), the role-redirect landing (`page.tsx`), the coach dashboard aggregations (`coachUid` pivot + `computeEscalationRate` signature), `src/kb/crud.ts` (audit + `listDocsForViewer`), and the i18n catalogs.
- **Ruled out:** the existing 3 roles' gate behavior is unchanged — `read-only` is a strictly additive role; rules tests prove read-only is DENIED every PII/owner collection + all writes, and no existing rule was widened for the other roles (grep-confirmed: `read-only` appears in firestore.rules ONLY in the analytics-reader helper + the two deny-guards). Nav regroups over UNCHANGED routes (no folder moved; `grep "/admin/kb" app/` → 0; existing deep links resolve). Home reuses existing aggregations (no new lazy-cron, no raw usageEvents). Integrations shell has no send path (test-asserted). KB CRUD stays admin-only; the contribution path is additive + audited; no KB schema change. AP-01 `coachUid` is admin-only (a coach cannot read another coach's downline). Core/shell split intact (`src/` never imports `app/`; the audit import is `src`→`src`). No Cloud Functions / no GCP beyond Firebase SDK / no hard-coded model IDs (only a test fixture). Full suite green: +51 passing over the baseline, 0 prior tests broken.
- **CR-01 specifically:** the read-only feature was initially shipped non-functional (layout gate bounced read-only before the page gates); the code-review fix makes read-only actually reach `/usage` + the KB viewer, and 3 new tests lock the `listDocsForViewer` access. Fail-closed throughout (no PII ever exposed).
- **Result:** No cross-phase regression detected.

### Open human-action gate (live-gated — NOT code gaps; same class as prior phases)
1. `firebase deploy --only firestore:rules` — the additive `isAnalyticsReader()` + read-only deny-guards (rules change is a deploy gate).
2. Emulator-gated read-only rules matrix in CI (`firebase emulators:exec --only firestore "npm run test:rules"` — confirmed 151/151 GREEN locally).
3. Provision a `read-only` test user (`assignRole` UI or `scripts/set-claims.ts --role read-only`) + browser click-through: read-only signs in → lands on Home → reaches `/usage` (org analytics, no per-agent PII) + the KB version viewer → is denied (server-side) every admin/PII surface + write action.
4. BM/中文 native-copy sign-off (Derek) for the 6 section labels + new surface strings.
