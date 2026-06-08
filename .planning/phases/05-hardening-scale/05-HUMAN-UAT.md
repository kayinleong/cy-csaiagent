---
status: partial
phase: 05-hardening-scale
source: [05-VERIFICATION.md]
started: 2026-06-07T00:00:00Z
updated: 2026-06-07T00:00:00Z
---

## Current Test

[awaiting human testing — all items are live-gated; run during pilot rollout against a deployed, seeded Firebase stack]

## Tests

### 1. PDPA live erasure end-to-end drill
expected: An admin runs a real erasure via the erasure admin UI against a deployed stack; the subject's data is removed from every PII collection within the <72h SLA; `auditLogs` survives (the erasure audit event is appended); the `rawSubjectId` field is cleared (FieldValue.delete) on completion; the status list shows `complete` with the SLA marker met.
result: [pending]

### 2. Derek sign-off on PDPA-SIGNOFF.md
expected: Derek reviews the erasure coverage proof + audit-exemption, the disclosed CR-01 transient `rawSubjectId` retention design (retained admin-only ≤72h, cleared on complete; encrypt-at-rest noted as v2), and confirms A1 (voice samples are Firestore strings, not Storage objects) and A6 (managed gcloud-export backup posture), then signs §7.
result: [pending]

### 3. 400-VU load test
expected: `k6 run scripts/loadtest/chat.js` against deployed App Hosting at ~400 concurrent VUs hitting `/api/chat` (now sending a valid `{ messages: [...] }` body so the model/SSE path is actually exercised); p95 captured and compared to Derek's finalized budget; results recorded in a LOADTEST.md.
result: [pending]

### 4. Firestore rules + indexes deploy
expected: `firebase deploy --only firestore:rules,firestore:indexes` deploys the 3 new deny-by-default collection rules (usageEvents/usageRollups/erasureRequests) + the `usageEvents (day,uid,pillar)` composite index (additive; no existing rule widened).
result: PASS — 2026-06-08, deployed to `cy-csaiagent` (authed as sosleong365@gmail.com, --non-interactive). Rules compiled successfully and released to cloud.firestore; indexes deployed from firestore.indexes.json. 1 pre-existing project index NOT in the file was left intact (no --force). NOTE: the new composite index builds asynchronously server-side — allow a few minutes before queries relying on it succeed. Verify build state in the Firebase console (Firestore → Indexes).

### 5. Backup/restore drill
expected: A managed `gcloud firestore export` to a bucket, then import to a scratch project, verifies the backup/restore runbook (docs/operations/backup-restore-runbook.md); outcome recorded in HARDENING.md §3. (This managed export is the only sanctioned gcloud use — no Cloud Function / no scheduler.)
result: [pending]

### 6. SLO finalization
expected: Derek approves or adjusts the PROPOSED p95/p50/error-rate numbers in PERF-COST.md / HARDENING.md §1, converting them from PROPOSED to finalized. Separately, the flagged pre-Phase-5 multi-step token undercount (route.ts rate-limit path) is triaged as its own claim.
result: [pending]

### 7. Admin + coach-v2 UI smoke-test (trilingual)
expected: Browser click-through on a deployed seeded stack of all 4 admin surfaces (erasure type-to-confirm + blast-radius preview now subject-scoped, conversations read-only drill-down, role matrix + demotion confirm, usage/cost dashboard) and the 3 coach dashboard v2 panels (funnel+ramp, knowledge-gap aggregation, correction→eval), in EN/BM/中文. BM/中文 copy awaits Derek's native sign-off.
result: [pending]

## Summary

total: 7
passed: 1
issues: 0
pending: 6
skipped: 0
blocked: 0

## Notes (2026-06-08 live-gate run attempt)

Item 4 (rules+indexes deploy) executed successfully. The other 6 are blocked in this environment:
- **#3 load test** — k6 not installed AND no deployed App Hosting URL AND no valid admin ID token (script reads `__ENV.TOKEN`). Also unclear the App Hosting app is deployed yet. Needs: deployed URL + a real admin session token (+ accepted ~400-VU model spend).
- **#5 backup/restore** — gcloud's active context is an unrelated project (`oa-apmena-spacecds-ap-pd`, accenture account), not cy-csaiagent. Needs: a destination GCS bucket + a scratch project for the restore + permission to run gcloud as sosleong365@gmail.com against cy-csaiagent (without disturbing the user's active gcloud config).
- **#1 PDPA erasure drill** — destructive/irreversible against live data; needs a deployed stack, an admin session, and a clearly SYNTHETIC seeded subject to erase. Will not run against real data autonomously.
- **#7 trilingual UI smoke-test** — needs a deployed stack + admin creds; BM/中文 copy still awaits Derek's native sign-off. Local `npm run dev` needs Firebase web config + Anthropic/Gemini keys + a real admin session (not available here).
- **#2 Derek sign-off** and **#6 SLO finalization** — human decisions; cannot be automated.

## Gaps
