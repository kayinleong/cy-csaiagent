# Plan 01-08 User Setup

**Who:** Derek (project lead) or the team member with App Hosting deploy access.

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

## SPIKE-CRON — RETIRED (2026-06-01)

QStash was removed (decision override 2026-06-01). Scheduling is now an **on-visit lazy-cron
Server Action** gated by a Firestore last-run-per-window doc — there is **no QStash dashboard,
no schedule to create, and no signed-callback round-trip to test**. Nothing to do here.

---

## After completing SPIKE-DEPLOY

Once the SPIKE-DEPLOY decision is recorded in SPIKES.md:

1. Run the SPIKE-RAG live test (requires `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_GENERATIVE_AI_API_KEY`):
   ```bash
   export RUN_SPIKES=1
   export GOOGLE_GENERATIVE_AI_API_KEY=<your-gemini-developer-api-key>
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   export FIREBASE_PROJECT_ID=<your-project-id>
   npx vitest run src/rag/spike-rag.test.ts
   ```
   Copy the p95, read-cost ratio, and recall percentages into SPIKES.md.

2. Check the remaining SPIKES.md decisions are recorded (SPIKE-AI-SDK = RECORDED, SPIKE-CRON =
   RETIRED; SPIKE-RAG / SPIKE-DEPLOY / SPIKE-INGEST = filled in from live runs).

3. Resume the phase from the `checkpoint:human-verify`:
   - Type "deploy pass" if streaming verified on real 4G
   - Type "deploy fail — escalated to Derek" if buffered, with evidence

The Phase-1 gate (SPIKES.md decisions committed) unblocks:
- `01-09` (rag module — depends on SPIKE-RAG decision)
- `01-12` (chat route — depends on SPIKE-DEPLOY + SPIKE-AI-SDK decisions)
