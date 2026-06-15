# Claim: quick-kayinleong-015

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: in-progress
- summary: Admin usage page (/[lang]/usage) shows no stats despite chats having happened. Root cause is the usage-rollup lazy-cron job, not the page read. Fix the rollup window + day coverage so events are aggregated.

## What will change

_TBD after research + planning._

Known leads (pre-research):
- The usage page reads `usageRollups` (page.tsx:118), never raw `usageEvents` (HR-7). Rollups are
  produced only by the `usage-rollup` lazy-cron job in `src/jobs/runDueJobs.ts`.
- That job rolls up `dayKey(now)` (TODAY only) and is throttled to once per 24h (`windowMs: ONE_DAY_MS`).
- `triggerDueJobs()` fires on chat-page LOAD (`app/[lang]/chat/page.tsx:51`) — before the user sends a
  message. So the first run of the day aggregates zero events, stakes the 24h claim, and never re-runs
  that day. Events written afterward are never aggregated → `usageRollups` stays empty → page shows nothing.
- Event-write side is correct: `recordUsageEvent` (src/usage/record.ts) writes `usageEvents` with a MYT `day`.

## What has changed

_TBD._

## Verification

_TBD._
