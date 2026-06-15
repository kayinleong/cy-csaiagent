---
quick_id: quick-kayinleong-015
title: Fix usage page showing no stats (usage-rollup window + coverage)
mode: quick
status: complete
date: 2026-06-15
---

# PLAN — quick-kayinleong-015

**Goal:** The admin usage page (`/[lang]/usage`) shows usage/cost stats after agents chat.

**Root cause** (see RESEARCH): the `usage-rollup` lazy-cron job rolls up only the
current day, once per 24h, and is triggered on chat-page load — before any events
exist. So `usageRollups` stays empty and the page renders nothing.

## Task 1 — Fix the usage-rollup job

- **files:** `src/jobs/runDueJobs.ts`
- **action:**
  - Add `ONE_HOUR_MS` constant.
  - `usage-rollup.windowMs`: `ONE_DAY_MS` → `ONE_HOUR_MS` (recompute the in-progress day on later visits).
  - `usage-rollup.run`: roll up `dayKey(now - 1d)` then `dayKey(now)` (previous + current day).
  - Update the stale file-header line calling usage-rollup a "no-op stub — Phase 3".
- **verify:** `npx vitest run src/jobs`
- **done:** job rolls up yesterday+today; due window is 1h; idempotent recompute.

## Task 2 — Regression test

- **files:** `src/jobs/jobs.test.ts`
- **action:** mock `@/src/usage/rollup`; add a `usage-rollup` describe block asserting
  (a) rolls up yesterday AND today + heartbeat, (b) due at 90m, (c) skipped at 30m.
- **verify:** `npx vitest run src/jobs/jobs.test.ts` (all pass, incl. existing).
- **done:** 3 new tests green; no existing test regressed.

## Out of scope
- Backfill of days older than yesterday (one-time job, separate task).
- Self-priming the usage page via `triggerDueJobs` (fire-and-forget won't refresh current render).
