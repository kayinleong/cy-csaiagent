# Phase 5: Hardening + Scale-Up - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 27 (create + modify, derived from 05-CONTEXT.md D-01..D-13, 05-RESEARCH.md structure, 05-UI-SPEC.md Surfaces 1-5)
**Analogs found:** 24 / 27 (3 artifact/dev-tooling files have no code analog by design)

> **Discipline: "grow, don't fork."** Every code file below extends an existing seam at a concrete `file:line`. The planner should COPY the cited pattern, not invent. The three "no analog" entries (load-test harness, handover docs, sign-off memos) are artifacts/dev-tooling, intentionally outside the app code.

---

## File Classification

### New files (create)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/usage/record.ts` | service | event-driven | `src/audit/log.ts` (fire-and-forget append writer) | role-match |
| `src/usage/rollup.ts` | service | batch / aggregate | `dashboard/actions.ts` `getReplyQualityMetrics` (count() aggregation) | role-match |
| `src/usage/types.ts` | model | — | `src/firebase/collections.ts` doc interfaces | exact |
| `src/pdpa/erasure.ts` | service | batch / destructive | `src/jobs/runDueJobs.ts` `runJob` (txn-guarded write) + `src/audit/log.ts` | role-match |
| `src/pdpa/coverage.ts` | config / manifest | transform | (no analog — net-new declarative manifest; see No Analog) | none |
| `src/pdpa/sweep.ts` | service | batch / event-driven | `src/jobs/runDueJobs.ts` job-body pattern + `loadRecent` chunking | role-match |
| `app/[lang]/(admin)/erasure/page.tsx` | route (RSC shell) | request-response | `app/[lang]/(admin)/kb/page.tsx` | exact |
| `app/[lang]/(admin)/erasure/actions.ts` | controller (Server Action) | request-response / destructive | `dashboard/actions.ts` `getSessionUser`+`resolveStall` | exact |
| `app/[lang]/(admin)/erasure/erasure-request-form.tsx` | component (client) | request-response | `components/ui/alert-dialog.tsx` + `stall-inbox.tsx` Dialog flow | role-match |
| `app/[lang]/(admin)/erasure/erasure-status-list.tsx` | component (client) | CRUD (read) | `stall-inbox.tsx` Card list | role-match |
| `app/[lang]/(admin)/usage/page.tsx` | route (RSC shell) | request-response | `kb/page.tsx` + `dashboard/page.tsx` | exact |
| `app/[lang]/(admin)/usage/usage-dashboard.tsx` | component (client) | CRUD (read) | `_components/metrics-panel.tsx` (recharts island) | exact |
| `app/[lang]/(admin)/conversations/page.tsx` | route (RSC shell) | request-response | `kb/page.tsx` | exact |
| `app/[lang]/(admin)/conversations/actions.ts` | controller (Server Action) | CRUD (read) + audit | `dashboard/actions.ts` `getAgentChatHistory` | exact |
| `app/[lang]/(admin)/conversations/conversation-viewer.tsx` | component (client) | CRUD (read) | `stall-inbox.tsx` Dialog+ScrollArea drilldown | exact |
| `app/[lang]/(admin)/roles/page.tsx` | route (RSC shell) | request-response | `kb/page.tsx` | exact |
| `app/[lang]/(admin)/roles/actions.ts` | controller (Server Action) | request-response | `dashboard/actions.ts` `resolveStall` + `src/firebase/auth.ts` `setUserClaims` | exact |
| `app/[lang]/(admin)/roles/role-assignment.tsx` | component (client) | request-response | `stall-inbox.tsx` (useTransition + sonner + AlertDialog) | role-match |
| `app/[lang]/(coach)/_components/funnel-v2-panel.tsx` | component (client) | CRUD (read) | `_components/metrics-panel.tsx` | exact |
| `app/[lang]/(coach)/_components/knowledge-gap-agg-panel.tsx` | component (client) | CRUD (read) | `_components/metrics-panel.tsx` | exact |
| `app/[lang]/(coach)/_components/correction-eval-panel.tsx` | component (client) | CRUD (read) | `_components/metrics-panel.tsx` (LineChart + Table) | exact |
| `scripts/loadtest/chat.js` | test (dev tooling) | streaming (SSE) | (no analog — dev/CI tooling; see No Analog) | none |

### Modified files

| Modified File | Role | Change | Closest Analog (in-file pattern to mirror) | Match Quality |
|---------------|------|--------|--------------------------------------------|---------------|
| `src/firebase/collections.ts` | model | + `usageEvents`/`usageRollups`/`erasureRequests` interfaces, converters, refs; + `resolvedAt?` on `EscalationDoc` | existing `replyEditsRef`/`knowledgeGapsRef` blocks (`:446-473`, `:657-678`) | exact |
| `firestore.rules` | config | + 3 deny-by-default match blocks (collections 18-20) | `auditLogs` (`:208-216`), `replyEdits` (`:243-262`), `knowledgeGaps` (`:225-241`) | exact |
| `firestore.indexes.json` | config | + `usageEvents (day, uid, pillar)` composite | existing `escalations (seniorCoachId, status)` index (`:11-18`) | exact |
| `src/jobs/runDueJobs.ts` | service (job registry) | fill `usage-rollup` body (`:208-212`) + add `erasure-sweep` entry | existing `eval-nightly` delegation entry (`:199-205`) | exact |
| `app/api/chat/route.ts` | controller | + `recordUsageEvent` via `after()` in `onFinish`; switch token read to `final.totalUsage` | existing `audit.log` `after()` call (`:612-625`) | exact |
| `app/[lang]/(coach)/dashboard/page.tsx` | route (RSC) | + 3 `<section>` blocks for v2 panels; fetch + role-scope | existing `MetricsPanel`/`ReplyQualityPanel` sections (`:199-219`) | exact |
| `app/[lang]/(coach)/dashboard/actions.ts` | controller | + data actions for v2 panels (funnel/gap-agg/correction) | existing `getReplyQualityMetrics` (`:334-453`) | exact |
| `app/[lang]/_components/app-sidebar.tsx` | component (client) | + 4 admin `NavItem`s (conversations/roles/usage/erasure) | existing `items[]` array (`:51-56`) | exact |
| `src/firebase/__tests__/rules.test.ts` | test | enumerate 3 new collections; "16 → 19" assertion | existing collections array (`:89-94`), `replyEdits` tests | exact |
| `src/i18n/messages/{en,ms,zh}.json` | config | + `dashboard.v2`, `adminErasure`, `adminUsage`, `adminConversations`, `adminRoles` namespaces + `nav` keys | existing `dashboard`/`nav` namespaces | exact |

---

## Pattern Assignments

### `src/usage/record.ts` (service, event-driven)  — D-04, QUAL-08

**Analog:** `src/audit/log.ts` (the fire-and-forget hashes-only append writer is the exact shape: a `src/`-only module, Admin-SDK write via a typed ref, swallow-errors contract, designed to be called inside `after()`).

**Module-shape pattern** (`src/audit/log.ts:76-97`) — same fire-and-forget contract `recordUsageEvent` must adopt:
```typescript
export async function log(entry: AuditEntry): Promise<void> {
  try {
    // ... assemble row ...
    await auditLogsRef().add(auditRow as any)
  } catch {
    // Fire-and-forget: swallow the error silently.
    // The caller (running inside after()) must NOT be affected by failures.
  }
}
```

**No-PII discipline to copy:** the audit writer hashes every `raw` value (`hashAll`, `:57-63`). `usageEvents` is the inverse-but-same posture: **counts only, no content** — no `originalDraft`, no `routeDecision` string with PII (RESEARCH Anti-Patterns: "Storing draft/message content in usageEvents"). Stamp `tenantId` via the converter (free from `makeConverter`).

**Caller side (the single capture point) — see route.ts assignment below.** `record.ts` is a pure append; it never decides `uid`/`pillar` (the route does).

---

### `src/usage/rollup.ts` (service, batch/aggregate)  — D-05, QUAL-08/ADMIN-08

**Analog:** `getReplyQualityMetrics` (`app/[lang]/(coach)/dashboard/actions.ts:334-453`) — the ONLY existing `count()`/`select()` server-side aggregation. Copy its two primitives.

**Aggregation primitive to copy** (`dashboard/actions.ts:365-368`):
```typescript
const countOf = async (q: CountableQuery): Promise<number> => {
  const snap = await q.count().get()
  return snap.data().count
}
```

**Projection-to-discover-groups primitive to copy** (`dashboard/actions.ts:402-407`) — rollup discovers distinct `(uid, pillar)` the same way `getReplyQualityMetrics` discovers SOP ids via `select()`:
```typescript
const projSnap = await scopedReplyEdits().select('sopDocIds').get()
const sopIds = new Set<string>()
for (const doc of projSnap.docs) { /* collect group keys */ }
```

**Extend to `AggregateField.sum()`** (RESEARCH Pattern 2 — `getReplyQualityMetrics` only uses `count()`; rollup also needs `sum()` for tokens):
```typescript
import { AggregateField } from 'firebase-admin/firestore'
const snap = await usageEventsRef()
  .where('day','==',day).where('uid','==',uid).where('pillar','==',pillar)
  .aggregate({ msgCount: AggregateField.count(),
               inTok: AggregateField.sum('inputTokens'),
               outTok: AggregateField.sum('outputTokens'),
               cachedTok: AggregateField.sum('cachedInputTokens') }).get()
```

**Idempotency contract** (RESEARCH Pitfall 3): key `usageRollups` doc by `` `${day}__${uid}__${pillar}` `` and write with `{ merge: true }` so a re-run overwrites, never accumulates. This mirrors `writeHeartbeat`'s `{ merge: true }` last-writer-wins (`src/jobs/heartbeat.ts:51-58`).

---

### `src/pdpa/erasure.ts` (service, batch/destructive)  — D-01, QUAL-09

**Analogs:** `src/jobs/runDueJobs.ts` `runJob` (`:229-265`, txn-guarded staking pattern, for idempotency) + `src/audit/log.ts` (for the erasure event write) + `recursiveDelete` (RESEARCH Pattern 3).

**recursiveDelete cascade** (RESEARCH Pattern 3, `@google-cloud/firestore` re-exported by firebase-admin) — the correct primitive for `conversations/{cid}` + its `messages` subcollection (do NOT hand-roll a subcollection loop):
```typescript
import { adminDb } from '@/src/firebase/admin'
await adminDb.recursiveDelete(adminDb.collection('conversations').doc(cid))
```

**Audit-exempt erasure event** — write INTO `auditLogs`, never delete from it. Reuse the existing `audit.log` writer (`src/audit/log.ts:76-97`) which hashes every `raw` value:
```typescript
import * as audit from '@/src/audit'
await audit.log({ actorUid: user.uid, action: 'erasure',
  targetRef: `erasureRequests/${reqRef.id}`,
  raw: { subjectType, subjectIdHash: hash(id), collectionsHit } })  // all values hashed
```

**EXEMPT guard** (RESEARCH Pitfall 2): `auditLogs` is in the manifest `EXEMPT` list — the executor skips EXEMPT collections by construction. Note `auditLogs.actorUid` IS the agent's uid, so a naive "delete where actorUid == uid" WOULD hit it; the code-level exemption (not rules — Admin SDK bypasses rules) is the real guard.

**Subject-key enumeration** is driven by `src/pdpa/coverage.ts` `PII_ERASURE_MANIFEST` (below) — `erasure.ts` iterates the manifest, never hard-codes collection names.

---

### `src/pdpa/coverage.ts` (config/manifest)  — D-01/D-03, QUAL-09

**Analog:** NONE (net-new). The closest grounding is the collection inventory in `src/firebase/collections.ts` header (`:9-27`) and the subject-keying observed across the schema. Build the manifest from the actual schema fields verified here:

| Subject | Collection | Key (verified in collections.ts) |
|---------|-----------|----------------------------------|
| agent (`uid`) | `conversations` | `ownerUid` (`:80`) — `recursive: true` (+messages subcoll) |
| agent | `leads` | `ownerUid` (`:111`) |
| agent | `leadContext` | via `leads.ownerUid` (`leadContext` keyed by leadId `:120-131`, no ownerUid) |
| agent | `replyEdits` | `agentUid` (`:461`) |
| agent | `escalations` | `agentUid` (`:346`) |
| agent | `knowledgeGaps` | `agentUid` (`:389`) |
| agent | `agentProfiles` | docId = uid (`:551`) |
| agent | `rateBudgets` | docId = uid (`:483 ownerUid` + `:641` docId) |
| agent | `users` | docId = uid (`:546`) |
| lead (`leadId`) | `conversations` | `leadId` (`:84`) — `recursive: true` |
| lead | `leadContext` | docId = leadId (`:583`) |
| lead | `leads` | docId = leadId (`:578`) |
| lead | `replyEdits` | `leadId` (`:449`) |
| **EXEMPT** | `auditLogs` | hashes-only — NEVER deleted (`:354-362`, `:208-216` rules) |

**Storage note (RESEARCH A1):** `users.voiceSamples[]` are Firestore strings today (`UserDoc.voiceSamples`, `:66`), NOT Storage objects — so the `STORAGE` manifest entry is a near-no-op at pilot. Flag in the manifest; confirm with Derek.

This single manifest drives BOTH `erasure.ts` (executor) AND `coverage.test.ts` (the QUAL-09 coverage proof) — Pattern 4 single-source-of-truth.

---

### `src/pdpa/sweep.ts` (service, batch)  — D-02, QUAL-09

**Analog:** the lazy-cron job-body pattern (`src/jobs/runDueJobs.ts` job `run` bodies, e.g. `eval-nightly` `:199-205`) + the bounded-read chunking of `loadRecent` (`src/memory/conversation.ts:142-149`, which uses `limitToLast(n)` and never loads full history — the over-read mitigation the sweep must respect).

**Idempotent re-query contract** (RESEARCH Pattern 3 idempotency note): `erasureSweep()` reads `erasureRequests` where `status in ['pending','sweeping']`, re-queries each subject-keyed collection for any docs still present, re-deletes (deleting an already-gone doc is a no-op), and marks `complete` when nothing remains. Bound each batch (mirror `loadRecent`'s `limitToLast`) so a power-user's 800-message thread never becomes one mega-delete (Pitfall 10 / 60s timeout).

---

### `app/[lang]/(admin)/erasure/actions.ts` (controller / Server Action)  — D-01/D-02, QUAL-09

**Analog:** `dashboard/actions.ts` — copy the `getSessionUser` helper (`:39-52`) verbatim and the `resolveStall` role-gate + result-shape (`:71-90`).

**Session helper to copy verbatim** (`dashboard/actions.ts:39-52`):
```typescript
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) throw new UnauthorizedError('No session cookie')
  const syntheticReq = new Request('https://d2.app/admin/erasure', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}
```

**Admin-gate + result shape to copy** (`dashboard/actions.ts:71-90`) — but `role !== 'admin'` (erasure is admin-only, NOT coach):
```typescript
let user
try { user = await getSessionUser() } catch { return { ok: false, error: 'Unauthorized' } }
if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }
// + zod Input.parse(raw) before any Admin-SDK write (V5 input validation)
```

Delegates the cascade to `src/pdpa/erasure.ts` `eraseDataSubject`. Writes the `erasureRequests/{reqId}` doc + the `erasure` audit event (see `erasure.ts` above). RESEARCH "Code Examples → Erasure Server Action skeleton" is the full composition reference.

---

### `app/[lang]/(admin)/erasure/erasure-request-form.tsx` (component, client)  — Surface 5, HR-8..HR-12

**Analogs:** `components/ui/alert-dialog.tsx` (the type-to-confirm gate) + `stall-inbox.tsx` (the `useTransition` + `sonner` + Dialog client pattern).

**Destructive-action gate** — vendored `AlertDialogAction` already accepts `variant="destructive"` and renders through `Button` (`alert-dialog.tsx:150-166`). HR-9 requires it `disabled` until the typed token matches:
```tsx
<AlertDialogAction variant="destructive" disabled={typed !== subjectRef}
  onClick={() => void erase()}>
  {t('confirmErase')}
</AlertDialogAction>
<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>   {/* default variant="outline" — the safe choice */}
```
`AlertDialogMedia` slot (`:102-116`) holds the destructive `Trash2`/`AlertTriangle` icon. `AlertDialogDescription` (`:134-148`) carries the HR-10 irreversibility copy (all 3 languages).

**Client-action plumbing to copy** (`stall-inbox.tsx:55-72`): `useTransition` + `toast.success`/`toast.error` on the Server Action result — the exact pattern the erase confirm and the role-assignment submit both reuse.

---

### `app/[lang]/(admin)/erasure/erasure-status-list.tsx` (component, client)  — Surface 5 Stage C

**Analog:** `stall-inbox.tsx:99-135` (the `Card` list with `Badge` + relative-time + `font-mono text-xs` ref). Reuse the `formatRelativeTime` helper (`stall-inbox.tsx:199-211`) for the requested-at / SLA countdown. Status `Badge` variants per UI-SPEC: `pending→secondary`, `complete→secondary+check`, `failed→destructive`.

---

### `app/[lang]/(admin)/conversations/actions.ts` (controller / Server Action)  — D-08, ADMIN-02

**Analog:** `getAgentChatHistory` (`dashboard/actions.ts:237-276`) — the audited drilldown. Widen scope from coach-downline to admin/cross-pillar.

**Audited-read pattern to copy** (`dashboard/actions.ts:258-271`):
```typescript
// PDPA: audit the drill-down BEFORE returning any conversation data.
await auditDrilldown(user.uid, 'conversations')   // src/audit/log.ts:120
const records = await loadRecent(`coach-${agentUid}`, 30)  // src/memory/conversation.ts:142
return { ok: true, messages: records.map((r) => ({ id: r.id, role: r.data.role,
         content: r.data.content, redacted: r.data.redacted ?? false })) }
```

**Two changes for admin/cross-pillar (HR-5):**
1. Gate `user.role !== 'admin'` (not the coach `senior-coach || admin` gate at `:245`). DROP the downline scoping block (`:249-256`) — admin reads any conversation.
2. Take a `cid` (any pillar's conversation), not `coach-${agentUid}` — RESEARCH "Code Examples → Conversation viewer" shows `getConversationForReview(cid)` with `auditDrilldown(user.uid, \`conversations/${cid}\`)`. READ-ONLY: no resolve/edit/delete.

---

### `app/[lang]/(admin)/conversations/conversation-viewer.tsx` (component, client)  — D-08, ADMIN-02

**Analog:** `stall-inbox.tsx:137-184` — the `Dialog` + `ScrollArea max-h-[60vh]` message-thread drilldown. Reuse VERBATIM:
- Bubble styling (`stall-inbox.tsx:166-178`): `ml-8 rounded-lg bg-primary/10` (user) / `mr-8 rounded-lg bg-muted` (assistant), `whitespace-pre-wrap text-sm`.
- Loading/error/empty states (`:153-161`): `chatHistoryLoading` / `chatHistoryError` / `chatHistoryEmpty` equivalents.

**Differences (UI-SPEC Surface 2):** entry point is a search (`Command`/`Input` + results `Table`) not a stall-row button; add a per-message pillar `Badge`; add the `Alert` "Read-only compliance view. This access is audited." banner. NO resolve/reply/delete (HR-5).

---

### `app/[lang]/(admin)/roles/actions.ts` (controller / Server Action)  — D-09, ADMIN-07

**Analogs:** `dashboard/actions.ts` `getSessionUser`+`resolveStall` gate (`:39-90`) + `src/firebase/auth.ts` `setUserClaims` (`:148-183`).

**Role assignment — reuse the SOLE sanctioned claim path** (`src/firebase/auth.ts:148-159`), which validates the role union (`InvalidRoleError`) and upserts the `users` doc:
```typescript
import { setUserClaims } from '@/src/firebase/auth'
export async function assignRole(targetUid: string, role: 'new-agent'|'senior-coach'|'admin') {
  const user = await getSessionUser()
  if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }
  await setUserClaims(targetUid, role)           // validates union + upserts users doc
  await audit.log({ actorUid: user.uid, action: 'role-assign',
    targetRef: `users/${targetUid}`, raw: { targetUid, role } })
  return { ok: true }
}
```
RESEARCH "Code Examples → Role matrix assignment" is the full reference. No new auth model — `setUserClaims` is the only writer (`src/firebase/auth.ts:136` comment: "ONLY sanctioned claim-setting path").

---

### `app/[lang]/(admin)/roles/role-assignment.tsx` (component, client)  — D-09, Surface 3

**Analog:** `stall-inbox.tsx` (`useTransition`/`sonner`) + `alert-dialog.tsx` (the single-click demotion confirm — NOT type-to-confirm; only erasure needs that per HR-6/HR-9). The read-only matrix `Table` is vendored `components/ui/table.tsx`. Disabled-submit-while-pending mirrors the `isPending`/`disabled` pattern in `stall-inbox.tsx:126`.

---

### `app/[lang]/(admin)/usage/usage-dashboard.tsx` (component, client)  — D-10/D-04/D-05, ADMIN-08+QUAL-08

**Analog:** `_components/metrics-panel.tsx` (the recharts client island) — copy the chart conventions EXACTLY (HR-3).

**recharts conventions to copy** (`metrics-panel.tsx:88-95`, `:112-135`):
```tsx
<ResponsiveContainer width="100%" height={220}>
  <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
    <XAxis dataKey="..." tick={{ fontSize: 12 }} />
    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
    <Tooltip />
    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />   {/* #6366f1 primary, #f59e0b secondary */}
  </BarChart>
</ResponsiveContainer>
```
**Empty-state copy pattern** (`metrics-panel.tsx:83-86`): `<p className="py-8 text-center text-sm text-muted-foreground">{...noData}</p>` — reuse for the "No usage rolled up yet" state. KPI stat tiles mirror `reply-quality-panel.tsx` (`text-2xl font-bold` number + `text-xs text-muted-foreground` label). **Reads `usageRollups` only** (HR-7), passed as plain serializable props from the RSC.

---

### `app/[lang]/(coach)/_components/funnel-v2-panel.tsx` / `knowledge-gap-agg-panel.tsx` / `correction-eval-panel.tsx` (components, client)  — D-07, CDASH-08

**Analog:** `_components/metrics-panel.tsx` (verbatim recharts conventions, above). The funnel-v2 widens the training-only funnel (`metrics-panel.tsx:57-61` + `src/dashboard/metrics.ts` `trainingFunnel` `:108-138`) to training→lead→close + the ramp KPI scalar. Knowledge-gap-agg renders a `BarChart` over the pillar-tagged `knowledgeGaps` (`KnowledgeGapDoc.pillar?` exists, `collections.ts:416`). Correction-eval uses a `LineChart` + vendored `Table` over `kbDocs.correctedBy` (`collections.ts:277`) + `evals`. All three are appended as new `<section>` blocks in `dashboard/page.tsx` (see below).

---

### `src/firebase/collections.ts` (model)  — MODIFY: + 3 collections + `resolvedAt`

**In-file analog:** the `replyEdits` block (`:419-473` interface + `:537` converter + `:662-678` ref) and `knowledgeGaps` block (`:373-417` + `:536` + `:645-659`) — the most recent additions. Mirror exactly: a documented interface (server-only-write note), a `makeConverter<T>()` line, and a `<name>Ref()` factory.

**Ref factory pattern to copy** (`collections.ts:676-678`):
```typescript
export function replyEditsRef(): CollectionReference<ReplyEditDoc> {
  return adminDb.collection('replyEdits').withConverter(replyEditConverter)
}
```
Add `usageEventsRef`, `usageRollupsRef`, `erasureRequestsRef` identically (collections 18-20). The converter auto-stamps `tenantId` (`makeConverter` `:505-517`) — no caller can omit it.

**`resolvedAt` schema add** (RESEARCH Open Question 3 / Assumption): `EscalationDoc` (`:344-352`) currently has `openedAt` but NO `resolvedAt`. Add `resolvedAt?: Date | FieldValue` for resolution-time analytics (D-05). NOTE: `resolveStall` (`dashboard/actions.ts:84`) only sets `status:'resolved'` — it must ALSO set `resolvedAt` for the rollup's resolution-time metric to work. This is a small, flagged behavioral add (regression surface: the existing resolve flow).

---

### `firestore.rules` (config)  — MODIFY: + 3 deny-by-default blocks

**In-file analog:** `auditLogs` (`:208-216`), `evals` (`:218-223`), `knowledgeGaps` (`:225-241`), `replyEdits` (`:243-262`) — the server-only / admin-read pattern.

**Pattern to copy** (`firestore.rules:212-216` — for `usageEvents`/`usageRollups`, fully server-written, admin-read):
```javascript
match /usageEvents/{id} {
  allow create, update, delete: if false;          // Admin-SDK only
  allow read: if hasRole('admin') && sameTenant(); // org-wide cost view
}
```
`erasureRequests` mirrors the same (admin-read, client-write denied). RESEARCH Anti-Patterns: "Client writes to the 3 new collections" — `create/update/delete: if false`. RESEARCH Pitfall 6: ship these in the SAME plan as the CI rules tests (no unruled collection).

---

### `firestore.indexes.json` (config)  — MODIFY: + `usageEvents (day, uid, pillar)`

**In-file analog:** the `escalations (seniorCoachId, status)` composite (`:11-18`):
```json
{ "collectionGroup": "escalations", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "seniorCoachId", "order": "ASCENDING" },
              { "fieldPath": "status", "order": "ASCENDING" } ] }
```
Add an identical-shape `usageEvents (day ASC, uid ASC, pillar ASC)` index (RESEARCH Pitfall 4 — bounds the rollup's per-group aggregation). Additive only; indexes deploy cleanly post quick-004.

---

### `src/jobs/runDueJobs.ts` (service / job registry)  — MODIFY: fill `usage-rollup`, add `erasure-sweep`

**In-file analog:** the `usage-rollup` STUB already exists (`:207-212`) — fill its body. The `eval-nightly` entry (`:199-205`) is the exact "delegate to a `src/` module + writeHeartbeat" pattern:
```typescript
'eval-nightly': {
  windowMs: ONE_DAY_MS,
  run: async (_now: Date) => {
    await runNightlyEval()
    await writeHeartbeat('eval-nightly')
  },
},
```
Fill `usage-rollup` → `await rollupUsage(dayKey(now)); await writeHeartbeat('usage-rollup')`. Add `erasure-sweep` (NEW, `windowMs: 60*60*1000` — 1h, well inside the 72h SLA) → `await erasureSweep(); await writeHeartbeat('erasure-sweep')`. The txn-guarded DUE-gate `runJob` (`:229-265`) gives exactly-once-per-window under concurrency — both new jobs inherit it for free (RESEARCH Pitfall 3 double-count mitigation).

---

### `app/api/chat/route.ts` (controller)  — MODIFY: + usage capture in onFinish

**In-file analog:** the existing `audit.log` `after()` call inside `onFinish` (`:612-625`) — the usage capture rides the SAME `after()` path, the SINGLE choke point (RESEARCH Anti-Pattern: "Two usage pipelines").

**Existing pattern to extend** (`route.ts:612-625`):
```typescript
after(() =>
  audit.log({ actorUid: uid, action: 'chat', targetRef: `conversations/${cid}`,
    raw: { pillar, routeDecision, tokenCount: final.usage.totalTokens ?? 0, contentHash: final.text } }),
)
```
Add ONE more `after(() => recordUsageEvent({...}))` alongside it. **CRITICAL token-source fix (RESEARCH `final.totalUsage` finding, Pattern 1 caveat):** the route currently reads `final.usage.totalTokens` at `:522` (message tokens), `:607` (rate-limit), `:620` (audit) — but `final.usage` is the LAST step only, and Finder/Reply run `stepCountIs(5)` (`:493`). Use `final.totalUsage` (sum across steps) for the NEW `usageEvents` capture. `uid` (GATE 1) and `pillar` (GATE 4) are already in scope. Read the Anthropic cache-write via `final.providerMetadata?.anthropic?.cacheCreationInputTokens`.
**Regression flag (RESEARCH Open Question 1):** do NOT silently change `:607` rate-limit / `:522` message-token to `totalUsage` — that alters budget consumption (TOKEN_CAP=50_000). Capture correct numbers in `usageEvents` only; document the pre-Phase-5 undercount in `PERF-COST.md` as a SEPARATE finding (its own claim + Derek sign-off).

---

### `app/[lang]/(coach)/dashboard/page.tsx` (route, RSC)  — MODIFY: + 3 v2 sections

**In-file analog:** the existing `MetricsPanel`/`ReplyQualityPanel` `<section>` blocks (`:199-219`). Append 3 new `<section>` blocks to the existing `<div className="grid gap-8">` (`:152`) — do NOT fork the page (HR-1, D-07).

**Section pattern to copy** (`dashboard/page.tsx:199-206`):
```tsx
<section>
  <h2 className="mb-4 text-lg font-semibold">{t('metricsTitle')}</h2>
  <MetricsPanel funnel={funnel} agentRows={agentRows} />
</section>
```
Role scope is already decided server-side via `adminAll` (`:85`) — pass it down (HR-4). Data fetched in `page.tsx` or co-located `actions.ts`, passed as plain serializable props.

---

### `app/[lang]/(admin)/{erasure,usage,conversations,roles}/page.tsx` (route, RSC shells)  — D-08/09/10, QUAL-09

**In-file analog:** `app/[lang]/(admin)/kb/page.tsx` (`:40-107`) — the canonical admin RSC shell. Copy the admin-gate block VERBATIM (`kb/page.tsx:43-68`):
```typescript
const cookieStore = await cookies()
const sessionCookie = cookieStore.get('__session')
if (!sessionCookie?.value) redirect(`/${lang}/sign-in`)
let user
try {
  const syntheticReq = new Request('https://d2.app/admin/<page>', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` } })
  user = await requireUser(syntheticReq)
} catch (err) {
  if (err instanceof UnauthorizedError) redirect(`/${lang}/sign-in`)
  throw err
}
if (user.role !== 'admin') redirect(`/${lang}/chat`)
```
Page wrapper `container mx-auto max-w-4xl px-4 py-8` (`kb/page.tsx:82`). The `(admin)/layout.tsx` gate (`:50-53`) is the first of the three-layer admin gate (HR-12); the page re-check is the second; the Server Action's own assertion is the third. Non-blocking try/catch → empty fallback for data fetch (`kb/page.tsx:71-77`).

---

### `app/[lang]/_components/app-sidebar.tsx` (component, client)  — MODIFY: + 4 NavItems

**In-file analog:** the `items[]` array (`:51-56`) + the `NavItem` type (`:34-39`). Add 4 entries (UI-SPEC §3) and widen the `key` union:
```typescript
{ key: 'conversations', href: `/${lang}/conversations`, icon: MessagesSquare, roles: ['admin'] },
{ key: 'roles',         href: `/${lang}/roles`,         icon: ShieldCheck,    roles: ['admin'] },
{ key: 'usage',         href: `/${lang}/usage`,         icon: BarChart3,      roles: ['admin'] },
{ key: 'erasure',       href: `/${lang}/erasure`,       icon: Trash2,         roles: ['admin'] },
```
Import the new lucide icons alongside the existing line (`:19`). The `roles` filter (`:58`) already hides them from non-admins (UX layer; layout is the security layer).

---

### `src/firebase/__tests__/rules.test.ts` (test)  — MODIFY: 16 → 19 collections

**In-file analog:** the deny-by-default collections array (`:89-94`) + the `replyEdits` server-only test pattern (mirrors `knowledgeGaps`). Add `usageEvents`, `usageRollups`, `erasureRequests` to the array; assert client `create/update/delete` DENIED + admin-read for each; update the "all 16 enumerated" assertion (`:21` comment + the array) to 19 (RESEARCH Pitfall 6 / Validation Architecture). Emulator-gated via `RUN_RULES` (`:62-63`) — skips cleanly without the emulator.

---

## Shared Patterns

### Admin session gate (Server Actions)
**Source:** `app/[lang]/(coach)/dashboard/actions.ts:39-52` (`getSessionUser`).
**Apply to:** every new admin Server Action (`erasure/actions.ts`, `conversations/actions.ts`, `roles/actions.ts`).
Reads `__session` cookie → synthetic `Request` → `requireUser`. Role from VERIFIED token, NEVER from action args (T-02-31). Admin actions gate `user.role !== 'admin'` (vs the coach `senior-coach || admin`).

### Admin route-group RSC gate
**Source:** `app/[lang]/(admin)/kb/page.tsx:43-68` (+ `(admin)/layout.tsx:50-53` as layer 1).
**Apply to:** every new admin page shell. Three-layer defense (HR-12): layout gate → page re-check → Server Action assertion.

### Audited drilldown (PDPA)
**Source:** `src/audit/log.ts:120-127` (`auditDrilldown`) + its use at `dashboard/actions.ts:260,372`.
**Apply to:** every admin/coach READ of subject data — conversation viewer (HR-5), usage aggregation. Call `auditDrilldown(user.uid, <targetRef>)` BEFORE returning any data. Hashes-only (`log` hashes every `raw` value, `:48-63`).

### Fire-and-forget append writer (no-PII)
**Source:** `src/audit/log.ts:76-97` (try/catch swallow; never rethrow into hot path).
**Apply to:** `src/usage/record.ts` (`recordUsageEvent`) — same contract, counts-only payload.

### Server-side aggregation (never fetch-all)
**Source:** `dashboard/actions.ts:365-368` (`count()`) + `:402-407` (`select()` projection).
**Apply to:** `src/usage/rollup.ts` (+ `AggregateField.sum()`), usage dashboard reads, dashboard v2 panels. RESEARCH Pitfall 4/9 — 1 read-unit per aggregation at 400-agent scale.

### Lazy-cron job registration
**Source:** `src/jobs/runDueJobs.ts:199-205` (`eval-nightly` delegate + `writeHeartbeat`) + `runJob` txn DUE-gate `:229-265`.
**Apply to:** `usage-rollup` (fill stub `:208`) + `erasure-sweep` (new). Idempotent bodies; exactly-once-per-window for free.

### tenantId converter stamp
**Source:** `src/firebase/collections.ts:505-517` (`makeConverter`).
**Apply to:** all 3 new collections — `tenantId` stamped on every write; no caller can omit (CLAUDE.md mandate).

### recharts client island
**Source:** `app/[lang]/(coach)/_components/metrics-panel.tsx:88-135`.
**Apply to:** usage dashboard + all 3 dashboard-v2 panels. `'use client'`, `ResponsiveContainer height={220}`, `margin={{top:4,right:8,left:-16,bottom:4}}`, `tick fontSize:12`, `#6366f1`/`#f59e0b`. Fed plain serializable props from RSC (HR-3).

### Destructive confirm dialog
**Source:** `components/ui/alert-dialog.tsx` (`AlertDialogAction variant="destructive"` `:150-166`; `AlertDialogCancel variant="outline"` `:168-184`; `AlertDialogMedia` `:102-116`; `AlertDialogDescription` `:134-148`).
**Apply to:** erasure type-to-confirm gate (HR-8/9/10 — action disabled until token matches) + role demotion single-click confirm (HR-6).

### Client-action plumbing
**Source:** `app/[lang]/(coach)/_components/stall-inbox.tsx:55-85` (`useTransition` + `toast.success/error` on Server Action result) + Dialog+ScrollArea drilldown `:137-184` + `formatRelativeTime` `:199-211`.
**Apply to:** erasure form/status-list, role-assignment, conversation viewer.

---

## No Analog Found

Files with no close code match — planner should use RESEARCH.md patterns / artifacts:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/pdpa/coverage.ts` | config/manifest | transform | Net-new declarative manifest. No existing manifest pattern; build from the verified schema table above (RESEARCH Pattern 4). The collection inventory header (`collections.ts:9-27`) is the closest reference. |
| `scripts/loadtest/chat.js` | dev tooling | streaming (SSE) | k6 harness — dev/CI tooling, NOT app code (D-11, RESEARCH Pitfall 7). No in-repo SSE-client analog; the SSE producer is `route.ts:638` `toUIMessageStreamResponse`. Live-gated execution. |
| Artifacts: `PERF-COST.md`, `HARDENING.md`, `LOADTEST.md`, `PDPA-SIGNOFF.md`, `docs/operations/*` | markdown artifact | — | D-03/06/11/12/13 — documentation, not code. No analog by nature. Backup/restore = documented `gcloud firestore export` runbook (RESEARCH A6 — GCP Admin API surface, NOT app code). |

---

## Metadata

**Analog search scope:** `src/jobs/`, `src/firebase/`, `src/audit/`, `src/memory/`, `src/dashboard/`, `src/escalation/`, `app/api/chat/`, `app/[lang]/(coach)/`, `app/[lang]/(admin)/`, `app/[lang]/_components/`, `app/_actions/`, `components/ui/`, `firestore.rules`, `firestore.indexes.json`
**Files scanned:** 17 read in full/targeted + grep verification of escalation index, indexes, dashboard queries
**Key verified facts:**
- `usage-rollup` stub exists at `runDueJobs.ts:208-212` (fill, don't add).
- Route reads `final.usage.totalTokens` at `:522/:607/:620` (undercounts multi-step) — switch NEW capture to `final.totalUsage`.
- `EscalationDoc` (`collections.ts:344-352`) has NO `resolvedAt` — net-new field for resolution-time (resolveStall `dashboard/actions.ts:84` must set it).
- Rules test enumerates 16 collections (`rules.test.ts:89-94`, comment `:21`) → must become 19.
- `resolveStall` lives in `dashboard/actions.ts:71-90` (Server Action), NOT in `src/escalation/`.
- `getReplyQualityMetrics` (`dashboard/actions.ts:334-453`) is the ONLY existing `count()`/`select()` aggregation — the rollup + admin-usage analog.
- `alert-dialog.tsx` already vendored with `variant="destructive"` on `AlertDialogAction` — no new component needed.
**Pattern extraction date:** 2026-06-07

---

## PATTERN MAPPING COMPLETE

**Phase:** 5 - Hardening + Scale-Up
**Files classified:** 27 (22 create + 10 modify; 5 are both new-dir pages)
**Analogs found:** 24 / 27

### Coverage
- Files with exact analog: 18
- Files with role-match analog: 6
- Files with no analog: 3 (1 manifest, 1 dev-tooling, + the markdown artifact set)

### Key Patterns Identified
- **Usage/cost = ONE pipeline:** `route.ts onFinish after()` (`:612`, use `final.totalUsage`) → `recordUsageEvent` (audit-writer shape) → `usageEvents` → `usage-rollup` lazy-cron (`runDueJobs.ts:208` stub, `AggregateField.sum/count`) → `usageRollups` → admin dashboard + cost pass. No second capture site.
- **PDPA erasure spine:** `PII_ERASURE_MANIFEST` (single source) drives `eraseDataSubject` (`recursiveDelete` + audit-EXEMPT erasure event via `audit.log`) + `erasure-sweep` (idempotent re-query) + the coverage test. Audit log survives by code-level exemption (Admin SDK bypasses rules).
- **Admin surfaces all reuse proven seams:** RSC shell + admin gate (`kb/page.tsx`), `getSessionUser` (`dashboard/actions.ts:39`), audited drilldown (`getAgentChatHistory`/`auditDrilldown`), `count()` aggregation (`getReplyQualityMetrics`), `setUserClaims` (`auth.ts:148`), recharts islands (`metrics-panel.tsx`), `alert-dialog.tsx` destructive confirm.
- **3 new collections inherit the `replyEdits`/`knowledgeGaps` discipline:** typed ref + converter (tenantId stamp) + deny-by-default rules (`create/update/delete: if false`, admin-read) + CI rules test (16 → 19).
- **Net-new schema add:** `EscalationDoc.resolvedAt?` for resolution-time analytics (flagged regression on `resolveStall`).

### File Created
`/Users/ka.yin.leong/Documents/cy-csaiagent/.planning/phases/05-hardening-scale/05-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference per-file analog `file:line` excerpts in each PLAN.md action.
