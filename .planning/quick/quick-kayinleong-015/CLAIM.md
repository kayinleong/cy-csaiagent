# Claim: quick-kayinleong-015

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Admin usage page (/[lang]/usage) shows no stats despite chats having happened. Root cause is the usage-rollup lazy-cron job, not the page read. Fixed the rollup window (24h→1h) and day coverage (today→yesterday+today) so events are aggregated.

## What will change

- `src/jobs/runDueJobs.ts` — the `usage-rollup` job: window 24h→1h; roll up yesterday + today.
- `src/jobs/jobs.test.ts` — regression coverage for the above.

Root cause (confirmed):
- The usage page reads `usageRollups` (page.tsx:118), never raw `usageEvents` (HR-7). Rollups are
  produced only by the `usage-rollup` lazy-cron job in `src/jobs/runDueJobs.ts`.
- That job rolled up `dayKey(now)` (TODAY only) and was throttled to once per 24h (`windowMs: ONE_DAY_MS`).
- `triggerDueJobs()` fires on chat-page LOAD (`app/[lang]/chat/page.tsx:51`) — before the user sends a
  message. So the daily run aggregated zero events, staked the 24h claim, and never re-ran that day.
  Events written afterward were never aggregated → `usageRollups` stayed empty → page showed nothing.
- Event-write side is correct: `recordUsageEvent` (src/usage/record.ts) writes `usageEvents` with a MYT `day`.

## What has changed

- `src/jobs/runDueJobs.ts`: added `ONE_HOUR_MS`; `usage-rollup.windowMs` → `ONE_HOUR_MS`;
  `usage-rollup.run` now rolls up `dayKey(now-1d)` then `dayKey(now)`; refreshed stale header comment.
- `src/jobs/jobs.test.ts`: mocked `@/src/usage/rollup`; added a `usage-rollup` describe block (3 tests).
- Commit: `30be068` (code). Docs commit follows.

## Verification

### Regression surface
The change touches only the `usage-rollup` JOB_REGISTRY entry + a new constant. Surfaces sharing the path:
- **Usage page render** (`app/[lang]/(admin)/usage/page.tsx`): reads `usageRollups`. No code change; rollups
  are now populated → behavior improves. The page `staleWatchdog` keys off rollup `updatedAt` (25h), not the
  job window — hourly recompute keeps it fresh, so no false stale alerts.
- **`readHeartbeat`**: no UI consumers (grep confirmed) → shrinking the window cannot trigger a watchdog regression.
- **Other jobs** (stall-detect, escalate, eval-nightly, erasure-sweep): untouched.
- **Cost / double-count**: hourly + 2-day aggregation. `rollupUsage` is idempotent (`set(merge:true)`
  recompute-from-source) and the runJob txn DUE-gate is exactly-once-per-window → no double-count; cost
  negligible at pilot scale (AggregateField queries, not full reads).
- **MYT day math**: `dayKey(now-24h)` is a clean day boundary (Malaysia has no DST), matching event/rollup/page keys.

### Tested
- `npx vitest run src/jobs/jobs.test.ts` → **21 passed** (incl. 3 new usage-rollup tests).
- `npx vitest run src/jobs src/usage` → **24 passed, 3 skipped** (skips are emulator-gated, pre-existing).
- `npx tsc --noEmit` → clean for changed files.
- `npx eslint src/jobs/runDueJobs.ts src/jobs/jobs.test.ts` → 0 errors (4 warnings, all pre-existing/untouched).

### Ruled out
- Event-write failure, page read/window filter, role gate, watchdog false-positive (see RESEARCH §Ruled out).

### Not done (out of scope)
- Backfill of days older than yesterday (one-time job). Self-priming the usage page via `triggerDueJobs`.
