---
phase: 06-console-ia-v2
reviewed: 2026-06-11T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - firestore.rules
  - src/firebase/auth.ts
  - src/firebase/collections.ts
  - src/kb/crud.ts
  - app/[lang]/_lib/require-role.ts
  - app/[lang]/page.tsx
  - app/[lang]/_components/home-surface.tsx
  - app/[lang]/_components/app-sidebar-nav.ts
  - app/[lang]/(admin)/layout.tsx
  - app/[lang]/(admin)/usage/page.tsx
  - app/[lang]/(admin)/kb/page.tsx
  - app/[lang]/(admin)/kb/[docId]/page.tsx
  - app/[lang]/(admin)/integrations/page.tsx
  - app/[lang]/(admin)/roles/actions.ts
  - app/[lang]/(coach)/dashboard/actions.ts
  - app/[lang]/(coach)/dashboard/per-coach-pivot.ts
  - app/[lang]/(auth)/sign-in/sign-in-form.tsx
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: resolved
resolved_in: 4658216
---

## Resolution Log (2026-06-11, commit 4658216)

| ID | Severity | Status | Resolution |
|----|----------|--------|------------|
| CR-01 | Critical | ✅ RESOLVED | `(admin)/layout.tsx` now admits `{admin, read-only}` into the group and defers the per-page decision; the read-only page gates on `/usage` + `/kb/[docId]` are now reachable. read-only can reach its analytics surface (Success Criterion #2). |
| WR-01 | Warning | ✅ RESOLVED | All 6 admin-only page gates (conversations/erasure/integrations/inventory/kb/roles) now redirect non-admin → `/${lang}` (Home), never `/chat` — honoring the RO-01 "read-only never chat" invariant. |
| WR-02 | Warning | ✅ RESOLVED | Added `listDocsForViewer(user)` (admin\|read-only read path, returns all versions) in `src/kb/crud.ts`; the KB version viewer uses it instead of the `assertAdmin`-gated `listDocs`. KB CRUD stays admin-only. +3 access tests. |
| WR-03 | Warning | ⏸ DEFERRED (non-blocking) | `getCorrectionEvalFeedback` orders by `correctedBy` — pre-existing Phase-5 coach-dashboard analytics semantics (not introduced by Phase 6's relocate/gate scope). Tracked for a follow-up; "recent corrections" recency should order by `publishedAt`. |
| WR-04 | Warning | ⏸ DEFERRED (non-blocking) | Home `usageRollups` read swallows errors into a silent empty state. Acceptable graceful degradation (stale-watchdog covers staleness); add a code-only `console.warn` for observability in a follow-up. |
| IN-01 | Info | ⏸ DEFERRED (noted) | `require-role.ts` is the orphaned centralized gate helper (built in 06-02 per planner Open-Q2, gates extended in place instead). Tested, no security gap. Candidate for adoption (would have prevented CR-01) or removal. |
| IN-02 | Info | ⏸ DEFERRED (non-blocking) | Home knowledge-gaps counter is captioned with the `recentActivityTitle` i18n key (cosmetic mislabel). Needs dedicated trilingual keys; follow-up. |
| IN-03 | Info | ⏸ DEFERRED (non-blocking) | `getFunnelV2Metrics` `activeAgents` counts any agent with a `lastActiveAt` (no recency ceiling) — pre-existing funnel semantics. Follow-up rename or recency window. |

**Disposition:** the 1 Critical + the 2 feature-blocking Warnings (WR-01/WR-02) are fixed and tested (full suite 605 passed / 0 failed; tsc 0). The remaining items are Info-level cosmetics or pre-existing Phase-5 analytics-semantics warnings — non-blocking; the code-review gate is advisory. Recorded as follow-ups.

---

# Phase 6: Code Review Report — Console IA v2 (Restructure + Read-only Role)

**Reviewed:** 2026-06-11
**Depth:** deep (cross-file: route-group layout ↔ page gates ↔ nav/redirect targets ↔ core CRUD authz)
**Files Reviewed:** 14 source files (+ rules test cross-checked)
**Status:** issues_found

## Summary

**Access-control on the data layer is correct and well-tested.** The new `isAnalyticsReader()` admits `read-only` only on `usageRollups` / `usageEvents` / `evals`; `users` and `leadContext` exclude read-only via `!isReadOnlyRole()`; every PII/owner-scoped collection (conversations, messages, leads, leadContext, auditLogs, erasureRequests, rateBudgets, knowledgeGaps, escalations, agentProfiles) denies read-only reads; no write rule admits read-only. The `rules.test.ts` RO-01 matrix asserts each of these with `assertSucceeds`/`assertFails` and matches the LOCKED 06-VALIDATION matrix. The AP-01 pivot (`resolvePivotScope`) is genuinely admin-only — a coach's `coachUid` is discarded and they stay locked to their own downline. The Integrations shell is a static admin-only panel with no send path. KB contribution is attributed (`correctedBy`) + audited with no per-doc `seniorCoachId`. No hard-coded model IDs in production code (the only `claude-opus-4-7` literal is a test fixture in `rules.test.ts`); no `src/`→`app/` production import (the two `@/app/...` imports are in `.test.ts` files only).

**However, there is one Critical functional/access-control defect that breaks the entire RO-01 read-only feature, plus a cluster of related regressions in the shell routing.** The `read-only` role can reach NONE of the surfaces Phase 6 widened for it (`/usage`, `/kb`, `/kb/[docId]`) because the shared `(admin)/layout.tsx` gate redirects every non-admin role away before any child page renders. The page-level "layer 2" gates that admit read-only are dead code. This is not a PII-leak (it fails closed), but it is a Critical correctness/access defect: the headline deliverable does not function, and several gate comments assert behavior that the code contradicts.

## Critical Issues

### CR-01: `(admin)/layout.tsx` denies `read-only` BEFORE any widened page gate runs — the entire RO-01 read-only surface is unreachable

**File:** `app/[lang]/(admin)/layout.tsx:58-68`
**Cross-file:** `app/[lang]/(admin)/usage/page.tsx:88`, `app/[lang]/(admin)/kb/[docId]/page.tsx:104`, `app/[lang]/_components/app-sidebar-nav.ts:106,131`, `app/[lang]/page.tsx:218-221`, `app/[lang]/(auth)/sign-in/sign-in-form.tsx:94-95`

**Issue:**
`/usage`, `/kb`, `/kb/[docId]`, `/integrations`, `/roles`, `/conversations`, `/inventory`, `/erasure` all live under the single `(admin)` route group, which has exactly one `layout.tsx`. That layout gate is:

```ts
if (user.role !== 'admin') {
  redirect(user.role === 'senior-coach' ? `/dashboard` : user.role === 'read-only' ? `/${lang}` : `/chat`)
}
```

This runs for **every** child route and redirects `read-only` to Home (`/${lang}`) before the page component renders. Therefore:

- `usage/page.tsx:88` (`if (user.role !== 'admin' && user.role !== 'read-only')`) — its comment says "layer 2; layout.tsx is layer 1," but layer 1 already redirected read-only away. The read-only branch is **unreachable dead code**.
- `kb/[docId]/page.tsx:104` (admits read-only as a version-history viewer) — also unreachable.
- The sidebar (`app-sidebar-nav.ts:106,131`) shows read-only the `kb` and `usage` links; the sign-in form (`sign-in-form.tsx:95`) redirects read-only to `/usage`; the Home quick-actions (`page.tsx:218-221`) link read-only to `/usage` and `/kb`. Every one of these targets bounces straight back to Home via the layout.

Net effect: a read-only user can access **nothing** but Home. Clicking any of their own nav items or quick-actions is a no-op redirect loop back to Home. The headline RO-01 deliverable ("read-only stakeholder sees org usage/cost + KB version viewer") is non-functional. The layout's own doc comment ("read-only only renders the specific pages whose own gate admits it (usage analytics)") is factually contradicted by its code.

This is fail-closed (no PII leak), so it is a correctness/access-availability Critical, not a Critical PII vuln. But it nullifies the phase's primary feature and ships gate comments that lie about behavior.

**Fix:** Widen the layout gate to admit `read-only` into the group, then let each page's own gate decide. Keep the deny for `new-agent` and unauthenticated:

```ts
// Admin gets every admin page. read-only is admitted INTO the group so the
// per-page gates (usage, kb/[docId]) can decide; pages that stay admin-only
// (kb list, roles, integrations, inventory, conversations, erasure) redirect
// read-only themselves. senior-coach / new-agent unchanged.
if (user.role === 'new-agent') {
  redirect(`/${lang}/chat`)
}
if (user.role === 'senior-coach') {
  redirect(`/${lang}/dashboard`)
}
if (user.role !== 'admin' && user.role !== 'read-only') {
  redirect(`/${lang}/sign-in`)
}
// admin + read-only fall through; each page enforces its own allow-list.
```

Then verify the admin-only pages (`kb/page.tsx:65`, `roles`, `integrations`, `inventory`, `conversations`, `erasure`) each still redirect read-only — `kb/page.tsx:67` currently sends non-admins to `/chat`; for read-only it should send to `/${lang}` (Home) to match the rest of RO-01. See CR-01-followup in WR-01. NOTE: this defect must be fixed together with WR-02 (KB viewer `listDocs` admin-gate) or the KB viewer will still 404 for read-only even after the layout is opened.

## Warnings

### WR-01: `kb/page.tsx` redirects `read-only` to `/chat` — inconsistent with RO-01 ("never chat; read-only is not a chat role")

**File:** `app/[lang]/(admin)/kb/page.tsx:65-68`
**Issue:** The KB *list* page (admin-only by design) sends all non-admins to `/${lang}/chat`. For a read-only user this both (a) contradicts the RO-01 invariant stated elsewhere ("read-only must never fall into chat" — `sign-in-form.tsx:93`, `layout.tsx:18-20`) and (b) once CR-01 is fixed and read-only can enter the group, read-only would be bounced to a chat surface it is not a member of. Same pattern in `kb/[docId]/page.tsx:105` and `integrations/page.tsx:83` for the read-only branch.
**Fix:** Route a verified-but-disallowed `read-only` to Home, not chat:
```ts
if (user.role !== 'admin') {
  redirect(user.role === 'read-only' ? `/${lang}` : `/${lang}/chat`)
}
```
(In `kb/[docId]/page.tsx` the read-only branch is already admitted, so this only applies to the list/integrations admin-only pages.)

### WR-02: KB version viewer fetches via `listDocs(user)`, which is `assertAdmin`-gated — read-only viewer 404s even when the route is reached

**File:** `app/[lang]/(admin)/kb/[docId]/page.tsx:111` → `src/kb/crud.ts:342-347`
**Issue:** The detail page admits `read-only` (line 104) and then loads the version chain with `allDocs = await listDocs(user)`. But `listDocs` calls `assertAdmin(user)` (crud.ts:343), which throws for read-only. The page swallows the throw (`catch { allDocs = [] }`), so `target` is never found and the page calls `notFound()` (line 119). Even after CR-01 is fixed, a read-only user opening `/kb/{id}` gets a 404 — the version-history viewer never renders. There is no read-only-capable list helper analogous to `listDocsForReview` (which is admin/coach only via `assertAdminOrCoach`).
**Fix:** Provide a read-path the read-only role can use without widening write authz. Options:
- Add a `listDocsForViewer(user)` to `src/kb/crud.ts` that asserts `admin | read-only` and returns id+metadata (no content/embedding) — the Firestore rules already permit read-only to read `kbDocs` (signed-in tenant read), so this is consistent with the rule layer; OR
- Have the detail page read `kbDocsRef()` directly under its own gate.
Keep `assertAdmin` on every mutating path (createDoc/updateDoc/deleteDoc/publish/unpublish) unchanged — do NOT widen those.

### WR-03: `getCorrectionEvalFeedback` orders `kbDocs` by `correctedBy` with a `!=` filter — likely-broken Firestore query / non-deterministic "recent" set

**File:** `app/[lang]/(coach)/dashboard/actions.ts:797-802`
**Issue:**
```ts
.where('correctedBy', '!=', null).orderBy('correctedBy', 'asc').limit(20)
```
Firestore's `!=` filter implicitly requires (and orders by) the filtered field first and **excludes documents where the field is absent** — most `kbDocs` have no `correctedBy` field at all (only correction versions set it), so this is the intended "only corrections" filter. But ordering by `correctedBy` (a UID string) `asc` and taking `limit(20)` returns corrections sorted by *contributor UID*, not recency — so "recent corrections" can systematically omit the newest corrections and is misleading (mirrors the WR-05 issue the team already fixed for the eval trend at lines 829-835, which is still open conceptually here). It also requires a composite-capable single-field index and will throw if `correctedBy` indexing is disabled.
**Fix:** `kbDocs` has `publishedAt` (a server timestamp). Order by that for true recency and keep the existence filter via inequality on `correctedBy` only if an index exists; simplest: drop the `!=`/orderBy coupling and filter in memory after an ordered read, or add a dedicated `isCorrection: true` boolean to index cleanly. At minimum order by `publishedAt desc` so "recent" means recent.

### WR-04: Home `usageRollups` read uses `.orderBy('day','asc')` with a `>=` range filter but no composite-index guarantee; silent empty Home on index error

**File:** `app/[lang]/page.tsx:113-116` (and the identical pattern at `usage/page.tsx:117-120`)
**Issue:** `.where('day','>=',windowStart).orderBy('day','asc')` is a range+orderBy on the same field (`day`) — that is index-clean by itself. But the surrounding `try/catch` swallows ALL errors into a silent empty state (`catch {}` → renders "no data"). If a future filter is added (or the single-field index is disabled), the Home KPIs silently read as zero with no signal to the operator — the same class of issue you flagged as the stale-watchdog's purpose. This is acceptable as graceful degradation but masks misconfiguration.
**Fix:** Keep the empty-state fallback, but log a non-PII server warning (`console.warn('home rollup read failed', { code })` — code only, never data) so an index/permission misconfig is observable. Do not log document contents.

## Info

### IN-01: `require-role.ts` is built, tested, and documented but unused — orphaned helper

**File:** `app/[lang]/_lib/require-role.ts` (entire file)
**Issue:** The centralized `requireRole({ lang, allowed, fallback })` gate was added (06-02) to replace the ~24 copy-pasted Pattern-A gates, but no production page/layout calls it — `layout.tsx`, `usage/page.tsx`, `kb/page.tsx`, `kb/[docId]/page.tsx`, `integrations/page.tsx` all still inline their own cookie→requireUser→redirect logic. The file's own header admits "no gate is rewired yet." This is the root cause that allowed CR-01: had the gates been routed through this single helper with explicit `allowed` lists, the read-only contradiction would have been caught in one place. The helper is correct (redirect outside try/catch per Pitfall 6; fail-closed rethrow). Recommend wiring it in (it would naturally fix CR-01: `usage` calls `requireRole({allowed:['admin','read-only'], fallback:'/${lang}'})`, `kb` list calls `requireRole({allowed:['admin']})`, etc.) or removing it. Note: it lives under `app/` and imports from `src/` (correct core/shell direction) — no violation.

### IN-02: Home alerts block reuses mismatched i18n labels for the two counters

**File:** `app/[lang]/_components/home-surface.tsx:186-197`
**Issue:** The "open stalls" counter is labelled `t('alertsTitle')` and the "knowledge gaps" counter is labelled `t('recentActivityTitle')` — the second counter shows the *Recent activity* section title as its caption, which is a copy bug (the gap count is captioned "Recent activity"). Cosmetic, not security.
**Fix:** Add dedicated keys (e.g. `home.openStallsLabel`, `home.knowledgeGapsLabel`) at trilingual parity and use them for the two counter captions.

### IN-03: `getFunnelV2Metrics` conflates "has lastActiveAt" with "active" — `activeAgents` undercounts

**File:** `app/[lang]/(coach)/dashboard/actions.ts:606-619`
**Issue:** `activeCount` is incremented only inside `if (profile.lastActiveAt)` and only when `daysDiff >= 0`. An agent with no `lastActiveAt` (e.g. provisioned but never active) is excluded from `activeAgents` but still counted in `totalAgents` and the stage map — the KPI semantics ("active = has any lastActiveAt within range") are not what the field name implies, and there is no recency ceiling (an agent last active 300 days ago still counts as "active"). Counts-only, no PII concern.
**Fix:** Either rename to `agentsWithActivity` or apply a recency window (e.g. `daysDiff <= 30`) consistent with the "active agents" definition used on Home/usage (which counts distinct uids in the rollup window).

---

_Reviewed: 2026-06-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
