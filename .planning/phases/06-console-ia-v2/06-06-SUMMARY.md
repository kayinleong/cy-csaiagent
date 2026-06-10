---
phase: 06-console-ia-v2
plan: 06
subsystem: console-home
tags: [home-01, rsc-landing, per-role, usage-rollups, stale-watchdog, count-aggregation, least-privilege, no-new-pipeline, pitfall-6, t-06-18]

# Dependency graph
requires:
  - phase: 06-01
    provides: Wave-0 HOME RED stub intent (home-surface per-role block test scaffolded here as RED)
  - phase: 06-02
    provides: "'read-only' in the Role union + VALID_ROLES (so the landing + HomeSurface branch on it)"
  - phase: 06-04
    provides: read-only server gates + the Wave-3 interim landing (read-only → /usage) that this plan supersedes; usage/page.tsx rollup read path reused for KPIs/stale watchdog
  - phase: 06-05
    provides: home.* i18n surface block (title/subtitle*/keyMetricsTitle/alertsTitle/recentActivityTitle/quickActionsTitle/empty/stale) at en/ms/zh parity, consumed by HomeSurface
provides:
  - "app/[lang]/_components/home-surface.tsx: presentational per-role Home widget grid from serializable props (no data fetch); pure homeBlocksFor/shouldRenderStale/kpiCell helpers"
  - "app/[lang]/page.tsx: /${lang} is now the Home RSC landing for read-only|senior-coach|admin (composes usageRollups KPIs + scoped count() alerts); new-agent still → chat"
  - "read-only Home variant shows org usage/cost aggregates ONLY (no per-agent/PII); Alerts block hidden + never fetched for read-only (T-06-18)"
affects: [home-surface, landing-redirect, read-only-role]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RSC-composes-existing-reads: Home reuses the usage/page.tsx usageRollups read + stale-watchdog math and the dashboard/actions.ts count() scoping (adminAll vs seniorCoachId) — no new query, collection, write, or lazy-cron job"
    - "Pure decision helpers (homeBlocksFor/shouldRenderStale/kpiCell) exported from the 'use client' component so per-role/stale/empty branches are unit-testable WITHOUT @testing-library/react (not installed)"
    - "Defense-in-depth read-only PII suppression: the RSC never FETCHES stall/gap counts for read-only AND HomeSurface hides the Alerts block (two layers, mirrors Wave-3 per-agent suppression)"
    - "Redirect OUTSIDE try/catch (Pitfall 6): role resolved inside, every redirect() called after — new-agent→chat, no/invalid session→sign-in"

key-files:
  created:
    - app/[lang]/_components/home-surface.tsx
    - app/[lang]/_components/home-surface.test.ts
  modified:
    - app/[lang]/page.tsx

key-decisions:
  - "Created the Wave-0 HOME RED test here (it did not exist on disk): home-surface.test.ts is logic-only over the pure homeBlocksFor/shouldRenderStale/kpiCell helpers — the plan's Task-1 <files> lists the test as an output and @testing-library/react is not installed, so the prop-driven branch decisions are tested via pure exports rather than JSX rendering."
  - "Alerts COUNTS via Firestore count() (escalations status==open; knowledgeGaps) scoped adminAll-vs-seniorCoachId — never fetch-all. This composes the SAME scoping pattern as dashboard/actions.ts/computeEscalationRate without importing those 'use server' actions (they self-gate to senior-coach|admin and re-read the session cookie; the landing already has the verified user, so re-deriving the scoped count() inline avoids a redundant cookie round-trip while staying counts-only — no agentUid row is ever read)."
  - "read-only KPIs are the ORG usageRollups aggregates only (active agents, message volume, escalation rate, cache hit) — identical to the counts-only set the usage surface already exposes to read-only. No per-agent rows, no stall/gap fetch. T-06-18 satisfied at the read layer (never fetched) AND the render layer (Alerts hidden)."
  - "KPI tile labels are passed as plain English strings from the RSC (HomeKpi.label) rather than home.* i18n keys: the home.* block (06-05) provides section TITLES (keyMetricsTitle/alertsTitle/…) and the stale/empty/subtitle copy, but not per-KPI metric labels; reusing adminUsage.kpi* keys would require threading a second translation namespace into a client island. Kept the metric labels literal to avoid adding i18n keys outside this plan's scope (parity test stays GREEN); localizing individual KPI labels is a follow-on cosmetic, not a regression."
  - "Quick-action CTA copy is 'Open {section}' built in the component (UI-SPEC Copywriting Contract); the section label is supplied per-role by the RSC. read-only quick actions link ONLY to Usage & Cost + Knowledge Base (version-history viewer) per the UI-SPEC §3 read-only column."

# Metrics
metrics:
  duration: ~30m
  tasks_completed: 2
  files_modified: 1
  files_created: 2
  commits: 3
  completed: 2026-06-11
---

# Phase 6 Plan 06: Console IA v2 — Home Surface RSC Landing Summary

Turned `/${lang}` from a pure role-redirect into the **Home landing RSC** for the three console roles (read-only · senior-coach · admin), composed **entirely from existing aggregations** — the `usageRollups` read + stale-watchdog math borrowed from `usage/page.tsx`, plus `count()` open-stall / knowledge-gap alerts scoped exactly like `dashboard/actions.ts` (admin org-wide, coach `seniorCoachId == self`). No new query, collection, write, or lazy-cron job was introduced (CONTEXT lock). `new-agent` still redirects to `/chat`; no/invalid session → sign-in (redirect OUTSIDE try/catch, Pitfall 6). This supersedes the Wave-3 interim that sent read-only to `/usage`, and turns the Wave-0 HOME RED stub GREEN (HOME-01).

## What shipped

**Task 1 (`3aadb8c` RED, `2d5a464` GREEN) — per-role HomeSurface widget grid (HOME-01):**
- **NEW `app/[lang]/_components/home-surface.tsx`** — a presentational `'use client'` component rendering the per-role grid from plain serializable props (no data fetch). Layout matches the established console conventions verbatim: `container mx-auto max-w-6xl px-4 py-8`, `grid gap-8` sections, `grid gap-6 grid-cols-2 md:grid-cols-4` KPI tiles, reused `Card`/`Alert`/`Button` shadcn primitives.
  - **Section A — Key Metrics:** KPI Cards; empty rollups → the `home.empty` "No data yet" centered muted message and `—` em-dash tiles (the usage-dashboard pattern via `kpiCell`).
  - **Section B — Alerts:** open-stalls + knowledge-gaps counts as links to Escalations — rendered **only when `role !== 'read-only'`** (stalls/gaps reference `agentUid`; T-06-18).
  - **Section C — Recent activity:** org rollup-window summary lines.
  - **Section D — Quick actions:** Button-as-Link launcher tiles, "Open {section}" copy, per-role allowed sections.
  - Stale watchdog reused verbatim: the `home.stale` Alert renders when `staleWatchdog && latestRollupRelative`.
  - Exports pure helpers `homeBlocksFor(role)` / `shouldRenderStale(...)` / `kpiCell(...)` so the per-role / stale / empty branch decisions are unit-testable without JSX.
- **NEW `app/[lang]/_components/home-surface.test.ts`** — the Wave-0 HOME test (created here; absent on disk). Logic-only: asserts read-only omits the Alerts block while admin/coach keep it, the stale Alert gates on both flag + relative, and empty/zero KPIs render `—`. **6/6 GREEN.**

**Task 2 (`627bfa0`) — /${lang} renders Home for console roles (HOME-01):**
- **`app/[lang]/page.tsx`** rewritten as an async RSC:
  - Gate (Pattern A): `await cookies()` → `__session` → `requireUser` (role from the VERIFIED token, T-06-19). Role resolved INSIDE try/catch; **every `redirect()` OUTSIDE** (Pitfall 6).
  - `new-agent` → `/${lang}/chat`; any non-console role / no session → `/${lang}/sign-in`.
  - `read-only | senior-coach | admin` → renders `<HomeSurface .../>` with role-scoped, counts-only props.
  - **usageRollups read** (the pre-aggregated rollup collection, NEVER raw per-event telemetry — HR-7): org KPIs (active agents, message volume, escalation rate, cache hit) + stale-watchdog (`>25h` → relative label), computed exactly as `usage/page.tsx`.
  - **Alerts** (coach/admin ONLY): `count()` of open escalations + knowledge gaps, scoped `adminAll` vs `seniorCoachId == uid` — never fetch-all, never reads an `agentUid`-bearing row. **read-only never enters this branch.**
  - No write, no `FieldValue`, no new collection, no new lazy-cron — Home is strictly read-only composition.

## Verification

- `npx vitest run app/[lang]/_components/home-surface.test.ts` → **6/6 GREEN** (was 1 RED file at baseline — module absent).
- `npx vitest run src/i18n/__tests__/i18n-parity.test.ts` → **6/6 GREEN** (stayed GREEN; no new keys added).
- `npx tsc --noEmit` → **0 errors**.
- Task-1 grep gates on `home-surface.tsx`: `HomeSurfaceProps` ✓, `role !== 'read-only'` ✓, `max-w-6xl` ✓, `usageEvents` → **0 hits** ✓.
- Task-2 grep gates on `page.tsx`: `HomeSurface` ✓, `read-only` ✓, `usageEvents` → **0 hits** ✓, `setDoc|addDoc|.set(|.create(|FieldValue` → **0 hits** ✓, ``redirect(`/${lang}/chat`)`` ✓.
- Full suite: `npx vitest run` → **586 passed / 12 failed / 168 skipped**. Passing rose 580 → 586 (+6, the new Home test). The **12 failures are EXACTLY the two pending Wave-4 RED stubs this plan does not own** (unchanged from the pre-plan baseline):
  - `app/[lang]/(admin)/integrations/integrations-shell.test.ts` (8) → owned by plan **06-07**.
  - `app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts` (4) → owned by plan **06-08**.
  - **No NEW failures introduced.** The flaky reply timeout did not fire this run.

## Deviations from Plan

### Structural (test-contract-driven)

**1. [Rule 3 - Blocking] Created the Wave-0 HOME test (it did not exist on disk)**
- **Found during:** Task 1 (the plan's `<read_first>` and Task-1 `<files>` reference `home-surface.test.ts` as the Wave-0 stub to "turn GREEN", but no such file existed in the repo).
- **Issue:** Without the test there is no RED bar to drive the TDD cycle and no binding acceptance for the per-role block decisions.
- **Fix:** Authored `home-surface.test.ts` as the RED stub (committed separately, `3aadb8c`), then made it GREEN with the component. Logic-only over the pure `homeBlocksFor`/`shouldRenderStale`/`kpiCell` exports — `@testing-library/react` is not installed (06-PATTERNS "No Analog Found"), so prop-driven branches are tested via pure helpers exactly as the plan's Task-1 action prescribed.
- **Files:** `home-surface.test.ts` (new).
- **Commits:** `3aadb8c` (RED), `2d5a464` (GREEN).

### Scope-preserving choices

**2. [Rule 3 - Blocking] Inline scoped count() for alerts instead of importing the dashboard 'use server' actions**
- **Issue:** `dashboard/actions.ts` exposes `getFunnelV2Metrics`/`getKnowledgeGapAggregation` etc., but each is a `'use server'` action that self-gates to `senior-coach|admin` and re-reads the session cookie. The landing RSC already holds the verified user; the action's open-stall/gap COUNT is not a standalone export.
- **Fix:** Re-derived the open-stall (`status == open`) + knowledge-gap counts inline via the SAME `count()` scoping pattern (`adminAll` vs `seniorCoachId == uid`) used in `dashboard/actions.ts`/`computeEscalationRate` — counts-only, no `agentUid` row ever read, run for coach/admin ONLY. This composes the existing aggregation shape without a redundant cookie round-trip or duplicating panel logic. No new query type or collection.
- **Files:** `page.tsx`.
- **Commit:** `627bfa0`.

### Deferred (non-regression cosmetic)

**3. Per-KPI metric labels left as literal English strings**
- The `home.*` i18n block (added by 06-05) supplies the section titles and the stale/empty/subtitle copy, but not per-KPI metric labels (Active agents / Message volume / …). Localizing individual KPI labels would mean threading a second translation namespace (`adminUsage.kpi*`) into the client island and/or adding keys outside this plan's scope. KPI labels are passed as plain strings from the RSC; the parity test stays GREEN. This is a follow-on cosmetic, not a regression (the surrounding chrome — title, subtitle, section headings, stale/empty copy, quick-action CTA — is fully localized).

## Threat surface

No new network endpoints, schema changes, writes, or lazy-cron jobs. Home is a strictly read-only composition of existing reads.
- **T-06-18 (Information Disclosure, read-only variant):** MITIGATED at two layers — the RSC never fetches the stall/gap `count()` for read-only (those reads scope on `seniorCoachId`/`agentUid`), and `HomeSurface` hides the Alerts block for read-only. read-only props come ONLY from org `usageRollups` (counts-only by schema). Grep confirms 0 `usageEvents` reads.
- **T-06-19 (Spoofing/EoP, Home gate):** MITIGATED — role from the verified token via `requireUser`; `new-agent` redirected to chat; redirect OUTSIDE try/catch (Pitfall 6).
- **T-06-20 (new-pipeline temptation):** ACCEPTED/held — grep confirms 0 writes / 0 `FieldValue` in `page.tsx`; no new collection or job.

No threat flags raised.

## Self-Check: PASSED

- `app/[lang]/_components/home-surface.tsx` — FOUND.
- `app/[lang]/_components/home-surface.test.ts` — FOUND (6/6 GREEN).
- `app/[lang]/page.tsx` — FOUND (modified, renders HomeSurface).
- Commit `3aadb8c` (Task 1 RED) — FOUND.
- Commit `2d5a464` (Task 1 GREEN) — FOUND.
- Commit `627bfa0` (Task 2) — FOUND.
