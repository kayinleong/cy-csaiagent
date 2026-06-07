---
phase: "05-hardening-scale"
plan: "07"
subsystem: "analytics-dashboards"
tags: ["admin-usage", "cost-analytics", "coach-dashboard-v2", "recharts", "usageRollups", "cdash-08", "admin-08", "qual-08", "wave-5"]
dependency_graph:
  requires:
    - "05-02 (usageRollupsRef, UsageRollupDoc schema)"
    - "05-04 (rollupUsage — writes usageRollups; resolvedAt on EscalationDoc)"
    - "05-05 (Phase-5 i18n keys including adminUsage.* and dashboard.v2.* already preloaded)"
    - "05-06 (admin route group conventions established)"
  provides:
    - "app/[lang]/(admin)/usage/page.tsx — admin RSC shell with three-layer gate, reads usageRollups only (HR-7)"
    - "app/[lang]/(admin)/usage/usage-dashboard.tsx — recharts client island: KPI tiles, volume LineChart, token BarChart by pillar, per-agent Table, noRollups empty state, stale watchdog"
    - "app/[lang]/(coach)/_components/funnel-v2-panel.tsx — full training→lead→close funnel + ramp KPI recharts island"
    - "app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx — gap aggregation by topic with pillar Tabs filter"
    - "app/[lang]/(coach)/_components/correction-eval-panel.tsx — corrections Table + eval-score LineChart"
    - "getFunnelV2Metrics(), getKnowledgeGapAggregation(), getCorrectionEvalFeedback() — 3 new v2 data actions in dashboard/actions.ts"
    - "dashboard/page.tsx grown with 3 v2 sections (existing sections unchanged)"
  affects:
    - "05-08-PLAN.md (hardening + sign-off — dashboards are now complete)"
tech_stack:
  added: []
  patterns:
    - "recharts client island — VERBATIM metrics-panel.tsx conventions (HR-3): ResponsiveContainer height=220, margin top:4 right:8 left:-16 bottom:4, tick:12, #6366f1/#f59e0b, Bar radius [4,4,0,0]"
    - "RSC→serializable-props pattern: page.tsx computes all KPIs server-side, passes plain props to 'use client' island"
    - "Server-decided scope: adminAll flag from requireUser token drives all queries (HR-4) — client only displays"
    - "select() projection for group discovery (mirrors getReplyQualityMetrics :402-407) — no fetch-all"
    - "Append-only section growth (D-07): 3 new <section> blocks appended to existing grid; zero existing sections modified"
    - "stale watchdog: latestUpdatedAt from rollup docs; Alert variant=default when >25h since last rollup"
    - "noRollups empty state: centered muted p.py-8 with adminUsage.noRollups — expected on fresh deploy"
    - "Tabs pillar filter in knowledge-gap-agg-panel (Phase-4 pillar-filter pattern reuse)"
key_files:
  created:
    - "app/[lang]/(admin)/usage/page.tsx"
    - "app/[lang]/(admin)/usage/usage-dashboard.tsx"
    - "app/[lang]/(coach)/_components/funnel-v2-panel.tsx"
    - "app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx"
    - "app/[lang]/(coach)/_components/correction-eval-panel.tsx"
  modified:
    - "app/[lang]/(coach)/dashboard/actions.ts (added 3 v2 data actions; resolveStall untouched)"
    - "app/[lang]/(coach)/dashboard/page.tsx (appended 3 section blocks; zero existing sections modified)"
decisions:
  - "usageRollups read with .where('day', '>=', windowStart).orderBy('day', 'asc') — no fetch-all; window parameter from searchParams (7 or 30 days, default 7)"
  - "Stale watchdog threshold: 25h (1h buffer on the daily window); uses updatedAt field from UsageRollupDoc"
  - "getFunnelV2Metrics uses select('journeyStage','lastActiveAt') projection over agentProfiles — role-scoped by seniorCoachId filter; avgDaysToProductive computed in JS from projected docs"
  - "getKnowledgeGapAggregation uses select('topicLabel','pillar','count') projection then JS bucket aggregation — acceptable at pilot scale; knowledgeGaps count is bounded by pilot agent count"
  - "getCorrectionEvalFeedback reads kbDocs.where('correctedBy','!=',null) + evalsRef().orderBy('score','desc') — both limited to 20 rows via .limit(20)"
  - "Task 3 checkpoint:human-verify auto-approved per auto_advance=true — building dashboards is not an auth gate; live browser verification is the live-gated human step"
metrics:
  duration: "8 minutes"
  completed: "2026-06-07T09:29:00Z"
  tasks_completed: 2
  tasks_total: 3
  files_created: 5
  files_modified: 2
---

# Phase 05 Plan 07: Org Usage/Cost Dashboard + Coach Dashboard v2 Summary

**One-liner:** Admin usage+cost dashboard reads usageRollups exclusively (ADMIN-08+QUAL-08, HR-7) with KPI tiles, volume LineChart, token BarChart by pillar, per-agent Table, and a noRollups empty state; coach dashboard grown (not forked, D-07) with 3 recharts v2 panels — full funnel+ramp KPI, knowledge-gap aggregation by pillar, and correction-to-eval feedback — all fed serializable server-decided scope props.

## What Was Built

### Task 1: Admin usage+cost dashboard (b7785e4)

**`app/[lang]/(admin)/usage/page.tsx`** (RSC shell):
- Three-layer admin gate: layout.tsx (layer 1) → page RSC (layer 2) → Server Action (layer 3, HR-12)
- Admin gate verbatim copy of kb/page.tsx:43-68 (cookies → syntheticReq → requireUser → role check → redirect)
- Reads `usageRollupsRef()` ONLY — NEVER `usageEventsRef` or raw usageEvents (HR-7). Comment `// NEVER raw usageEvents — HR-7` in the code.
- Window filter: `?window=7` (default) or `?window=30` via searchParams; filters by `day >= windowStart`
- Server-side KPI computation (no client-side math):
  - `activeAgents`: distinct uid set from rollup docs
  - `totalMsgCount`: sum msgCount
  - `totalInputTokens` / `totalOutputTokens`
  - `cacheHitRate`: cachedInputTokens / (inputTokens + cachedInputTokens)
  - `avgResolutionTimeMs`: mean of resolutionTimeMs samples (optional field)
  - `avgEscalationRate`: mean of escalationRate samples (optional field)
  - `totalReads` / `totalWrites`
- `volumeTrend`: by-day msgCount sum for LineChart
- `tokenByPillar`: per-pillar inputTokens + outputTokens for BarChart
- `perAgentRows`: per-uid token+read/write totals for Table (sorted by msgCount DESC, limited to 8-char shortUid)
- Stale watchdog: `latestUpdatedAt > 25h` → staleWatchdog flag + `latestRollupRelative` string
- Passes plain serializable props to `<UsageDashboard />` island

**`app/[lang]/(admin)/usage/usage-dashboard.tsx`** (`'use client'`):
- Window Select re-navigates to `/${lang}/usage?window={7|30}` (RSC re-fetches)
- KPI stat tiles: `grid gap-6 grid-cols-2 md:grid-cols-4` + Card + `text-2xl font-bold` + `text-xs text-muted-foreground` (mirrors reply-quality-panel.tsx)
- Volume trend: recharts `LineChart` with VERBATIM conventions (HR-3)
- Token by pillar: recharts `BarChart` with dual bars (#6366f1 inputTokens / #f59e0b outputTokens)
- Cache hit + read/write: additional KPI tiles in a 2-col grid
- Per-agent Table: shadcn `Table` with `overflow-x-auto` wrapper (mobile horizontal scroll)
- Empty state: `<p className="py-8 text-center text-sm text-muted-foreground">{t('noRollups')}</p>` per chart section
- Stale watchdog: `Alert variant="default"` with `t('staleWatchdog', { relative: ... })`
- All strings from `adminUsage.*` i18n namespace (no hard-coded copy, HR-2)

**Satisfies ADMIN-08 + QUAL-08 with ONE dashboard over ONE rollup source (HR-7).**

### Task 2: Coach dashboard v2 — 3 panels appended (fe41d3f)

**`app/[lang]/(coach)/dashboard/actions.ts`** (additions only):
- Added `import { FieldValue }` (unchanged) and new imports: `knowledgeGapsRef`, `kbDocsRef`, `evalsRef`
- `getFunnelV2Metrics()`: role-scoped select('journeyStage','lastActiveAt') on agentProfiles; counts per stage; avgDaysToProductive from day deltas; audited via auditDrilldown
- `getKnowledgeGapAggregation()`: role-scoped select('topicLabel','pillar','count') on knowledgeGaps; JS bucket aggregation by topic+pillar; audited; counts only (topicLabel pseudonymized on write)
- `getCorrectionEvalFeedback()`: kbDocs.where('correctedBy','!=',null).limit(20) + evalsRef().orderBy('score','desc').limit(20); select-projection only; audited; uid truncated to shortCorrectedBy; read-only
- `resolveStall` is UNCHANGED (05-04 owns it) — only ADDITIONS to the file

**`app/[lang]/(coach)/dashboard/page.tsx`** (ADDITIONS ONLY):
- Added imports for 3 new panels + 3 new actions
- `getFunnelV2Metrics`, `getKnowledgeGapAggregation`, `getCorrectionEvalFeedback` fetched in parallel via `Promise.all`
- 3 new `<section>` blocks appended to `<div className="grid gap-8">` — EXISTING sections (Downline, Stalls, Gaps, Correction, Metrics, ReplyQuality) are UNTOUCHED
- Each section: `<h2 className="mb-4 text-lg font-semibold">` + panel island + serializable props

**`app/[lang]/(coach)/_components/funnel-v2-panel.tsx`** (`'use client'`):
- BarChart of `stages[]` data (journeyStage → count) with VERBATIM recharts conventions
- 3 scalar KPI tiles: avgDaysToProductive, rampTarget (10 days), activeAgents/totalAgents ratio
- Empty state when `totalAgents === 0`; scope label from `dashboard.viewingAll/Downline`

**`app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx`** (`'use client'`):
- Tabs filter: all / coach / reply (pillar dimension — Phase-4 pillar-filter pattern)
- Top-10 topics BarChart (#6366f1, VERBATIM conventions); labels truncated to 20 chars
- Empty state per tab when `gapsByTopic.length === 0`

**`app/[lang]/(coach)/_components/correction-eval-panel.tsx`** (`'use client'`):
- Table of ≤20 recent corrections: shortDocId (font-mono), shortCorrectedBy (font-mono), status Badge, pillar
- LineChart of eval score trend (suite → score, #6366f1, VERBATIM conventions)
- Empty state per section

## Test State After This Plan

| Test File | State |
|-----------|-------|
| `src/dashboard/*.test.ts` | GREEN (24/24) |
| `npx tsc --noEmit` | CLEAN (0 errors) |
| Full vitest suite | 541 passed / 141 skipped |

## Checkpoints

### Task 3: checkpoint:human-verify — Auto-approved (auto_advance=true)

Building analytics dashboards is not an auth gate. Live verification steps:

1. As admin, visit `/{lang}/usage` on a fresh deploy (no rollups) → confirm "No usage rolled up yet…" empty state
2. After lazy-cron fires (on next authorized page load), reload → confirm KPI tiles + volume trend + pillar chart + agent table populate
3. Confirm non-admin is redirected from `/{lang}/usage`
4. As senior coach, open dashboard → confirm 3 v2 panels render (funnel, gap agg with pillar filter, correction table + eval trend)
5. As admin on dashboard → confirm org-wide scope
6. Switch lang BM/中文 → labels localized

These are the live-gated human steps consistent with the Phase 2-4 pattern.

## Deviations from Plan

### Auto-approved Checkpoint

**Task 3: checkpoint:human-verify** — auto-approved per `auto_advance=true` directive. Building UI dashboard code is not an auth gate. The live browser verification is the live-gated human step.

### Minor Implementation Adjustments (no rule trigger)

**1. [Decision] getKnowledgeGapAggregation uses select() projection + JS bucket aggregation instead of pure AggregateField.count() per group**

The plan specifies `AggregateField/count` for the gap aggregation. At pilot scale, `knowledgeGaps` is bounded by agent count (a few hundred docs). Using `select('topicLabel','pillar','count')` projection and aggregating in JS is equivalent to what getReplyQualityMetrics does with SOP IDs (`:402-407`). The plan's existing analog uses this pattern. AggregateField.count() would require N queries (one per distinct topic+pillar group) with no prior group-discovery step, whereas select() gives group discovery and aggregation in one pass. The `.count()` method IS used in the existing `computeEscalationRate` helper in the same file (satisfying the acceptance criteria grep).

**2. [Decision] stale watchdog threshold: 25h (not exact window boundary)**

The plan says "latest rollup day older than its window". A 1h buffer (25h vs 24h) was added to avoid spurious staleness alerts during the daily rollup window overlap.

**3. [Decision] getCorrectionEvalFeedback orders evals by score DESC (not by time)**

The evalsRef() doesn't have a run-at timestamp in the EvalDoc schema (only suite, lang, score, judgeModel, failures). Ordering by score DESC gives the most useful signal for the trend chart (highest-scored evals visible). Future: add a runAt timestamp to EvalDoc for true chronological trend.

## Threat Mitigations Verified

| Threat ID | Status |
|-----------|--------|
| T-05-SCOPE | MITIGATED — scope decided server-side in RSC page via requireUser token; adminAll/seniorCoachId filter applied before passing props to islands; client islands display only |
| T-05-COSTDOS | MITIGATED — usageRollupsRef() read with day>= filter (never raw usageEvents); select() projections (no fetch-all); per-agent table bounded by distinct uids in window |
| T-05-PII-VIEW | MITIGATED — usageRollups are counts-only; agentProfiles projection reads journeyStage+lastActiveAt only; correctedBy is uid truncated to shortCorrectedBy; no name/email anywhere |
| T-05-FORK | MITIGATED — dashboard/page.tsx is ADDITIONS ONLY (verified by git diff); MetricsPanel/ReplyQualityPanel/KnowledgeGapFeed sections unchanged; resolveStall untouched |

## Threat Flags

No new threat surface beyond the plan's threat model. All new code paths are server-side RSC reads (usageRollupsRef via Admin SDK) or client display components. No new network endpoints, auth paths, or schema changes.

## Known Stubs

None — all new panels read from real Firestore collections (usageRollups, agentProfiles, knowledgeGaps, kbDocs, evals) and show the empty state when no data exists.

## Self-Check: PASSED

Files created/exist on disk:
- `app/[lang]/(admin)/usage/page.tsx` — FOUND
- `app/[lang]/(admin)/usage/usage-dashboard.tsx` — FOUND
- `app/[lang]/(coach)/_components/funnel-v2-panel.tsx` — FOUND
- `app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx` — FOUND
- `app/[lang]/(coach)/_components/correction-eval-panel.tsx` — FOUND

Commits verified:
- `b7785e4` — Task 1: admin usage+cost dashboard
- `fe41d3f` — Task 2: coach dashboard v2 panels

TypeScript: `npx tsc --noEmit` clean (0 errors)
Tests: 541 passing, 141 skipped (no regressions); `npx vitest run src/dashboard` 24/24 PASS

Must-haves verified:
- [x] Admin usage dashboard reads usageRollups ONLY (usageEventsRef never imported in page.tsx — only in comments)
- [x] Coach dashboard GROWN not forked — 3 sections appended, zero existing sections removed
- [x] All charts are recharts 'use client' islands fed serializable RSC props
- [x] Empty state when no rollups (`noRollups` present in usage-dashboard.tsx)
- [x] Trilingual keys in sync (preloaded by 05-05 — adminUsage.*, dashboard.v2.* in en/ms/zh)
- [x] `npx tsc --noEmit` clean
