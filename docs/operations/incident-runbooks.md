# Incident Runbooks
## D2 Customer Service AI Agent Platform

---

## Incident 1: Stale Lazy-Cron (Watchdog Alert)

**Symptom:** Admin usage dashboard at `/<lang>/usage` shows: "Usage rollup has not run in 25+ hours." OR "Last job run is stale."

**Root cause options:**
1. No authorized user has visited the platform in the last 24 hours (most common — lazy-cron only fires on page load)
2. The `usage-rollup` job errored and is in `status: 'error'`
3. A Firestore transaction failure (Firestore unavailable)

**Resolution:**

1. Log in as admin and navigate to `/<lang>/usage`. The lazy-cron fires on every authorized page load.
2. Refresh the page after 30 seconds. If the stale alert clears, the job ran successfully.
3. If the alert persists:
   - Check `heartbeats/usage-rollup` in Firestore Console for `lastError` and `status`.
   - If `status: 'error'`: read `lastError` (no PII). Forward to engineering lead.
   - If `status: 'running'` for more than 5 minutes: likely stuck — restart by setting `status: 'idle'` in the Firestore Console.
4. If Firestore is unavailable: check Firebase Status (`status.firebase.google.com`) and wait for service restoration.

---

## Incident 2: Rate-Limit Exhaustion (Agent Can't Chat)

**Symptom:** An agent sees "Daily token limit reached. Try again tomorrow." in the chat UI.

**Background:** Each agent has a `TOKEN_CAP = 50,000` tokens per day (rolling window). This is tracked in `rateBudgets/{uid}`.

**Note on token undercount:** Rate-limit budget consumption uses `final.usage.totalTokens` (last step only) for multi-step Finder/Reply turns. This means Finder/Reply agents may exhaust their budget faster than the UI indicates. This is a known pre-Phase-5 finding (see `PERF-COST.md §6`) pending a separate claim.

**Resolution:**

1. **Verify the limit is actually hit:** Check `rateBudgets/{agentUid}` in Firestore Console. The `tokensUsed` field should be near or above `TOKEN_CAP`.

2. **Temporarily extend the limit (if urgent):** Manually update `rateBudgets/{agentUid}.tokensUsed` to 0 in the Firestore Console. This resets the agent's budget immediately (next page load enforces the window, not the reset).

3. **Increase the limit globally:** Update `TOKEN_CAP` in `src/ratelimit/window.ts:28`. This requires a code change + deployment. Consult Derek on the new limit.

4. **Adjust the model (if cost-driven):** Swap to a cheaper model via Remote Config. See `deploy-secrets-runbook.md §3`.

---

## Incident 3: Model Provider Outage (Anthropic Down)

**Symptom:** Chat returns "AI response unavailable" or similar LLM error. All agents affected simultaneously.

**Check:** Visit `status.anthropic.com` to confirm an outage.

**Resolution:**

1. **Confirm via Remote Config swap test:** In Firebase Remote Config, update `claude_model_coach` to a different available Claude model (e.g. `claude-haiku-3-5` if `claude-sonnet-4-6` is down). Publish immediately — no redeploy needed.

2. **Monitor:** After updating Remote Config, test a chat turn. If the new model responds, the swap was successful.

3. **If Anthropic is broadly unavailable:** Display a maintenance message (deploy a maintenance page via App Hosting). No auto-fallback to another provider is implemented in v1.

4. **Restore:** When Anthropic recovers, update Remote Config back to the production model. Confirm with the QUAL-01 model-swap test.

---

## Incident 4: Firestore Index Errors (Query Failures)

**Symptom:** Specific features fail with errors like "The query requires an index." OR dashboard panels show errors.

**Check:** Firebase Console → Firestore → Indexes. Look for indexes in "Building" state.

**Resolution:**

1. If an index is missing: the error message includes a link to create it automatically. Click the link in the Firestore Console.
2. If indexes are not deployed yet: run `firebase deploy --only firestore:indexes`.
3. Indexes take several minutes to build. Features using that index are degraded until it's ready.
4. If an index was accidentally deleted: re-add it from `firestore.indexes.json` via `firebase deploy --only firestore:indexes`.

**Regression check:** After any `firestore.indexes.json` change, confirm the composite `usageEvents (day, uid, pillar)` index still exists (Firestore Console → Indexes). This index is critical for the `usage-rollup` job's performance at 400 agents.

---

## Incident 5: PDPA Erasure Stuck in 'sweeping' or 'failed'

**Symptom:** An erasure request in the admin erasure status list (`/<lang>/erasure`) is stuck in `sweeping` for more than 2 hours, or shows `failed`.

**Resolution for `sweeping`:**

1. Ensure an authorized admin user visits the platform (lazy-cron fires on page load → erasure-sweep job runs every 1 hour window).
2. Check `heartbeats/erasure-sweep` in Firestore Console — verify `status: 'idle'` and `lastRun` is recent.
3. If `lastError` is set: forward to engineering lead.
4. If the request has been sweeping for > 48 hours (approaching 72h SLA): escalate immediately.

**Resolution for `failed`:**

1. Check the `error` field on the `erasureRequests/{reqId}` doc in Firestore Console.
2. The error is a non-PII message describing what went wrong.
3. Forward to engineering lead for investigation.
4. If the error indicates a missing `rawSubjectId`: the request was created by a code version before the sweep field was implemented — manual cleanup may be required.
5. Do NOT delete the `erasureRequests` doc — it is the audit trail for the erasure attempt.

**Manual fallback (if automated sweep fails):**

If the sweep cannot complete automatically, a developer can manually delete the remaining docs in Firestore Console:
- Query each PII collection for docs keyed by the subject (agentUid or leadId)
- Delete found docs
- Mark the request `complete` manually with the current timestamp in `completedAt`
- Ensure this is documented and reported to Derek

---

## Incident 6: Authentication / Login Failures

**Symptom:** Agents cannot log in. Login page shows "Firebase Auth error" or similar.

**Check:** Firebase Console → Authentication → Users. Look for the affected account.

**Resolution:**

1. If the account is disabled: re-enable in Firebase Console → Authentication → Users → find user → Enable.
2. If the custom claim is missing/wrong: use `/<lang>/roles` (admin-only) to reassign the correct role.
3. If Firebase Auth service is down: check `status.firebase.google.com`.
4. If a new agent hasn't been provisioned: create their account in Firebase Console → Authentication → Add user; then assign their role via `/<lang>/roles`.

---

## Escalation Path

| Severity | Contact | Channel |
|---------|---------|---------|
| Platform down (all agents affected) | AI engineering lead → Product engineering lead | Immediate |
| PDPA erasure approaching SLA | Product engineering lead → Derek | Immediate |
| Data breach / unauthorized access | Derek → External legal counsel | Immediate |
| Single agent degraded | AI engineering lead | Next business day |
| Stale lazy-cron (> 48h) | AI engineering lead | Same day |
