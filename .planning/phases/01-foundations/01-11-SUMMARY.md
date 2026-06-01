---
phase: 01-foundations
plan: "11"
subsystem: escalation-jobs
superseded_note: "2026-06-01 — QStash scheduling described below was REPLACED by an on-visit lazy-cron Server Action (src/jobs/runDueJobs.ts + app/_actions/jobs.ts). The QStash-signed stall-detect/_spike-cron routes + signature.test.ts were deleted; SPIKE-CRON retired. findStalled/emitHandoffSignal/heartbeat are retained. See PROJECT.md Key Decisions + 01-VERIFICATION.md amendment."
tags: [escalation, stall-detect, lazy-cron, heartbeat, background-jobs, tdd, framework-free, offline-tested]

# Dependency graph
requires:
  - "01-03 (firebase): escalationsRef, agentProfilesRef, typed converters, adminDb"
  - "01-07 (memory): agentProfile.touchLastActive — lastActiveAt signal that drives stall detection"
  - "01-08 (spikes): SPIKE-CRON decision — verifySignatureAppRouter confirmed; @upstash/qstash@2.11.0 installed"

provides:
  - "src/escalation/detect.ts — findStalled({days, now?}) queries agentProfiles.lastActiveAt < threshold"
  - "src/escalation/handoff.ts — emitHandoffSignal({agentUid, seniorCoachId, reason, contextBundle}) writes escalations row with dedup guard"
  - "src/escalation/index.ts — public re-export of both escalation modules"
  - "src/jobs/heartbeat.ts — writeHeartbeat/readHeartbeat for jobHeartbeats/{jobName} (UI watchdog signal)"
  - "app/api/jobs/stall-detect/route.ts — verifySignatureAppRouter(handler) QStash-signed cron callback"

affects:
  - "01-12 (coach agent): consumes emitHandoffSignal({reason:'kb_miss',...}) for KB-miss handoff"
  - "Phase 2 senior-coach dashboard: reads escalations collection + jobHeartbeats watchdog"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED→GREEN→(no refactor needed): escalation.test.ts 7 tests, jobs.test.ts 4 tests — all green"
    - "Chainable Firestore where mock: chainableWhere.where.mockReturnValue(itself) supports N chained .where() calls"
    - "vi.importActual for real module under test alongside vi.mock in same test file"
    - "QStash mock: _verifyMode flag toggled per describe block to simulate signed/unsigned without real keys"
    - "Dedup guard: escalationsRef().where(agentUid).where(reason).where(status:'open').get() — skip add if non-empty"
    - "Heartbeat upsert: adminDb.collection('jobHeartbeats').doc(jobName).set({...}, {merge:true}) — idempotent"

key-files:
  created:
    - "src/escalation/detect.ts — findStalled, StalledAgent, FindStalledOptions; injectable clock (now param)"
    - "src/escalation/handoff.ts — emitHandoffSignal, EscalationReason, HandoffSignalInput; dedup guard"
    - "src/escalation/index.ts — public re-export of detect + handoff"
    - "src/escalation/escalation.test.ts — 7 tests: findStalled (threshold, active excluded, where-args), emitHandoffSignal (kb_miss, stall, dedup)"
    - "src/jobs/heartbeat.ts — writeHeartbeat + readHeartbeat; jobHeartbeats collection"
    - "src/jobs/jobs.test.ts — 4 tests: unsigned-rejected, signed-loop+heartbeat, zero-stalled+heartbeat, writeHeartbeat-upserts"
    - "app/api/jobs/stall-detect/route.ts — POST = verifySignatureAppRouter(handler); Node runtime; no Cloud Functions"
  modified: []

key-decisions:
  - "Dedup guard uses 3-way where chain (agentUid + reason + status:'open') — prevents alert spam for same stalled agent; T-01-35 mitigation"
  - "contextBundle stores lastActiveAt (a Date, not a PII field) and no raw PII — satisfies T-01-36 / PDPA boundary"
  - "heartbeat collection is 'jobHeartbeats' (not a typed-converter collection) — operational metadata, not user data; no tenantId converter needed; tenantId manually stamped"
  - "vi.importActual used in Test 3 to exercise real writeHeartbeat against the mocked adminDb — avoids needing a separate test file"

# Metrics
duration: ~10min
completed: "2026-05-31"
---

# Phase 01 Plan 11: Escalation Seam + QStash Stall-Detect Job Summary

**Escalation seam (findStalled over agentProfiles.lastActiveAt + emitHandoffSignal to escalations with dedup) + QStash-signed stall-detect cron callback (verifySignatureAppRouter, HMAC-verified, rejects unsigned 401) + heartbeat writer for Phase-2 UI watchdog — the no-Cloud-Functions background-job mechanism, fully offline-tested.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-31T23:45:00+08:00
- **Completed:** 2026-05-31T23:50:00+08:00
- **Tasks:** 2/2 complete (TDD for both)
- **Files created:** 7 new files, 0 modified

## Accomplishments

### Task 1: Escalation interface — stall detection + handoff signal (TDD)

**RED → GREEN (7 tests):**

- `src/escalation/detect.ts`: `findStalled({ days, now? })` queries `agentProfilesRef().where('lastActiveAt', '<', threshold).get()`. The `now` parameter is injectable for deterministic tests. Returns `[{ agentUid, seniorCoachId, lastActiveAt }]`.
- `src/escalation/handoff.ts`: `emitHandoffSignal({ agentUid, seniorCoachId, reason, contextBundle })` creates an `escalations` row via `escalationsRef().add(...)` with `status:'open'` + `openedAt: FieldValue.serverTimestamp()`. Dedup guard: `.where(agentUid).where(reason).where(status:'open').get()` — skips add if non-empty (T-01-35 mitigation).
- `src/escalation/index.ts`: public re-export of both.
- No `next` or `@/app` imports in any escalation file.

### Task 2: QStash-signed stall-detect job route + heartbeat (TDD)

**RED → GREEN (4 tests):**

- `src/jobs/heartbeat.ts`: `writeHeartbeat(jobName)` upserts `jobHeartbeats/{jobName}` with `{ job, ts: FieldValue.serverTimestamp(), tenantId: 'd2' }` using `{ merge: true }`. `readHeartbeat(jobName)` returns the latest heartbeat or `null`.
- `app/api/jobs/stall-detect/route.ts`: `POST = verifySignatureAppRouter(handler)`. Unsigned requests → 401 before handler runs (T-01-33). Signed handler: `findStalled({ days: 2 })` → `emitHandoffSignal({ reason: 'stall', ... })` for each → `writeHeartbeat('stall-detect')` → `Response.json({ processed: stalled.length })`. Node runtime.

## Task Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 RED (failing tests) | `261e89b` | src/escalation/escalation.test.ts |
| Task 1 GREEN (implementation) | `ca89561` | src/escalation/detect.ts, handoff.ts, index.ts, escalation.test.ts (mock fix) |
| Task 2 RED (failing tests) | `a9bbb25` | src/jobs/jobs.test.ts |
| Task 2 GREEN (implementation) | `d19c49c` | src/jobs/heartbeat.ts, app/api/jobs/stall-detect/route.ts, jobs.test.ts (restructure) |

## TDD Gate Compliance

- RED commits: `261e89b` (test only, failing — module not found), `a9bbb25` (test only, failing — heartbeat not found)
- GREEN commits: `ca89561` (implementation, 7/7 pass), `d19c49c` (implementation, 4/4 pass)
- Gate sequence: test → feat → test → feat (2 TDD cycles)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Chainable where() mock required 3 calls, not 2**
- **Found during:** Task 1, first vitest run (GREEN phase)
- **Issue:** `emitHandoffSignal` chains `.where(agentUid).where(reason).where(status:'open').get()` (3 calls), but the initial mock only supported 2 `.where()` calls — the 3rd returned `undefined`, causing `TypeError: ref.where(...).where(...).where is not a function`.
- **Fix:** Replaced the 2-level mock with a `chainableWhere` object that sets `chainableWhere.where.mockReturnValue(chainableWhere)` — supports unlimited chained `.where()` calls.
- **Files modified:** `src/escalation/escalation.test.ts`
- **Commit:** `ca89561`

**2. [Rule 1 - Bug] Heartbeat Test 3 called mock instead of real module**
- **Found during:** Task 2, first vitest run (GREEN phase after restructure)
- **Issue:** `vi.mock('@/src/jobs/heartbeat', ...)` caused the `import { writeHeartbeat }` at test top-level to resolve the mock function, not the real module. Test 3 (unit-testing heartbeat → adminDb) never reached `adminDb.collection()`.
- **Fix:** Used `vi.importActual('@/src/jobs/heartbeat')` inside Test 3 to get the real `writeHeartbeat` function under the mocked `adminDb`.
- **Files modified:** `src/jobs/jobs.test.ts`
- **Commit:** `d19c49c`

## Known Stubs

**emitHandoffSignal receiving side (Phase 2):** The `escalations` collection is written by Phase 1 (this plan). Reading/rendering escalations in the senior-coach dashboard is explicitly deferred to Phase 2 per D-10 ("thin receiving side in Phase 1"). This is intentional, not a stub — the Phase 1 escalation seam is fully functional.

**readHeartbeat (Phase 2 watchdog):** `readHeartbeat(jobName)` is implemented and exported but not wired to any UI widget. The Phase-2 dashboard watchdog banner will consume it.

## Threat Surface

All T-01-33/34/35/36 mitigations from the plan's threat model are implemented:

| Threat ID | Status |
|-----------|--------|
| T-01-33 (Spoofing — forged cron callback) | Mitigated: `verifySignatureAppRouter` wraps POST; test asserts unsigned → 401 |
| T-01-34 (DoS — lapsed cron silent) | Mitigated: `writeHeartbeat('stall-detect')` called on every run (including zero-stall runs); test asserts |
| T-01-35 (Tampering — duplicate escalation spam) | Mitigated: dedup guard `.where(agentUid).where(reason).where(status:'open')` — test asserts no duplicate |
| T-01-36 (Info Disclosure — raw PII in contextBundle) | Mitigated: contextBundle contains only `lastActiveAt` (Date — not PII); no name/phone/IC fields |

## Self-Check

### Files exist

- [x] `src/escalation/detect.ts` — exists, exports `findStalled`
- [x] `src/escalation/handoff.ts` — exists, exports `emitHandoffSignal`
- [x] `src/escalation/index.ts` — exists, re-exports both modules
- [x] `src/escalation/escalation.test.ts` — exists, 7 tests
- [x] `src/jobs/heartbeat.ts` — exists, exports `writeHeartbeat` + `readHeartbeat`
- [x] `src/jobs/jobs.test.ts` — exists, 4 tests
- [x] `app/api/jobs/stall-detect/route.ts` — exists, `POST = verifySignatureAppRouter(handler)`

### Commits exist

- [x] `261e89b` — test(phase-kayinleong-01): 01-11 — add failing tests for escalation detect+handoff+dedup
- [x] `ca89561` — feat(phase-kayinleong-01): 01-11 — escalation detect+handoff+dedup seam
- [x] `a9bbb25` — test(phase-kayinleong-01): 01-11 — add failing tests for stall-detect route + heartbeat
- [x] `d19c49c` — feat(phase-kayinleong-01): 01-11 — QStash-signed stall-detect route + heartbeat writer

### Test results

- `npx vitest run src/escalation/escalation.test.ts src/jobs/jobs.test.ts` → 11 passed | 0 failed
- `npx vitest run` (full suite) → 103 passed | 81 skipped | 0 failed

### Grep guards

- `grep -E "from ['\"](next|@/app)" src/escalation/*.ts` → 0 matches (pass)
- `grep -rIE "qstash_[A-Za-z0-9]{8,}" app/ src/` → 0 matches (pass)

## Self-Check: PASSED
