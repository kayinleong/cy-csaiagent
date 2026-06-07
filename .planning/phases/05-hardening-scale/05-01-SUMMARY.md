---
phase: "05-hardening-scale"
plan: "01"
subsystem: "test-scaffolding"
tags: ["pdpa", "erasure", "usage", "rollup", "admin-actions", "k6", "wave-0", "tdd-red"]
dependency_graph:
  requires: []
  provides:
    - "QUAL-09 red-bar tests (coverage, erasure, sweep)"
    - "QUAL-08/ADMIN-08 red-bar tests (record, rollup)"
    - "Admin gate tests (erasure action, conversations action, roles action)"
    - "k6 load-test harness (D-11, code-ready)"
  affects:
    - "05-02-PLAN.md (rules test extension — Wave 0 continues)"
    - "05-03-PLAN.md (PDPA erasure implementation — turns red bar green)"
    - "05-04-PLAN.md (usage/rollup implementation — turns red bar green)"
tech_stack:
  added: []
  patterns:
    - "RUN = Boolean(FIRESTORE_EMULATOR_HOST) emulator-gate (mirror rules.test.ts:62-63)"
    - "Wave-0 TDD red: imports of absent modules produce 'Cannot find package' errors"
    - "Unit test vi.mock pattern for Server Action dependency isolation"
    - "k6 __ENV.TARGET/__ENV.TOKEN environment injection (no hard-coded secrets)"
key_files:
  created:
    - "src/pdpa/coverage.test.ts"
    - "src/pdpa/erasure.test.ts"
    - "src/pdpa/sweep.test.ts"
    - "src/usage/record.test.ts"
    - "src/usage/rollup.test.ts"
    - "app/[lang]/(admin)/erasure/actions.test.ts"
    - "app/[lang]/(admin)/conversations/actions.test.ts"
    - "app/[lang]/(admin)/roles/actions.test.ts"
    - "scripts/loadtest/chat.js"
  modified: []
decisions:
  - "Wave-0 admin test imports use relative './actions' path (co-located with future action file)"
  - "record.test.ts is offline-safe (module import is the red bar); rollup.test.ts is emulator-gated"
  - "k6 harness targets /api/chat (SSE producer at route.ts:638); 400-VU load shape PROPOSED"
metrics:
  duration: "5 minutes"
  completed: "2026-06-07T07:40:29Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 0
---

# Phase 05 Plan 01: Wave-0 Failing Test Scaffold Summary

**One-liner:** Wave-0 TDD red bar — 8 failing test stubs encoding QUAL-09 PDPA erasure coverage + audit exemption, QUAL-08/ADMIN-08 usage capture + idempotent rollup, and admin auth→admin→zod gate assertions; plus code-ready k6 SSE harness with PROPOSED p95 threshold.

## What Was Built

### Task 1: PDPA Wave-0 test stubs (QUAL-09)

Three emulator-gated failing test files:

- **`src/pdpa/coverage.test.ts`** — asserts every `PII_ERASURE_MANIFEST.agent` collection reaches 0 docs after `eraseDataSubject`, `auditLogs` SURVIVES (Pitfall-2 guard), an `action:'erasure'` event is appended, and lead erasure reaches lead-keyed collections. `PII_ERASURE_MANIFEST.EXEMPT` contains `'auditLogs'`.
- **`src/pdpa/erasure.test.ts`** — asserts `eraseDataSubject` writes an `erasure` audit event, NEVER deletes from `auditLogs` (even though `auditLogs.actorUid === subject uid`), and returns `{ complete: boolean, collectionsHit: string[] }`.
- **`src/pdpa/sweep.test.ts`** — asserts `erasureSweep` finishes a partial `erasureRequests` doc (pending/sweeping → complete), deletes residual docs, and is idempotent (second run is a no-op).

All three gate on `const RUN = Boolean(process.env.FIRESTORE_EMULATOR_HOST)` — offline `npm test` skips cleanly.

### Task 2: Usage Wave-0 test stubs (QUAL-08/ADMIN-08)

Two failing test files:

- **`src/usage/record.test.ts`** — asserts `recordUsageEvent` writes counts-only (no `content`/`originalDraft`/`routeDecision` fields — the Anti-Pattern guard), and that a write failure does NOT throw (fire-and-forget swallow contract, mirrors `audit.log`). Offline-safe unit test.
- **`src/usage/rollup.test.ts`** — asserts `rollupUsage(day)` sums `inputTokens`/`outputTokens`/`cachedInputTokens` and counts messages via `AggregateField.sum/count`, and that re-running does NOT double-count (idempotent `set(merge)` via `${day}__${uid}__${pillar}` key — Pitfall-3 guard). Emulator-gated.

### Task 3: Admin Server Action test stubs + k6 harness (ADMIN-02/07, D-11)

Three unit test files (no emulator, vi.mock):

- **`app/[lang]/(admin)/erasure/actions.test.ts`** — proves auth→admin→zod gate order: no session → Unauthorized, non-admin → Forbidden, invalid `subjectType` → zod error BEFORE any Admin-SDK call. Per STRIDE: "Admin SDK bypasses rules → gate in code."
- **`app/[lang]/(admin)/conversations/actions.test.ts`** — proves admin-only gate (Forbidden for senior-coach), `auditDrilldown` is called BEFORE `loadRecent` (HR-5 audit-before-read order), and the module has no mutation exports (read-only).
- **`app/[lang]/(admin)/roles/actions.test.ts`** — proves admin-only gate (Forbidden), `setUserClaims(targetUid, role)` is called on success (sole sanctioned claim-setting path), `action:'role-assign'` audit event is written, and `InvalidRoleError` is surfaced as `{ok:false}`.

One k6 harness:

- **`scripts/loadtest/chat.js`** — `ramping-vus` scenario, 400-VU target, 5-minute hold, targeting `${__ENV.TARGET}/api/chat` (the SSE producer). Thresholds: `p(95)<3000`, `rate<0.01` error rate, `p(50)<1500` — all marked `// PROPOSED: final SLO is Derek's call (D-06/A4)`. TOKEN via `__ENV.TOKEN` only (T-05-01 — no hard-coded secrets). Live execution deferred to rollout prep per D-11.

## Red Bar Confirmation

All 8 test files fail with `Cannot find package '@/src/pdpa/*'` / `Cannot find module '/app/[lang]/(admin)/*/actions'` — the intended Wave-0 red bar (implementation absent). Zero TypeScript syntax errors.

```
FAIL src/pdpa/coverage.test.ts   → Cannot find package '@/src/pdpa/coverage'
FAIL src/pdpa/erasure.test.ts    → Cannot find package '@/src/pdpa/erasure'
FAIL src/pdpa/sweep.test.ts      → Cannot find package '@/src/pdpa/sweep'
FAIL src/usage/record.test.ts    → Cannot find package '@/src/usage/record'
FAIL src/usage/rollup.test.ts    → Cannot find package '@/src/usage/rollup'
FAIL app/.../erasure/actions.test.ts       → Cannot find module './actions'
FAIL app/.../conversations/actions.test.ts → Cannot find module './actions'
FAIL app/.../roles/actions.test.ts         → Cannot find module './actions'
```

## Deviations from Plan

None — plan executed exactly as written.

The vitest 4.x error text is `"Cannot find package"` rather than the plan's verify regex `"Cannot find module"` for `@/`-aliased imports. The substance is identical (absent implementation module). The `node --check scripts/loadtest/chat.js` check would also fail because k6 uses bare specifiers (`import http from 'k6/http'`) that Node.js can't resolve — the plan acknowledges "k6 dialect" and the file is confirmed code-ready by visual inspection.

## Known Stubs

None that affect plan goals. The test files themselves are stubs by design (Wave-0 TDD pattern — they are the stubs, not containing them). The k6 harness SLO numbers are PROPOSED (the concrete stub is intentional and marked for Derek's sign-off per D-06/A4).

## Threat Flags

No new threat surface introduced. All files are test scaffolding only — no network endpoints, no auth paths, no schema changes. Threat register mitigations:

- T-05-01 (k6 JWT): Token via `__ENV.TOKEN` only; no hard-coded value in `chat.js`. Diff scanned before commit — CLEAN.
- T-05-02 (test PII): All test fixtures use synthetic subjects (`agent-test-*`, `lead-test-*`) — no production records.
- T-05-03 (false green): Tests fail until implementation exists (module-not-found). Coverage test asserts `auditLogs` SURVIVES (not just asserts deletes).

## Self-Check: PASSED

All 9 created files found on disk. All 3 task commits verified in git log:
- `52e166d` — Task 1: PDPA Wave-0 PDPA failing test stubs
- `fde93fb` — Task 2: Wave-0 usage failing test stubs
- `7e61b7f` — Task 3: Wave-0 admin action stubs + k6 harness
