# Phase 6: Console IA v2 — Restructure + Read-only Role - Research

**Researched:** 2026-06-10
**Domain:** Next.js 16 App Router IA restructure (route groups, server role gates), Firebase custom-claims RBAC, Firestore security rules, next-intl trilingual nav — over a code-complete v1.
**Confidence:** HIGH (all findings grounded in the actual repo at file:line; Next.js 16 behaviour confirmed against in-repo `node_modules/next/dist/docs/`)

## Summary

Phase 6 is a **brownfield IA restructure**, not new AI work. The console today is a flat 8-item sidebar (`app/[lang]/_components/app-sidebar.tsx`) over three route groups — `(admin)`, `(coach)`, `(auth)` — plus a non-grouped `chat/` shell. Three roles (`new-agent | senior-coach | admin`) are enforced **server-side** by a repeated pattern: a route-group `layout.tsx` gate **plus** a verbatim-copied per-page gate (cookie → `requireUser` → `redirect` on `role !== X`), backed by 19 per-collection Firestore rules with full rules-unit-test coverage. The single most important success criterion is **no regression to any v1 feature**, so every recommendation below favours REUSE + RELOCATE over rebuild.

The cleanest path is: (1) add a 4th `read-only` role to the `Role` union + `VALID_ROLES` + every server gate that branches on role + Firestore rules + rules tests + the role-assignment UI; (2) **regroup the nav into 6 sections in `app-sidebar.tsx` over the existing routes** (do NOT physically move route folders); (3) build Home as a new RSC landing that composes existing aggregations; (4) add a few light read-only surfaces (KB version-history viewer already 90% exists; per-coach pivot; integrations shell) that reuse existing queries.

**Primary recommendation:** Regroup the sidebar into 6 collapsible sections **without moving any route folders**. Physically moving routes between `(admin)` and `(coach)` groups would change auth assumptions and break existing deep links — and a pre-existing latent link bug (`/${lang}/admin/kb/...`, see Pitfall 1) means moving anything KB-related is doubly risky. The read-only role is the highest-effort, highest-risk item: it must be denied **server-side at the route-group layout AND in Firestore rules**, proven by tests, never merely nav-hidden.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Phase structure:** Phase 6 = this (relocate/gate/consolidate + light net-new). Phase 7 = heavy net-new. Phase 8 = WhatsApp Business API (future, graduation-gated).
- **6 section names are FIXED (business-requested):** Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance.
- **Integrations:** build only the **management shell** under System & Compliance (registry/placeholder). **NO WABA wiring. NO auto-send. The shell must not imply or enable any auto-send behaviour.** ("No WhatsApp Business API in v1" and "No auto-send, ever" remain in force.)
- **Read-only role:** 4th role added to `Role` union + `VALID_ROLES` (`src/firebase/auth.ts`). Custom-claim driven (same path via `setUserClaims`). Reporting/analytics READ access only; all write/admin Server Actions & routes denied **server-side**; Firestore rules updated + rules-tested (extend the existing per-collection rules-unit-tests — every collection covered in CI).
- **Home surface** must reuse EXISTING data sources (funnel, usageRollups, stall inbox, knowledge gaps). **No new lazy-cron jobs in Phase 6.**
- **Read-only denial must be proven server-side** (layout gate redirects AND Firestore rules deny), verified by integration/rules test — not just a hidden nav item.
- **"Agents & Cohorts" in Phase 6** = the existing downline/agent list relocated only. The cohort concept (new data model) + agent profile drill-ins are Phase 7.

### Claude's Discretion
- Exact nav component shape (collapsible groups vs sections) within shadcn `sidebar.tsx` patterns — match existing `app-sidebar.tsx` conventions.
- Home surface layout/widget composition (as long as it reads existing data only).
- Whether consolidation is a route move (new folders) or a nav-only regroup keeping existing routes — planner decides, but **must not break existing deep links / must not duplicate logic**.
- Version-history viewer presentation (timeline vs diff) — data contract is fixed.

### Deferred Ideas (OUT OF SCOPE — do NOT build in Phase 6)
- Phase 7: cohort management (+ data model), agent profile pages, coach-assignment UI, conversation flagged queue, audit-log viewer surface, model-config admin UI (Remote Config R/W), PDPA-settings read-only display, days-to-first-close metric.
- Phase 8: WhatsApp Business API integration.

## Phase Requirements

> Phase 6 derives NEW REQ-IDs during planning. Existing REQ-IDs in `.planning/REQUIREMENTS.md` are honoured (the relocated surfaces keep their AUTH-/ADMIN-/CDASH-/REPLY- behaviours unchanged). Suggested NEW groupings below for the planner.

| Suggested REQ group | Scope | Research Support |
|----|-------------|------------------|
| **IA-01..0n (Navigation IA)** | 6-section role-filtered sidebar over existing routes; no broken deep links | `app-sidebar.tsx` (flat 8-item, role-filtered today); route-group map below |
| **RO-01..0n (Read-only role)** | 4th role end-to-end: union, claims, layout gates, rules, tests, assignment UI | `src/firebase/auth.ts:36,46,148`; route-group layouts; `firestore.rules`; `rules.test.ts`; `roles/actions.ts:60` |
| **HOME-01..0n (Home surface)** | RSC landing composing existing aggregations + role-aware redirect | `page.tsx` redirect; `dashboard/page.tsx` + `actions.ts` aggregations; `usage/page.tsx` rollup reads |
| **KM-01..0n (Knowledge Management consolidation + version-history viewer)** | KB+Inventory grouped under one nav section; read-only KB version-history view | `buildVersionChain` in `kb/[docId]/page.tsx:45`; `KbDocDoc` version/supersedesId/supersededBy |
| **CKB-01 (Senior-coach KB contribution)** | Downline-scoped, audited KB contribution beyond inline-correction | `correctKbDoc` + `assertAdminOrCoach` in `src/kb/crud.ts:472,533`; `listDocsForReview` |
| **AP-01 (Per-coach analytics pivot)** | Admin cross-coach comparison/filter (read-only aggregation) | `dashboard/actions.ts` `adminAll` / `seniorCoachId` scoping pattern |
| **SC-01 (Integrations shell)** | Placeholder registry panel under System & Compliance; no send capability | confirmed zero integrations/WABA refs in `app/`+`src/` today |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role authorization (read-only gate) | API / Server (route-group `layout.tsx` + Server Actions) | Database (Firestore rules) | Custom claims read from verified token server-side; rules are the second, independent gate. Nav filtering is UX-only, NOT a tier that owns auth. |
| Nav section structure (6 IA) | Browser / Client (`app-sidebar.tsx` `'use client'`) | — | Pure presentation; filtered by the verified role passed down from the server layout. |
| Home aggregations | API / Server (RSC + Server Actions) | Database (Firestore reads via Admin SDK) | All reads server-side; counts-only aggregation; no client Firestore reads for analytics. |
| KB version-history view | API / Server (RSC) | Database (kbDocs version chain) | `buildVersionChain` runs in the RSC over an Admin-SDK `listDocs`. Read-only. |
| Per-coach analytics pivot | API / Server (Server Action) | Database (count() aggregation) | Extends the existing `adminAll`/`seniorCoachId` scoping; never fetch-all. |
| Integrations shell | Browser / Client (static panel) | — | No data, no send path — a registry placeholder only. |
| i18n nav copy | Browser / Client (`useTranslations`) + build (catalogs) | — | next-intl client provider; catalogs are static JSON loaded server-side. |

## Standard Stack

This phase adds **no new runtime dependencies**. Everything is already vendored. Versions verified from the repo's `node_modules` / `package.json`.

### Core (already in repo — reuse)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.6 `[VERIFIED: node_modules/next/package.json]` | App Router, route groups, RSC, `proxy.ts` | Project framework. Route groups (`(admin)`) organize without URL impact. |
| `react` | 19.2.4 `[CITED: CLAUDE.md]` | RSC + client islands | Project framework. |
| `next-intl` | ^4 `[VERIFIED: src/i18n/routing.ts uses defineRouting; proxy.ts uses createMiddleware]` | Trilingual nav copy + surfaces | `app/[lang]/` segment; `getTranslations` (server) / `useTranslations` (client). |
| shadcn `sidebar.tsx` | vendored `[VERIFIED: components/ui/sidebar.tsx imported by app-sidebar.tsx]` | The 6-section nav primitives (`SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, collapsible) | All shadcn already vendored in `components/ui/`. |
| `firebase-admin` | `[VERIFIED: imported in src/firebase/auth.ts, collections.ts]` | Server-side claims (`setCustomUserClaims`), Admin-SDK reads (bypass rules) | Sole sanctioned claim path. |
| `@firebase/rules-unit-testing` | `[VERIFIED: src/firebase/__tests__/rules-helpers.ts]` | Per-collection rules tests against the emulator | Existing CI test infra to extend for the read-only role. |
| `vitest` | `[VERIFIED: package.json "test": "vitest run"]` | Unit + rules tests | Existing. |
| `@playwright/test` | `[VERIFIED: package.json "test:e2e"]` | E2E regression of deep links / role redirects | Existing `e2e/` suite. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nav-only regroup (RECOMMENDED) | Physically move route folders into 6 section folders | Moving folders changes URLs (unless route groups), breaks deep links, risks moving a surface between `(admin)`/`(coach)` and inheriting the wrong layout gate. Reject. |
| Per-page verbatim gate (current pattern) | Centralized `requireRole(roles[])` helper | A shared helper reduces the 10+ copy-paste gates and lowers the risk a read-only edit misses one site. RECOMMENDED as a low-risk refactor IF done as its own task with regression coverage — see Pitfall 4. |

**Installation:** None. No `npm install` required for Phase 6.

## Architecture Patterns

### System Architecture Diagram

```
                         Browser request  /{lang}/<section>
                                  │
                                  ▼
                    ┌──────────────────────────────┐
                    │  proxy.ts (next-intl)         │  locale redirect only —
                    │  NOT an auth boundary         │  spoofable, UX convenience
                    └──────────────┬────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  app/[lang]/layout.tsx        │  validates locale, loads
                    │  (NextIntlClientProvider)     │  messages (en/ms/zh)
                    └──────────────┬────────────────┘
                                   ▼
          ┌────────────────────────────────────────────────────┐
          │  ROUTE-GROUP LAYOUT GATE  (the real auth boundary)   │
          │  (admin)/layout.tsx  ·  (coach)/layout.tsx           │
          │  cookie(__session) → requireUser(verifyIdToken)      │
          │  → redirect if role not allowed                      │
          │  → <ConsoleShell role={verifiedRole}>                │
          └───────────────┬──────────────────────┬──────────────┘
                          ▼                      ▼
            ┌───────────────────────┐  ┌────────────────────────┐
            │  PER-PAGE GATE (dup)  │  │  AppSidebar (CLIENT)    │
            │  cookie→requireUser→  │  │  filters links by role  │
            │  redirect (defense    │  │  — UX only, NOT a gate  │
            │  -in-depth, repeated  │  └────────────────────────┘
            │  verbatim per page)   │
            └──────────┬────────────┘
                       ▼
            ┌───────────────────────┐      reads via Admin SDK
            │  RSC / Server Action  │─────────────────────────────►  Firestore
            │  data fetch           │      (bypasses rules)           19 collections
            └───────────────────────┘                                     ▲
                                                                          │ 2nd gate
                       client SDK reads (analytics) ─────────────────────┘
                                                                  firestore.rules
                                                                  (per-collection RBAC)
```

A read-only stakeholder hitting `/{lang}/usage` must be **redirected at the route-group layout gate**, AND a read-only client SDK read of `auditLogs`/`conversations` must be **denied by firestore.rules** — two independent boundaries.

### Current route-group map (as-built — VERIFIED)

| Group / folder | URL prefix (route groups don't appear) | Layout gate | Pages |
|----------------|------------------|-------------|-------|
| `(admin)/` | `/{lang}/...` | `(admin)/layout.tsx` → admin only | `kb/`, `kb/[docId]/`, `inventory/`, `conversations/`, `roles/`, `usage/`, `erasure/` |
| `(coach)/` | `/{lang}/...` | `(coach)/layout.tsx` → senior-coach OR admin | `dashboard/` (+ `_components/`: stall-inbox, downline-table, funnel-v2, knowledge-gap feeds, correction-eval, kb-doc-explorer, reply-quality, metrics) |
| `(auth)/` | `/{lang}/sign-in` | none (public) | `sign-in/` |
| `chat/` (NOT grouped) | `/{lang}/chat` | own shell | `chat/` (all 3 chat pillars) |
| `[lang]/page.tsx` | `/{lang}` | inline | role-redirect landing (Home lands here) |

**Resolved URLs today:** `/{lang}/dashboard`, `/{lang}/kb`, `/{lang}/kb/{docId}`, `/{lang}/inventory`, `/{lang}/conversations`, `/{lang}/roles`, `/{lang}/usage`, `/{lang}/erasure`, `/{lang}/chat`, `/{lang}/sign-in`.

### Pattern 1: Server-side role gate (the canonical pattern — REUSE verbatim)
**What:** Every privileged page and the route-group layout repeat this exact block.
**When to use:** Any new gated page; the read-only role gate extends the `role !==` check.
```typescript
// Source: app/[lang]/(admin)/conversations/page.tsx:38-60 (verbatim across many pages)
const cookieStore = await cookies()                 // Next 16: async
const sessionCookie = cookieStore.get('__session')
if (!sessionCookie?.value) redirect(`/${lang}/sign-in`)
let user
try {
  const syntheticReq = new Request('https://d2.app/admin/x', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  user = await requireUser(syntheticReq)            // verifyIdToken — the real gate
} catch (err) {
  if (err instanceof UnauthorizedError) redirect(`/${lang}/sign-in`)
  throw err
}
if (user.role !== 'admin') redirect(`/${lang}/chat`)  // ← role branch to extend
```

### Pattern 2: Role-scoped aggregation (`adminAll` vs `seniorCoachId`) — REUSE for per-coach pivot
**What:** Coach is downline-locked; admin is org-wide; all via `count()`/`select()` — never fetch-all.
```typescript
// Source: app/[lang]/(coach)/dashboard/actions.ts:362-378
const adminAll = user.role === 'admin'
const scoped = adminAll ? base : base.where('seniorCoachId', '==', user.uid)
```
The **per-coach admin pivot** (AP-01) adds a 3rd branch: admin may pass a `coachUid` filter → `base.where('seniorCoachId','==', coachUid)`, still read-only, still audited (`auditDrilldown`).

### Pattern 3: KB version chain (already implemented — REUSE for the read-only viewer)
```typescript
// Source: app/[lang]/(admin)/kb/[docId]/page.tsx:45-72
// Walks supersedesId backwards + supersededBy forwards over listDocs() — NO extra reads, NO schema change.
function buildVersionChain(targetId, allDocs) { /* ancestors + target + descendants */ }
```
The version-history UI **already exists** at `kb/[docId]/page.tsx:156-206`. KM-01's "viewer" is largely: (a) make it reachable read-only (gate allows read-only/coach, hides the edit form), (b) fix the broken link path (Pitfall 1).

### Anti-Patterns to Avoid
- **Nav-hiding as authorization.** Filtering `AppSidebar` links by role is UX only. Read-only denial MUST be a layout redirect + a rules deny. (`app-sidebar.tsx:11` literally documents "the layout is the security gate; this is UX only".)
- **Physically moving route folders to build the 6 sections.** Route groups already give URL-stable organization; moving folders risks deep-link breakage and layout-gate mismatch.
- **Widening a Firestore rule to admit read-only.** Adding `read-only` to a `read:` rule on `auditLogs`/`conversations`/`leads` would leak PII. Read-only gets read on **analytics collections only** (see Security Domain).
- **Reading raw `usageEvents` for Home/analytics.** Use `usageRollups` (HR-7; `usage/page.tsx:86`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Role gate on a new page | A new ad-hoc auth check | Pattern 1 verbatim (`requireUser` + role branch) | The verified-token path (`src/firebase/auth.ts:96`) is the only sanctioned gate; ad-hoc checks risk reading role from the wrong source (T-01-11). |
| Setting the read-only claim | Direct `setCustomUserClaims` call in a new place | `setUserClaims` (`src/firebase/auth.ts:148`) | Sole sanctioned claim path; validates the union + upserts the user doc + is audited via `assignRole`. |
| KB version lineage | New version-walk logic | `buildVersionChain` (`kb/[docId]/page.tsx:45`) | Already correct (handles ancestors + descendants, no extra reads). |
| Analytics aggregation | `getDocs()` + JS count | Firestore `count()`/`select()` as in `dashboard/actions.ts` | Avoids fetch-all cost/PII exposure (Pitfall 9 / T-04-DASH-COST). |
| Downline-scoped contribution audit | New audit writer | `auditDrilldown` / `audit.log` (`src/audit`) | Audit-before-read is mandatory and already wired. |

**Key insight:** Almost every Phase-6 surface is a re-composition of an existing server query + an existing gate. The ONLY genuinely new server logic is the read-only role's gate branches and rules.

## Runtime State Inventory

This phase adds a 4th role to live custom claims and edits security rules. State that lives outside the repo:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Firebase Auth custom claims** carry `role` for every provisioned user. Adding a `read-only` role does NOT change existing users' claims. To create a read-only user, an admin assigns the role via the UI (`assignRole` → `setUserClaims`) OR an engineer runs `scripts/set-claims.ts --role read-only`. **`users/{uid}.role` field** mirrors the claim (set by `setUserClaims`); existing docs unaffected. | Data: none for existing users. New read-only users get a claim + user doc on assignment. |
| Live service config | **Deployed `firestore.rules`** are the production-active rules — editing the repo file requires a **rules deploy** (`firebase deploy --only firestore:rules`) to take effect in production. The emulator/tests read the repo file directly. | Deploy rules after editing. Flag to Derek: rules change is a deploy gate. |
| OS-registered state | None — no schedulers/tasks (lazy-cron is in-app). Verified: no QStash/Cloud Scheduler (CLAUDE.md hard constraint). | None. |
| Secrets/env vars | `scripts/set-claims.ts` needs `FIREBASE_PROJECT_ID` + service-account creds (`.env.local`, not in git). No new secrets for Phase 6. Read-only provisioning reuses the same path. | None — do not read `.env.local`. |
| Build artifacts | None — TS/Next build; no compiled packages carry a role list. | None. |

**Critical:** After any role-claim change, the user's client must call `getIdToken(true)` (force-refresh) to pick up the new claim (documented in `scripts/set-claims.ts`). The read-only role provisioning inherits this.

## Common Pitfalls

### Pitfall 1: Pre-existing broken KB deep-link (`/${lang}/admin/kb/...`)
**What goes wrong:** `kb-doc-list.tsx:188` and `kb/[docId]/page.tsx:138,178` link to `` `/${lang}/admin/kb/${id}` `` — but `(admin)` is a **route group** (parens) and does NOT appear in the URL. The real route is `/${lang}/kb/{docId}`. So those links currently point at a non-existent path (latent 404 — likely masked because admins reach the detail page another way or it was never clicked in v1).
**Why it happens:** Confusing the route-group folder name with a URL segment. (Next docs: route groups "should not be included in the route's URL path" — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md:12`.)
**How to avoid:** Phase 6 MUST fix these to `` `/${lang}/kb/${id}` `` when touching KB. A restructure that "moves" KB without fixing this perpetuates the bug. Verify with an e2e click-through of the KB list → detail.
**Warning signs:** A 404 navigating from KB list to a doc; grep `'/admin/'` or `'/coach/'` literal segments in `href`/`Link`/`redirect`.

### Pitfall 2: Read-only role silently widening a Firestore rule
**What goes wrong:** Adding `hasRole('read-only')` to a `read:` rule that also covers PII (`conversations`, `messages`, `leads`, `leadContext`, `auditLogs`) leaks client PII to a stakeholder.
**Why it happens:** Copy-pasting the admin `read:` branch when adding read-only.
**How to avoid:** Read-only gets read ONLY on **analytics/aggregate** collections: `usageRollups`, `usageEvents` (counts-only by schema), `evals`, `knowledgeGaps`, `escalations` (status/scope only — note these carry agentUid; decide with Derek whether read-only sees them), and the KB read collections it already shares as a signed-in tenant user (`projects`, `collateral`, `kbDocs`, `kbChunks`). It must be DENIED on `conversations`, `messages`, `leads`, `leadContext`, `auditLogs`, `erasureRequests`, `rateBudgets`. The rules-test MUST assert each deny (see Validation Architecture).
**Warning signs:** A read-only test that asserts a PII-collection read SUCCEEDS.

### Pitfall 3: A relocated `(admin)`-only component surfaced to read-only assuming admin claims
**What goes wrong:** Surfacing `UsageDashboard` or `FunnelV2Panel` to read-only, but its backing Server Action still gates `role !== 'admin'` / `role !== 'senior-coach'` → read-only gets `{ok:false, error:'Forbidden'}` and an empty/error UI.
**Why it happens:** The page gate is widened to allow read-only, but the Server Action gate is not (there are TWO independent gates per surface).
**How to avoid:** For every analytics surface read-only should see, widen BOTH the page/layout gate AND the Server Action role check (e.g. `usage/page.tsx:78`, every `dashboard/actions.ts` action checks `!== 'senior-coach' && !== 'admin'`). Add read-only there explicitly. Keep write actions (`resolveStall`, `submitCorrection`, `assignRole`, KB CRUD) denying read-only.
**Warning signs:** Read-only sees a section but every panel renders empty/`Forbidden`.

### Pitfall 4: Missing one of the ~10 duplicated role-branch sites
**What goes wrong:** The role gate is copy-pasted across many files (verified ~24 files branch on role). Adding read-only by editing only the layout misses per-page gates and Server Actions.
**Why it happens:** No centralized `requireRole()` helper — each page/action repeats `if (user.role !== 'admin') redirect(...)`.
**How to avoid:** Enumerate every site (table below) and treat the list as a checklist. STRONGLY consider a `requireRole(allowed: Role[])` helper as a dedicated task with its own regression test, then route all gates through it — but do this as a separate, well-tested change to avoid masking a regression in the IA change.
**Warning signs:** Read-only can reach a write page that the layout allowed but the page should have blocked.

**Role-branch sites (VERIFIED — the read-only checklist):**
- `src/firebase/auth.ts:36` (`Role` union), `:46` (`VALID_ROLES`), `:148` (`setUserClaims` validation)
- `app/[lang]/page.tsx:36-42` (landing redirect — where does read-only land? → Home/analytics)
- `app/[lang]/(admin)/layout.tsx:50-53`, `app/[lang]/(coach)/layout.tsx:51-53` (route-group gates)
- Per-page gates: `(admin)/kb/page.tsx`, `kb/[docId]/page.tsx:98`, `inventory/page.tsx`, `conversations/page.tsx:58`, `roles/page.tsx:60`, `usage/page.tsx:78`, `erasure/page.tsx`
- Server Actions: `roles/actions.ts:120,168` (`AssignableRole` type :60), `conversations/actions.ts`, `erasure/actions.ts`, `dashboard/actions.ts` (8 actions, each `!== 'senior-coach' && !== 'admin'`)
- Core: `src/kb/crud.ts:523` (`assertAdmin`), `:533` (`assertAdminOrCoach`), `src/inventory/crud.ts`
- Rules: `firestore.rules` (19 collections), tests: `src/firebase/__tests__/rules.test.ts` + `rules-helpers.ts`
- Fixtures: `tests/fixtures/synthetic-users.ts` (add a 4th synthetic read-only user)
- UI: `app-sidebar.tsx:51-60` (`roles: Role[]` filter), `roles/role-assignment.tsx`
- Route Handlers: `app/api/kb/ingest/process/route.ts`, `app/api/kb/ingest/upload/route.ts` (confirm read-only denied)

### Pitfall 5: i18n key gaps — no parity CI today
**What goes wrong:** New nav section names + surface strings added to `en.json` but not `ms.json`/`zh.json` → `next-intl` renders the raw key or throws in strict mode.
**Why it happens:** **There is NO i18n parity check script in the repo today** (verified: `package.json` scripts have none; no parity test file found). The catalog `nav` block is flat (`dashboard, chat, kb, inventory, ...`).
**How to avoid:** Add all 6 section labels + new surface strings to ALL THREE catalogs (`src/i18n/messages/{en,ms,zh}.json`). Phase 6 SHOULD add a parity test (a Vitest that asserts the key sets of the three catalogs are identical) since CONTEXT mandates "EN/BM/中文 parity in CI" — this is currently unenforced.
**Warning signs:** A nav label shows as `nav.knowledgeManagement` literally; a missing-message console warning.

### Pitfall 6: `redirect()` inside try/catch swallowing the redirect
**What goes wrong:** `redirect()` throws `NEXT_REDIRECT`; calling it inside the `try` that catches `requireUser` errors swallows it.
**Why it happens:** Next 16 control-flow via thrown errors.
**How to avoid:** Resolve role inside try/catch, call `redirect()` OUTSIDE (documented in `app/[lang]/page.tsx:6-8`). Reuse the existing pattern exactly.

### Pitfall 7: Async `cookies()`/`headers()` and `params`
**What goes wrong:** Forgetting `await` on `cookies()`/`params` in a new gate/page.
**How to avoid:** Next 16: `cookies()`/`headers()` are async; `params` is a Promise (CLAUDE.md; every existing page awaits them). Copy the existing pattern.

## Code Examples

### Adding the 4th role to the union (RO-01)
```typescript
// Source: src/firebase/auth.ts:36,46 (extend in place)
export type Role = 'new-agent' | 'senior-coach' | 'admin' | 'read-only'
const VALID_ROLES: Role[] = ['new-agent', 'senior-coach', 'admin', 'read-only']
// setUserClaims (:148) already validates against VALID_ROLES — no further change to the claim path.
// AssignableRole in roles/actions.ts:60 must also add 'read-only' for the assignment UI.
```

### Firestore rules: read-only on analytics-only (RO-01)
```
// Source: extend firestore.rules. Pattern: a helper for the analytics-read role.
function isAnalyticsReader() {
  return (hasRole('admin') || hasRole('read-only')) && sameTenant();
}
// usageRollups / usageEvents / evals: allow read: if isAnalyticsReader();
// auditLogs / conversations / leads / leadContext / erasureRequests / rateBudgets:
//   read-only must NOT appear — leave admin-only / owner-only as-is.
```

### 6-section sidebar (IA-01) — regroup over existing routes, role-filtered
```typescript
// Source: pattern from app/[lang]/_components/app-sidebar.tsx (extend NavItem with `section`)
// One SidebarGroup per section; filter items by role; existing hrefs unchanged.
const SECTIONS = [
  { key: 'home',         items: [{ key:'home', href:`/${lang}`, roles:['senior-coach','admin','read-only'] }] },
  { key: 'knowledge',    items: [
      { key:'kb',        href:`/${lang}/kb`,        roles:['admin'] },
      { key:'inventory', href:`/${lang}/inventory`, roles:['admin'] } ] },
  { key: 'agents',       items: [{ key:'dashboard', href:`/${lang}/dashboard`, roles:['senior-coach','admin'] }] },
  { key: 'conversations',items: [{ key:'conversations', href:`/${lang}/conversations`, roles:['admin'] }] },
  { key: 'analytics',    items: [{ key:'usage', href:`/${lang}/usage`, roles:['admin','read-only'] }] },
  { key: 'system',       items: [
      { key:'roles',     href:`/${lang}/roles`,    roles:['admin'] },
      { key:'integrations', href:`/${lang}/integrations`, roles:['admin'] },
      { key:'erasure',   href:`/${lang}/erasure`,  roles:['admin'] } ] },
]
// Render: SECTIONS.map(s => visibleItems(s) → <SidebarGroup><SidebarGroupLabel>{t(s.key)}</…>)
// NOTE: dashboard stays under (coach) group → senior-coach OR admin. read-only does NOT get dashboard
// (it carries downline/agent PII via panels) unless its Server Actions are widened AND scoped (Pitfall 3).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `proxy.ts` (`createMiddleware` from next-intl) | Next.js 16 | Already migrated (`proxy.ts`). No change needed. |
| Sync `cookies()`/`params` | Async — `await cookies()`, `await params` | Next.js 15→16 | Already adopted repo-wide. |
| Implicit fetch caching | Opt-in only | Next.js 16 | Analytics RSC reads are uncached by default — fine for live dashboards; no action. |

**Deprecated/outdated:** None relevant — repo is already on Next 16 idioms.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Read-only should land on Home (or analytics) post-login, not chat. | Home / Pitfall 4 | Low — landing redirect is a one-line branch; confirm with Derek which surface is the read-only default. |
| A2 | Read-only should NOT see the coach dashboard (it carries downline agent PII via panels). It sees `usage` + Home + KB read-only viewer. | Pitfall 3, sidebar example | Medium — if Derek wants stakeholders to see funnel/ramp, those panels must be re-scoped to counts-only and their Server Actions widened. Affects RO scope + AP-01. |
| A3 | The broken `/${lang}/admin/kb/...` links are a latent v1 bug (not intentional). | Pitfall 1 | Low — confirmed `(admin)` is a route group; the literal `/admin/` cannot resolve. Fixing is safe. |
| A4 | "No new lazy-cron in Phase 6" means Home reads pre-aggregated `usageRollups`/funnel computed by EXISTING jobs; if a rollup is stale, Home shows the stale watchdog (as `usage/page.tsx` does). | Home | Low — matches CONTEXT lock + existing watchdog pattern. |
| A5 | Adding a parity CI test is in-scope (CONTEXT mandates parity in CI but none exists today). | Pitfall 5 / Validation | Low — small additive test; if descoped, parity must be manually verified. |
| A6 | Integrations shell is a static admin-only panel with NO data model and NO send affordance (copy explicitly states "future / no auto-send"). | Integrations | Low — matches the hard constraint; the planner must ensure no toggle/button implies sending. |

## Open Questions

1. **Which collections may the read-only stakeholder read?**
   - What we know: analytics collections are `usageRollups`, `usageEvents` (counts-only), `evals`, `knowledgeGaps`, `escalations`. PII collections (`conversations`/`messages`/`leads`/`leadContext`/`auditLogs`) must stay denied.
   - What's unclear: whether read-only may see `knowledgeGaps`/`escalations` (they carry `agentUid`/scope) and the coach dashboard's funnel.
   - Recommendation: default to the narrowest set (`usageRollups`, `usageEvents`, `evals` + KB read) and Home; confirm the rest with Derek before widening any rule.

2. **Centralize the role gate or keep per-page copies?**
   - What we know: ~24 files branch on role; the read-only edit touches all of them.
   - Recommendation: do a separate `requireRole(allowed[])` refactor task with regression coverage, then layer the IA change on top — OR, if risk-averse, extend each gate in place using the Pitfall-4 checklist. Planner decides; either way the checklist is the acceptance gate.

3. **Read-only default landing surface** (A1) — Home vs a specific analytics page. Confirm with Derek.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Next.js | Whole app | ✓ | 16.2.6 | — |
| Firebase emulator (Firestore) | `test:rules` (read-only rule tests) | Assumed via `firebase emulators:exec` | per `firebase.json` (port 8080) | Tests `describe.skip` when `FIRESTORE_EMULATOR_HOST` absent — must run emulator in CI to actually exercise new read-only rules |
| Firebase Admin creds | `scripts/set-claims.ts` (provision read-only user) | Local `.env.local` (engineer machine) | — | Provision via the in-app `assignRole` UI instead |
| next-intl catalogs | Trilingual nav | ✓ | `src/i18n/messages/{en,ms,zh}.json` | — |

**Missing dependencies with no fallback:** None blocking. **Note:** the read-only rules tests only *run* when the Firestore emulator is up (`RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)`); the CI rules job must launch the emulator or the new read-only assertions silently skip.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 'test': `vitest run`; rules: `vitest run src/firebase/__tests__/rules` `[VERIFIED: package.json]` |
| Config file | `vitest` (no explicit config path surfaced; `package.json` scripts drive it) |
| Quick run command | `npm run test` (offline; rules suite `describe.skip` without emulator) |
| Full suite command | `firebase emulators:exec --only firestore "npm run test:rules"` + `npm run test` + `npm run test:e2e` + `npm run typecheck` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RO-01 | `read-only` in `Role` union + `VALID_ROLES`; `setUserClaims('read-only')` succeeds, unknown role throws `InvalidRoleError` | unit | `vitest run src/firebase/auth.test.ts` | ✅ extend existing |
| RO-01 | read-only CAN read `usageRollups`, `usageEvents`, `evals` (analytics) | rules | `vitest run src/firebase/__tests__/rules` (emulator) | ✅ extend |
| RO-01 | read-only DENIED write on EVERY collection (esp. `projects`/`collateral`/`kbDocs`/`kbChunks`/`users`/`leadContext`) | rules | same | ✅ extend |
| RO-01 | read-only DENIED read on `auditLogs`, `conversations`, `conversations/{cid}/messages`, `leads`, `leadContext`, `erasureRequests`, `rateBudgets` (cross-owner) | rules | same | ✅ extend |
| RO-01 | read-only hitting a write/admin route → redirected at the layout gate (not nav-hidden) | integration/unit on the gate | new gate test OR Playwright redirect assertion | ❌ Wave 0 |
| RO-01 | read-only Server-Action call to `assignRole`/`resolveStall`/`submitCorrection`/KB CRUD → `{ok:false,'Forbidden'}` | unit | `vitest run app/[lang]/(admin)/roles/actions.test.ts` (+ new cases) | ✅ extend |
| IA-01 | Each existing deep link still resolves; KB list→detail no longer 404s (Pitfall 1 fix) | e2e | `npm run test:e2e` (extend `inventory-admin.spec.ts` + add kb nav spec) | ✅ extend |
| IA-01 | Sidebar shows correct sections per role (admin / coach / read-only) | unit (render) | new `app-sidebar.test.tsx` | ❌ Wave 0 |
| HOME-01 | Home composes existing aggregations, reads `usageRollups` not raw events; role-aware redirect | integration | new `home/page` test | ❌ Wave 0 |
| KM-01 | version-history viewer renders the chain read-only (no edit form for read-only/coach) | unit/e2e | extend kb specs | ❌ Wave 0 |
| AP-01 | admin per-coach pivot scopes by `seniorCoachId`; non-admin cannot pass a coachUid filter | unit | extend `dashboard/actions` tests | ❌ Wave 0 |
| SC-01 | Integrations shell exposes NO send/auto-send affordance (assert no send button/handler) | unit (render) | new `integrations.test.tsx` | ❌ Wave 0 |
| i18n | en/ms/zh key sets identical for all new keys | unit | new `i18n-parity.test.ts` | ❌ Wave 0 |
| Guard | No hard-coded model ID introduced; no `src/ → app/` import added | lint/grep test | `grep` assertion in CI or a unit guard | ❌ Wave 0 |

### Read-only role — collection-by-collection rules matrix (the RO-01 acceptance grid)
The new read-only context (add `readOnlyCtx()` to `rules-helpers.ts` + a 4th synthetic user) must assert, per collection in `rules.test.ts`:

| Collection | read-only READ | read-only WRITE |
|------------|---------------|------------------|
| usageRollups | ✅ allow | ❌ deny |
| usageEvents | ✅ allow | ❌ deny |
| evals | ✅ allow | ❌ deny |
| projects / collateral / kbDocs / kbChunks / kbIngestionJobs | ✅ allow (signed-in tenant read already) | ❌ deny |
| knowledgeGaps / escalations | ⚠️ decide w/ Derek (carry agentUid) — default DENY | ❌ deny |
| conversations / messages / leads / leadContext | ❌ deny | ❌ deny |
| auditLogs / erasureRequests | ❌ deny | ❌ deny |
| users / agentProfiles | ❌ deny (except none — read-only is not self of an agent) | ❌ deny |
| rateBudgets | ❌ deny (owner-scoped) | ❌ deny |

### Sampling Rate
- **Per task commit:** `npm run test` + `npm run typecheck` (fast; offline rules skip).
- **Per wave merge:** `firebase emulators:exec --only firestore "npm run test:rules"` (the read-only matrix only runs here) + `npm run test:e2e`.
- **Phase gate:** Full suite green (unit + rules-on-emulator + e2e + typecheck) before `/gsd-verify-work`. The v1 regression baseline (all existing tests + e2e) MUST stay green — that is the "no v1 regression" proof.

### Wave 0 Gaps
- [ ] `rules-helpers.ts` — add `readOnlyCtx()` + a 4th synthetic read-only user in `tests/fixtures/synthetic-users.ts` (extend `Role`, `allSyntheticUsers`)
- [ ] `src/firebase/__tests__/rules.test.ts` — add the read-only matrix to the deny-by-default loop AND each collection block
- [ ] `app/[lang]/_components/app-sidebar.test.tsx` — section/role-filter render test (new)
- [ ] gate redirect test for read-only hitting `/usage` write actions (new; unit on the gate or Playwright)
- [ ] `i18n-parity.test.ts` — assert en/ms/zh key parity (new; CONTEXT mandates CI parity, none exists)
- [ ] `integrations` shell render test asserting no send affordance (new)
- [ ] Extend `roles/actions.test.ts` with read-only `Forbidden` cases on `assignRole`
- [ ] Ensure CI launches the Firestore emulator so the read-only rules assertions actually execute (not skip)

## Security Domain

`security_enforcement` is enabled (no `false` in config). This phase is auth-heavy.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireUser` → `adminAuth.verifyIdToken`; claims from verified token only (`auth.ts:96`) |
| V3 Session Management | yes | `__session` cookie → verified server-side every request (no client trust) |
| **V4 Access Control** | **yes (core of this phase)** | Route-group `layout.tsx` gate + per-page gate + Firestore rules; read-only = least-privilege analytics-read; deny-by-default rules |
| V5 Input Validation | yes | Role union runtime-validated in `setUserClaims` (`VALID_ROLES`); `InvalidRoleError` on unknown |
| V6 Cryptography | no (no new crypto) | — (PII hashing already in `src/audit`) |
| V7 Logging & Audit | yes | `auditDrilldown`/`audit.log` before any read of scoped data; `auditLogs` immutable, admin-read only — read-only must NOT read it |
| V8 Data Protection / Privacy | yes (PDPA) | Read-only denied all PII collections; analytics are counts-only; no PII in logs |

### Known Threat Patterns for {Next.js 16 + Firebase custom-claims RBAC}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Read-only role widens a PII read rule | Information Disclosure | Read-only added ONLY to analytics `read:` rules; rules-test asserts PII denies (Pitfall 2) |
| Nav-hiding mistaken for authorization | Elevation of Privilege | Server-side layout redirect + rules deny; nav filter is UX-only (Anti-pattern) |
| Role read from request body / args | Spoofing / EoP | Role from verified token only (`auth.ts:118`, `roles/actions.ts` T-02-31) — unchanged |
| One of N duplicated gates missed | Elevation of Privilege | Pitfall-4 checklist; consider `requireRole()` helper + test |
| Stale claim after role change | Auth bypass (negative) | `getIdToken(true)` force-refresh after `setUserClaims` (documented) |
| Integrations shell implies send/auto-send | (Policy/compliance breach) | Shell has NO send handler; render test asserts absence; copy states "no auto-send / future" |
| Per-coach pivot lets a coach read another coach's downline | Information Disclosure | Pivot's `coachUid` filter gated to `role==='admin'`; coach branch stays `seniorCoachId==self` |

## Sources

### Primary (HIGH confidence — verified in-repo)
- `src/firebase/auth.ts` (Role :36, VALID_ROLES :46, requireUser :96, setUserClaims :148) — role/claims path
- `app/[lang]/(admin)/layout.tsx`, `(coach)/layout.tsx` — route-group gates
- `app/[lang]/(admin)/{kb,inventory,conversations,roles,usage,erasure}/...` + `kb/[docId]/page.tsx` — per-page gates + version chain (:45)
- `app/[lang]/(coach)/dashboard/page.tsx` + `dashboard/actions.ts` — role-scoped aggregations (`adminAll`/`seniorCoachId`)
- `app/[lang]/_components/app-sidebar.tsx`, `console-shell.tsx` — flat 8-item nav, role filter (UX-only)
- `app/[lang]/page.tsx` — landing role-redirect
- `firestore.rules` (19 collections) + `src/firebase/__tests__/rules.test.ts`, `rules-helpers.ts`, `tests/fixtures/synthetic-users.ts` — RBAC + tests
- `src/kb/crud.ts` (assertAdmin :523, assertAdminOrCoach :533, correctKbDoc :472, listDocsForReview :360) — KB authz
- `src/firebase/collections.ts` (KbDocDoc :260, version/supersedesId/supersededBy/correctedBy) — version data contract
- `proxy.ts` — Next 16 proxy (not middleware), not an auth boundary
- `src/i18n/{routing.ts, messages/*.json}`, `package.json` scripts — i18n + test infra (no parity check today)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md` — route groups don't appear in URLs
- `node_modules/next/package.json` — Next 16.2.6

### Secondary (MEDIUM)
- `.planning/phases/06-console-ia-v2/{CONTEXT,SCOPE}.md` — locked scope
- `CLAUDE.md` / `AGENTS.md` — hard constraints + Next 16 gotchas

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all versions verified in `node_modules`/`package.json`.
- Architecture (gates, route groups, rules): HIGH — read every gate + rules file + tests at file:line.
- Read-only role design: HIGH for the mechanism (claims path proven); MEDIUM on the exact collection allow-list (Open Q1, needs Derek).
- Pitfalls: HIGH — Pitfall 1 (broken `/admin/` links) and Pitfall 5 (no parity CI) confirmed by grep.

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable brownfield; re-verify only if Next.js or next-intl is upgraded)
