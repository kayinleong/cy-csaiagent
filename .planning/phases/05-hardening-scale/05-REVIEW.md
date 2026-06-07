---
phase: 05-hardening-scale
reviewed: 2026-06-07T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/pdpa/coverage.ts
  - src/pdpa/erasure.ts
  - src/pdpa/sweep.ts
  - src/usage/types.ts
  - src/usage/record.ts
  - src/usage/rollup.ts
  - src/jobs/runDueJobs.ts
  - src/firebase/collections.ts
  - firestore.rules
  - app/api/chat/route.ts
  - app/[lang]/(admin)/erasure/actions.ts
  - app/[lang]/(admin)/erasure/page.tsx
  - app/[lang]/(admin)/erasure/erasure-request-form.tsx
  - app/[lang]/(admin)/erasure/erasure-status-list.tsx
  - app/[lang]/(admin)/conversations/actions.ts
  - app/[lang]/(admin)/conversations/page.tsx
  - app/[lang]/(admin)/conversations/conversation-viewer.tsx
  - app/[lang]/(admin)/roles/actions.ts
  - app/[lang]/(admin)/roles/page.tsx
  - app/[lang]/(admin)/roles/role-assignment.tsx
  - app/[lang]/(admin)/usage/page.tsx
  - app/[lang]/(admin)/usage/usage-dashboard.tsx
  - app/[lang]/(coach)/dashboard/actions.ts
  - app/[lang]/(coach)/dashboard/page.tsx
  - app/[lang]/(coach)/_components/funnel-v2-panel.tsx
  - app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx
  - app/[lang]/(coach)/_components/correction-eval-panel.tsx
  - app/[lang]/_components/app-sidebar.tsx
  - scripts/loadtest/chat.js
findings:
  critical: 1
  warning: 6
  info: 6
  total: 13
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-07
**Depth:** standard
**Files Reviewed:** 28 (29 in scope; 1 lock/non-source excluded)
**Status:** issues_found

## Summary

Phase 5 (Hardening + Scale-Up) wires up PDPA data erasure, the usage/cost pipeline, three new admin surfaces (erasure, conversations, roles), the usage dashboard, three CDASH-08 coach panels, and a k6 load-test harness. The phase-specific security invariants are largely well-implemented and clearly documented:

- The **three-layer admin gate** holds on all destructive/sensitive Server Actions — role is read from the verified token (`requireUser`), never from args, on every action (`eraseDataSubjectAction`, `getBlastRadius`, `listErasureRequests`, `assignRole`, `getConversationForReview`, `searchConversations`).
- `auditLogs` is **correctly EXEMPT-by-construction** in the erasure cascade (the `exemptSet` guard plus the `getCollectionRef` switch that has no `auditLogs` case) — the `actorUid==uid` foot-gun is avoided.
- The single `PII_ERASURE_MANIFEST` is the sole source of collection names; `getBlastRadius`/`listErasureRequests`/`erasureSweep`/`eraseDataSubject` all iterate it.
- Conversation drill-down writes `auditDrilldown` **before** returning messages (audit-before-data) and exposes no mutation path.
- Usage capture is a **single site** (`route.ts` onFinish `after()`), uses `final.totalUsage` (not `final.usage`), and persists counts only.
- The 3 new collections (`usageEvents`/`usageRollups`/`erasureRequests`) are deny-by-default in `firestore.rules` (client `create,update,delete: if false`; admin-only read). No existing rule was widened.
- `setUserClaims` is the sole claim-mutation path in `assignRole`.

**However, one critical PDPA invariant is violated:** the erasure Server Action persists the **raw subject id in plaintext** (`rawSubjectId: id`) on the `erasureRequests` doc, directly contradicting the schema contract ("`subjectIdHash` only — NEVER the raw subject id") and the documented T-05-RAWID mitigation. See CR-01.

There are also several correctness bugs that defeat the intent of the code (load-test never exercises the chat path; conversation `lastMessageAt` is always empty; blast-radius counts are whole-collection, not subject-scoped; usage-window boundary is computed in the wrong timezone).

## Critical Issues

### CR-01: Raw subject PII persisted in plaintext on the erasureRequests ledger

**File:** `app/[lang]/(admin)/erasure/actions.ts:150-163`
**Issue:** The erasure Server Action stores `rawSubjectId: id` (the raw uid for an agent, or the raw `leadId` for a lead) as a plaintext field on the `erasureRequests/{reqId}` document. This directly contradicts the documented invariant in three places:

- `src/firebase/collections.ts:585-586` — *"PDPA: `subjectIdHash` only — NEVER the raw subject id."*
- `actions.ts:84-89` / `:143` — *"T-05-RAWID: raw subject id is NEVER persisted; only the hash is stored."*
- `05-03-SUMMARY.md` / `05-05-SUMMARY.md` — both mark *"T-05-RAWID MITIGATED — erasureRequests stores subjectIdHash only."*

The raw id is the very PII the erasure exists to remove. For a `lead` subject the `leadId` IS the lead's identifier, and it now lives on a long-lived ledger doc with **no TTL** (unlike `usageEvents`). The data also outlives the erasure: after the cascade deletes `leads/{leadId}`, the raw `leadId` survives on the `erasureRequests` doc indefinitely. The comment "never returned to clients" is true at the action layer, but the value still sits in Firestore plaintext (Admin SDK reads it back in the sweep), so it is exposed to any future admin export, backup, or rule regression.

The root cause is a design tension: the sweep needs the raw key to re-query, but the doc must not store raw PII. The current code resolves it by storing raw PII — the wrong side of the tradeoff for a PDPA artifact.

**Fix:** Do not persist the raw id. Two viable options:

1. **Complete erasure synchronously per request, or carry the raw id only in volatile job state** — e.g., when the synchronous pass leaves work, store the *remaining work descriptor* keyed by `subjectIdHash` and re-derive deletions from the manifest's `keyField`/`docId`/`keyVia` strategy. For `keyField`/`keyVia` collections the sweep does not actually need the raw id beyond equality matching — but `docId` entries (`users/{uid}`, `leadContext/{leadId}`) and the equality `where(keyField, '==', id)` queries do. If those are completed in the synchronous pass (they are single-doc or small), the sweep only needs to finish the large recursive `conversations` deletes, which can be resumed by re-querying `where('ownerUid'|'leadId','==', <value>)` — still needs the value.

2. **If the raw key is genuinely required for resumable sweeping, encrypt it at rest** with a Secret-Manager-held key (decrypt only inside the sweep), or store it in a separate access-restricted location with an explicit short TTL tied to the 72h SLA — and update the schema docblock + T-05-RAWID claim to state the truth ("raw id retained, encrypted, ≤72h") instead of "never persisted."

At minimum, the contradiction between the stated invariant and the code must be resolved before PDPA sign-off — either the code stops storing raw PII, or the documentation/TIA is corrected to reflect that it does. Example of the offending write:

```ts
await (reqRef as any).set({
  tenantId: TENANT_ID,
  subjectType,
  subjectIdHash: hashId(id),
  rawSubjectId: id,          // ← raw PII persisted in plaintext, contradicts the schema contract
  status: 'pending',
  ...
})
```

## Warnings

### WR-01: Load-test sends the wrong request body shape — chat path is never exercised

**File:** `scripts/loadtest/chat.js:88-93,120`
**Issue:** `SAMPLE_CHAT_BODY` is a bare JSON array `[{ role, content }]`, but `app/api/chat/route.ts:280-308` parses `body.messages` and returns **400 "No messages provided"** when `messages.length === 0`. Since the top-level body is an array, `body.messages` is `undefined → []`, so every VU request short-circuits at the body-parse gate before auth/ratelimit/PDPA/model. The k6 thresholds explicitly allow status 400 (`'status is 200 or 400 (not 500)'`), so the test will report "passing" while never measuring the streaming/model path it was built to load-test (the stated purpose: "Simulates ~400 concurrent agents sending chat turns"). This is a silent no-op load test.
**Fix:**
```js
const SAMPLE_CHAT_BODY = JSON.stringify({
  messages: [
    { role: 'user', content: 'What is the D2 onboarding process for new agents?' },
  ],
})
```
Also consider tightening the k6 check to require `status === 200` (or at least asserting the SSE body contains `data:` markers) so a future regression to the 400 path is caught rather than masked.

### WR-02: `getBlastRadius` returns whole-collection counts, not subject-scoped counts

**File:** `app/[lang]/(admin)/erasure/actions.ts:243-264`
**Issue:** The blast-radius preview is meant to show the admin "how many docs belong to this subject" before they confirm an irreversible erasure (HR-8, the safety-critical preview). But the implementation runs `adminDb.collection(col).count()` with **no `where` filter on the subject id** — it counts every document in each collection tenant-wide. For example, erasing one lead will preview `conversations: <all conversations in the system>` rather than `conversations: 1`. This is dangerously misleading on the most safety-critical screen: it inflates the apparent blast radius and undermines the admin's ability to sanity-check the target before confirming. The `subjectType`/`id` are parsed and the read is audited, but the id is never actually used in the count query.
**Fix:** Iterate `PII_ERASURE_MANIFEST[subjectType]` entries (not just collection names) and apply the same key strategy the executor uses — `where(keyField,'==',id).count()` for `keyField`/`keyVia` entries, and an existence check (`ref.doc(id).get()` → 0/1) for `docId` entries. Skip `STORAGE`/`auditLogs` as today. This reuses the manifest's per-entry shape so the preview matches what the cascade will actually delete.

### WR-03: Conversation viewer `lastMessageAt` is always null/`—`

**File:** `app/[lang]/(admin)/conversations/actions.ts:200`; `conversation-viewer.tsx:184-186`
**Issue:** `searchConversations` reads `data.lastMessageAt`, but `ConversationDoc` (`collections.ts:82-92`) has no `lastMessageAt` field and nothing in the codebase ever writes it (grep confirms it appears only in these two files plus the type/comment). The cast `(data.lastMessageAt as { toDate?: () => Date } | null)?.toDate?.()` therefore always yields `null`, so the "Last message" column renders "—" for every row. The viewer's primary sort/recency signal is dead.
**Fix:** Either (a) populate a `lastMessageAt` (or reuse the existing message subcollection's latest `ts`) when appending messages and read that, or (b) fall back to the conversation `createdAt` field that does exist, or (c) remove the column. If keeping it, also note the `orderBy('__name__')` query on line 186 orders by doc id, which is unrelated to recency.

### WR-04: Usage dashboard window boundary computed in UTC, but rollup keys are Asia/Kuala_Lumpur

**File:** `app/[lang]/(admin)/usage/page.tsx:44-48,81,104-107`
**Issue:** `nDaysAgo()` builds the window-start day via `d.getUTCDate()` and `toISOString().slice(0,10)` — a **UTC** calendar date. But rollup `day` keys are written via `dayKey()` which formats in **Asia/Kuala_Lumpur** (UTC+8) (`src/usage/types.ts:77-86`). For up to 8 hours each day (00:00–08:00 MYT = the prior UTC day), the UTC-derived `windowStart` is one day behind the MYT-derived rollup keys, so the `where('day','>=',windowStart)` filter can include/exclude an extra boundary day inconsistently with how the data was bucketed. The dashboard header also claims "last 7 days" but the boundary day drifts.
**Fix:** Compute `windowStart` in the same timezone as the keys, e.g. reuse `dayKey()` against a shifted date: `dayKey(new Date(Date.now() - windowDays * 86400000))`. Standardizing on the existing `dayKey` helper removes the divergence and keeps a single source of truth for day-key formatting.

### WR-05: `getCorrectionEvalFeedback` orders eval trend by score, not time — "trend" is misleading

**File:** `app/[lang]/(coach)/dashboard/actions.ts:805-817`; rendered `correction-eval-panel.tsx:138-158`
**Issue:** The eval-score "trend" LineChart is fed by a query that does `orderBy('score', 'desc').limit(20)` — it returns the 20 highest-scoring eval runs, sorted by score, not the most recent runs over time. The LineChart then plots them along the x-axis by `suite`, producing a monotonically-decreasing line that looks like a declining trend but is actually just "scores sorted high→low." `EvalDoc` (`collections.ts:374-381`) has no timestamp field to order by, so a true time trend is not currently expressible. As-is, the chart misrepresents eval health to coaches.
**Fix:** Add a `ranAt`/`createdAt` timestamp to `EvalDoc` and order by it descending (then reverse for display), or relabel the panel as "recent eval scores by suite" (a bar/categorical view) rather than a temporal trend. At minimum, do not sort by `score` for something presented as a time trend.

### WR-06: `recordUsageEvent` swallows all errors silently with no observability hook

**File:** `src/usage/record.ts:77-83`
**Issue:** The fire-and-forget catch swallows every error (by design, mirroring `audit/log.ts`), and the comment says "A separate monitoring alert on usageEvents write failure rates handles observability." No such alert/metric exists in this phase's code. Combined with the usage pipeline being the sole input to the ADMIN-08 cost dashboard and QUAL-08 cost pass, a systematic write failure (e.g., a `usageEvents` rule regression, an index issue, or a converter change) would silently zero out all cost/usage reporting with no signal until someone notices the dashboard is empty — which the `staleWatchdog` only partially covers (it watches rollups, and a rollup of zero events still "ran"). Not a hot-path bug, but a silent-failure surface on a compliance/cost-critical pipeline.
**Fix:** Emit a counter/metric (or a single non-PII error-rate log without token/uid context) on the catch path, or wire the promised monitoring alert. Even a process-level error counter that the watchdog can read would close the gap. Document where the alert is configured if it lives outside this repo.

## Info

### IN-01: `rollupUsage` has a dead `now` variable and `void now` workaround

**File:** `src/usage/rollup.ts:86,138`
**Issue:** `const now = new Date()` is declared, never used (the rollup writes `FieldValue.serverTimestamp()` for `updatedAt`), and is suppressed with `void now // suppress unused variable warning`. Dead code that signals an abandoned intent.
**Fix:** Remove both the `const now` declaration and the `void now` line.

### IN-02: `computeResolutionTimeMs` day-filter uses UTC `toISOString().slice(0,10)`, inconsistent with MYT day keys

**File:** `src/usage/rollup.ts:203`
**Issue:** Inside the rollup, resolved-escalation deltas are filtered to "this day" via `new Date(resolvedMs).toISOString().slice(0,10)` (UTC) and compared against `day` (which is an Asia/Kuala_Lumpur key from `dayKey`). Same timezone-mismatch class as WR-04 but lower impact (resolution time is an optional rollup field, and the comment already flags the day correlation as "approximate"). Worth aligning for correctness.
**Fix:** Format `resolvedMs` with the same Asia/Kuala_Lumpur formatter (`dayKey(new Date(resolvedMs))`) before comparing to `day`.

### IN-03: `computeResolutionTimeMs` fetches all resolved escalations per agent without a `limit`

**File:** `src/usage/rollup.ts:170-175`
**Issue:** The query `escalationsRef().where('agentUid','==',uid).where('status','==','resolved').select(...).get()` has no `limit`. It is a projection over a small per-agent set at pilot scale, but it is the one unbounded read in the otherwise count-aggregation-disciplined rollup. Performance is out of v1 scope, but this is also a correctness smell for the day-filtering loop (it scans all-time resolved escalations every rollup).
**Fix:** Bound the query to the relevant window (e.g., `where('resolvedAt','>=', startOfDay)`) once `resolvedAt` indexing supports it, or add a defensive `limit`.

### IN-04: `usage-dashboard.tsx` destructures `lang` and `windowDays` but `lang` is only used for navigation; minor unused-ish props

**File:** `app/[lang]/(admin)/usage/usage-dashboard.tsx:124-141`
**Issue:** All props are passed; `totalInputTokens`/`totalOutputTokens` are rendered, `lang` is used in `handleWindowChange`. No real bug — but `avgResolutionTimeMs`/`avgEscalationRate` come from rollup fields that are only sometimes populated (escalations are per-agent, not per-pillar — see `rollup.ts:163-164`), so these KPIs can silently read as "—" even when there is escalation activity. Cosmetic/expectation mismatch, not a defect.
**Fix:** None required; consider a tooltip noting resolution/escalation metrics are agent-level approximations.

### IN-05: `searchConversations` builds an unused query object `q` before branching

**File:** `app/[lang]/(admin)/conversations/actions.ts:180-191`
**Issue:** `const q = adminDb.collection('conversations').limit(50)` is constructed unconditionally, then only used in the `else` branch of the ternary. Harmless (Firestore queries are lazy and not executed until `.get()`), but it reads as a redundant allocation and slightly obscures the two query paths.
**Fix:** Inline the no-query branch (`: adminDb.collection('conversations').limit(50).get()`) or move `q` construction into the branch that uses it.

### IN-06: `erasure-status-list.tsx` is static — no refresh after a new erasure is queued

**File:** `app/[lang]/(admin)/erasure/erasure-status-list.tsx:37`
**Issue:** `const [requests] = useState<ErasureRequestRow[]>(initialRequests)` initializes from the server snapshot and never updates. After an admin queues a new erasure via the form (which resets the form but does not refetch the list) or as the sweep progresses, the status list is stale until a full page reload. The role-assignment island, by contrast, refetches after a write (`refreshUsers`). Minor UX gap, not a security issue (the data is still admin-gated server-side).
**Fix:** Lift a refresh callback (call `listErasureRequests()` after `eraseDataSubjectAction` succeeds) or convert the status list to refetch on an interval / on form-success, mirroring `role-assignment.tsx:refreshUsers`.

---

_Reviewed: 2026-06-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
