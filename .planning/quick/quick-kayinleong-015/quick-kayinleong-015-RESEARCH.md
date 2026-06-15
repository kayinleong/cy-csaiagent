---
quick_id: quick-kayinleong-015
title: Usage page shows no stats — root cause + fix options
mode: quick-task
status: complete
date: 2026-06-15
---

# RESEARCH — Usage page (/[lang]/usage) shows no stats

## Symptom

User opened several chats, then visited `/en/usage` (admin usage + cost analytics)
and saw **no stats** (empty KPIs / charts / per-agent table).

## Data path (as-built)

```
chat turn (onFinish, after())  ──recordUsageEvent()──▶  usageEvents/*   (raw, counts-only, per turn)
                                                              │
                            usage-rollup lazy-cron job ──rollupUsage(day)──▶  usageRollups/*  (per uid+pillar+day)
                                                              │
                              /[lang]/usage RSC ──usageRollupsRef().where('day','>=',windowStart)──▶  page render
```

Key files:
- `app/[lang]/(admin)/usage/page.tsx:118` — reads **`usageRollups` only**, never raw `usageEvents` (HR-7).
- `src/usage/record.ts` — `recordUsageEvent()` writes `usageEvents` with `day = dayKey(now)` (MYT). **Correct.**
- `src/usage/rollup.ts` — `rollupUsage(day)` aggregates `usageEvents` for `day` into `usageRollups`. Idempotent (`set(merge:true)`, recompute-from-source). **Correct.**
- `src/jobs/runDueJobs.ts:225` — the `usage-rollup` JOB_REGISTRY entry. **Root cause is here.**
- `app/_actions/jobs.ts` → `triggerDueJobs()` — the lazy-cron Server Action.
- `app/[lang]/chat/page.tsx:51` — the **only** caller of `triggerDueJobs()` (`void triggerDueJobs()`).

## Root cause

The `usage-rollup` job has two structural problems that together guarantee an empty page:

1. **It rolls up only the current, in-progress day** — `rollupUsage(dayKey(now))`.
2. **It is throttled to once per 24h** — `windowMs: ONE_DAY_MS`.

Combined with **how it is triggered** — `triggerDueJobs()` fires on chat-page *load*,
i.e. *before* the user sends any message — the failure sequence is:

| Time            | Event |
|-----------------|-------|
| Day D, first visit | `triggerDueJobs` runs → `usage-rollup` is due (never ran) → `rollupUsage(D)`. **No events exist yet** → rolls up nothing. Stakes the 24h claim (`lastRunAt = now`). |
| Day D, later    | User chats → `usageEvents` written for day D. |
| Day D, later visits | `usage-rollup` **not due** (< 24h) → skipped. Today's events are **never** aggregated. |
| User opens `/usage` | Reads `usageRollups` → empty → **"no stats."** |

Even on subsequent days the job rolls up the *new* current day, never revisiting a
prior day, so a day's late events are permanently un-rolled-up.

### Ruled out
- **Event write failure** — `recordUsageEvent` is correct; events are in `usageEvents`.
- **Page read / window filter** — `nDaysAgo()` uses `dayKey` (MYT), matching event/rollup keys.
- **Role gate** — symptom is "page renders but empty," so the admin/read-only gate passes.
- **Watchdog false-positive** — page `staleWatchdog` keys off rollup `updatedAt` (25h), not `windowMs`; `readHeartbeat` has no UI consumers. Changing `windowMs` is safe.

## Fix options

| Option | Change | Fixes today? | Fixes prior day? | Cost | Verdict |
|--------|--------|--------------|------------------|------|---------|
| A (chosen) | `windowMs` → 1h **and** roll up `yesterday` + `today` each run | ✅ refreshes within ~1h of a chat-page visit | ✅ completed prior day captured; midnight boundary safe | Hourly idempotent aggregation (cheap at pilot scale) | **Minimal + robust** |
| B | `windowMs` → 1h only (still today-only) | ✅ | ❌ midnight tail of prior day lost | low | Incomplete |
| C | Roll up `yesterday`+`today`, keep 24h window | ❌ today appears only next day | ✅ | low | Bad UX for "I just chatted" |

Idempotency makes Option A safe: `rollupUsage` recomputes from source with
`set(merge:true)`, so re-running every hour never double-counts (Pitfall 3 guard).

## Out of scope (noted, not done)
- **Backfill of days older than yesterday.** Option A recovers today + yesterday. Events
  from ≥2 days ago that were never rolled up would need a one-time backfill — separate task.
- **Triggering the rollup from the usage page itself.** `triggerDueJobs` is fire-and-forget,
  so it would not refresh the current render; it only fires from the chat page today. A
  self-priming usage page is a possible follow-up but is not needed to fix the reported symptom.

## Plan
1. `src/jobs/runDueJobs.ts`: add `ONE_HOUR_MS`; set `usage-rollup` `windowMs: ONE_HOUR_MS`;
   roll up `dayKey(yesterday)` then `dayKey(today)`. Update the stale file-header line that
   still calls usage-rollup a "no-op stub — Phase 3."
2. `src/jobs/jobs.test.ts`: add a regression test — `usage-rollup` rolls up yesterday+today and
   uses a 1h due window.
3. Verify: `vitest run src/jobs src/usage` + typecheck/lint.
