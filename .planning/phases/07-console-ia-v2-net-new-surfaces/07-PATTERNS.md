# Phase 7: Console IA v2 — Net-new Surfaces - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** ~24 new/modified files across 8 surfaces + 2 new collections + cross-cutting
**Analogs found:** 24 / 24 (brownfield — every new file has a close existing twin)

> **Phase nature:** This is a *composition* phase. Almost nothing is invented. Every new file copies a verbatim-proven pattern: the `makeConverter` + numbered-ref-factory registry, the `requireRole()`/route-group gate, the `getSessionUser()`+admin-assert Server Action, `auditDrilldown` write-on-read, the bounded `searchConversations` query, the `getDownline` double-gate, the role-filtered nav model, and `i18n-parity.test.ts`. The ONE net-new mechanism is the Remote Config WRITE round-trip (Surface 6).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/firebase/collections.ts` (ADD `CohortDoc`, `ConversationFlagDoc`, converters, refs; ADD `cohortId?`/`firstCloseAt?` to `AgentProfileDoc`) | model/config | CRUD | self — existing `EscalationDoc`+`escalationsRef`, `KnowledgeGapDoc`, `ReplyEditDoc` (denorm), `KbDocDoc.status` (optional field) | exact |
| `firestore.rules` (ADD `cohorts`, `conversationFlags` blocks) | config/rules | request-response | `escalations` block (`firestore.rules:228-238`), `knowledgeGaps:263-273`, `replyEdits:285-294` | exact |
| `firestore.indexes.json` (ADD `conversationFlags` + `auditLogs` composites) | config | batch | existing `(seniorCoachId,status)` escalations index | exact |
| `src/firebase/__tests__/rules.test.ts` (ADD 2 collection matrices + read-only DENY) | test | request-response | `escalations collection` suite (`:582-635`), `read-only RO-01 matrix` (`:1300+`) | exact |
| `app/[lang]/(admin)/cohorts/actions.ts` (cohort CRUD) | controller (Server Action) | CRUD | `roles/actions.ts` (`assignRole`, `getSessionUser`) | exact |
| `app/[lang]/(admin)/cohorts/page.tsx` + table/dialog component | component (RSC + client) | CRUD | `roles/page.tsx` + `role-assignment.tsx` | exact |
| `app/[lang]/(admin)/agents/[uid]/page.tsx` (profile drill-in) | component (RSC) | request-response (read) | `usage-dashboard.tsx` (metric tiles) + `(coach)/dashboard/` | role-match |
| `src/dashboard/queries.ts` (ADD `getAgentProfile` composer; `daysToFirstClose` aggregate) | service | request-response (read) | self — `getDownline`/`getOpenStalls`/`getKnowledgeGaps` (downline double-gate + `auditDrilldown`) | exact |
| `app/[lang]/(admin)/coach-assignment/actions.ts` (`assignCoach` dual-write) | controller (Server Action) | CRUD (batch) | `roles/actions.ts` gate + Firestore `adminDb.batch()` | exact |
| `app/[lang]/(admin)/coach-assignment/page.tsx` + reassign control | component | CRUD | `roles/page.tsx` + `role-assignment.tsx` | exact |
| `app/[lang]/(admin)/conversations/actions.ts` (ADD `flagConversation`) + `conversation-viewer.tsx` ("Flag" button) | controller + component | event-driven (manual write) | `roles/actions.ts` gate; existing `conversation-viewer.tsx` | exact |
| `app/[lang]/(admin)/flags/actions.ts` (`listFlags`, `reviewFlag`, `dismissFlag`) | controller | CRUD | `searchConversations` (bounded read) + `getOpenStalls` (downline filter) | exact |
| `app/[lang]/(admin)/flags/page.tsx` + queue table | component | request-response | `roles/page.tsx` table shape; `getOpenStalls` for data | role-match |
| `app/[lang]/(admin)/audit-log/actions.ts` (`listAuditLogs` bounded cursor) | controller | request-response (read) | `searchConversations` (`actions.ts:160-191` bounded `limit(50)`+`startAt`) | exact |
| `app/[lang]/(admin)/audit-log/page.tsx` + filter toolbar/pagination | component | request-response | `conversation-viewer.tsx`; `pagination.tsx` primitive | role-match |
| `app/[lang]/(admin)/model-config/actions.ts` (`publishModelConfig` WRITE; read of 5 keys) | controller (Server Action) | transform (RC read/write) | `src/llm/provider.ts` (`modelFor` READ path) + `roles/actions.ts` gate | **partial — WRITE path net-new** |
| `app/[lang]/(admin)/model-config/page.tsx` + per-pillar cards | component | CRUD | `usage-dashboard.tsx` card grid; `input`/`alert-dialog` primitives | role-match |
| `src/pdpa/policy-constants.ts` (static policy values) | config/utility | request-response | `REMOTE_CONFIG_FALLBACKS` labeled-constant idiom (`provider.ts:39`) | role-match |
| `app/[lang]/(admin)/pdpa-settings/page.tsx` (static RSC) | component (RSC) | request-response | `usage-dashboard.tsx` card; existing `erasure/` route (link target) | role-match |
| `app/[lang]/(admin)/agents/[uid]/actions.ts` (or shared) `recordFirstClose` (idempotent) | controller (Server Action) | CRUD | `roles/actions.ts` gate + `(coach)/dashboard/actions.ts` `resolveStall` | exact |
| `usage-dashboard.tsx` (ADD days-to-first-close aggregate tile) | component | request-response | self — existing metric tiles | exact |
| `app/[lang]/_components/app-sidebar-nav.ts` (ADD 8 nav items across 4 sections) | config/model | n/a | self — `buildSections`/`visibleSectionsForRole` | exact |
| `app/[lang]/_components/app-sidebar-nav.test.ts` (ADD nav visibility + read-only-DENY assertions) | test | n/a | self — existing nav test | exact |
| `src/i18n/messages/{en,ms,zh}.json` (ADD all new keys) | config | n/a | existing catalogs; `i18n-parity.test.ts` (no test change needed) | exact |

---

## Pattern Assignments

### `src/firebase/collections.ts` — 2 new collections + 2 optional fields (COH-01, COH-02, FLAG-01, CLOSE-01)

**Analog:** self — `EscalationDoc`/`escalationsRef`, `ReplyEditDoc` (denorm `seniorCoachId`), `EscalationDoc.resolvedAt` (optional-field precedent).

**Converter factory + ref-factory registry** (lines 638-689) — the exact shape to extend:
```typescript
function makeConverter<T extends { tenantId: TenantId }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data) { return { ...(data as DocumentData), tenantId: TENANT_ID } }, // auto-stamp
    fromFirestore(snapshot) { return snapshot.data() as T },
  }
}
export const escalationConverter = makeConverter<EscalationDoc>()   // line 665
/** Collection 2: agentProfiles/{uid} */
export function agentProfilesRef(): CollectionReference<AgentProfileDoc> {
  return adminDb.collection('agentProfiles').withConverter(agentProfileConverter) // line 687
}
```
→ ADD `cohortConverter`/`conversationFlagConverter` next to the converter block (after line 673), and `cohortsRef()` (Collection 21) + `conversationFlagsRef()` (Collection 22) next to the ref block, with the numbered `/** Collection N */` doc-comment convention. Update the header inventory comment (lines 9-29) to list collections 21 + 22.

**Denormalized `seniorCoachId` for coach read-scope** — copy the `ReplyEditDoc` rationale (lines 459-479): the writer looks up `agentProfiles/{agentUid}.seniorCoachId` and stamps it on the `conversationFlags` row so the rule can match `resource.data.seniorCoachId == request.auth.uid`.

**Optional-field backward-compat** — copy `EscalationDoc.resolvedAt` (lines 358-364) and `KbDocDoc.status` precedent: a new optional field needs NO backfill; reads treat absent as the default. Add to `AgentProfileDoc` (lines 75-83):
```typescript
/** Phase-7 COH-02: one-cohort-per-agent membership (D-02). Absent on pre-Phase-7 docs. */
cohortId?: string
/** Phase-7 CLOSE-01: first-close signal (D-20). Absent = no close yet. Idempotent set (D-21). */
firstCloseAt?: Date | FieldValue
```
**Constraint reminder:** `collections.ts` uses `adminDb` (server-only) — never import from a client component; new reads go through Server Components / Server Actions.

---

### `firestore.rules` — `cohorts` + `conversationFlags` blocks (COH-03, FLAG-02, FLAG-03)

**Analog:** `escalations` block (lines 228-238) — the exact deny-by-default + coach-downline + admin shape.

**Server-write-only + coach/admin-read pattern** (lines 228-238) to mirror for `conversationFlags`:
```javascript
match /escalations/{eid} {
  allow read:
    if (hasRole('senior-coach')
        && resource.data.seniorCoachId == request.auth.uid
        && sameTenant())
    || (hasRole('admin') && sameTenant());
  allow create, update, delete: if false;   // Admin SDK bypasses rules; clients never write
}
```
→ `conversationFlags` copies this verbatim (`create,update,delete: if false` — D-09 server-write-only). `cohorts` uses `allow read: if (hasRole('senior-coach') && sameTenant()) || (hasRole('admin') && sameTenant());` and `allow write: if hasRole('admin') && incomingTenant();` (D-03 admin-write; cohort doc has no `seniorCoachId`, so downline filter is applied app-side — see Research Open Q3).

**read-only is DENIED by construction** (D-24): do NOT add `isAnalyticsReader()` or `isReadOnlyRole()` grants to either new block. read-only is neither coach nor admin, so it falls through to deny-by-default. This is the LOCKED Phase-6 least-privilege posture — see Shared Patterns §read-only-DENY.

---

### `src/firebase/__tests__/rules.test.ts` — 2 new matrices (COH-01, FLAG-01)

**Analog:** `escalations collection` suite (lines 582-635) + the deny-by-default loop (lines 95-107).

- ADD `'cohorts'`, `'conversationFlags'` to the `collections` array in the unauthenticated-deny loop (line 97).
- ADD a per-collection `rulesSuite('conversationFlags collection', ...)` mirroring `escalations` (`:582`): seed a downline row + a stranger row; assert coach reads own-downline (`assertSucceeds`), coach CANNOT read stranger (`assertFails`), new-agent CANNOT read, client create is DENIED.
- ADD `cohorts`/`conversationFlags` rows to the **read-only RO-01 matrix** (`:1300+`) asserting read-only is DENIED (Pitfall 2). Per the comment at `:1295`, list these in the DENY set, NOT as a SUCCEEDS read.

---

### `app/[lang]/(admin)/cohorts/actions.ts` & coach-assignment & flag & model-config & record-close — Server Actions

**Analog:** `roles/actions.ts` (the verbatim admin-gate template).

**`getSessionUser()` helper** (`roles/actions.ts:43-56`) — copy verbatim into every new actions file:
```typescript
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()                          // Next 16: async
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) throw new UnauthorizedError('No session cookie')
  const syntheticReq = new Request('https://d2.app/admin/...', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}
```

**Admin-gate + audited write + result-union pattern** (`assignRole`, `:110-151`):
```typescript
export async function assignRole(targetUid, role, downline?) {
  let user
  try { user = await getSessionUser() } catch { return { ok: false, error: 'Unauthorized' } }
  if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }   // role from VERIFIED token, never args (T-02-31)
  try {
    await setUserClaims(targetUid, role)
    await audit.log({ actorUid: user.uid, action: 'role-assign', targetRef: `users/${targetUid}`, raw: { targetUid, role } })
    return { ok: true }
  } catch (err) { return { ok: false, error: ... } }
}
```
Per-surface adaptation:
- **cohorts CRUD (COH-03):** admin-only; `action: 'cohort-create'|'cohort-update'|'cohort-delete'`; writes via `cohortsRef()`.
- **coach-assignment (ASSIGN-01):** admin-only; **`adminDb.batch()`** dual-write `agentProfilesRef().doc(uid).update({seniorCoachId})` + `usersRef().doc(uid).update({uplineCoachId})`, `batch.commit()` (atomic, D-06); `action: 'coach-assign'`. Historical denorm rows NOT backfilled (D-08 — document in the action).
- **flagConversation (FLAG-02):** coach (own-downline conv) + admin; looks up `agentProfiles/{agentUid}.seniorCoachId` and stamps it on the flag (denorm); `conversationId` reference ONLY, no content (D-10).
- **recordFirstClose (CLOSE-01):** coach (own-downline) + admin; **idempotent** — read current `firstCloseAt`; if set, no-op / require admin override (D-21, Research Pitfall 5). Use a transaction or absence-guarded update.
- **publishModelConfig (MODEL-02):** see net-new section below.

---

### `app/[lang]/(admin)/model-config/actions.ts` — Remote Config WRITE (MODEL-01, MODEL-02) — **THE ONE NET-NEW MECHANISM**

**Analog (READ side):** `src/llm/provider.ts` `modelFor` (lines 70-88) — `remoteConfig().getServerTemplate() → evaluate() → getString('model.{pillar}.default')`; the `Pillar` union (`:29`); `REMOTE_CONFIG_FALLBACKS` (`:39`, shown as hints only, never an allow-list).

**WRITE path (net-new, from Research Code Examples + verified `firebase-admin/remote-config` v13.10.0):**
```typescript
'use server'
import { remoteConfig } from '@/src/firebase/admin'      // existing export
// getSessionUser() + assert user.role === 'admin' (copy from roles/actions.ts)
export async function publishModelConfig(pillar: string, modelId: string) {
  const rc = remoteConfig()
  const template = await rc.getTemplate()                 // carries the writable ETag (NOT getServerTemplate)
  const key = `model.${pillar}.default`                   // validate pillar ∈ {coach,finder,reply,router,grader} (D-16)
  template.parameters[key] = { ...(template.parameters[key] ?? {}), defaultValue: { value: modelId } }
  try {
    await rc.publishTemplate(template)                    // WITHOUT { force:true } — ETag optimistic concurrency (D-16)
  } catch { return { ok: false as const, error: 'conflict' } }   // stale ETag → surface conflict, never blind-overwrite
  await audit.log({ actorUid: user.uid, action: 'model_config_publish', raw: { pillar, modelId } })  // hashed (D-17)
  return { ok: true as const }
}
```
**Constraints:** model IDs stay free-form strings (D-15); only the 5 keys editable (D-16); `REMOTE_CONFIG_FALLBACKS` constants stay untouched (D-17). Display read MAY reuse `modelFor`'s server-template path; the WRITE MUST use `getTemplate()` for the ETag. Surface "Changes may take a moment to take effect" — do NOT claim instant (Research Pitfall 3 / UI-SPEC error copy).

---

### `app/[lang]/(admin)/audit-log/actions.ts` — bounded cursor read (AUDIT-01)

**Analog:** `searchConversations` (`conversations/actions.ts:160-191`).

**Bounded `limit(50)` + cursor pattern** (lines 179-191):
```typescript
const { adminDb } = await import('@/src/firebase/admin')   // inline import — avoids Admin SDK at module load in tests
const q = adminDb.collection('conversations').limit(50)     // bounded — never fetch-all
const snapshot = await (query
  ? adminDb.collection('conversations').orderBy('__name__').startAt(query).endAt(query + '￿').limit(50).get()
  : q.get())
```
→ ADD `listAuditLogs({ action?, actorUid?, cursorTs? })`: admin-gate (D-13); `orderBy('ts','desc').limit(50)`; `.startAfter(cursorTs)` for pagination; `where('action','==',x)` / `where('actorUid','==',x)` filters need the new composite indexes. Return `{ actorUid, action, targetRef, ts }` only — hashes NOT decoded (D-12). **Does NOT call `auditDrilldown`** — must NOT self-audit (D-14).

---

### `src/dashboard/queries.ts` — agent-profile composer + days-to-first-close (PROF-01, PROF-02, CLOSE-02)

**Analog:** self — `getDownline` (lines 106-132), `getOpenStalls`, `getKnowledgeGaps`.

**Downline double-gate + audit-before-read pattern** (`getDownline`, lines 106-132):
```typescript
export async function getDownline(coachUid, opts?) {
  await auditDrilldown(coachUid, 'agentProfiles')          // PDPA: audit BEFORE returning data (T-02-29)
  let query = agentProfilesRef()...
  if (!opts?.adminAll) query = query.where('seniorCoachId', '==', coachUid)   // AUTH-06 gate 1 (rules = gate 2)
  const snap = await query.get()
  ...
}
```
→ ADD `getAgentProfile(coachUid, agentUid, opts?)`: same `auditDrilldown` write-on-read (PROF-02); compose `agentProfiles/{uid}` (+ new `cohortId`/`firstCloseAt`) with `usageRollups` for that uid + escalation/knowledgeGap counts. Coach access gated by `seniorCoachId == coachUid` (admin via `adminAll`). The `toDate()` normalizer (lines 38-44) handles Firestore Timestamp→Date.
→ ADD `daysToFirstClose` read-time computation: `firstCloseAt − onboarding start`. **Research Pitfall 4 / Open Q1:** `AgentProfileDoc` has NO `createdAt` — use Admin SDK `snapshot.createTime` for zero-migration derivation (gate behind a Derek confirm). NEVER use `lastActiveAt` (a moving timestamp).

---

### `app/[lang]/_components/app-sidebar-nav.ts` — 8 nav entries (NAV-01)

**Analog:** self — `buildSections` (lines 92-147) + `visibleSectionsForRole` (lines 161-168).

ADD `NavItemKey` entries (cohorts, agentProfiles, coachAssignment, flags, auditLog, modelConfig, pdpaSettings, daysToFirstClose) into the matching section's `items` array (D-25 placement). Copy the existing item shape exactly:
```typescript
{ key: 'roles', href: `/${lang}/roles`, icon: ShieldCheck, roles: ['admin'] }   // line 140
```
**Critical (D-24):** NONE of the 8 new items lists `'read-only'` in `roles` — read-only sees NOTHING new in Phase 7. Coach-visible items (flags, agent profiles) list `['admin','senior-coach']`; the rest `['admin']`. This is UX-only — the `requireRole()` page gate + Firestore rules are the boundary (file header T-06-15).

---

### Pages & components (cohorts, coach-assignment, flags, audit-log, model-config, pdpa-settings, agent profile)

**Analog (admin CRUD page):** `roles/page.tsx` + `role-assignment.tsx` (list page + dialog + `AlertDialog` confirm).
**Analog (read/metric surface):** `usage-dashboard.tsx` (card grid, metric tiles, em-dash empty) + `conversation-viewer.tsx` (table + filter).
**Analog (route-group gate):** `app/[lang]/(admin)/layout.tsx` — admits admin + read-only into the group, defers per-page decision. Each new page's RSC calls `requireRole({ lang, allowed: ['admin'] })` (or `['admin','senior-coach']` for flags/agent-profile). **No Phase-7 page lists `'read-only'` in `allowed`** (D-24).

All UI primitives are vendored (UI-SPEC) — no `npx shadcn add`. Use `table`/`dialog`/`form`/`alert-dialog`/`card`/`badge`/`pagination`/`combobox`/`input`/`sonner`. PDPA-settings reads from the new `src/pdpa/policy-constants.ts` (mirrors the labeled-constant idiom of `REMOTE_CONFIG_FALLBACKS`).

---

## Shared Patterns

### Server-side role gate (apply to EVERY new page)
**Source:** `app/[lang]/_lib/require-role.ts` (lines 63-108) + `(admin)/layout.tsx`.
**Apply to:** all 8 surfaces.
```typescript
const user = await requireRole({ lang, allowed: ['admin'] })           // admin-only surfaces
const user = await requireRole({ lang, allowed: ['admin','senior-coach'] }) // flags + agent-profile
```
Role read from the VERIFIED token only; redirect() called OUTSIDE try/catch (Pitfall 6); `cookies()` awaited (Next 16). **read-only is NEVER in `allowed` for any Phase-7 surface (D-24).**

### read-only DENY (LOCKED Phase-6 least-privilege)
**Source:** `firestore.rules` `isReadOnlyRole()` (`:61-63`), `isAnalyticsReader()` (`:47-49`); the RO-01 test matrix (`rules.test.ts:1300+`).
**Apply to:** every new rule block, every page `allowed`, every nav item `roles`.
Do NOT add any `isAnalyticsReader()`/`hasRole('read-only')` grant in Phase 7 (Research Pitfall 2). Widening PDPA-settings to read-only is an **Open Derek decision (D-19)** — not a planner choice.

### Admin-only Server Action gate + audited write
**Source:** `roles/actions.ts:43-151` (`getSessionUser` + `user.role !== 'admin'` + `audit.log`).
**Apply to:** cohort CRUD, coach-assignment, flag, model-config, record-close.

### Audited write-on-read (coach drilldown)
**Source:** `src/audit/log.ts` `auditDrilldown(actorUid, targetRef)` (`:120-127`); used in `dashboard/queries.ts:111`.
**Apply to:** agent-profile coach reads (PROF-02). Surface 5 (audit-log viewer) does NOT self-audit (D-14).

### Audit row hashing (never store raw)
**Source:** `src/audit/log.ts` `log({ raw })` (`:76-97`) — sha256-hashes every value in `raw`.
**Apply to:** every audited action; pass `pillar`/`modelId`/`agentUid` as `raw`. Hashes are one-way — the audit-log viewer never decodes them (D-12).

### Composite indexes before the consuming query
**Source:** existing `(seniorCoachId,status)` escalations index.
**Apply to:** `conversationFlags` `(seniorCoachId,status)` + `(status,createdAt)`; `auditLogs` `(action,ts)` + `(actorUid,ts)`. Deploy + wait for build BEFORE the consuming surface ships (Research Pitfall 6). Single-field `orderBy('ts','desc')` needs no composite index.

### Trilingual parity
**Source:** `src/i18n/__tests__/i18n-parity.test.ts` + `messages/{en,ms,zh}.json`.
**Apply to:** every new surface string + nav label — add to ALL THREE catalogs. The test goes RED if a key is missing in one (no test change needed; D-26).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none — every file has a close existing twin) | — | — | The Remote Config WRITE *mechanism* (`getTemplate`→mutate→`publishTemplate` w/ ETag) inside `model-config/actions.ts` is the only net-new code path; its surrounding Server-Action shell still copies `roles/actions.ts`. Verified against `firebase-admin/remote-config` v13.10.0 .d.ts (Research §Standard Stack). |

**One open data question (gate before building):** `AgentProfileDoc` has no `createdAt`/`onboardingStartedAt` for the days-to-first-close denominator (Research Pitfall 4 / Open Q1). Recommended: Admin SDK `snapshot.createTime` (zero-migration), pending a Derek confirm.

---

## Metadata

**Analog search scope:** `src/firebase/`, `app/[lang]/(admin)/`, `app/[lang]/(coach)/`, `app/[lang]/_components/`, `app/[lang]/_lib/`, `src/llm/`, `src/audit/`, `src/dashboard/`, `src/i18n/`.
**Files scanned:** collections.ts, firestore.rules, rules.test.ts, require-role.ts, (admin)/layout.tsx, roles/actions.ts, conversations/actions.ts, app-sidebar-nav.ts, llm/provider.ts, audit/log.ts, dashboard/queries.ts (+ directory listings).
**Pattern extraction date:** 2026-06-11
