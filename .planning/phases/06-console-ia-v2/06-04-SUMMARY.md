---
phase: 06-console-ia-v2
plan: 04
subsystem: auth
tags: [rbac, read-only-role, server-gates, role-assignment, pitfall-3, pitfall-4, pitfall-6, least-privilege, pdpa]

# Dependency graph
requires:
  - phase: 06-01
    provides: Wave-0 RED stubs (gate-redirect contract, read-only assignRole Forbidden case)
  - phase: 06-02
    provides: "'read-only' in Role union + VALID_ROLES + AssignableRole; requireRole({lang,allowed,fallback}) helper"
  - phase: 06-03
    provides: read-only Firestore-rules deny matrix (the SECOND boundary behind these server gates)
provides:
  - read-only landing routed to /usage (page.tsx + sign-in-form.tsx); never chat/dashboard
  - "(admin)/layout.tsx redirects read-only to Home (not chat); still denies every admin page"
  - "(admin)/usage page gate + backing usageRollups read widened to admit read-only (Pitfall 3); per-agent breakdown hidden for read-only (no PII)"
  - role-assignment UI offers read-only (ALL_ROLES + capViewAnalytics matrix row + Select option + outline badge)
  - "listUsersWithRoles read-only Forbidden test added alongside the existing assignRole Forbidden case"
  - adminRoles.roleReadOnly + adminRoles.capViewAnalytics i18n keys (en/ms/zh parity)
affects: [06-05, 06-06, 06-07, 06-08, home-surface, sidebar-IA, kb-version-viewer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern A adaptation: widen a per-surface role branch to an explicit allow-list (admin + read-only) ONLY where the matrix permits; KEEP-deny everywhere else"
    - "Pitfall 3 satisfied with a single RSC gate: the usageRollups read runs AFTER the page gate, so widening the gate widens the read path (no separate Server Action to widen)"
    - "Read-only PII suppression: per-agent rows emptied server-side AND the section hidden client-side (defense-in-depth, never serialize agent UIDs to a read-only viewer)"

key-files:
  created: []
  modified:
    - app/[lang]/page.tsx
    - app/[lang]/(auth)/sign-in/sign-in-form.tsx
    - app/[lang]/(admin)/layout.tsx
    - app/[lang]/(admin)/usage/page.tsx
    - app/[lang]/(admin)/usage/usage-dashboard.tsx
    - app/[lang]/(admin)/roles/role-assignment.tsx
    - app/[lang]/(admin)/roles/actions.test.ts
    - src/i18n/messages/en.json
    - src/i18n/messages/ms.json
    - src/i18n/messages/zh.json

key-decisions:
  - "Read-only lands on /usage this wave (not /${lang}); /${lang} is still a pure redirect until Wave 4 HOME-01 makes it render Home. Documented as a Wave-4 dependency."
  - "Admin layout uses an in-place 3-way role branch (coach→dashboard, read-only→Home, else→chat) rather than requireRole() — requireRole's single `fallback` cannot express three distinct targets; the existing 3-role behavior is preserved verbatim, read-only is purely additive."
  - "Usage RSC: widening the gate widens the read path (no separate Server Action). Per-agent rows emptied for read-only server-side + section hidden client-side (CONTEXT: read-only sees org usage/cost only, no per-agent PII) — Rule 2 correctness addition."
  - "Added adminRoles.roleReadOnly + capViewAnalytics to all three i18n catalogs now (Rule 2): the new matrix column + Select option reference these via t(...); without them the role UI would render raw keys. Wave 4's i18n catalog task subsumes the broader nav/home keys."

# Metrics
metrics:
  duration: ~30m
  tasks_completed: 2
  files_modified: 10
  commits: 2
  completed: 2026-06-11
---

# Phase 6 Plan 04: Read-only Server Gates + Role-Assignment UI Summary

Wired the `read-only` role into the server-side gates it is allowed to reach (Home landing → `/usage`, Analytics/usage page + its `usageRollups` read path) and kept it server-denied everywhere else, then surfaced `read-only` as an assignable, analytics-read-only tier in the role-assignment UI. The existing three roles' behavior is byte-for-byte preserved; read-only admission is purely additive.

## What shipped

**Task 1 (`1446b2f`) — widen read-only-allowed gates, KEEP-deny the rest (RO-02 / RO-04):**
- `app/[lang]/page.tsx`: read-only branch redirects to `/${lang}/usage` (analytics landing), `redirect()` OUTSIDE the try/catch (Pitfall 6). admin/coach→dashboard, new-agent→chat unchanged.
- `app/[lang]/(auth)/sign-in/sign-in-form.tsx`: read-only routes to `/usage` before the `else→chat` fallback, so read-only never lands on chat.
- `app/[lang]/(admin)/layout.tsx`: read-only redirected to Home (`/${lang}`), not chat; the layout still DENIES every admin page (read-only renders only pages whose own gate admits it).
- `app/[lang]/(admin)/usage/page.tsx`: gate widened `!== 'admin'` → `!== 'admin' && !== 'read-only'` (fallback `/${lang}`). The RSC reads `usageRollups` after the gate, so the read path is widened with it (Pitfall 3). Per-agent rows emptied server-side for read-only.
- `app/[lang]/(admin)/usage/usage-dashboard.tsx`: takes `role`; hides the per-agent breakdown section for read-only (org aggregates still render).

**Task 2 (`b10d9b0`) — read-only in the role-assignment UI (RO-05):**
- `role-assignment.tsx`: `'read-only'` added to `ALL_ROLES`; a `capViewAnalytics` capability row (`['admin','read-only']`) with NO write/manage/erasure/assign capability; a read-only matrix column header; a `<SelectItem value="read-only">`; `outline` badge.
- `roles/actions.test.ts`: added a `listUsersWithRoles` read-only Forbidden case next to the existing `assignRole` read-only Forbidden case (no self-escalation / no recon surface).
- `src/i18n/messages/{en,ms,zh}.json`: `adminRoles.roleReadOnly` + `adminRoles.capViewAnalytics` (parity preserved).

`assignRole` / `listUsersWithRoles` gates were NOT widened — they stay `if (user.role !== 'admin') return Forbidden`. `AssignableRole` already included `'read-only'` from Wave 1, so an admin can target it while read-only cannot self-assign.

## RESEARCH "Role-branch sites" checklist — admit vs KEEP-deny (the acceptance gate)

| Site | Decision | Proof |
|------|----------|-------|
| `page.tsx` landing redirect | ADMIT (→ `/usage`) | `read-only` branch present; redirect outside try/catch |
| `sign-in-form.tsx` redirect | ADMIT (→ `/usage`) | `read-only` branch before `else→chat` |
| `(admin)/layout.tsx` gate | ADMIT to redirect target (→ Home), DENY admin pages | 3-way branch; read-only never reaches an admin page |
| `(admin)/usage/page.tsx` gate + `usageRollups` read | ADMIT (page + backing read; Pitfall 3) | `!== 'admin' && !== 'read-only'`; per-agent rows emptied |
| `usage-dashboard.tsx` per-agent table | DENY data to read-only (PII) | `showPerAgent = role !== 'read-only'` |
| `(coach)/layout.tsx` gate | KEEP-deny (downline PII) | 0 read-only role tokens in code |
| `(admin)/kb/page.tsx` gate | KEEP-deny (KB management) | 0 read-only role tokens in code |
| `(admin)/kb/[docId]/page.tsx` gate | KEEP-deny (Wave-4 widen target) | 0 read-only role tokens in code |
| `(admin)/inventory/page.tsx` gate | KEEP-deny | 0 read-only role tokens in code |
| `(admin)/conversations/page.tsx` gate | KEEP-deny (PII) | gate `!== 'admin'`; only legacy "read-only surface" doc comments |
| `(admin)/roles/page.tsx` gate | KEEP-deny | gate `!== 'admin'`; only a legacy "read-only matrix" doc comment |
| `(admin)/erasure/page.tsx` gate | KEEP-deny | 0 read-only role tokens in code |
| `roles/actions.ts` assignRole / listUsersWithRoles | KEEP-deny (no self-escalation) | both gates `!== 'admin'`; read-only only in the `AssignableRole` type + a UserWithRole comment |
| `conversations/actions.ts` | KEEP-deny | 0 read-only tokens |
| `erasure/actions.ts` (3 actions) | KEEP-deny | 0 read-only tokens |
| `dashboard/actions.ts` (8 actions) | KEEP-deny (downline PII) | 0 read-only tokens |
| `src/kb/crud.ts` assertAdmin / assertAdminOrCoach | KEEP-deny | 0 read-only tokens |
| `roles/role-assignment.tsx` (UI) | ADMIT as assignable + analytics-read matrix | ALL_ROLES + capViewAnalytics + SelectItem |

Every checklist entry visited. Read-only is admitted ONLY to Home(→usage) + usage analytics; KEEP-deny everywhere else, grep-provable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Hide the per-agent breakdown from read-only (PDPA / Pitfall 3 nuance)**
- **Found during:** Task 1
- **Issue:** `usage-dashboard.tsx` renders a per-agent table keyed on agent UIDs. The matrix + CONTEXT lock read-only to "org usage/cost only — no per-agent, no PII." A naive gate widen (page-only) would have rendered agent UIDs to a read-only stakeholder — a PII leak.
- **Fix:** Passed the verified `role` into the dashboard; emptied `perAgentRows` server-side for read-only AND hid the whole per-agent section client-side (defense-in-depth). Org KPIs, volume trend, and pillar token spend (counts-only aggregates) still render.
- **Files modified:** `app/[lang]/(admin)/usage/page.tsx`, `app/[lang]/(admin)/usage/usage-dashboard.tsx`
- **Commit:** `1446b2f`

**2. [Rule 2 - Missing critical functionality] Add adminRoles.roleReadOnly + capViewAnalytics to all three i18n catalogs**
- **Found during:** Task 2
- **Issue:** The plan said to reference `t('roleReadOnly')` / `t('capViewAnalytics')` and let Wave 4 add the catalog keys. But these keys did not exist in any catalog; next-intl would render the raw key (a broken label) in the production role-assignment UI now that the column + Select option are live.
- **Fix:** Added both keys to en/ms/zh (parity verified, key-sets identical). Wave 4's broader i18n catalog task (nav sections, home strings) is unaffected.
- **Files modified:** `src/i18n/messages/{en,ms,zh}.json`
- **Commit:** `b10d9b0`

**3. [Rule 3 - Test strengthening] Add a listUsersWithRoles read-only Forbidden case**
- **Found during:** Task 2
- **Issue:** The plan asked to "assert or confirm" that `listUsersWithRoles` Forbids a read-only caller; only `assignRole` had an explicit read-only case.
- **Fix:** Added an explicit `listUsersWithRoles` read-only Forbidden test (T-06-13 — no escalation-recon surface). Suite went 6→7 passing in that file.
- **Files modified:** `app/[lang]/(admin)/roles/actions.test.ts`
- **Commit:** `b10d9b0`

### Acceptance-criterion note (not a code deviation)

Task 1 acceptance specifies `grep -n "read-only" conversations/page.tsx roles/page.tsx` should return 0 hits. Those files contain pre-existing v1 doc comments using the phrase "read-only surface/viewer" (e.g. "admin conversation viewer — read-only"), which match the literal token. The criterion's INTENT — no read-only ROLE admission — is satisfied: a code-only grep (`'read-only'`/`"read-only"` excluding `*` comment lines) returns **0** in every KEEP-deny gate, and each gate is verifiably `if (user.role !== 'admin') redirect(...)`. Pre-existing comments were left untouched (SCOPE BOUNDARY — out of scope for this wave).

## Verification

- `npx tsc --noEmit`: **0 errors**.
- `npx vitest run` (whole offline suite): **575 passed / 17 failed / 168 skipped**. Baseline before this plan was 574 passed / 17 failed — i.e. **+1 pass (my new listUsersWithRoles case), 0 NEW failures**. The 17 failures are EXACTLY the known Wave-4-pending RED stubs:
  - `app/[lang]/_components/app-sidebar-nav.test.ts` (sidebar IA → lands in plan 05)
  - `app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts` (per-coach pivot → plan 07)
  - `app/[lang]/(admin)/integrations/integrations-shell.test.ts` (integrations shell → plan 08)
- The known-flaky `src/agents/reply/reply.test.ts` timeout passed on both baseline and final runs.
- Gate-relevant suites all green: `roles/actions.test.ts` (7), `role-helper.test.ts`, `auth.test.ts`, `conversations/actions.test.ts`.
- Regression self-audit: existing 3-role routing preserved verbatim across all four widened gates (admin/coach→dashboard, new-agent→chat, no-session→sign-in unchanged); usage admin behavior identical (per-agent table still shown for admin).

Rules-layer (Wave 2/06-03) deny matrix remains the second, independent boundary — not re-run here (emulator-gated; runs at wave merge).

## Threat Flags

None — no new network endpoint, auth path, or trust-boundary schema introduced. All changes are role-branch widenings within existing verified-token gates; the read-only analytics read is `usageRollups` (counts-only aggregates, already in the Wave-2 threat model).

## Self-Check: PASSED

- SUMMARY file: `.planning/phases/06-console-ia-v2/06-04-SUMMARY.md` — FOUND (this file).
- Commit `1446b2f` (Task 1) — present in `git log`.
- Commit `b10d9b0` (Task 2) — present in `git log`.
- All 10 modified files present in their respective commits (verified via `git show --stat`).
- STATE.md / ROADMAP.md — untouched (not staged, not committed). Nothing pushed.
