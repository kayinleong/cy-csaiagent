---
phase: 07-console-ia-v2-net-new-surfaces
plan: 06
subsystem: ui
tags: [navigation, i18n, trilingual, analytics, next.js, server-components, role-filter, days-to-first-close]

# Dependency graph
requires:
  - phase: 07-03
    provides: "agents index route /[lang]/agents + agentProfile surface + daysToFirstClose/aggregateDaysToFirstClose read-time helpers"
  - phase: 07-04
    provides: "flags route /[lang]/flags (flagged-conversation review queue) + flagQueue i18n namespace"
  - phase: 07-05
    provides: "model-config / audit-log / pdpa-settings admin routes (adminModelConfig/adminAuditLog/adminPdpa namespaces consumed here)"
  - phase: 07-01
    provides: "Wave-0 app-sidebar-nav.test.ts NAV-01 RED scaffold + i18n-parity.test.ts gate"
  - phase: 06
    provides: "6-section app-sidebar-nav.ts model + visibleSectionsForRole role-filter + read-only least-privilege lock"
provides:
  - "8 role-filtered Phase-7 nav entries across 4 Phase-6 sections (read-only blind, D-24)"
  - "Full trilingual catalogs (en/ms/zh) for all 8 nav labels + 7 surface namespaces — parity GREEN"
  - "getOrgDaysToFirstClose() — read-time org/cohort days-to-first-close aggregate (no new pipeline, D-22)"
  - "days-to-first-close avg/median/count tile in the Analytics & Performance usage dashboard (#days-to-first-close anchor)"
affects: [phase-gate, rollout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nav filtering is UX-only: the 8 new NavItem roles arrays drive visibility; the server-side requireRole() page gate + Firestore rules are the authorization boundary (D-24)"
    - "Read-time org aggregate over agentProfiles (createTime = onboardingStart, Pitfall 4 zero-migration) folded through the existing daysToFirstClose + aggregateDaysToFirstClose — no stored metric, no lazy-cron (D-22)"
    - "Trilingual parity enforced by key-set equality (i18n-parity.test.ts): every new key authored in all three catalogs simultaneously; BM/中文 machine-assisted to parity awaiting native sign-off (carried gate)"

key-files:
  created:
    - ".planning/phases/07-console-ia-v2-net-new-surfaces/07-06-SUMMARY.md"
  modified:
    - "app/[lang]/_components/app-sidebar-nav.ts"
    - "src/i18n/messages/en.json"
    - "src/i18n/messages/ms.json"
    - "src/i18n/messages/zh.json"
    - "src/dashboard/queries.ts"
    - "app/[lang]/(admin)/usage/page.tsx"
    - "app/[lang]/(admin)/usage/usage-dashboard.tsx"

key-decisions:
  - "agentProfiles href = /[lang]/agents (the 07-03 index route), NOT the [uid]-only drill-in — keeps the nav entry off a dead link; the index rows deep-link to agents/[uid]"
  - "daysToFirstClose nav entry hrefs /[lang]/usage#days-to-first-close (anchors into the existing Analytics dashboard) rather than a new route — CLOSE-02 is presentation-only"
  - "getOrgDaysToFirstClose computed admin-only in page.tsx (the aggregate section is admin-gated, read-only never reaches it) — read-only viewers get the empty aggregate and the dashboard hides the section"

metrics:
  duration: ~8m
  completed: 2026-06-11
---

# Phase 7 Plan 06: Console IA v2 — Net-New Surface Wiring + Trilingual Parity Summary

Wired the 8 Phase-7 net-new surfaces into the Phase-6 6-section sidebar as role-filtered nav entries (read-only blind), authored every new nav + surface string trilingually to enforced parity, and rendered the days-to-first-close org aggregate tile in the Analytics & Performance usage dashboard — closing NAV-01, I18N-07, and the presentation half of CLOSE-02.

## What Was Built

**Task 1 — 8 role-filtered nav entries (NAV-01 / D-25 / D-24).** Extended `NavItemKey` and `buildSections` in `app/[lang]/_components/app-sidebar-nav.ts` with 8 new items placed under the correct sections:
- Agents & Cohorts: `cohorts` (admin), `agentProfiles` → `/[lang]/agents` (admin + senior-coach), `coachAssignment` (admin)
- Conversations & Escalations: `flags` (admin + senior-coach)
- System & Compliance: `auditLog`, `modelConfig`, `pdpaSettings` (all admin)
- Analytics & Performance: `daysToFirstClose` → `/[lang]/usage#days-to-first-close` (admin)

None list `'read-only'` — read-only sees zero of the 8 (D-24). Turns the Wave-0 NAV-01 RED scaffold GREEN (8/8 specs).

**Task 2 — Trilingual catalogs + days-to-first-close tile (I18N-07 / CLOSE-02).** Added 8 `nav.*` labels, 7 surface namespaces (`adminCohorts`, `adminCoachAssignment`, `agentsIndex`, `agentProfile`, `adminModelConfig`, `adminAuditLog`, `adminPdpa`), and 6 `adminUsage` daysToClose keys to all three catalogs (en/ms/zh) — every key consumed by the Wave-2 surface components is now resolvable, with parity GREEN. Added `getOrgDaysToFirstClose()` (read-time aggregate over `agentProfiles`, reusing the 07-03 `daysToFirstClose` + `aggregateDaysToFirstClose`) and an avg/median/count tile in `usage-dashboard.tsx` anchored at `#days-to-first-close`, em-dash when no close, admin-only section.

## Deviations from Plan

None — plan executed exactly as written. Authorized scope additions:
- **[Rule 2 — missing critical functionality] `getOrgDaysToFirstClose()` data source.** The plan's tile reads from `daysToFirstClose` in queries.ts, but the existing per-agent `getAgentProfile` only computes a single agent's value; no org/cohort aggregate query existed. Added `getOrgDaysToFirstClose()` (read-time only, no new pipeline — honors D-22) so the Analytics tile has a real org aggregate to render. Reuses the existing exported `daysToFirstClose` + `aggregateDaysToFirstClose` (no new math). Computed admin-only (the section is admin-gated). Committed in `968abe0`.

## Authentication Gates

None.

## Final-Wave Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Type-check | `npx tsc --noEmit` | **Clean** (exit 0) |
| i18n parity | `vitest run i18n-parity.test.ts` | **GREEN** (6/6) — en/ms/zh identical key sets |
| Nav contract | `vitest run app-sidebar-nav.test.ts` | **GREEN** (8/8) — incl. Phase-7 placement + read-only blindness |
| Full suite | `npx vitest run` | **638 passed, 186 skipped, 1 flaky-timeout** (see note) |
| Build | `npx next build` | **Compiles** — 26 route entries, 63 static pages; all 8 Phase-7 routes present (`/agents`, `/audit-log`, `/coach-assignment`, `/cohorts`, `/flags`, `/model-config`, `/pdpa-settings`, `/usage`) |

**Flaky-timeout note (out of scope):** `src/agents/reply/reply.test.ts > "...non-empty sopDocIds"` timed out at 5000ms under full-suite parallel load (full-run import time 31.8s). Re-run in isolation it passes in 716ms (13/13). It is a Phase-4 reply-agent test that references none of this plan's files — pre-existing parallel-load flakiness, not a regression. No emulator-gated rules suites were red beyond the expected live-gated skips (186 skipped).

## Manual Gate (carried to phase gate)

BM / 中文 native sign-off on the 8 surfaces' copy. EN is the UI-SPEC source; BM + 中文 were authored to parity (machine-assisted draft per the ms/zh `_note` marker, D-08) and await native review before production.

## Known Stubs

None. All 8 nav entries resolve to live Wave-2 routes (verified in the build route list); all new i18n keys map to keys actually consumed by the surface components; the days-to-first-close tile is wired to a real read-time aggregate.

## Self-Check: PASSED

- `app/[lang]/_components/app-sidebar-nav.ts` — FOUND (8 new NavItemKey entries)
- `src/i18n/messages/{en,ms,zh}.json` — FOUND (parity GREEN at +49 keys/catalog)
- `src/dashboard/queries.ts` — FOUND (`getOrgDaysToFirstClose`)
- `app/[lang]/(admin)/usage/usage-dashboard.tsx` — FOUND (`daysToFirstClose` tile)
- Commit `a75c903` (Task 1 nav) — FOUND
- Commit `968abe0` (Task 2 catalogs + tile) — FOUND
