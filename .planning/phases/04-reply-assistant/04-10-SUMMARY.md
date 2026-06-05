---
phase: 04-reply-assistant
plan: 10
subsystem: ui
tags: [recharts, firestore-aggregation, dashboard, analytics, reply, pdpa, next-intl, server-actions]

# Dependency graph
requires:
  - phase: 04-reply-assistant (Plan 01)
    provides: Wave-0 RED test scaffolds + the ADMIN-06 thumbs-down producer contract
  - phase: 04-reply-assistant (Plan 07)
    provides: replyEdits collection + replyEditsRef + (seniorCoachId,timestamp)/(agentUid,timestamp)/(sopDocIds CONTAINS,timestamp) indexes + captureReplyEdit producer (thumbsDown, editRatio, denormalized seniorCoachId)
  - phase: 04-reply-assistant (Plan 08)
    provides: dashboard.replyQuality.* i18n keys (en/ms/zh) seeded by the sole catalog owner
  - phase: 02-coach-admin
    provides: (coach)/dashboard surface + MetricsPanel recharts island + downline double-gate (AUTH-06) + getReplyQualityMetrics' getSessionUser pattern
provides:
  - Role-conditional Reply Quality dashboard panel (coach=downline, admin=org) on the existing (coach)/dashboard
  - getReplyQualityMetrics Server Action — read-time Firestore count() aggregation over replyEdits (per-SOP edit-rate, thumbs-down rate, top-edited SOP, escalation rate, drafts-per-agent)
  - WABA graduation gate doc (REPLY-12) — proposed criteria only, zero WABA code
affects: [phase-5-hardening, pilot-rollout, derek-kb-feedback-loop, waba-graduation-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-time Firestore count() aggregation for dashboard KPIs (no rollup job, D-20) — never fetch-all-then-count (Pitfall 9)"
    - "Role-conditional single-component analytics: one Server Action + one client island, scope toggled by verified-token role (D-22)"
    - "Documented graduation gate as a planning artifact (criteria only, thresholds marked Derek's-call), zero code"

key-files:
  created:
    - app/[lang]/(coach)/_components/reply-quality-panel.tsx
    - .planning/phases/04-reply-assistant/WABA-GATE.md
  modified:
    - app/[lang]/(coach)/dashboard/actions.ts
    - app/[lang]/(coach)/dashboard/page.tsx

key-decisions:
  - "Aggregation Server Action lives in dashboard/actions.ts (reachable via replyEditsRef per must_haves.key_links), called server-side from page.tsx — keeps the recharts island a pure presentational client component"
  - "Per-SOP edit-rate denominator = total copies citing the SOP (row-on-every-copy, Pitfall E); SOP id-set + distinct-agent set discovered via a sopDocIds/agentUid projection (ids only, no draft text/PII), then per-SOP numbers come from count() aggregations"
  - "WABA-GATE.md thresholds are PROPOSED placeholders explicitly deferred to Derek; sign-off checklist gates any future WABA scoping"

patterns-established:
  - "Pattern: scoped count() aggregation — a scopedQuery() closure applies seniorCoachId==uid for coaches / org-wide for admin, then countOf() runs .count().get() on it (DoS-safe, T-04-DASH-COST)"
  - "Pattern: reply-quality panel mirrors metrics-panel exactly (series colors #6366f1/#f59e0b, fontSize:12, margins, per-chart noData empty state) for visual consistency"

requirements-completed: [REPLY-11, ADMIN-06, REPLY-12]

# Metrics
duration: 5min
completed: 2026-06-05
---

# Phase 4 Plan 10: Reply Quality Analytics + WABA Gate Summary

**A role-scoped Reply Quality panel on the senior-coach dashboard (coach=downline, admin=org-wide) computed via read-time Firestore count() aggregation over replyEdits, plus a documented WABA graduation gate (criteria only, zero code) — closing the edit-as-signal feedback loop and the Phase-4 requirement set.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-05T13:36:25Z
- **Completed:** 2026-06-05T13:42:00Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 4 (2 created, 2 modified) + CLAIM.md + this SUMMARY

## Accomplishments

- **Reply Quality panel (REPLY-11/ADMIN-06):** one `reply-quality-panel.tsx` recharts client island (edit-rate-per-SOP LineChart with "trend down is good" subtitle, top-edited-SOP BarChart, KPI stat cards for thumbs-down rate / escalation rate / drafts-per-agent / top-edited SOP), rendered as a new `<section>` on the existing `(coach)/dashboard` — no new analytics route group.
- **Role-conditional aggregation (D-22):** `getReplyQualityMetrics` Server Action computes every metric with Firestore `count()` aggregation over `replyEdits`, scoped by `seniorCoachId == user.uid` for coaches (AUTH-06 double-gate copied verbatim) and org-wide for admin. Counts only — no draft content read or logged (T-04-DASH-PII); the read is audited.
- **Correct denominator (Pitfall E):** per-SOP edit-rate = `count(sopDocIds array-contains X AND editRatio>0) / count(sopDocIds array-contains X)`, leveraging Plan-07's row-on-every-copy write. Thumbs-down rate = `count(thumbsDown==true)/count(all)` — the 07→08→10 producer→UI→consumer chain confirmed (reads `thumbsDown == true`).
- **WABA graduation gate (REPLY-12):** `WABA-GATE.md` documents the bar to graduate past paste-and-draft (edit-rate<~25% over ≥4wk, zero wrong-client incidents, judge tone PASS≥90%, PDPA audit clean, min draft volume) with each criterion mapped to its data source and a Derek product+legal sign-off checklist. All thresholds marked PROPOSED. Zero WABA code, SDK, or scaffold.

## Task Commits

Each task was committed atomically:

1. **Task 1: Downline/org-scoped replyEdits aggregation + Reply Quality panel** - `406c8a9` (feat)
2. **Task 2: WABA-GATE.md graduation criteria (doc only)** - `1f4c6ab` (docs)

**Plan metadata:** (this SUMMARY + CLAIM.md update) committed separately by the docs commit below.

## Files Created/Modified

- `app/[lang]/(coach)/_components/reply-quality-panel.tsx` (created) — `'use client'` recharts island; edit-rate LineChart + top-edited BarChart + KPI stat cards; per-chart `replyQuality.noData` empty state; scope subtitle (downline/org). Mirrors `metrics-panel.tsx` colors/margins/fontSize.
- `app/[lang]/(coach)/dashboard/actions.ts` (modified) — added `getReplyQualityMetrics` Server Action + `computeEscalationRate` helper + `ReplyQualityMetrics`/`SopEditRate`/`ReplyQualityResult` types; imports `replyEditsRef`. Read-time `count()` aggregation, role-scoped, audited, counts-only.
- `app/[lang]/(coach)/dashboard/page.tsx` (modified) — server-fetch `getReplyQualityMetrics()` and render `<ReplyQualityPanel>` as a new section after MetricsPanel; scope falls back to the existing `adminAll` flag.
- `.planning/phases/04-reply-assistant/WABA-GATE.md` (created) — REPLY-12 documented gate (criteria only, zero code).

## Decisions Made

- **Aggregation in actions.ts, not a separate query module:** the plan's `must_haves.key_links` requires `replyEditsRef()` reachable from `dashboard/actions.ts` and the role/downline gate copied verbatim; placing the Server Action there (called server-side from page.tsx) satisfies both and keeps the recharts island purely presentational.
- **Projection read for the SOP id-set / distinct-agent set:** to group per-SOP edit-rate and compute drafts-per-agent without a fetch-all-then-count, the function runs `.select('sopDocIds')` / `.select('agentUid')` projections (ids only — never `originalDraft`/`editedFinal`) to enumerate the group keys, then the actual metric numbers come from `count()` aggregations. This keeps PII out (T-04-DASH-PII) and the metric math aggregate-based (T-04-DASH-COST).
- **Empty-state short-circuit:** when `totalDrafts == 0` the function returns escalation rate (its own collection) and zeroed reply KPIs, so the panel renders `replyQuality.noData` per chart without running per-SOP loops.

## Deviations from Plan

None of Rules 1–3 required code-behavior auto-fixes. Two honesty notes:

### Note 1 — No Wave-0 RED dashboard test existed to flip
The orchestrator prompt referenced "flip the Wave-0 RED dashboard test to GREEN," but no such test exists in the repo:
- The plan's `files_modified` declares no test file and its `<verify>` blocks are `typecheck && lint` (Task 1) and the WABA grep (Task 2) — there is no test-flip step in the plan tasks.
- The only dashboard test, `src/dashboard/dashboard.test.ts`, is the GREEN Phase-2 query/metrics test (unrelated to reply quality).
- The ADMIN-06 producer test `src/reply/reply-edit-actions.test.ts` was already flipped GREEN in Plan 04-07.

No RED test was therefore flipped. The full offline suite was re-confirmed to still exit 0 (525 passed | 107 skipped | 0 failed) — the success criterion "after this plan `npm run test` EXITS 0" holds.

### Note 2 — WABA-GATE.md prose reworded to satisfy the literal verify grep
The Task-2 verify includes `! grep -riE "waba.*sdk" WABA-GATE.md`. An initial disclaimer sentence ("no WABA code, SDK, webhook…") matched the `waba.*sdk` regex as a false-positive (the doc was *denying* WABA code). The sentence was reworded to "No WhatsApp Business API integration, library, webhook, or scaffold exists in v1…" — same meaning, no literal match. There is genuinely no WABA SDK/import/scaffold anywhere in the doc. (Tracked as a Rule-3-style wording adjustment; no behavior change.)

## Verification

- `npm run typecheck` (`tsc --noEmit`) — **exit 0**.
- `npx eslint` on the 3 touched source files — **exit 0** (0 errors, 0 warnings on touched files; pre-existing warnings in unrelated test files are out of scope).
- `npm run test` (offline vitest) — **exit 0** (525 passed | 107 skipped | 0 failed).
- Plan-08 `dashboard.replyQuality.*` keys present in `src/i18n/messages/en.json` — confirmed (`dash-keys-present`); catalogs NOT modified by this plan.
- `WABA-GATE.md` — exists (98 lines, min 25), contains `editRatio`/`edit-rate`, names `Derek`, and the no-WABA-SDK/import/scaffold grep returns nothing (`waba-doc-ok`).
- No worktree; on branch `phase-kayinleong-01`; not pushed.

### NOT verified (live-gated — honest disclosure)
- **No browser/UI verification.** The panel rendering, the per-chart empty state, the role-scoped subtitle (downline vs org), and the charts-with-data path were NOT clicked through — that requires a deployed, seeded Firebase stack with `replyEdits` data and coach/admin sessions. Verified statically only (tsc + lint + offline suite).
- **count() aggregation against live Firestore** (incl. the `(sopDocIds CONTAINS, editRatio)` query) was not run against a real index; the indexes are declared (Plan 07) but the `editRatio` range combined with `array-contains` may require an additional composite index at deploy — flag for the live index-deploy step.

## Self-Check: PASSED
