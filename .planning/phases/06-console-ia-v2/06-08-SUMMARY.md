---
phase: 06-console-ia-v2
plan: 08
subsystem: analytics-pivot + kb-contribution
tags: [AP-01, CKB-01, security, pdpa]
key-files:
  created:
    - "app/[lang]/(coach)/dashboard/per-coach-pivot.ts"
    - "src/kb/__tests__/crud-contribution.test.ts"
  modified:
    - "app/[lang]/(coach)/dashboard/actions.ts"
    - "src/kb/crud.ts"
requirements: [AP-01, CKB-01]
---

# 06-08 SUMMARY — Per-coach analytics pivot (AP-01) + senior-coach KB contribution (CKB-01)

> NOTE: the original Wave-4 executor agent dropped its connection twice (infrastructure
> socket error) without committing. The orchestrator finished this plan inline. Task 1's
> working-tree changes from the dropped run were verified correct and committed; Task 2 was
> implemented inline.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (AP-01) | `52e3c57` | `resolvePivotScope()` helper (single source of truth) + admin-gated `coachUid` branch threaded through all 3 dashboard aggregations |
| 2 (CKB-01) | `2c08a4a` | append-only audit row on the `correctKbDoc` contribution path + `crud-contribution.test.ts` |

## What was built

**AP-01 — admin per-coach analytics pivot.** Added a pure `resolvePivotScope({role, uid, coachUid})` module (`per-coach-pivot.ts`) and threaded an optional `coachUid` through `getReplyQualityMetrics`, `getFunnelV2Metrics`, `getKnowledgeGapAggregation`. The pivot is the single privilege-boundary point: `coachUid` is honored ONLY when `role === 'admin'`; a coach's `coachUid` is discarded so they stay locked to `seniorCoachId == self` (T-06-25). Reads stay `count()`/`select()` + `auditDrilldown`. The existing role gate is unchanged — these coach/admin actions still Forbid `read-only`.

**CKB-01 — audited senior-coach KB contribution.** `correctKbDoc` (already `assertAdminOrCoach`, already stamps `correctedBy: user.uid`) now also writes an append-only, hashes-only audit row (`action: 'kb_contribution'`, actor = contributor). KB docs are org-wide knowledge with no per-doc owner field, so the downline-accountability control is **attribution (`correctedBy`) + audit + the version chain**, NOT a per-doc owner scope. No `seniorCoachId` field was added to KB. All other KB CRUD stays `assertAdmin`; `read-only` and `new-agent` are rejected by `assertAdminOrCoach`.

## Deviations

- **`per-coach-pivot.ts` is a new module** (not in the plan's `files_modified`) — created because the Wave-0 test imports `resolvePivotScope` from `./per-coach-pivot`, and a pure (no `'use server'`) module is needed to export a synchronous function the `'use server'` `actions.ts` can import. (Rule 3 — necessary structural deviation.)
- **CKB-01 scoping uses attribution+audit, not a per-doc `seniorCoachId`** — this matches the corrected plan (commit `429a3f2`): KB is org-wide, so a per-doc downline scope would be meaningless. Acceptance gates updated accordingly (`grep correctedBy` passes; `grep seniorCoachId src/kb/crud.ts` returns 0).

## Verification

- `npx tsc --noEmit` → 0 errors.
- `per-coach-pivot.test.ts` → 4/4 GREEN; `crud-contribution.test.ts` → 4/4 GREEN; `kb.test.ts` (existing correctKbDoc tests) → still GREEN (audit addition is fire-and-forget, did not break them).
- Acceptance greps: `correctedBy` present in crud.ts (8); `seniorCoachId` in crud.ts = 0; `coachUid` honored only for admin (grep-confirmed); `read-only` = 0 hits in dashboard/actions.ts gates.
- **Full suite: 602 passed / 0 failed / 168 skipped** (pre-Phase-6 baseline was 554 passed; +48 new Phase-6 tests GREEN; no regression). The 168 skipped include the emulator-gated read-only rules matrix (runs under `FIRESTORE_EMULATOR_HOST`).

### Regression report
- **Regression surface:** the 3 coach dashboard aggregations (now accept `coachUid`), `computeEscalationRate` (signature changed to take resolved `seniorCoachId | null`), and `src/kb/crud.ts` (audit import + call in `correctKbDoc`).
- **Ruled out:** existing 3-role scoping behavior unchanged (admin org-wide / coach self) — `resolvePivotScope` reduces to the prior two-branch behavior when `coachUid` is absent; read-only stays Forbidden on these actions (gate untouched). The audit addition is fire-and-forget (try/catch-swallowed) so it cannot break `correctKbDoc` even where `auditLogsRef` is unmocked — existing `kb.test.ts` correctKbDoc tests stay green. No KB schema change. Core/shell split intact (`crud.ts` imports `@/src/audit/log`, never `app/`).
- **Result:** No regression — full suite green, +48 passing.

## Self-Check: PASSED
