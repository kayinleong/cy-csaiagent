# Plan 01-08 User Setup

**Who:** Derek (project lead) or the team member with App Hosting deploy access + QStash dashboard access.

**When:** After `01-08-PLAN.md` harness code is merged — this is the live spike confirmation step.

---

## Service: Firebase App Hosting — SPIKE-DEPLOY

**Why:** Confirm that SSE streams token-by-token over a real 4G mobile network on App Hosting
`asia-southeast1`. This is a blocking gate for 01-11 (chat route streaming).

### Step 1 — Deploy the app

The `apphosting.yaml` at the project root configures the deployment:

```yaml
runConfig:
  minInstances: 1
env:
  - variable: ANTHROPIC_API_KEY
    secret: ANTHROPIC_API_KEY
  # ... (see apphosting.yaml for full list)
```

App Hosting auto-deploys on push to `main` (if GitHub integration is configured).
Or deploy manually:

```bash
firebase deploy --only hosting
```

Get the deployed URL from Firebase console → App Hosting → your backend.

### Step 2 — 4G device test

1. Pick up a real phone (Android or iPhone)
2. **Turn OFF WiFi** — use mobile data only (4G/5G)
3. Open a browser and navigate to:
   ```
   GET https://<your-app-hosting-url>/api/spike/stream
   ```
4. You should see words appearing ONE BY ONE with ~300ms gaps between them:
   ```
   D2  Property  —  streaming  spike  test.
   If  you  see  these  words  appear  one  by  one …
   ```
5. PASS = incremental word-by-word appearance
6. FAIL = long pause (10–60s) then all words appear simultaneously

### Step 3 — Record in SPIKES.md

Open `.planning/phases/01-foundations/SPIKES.md` → SPIKE-DEPLOY section and fill in:

```
Deployed URL:       https://...
4G device:          iPhone/Android, carrier name
Token delivery:     incremental  OR  buffered (buffered = FAIL)
First token time:   Xms
Total stream time:  Xms
```

Check the appropriate box:
```
Decision: [x] pass  OR  [x] fail — ESCALATE TO DEREK
```

**If FAIL:** Capture App Hosting logs showing the 60s response with no body progress. This
ESCALATES TO DEREK — the Vercel fallback has MY data-residency implications. Do NOT change the
architecture autonomously.

---

## Service: Upstash QStash dashboard — SPIKE-CRON

**Why:** Confirm that the QStash signed callback verifies, retries on 5xx, and honors
`Asia/Kuala_Lumpur` timezone. This gates 01-10 (jobs module).

### Step 1 — Create a QStash schedule

In the [Upstash QStash dashboard](https://console.upstash.com/qstash):

1. Click "Schedules" → "Create Schedule"
2. Set:
   - **Destination URL:** `https://<your-app-hosting-url>/api/jobs/_spike-cron`
   - **Cron expression:** `* * * * *` (every minute — for spike speed; change after)
   - **Timezone:** `Asia/Kuala_Lumpur`
3. Note the schedule ID for the logs

### Step 2 — Confirm signature verification

1. Wait for the next minute boundary — QStash fires
2. Check App Hosting logs for: `[_spike-cron] heartbeat { job: '_spike-cron', ... }`
3. Confirm the response was 200 (check QStash delivery log)

### Step 3 — Test retry on 5xx (optional but recommended)

1. Temporarily modify `app/api/jobs/_spike-cron/route.ts` to `return new Response(null, { status: 500 })`
2. Deploy
3. Observe QStash delivery log — it should retry 3 times
4. Revert the change and redeploy

### Step 4 — Record in SPIKES.md

Open `.planning/phases/01-foundations/SPIKES.md` → SPIKE-CRON section and fill in:

```
Manual invocation:    200  OR  401  OR  5xx
Retry on 5xx:         confirmed  OR  not tested
IANA TZ fires:        correct  OR  incorrect local time
```

Check the appropriate box:
```
Decision: [x] pass (QStash verifies + retries + Asia/KL confirmed)
     OR   [x] fallback (GitHub Actions — see D-05 in CONTEXT.md)
```

---

## After completing both steps

Once both SPIKE-DEPLOY and SPIKE-CRON decisions are recorded in SPIKES.md:

1. Run the SPIKE-RAG live test (requires `GOOGLE_APPLICATION_CREDENTIALS` + `VOYAGE_API_KEY`):
   ```bash
   export RUN_SPIKES=1
   export VOYAGE_API_KEY=<your-voyage-key>
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   export FIREBASE_PROJECT_ID=<your-project-id>
   npx vitest run src/rag/spike-rag.test.ts
   ```
   Copy the p95, read-cost ratio, and recall percentages into SPIKES.md.

2. Check all 5 SPIKES.md decisions are recorded (no PENDING remaining).

3. Resume the phase execution from Task 3 (the `checkpoint:human-verify`):
   - Type "deploy pass" if streaming verified on real 4G
   - Type "deploy fail — escalated to Derek" if buffered, with evidence

The Phase-1 gate (SPIKES.md with all 5 decisions committed) unblocks:
- `01-09` (rag module — depends on SPIKE-RAG decision)
- `01-10` (jobs module — depends on SPIKE-CRON decision)
- `01-11` (chat route — depends on SPIKE-DEPLOY + SPIKE-AI-SDK decisions)
