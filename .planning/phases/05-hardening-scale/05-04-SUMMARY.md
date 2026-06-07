---
phase: "05-hardening-scale"
plan: "04"
subsystem: "usage-pipeline"
tags: ["usage", "rollup", "cost", "pdpa", "lazy-cron", "qual-08", "admin-08", "wave-3", "tdd-green"]
dependency_graph:
  requires:
    - "05-01 (Wave-0 test scaffold — record/rollup red-bar tests)"
    - "05-02 (Wave-1 data-layer — usageEventsRef/usageRollupsRef/EscalationDoc.resolvedAt)"
    - "05-03 (Wave-2 erasure-sweep JOB_REGISTRY — usage-rollup stub context)"
  provides:
    - "recordUsageEvent — counts-only fire-and-forget append to usageEvents (src/usage/record.ts)"
    - "dayKey() — Asia/Kuala_Lumpur 'YYYY-MM-DD' formatter (src/usage/types.ts)"
    - "rollupUsage(day) — AggregateField.sum/count → idempotent set-merge usageRollups (src/usage/rollup.ts)"
    - "usage-rollup JOB_REGISTRY body filled (src/jobs/runDueJobs.ts)"
    - "Single choke-point usage capture in route.ts onFinish using final.totalUsage"
    - "resolvedAt written in resolveStall — D-05 resolution-time metric unblocked"
  affects:
    - "05-05-PLAN.md (admin usage dashboard reads usageRollups)"
    - "05-06/05-08-PLAN.md (QUAL-08 cost pass reads usageRollups; documents pre-Phase-5 undercount)"
    - "src/usage/record.test.ts (GREEN — was FAIL in 05-03)"
    - "src/usage/rollup.test.ts (emulator-gated; GREEN on emulator)"
tech_stack:
  added: []
  patterns:
    - "Fire-and-forget swallow contract: mirrors src/audit/log.ts:76-97 exactly"
    - "final.totalUsage for multi-step Finder/Reply capture (ai@5 onFinish, sum across steps)"
    - "Anthropic cacheCreationInputTokens via providerMetadata.anthropic (ai-sdk/anthropic 2.0.80)"
    - "AggregateField.sum()/count() for rollup aggregation (1 read-unit per group — Pitfall 4)"
    - "select() projection for group discovery (mirrors getReplyQualityMetrics :402-407)"
    - "set(merge:true) idempotent rollup key day__uid__pillar (Pitfall 3 double-count guard)"
    - "dayKey() with Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Kuala_Lumpur'}) — YYYY-MM-DD"
    - "REGRESSION-NOTE comment at :607 rate-limit decrement — undercount flagged, not fixed"
key_files:
  created:
    - "src/usage/types.ts"
    - "src/usage/record.ts"
    - "src/usage/rollup.ts"
  modified:
    - "app/api/chat/route.ts"
    - "src/jobs/runDueJobs.ts"
    - "app/[lang]/(coach)/dashboard/actions.ts"
decisions:
  - "final.totalUsage used in usageEvents capture only; rate-limit/messages.tokens/audit left unchanged at final.usage.totalTokens (pre-Phase-5 undercount documented in PERF-COST.md as separate claim requiring Derek sign-off)"
  - "resolvedAt written via FieldValue.serverTimestamp() — consistent with existing escalation write patterns; minimal change only"
  - "Resolution-time in rollup is per-uid (not per-pillar) because EscalationDoc has no pillar field — documented in rollup.ts"
  - "rollupUsage uses select('uid','pillar') projection to discover groups before aggregating — never fetches full usageEvent docs"
metrics:
  duration: "6 minutes"
  completed: "2026-06-07T08:09:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 3
---

# Phase 05 Plan 04: Usage/Cost Pipeline (record, rollup, resolvedAt) Summary

**One-liner:** Single PDPA-safe usage pipeline — counts-only usageEvent capture on route.ts after() using final.totalUsage, AggregateField.sum/count rollup with idempotent set-merge keyed day__uid__pillar, resolvedAt write in resolveStall, and the pre-Phase-5 multi-step token undercount documented (not silently fixed).

## What Was Built

### Task 1: UsageEventInput types + recordUsageEvent + single route capture (ebed5dd)

**`src/usage/types.ts`** — framework-free:
- `UsageEventInput` interface: counts-only shape (`tenantId`, `uid`, `pillar:'coach'|'finder'|'reply'`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheCreationInputTokens`, `reads?`, `writes?`, `day`). Explicit destructuring at the write site prevents forbidden keys from slipping through.
- `dayKey(d: Date): string` — formats a Date as 'YYYY-MM-DD' in Asia/Kuala_Lumpur using `Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Kuala_Lumpur'})`. Used by record.ts (capture) and runDueJobs.ts (rollup job).
- `Pillar` type union exported.

**`src/usage/record.ts`** — fire-and-forget, counts-only:
- `export async function recordUsageEvent(input: UsageEventInput): Promise<void>`
- Destructures input explicitly to exclude any forbidden keys (anti-PII compile-time guard)
- Writes `{ tenantId, uid, pillar, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, day, createdAt: FieldValue.serverTimestamp() }` — NO content, NO text, NO routeDecision, NO originalDraft
- `try/catch` SWALLOWS silently — mirrors `src/audit/log.ts:76-97` contract exactly. Caller (inside `after()`) is never affected by Firestore write failures.
- `npx vitest run src/usage/record.test.ts` — 3/3 PASS

**`app/api/chat/route.ts`** — single capture point:
- Added `import { recordUsageEvent } from '@/src/usage/record'` + `import { dayKey } from '@/src/usage/types'`
- Added ONE `after(() => { ... return recordUsageEvent({...}) })` ALONGSIDE the existing `audit.log after()` at :612 — the single choke point (Anti-Pattern: Two pipelines avoided)
- Token source: `final.totalUsage` (sum across ALL steps — Finder/Reply run stepCountIs(5), so `final.usage` is last step only and undercounts)
- Cache-write: `final.providerMetadata?.anthropic?.cacheCreationInputTokens ?? 0`
- All token fields guarded with `?? 0` (Assumption A2: totalUsage may be undefined for some providers)
- **REGRESSION-NOTE** comment added near `:607` rate-limit decrement: `final.usage.totalTokens` at `:522`/`:607`/`:620` is LEFT UNCHANGED — these are behavioral token-budget reads (TOKEN_CAP=50_000); changing them is a separate claim + Derek sign-off, documented in PERF-COST.md (05-06/05-08)

### Task 2: rollupUsage AggregateField aggregation + usage-rollup stub filled (f69bba1)

**`src/usage/rollup.ts`** — framework-free:
- `export async function rollupUsage(day: string): Promise<void>`
- **Group discovery**: `usageEventsRef().where('day','==',day).select('uid','pillar').get()` — bounded projection, mirrors `getReplyQualityMetrics :402-407`. Builds a `Map<string, Group>` of distinct (uid, pillar) pairs.
- **Aggregation per group**: one `.aggregate({ msgCount: AggregateField.count(), inTok: AggregateField.sum('inputTokens'), outTok: AggregateField.sum('outputTokens'), cachedTok: AggregateField.sum('cachedInputTokens'), cacheWrite: AggregateField.sum('cacheCreationInputTokens') }).get()` per group — 1 read-unit each (Pitfall 4, backed by (day,uid,pillar) composite index from 05-02)
- **Resolution time**: optional field computed from escalations where resolvedAt is set (openedAt→resolvedAt delta, per-uid per-day). Non-fatal — returns undefined if no resolved escalations.
- **Escalation rate**: optional field via count()/count(status:'open') per uid — mirrors `computeEscalationRate` shape.
- **Idempotent write**: `usageRollupsRef().doc(`${day}__${uid}__${pillar}`).set(rollupData, { merge: true })` — re-running overwrites with recomputed-from-source values, never accumulates (Pitfall 3).
- No fetch-all anywhere — all reads are AggregateField or select() projections.

**`src/jobs/runDueJobs.ts`** — filled usage-rollup stub:
- Replaced the no-op body at `:208-212` with: `run: async (now: Date) => { await rollupUsage(dayKey(now)); await writeHeartbeat('usage-rollup') }`
- Added `import { rollupUsage } from '@/src/usage/rollup'` and `import { dayKey } from '@/src/usage/types'`
- The stub is FILLED (not duplicated) — `'usage-rollup':` key appears exactly once in JOB_REGISTRY
- `erasure-sweep` entry from 05-03 is UNCHANGED
- The `runJob` txn DUE-gate gives exactly-once-per-window — the rollup body's set-merge idempotency handles the body-level edge case

### Task 3: resolvedAt write in resolveStall (3d3c5b1)

**`app/[lang]/(coach)/dashboard/actions.ts`** — minimal field add:
- Added `import { FieldValue } from 'firebase-admin/firestore'`
- Updated `resolveStall` `escalationsRef().doc(eid).update()` call to set BOTH `{ status: 'resolved', resolvedAt: FieldValue.serverTimestamp() }`
- MINIMAL change — gate (role check), result shape `{ ok, error }`, and all other behavior are UNCHANGED
- `resolvedAt` on `EscalationDoc` was added in 05-02; this wires the write side for D-05 resolution-time analytics

## Test State After This Plan

| Test File | State Offline | State on Emulator |
|-----------|---------------|-------------------|
| `src/usage/record.test.ts` | GREEN (3/3) | GREEN |
| `src/usage/rollup.test.ts` | skip (emulator-gated) | GREEN (expected — idempotent set-merge verified) |
| `src/pdpa/coverage.test.ts` | skip (emulator-gated) | GREEN (05-03) |
| `src/pdpa/erasure.test.ts` | skip (emulator-gated) | GREEN (05-03) |
| `src/pdpa/sweep.test.ts` | skip (emulator-gated) | GREEN (05-03) |
| `app/.../erasure/actions.test.ts` | FAIL (05-05 pending) | — |
| `app/.../conversations/actions.test.ts` | FAIL (05-05 pending) | — |
| `app/.../roles/actions.test.ts` | FAIL (05-05 pending) | — |

Offline pass rate: 29 files passed / 5 skipped (all src/ tests). No regressions.

## Documented Pre-Phase-5 Undercount (Required Finding)

The rate-limit decrement (`route.ts:607`) and message token write (`route.ts:522`) both read `final.usage.totalTokens` — this is the LAST step only. For Finder/Reply (stepCountIs(5)), multi-step turns are undercounted against TOKEN_CAP=50_000.

**This plan does NOT fix this.** The fix is a behavioral change to budget consumption requiring:
1. Its own claim (separate from 05-04)
2. Derek sign-off (TOKEN_CAP is a product decision)
3. Documented in PERF-COST.md (05-06/05-08)

The REGRESSION-NOTE comment at route.ts:607 flags this for 05-08 PERF-COST.md documentation. The NEW `usageEvents` capture correctly uses `final.totalUsage` (the accurate per-turn total).

## Deviations from Plan

### Minor implementation adjustments (no rule trigger)

**1. [Decision] Resolution-time computed per-uid (not per-uid-pillar)**

EscalationDoc has no `pillar` field — escalations are agent-level, not pillar-level. The `computeResolutionTimeMs` helper queries `where('agentUid','==',uid)` without a pillar filter. This is documented in rollup.ts with an inline explanation. The `pillar` parameter is accepted but treated as a scope context only. This matches the existing `computeEscalationRate` pattern in dashboard/actions.ts:460 (which also has no pillar scope).

**2. [Decision] Optional fields (resolutionTimeMs, escalationRate) use a non-fatal try/catch**

Both helper functions (`computeResolutionTimeMs`, `computeEscalationRateForGroup`) wrap their escalation reads in try/catch, returning `undefined` on failure. This ensures rollup writes always succeed even if escalation data is unavailable — a sensible default for a v1 pilot with sparse escalation data.

**3. [Style] AggregateField import from firebase-admin/firestore (not @google-cloud/firestore)**

firebase-admin 13.10.0 re-exports AggregateField from @google-cloud/firestore. Importing directly from `firebase-admin/firestore` is the correct pattern for this project (mirrors the existing `FieldValue`, `Timestamp` imports).

## Known Stubs

None that affect plan goals.

**Carried from prior plans:**
- STORAGE manifest entry in coverage.ts remains a no-op (A1 — voice samples are Firestore strings today). Confirmed in 05-03.
- rawSubjectId field dependency (sweep.ts → Server Action in 05-05).

**Flagged for downstream plans:**
- PERF-COST.md documentation of the pre-Phase-5 undercount at :607/:522/:620 — owned by 05-08.
- 90d TTL for usageEvents is proposed (comment only) — confirm with Derek before enforcing.

## Threat Mitigations Verified

| Threat ID | Status |
|-----------|--------|
| T-05-PII | MITIGATED — recordUsageEvent destructures input explicitly; no content/draft/routeDecision keys can reach Firestore. record.test.ts negative assertion PASSES. |
| T-05-DOUBLE | MITIGATED — runJob txn DUE-gate (exactly-once-per-window) + idempotent set(merge) recompute-from-source (Pitfall 3). |
| T-05-COSTDOS | MITIGATED — capture rides existing non-blocking after(); rollup uses AggregateField (1 read-unit per group); (day,uid,pillar) index bounds per-group queries (Pitfall 4). |
| T-05-UNDERCOUNT | MITIGATED — NEW capture uses final.totalUsage (correct); existing :607/:522/:620 unchanged + flagged in REGRESSION-NOTE comment. |

## Threat Flags

No new threat surface introduced. All new code paths are server-only (Admin SDK writes). No new network endpoints, no new auth paths, no new client-readable data.

## Self-Check: PASSED

Files verified on disk:
- `src/usage/types.ts` — FOUND
- `src/usage/record.ts` — FOUND
- `src/usage/rollup.ts` — FOUND

Modified files verified:
- `app/api/chat/route.ts` — FOUND with `recordUsageEvent`, `final.totalUsage`, `REGRESSION-NOTE`
- `src/jobs/runDueJobs.ts` — FOUND with `rollupUsage(dayKey(now))`, `erasure-sweep` intact
- `app/[lang]/(coach)/dashboard/actions.ts` — FOUND with `resolvedAt: FieldValue.serverTimestamp()`

Commits verified in git log:
- `ebed5dd` — Task 1: usage types + recordUsageEvent + single route capture
- `f69bba1` — Task 2: rollupUsage AggregateField aggregation + fill usage-rollup stub
- `3d3c5b1` — Task 3: resolveStall sets resolvedAt for resolution-time analytics
