---
phase: 07-console-ia-v2-net-new-surfaces
plan: 02
subsystem: data-model
tags: [wave-1, firestore-collections, firestore-rules, composite-indexes, deny-by-default, tenant-stamp]
dependency_graph:
  requires:
    - "07-01 (Wave-0 RED rules matrices + AgentProfileDoc.cohortId?/firstCloseAt? type stubs)"
  provides:
    - "CohortDoc + cohortConverter + cohortsRef() (Collection 21)"
    - "ConversationFlagDoc + conversationFlagConverter + conversationFlagsRef() (Collection 22)"
    - "firestore.rules match /cohorts + match /conversationFlags (deny-by-default; read-only DENIED by construction)"
    - "composite indexes: conversationFlags (seniorCoachId,status) + (status,createdAt); auditLogs (action,ts) + (actorUid,ts)"
    - "Wave-0 cohorts/conversationFlags/read-only rules matrices turned GREEN (171/171 rules tests pass)"
  affects:
    - "07-03 (admin cohort CRUD + record-first-close consume cohortsRef + AgentProfileDoc fields)"
    - "07-04 (coach-scoped flag queue consumes conversationFlagsRef + (seniorCoachId,status) index)"
    - "07-05 (audit-log viewer consumes auditLogs (action,ts)/(actorUid,ts) indexes)"
tech_stack:
  added: []
  patterns:
    - "makeConverter<T>() tenantId auto-stamp for two new collections (single source of truth)"
    - "numbered ref-factory convention (Collection 21/22) — no string-literal collection names (D-23)"
    - "deny-by-default rule blocks mirroring escalations (Admin-SDK-only writes; denormalized seniorCoachId coach read-scope, Pitfall D)"
    - "read-only denied by construction — NO read-only grant token in either new rule block (D-24 / Pitfall 2)"
key_files:
  created: []
  modified:
    - "src/firebase/collections.ts"
    - "firestore.rules"
    - "firestore.indexes.json"
decisions:
  - "cohorts read rule admits any signed-in senior-coach (no per-coach scoping) — the cohort doc has no seniorCoachId, so the downline filter is applied app-side (RESEARCH Open Q3); the doc holds only non-PII metadata."
  - "conversationFlags writes are fully client-DENIED (create,update,delete: if false) — the only writer is the Admin-SDK flagConversation Server Action (07-04), mirroring escalations/replyEdits (D-09)."
  - "Both new composite-index pairs are declared now (Wave 1) even though their consuming queries land in 07-04/07-05 — the deploy checkpoint must build them before those surfaces run (Pitfall 6 FAILED_PRECONDITION)."
  - "AgentProfileDoc.cohortId?/firstCloseAt? were added in 07-01 (Wave 0) as type stubs; this plan did NOT re-add them (no duplication) — only the converter/ref usage was promoted."
metrics:
  duration_min: 12
  completed_date: 2026-06-11
  tasks: 3
  files: 3
  commits: 3
---

# Phase 7 Plan 02: Net-new Data Model Summary

**One-liner:** Shipped the entire Phase-7 net-new data model in one plan — two first-class Firestore collections (`cohorts`, `conversationFlags`) with `makeConverter` tenant-stamping converters + numbered ref factories, their deny-by-default Firestore rules (read-only DENIED by construction, coach own-downline read-scope via denormalized `seniorCoachId`, Admin-SDK-only flag writes), and the four composite indexes the Wave-2 flag/audit surfaces need — turning the Wave-0 RED rules matrices fully GREEN (171/171) before any consuming surface exists. Ends at a blocking deploy checkpoint (rules + indexes; async index build).

## What Was Built

### Task 1 — cohorts + conversationFlags collections + field confirmation (commit `e947c24`)
- `src/firebase/collections.ts`:
  - Added `interface CohortDoc` (`tenantId`, `name`, `description`, `createdAt`, `createdBy`) — Collection 21, per D-01.
  - Added `interface ConversationFlagDoc` (`tenantId`, `conversationId` REFERENCE-ONLY/content-free per D-10, `flaggedByUid`, `reason`, `status`, non-optional denormalized `seniorCoachId`, `createdAt`, `reviewedBy?`, `reviewedAt?`) — Collection 22, per D-09.
  - Added `cohortConverter` / `conversationFlagConverter = makeConverter<…>()` (tenantId auto-stamped on every write).
  - Added `cohortsRef()` (Collection 21) and `conversationFlagsRef()` (Collection 22) using the numbered `/** Collection N */` doc-comment convention; both use `adminDb` (server-only).
  - Updated the header inventory comment to list collections 21 (cohorts) + 22 (conversationFlags).
  - Confirmed `AgentProfileDoc.cohortId?` (COH-02/D-02) and `firstCloseAt?` (CLOSE-01/D-20) are present from Wave 0 — NOT re-added (no duplication).

### Task 2 — Firestore rules + composite indexes + GREEN matrices (commit `c7cf1c3`)
- `firestore.rules`:
  - Added `match /cohorts/{cohortId}` — read = (senior-coach + sameTenant) OR (admin + sameTenant); write = admin + incomingTenant (admin-only CRUD, D-03).
  - Added `match /conversationFlags/{flagId}` — read = (senior-coach + `resource.data.seniorCoachId == request.auth.uid` + sameTenant) OR (admin + sameTenant); `create, update, delete: if false` (Admin-SDK only, D-09). Mirrors the escalations block (Pitfall D).
  - CRITICAL (D-24 / Pitfall 2): NO `isAnalyticsReader()`, `hasRole('read-only')`, or `isReadOnlyRole()` grant in either block — read-only is DENIED by construction, preserving the LOCKED Phase-6 least-privilege allow-list.
- `firestore.indexes.json`: added 4 composites — `conversationFlags (seniorCoachId ASC, status ASC)`, `conversationFlags (status ASC, createdAt DESC)`, `auditLogs (action ASC, ts DESC)`, `auditLogs (actorUid ASC, ts DESC)`.

### Task 3 — Deploy checkpoint (NOT executed — live-gated)
The `checkpoint:human-verify (blocking)` deploy gate was reached. Per the Phase-1..6 convention (no live Firebase credential in this environment), `firebase deploy` was NOT run; it is surfaced as a structured human-action carried to rollout. See **## Deferred / Live-Gated** below.

## Verification

- **Full Firestore-rules suite on the emulator: 171 passed, 0 skipped, 0 failed.** The previously-RED Wave-0 matrices are now GREEN:
  - `conversationFlags collection` — coach reads own-downline SUCCEEDS, cross-coach FAILS (T-07-02), admin reads all SUCCEEDS, new-agent DENIED, ALL client create/update/delete FAIL (T-07-03).
  - `cohorts collection` — admin read+write SUCCEEDS, senior-coach reads metadata SUCCEEDS, non-admin (new-agent + senior-coach) write FAILS (T-07-05).
  - `read-only role — RO-01 matrix` — read-only DENIED read AND write on both `cohorts` and `conversationFlags` (T-07-01); all prior PII/owner-scoped + analytics-aggregate entries still pass.
- `npx tsc --noEmit` — `collections.ts` typechecks clean. The only unresolved imports are the 4 documented Wave-0 `./actions` RED stubs (created in 07-03/07-05) — pre-existing, not introduced here.
- `npx vitest run scripts/ci-guards.test.ts` — 6/6 GREEN, including Guard 3 (no read-only grant token in the cohorts/conversationFlags rule blocks), which was RED-by-design until this plan.
- Emulator ran on `127.0.0.1:8080`; `firestore.indexes.json` validated as parseable JSON.

## Deviations from Plan

None — plan executed exactly as written. (The `firebase emulators:exec` wrapper could not invoke `npx vitest` under its bundled pkg-node runtime; the rules suite was instead run against a backgrounded `firebase emulators:start` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` set — an equivalent, documented emulator-gating path that produced the required GREEN result. Not a behavioral deviation.)

## Deferred / Live-Gated

**Task 3 deploy checkpoint (blocking, carried to rollout):**
- `firebase deploy --only firestore:rules,firestore:indexes` (project region `asia-southeast1` — confirm with Derek if prompted).
- The 4 new composite indexes (`conversationFlags (seniorCoachId,status)`, `conversationFlags (status,createdAt)`, `auditLogs (action,ts)`, `auditLogs (actorUid,ts)`) must finish building (status "Enabled", not "Building") before the Wave-2 coach-scoped flag query (07-04) and audit-log filters (07-05) run — Firestore throws FAILED_PRECONDITION until an index is built (Pitfall 6).
- Confirm the deployed rules include the `cohorts` + `conversationFlags` blocks.
- (07-RESEARCH Open Q5 / A2) Confirm the App Hosting service account has Remote Config publish permission (`firebaseremoteconfig.remoteConfig.update`) before 07-05 ships Surface 6 — verifiable now or at 07-05's checkpoint.

## Known Stubs

None. Both collections ship complete (converter + ref + rules + GREEN rules-tests + indexes) — no unruled collection ships (Pitfall 6). The two `AgentProfileDoc` fields are wired (not duplicated); their write paths land in 07-03 (record-first-close, cohort assignment).

## Threat Coverage Realized (GREEN)

| Threat | Realized by |
|--------|-------------|
| T-07-01 (read-only EoP into Phase-7 collections) | No read-only grant in either rule block (ci-guard 3 GREEN); RO-01 matrix DENY read+write on cohorts + conversationFlags |
| T-07-02 (cross-coach flag read) | `resource.data.seniorCoachId == request.auth.uid` read rule; cross-coach read FAILS on emulator |
| T-07-03 (client forges/mutates a flag) | `allow create, update, delete: if false` on conversationFlags; all client writes FAIL |
| T-07-05 (client writes a cohort) | cohorts `allow write: if hasRole('admin') && incomingTenant()`; non-admin write FAILS |
| T-07-06 (cross-tenant read of a new collection) | `sameTenant()` on every read; `incomingTenant()` on cohort writes; makeConverter auto-stamps tenantId |
| T-07-SC (package installs) | accept — no new packages this plan |

## Self-Check: PASSED

- `src/firebase/collections.ts`, `firestore.rules`, `firestore.indexes.json` verified modified on disk.
- Task commits `e947c24` (collections) + `c7cf1c3` (rules + indexes) verified in git history.
- 171/171 rules tests GREEN on the emulator; 6/6 ci-guards GREEN.
