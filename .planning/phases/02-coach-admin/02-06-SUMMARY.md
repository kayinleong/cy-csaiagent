---
phase: "02"
plan: "06"
subsystem: "senior-coach-dashboard"
tags: [dashboard, downline, auth, cdash, recharts, audit, i18n, tdd, correction]
dependency_graph:
  requires: [02-01, 02-02, 02-04, 02-05, 02-08]
  provides: [senior-coach-dashboard, downline-queries, audit-drilldown, inline-correction]
  affects: [src/audit/log.ts, src/i18n/messages]
tech_stack:
  added: []
  patterns:
    - RSC role gate + client island (recharts)
    - Server Action for dashboard mutations (resolveStall, submitCorrection)
    - Double-gate downline scoping (query filter + Firestore rules from 02-01)
    - auditDrilldown fire-and-forget on every coach read (PDPA)
    - TDD RED → GREEN (dashboard.test.ts)
    - Reused kb-doc-form pollIngestion pattern for inline-correction re-ingest poll
key_files:
  created:
    - src/dashboard/queries.ts
    - src/dashboard/metrics.ts
    - src/dashboard/dashboard.test.ts
    - app/[lang]/(coach)/layout.tsx
    - app/[lang]/(coach)/dashboard/page.tsx
    - app/[lang]/(coach)/dashboard/actions.ts
    - app/[lang]/(coach)/_components/downline-table.tsx
    - app/[lang]/(coach)/_components/stall-inbox.tsx
    - app/[lang]/(coach)/_components/knowledge-gap-feed.tsx
    - app/[lang]/(coach)/_components/inline-correction-dialog.tsx
    - app/[lang]/(coach)/_components/metrics-panel.tsx
  modified:
    - src/audit/log.ts (added auditDrilldown)
    - src/i18n/messages/en.json (added dashboard namespace)
    - src/i18n/messages/ms.json (added dashboard namespace)
    - src/i18n/messages/zh.json (added dashboard namespace)
decisions:
  - "Downline read uses adminAll flag to skip seniorCoachId filter for admin role; still audited"
  - "auditDrilldown re-exported from queries.ts so callers import from one place"
  - "trainingFunnel stallRate proxy = agents at 'start' checkpoint (no advanced stall detection)"
  - "COACH-10 (5-10 pilot) is ops provisioning via set-claims (02-01 Task 3) — documented below"
  - "Transcript drilldown: not shown in dashboard (summaries+bundles only, per A6/Pitfall 5)"
  - "recharts in client islands only (MetricsPanel) — verified no recharts import in RSC"
metrics:
  duration_minutes: 9
  completed_date: "2026-06-02"
  tasks_completed: 3
  files_changed: 14
---

# Phase 02 Plan 06: Senior-Coach Dashboard Summary

**One-liner:** Role-gated senior-coach dashboard with downline-scoped reads (double-gated), audited drilldowns, stall inbox, knowledge-gap feed, recharts training-funnel + ramp metrics, and inline KB correction with attributed re-ingest poll.

## What Was Built

### Task 1: Downline-scoped query + metric helpers (TDD — RED/GREEN)

**RED commit:** `b526947` — 21 failing tests covering getDownline/getOpenStalls/getKnowledgeGaps, cross-coach exclusion, audit-on-read, daysInJourney/checkpointVelocity/trainingFunnel, no-lead/close assertion.

**GREEN commit:** `ec70b77`

- `src/dashboard/queries.ts` — `getDownline`, `getOpenStalls`, `getKnowledgeGaps` each apply `where('seniorCoachId','==',coachUid)` server-side (AUTH-06 gate 1). Each calls `auditDrilldown(coachUid, <collection>)` before returning data (PDPA / TSD §5.1). Admin `{ adminAll: true }` flag skips filter but still audits.
- `src/dashboard/metrics.ts` — pure `daysInJourney`, `checkpointVelocity`, `trainingFunnel`. No lead/close fields (Pitfall 8 — Phase 3 only).
- `src/audit/log.ts` — added `auditDrilldown(actorUid, targetRef)` convenience that logs `action:'coach_drilldown'` storing hashes only (T-02-29).

All 21 tests pass GREEN. Cross-coach exclusion verified by mock returning only COACH_A's agents when filtered.

### Task 2: Dashboard RSC + four read panels (commit `bccad9c`)

- `app/[lang]/(coach)/layout.tsx` — minimal coach route group shell.
- `app/[lang]/(coach)/dashboard/page.tsx` — RSC role gate mirrors (admin)/kb/page.tsx but accepts role ∈ {'senior-coach','admin'}; others redirect to chat. Reads session cookie → synthetic Request → requireUser. Runs getDownline/getOpenStalls/getKnowledgeGaps in parallel, derives metrics server-side, passes serializable data to client islands. No recharts import (Pitfall 7 compliant).
- `app/[lang]/(coach)/dashboard/actions.ts` — `resolveStall(eid)` sets escalation status:'resolved'; `submitCorrection(docId, content)` delegates to `correctKbDoc` (both Server Actions with session-cookie auth, T-02-31).
- `_components/downline-table.tsx` — CDASH-01: Table with agent UID (truncated, PDPA), stage badge, checkpoint, days, velocity, stall badge.
- `_components/stall-inbox.tsx` — CDASH-02: Open stalls list with reason + time + resolve button (optimistic removal).
- `_components/knowledge-gap-feed.tsx` — CDASH-03: Gap feed with PDPA-safe topicLabel, count, lang, lastSeen.
- `_components/metrics-panel.tsx` — CDASH-05/07: recharts `'use client'` island with BarChart (training funnel) + LineChart (checkpoint velocity/ramp). No recharts in RSC.
- `src/i18n/messages/{en,ms,zh}.json` — `dashboard` namespace added (44 keys); chat+kb namespaces untouched (talkToCoach + versionHistory keys verified present).

### Task 3: Inline AI correction → attributed KB re-ingest (commit `e198721`)

- `_components/inline-correction-dialog.tsx` — Dialog component where coach enters KB doc ID + corrected plain-text content. Calls `submitCorrection` Server Action → `correctKbDoc(user, docId, content)` (role enforced in crud.ts). Dialog polls `/api/kb/ingest/process` until remaining === 0 (reuses exact `pollIngestion` pattern from kb-doc-form.tsx, established in 02-08). Toast: "Correction published; previous version superseded." Attribution surfaced in dialog description: "corrected by you" (correctedBy stamped by 02-02 backend).

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep "getDownline\|getOpenStalls\|getKnowledgeGaps" queries.ts` | PASS — all present with seniorCoachId filter |
| `grep "daysInJourney\|checkpointVelocity\|trainingFunnel" metrics.ts` | PASS — all present, no lead/close |
| `grep "auditDrilldown\|coach_drilldown" log.ts + queries.ts` | PASS — present in both |
| `npx vitest run src/dashboard src/audit` | PASS — 28 tests, 3 files |
| `grep "senior-coach" page.tsx` shows role gate | PASS |
| `grep "redirect" page.tsx` present | PASS — 3 redirects |
| `grep "recharts" metrics-panel.tsx` in 'use client' file | PASS |
| dashboard namespace in en/ms/zh.json | PASS |
| chat + kb keys preserved | PASS — talkToCoach + versionHistory verified |
| No recharts import in RSC page | PASS — import verified absent |
| `grep "submitCorrection" actions.ts` calls correctKbDoc | PASS |
| `grep "ingest/process" inline-correction-dialog.tsx` | PASS — poll line 81 |
| `npx tsc --noEmit` | PASS — clean |
| `npx vitest run` (full suite) | PASS — 325 passed, 87 skipped (pre-existing) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Test cast type error**
- **Found during:** Task 1 (test compilation)
- **Issue:** `(auditModule as { log: typeof mockAuditLog }).log` caused TS2352 because the module type doesn't overlap with the mock type.
- **Fix:** Cast through `unknown` first: `(auditModule as unknown as { log: typeof mockAuditLog }).log`
- **Files modified:** `src/dashboard/dashboard.test.ts`
- **Commit:** `bccad9c` (bundled with Task 2 commit)

**2. [Rule 3 - Blocking Issue] inline-correction-dialog needed before typecheck passed**
- **Found during:** Task 2 (`page.tsx` imports `../\_components/inline-correction-dialog` which didn't exist yet)
- **Fix:** Created Task 3's component during Task 2 to resolve the TypeScript type error; both tasks committed separately.
- **Files modified:** `app/[lang]/(coach)/_components/inline-correction-dialog.tsx`

## COACH-10 Provisioning Note

COACH-10 (5–10 agent pilot) is an ops provisioning task, not a code change. To provision pilot agents:

```bash
# Provision a senior coach:
npx ts-node scripts/set-claims.ts <coachUid> senior-coach

# Provision a new agent under the coach:
npx ts-node scripts/set-claims.ts <agentUid> new-agent --seniorCoachId <coachUid>
```

The `set-claims` script (from 02-01 Task 3) sets Firebase Auth custom claims (`role`, `tenantId`) and creates/upserts the `agentProfiles/{uid}` doc with `seniorCoachId` stamped — this is the relationship the dashboard queries filter on (`where('seniorCoachId','==',coach.uid)`).

## Transcript Drilldown Decision (A6 / Pitfall 5)

The dashboard shows **escalation bundles + summaries only** — no raw conversation transcript. This was the recommended default (A6) to avoid adding a server-coach downline read rule for `conversations/{cid}/messages`. The `conversations` rules remain owner-only + admin. Any future full-transcript drilldown requires: (a) a denormalized `uplineCoachId` field on the conversation doc, (b) a Firestore rule for `hasRole('senior-coach') && doc.uplineCoachId == request.auth.uid`, and (c) audit logging.

## Known Stubs

None — all dashboard panels receive real Firestore data from the server-side query helpers. Charts and tables display live downline data. Re-ingest poll wires to the real `/api/kb/ingest/process` route.

**UI/charts note:** recharts charts and table rendering are not browser-verifiable offline. The 'use client' island structure and import chain are verified by `tsc --noEmit`. Browser rendering requires the live stack (SPIKE-DEPLOY gate from Phase 1).

## Playwright E2E Stub

`e2e/coach-dashboard.spec.ts` (coach sees only downline; cross-coach denied) is documented in the Wave 0 gaps of 02-RESEARCH.md. It is scaffolded for the live deploy — the double-gate (query filter + Firestore rules from 02-01) is unit-tested server-side (dashboard.test.ts cross-coach case). E2E execution is gated by SPIKE-DEPLOY.

## Threat Surface Scan

No new network endpoints were added (dashboard reads are server-side RSC). The only new trust boundary is the `(coach)` route group, which uses the same session-cookie + requireUser gate as `(admin)/kb`. The `submitCorrection` Server Action is role-gated and delegates to `correctKbDoc` which enforces the same role check.

## Self-Check: PASSED

```
src/dashboard/queries.ts          ✓ exists
src/dashboard/metrics.ts          ✓ exists
src/dashboard/dashboard.test.ts   ✓ exists
app/[lang]/(coach)/layout.tsx     ✓ exists
app/[lang]/(coach)/dashboard/page.tsx    ✓ exists
app/[lang]/(coach)/dashboard/actions.ts  ✓ exists
app/[lang]/(coach)/_components/downline-table.tsx           ✓ exists
app/[lang]/(coach)/_components/stall-inbox.tsx              ✓ exists
app/[lang]/(coach)/_components/knowledge-gap-feed.tsx       ✓ exists
app/[lang]/(coach)/_components/inline-correction-dialog.tsx ✓ exists
app/[lang]/(coach)/_components/metrics-panel.tsx            ✓ exists
src/audit/log.ts (auditDrilldown)  ✓ exists

Commits:
  b526947 test(phase-kayinleong-02): 02-06 — RED ✓
  ec70b77 feat(phase-kayinleong-02): 02-06 — Task 1 ✓
  bccad9c feat(phase-kayinleong-02): 02-06 — Task 2 ✓
  e198721 feat(phase-kayinleong-02): 02-06 — Task 3 ✓

npx tsc --noEmit: CLEAN
npx vitest run:   325 passed | 87 skipped
```
