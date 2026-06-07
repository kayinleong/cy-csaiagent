# Lazy-Cron Job Catalog
## D2 Customer Service AI Agent Platform

**Context:** There is no external scheduler (no Cloud Scheduler, no QStash, no cron daemon). All periodic work runs via the **on-visit lazy-cron** pattern: jobs fire when an authorized user loads the platform, gated by a Firestore transaction that ensures each job runs at most once per its configured window.

---

## How the Lazy-Cron Works

```
1. Authorized user loads any platform page
2. app/layout.tsx calls triggerDueJobs() (Server Action)
3. src/jobs/runDueJobs.ts iterates the JOB_REGISTRY
4. For each job:
   a. Firestore transaction: read lastRun from heartbeats/{jobName}
   b. If now < lastRun + windowMs: skip (not due yet)
   c. If DUE: set status='running', commit transaction (exactly-once under concurrency)
   d. Call job.run()
   e. Update lastRun, set status='idle'
5. Side-effects complete asynchronously (do not block the page load)
```

**Concurrency safety:** The Firestore transaction at step 4c ensures that if two users load the page simultaneously, only one fires each job. The job body must also be idempotent (re-running is safe).

**The heartbeat doc doubles as the run ledger** — it records `lastRun`, `status`, and `lastError` for each job. The stale watchdog reads these docs to surface "job has not run in X hours" alerts in the admin dashboard.

---

## Job Registry

### 1. stall-detect

| Property | Value |
|---------|-------|
| Window | 24 hours |
| Purpose | Scan `agentProfiles` for agents whose journey has stalled (no progress in N days). Write `escalations` docs for detected stalls. |
| Source | `src/jobs/stall-detect/` |
| Heartbeat key | `stall-detect` |
| On failure | Marks status='error' + lastError message; next window retries |

**When to investigate:** If senior coaches report they are not seeing expected stall alerts in their dashboard.

---

### 2. escalate

| Property | Value |
|---------|-------|
| Window | 24 hours |
| Purpose | Review open `escalations` and send nudge notifications (in-app; no WhatsApp API in v1). Updates escalation status and escalation rate. |
| Source | `src/jobs/escalation/` |
| Heartbeat key | `escalate` |
| On failure | Marks status='error'; next window retries |

**When to investigate:** If open escalations are not progressing or being resolved.

---

### 3. eval-nightly

| Property | Value |
|---------|-------|
| Window | 24 hours |
| Purpose | Run Promptfoo eval suite (model quality check). Uses the judge model from Remote Config. Writes results to `evals` collection. |
| Source | `src/jobs/eval/` |
| Heartbeat key | `eval-nightly` |
| On failure | Marks status='error'; eval suite results may be stale |

**When to investigate:** If the correction-eval panel on the coach dashboard shows no recent eval scores, or if model quality seems degraded.

---

### 4. usage-rollup

| Property | Value |
|---------|-------|
| Window | 24 hours |
| Purpose | Aggregate the previous day's `usageEvents` into `usageRollups` docs (one per day per agent per pillar). This is the source for the admin usage + cost dashboard. |
| Source | `src/usage/rollup.ts` + `src/jobs/runDueJobs.ts` |
| Heartbeat key | `usage-rollup` |
| On failure | Marks status='error'; the dashboard will show stale data + stale watchdog alert |

**Key property:** The rollup is **idempotent** — re-running it overwrites the same rollup doc with recomputed values. Running it twice does NOT double-count.

**When to investigate:** If the admin usage dashboard shows the stale watchdog alert ("No rollup in 25+ hours"). Visit any admin page (as an admin) to trigger the lazy-cron. If it still doesn't run, check `heartbeats/usage-rollup` in Firestore for the `lastError`.

---

### 5. erasure-sweep

| Property | Value |
|---------|-------|
| Window | 1 hour |
| Purpose | Check for `erasureRequests` docs in `pending` or `sweeping` status. For each, re-run the erasure cascade to finish any batches not completed synchronously by the Server Action. Marks requests `complete` when all PII collections reach 0 docs. |
| Source | `src/pdpa/sweep.ts` + `src/jobs/runDueJobs.ts` |
| Heartbeat key | `erasure-sweep` |
| On failure | Marks request `failed` with a non-PII error message; admin can retry via the erasure page |

**SLA:** The erasure target is < 72 hours. With a 1-hour window, a request submitted at any time should complete within 2 hours under normal conditions. The `slaDeadline` field on the request doc is the 72h deadline.

**When to investigate:** If an erasure request is stuck in `pending` or `sweeping` for more than 2 hours. See `incident-runbooks.md §5` (Erasure stuck).

---

## Stale Watchdog

The admin usage dashboard (`/<lang>/usage`) displays a stale alert when `usage-rollup` has not run in more than 25 hours. This is the primary signal for lazy-cron health.

**If the watchdog fires:**
1. Verify an authorized user has visited the platform recently (if no one has logged in, the cron cannot fire).
2. Manually trigger: log in as admin and navigate to `/<lang>/usage`. The lazy-cron fires on page load.
3. If the alert persists after navigation: check `heartbeats/usage-rollup` in Firestore for `lastError`.

---

## Backup Reminder (Lazy-Cron Advisory)

The lazy-cron catalog includes an advisory check for the backup age. If the last Firestore export is older than 7 days (tracked via a manually-updated `heartbeats/backup-reminder` doc after each export), the admin watchdog surface shows a reminder.

**This does NOT trigger a backup automatically.** See `backup-restore-runbook.md` for the export procedure.

---

## Adding a New Job

1. Add a `JobDefinition` entry to the `JOB_REGISTRY` in `src/jobs/runDueJobs.ts`:
   ```typescript
   'my-job': {
     windowMs: ONE_DAY_MS,   // or 60 * 60 * 1000 for 1h
     run: async (now: Date) => {
       await myJobFunction(now)
       await writeHeartbeat('my-job')
     },
   }
   ```
2. The new job runs automatically on the next authorized page load.
3. Add it to this catalog.
