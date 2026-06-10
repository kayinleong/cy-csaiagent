# Phase 6: Console IA v2 — Restructure + Read-only Role - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 24 (modify) + 8 (new)
**Analogs found:** 31 / 32 (1 net-new: integrations shell — closest-analog mirror provided)

> **How to read this file:** Phase 6 is a brownfield restructure. Almost every target is a MODIFY of an existing file or a NEW file that mirrors a verified analog at file:line. Each entry below gives the exact excerpt to copy and the single adaptation needed. The role-branch checklist (Pattern A) is the acceptance gate — no site may be missed.

---

## File Classification

| Target File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|-------------|---------|------|-----------|----------------|-------|
| `src/firebase/auth.ts` | MOD | model/auth-core | request-response (claims) | self (extend in place) | exact |
| `app/[lang]/(admin)/layout.tsx` | MOD | route-group gate | request-response | self / `(coach)/layout.tsx` | exact |
| `app/[lang]/(coach)/layout.tsx` | MOD | route-group gate | request-response | self / `(admin)/layout.tsx` | exact |
| `app/[lang]/page.tsx` | MOD | route (landing redirect) | request-response | self | exact |
| `app/[lang]/(admin)/{kb,inventory,conversations,roles,usage,erasure}/page.tsx` | MOD | page gate | request-response | `inventory/page.tsx` | exact |
| `app/[lang]/(admin)/kb/[docId]/page.tsx` | MOD | page gate + RSC viewer | request-response + transform | self (version chain :45) | exact |
| `app/[lang]/(admin)/roles/actions.ts` | MOD | service (Server Action) | CRUD (claims) | self (`AssignableRole` :60) | exact |
| `app/[lang]/(admin)/roles/role-assignment.tsx` | MOD | component | request-response | self | exact |
| `app/[lang]/(coach)/dashboard/actions.ts` | MOD | service (Server Action) | CRUD/aggregation | self (`adminAll` :362) | exact |
| `app/[lang]/(admin)/conversations/actions.ts` | MOD | service (Server Action) | CRUD | self | exact |
| `app/[lang]/(admin)/erasure/actions.ts` | MOD | service (Server Action) | CRUD | self | exact |
| `src/kb/crud.ts` | MOD | service (KB authz) | CRUD/transform | self (`assertAdminOrCoach` :533) | exact |
| `app/[lang]/_components/app-sidebar.tsx` | MOD | component (nav) | event-driven (presentation) | self (8-item flat) | exact |
| `app/[lang]/_components/console-shell.tsx` | MOD (likely none) | component (shell) | presentation | self | exact |
| `firestore.rules` | MOD | config (RBAC) | request-response (deny/allow) | self (19 collections) | exact |
| `app/[lang]/(admin)/kb/kb-doc-list.tsx` | MOD (bug fix only) | component | presentation | self (:188 broken href) | exact |
| `src/i18n/messages/{en,ms,zh}.json` | MOD | config (i18n) | static | self (`nav` block) | exact |
| **NEW** `app/[lang]/(admin)/integrations/page.tsx` | NEW | page gate (static panel) | request-response | `inventory/page.tsx` (gate) | role-match |
| **NEW** Home surface page (RSC landing) | NEW | route + RSC | aggregation/transform | `page.tsx` redirect + `dashboard/actions.ts` aggregations + `usage-dashboard.tsx` | role-match |
| **NEW** `src/firebase/__tests__/rules-helpers.ts` (extend) + `tests/fixtures/synthetic-users.ts` (extend) | MOD | test fixture | n/a | self | exact |
| **NEW** read-only matrix in `rules.test.ts` | MOD | test | n/a | self (deny-by-default loop :88) | exact |
| **NEW** `app-sidebar.test.tsx` | NEW | test (render) | n/a | (no render-test analog — see note) | partial |
| **NEW** `i18n-parity.test.ts` | NEW | test (unit) | n/a | `src/i18n/detect.test.ts` | role-match |
| **NEW** `integrations.test.tsx` (no-send assertion) | NEW | test (render) | n/a | (no render-test analog) | partial |
| **NEW** read-only gate redirect test | NEW | test | n/a | `roles/actions.test.ts` (Forbidden cases) | role-match |
| `roles/actions.test.ts` (extend with RO Forbidden cases) | MOD | test | n/a | self | exact |
| `src/firebase/auth.test.ts` (extend with `read-only` union) | MOD | test | n/a | self | exact |
| e2e KB nav spec (extend `inventory-admin.spec.ts`) | MOD/NEW | test (e2e) | n/a | `e2e/inventory-admin.spec.ts` | exact |

---

## Shared Patterns

### Pattern A — Server-side role gate (THE canonical pattern; the read-only checklist)
**Source:** `app/[lang]/(admin)/inventory/page.tsx:46-70` (verbatim across every gated page)
**Apply to:** Every per-page gate and every route-group layout that branches on role.

```typescript
const cookieStore = await cookies()                       // Next 16: async — await
const sessionCookie = cookieStore.get('__session')
if (!sessionCookie?.value) redirect(`/${lang}/sign-in`)
let user: Awaited<ReturnType<typeof requireUser>>
try {
  const syntheticReq = new Request('https://d2.app/admin/inventory', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  user = await requireUser(syntheticReq)                  // verifyIdToken — the REAL gate
} catch (err) {
  if (err instanceof UnauthorizedError) redirect(`/${lang}/sign-in`)
  throw err
}
if (user.role !== 'admin') redirect(`/${lang}/chat`)      // ← the role branch to extend for read-only
```

**Adaptation:** For surfaces read-only MAY see (Home, usage analytics, KB version-history viewer), change the branch from `if (user.role !== 'admin')` to an explicit allow-list, e.g. `if (user.role !== 'admin' && user.role !== 'read-only') redirect(...)`. For all WRITE/admin surfaces the branch is UNCHANGED (read-only stays denied). **Pitfall 6:** `redirect()` throws `NEXT_REDIRECT` — resolve role inside try/catch, call `redirect()` OUTSIDE (see `page.tsx:6-8`).

**THE READ-ONLY CHECKLIST (VERIFIED file:line — every site must be visited; no site may be missed, Pitfall 4):**

| Site | file:line | Read-only action |
|------|-----------|------------------|
| Role union | `src/firebase/auth.ts:36` | add `'read-only'` |
| VALID_ROLES | `src/firebase/auth.ts:46` | add `'read-only'` |
| Landing redirect | `app/[lang]/page.tsx:36-42` | add `read-only → /${lang}` (Home), NOT chat |
| Sign-in redirect | `app/[lang]/(auth)/sign-in/sign-in-form.tsx:91` | route read-only to Home |
| Admin layout gate | `app/[lang]/(admin)/layout.tsx:50` | keep deny (admin pages); read-only redirects to Home |
| Coach layout gate | `app/[lang]/(coach)/layout.tsx:51` | keep deny (dashboard carries PII) |
| KB page gate | `app/[lang]/(admin)/kb/page.tsx:65` | keep admin-only (KB management) |
| KB detail gate | `app/[lang]/(admin)/kb/[docId]/page.tsx:98` | WIDEN to allow read-only (version-history viewer), hide edit form |
| Inventory page gate | `app/[lang]/(admin)/inventory/page.tsx:67` | keep admin-only |
| Conversations page gate | `app/[lang]/(admin)/conversations/page.tsx:58` | keep admin-only (PII) |
| Roles page gate | `app/[lang]/(admin)/roles/page.tsx:60` | keep admin-only |
| Usage page gate | `app/[lang]/(admin)/usage/page.tsx:78` | WIDEN to allow read-only (analytics) |
| Erasure page gate | `app/[lang]/(admin)/erasure/page.tsx:63` | keep admin-only |
| `assignRole` action | `roles/actions.ts:120` | keep deny |
| `listUsersWithRoles` action | `roles/actions.ts:168` | keep deny |
| `AssignableRole` type | `roles/actions.ts:60` | add `'read-only'` (so admin can assign it) |
| conversations actions | `conversations/actions.ts:121,171` | keep deny |
| erasure actions | `erasure/actions.ts:132,239,342` | keep deny |
| dashboard actions (8) | `dashboard/actions.ts:87,147,199,260,265,358,543,658` | keep deny (PII) unless AP-01 widens a counts-only action |
| KB authz | `src/kb/crud.ts:523` (`assertAdmin`), `:533` (`assertAdminOrCoach`) | keep deny read-only |
| Firestore rules | `firestore.rules` (19 collections) | add `isAnalyticsReader()` only to analytics collections (Pattern E) |
| Sidebar role filter | `app-sidebar.tsx:51-62` | add read-only to visible items (Home + usage only) — UX only |
| Role assignment UI | `roles/role-assignment.tsx:67-78` | add read-only to `CAPABILITIES`/`ALL_ROLES`/role Select |
| Synthetic users | `tests/fixtures/synthetic-users.ts` | add a 4th synthetic read-only user |
| rules-helpers | `src/firebase/__tests__/rules-helpers.ts` | add `readOnlyCtx()` |

### Pattern B — Session helper for Server Actions
**Source:** `app/[lang]/(admin)/roles/actions.ts:43-56` (verbatim copy of `dashboard/actions.ts:47-60`)
**Apply to:** Any new Server Action.
```typescript
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) throw new UnauthorizedError('No session cookie')
  const syntheticReq = new Request('https://d2.app/admin/roles', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}
```
Then: `try { user = await getSessionUser() } catch { return { ok:false, error:'Unauthorized' } }` followed by the role gate returning `{ ok:false, error:'Forbidden' }` (`roles/actions.ts:114-122`).

### Pattern C — Result type + audit on write
**Source:** `roles/actions.ts:62-69, 131-145`
**Apply to:** Any new Server Action that writes or reads scoped data.
```typescript
export interface AssignRoleResult { ok: true }
export type AssignRoleError = { ok: false; error: string }
// ...after a successful write:
await audit.log({ actorUid: user.uid, action: 'role-assign', targetRef: `users/${targetUid}`, raw: { targetUid, role } })
```
Aggregation reads audit via `auditDrilldown(user.uid, '<collection>')` (`dashboard/actions.ts:387`).

### Pattern D — Role-scoped aggregation (`adminAll` vs `seniorCoachId`) — REUSE for AP-01 per-coach pivot
**Source:** `app/[lang]/(coach)/dashboard/actions.ts:362-378`
```typescript
const adminAll = user.role === 'admin'
const scopedReplyEdits = (): CountableQuery => {
  const base = replyEditsRef() as unknown as CountableQuery
  return adminAll ? base : base.where('seniorCoachId', '==', user.uid)
}
const countOf = async (q) => (await q.count().get()).data().count   // count() — never fetch-all
```
**Adaptation (AP-01):** add a 3rd branch — admin may pass `coachUid` → `base.where('seniorCoachId','==', coachUid)`. The `coachUid` filter is gated to `role==='admin'` (a coach branch stays `== user.uid`). Still read-only, still `auditDrilldown`. **Threat:** never let a coach pass `coachUid`.

### Pattern E — Firestore rules helper for the analytics-reader role (RO-01)
**Source:** extend `firestore.rules`; mirror the existing `hasRole`/`sameTenant` helpers (`:25-37`) and the analytics-collection rules (`usageRollups` :291-294, `usageEvents` :282-285, `evals` :220-223).
```
// New helper (add near hasRole, :25):
function isAnalyticsReader() {
  return (hasRole('admin') || hasRole('read-only')) && sameTenant();
}
// usageRollups / usageEvents / evals — change `read: if hasRole('admin') && sameTenant()`
//   to `read: if isAnalyticsReader();`
// KB read collections (projects :150, collateral :159, kbDocs :168, kbChunks :177, kbIngestionJobs :186)
//   already allow `isSignedIn() && sameTenant()` → read-only inherits read (no change).
// DO NOT add read-only to: users, agentProfiles, conversations, messages, leads, leadContext,
//   auditLogs, escalations, knowledgeGaps, replyEdits, rateBudgets, erasureRequests (Pitfall 2).
// Writes stay `hasRole('admin')` / `if false` everywhere — read-only never writes.
```
**Acceptance grid:** see 06-RESEARCH.md "collection-by-collection rules matrix". Default knowledgeGaps/escalations to DENY (carry agentUid).

---

## Pattern Assignments

### `src/firebase/auth.ts` (MOD — model/auth-core)
**Analog:** self. Extend in place; the claim path (`setUserClaims` :148) already validates against `VALID_ROLES` — no further change to the claim path.
```typescript
// :36 + :46 — add the 4th role to both:
export type Role = 'new-agent' | 'senior-coach' | 'admin' | 'read-only'
const VALID_ROLES: Role[] = ['new-agent', 'senior-coach', 'admin', 'read-only']
```
**Adaptation:** none beyond the two lines. `requireUser` (:96) reads role from the verified token; `setUserClaims` (:148) auto-validates. **Note:** `setUserClaims` (:172) only upserts `agentProfiles` for `new-agent` — read-only correctly gets no agent profile.

### `app/[lang]/(admin)/layout.tsx` + `(coach)/layout.tsx` (MOD — route-group gates)
**Analog:** self (Pattern A). `(admin)/layout.tsx:50-53` currently `if (user.role !== 'admin') redirect(coach→dashboard | else→chat)`.
**Adaptation:** add a read-only branch that redirects to Home (`/${lang}`) — read-only must NOT land on chat or dashboard. `(coach)/layout.tsx:51` keeps denying read-only (downline PII).

### `app/[lang]/page.tsx` (MOD — landing redirect)
**Analog:** self (`:36-42`).
```typescript
if (role === 'read-only') redirect(`/${lang}`)   // Home (CONTEXT lock: read-only lands on Home, not chat)
if (role === 'senior-coach' || role === 'admin') redirect(`/${lang}/dashboard`)  // (or Home once Home exists)
```
**Adaptation:** add the read-only branch; redirect is OUTSIDE the try/catch (already correct here).

### `app/[lang]/(admin)/kb/[docId]/page.tsx` (MOD — version-history viewer, KM-01)
**Analog:** self. The version chain (`buildVersionChain` :45-72) and the version-history UI (`:156-206`) ALREADY EXIST — reuse verbatim, no schema change, no extra reads.
**Adaptations (three small):**
1. **Widen the gate** (`:98`) to allow `admin` OR `read-only` (and optionally senior-coach); for non-admin, render the version chain but HIDE the `<KbDocForm>` edit section (`:208-224`).
2. **Fix the broken deep-link bug** (CONTEXT lock + Pitfall 1): `:138` ``href={`/${lang}/admin/kb`}`` → ``/${lang}/kb`` and `:178` ``href={`/${lang}/admin/kb/${id}`}`` → ``/${lang}/kb/${id}`` (route group `(admin)` never appears in the URL).
3. Same fix in `kb/kb-doc-list.tsx:188`.

### `app/[lang]/(admin)/roles/actions.ts` + `role-assignment.tsx` (MOD — RO-01 assignment)
**Analog:** self.
- `actions.ts:60` — add `'read-only'` to `AssignableRole`. The `assignRole` gate (`:120`) and `listUsersWithRoles` gate (`:168`) stay admin-only (admin assigns the role; read-only cannot self-assign).
- `role-assignment.tsx:67-78` — add a `capViewAnalytics`-style capability row + `'read-only'` to `ALL_ROLES` and a `<SelectItem value="read-only">` in the role picker (`:235-237`). Add the matrix column header.

### `app/[lang]/_components/app-sidebar.tsx` (MOD — 6-section IA, IA-01)
**Analog:** self. Today: a flat `NavItem[]` (`:51-60`) filtered by `items.filter(i => i.roles.includes(role))` (`:62`), rendered in ONE `<SidebarGroup>` (`:76-95`).
**Adaptation (regroup over EXISTING routes — do NOT move route folders, CONTEXT lock):** introduce a `SECTIONS` array (one `SidebarGroup` per section), `href`s UNCHANGED. Use the 6-section shape from 06-RESEARCH.md "Code Examples":
```typescript
// extend NavItem with the section grouping; render SECTIONS.map(s =>
//   <SidebarGroup><SidebarGroupLabel>{t(s.key)}</SidebarGroupLabel>
//     <SidebarGroupContent><SidebarMenu>{visibleItems(s).map(...existing button...)}</SidebarMenu>)
const SECTIONS = [
  { key:'home',          items:[{ key:'home', href:`/${lang}`, roles:['senior-coach','admin','read-only'] }] },
  { key:'knowledge',     items:[{ key:'kb', href:`/${lang}/kb`, roles:['admin'] }, { key:'inventory', href:`/${lang}/inventory`, roles:['admin'] }] },
  { key:'agents',        items:[{ key:'dashboard', href:`/${lang}/dashboard`, roles:['senior-coach','admin'] }] },
  { key:'conversations', items:[{ key:'conversations', href:`/${lang}/conversations`, roles:['admin'] }] },
  { key:'analytics',     items:[{ key:'usage', href:`/${lang}/usage`, roles:['admin','read-only'] }] },
  { key:'system',        items:[{ key:'roles', href:`/${lang}/roles`, roles:['admin'] }, { key:'integrations', href:`/${lang}/integrations`, roles:['admin'] }, { key:'erasure', href:`/${lang}/erasure`, roles:['admin'] }] },
]
```
Keep the existing `SidebarMenuButton asChild isActive={isActive(href)} tooltip={t(item.key)}` button (`:84-89`) and `isActive` helper (`:64-66`) verbatim. **Anti-pattern reminder (`:7-8`):** the sidebar is UX only — NOT a security gate.

### NEW: Home surface (RSC landing, HOME-01)
**Analogs (compose, don't invent):**
- Gate + redirect: `app/[lang]/page.tsx` (Pattern A landing redirect).
- Aggregations: `app/[lang]/(coach)/dashboard/actions.ts` (Pattern D `count()`/`select()` scoping — funnel, stall inbox, knowledge gaps).
- Rollup reads + stale watchdog: `app/[lang]/(admin)/usage/usage-dashboard.tsx:154-161` (`staleWatchdog && latestRollupRelative` Alert) fed from a serializable RSC prop (`UsageDashboardProps` :84-101).
**Adaptation:** Home is a NEW RSC that gates (Pattern A allowing senior-coach/admin/read-only), calls EXISTING aggregation actions, and renders KPI Cards + the stale watchdog. **No new lazy-cron jobs** (CONTEXT lock) — read pre-aggregated `usageRollups` (never raw `usageEvents`, Anti-pattern). Reuse the `Card`/`Alert` shadcn primitives already imported by `usage-dashboard.tsx:43-44`.

### NEW: `app/[lang]/(admin)/integrations/page.tsx` (Integrations shell, SC-01)
**Closest analog:** `app/[lang]/(admin)/inventory/page.tsx` (a minimal admin RSC page: Pattern A gate at `:46-70`, header at `:84-89`).
**Adaptation:** mirror the gate + header + container layout but render a STATIC registry placeholder panel (Cards listing future integrations). **HARD CONSTRAINT (CONTEXT + Pitfall/Threat):** NO send/auto-send affordance — no button, no handler, no toggle that implies sending. Admin-only gate (read-only NOT admitted). No data model, no Server Action, no Firestore read. This is the ONLY net-new surface with no exact analog.

### `src/kb/crud.ts` (MOD — senior-coach KB contribution, CKB-01)
**Analog:** self. `correctKbDoc` (:472) already accepts senior-coach via `assertAdminOrCoach` (:533) and audits/re-ingests through the normal pipeline. `listDocsForReview` (:360) is the downline-scoped read surface (admin OR coach).
**Adaptation:** the contribution surface largely WIRES these existing functions into the new IA. Keep `assertAdmin` (:523) on all other CRUD (read-only and the contribution path never bypass it). Do NOT add read-only to either assert.

---

## Wave-0 Test Stubs

### `tests/fixtures/synthetic-users.ts` + `rules-helpers.ts` (MOD)
**Analog:** self. Add a 4th synthetic user mirroring `syntheticAdmin` (`synthetic-users.ts:62-69`), extend the `SyntheticUser.role` union (`:21`) and `allSyntheticUsers` (`:72`). In `rules-helpers.ts`, add `readOnlyCtx()` mirroring `adminRoleCtx()` (`:120-125`) and export it (`:139`).

### `src/firebase/__tests__/rules.test.ts` (MOD — read-only matrix)
**Analog:** self. Add `'read-only'` to the deny-by-default collection loop is N/A (loop tests unauth); instead add read-only assertions per the RESEARCH rules matrix:
```typescript
// pattern from rules.test.ts:99-105 (assertFails) + the seeded-doc blocks (:125+)
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
// read-only CAN read analytics:
await assertSucceeds(getDoc(doc(readOnlyDb, 'usageRollups', 'some-rollup')))
// read-only DENIED PII:
await assertFails(getDoc(doc(readOnlyDb, 'auditLogs', 'x')))
await assertFails(getDoc(doc(readOnlyDb, 'conversations', 'x')))
// read-only DENIED all writes:
await assertFails(setDoc(doc(readOnlyDb, 'kbDocs', 'x'), {...}))
```
**Note:** suite only RUNS with the emulator up (`RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)`, `:62`) — CI must launch the emulator or assertions silently skip.

### `roles/actions.test.ts` (MOD) + `src/firebase/auth.test.ts` (MOD)
**Analog:** self. `roles/actions.test.ts:64-77` already proves `{ok:false, error:'Forbidden'}` for a non-admin — add a `role:'read-only'` case asserting `assignRole` is Forbidden. `auth.test.ts` — add a `setUserClaims(uid, 'read-only')` success case + assert an unknown role still throws `InvalidRoleError`. Mock pattern: `vi.hoisted` + `vi.mock('@/src/firebase/admin')` (`auth.test.ts:19-47`).

### `i18n-parity.test.ts` (NEW)
**Closest analog:** `src/i18n/detect.test.ts` (a simple `describe`/`it`/`expect` Vitest unit — no mocks, no emulator).
**Adaptation:** import the three catalogs, recursively collect key paths, assert the three key-sets are identical. New test; CONTEXT mandates EN/BM/中文 parity in CI and none exists today (Pitfall 5).

### `app-sidebar.test.tsx` + `integrations.test.tsx` (NEW — render tests)
**Analog:** PARTIAL — no client-component render-test exists in the repo today (all existing `.test.ts` are logic/mocked unit tests). Use the plain Vitest `describe`/`it`/`expect` skeleton from `detect.test.ts`; for rendering, follow standard `@testing-library/react` (confirm it is available before relying on it — see No Analog Found). `app-sidebar.test.tsx`: assert each role sees the correct sections (admin: all; coach: home/agents/...; read-only: home+analytics only). `integrations.test.tsx`: assert NO send button/handler is rendered (the SC-01 acceptance gate).

### e2e KB nav spec (extend `e2e/inventory-admin.spec.ts`)
**Analog:** `e2e/inventory-admin.spec.ts` — Playwright scaffold, `test.skip` pending live deploy (`:12-27`), `data-testid` selector convention (`:29-39`).
**Adaptation:** add a KB list→detail click-through asserting the link resolves to `/${lang}/kb/{docId}` (NOT `/admin/kb/...`) — proves the Pitfall 1 fix. Keep the skipped-until-deploy convention.

---

## i18n (MOD — all three catalogs)
**Analog:** the flat `nav` block in `src/i18n/messages/en.json` (verified keys: `dashboard, chat, kb, inventory, settings, console, signedInAs, conversations, roles, usage, erasure`).
**Adaptation:** add the 6 FIXED section labels + `home` + `integrations` + Home-surface strings to ALL THREE of `en.json`, `ms.json`, `zh.json` (parity enforced by the new `i18n-parity.test.ts`). Section keys must match the sidebar `SECTIONS[].key` (`home, knowledge, agents, conversations, analytics, system`). FIXED business names: Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance.

---

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|------|------|-----------|---------------------|
| `app/[lang]/(admin)/integrations/page.tsx` | page (static panel) | request-response | Zero integrations/WABA refs in `app/`+`src/` today. Mirror the `inventory/page.tsx` gate + layout (Pattern A); render a static registry only — NO send affordance, NO data model. |
| `app-sidebar.test.tsx`, `integrations.test.tsx` | test (component render) | n/a | No existing client-component RENDER test in the repo (all current tests are logic/mocked). Use the `detect.test.ts` Vitest skeleton; **planner must verify `@testing-library/react` is installed** before specifying a render test — if absent, fall back to a logic-only unit test over the `SECTIONS` filter / a no-send invariant check. |

---

## Metadata

**Analog search scope:** `src/firebase/`, `app/[lang]/(admin)/**`, `app/[lang]/(coach)/**`, `app/[lang]/_components/`, `app/[lang]/page.tsx`, `src/kb/`, `firestore.rules`, `src/firebase/__tests__/`, `tests/fixtures/`, `src/i18n/messages/`, `e2e/`.
**Files scanned:** ~22 source files read at file:line + repo-wide grep for role-branch sites and broken-href literals.
**Pattern extraction date:** 2026-06-10
**Key cross-cutting insight:** Almost every Phase-6 surface is a re-composition of an EXISTING server query + an EXISTING gate. The only genuinely new server logic is (1) the read-only role's gate branches + `isAnalyticsReader()` rule, and (2) the static Integrations shell. The two latent v1 bugs to fix while here: the broken `/admin/kb/...` deep-links (3 sites) and the missing i18n parity CI test.
