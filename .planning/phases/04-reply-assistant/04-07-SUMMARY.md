---
phase: 04-reply-assistant
plan: 07
subsystem: data
tags: [firestore, collections, firestore-rules, firestore-indexes, server-action, reply-pillar, edit-signal, admin-06, append-only, downline-scope]

# Dependency graph
requires:
  - phase: 04-01
    provides: Wave-0 RED tests (diff.test.ts, reply-edit-actions.test.ts, rules.test.ts replyEdits cases) — flipped GREEN here
  - phase: 04-03
    provides: shared collections.ts + firestore.indexes.json ownership (kbChunks.pillar + kbDocs composite already landed; replyEdits indexes added additively)
provides:
  - replyEdits collection (collection 17) — ReplyEditDoc + replyEditConverter + replyEditsRef() (append-only, server-only writes, denormalized seniorCoachId)
  - src/reply/diff.ts editRatio(original, edited): number — dependency-free normalized char-level edit metric in [0,1]
  - firestore.rules match /replyEdits/{eventId} — agent-own + coach-downline + admin read; create/update/delete: if false
  - 3 additive replyEdits composite indexes (seniorCoachId+timestamp, agentUid+timestamp, sopDocIds CONTAINS+timestamp)
  - app/[lang]/chat/reply-edit-actions.ts captureReplyEdit Server Action (Admin-SDK write; the ADMIN-06 thumbsDown producer)
affects: [04-08-reply-draft-card, 04-10-reply-quality-dashboard, phase-5-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only top-level collection mirroring escalations/knowledgeGaps: deny ALL client writes (create,update,delete: if false), Admin-SDK-only writer, downline read via denormalized seniorCoachId"
    - "Dependency-free editRatio core util (bounded Levenshtein, single-row DP) — numeric edit-rate, not a diff library (RESEARCH No-Diff-Library)"
    - "Row-on-every-copy denominator (Pitfall E): write a replyEdits row even when unchanged (editRatio:0) so per-SOP edit-rate has a denominator"
    - "Optional field written only when present (`...(thumbsDown !== undefined && { thumbsDown })`) — an omitted thumbsDown stays absent, never persisted as false"

key-files:
  created:
    - src/reply/diff.ts
    - app/[lang]/chat/reply-edit-actions.ts
  modified:
    - src/firebase/collections.ts
    - firestore.rules
    - firestore.indexes.json
    - src/reply/diff.test.ts
    - src/reply/reply-edit-actions.test.ts

key-decisions:
  - "editRatio is a bounded Levenshtein normalized by max(len), clamped to [0,1]; returns 0 when strings are equal or both empty (the clean-draft denominator). No diff dependency added (D-18/D-20)."
  - "captureReplyEdit reads agentUid from the verified __session token via requireUser, NEVER from the action arguments (T-02-31). seniorCoachId is denormalized at write from agentProfiles/{agentUid} (Pitfall D) so the coach read-rule can match resource.data.seniorCoachId == request.auth.uid."
  - "tenantId is set explicitly in the .add() payload (mirrors the knowledgeGaps writer) to satisfy WithFieldValue<ReplyEditDoc> — the converter re-stamps it idempotently. A missing agentProfile is non-fatal (seniorCoachId left ''), logged as a COUNT-only warning, never PII."
  - "thumbsDown is written only when present so an omitted value stays absent (the ADMIN-06 KPI count(thumbsDown==true)/count(all) treats absent as not-thumbed)."
  - "Rules tests are emulator-gated (rulesSuite = describe.skip without FIRESTORE_EMULATOR_HOST) — the replyEdits block is structurally validated by mirroring the proven knowledgeGaps/escalations blocks; it turns GREEN against a live emulator (Java not available offline this session)."

patterns-established:
  - "Pattern 1: replyEdits collection-17 ref/converter/doc-comment copied from knowledgeGaps (collection 16) — same makeConverter tenantId stamp, same server-only doc-comment shape."
  - "Pattern 2: Server-Action getSessionUser() (await cookies() → __session → requireUser) copied verbatim from (admin)/kb/actions.ts and (coach)/dashboard/actions.ts."

metrics:
  tasks_completed: 2
  files_created: 2
  files_modified: 5
  commits: 2
  duration_minutes: 6
  completed_date: 2026-06-05
---

# Phase 4 Plan 07: Reply Edit-as-Signal Capture Layer Summary

The append-only `replyEdits` capture path for the Reply pillar: a dependency-free `editRatio` util, the collection-17 typed ref/converter with denormalized `seniorCoachId`, deny-by-default downline-scoped Firestore rules + three additive composite indexes, and the `captureReplyEdit` Server Action (Admin-SDK write, role-from-session, row-on-every-copy denominator, and the optional `thumbsDown` write that the ADMIN-06 dashboard KPI consumes).

## What Was Built

### Task 1 — `editRatio` util + `ReplyEditDoc` collection ref/converter (`d9cc1cc`)
- **`src/reply/diff.ts`** (NEW): `editRatio(original, edited): number` — a normalized character-level edit metric (bounded single-row-DP Levenshtein / `max(len)`), clamped to `[0,1]`; returns `0` on identical or both-empty strings. No diff dependency (RESEARCH §No Diff Library). Core/shell-safe: imports nothing from `app/` or `next`. JSDoc notes the dashboard needs a numeric rate, not a visual diff (D-18/D-20).
- **`src/firebase/collections.ts`** (GROW): added `interface ReplyEditDoc` (collection 17) with denormalized `seniorCoachId` + optional `thumbsDown`, `replyEditConverter = makeConverter<ReplyEditDoc>()`, and `replyEditsRef()` with the server-only/append-only doc-comment copied from `knowledgeGapsRef`. Header collection list updated to 17.
- Flipped the Wave-0 `src/reply/diff.test.ts` RED guards (`it.fails` / `@ts-expect-error`) to real GREEN assertions; added a both-empty case.

### Task 2 — `replyEdits` rules + indexes + `captureReplyEdit` Server Action (`d89dc23`)
- **`firestore.rules`** (GROW): added `match /replyEdits/{eventId}` mirroring `knowledgeGaps` — `allow read` for agent-own (`agentUid == auth.uid`), senior-coach downline (`seniorCoachId == auth.uid`), and admin (all same-tenant); `allow create, update, delete: if false` (append-only, Admin-SDK-only writes).
- **`firestore.indexes.json`** (GROW, additive — existing indexes untouched/unreordered): three `replyEdits` composites — `(seniorCoachId ASC, timestamp DESC)` coach feed, `(agentUid ASC, timestamp DESC)` agent self-view, `(sopDocIds CONTAINS, timestamp DESC)` per-SOP aggregation.
- **`app/[lang]/chat/reply-edit-actions.ts`** (NEW, `'use server'`): `captureReplyEdit(input)` — reads the agent from the verified `__session` token (`await cookies()` → `requireUser`, T-02-31), denormalizes `seniorCoachId` from `agentProfiles/{agentUid}` (Pitfall D, non-fatal on miss), computes `editRatio`, and appends one `replyEdits` row via the Admin SDK with `FieldValue.serverTimestamp()`. `thumbsDown` written only when present. Wrapped in try/catch returning `{ ok:false, error }`. Never logs draft content (T-04-EDIT-PII).
- Flipped the Wave-0 `src/reply/reply-edit-actions.test.ts` RED guards GREEN; wired the auth + Admin-SDK mocks (`next/headers`, `@/src/firebase/auth`, `@/src/firebase/collections`, `firebase-admin/firestore`); added a `seniorCoachId` denormalization + `agentUid`-from-token case.

## Verification

- `npx vitest run src/reply/diff.test.ts` — 5/5 GREEN.
- `npx vitest run src/reply/reply-edit-actions.test.ts` — 4/4 GREEN (incl. the `thumbsDown:true` ADMIN-06 producer + the `editRatio:0` denominator + omitted-thumbsDown-absent + seniorCoachId denormalization).
- `npm run test` (full offline suite) — **EXIT 0**: 503 passed | 107 skipped | **0 failed** (31 files passed, 1 skipped = the emulator-gated rules file).
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `firestore.indexes.json` — valid JSON (`JSON.parse` ok).
- `npx eslint` (touched files) — 0 errors (2 pre-existing-style warnings: unused mock-signature params).
- `npm run test:rules` — 103 skipped offline (emulator-gated, EXIT 0). The 11 `replyEdits` rules cases (agent-own allow, agent-other deny, coach-downline allow, cross-coach deny, admin allow, client create/update/delete deny, cross-tenant deny) are authored and turn GREEN against a live emulator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tenantId` required by `WithFieldValue<ReplyEditDoc>` at the `.add()` call site**
- **Found during:** Task 2 (typecheck after writing `captureReplyEdit`).
- **Issue:** `replyEditsRef().add({...})` typechecks against `WithFieldValue<ReplyEditDoc>`, which still requires `tenantId` even though the converter stamps it at runtime (TS2345: Property 'tenantId' is missing).
- **Fix:** Set `tenantId: TENANT_ID` explicitly in the payload (imported `TENANT_ID` from `@/src/firebase/collections`) — the converter re-stamps it idempotently. This mirrors the established `knowledgeGaps` writer (`src/escalation/knowledgeGaps.ts:131`). Added `TENANT_ID: 'd2'` to the test mock for parity.
- **Files modified:** `app/[lang]/chat/reply-edit-actions.ts`, `src/reply/reply-edit-actions.test.ts`
- **Commit:** `d89dc23`

**2. [Rule 3 - Blocking] Wave-0 reply-edit RED test had no auth/Admin-SDK mocks (only `collections`)**
- **Found during:** Task 2 (flipping the RED test GREEN).
- **Issue:** The Wave-0 stub only mocked `@/src/firebase/collections` (sufficient for a module-not-found RED). The real `captureReplyEdit` calls `await cookies()` + `requireUser` + `agentProfilesRef().doc().get()` + `FieldValue.serverTimestamp()`, none of which were mocked — the action would throw `Unauthorized` in the unit test.
- **Fix:** Per the 04-01 SUMMARY's stated RED→GREEN protocol ("remove the guard and wire the real mocks"), added hoisted `vi.mock` for `next/headers`, `@/src/firebase/auth`, `@/src/firebase/collections`, and `firebase-admin/firestore`, so the action's session/profile/write path resolves in isolation.
- **Files modified:** `src/reply/reply-edit-actions.test.ts`
- **Commit:** `d89dc23`

No Rule 4 (architectural) deviations. No authentication gates. The `kbChunks.pillar` + `kbDocs (pillar,category,status)` indexes referenced by the plan analog already landed in Plan 04-03 (additive, untouched here).

## Index Deploy Reminder (Pitfall F)

The three new `replyEdits` composite indexes are authored in `firestore.indexes.json` but **NOT yet deployed**. Before the coach/admin Reply Quality dashboard queries (Plan 04-10) ship, deploy them:

```
firebase deploy --only firestore:indexes
```

Without deployment the dashboard's `(seniorCoachId, timestamp)`, `(agentUid, timestamp)`, and `(sopDocIds array-contains, timestamp)` queries will throw `FAILED_PRECONDITION: requires an index`. The `firestore.rules` `replyEdits` block must likewise be deployed (`firebase deploy --only firestore:rules`) before clients rely on the downline read scope.

## Threat Mitigations Applied (from plan threat_model)

- **T-04-FORGE** (Tampering/Repudiation): rules `create, update, delete: if false`; only `captureReplyEdit` (Admin SDK) writes; append-only. Rules test asserts client write/update/delete denied.
- **T-04-DOWNLINE** (Information Disclosure): `seniorCoachId == request.auth.uid` read rule + denormalized `seniorCoachId` written by the action (Pitfall D). Rules test asserts cross-coach denied.
- **T-04-TENANT** (Information Disclosure): converter stamps `tenantId`; `sameTenant()` gates every read. Rules test asserts cross-tenant admin denied.
- **T-04-EDIT-PII** (Information Disclosure): `originalDraft`/`editedFinal` stored but never logged; only a COUNT-only profile-miss warning is logged.
- **T-04-DENOM** (data integrity): row-on-every-copy (`editRatio:0` unchanged) supplies the per-SOP edit-rate denominator (Pitfall E).

## Self-Check: PASSED

- `src/reply/diff.ts` — FOUND
- `app/[lang]/chat/reply-edit-actions.ts` — FOUND
- `src/firebase/collections.ts` contains `ReplyEditDoc` + `replyEditConverter` + `replyEditsRef` — confirmed
- `firestore.rules` contains `match /replyEdits/{eventId}` + `resource.data.seniorCoachId == request.auth.uid` + `allow create, update, delete: if false` — confirmed
- `firestore.indexes.json` parses; contains `replyEdits` indexes on `seniorCoachId`, `agentUid`, and `sopDocIds` (CONTAINS) — confirmed
- Commit `d9cc1cc` (Task 1) — FOUND
- Commit `d89dc23` (Task 2) — FOUND
