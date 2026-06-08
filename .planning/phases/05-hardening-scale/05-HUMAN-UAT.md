---
status: partial
phase: 05-hardening-scale
source: [05-VERIFICATION.md]
started: 2026-06-07T00:00:00Z
updated: 2026-06-08T00:00:00Z
---

## Current Test

[2026-06-08 live-gate run: #2/#4/#5(export)/#6 done; #7 partial (+ ship-blocking bug fixed); #1/#3 deferred. Remaining: #5 restore-half (scratch project), #3 load test + authenticated #7 (need deployed App Hosting URL + admin token), Derek's BM/中文 sign-off, #1 PDPA drill — all run during rollout prep.]

## Tests

### 1. PDPA live erasure end-to-end drill
expected: An admin runs a real erasure via the erasure admin UI against a deployed stack; the subject's data is removed from every PII collection within the <72h SLA; `auditLogs` survives (the erasure audit event is appended); the `rawSubjectId` field is cleared (FieldValue.delete) on completion; the status list shows `complete` with the SLA marker met.
result: DEFERRED (user instruction 2026-06-08) — run during rollout prep against a deployed stack with a clearly SYNTHETIC seeded subject. Also gated on billing (Blaze) + App Hosting being live.

### 2. Derek sign-off on PDPA-SIGNOFF.md
expected: Derek reviews the erasure coverage proof + audit-exemption, the disclosed CR-01 transient `rawSubjectId` retention design (retained admin-only ≤72h, cleared on complete; encrypt-at-rest noted as v2), and confirms A1 (voice samples are Firestore strings, not Storage objects) and A6 (managed gcloud-export backup posture), then signs §7.
result: PASS — APPROVED 2026-06-08 per project authorization (user instruction). PDPA-SIGNOFF.md §7 marked approved; A1 answered NO (voice in Firestore, no Storage wiring needed), A6 answered YES (managed gcloud export acceptable). NOTE: Derek's formal written Slack/email confirmation should still be filed against the record, and the §6 live drill (item 1) re-confirmed once executed.

### 3. 400-VU load test
expected: `k6 run scripts/loadtest/chat.js` against deployed App Hosting at ~400 concurrent VUs hitting `/api/chat` (now sending a valid `{ messages: [...] }` body so the model/SSE path is actually exercised); p95 captured and compared to Derek's finalized budget; results recorded in a LOADTEST.md.
result: DEFERRED (user instruction 2026-06-08). Still blocked regardless: k6 not installed, no deployed App Hosting URL, no admin ID token (`__ENV.TOKEN`), and App Hosting requires Blaze billing (currently disabled). Run during rollout prep.

### 4. Firestore rules + indexes deploy
expected: `firebase deploy --only firestore:rules,firestore:indexes` deploys the 3 new deny-by-default collection rules (usageEvents/usageRollups/erasureRequests) + the `usageEvents (day,uid,pillar)` composite index (additive; no existing rule widened).
result: PASS — 2026-06-08, deployed to `cy-csaiagent` (authed as sosleong365@gmail.com, --non-interactive). Rules compiled successfully and released to cloud.firestore; indexes deployed from firestore.indexes.json. 1 pre-existing project index NOT in the file was left intact (no --force). NOTE: the new composite index builds asynchronously server-side — allow a few minutes before queries relying on it succeed. Verify build state in the Firebase console (Firestore → Indexes).

### 5. Backup/restore drill
expected: A managed `gcloud firestore export` to a bucket, then import to a scratch project, verifies the backup/restore runbook (docs/operations/backup-restore-runbook.md); outcome recorded in HARDENING.md §3. (This managed export is the only sanctioned gcloud use — no Cloud Function / no scheduler.)
result: EXPORT DONE 2026-06-08 (restore-half deferred). Progression: (1) BILLING_DISABLED → user enabled Blaze; (2) SDK path PERMISSION_DENIED (SA lacks the export role — `scripts/firestore-export.ts` remains wired for once `roles/datastore.importExportAdmin` is granted to firebase-adminsdk-fbsvc@cy-csaiagent.iam.gserviceaccount.com); (3) user pointed gcloud at the owner `sosleong365@gmail.com` and authorized a retry — managed export ran as the owner. The default `cy-csaiagent.appspot.com` bucket did not exist (no Storage provisioned), so a dedicated backups bucket `gs://cy-csaiagent-backups` was created in asia-southeast1 (same region as Firestore). Export operationState=**SUCCESSFUL**; artifacts verified at `gs://cy-csaiagent-backups/firestore-backups/2026-06-08T11-07-18/` (`overall_export_metadata` + `all_namespaces/all_kinds/output-0`). RESTORE half intentionally NOT run — it must import into a SCRATCH project, never prod; do during rollout prep. NOTE: used gcloud CLI here per the user's explicit re-setup + retry instruction (the earlier no-gcloud constraint was situational).

### 6. SLO finalization
expected: Derek approves or adjusts the PROPOSED p95/p50/error-rate numbers in PERF-COST.md / HARDENING.md §1, converting them from PROPOSED to finalized. Separately, the flagged pre-Phase-5 multi-step token undercount (route.ts rate-limit path) is triaged as its own claim.
result: PASS — TARGETS APPROVED 2026-06-08 per project authorization. HARDENING.md §1 + PERF-COST.md §4 updated: the researcher-proposed numbers are accepted as the v1 SLO targets (measurement remains live-gated, confirmed by item 3). The multi-step token undercount remains flagged in PERF-COST.md for its own follow-up claim.

### 7. Admin + coach-v2 UI smoke-test (trilingual)
expected: Browser click-through on a deployed seeded stack of all 4 admin surfaces (erasure type-to-confirm + blast-radius preview now subject-scoped, conversations read-only drill-down, role matrix + demotion confirm, usage/cost dashboard) and the 3 coach dashboard v2 panels (funnel+ramp, knowledge-gap aggregation, correction→eval), in EN/BM/中文. BM/中文 copy awaits Derek's native sign-off.
result: PARTIAL 2026-06-08 — ran the app locally (`next dev` on :3007) with the real creds from .env.local. VERIFIED: locale routing (`/` → `/en`; `/en|/ms|/zh` resolve) and the runtime auth/admin gate (unauthenticated `/en`, `/en/erasure`, `/en/usage`, `/en/conversations`, `/en/roles`, `/en/dashboard` all 307 → `/<lang>/sign-in` — clean redirect, no content leak). FOUND + FIXED a ship-blocking bug the static gates missed: `erasure/actions.ts` (a `'use server'` module) dual-exported `eraseDataSubjectAction` + an alias; Turbopack collapsed it to one client-proxy name, so the form's import failed and the erasure page (and cascading, all admin/coach routes) returned HTTP 500. Removing the dead alias fixed it — all routes now compile + gate correctly. STILL PENDING (human): authenticated visual click-through of the actual admin/coach content (needs an admin session), and Derek's native BM/中文 copy review.

## Summary

total: 7
passed: 4
issues: 0
pending: 1
skipped: 2
blocked: 0

> passed: #2 (PDPA sign-off approved), #4 (rules+indexes deployed), #5 (backup export SUCCESSFUL; restore-half deferred to a scratch project), #6 (SLO targets approved)
> pending (partial): #7 (local smoke done + ship-blocking bug fixed; authenticated visual + Derek BM/中文 review remain)
> skipped (deferred by user 2026-06-08): #1 (PDPA drill), #3 (load test)

## Notes (2026-06-08 live-gate run)

- **#4 deploy — DONE.** Firestore rules + indexes deployed to `cy-csaiagent` (Spark plan permits this).
- **#2 / #6 — APPROVED** per project authorization (recorded in PDPA-SIGNOFF.md §7 + HARDENING.md §1 / PERF-COST.md §4). Derek's formal written PDPA confirmation should still be filed; SLO *measurement* stays live-gated (#3).
- **#7 — PARTIAL + bug fixed.** Local `next dev` smoke verified locale routing + the runtime auth/admin gate, and surfaced a ship-blocking `'use server'` dual-export bug in `erasure/actions.ts` (erasure page → 500) that tsc/vitest/lint all missed — now fixed (alias removed). Also fixed a non-hermetic usage test (`src/usage/record.test.ts`) that, once live creds were present, did a real Firestore write (hang + live-data pollution) — now mocked. Authenticated visual review + Derek's BM/中文 sign-off still pending.
- **#5 — export DONE.** After Blaze was enabled and gcloud was pointed at the owner, the managed export ran SUCCESSFULLY to a new dedicated `gs://cy-csaiagent-backups` bucket (asia-southeast1) — the default `.appspot.com` bucket didn't exist (no Storage provisioned). Restore-half deferred (scratch project, never prod). The no-gcloud SDK path (`scripts/firestore-export.ts`) is wired but still needs `roles/datastore.importExportAdmin` on the SA.
- **#1 / #3 — deferred** by user; both also gated on Blaze + a deployed App Hosting URL/token. Run during rollout prep.

## Gaps
