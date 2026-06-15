---
quick_id: quick-kayinleong-015
title: Fix usage page showing no stats (usage-rollup window + coverage)
status: complete
date: 2026-06-15
commit: 30be068
---

# SUMMARY — quick-kayinleong-015

## Problem
Admin usage page (`/[lang]/usage`) showed no stats after agents had chatted.

## Root cause
The page reads `usageRollups` (never raw `usageEvents`, per HR-7). Those rollups are
produced only by the `usage-rollup` lazy-cron job in `src/jobs/runDueJobs.ts`, which:
1. rolled up only the **current** day (`dayKey(now)`), and
2. was throttled to **once per 24h** (`windowMs: ONE_DAY_MS`).

Because `triggerDueJobs()` fires on chat-page **load** (before the user sends a
message), the single daily run aggregated **zero** events, staked the 24h claim, and
never re-ran that day. Events written afterward were never rolled up → empty page.

## Fix
`src/jobs/runDueJobs.ts` — `usage-rollup` entry only:
- Added `ONE_HOUR_MS`; set `windowMs` to it so the in-progress day is recomputed on later visits.
- Roll up **yesterday + today** each run (`rollupUsage(yesterday)`, `rollupUsage(today)`).
- `rollupUsage` is idempotent (`set(merge:true)` recompute-from-source) → hourly recompute never double-counts.
- Refreshed the stale file-header comment.

`src/jobs/jobs.test.ts` — added a `usage-rollup` describe block (3 tests): rolls up
yesterday+today + heartbeat; due at 90m; skipped at 30m. Mocked `@/src/usage/rollup`.

## Files changed
- `src/jobs/runDueJobs.ts`
- `src/jobs/jobs.test.ts`

## Verification
- `npx vitest run src/jobs/jobs.test.ts` → 21 passed (incl. 3 new). Existing tests unaffected.
- `npx vitest run src/jobs src/usage` → 24 passed, 3 skipped (emulator-gated, pre-existing).
- `npx tsc --noEmit` → clean for changed files.
- `npx eslint` on changed files → 0 errors (4 warnings, all pre-existing/untouched).

## Commit
- `30be068` — fix(quick-kayinleong-015)

## Out of scope (noted)
- Backfill of un-rolled-up days older than yesterday (one-time job).
- Triggering the rollup from the usage page (fire-and-forget; would not refresh the current render).
