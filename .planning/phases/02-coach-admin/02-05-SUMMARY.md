---
phase: 02-coach-admin
plan: "05"
subsystem: jobs / escalation
tags: [lazy-cron, stall-detect, escalation, working-hours, knowledge-gaps, pdpa, eval-seam]
dependency_graph:
  requires: [02-01, 02-03]  # collections + ensurePrimaryThread
  provides: [stall-nudge, escalation-working-hours-gate, knowledge-gap-store, eval-nightly-seam]
  affects: [02-06, 02-07]   # dashboard reads knowledgeGaps; eval fills runNightlyEval
tech_stack:
  added:
    - "src/jobs/workingHours.ts (Intl.DateTimeFormat KL timezone, no new dep)"
    - "src/escalation/knowledgeGaps.ts (sha256 dedup, FieldValue.increment, PDPA-safe)"
    - "src/eval/runNightly.ts (stable seam, no-op placeholder for 02-07)"
  patterns:
    - "injectable clock via run(now: Date) propagated to all job bodies"
    - "cadence-cap: loadRecent() scan before nudge write (≤1 nudge per window)"
    - "atomic kb_miss: emitHandoffSignal + recordKnowledgeGap in handoff.ts"
    - "sha256(normalize(topic)) as Firestore doc ID for O(1) upsert-or-increment"
key_files:
  created:
    - src/jobs/workingHours.ts
    - src/escalation/knowledgeGaps.ts
    - src/eval/runNightly.ts
  modified:
    - src/jobs/runDueJobs.ts
    - src/jobs/jobs.test.ts
    - src/escalation/handoff.ts
    - src/escalation/index.ts
    - src/escalation/escalation.test.ts
decisions:
  - "D-09 RESOLVED: ON-VISIT lazy-cron (no wall-clock GitHub Actions hatch). Nudges fire on authorized visit; idle overnight defers. Heartbeat + UI watchdog surfaces stale last-run."
  - "Assumption A1 DEFAULT shipped: Asia/Kuala_Lumpur 09:00–18:00 Mon–Fri. Derek must confirm exact window before pilot."
  - "run(now: Date) interface change: JobDefinition.run now receives injectable now clock for escalate working-hours gate."
  - "Intl.DateTimeFormat used instead of date-fns-tz (not installed); no new dependency."
  - "sha256 (Node built-in crypto) for topicHash: no new dep, stable, collision-resistant."
metrics:
  duration: "~3 minutes"
  completed: "2026-06-02"
  tasks_completed: 4
  files_modified: 9
---

# Phase 02 Plan 05: Lazy-cron job bodies + knowledgeGaps store Summary

**One-liner:** Wired stall-nudge (COACH-04), 48h working-hours-gated escalation (COACH-05/CDASH-06), PDPA-safe topicHash knowledge-gap store (CDASH-03), and eval-nightly delegation seam (QUAL-06 pre-wire) into the on-visit lazy-cron registry.

## What Was Built

### Task 1: Working-hours predicate + stall nudge + 48h escalate body (COACH-04/05, CDASH-06)

**`src/jobs/workingHours.ts`** — `isWithinWorkingHours(now, opts?)` using `Intl.DateTimeFormat`:
- Default: Asia/Kuala_Lumpur, 09:00–18:00, Mon–Fri (Assumption A1 — confirm with Derek)
- No new dependency (uses V8 built-in `Intl`; `date-fns-tz` is not installed)
- Injectable opts: `tz`, `startHour`, `endHour`
- Tested: weekday/weekend/early-morning false cases, custom window opts

**`src/jobs/runDueJobs.ts`** — three bodies wired:

1. **stall-detect** (COACH-04): After `emitHandoffSignal`, writes ONE in-app nudge `MessageDoc` into `coach-${agentUid}/messages`. Cadence-cap: `loadRecent()` scans last 20 messages; writes only if no `routeDecision:'nudge'` message exists yet (T-02-20 anti-over-nudge).

2. **escalate** (COACH-05 / CDASH-06): `findStalled({days:2})` → for each agent stalled ≥48h, calls `emitHandoffSignal({reason:'stall'})` GATED by `isWithinWorkingHours(now)`. Outside working hours: skips emit, writes heartbeat and returns. No escalation is surfaced to the dashboard until the next run inside the window.

3. **JobDefinition.run** interface: changed from `() => Promise<void>` to `(now: Date) => Promise<void>` so the injectable clock flows into job bodies that need time-relative checks.

**D-09 RESOLUTION** documented in file header: on-visit-only nudges accepted for the pilot. No GitHub Actions trigger built.

### Task 2: PDPA-safe knowledgeGaps signal store (CDASH-03)

**`src/escalation/knowledgeGaps.ts`** — `recordKnowledgeGap({seniorCoachId, agentUid, topic, lang})`:
- `normalizeTopic(topic)` → lowercase + trim + collapse whitespace
- `topicHashOf(normalized)` → sha256 hex (Node `crypto`, built-in, no new dep)
- `deriveTopicLabel(normalized)` → first ≤120 chars at word boundary (no raw query stored)
- Upsert: `knowledgeGapsRef().doc(topicHash).set({...}, {merge:true})` with `FieldValue.increment(1)` + `serverTimestamp()` for `lastSeenAt`
- Dashboard read: `knowledgeGapsRef().where('seniorCoachId','==',coach.uid).orderBy('lastSeenAt','desc')`

**`src/escalation/handoff.ts`** — wired at the `kb_miss` site adjacent to `emitHandoffSignal`:
- A KB miss atomically records BOTH the escalation signal AND the PDPA-safe gap count
- Topic + lang extracted from `contextBundle` (expected for kb_miss callers)
- NEVER stores raw query text (T-02-19 mitigation)

**`src/escalation/index.ts`** — re-exports `recordKnowledgeGap` + `RecordKnowledgeGapInput`.

### Task 3: eval-nightly seam (QUAL-06 pre-wire)

**`src/eval/runNightly.ts`** — `runNightlyEval()` no-op placeholder:
- Exported from a dedicated file so 02-07 only fills this function — no registry changes
- Documented with what 02-07 must implement (Promptfoo run + evals/ write + regression flag)

**`src/jobs/runDueJobs.ts` eval-nightly body**: delegates to `runNightlyEval()` + `writeHeartbeat('eval-nightly')`.

### Task 4 (checkpoint:decision D-09): RESOLVED per user

No code built. Decision recorded: **on-visit-only nudges** for the pilot.
The wall-clock GitHub Actions hatch was NOT implemented.
Working-hours default (Assumption A1) ships as Asia/Kuala_Lumpur 09:00–18:00 Mon–Fri — Derek confirms before pilot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Enhancement] JobDefinition.run signature extended to accept `now: Date`**
- **Found during:** Task 1 implementation
- **Issue:** The `escalate` job body needs the injectable `now` clock for its working-hours gate, but the existing `run: () => Promise<void>` interface didn't pass it.
- **Fix:** Changed to `run: (now: Date) => Promise<void>` and updated `runJob` to pass `now`. All existing job bodies updated to accept and (where unused) prefix-underscore the param.
- **Files modified:** `src/jobs/runDueJobs.ts`
- **Commit:** `1879b97`

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| `src/eval/runNightly.ts` | 34 | `runNightlyEval` is a no-op | Intentional — plan 02-07 implements the Promptfoo body |
| `src/jobs/runDueJobs.ts` | 210 | `usage-rollup` no-op | Phase-3 scope (unchanged from P1) |

The `runNightlyEval` stub does NOT prevent this plan's goal from being achieved — QUAL-06 eval run is 02-07's scope. The seam wiring (heartbeat + registry) is complete.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| (none new) | — | No new network endpoints, auth paths, or schema changes beyond those in the plan's threat model |

All threats from the plan's threat register were mitigated as designed:
- T-02-19: `knowledgeGaps.ts` stores topicHash + ≤120 char topicLabel only; test asserts no verbatim storage
- T-02-20: single-nudge cadence cap via `loadRecent()` pre-scan
- T-02-21: `emitHandoffSignal` dedup guard unchanged (pre-existing)
- T-02-23: heartbeat written for all three new job bodies

## Working-Hours Default (Confirm with Derek Before Pilot)

**Assumption A1 shipped:** Asia/Kuala_Lumpur (UTC+8, no DST), 09:00–18:00 Mon–Fri

Derek must confirm before the pilot goes live:
1. Exact daily window (09:00–18:00? or 09:00–17:30?)
2. Whether public holidays are excluded (v1 does NOT exclude them — Mon–Fri only)
3. Whether nudges and escalations use different windows

To change: update `isWithinWorkingHours` defaults in `src/jobs/workingHours.ts`.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/jobs/workingHours.ts` exists | FOUND |
| `src/jobs/runDueJobs.ts` exists | FOUND |
| `src/escalation/knowledgeGaps.ts` exists | FOUND |
| `src/eval/runNightly.ts` exists | FOUND |
| Commit `1879b97` exists | FOUND |
| Commit `c5a57fc` exists | FOUND |
| `isWithinWorkingHours` in workingHours.ts | FOUND |
| `appendMessage`/`nudge` in runDueJobs.ts | FOUND (13 matches) |
| `isWithinWorkingHours` in runDueJobs.ts (escalate gate) | FOUND |
| `recordKnowledgeGap` in knowledgeGaps.ts | FOUND |
| `topicHash`/`topicLabel` in knowledgeGaps.ts | FOUND |
| `FieldValue.increment` in knowledgeGaps.ts | FOUND |
| `recordKnowledgeGap` in handoff.ts (kb_miss wire) | FOUND |
| `runNightlyEval`+`writeHeartbeat('eval-nightly')` in runDueJobs.ts | FOUND |
| `npx vitest run` green (22 files, 272 tests) | PASSED |
| `npx tsc --noEmit` clean | PASSED |
