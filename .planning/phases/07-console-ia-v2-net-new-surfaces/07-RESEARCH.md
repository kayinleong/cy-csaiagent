# Phase 7: Console IA v2 — Net-new Surfaces - Research

**Researched:** 2026-06-11
**Domain:** Brownfield Next.js 16 + Firebase console surfaces (data-model extensions, Firestore rules, Remote Config write path, server-gated admin/coach CRUD over an existing 6-section IA)
**Confidence:** HIGH (everything is grounded in the live codebase; the one external API question — Remote Config write→read coherence — is CITED to official Firebase docs)

## Summary

Phase 7 adds **8 net-new console surfaces** into the Phase-6 IA that already exists. There is almost nothing to *invent* here: every surface either (a) adds a field/collection through the single-source-of-truth `src/firebase/collections.ts` converter pattern, (b) gates through the existing `requireRole()` helper, or (c) reads/writes data through patterns already proven in Phases 2–6 (`searchConversations` bounded query, `auditDrilldown` write-on-read, `assignRole` admin-only Server Action, `getDownline` downline-scoped query, `i18n-parity.test.ts` CI gate). The dominant risk is **regression to the locked Phase-6 least-privilege read-only allow-list** and **forgetting the rules-test-in-same-plan mandate** — not novel technology.

Two new collections (`cohorts`, `conversationFlags`) and two optional field additions to `AgentProfileDoc` (`cohortId?`, `firstCloseAt?`) are the entire net-new data model. The one surface that touches an external Google-managed config service is the **model-config admin UI (Surface 6)**: it adds the WRITE half of Remote Config (`getTemplate()` → mutate `parameters['model.{pillar}.default'].defaultValue` → `publishTemplate(template)` with the template's ETag) to the existing READ half (`modelFor()` → `getServerTemplate()`). This stays entirely inside `firebase-admin/remote-config` v13.10.0 — no Vertex, no Cloud Functions, no forbidden GCP surface. **Verified:** `getTemplate()`/`publishTemplate()` and `getServerTemplate()` hit the *same* backend Remote Config service, so an admin publish is reflected in `modelFor()`'s next `getServerTemplate()` read (subject to propagation/cache latency) `[CITED: firebase.google.com/docs/remote-config/server]`.

**Primary recommendation:** Mirror the Phase-6 wave shape exactly. Wave 0 = a failing-test scaffold (new-collection rules matrix incl. read-only DENY, field-add type assertions, gate-denial tests, model-config write-contract test, close-action idempotency test, i18n parity). Then a data-model/rules wave (`cohorts` + `conversationFlags` collections + rules + indexes + field additions) **before** the surface waves that consume them. Every collection ships with its rules + rules-unit-test in the same plan (Pitfall 6 — no unruled collection ever ships). Read-only is DENIED on every Phase-7 surface server-side; nav filtering is UX-only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cohort management (Surface 1)**
- **D-01:** Cohort = new top-level `cohorts/{cohortId}` collection via `makeConverter` (stamps `tenantId`). Fields: `tenantId`, `name`, `description`, `createdAt`, `createdBy` (admin uid). Deny-by-default rules; server/Admin-SDK or admin-only writes; rules-unit-test added.
- **D-02:** Membership = denormalized `cohortId?: string` field on `AgentProfileDoc` — NOT a UID array on the cohort doc, NOT a join collection. One cohort per agent. Filter via `where('cohortId','==',cid)`.
- **D-03:** Cohort write = admin-only; read = admin (all) + senior-coach (cohorts containing their downline); read-only DENIED. Cohort CRUD audited.

**Agent profile pages (Surface 2)**
- **D-04:** Read-only drill-in composed ONLY from existing data (`agentProfiles/{uid}` + new fields, joined with `usageRollups`, that agent's `escalations`/`knowledgeGaps` counts, funnel position). No new write path; journey state NOT editable here.
- **D-05:** Admin sees any agent; senior-coach sees only own-downline agents (`agentProfiles.seniorCoachId == coach.uid`); every coach read writes `auditDrilldown(coachUid, 'agentProfiles')`. read-only DENIED.

**Coach-assignment UI (Surface 3)**
- **D-06:** Writes EXISTING fields — `agentProfiles.seniorCoachId` AND mirrors `users.uplineCoachId` — no schema change. Both updated atomically in one Server Action; audited.
- **D-07:** Admin-only (mirrors the role-assignment UI). Coaches cannot reassign their own downline.
- **D-08:** Denormalized `seniorCoachId` already stamped on historical rows (`replyEdits`, etc.) is LEFT AS-IS on reassignment. Only future rows pick up the new coach. Backfilling historical denorm is out of scope.

**Conversation flagged queue (Surface 4)**
- **D-09:** New top-level `conversationFlags/{flagId}` collection (stamps `tenantId`). Fields: `tenantId`, `conversationId`, `flaggedByUid`, `reason`, `status: 'open' | 'reviewed' | 'dismissed'`, `seniorCoachId` (denormalized), `createdAt`, `reviewedBy?`, `reviewedAt?`. Deny-by-default; writes via Admin-SDK Server Action only (mirrors `escalations`); rules-unit-test added.
- **D-10:** No conversation content stored on the flag — `conversationId` reference only. Queue resolves the conversation through the EXISTING audited conversation viewer.
- **D-11:** Manual flag only — no AI auto-flagging in v1. Flag write = coach (own-downline conversations) + admin; queue read = admin (all open flags) + senior-coach (own-downline flags). read-only DENIED.

**Audit-log viewer (Surface 5)**
- **D-12:** Read-only admin surface over existing `auditLogs` showing `actorUid`, `action`, `targetRef`, `ts`. Hashes NOT decoded (sha256 is one-way by design).
- **D-13:** Admin-only. Bounded query: `orderBy('ts','desc').limit(50)` with cursor pagination + filter by `action`/`actorUid`/date range (reuse `searchConversations` pattern).
- **D-14:** The audit-log viewer does NOT self-audit (avoids audit-of-audit recursion). Server-side gate is the control.

**Model-config admin UI (Surface 6)**
- **D-15:** Read AND write of Remote Config. UI reads current `model.{pillar}.default` for the 5 pillars (`coach`, `finder`, `reply`, `router`, `grader`) and lets an admin update them. Writes via the Admin SDK Remote Config publish path. Model IDs stay free-form strings; `REMOTE_CONFIG_FALLBACKS` values shown as hints only, never a hard-coded allow-list.
- **D-16:** Only the 5 `model.{pillar}.default` keys editable — UI does NOT expose arbitrary keys. Write uses template ETag/version for optimistic concurrency (surface a conflict error, never blind-overwrite). Lightweight confirm dialog + audit row on publish (NOT type-to-confirm).
- **D-17:** Admin-only; every publish writes an audit row (`action: 'model_config_publish'`, hashed pillar+new model id). `REMOTE_CONFIG_FALLBACKS` constants remain untouched.

**PDPA-settings read-only display (Surface 7)**
- **D-18:** Static, read-only policy display (no editable knobs). Shows policy-fixed values (residency `asia-southeast1`, PII-pseudonymized-at-boundary, `usageEvents` 90d TTL, audit hashes-only, <72h erasure SLA) from a single policy-constants module, plus a link to the existing admin erasure flow.
- **D-19:** Admin-only for Phase 7. Widening PDPA-settings to read-only is an open Derek decision, not assumed.

**days-to-first-close metric (Surface 8)**
- **D-20:** Minimal new close signal — `firstCloseAt?: Date` field on `AgentProfileDoc` (NOT a full `deals` collection).
- **D-21:** Set by an audited "record first close" Server Action invoked by senior-coach (own downline) or admin. Idempotent (records FIRST close only; subsequent calls no-op or require admin override).
- **D-22:** days-to-first-close = `firstCloseAt − onboarding start` (start = `agentProfiles` creation/journey start), computed read-time in Analytics & Performance — shown as cohort/org aggregate (avg/median) AND per-agent on the profile page. Wires the real signal behind the CDASH-05 funnel stage. Full `deals` ledger deferred.

**Cross-cutting (apply to every surface)**
- **D-23:** Two new collections only — `cohorts` and `conversationFlags` — both via `makeConverter`, both deny-by-default, both with rules-unit-tests in the SAME plan. `firstCloseAt`/`cohortId` are field additions (no new collection). All refs via named factories — never string literals.
- **D-24:** Every new surface gated server-side via `requireRole()` — never nav-only hiding. read-only DENIED on ALL Phase-7 surfaces. Phase 7 adds NO new read-only-visible surface. Nav filtering is UX-only.
- **D-25:** Section placement (hrefs unchanged): cohorts + agent profiles + coach-assignment → Agents & Cohorts; flagged queue → Conversations & Escalations; audit-log viewer + model-config + PDPA-settings → System & Compliance; days-to-first-close → Analytics & Performance.
- **D-26:** Trilingual EN/BM/中文 from the start — every new string + nav label in all three `next-intl` catalogs; `i18n-parity.test.ts` enforces key-set equality in CI.
- **D-27:** Wave sequencing mirrors Phase 6: Wave 0 = failing-test scaffold; then data-model/rules BEFORE the surfaces that consume them.

### Claude's Discretion
- Exact UI composition of each surface within vendored shadcn primitives + Phase-6 section layout conventions.
- Whether cohort management and coach-assignment share one "Agents & Cohorts" page or are separate routes (keep deep links stable).
- Pagination cursor mechanics for the audit-log viewer (startAfter vs offset) — bounded at 50 either way.
- Whether the model-config conflict-handling surfaces a retry or a reload — never blind-overwrite a newer template.
- Per-agent vs cohort-level rollup math for days-to-first-close presentation (both required; layout is open).

### Deferred Ideas (OUT OF SCOPE)
| Item | Deferred to |
|------|-------------|
| Full `deals`/CRM ledger (deal value, project, multi-close history) | Future phase |
| AI auto-flagging of conversations | Future phase |
| Backfilling historical denormalized `seniorCoachId` on reassignment | Future / on-demand |
| Widening read-only role to see PDPA-settings display | **Open Derek decision** |
| Many-to-many cohort membership / nested cohorts | Future phase |
| Editable agent journey state from the profile page | Out of scope |
| WhatsApp Business API / any auto-send | **Phase 8** (No WABA / No auto-send stay in force through Phase 7) |
</user_constraints>

<phase_requirements>
## Phase Requirements

> Phase 7 derives NEW REQ-IDs (the planner finalizes IDs/status). Proposed grouping below — one prefix per surface, mirroring the Phase-6 derivation style (IA/RO/HOME/KM/CKB/AP/SC/I18N). Each maps to ≥1 CONTEXT decision so all D-01..D-27 are implementable.

| Proposed ID | Description | Maps to | Research Support |
|----|-------------|---------|------------------|
| **COH-01** | `cohorts/{cohortId}` collection (converter + ref factory + deny-by-default rules + rules-test) | D-01, D-23 | §Standard Stack, §Pattern 1, §Code Examples (new collection) |
| **COH-02** | `cohortId?` field on `AgentProfileDoc`; membership one-per-agent via `where('cohortId','==',cid)` | D-02 | §Pitfall (optional-field backward-compat), §Code Examples |
| **COH-03** | Cohort CRUD admin-only Server Action, audited; read admin(all)+coach(downline cohorts); read-only DENIED | D-03, D-24 | §Pattern 2 (admin-only Server Action), §Pattern 3 (rules read-scope) |
| **PROF-01** | Agent profile read-only drill-in composed from `agentProfiles`+`usageRollups`+counts+funnel | D-04 | §Code Examples (compose read), §dashboard/queries.ts reuse |
| **PROF-02** | Profile access admin(any)+coach(own-downline `seniorCoachId==uid`); coach read writes `auditDrilldown`; read-only DENIED | D-05, D-24 | §Pattern 5 (audited downline read), §Pitfall (audit-before-read) |
| **ASSIGN-01** | Coach-assignment Server Action: atomic dual-write `agentProfiles.seniorCoachId` + `users.uplineCoachId`; admin-only; audited | D-06, D-07 | §Pattern 6 (batch dual-write), §Code Examples |
| **ASSIGN-02** | Historical denormalized `seniorCoachId` NOT backfilled on reassignment (document; future rows only) | D-08 | §Pitfall (denorm staleness), §Runtime State Inventory |
| **FLAG-01** | `conversationFlags/{flagId}` collection (converter + ref + deny-by-default rules + rules-test); content-free (`conversationId` ref only) | D-09, D-10, D-23 | §Standard Stack, §Pattern 1 |
| **FLAG-02** | Flag Server Action (Admin-SDK write): coach(own-downline conv)+admin; manual only; denormalized `seniorCoachId` stamped at write | D-09, D-11 | §Pattern 6, §Pitfall (denorm-for-read-scope) |
| **FLAG-03** | Flagged-queue read view: admin(all open)+coach(own-downline); status filter; read-only DENIED | D-11, D-24 | §Pattern 3, §Code Examples (bounded query + index) |
| **AUDIT-01** | Audit-log viewer: read-only admin surface over `auditLogs`; `orderBy('ts','desc').limit(50)` + cursor + filter by action/actorUid/date; hashes NOT decoded; does NOT self-audit | D-12, D-13, D-14 | §Pattern 4 (bounded cursor), §Code Examples, §Pitfall (no self-audit) |
| **MODEL-01** | Model-config read of 5 `model.{pillar}.default` keys via existing `getServerTemplate` read path | D-15 | §Pattern 7 (RC read), §provider.ts |
| **MODEL-02** | Model-config WRITE: `getTemplate()` → mutate `parameters['model.{pillar}.default'].defaultValue` → `publishTemplate(template)` with ETag optimistic concurrency; only the 5 keys; admin-only; audited `model_config_publish` | D-15, D-16, D-17 | §Pattern 7 (RC write), §Code Examples, §Pitfall (ETag conflict) |
| **PDPA-01** | Static PDPA-settings read-only display from a policy-constants module + erasure-flow link; admin-only | D-18, D-19 | §Code Examples (constants module) |
| **CLOSE-01** | `firstCloseAt?` field on `AgentProfileDoc`; audited idempotent "record first close" Server Action (coach own-downline / admin) | D-20, D-21 | §Pattern 6, §Pitfall (idempotency) |
| **CLOSE-02** | days-to-first-close = `firstCloseAt − onboarding start`; read-time aggregate (org/cohort avg/median + per-agent); wires CDASH-05 funnel stage | D-22 | §Pitfall (onboarding-start derivation), §Open Questions Q1 |
| **NAV-01** | 8 role-filtered nav entries across the 4 Phase-6 sections in `app-sidebar-nav.ts`; read-only sees none of them | D-25, D-24 | §Pattern (nav model), §app-sidebar-nav.ts |
| **I18N-07** | Every new surface string + nav label in en/ms/zh; `i18n-parity.test.ts` stays green | D-26 | §Code Examples (parity test), §Validation |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cohort CRUD (Surface 1) | API/Backend (Server Action, Admin SDK) | Database (`cohorts` collection + rules) | Admin-write sensitive collection; client never writes (mirrors escalations). |
| Cohort membership filter | Database (Firestore equality query) | — | `cohortId` denormalized on `AgentProfileDoc`; equality query, no join. |
| Agent profile drill-in (Surface 2) | API/Backend (Server Component read via Admin SDK) | Database (read existing collections) | Composed read; downline-scoped; audited write-on-read. No client Firestore read of PII. |
| Coach-assignment (Surface 3) | API/Backend (Server Action, batched write) | Database (`agentProfiles` + `users`) | Atomic dual-write of two existing docs; admin-gated; audited. |
| Conversation flag write (Surface 4) | API/Backend (Server Action, Admin SDK) | Database (`conversationFlags`) | Server-only write; denormalized `seniorCoachId` for coach read-scope. |
| Flagged-queue read (Surface 4) | API/Backend (Server Component/Action bounded read) | Database (composite index) | Bounded + filtered; coach/admin read-scope via rules. |
| Audit-log viewer (Surface 5) | API/Backend (Server Component, Admin SDK) | Database (`auditLogs` bounded query) | Admin-only; server-side read; cursor pagination; no client read (auditLogs admin-only by rules). |
| Model-config read/write (Surface 6) | API/Backend (Server Action, `firebase-admin/remote-config`) | External Google config (Remote Config backend) | The ONLY surface touching a Google-managed config service; stays inside Admin SDK. |
| PDPA-settings display (Surface 7) | Frontend Server (RSC) | — | Static constants render; no data tier; admin-gated route. |
| Record first close (Surface 8) | API/Backend (Server Action) | Database (`agentProfiles.firstCloseAt`) | Idempotent audited field write; coach/admin. |
| days-to-first-close metric (Surface 8) | API/Backend (read-time aggregation in queries) | Frontend Server (RSC render) | Computed read-time from `firstCloseAt − start`; no stored metric. |
| Nav entries | Frontend Server / Client (sidebar) | — | UX-only role filter; never the auth gate. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `firebase-admin` | 13.10.0 `[VERIFIED: node_modules/firebase-admin/package.json]` | Firestore writes, Remote Config read/write, Auth claims | Already the sole backend SDK; the no-GCP constraint forbids anything else. |
| `firebase-admin/remote-config` | (bundled in 13.10.0) | Surface 6 write path (`getTemplate`/`publishTemplate`) + existing read (`getServerTemplate`) | `RemoteConfig.publishTemplate(template, {force?})` verified present in the v13.10.0 type defs `[VERIFIED: node_modules/.../remote-config.d.ts]`. |
| `next` | 16.2.6 `[VERIFIED: node_modules/next/package.json]` | App Router RSC + Server Actions | Project framework. **NOT the Next.js in training data** — see Next.js 16 gotchas. |
| `next-intl` | ^4 `[CITED: CLAUDE.md]` | Trilingual catalogs (en/ms/zh) | Existing i18n; parity enforced by `i18n-parity.test.ts`. |
| `@firebase/rules-unit-testing` | (installed) | Firestore rules unit tests against the emulator | The established per-collection rules matrix (`rules.test.ts`). |
| `vitest` | (installed) | Unit + rules tests | Project test runner. |
| `lucide-react` | (installed) | Sidebar icons | Already used in `app-sidebar-nav.ts`. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui (vendored in `components/ui/`) | — | All UI primitives (table, dialog, sidebar, form, alert-dialog) | Every surface. **Already vendored — do not re-install.** |
| `crypto` (Node builtin) | — | sha256 hashes in audit rows | `audit/log.ts` already uses it; Surface 6 publish audit reuses `log()` (auto-hashes). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cohorts` collection + denormalized `cohortId` | Join collection or UID array on cohort doc | LOCKED OUT by D-02 (1 MB array trap / YAGNI join). Do not propose. |
| Firestore batch for dual-write (Surface 3) | Firestore transaction | Batch is sufficient and simpler — no read-then-write dependency; both are unconditional sets. Transaction only needed if a read must gate the write. (Discretion, but batch recommended.) |
| `getTemplate()` for Surface 6 read | Reuse `getServerTemplate()` | The UI read CAN reuse `modelFor`'s server-template read for display, but the WRITE round-trip MUST use `getTemplate()` to obtain the project-template ETag for `publishTemplate`. See §Pattern 7. |

**Installation:** None. Every dependency is already in `package.json`. No `npm install` in this phase. (Confirm by running `npm ls firebase-admin next next-intl` — all present.)

**Version verification:** `firebase-admin@13.10.0` and `next@16.2.6` confirmed from installed `node_modules` package.json files (not training data). `RemoteConfig.publishTemplate(template, options?: { force: boolean })` and `getTemplate()`/`getTemplateAtVersion()` confirmed in the installed `.d.ts`. `RemoteConfigTemplate.etag` is `readonly` and `parameters` is `{ [key: string]: RemoteConfigParameter }` with `RemoteConfigParameter.defaultValue?: RemoteConfigParameterValue` (`ExplicitParameterValue` has a `value: string`).

## Package Legitimacy Audit

> Phase 7 installs **NO new external packages**. Every dependency is already vendored/installed. Audit table reflects the in-use packages relevant to this phase.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| firebase-admin | npm | mature (13.x) | very high | github.com/firebase/firebase-admin-node | OK | In use — no change |
| next | npm | mature (16.x) | very high | github.com/vercel/next.js | OK | In use — no change |
| next-intl | npm | mature (4.x) | high | github.com/amannn/next-intl | OK | In use — no change |
| @firebase/rules-unit-testing | npm | mature | high | github.com/firebase/firebase-js-sdk | OK | In use — no change |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**New installs this phase:** none — legitimacy gate is a no-op for Phase 7.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────────────────┐
   Admin / Senior-coach   │  Next.js 16 App Router (App Hosting, asia-southeast1)     │
   browser (console)      │                                                          │
        │                 │  proxy.ts (auth + locale)                                │
        │  request        │      │                                                   │
        ▼                 │      ▼                                                   │
   ┌─────────┐            │  app/[lang]/(admin|coach)/layout.tsx ── route-group gate │
   │ surface │────────────┼─►  page.tsx (RSC) ── requireRole({allowed, fallback}) ◄──┼── read-only DENIED here
   │  nav    │            │      │                              (server-side gate)   │   on every Phase-7 surface
   └─────────┘            │      ▼                                                   │
   (UX filter only,       │  Server Action  /  Server Component read                 │
    never the gate)       │      │                                                   │
                          │      ├──► writes ──► Admin SDK ─────────────────────────┐│
                          │      │                                                  ││
                          │      └──► reads  ──► Admin SDK (bounded, cursor)        ││
                          └───────────────────────────────────────────────────────┼┼┘
                                                                                    ││
        ┌───────────────────────────────────────────────────────────────────────────┘│
        ▼                                                                              ▼
  ┌──────────────────────────── Firestore (Native) ──────────────┐        ┌──────────────────────────┐
  │  NEW:  cohorts/{cohortId}        conversationFlags/{flagId}   │        │  Remote Config backend    │
  │  FIELD: agentProfiles.cohortId?  agentProfiles.firstCloseAt?  │        │  (same backend for both): │
  │  READ:  usageRollups  escalations  knowledgeGaps  auditLogs   │        │   getServerTemplate (read)│
  │         users (uplineCoachId)    conversations (ref only)     │        │   getTemplate+publish     │
  │  rules: deny-by-default; admin/coach scopes; read-only DENIED │        │   (write, ETag concurrency│
  │  index: (seniorCoachId,status) on conversationFlags;          │        │    — Surface 6)           │
  │         (action,ts)/(actorUid,ts) on auditLogs                │        └──────────────────────────┘
  └───────────────────────────────────────────────────────────────┘
        │
        ▼  fire-and-forget after()
   audit.log() / auditDrilldown()  ──► auditLogs (hashes-only)  ──read──►  Surface 5 viewer (admin-only)
```

Trace the primary use case (admin assigns a coach): browser → `(admin)/layout.tsx` gate → `coach-assignment` page RSC `requireRole({allowed:['admin']})` → `assignRole(agentUid, newCoachUid)` Server Action verifies token role → Firestore **batch** sets `agentProfiles/{uid}.seniorCoachId` + `users/{uid}.uplineCoachId` → `audit.log({action:'coach-assign'})`.

### Recommended Project Structure
```
src/firebase/
├── collections.ts              # ADD CohortDoc + ConversationFlagDoc interfaces, converters, ref factories;
│                               #   ADD cohortId?/firstCloseAt? to AgentProfileDoc (collections 21 + 22)
└── __tests__/
    └── rules.test.ts           # ADD cohorts + conversationFlags matrices (4 roles incl. read-only DENY)

firestore.rules                 # ADD match /cohorts/{id} and match /conversationFlags/{id} blocks
firestore.indexes.json          # ADD (seniorCoachId,status) on conversationFlags; (action,ts)+(actorUid,ts) on auditLogs

src/pdpa/
└── policy-constants.ts         # NEW single source for the static PDPA display (Surface 7)

src/dashboard/
└── queries.ts                  # EXTEND: per-agent profile composer (Surface 2); days-to-first-close aggregate (Surface 8)

app/[lang]/
├── _components/app-sidebar-nav.ts   # ADD 8 nav items across the 4 sections (NAV-01)
├── (admin)/
│   ├── cohorts/                # Surface 1 (page + actions + table/dialog)
│   ├── agents/[uid]/           # Surface 2 profile drill-in (or under existing agents route — discretion)
│   ├── coach-assignment/       # Surface 3 (page + actions) — or fold into cohorts/agents page
│   ├── conversations/          # EXTEND viewer with a "Flag" affordance (Surface 4 write hook)
│   ├── flags/                  # Surface 4 queue view + actions
│   ├── audit-log/              # Surface 5 viewer + actions (bounded cursor read)
│   ├── model-config/           # Surface 6 (page + publish action)
│   └── pdpa-settings/          # Surface 7 (static RSC)
src/i18n/messages/{en,ms,zh}.json  # ADD all new keys to all three (parity-gated)
```

### Pattern 1: New collection via the converter + ref-factory registry (D-01, D-09, D-23)
**What:** Declare the doc interface, build a converter with `makeConverter<T>()` (auto-stamps `tenantId`), export a numbered ref factory. Never use a string literal at a call site.
**When to use:** `cohorts` (collection 21) and `conversationFlags` (collection 22).
**Example:**
```typescript
// Source: src/firebase/collections.ts (existing pattern, lines 638-855)
export interface CohortDoc {
  tenantId: TenantId
  name: string
  description: string
  createdAt: Date | FieldValue
  createdBy: string // admin uid
}
export const cohortConverter = makeConverter<CohortDoc>()
/** Collection 21: cohorts/{cohortId} — admin-write, coach/admin-read (downline cohorts). */
export function cohortsRef(): CollectionReference<CohortDoc> {
  return adminDb.collection('cohorts').withConverter(cohortConverter)
}

export interface ConversationFlagDoc {
  tenantId: TenantId
  conversationId: string          // REFERENCE ONLY — no conversation content (D-10)
  flaggedByUid: string
  reason: string
  status: 'open' | 'reviewed' | 'dismissed'
  seniorCoachId: string           // DENORMALIZED for coach read-scope (Pitfall D, mirrors replyEdits)
  createdAt: Date | FieldValue
  reviewedBy?: string
  reviewedAt?: Date | FieldValue
}
export const conversationFlagConverter = makeConverter<ConversationFlagDoc>()
/** Collection 22: conversationFlags/{flagId} — Admin-SDK write only; admin+coach read. */
export function conversationFlagsRef(): CollectionReference<ConversationFlagDoc> {
  return adminDb.collection('conversationFlags').withConverter(conversationFlagConverter)
}
```

### Pattern 2: Admin-only Server Action (mirror `assignRole`/`searchConversations`)
**What:** `'use server'`; read `__session` cookie; `requireUser(syntheticReq)`; assert `user.role === 'admin'` from the VERIFIED token (never from args); do the work; `audit.log(...)`; return `{ok:true}` / `{ok:false,error}`.
**When to use:** cohort CRUD (COH-03), coach-assignment (ASSIGN-01), model-config publish (MODEL-02), record-first-close (CLOSE-01, but allows coach-or-admin).
**Example:** `app/[lang]/(admin)/roles/actions.ts:110-151` (`assignRole`) is the verbatim template — copy the `getSessionUser()` helper and the gate.

### Pattern 3: Firestore rules read-scope (deny-by-default + coach downline + admin all + read-only DENY)
**What:** Each new collection's `match` block: `allow read` for `(hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant()) || (hasRole('admin') && sameTenant())`; `allow create,update,delete: if false` (Admin-SDK only) for `conversationFlags`; admin-write for `cohorts`. read-only is **excluded by construction** — it is neither coach nor admin and there is no `isAnalyticsReader()` grant, so it is denied automatically.
**When to use:** `cohorts`, `conversationFlags`.
**Example:**
```javascript
// Source: firestore.rules (escalations block, lines 228-238 — the exact shape to mirror)
match /conversationFlags/{flagId} {
  allow read:
    if (hasRole('senior-coach')
        && resource.data.seniorCoachId == request.auth.uid
        && sameTenant())
    || (hasRole('admin') && sameTenant());
  allow create, update, delete: if false;   // Admin-SDK Server Action only (D-09)
}
match /cohorts/{cohortId} {
  allow read:
    if (hasRole('senior-coach') && sameTenant())   // coach reads cohorts (downline filter applied app-side; see Open Q3)
    || (hasRole('admin') && sameTenant());
  allow write: if hasRole('admin') && incomingTenant();  // admin-only (D-03)
}
```
> **Cohort coach read note:** A cohort doc has no `seniorCoachId` field (membership is on the agent, not the cohort). The rule cannot express "cohorts containing my downline" — the app-side query (Server Component) does the downline filter; the rule admits any signed-in coach to read cohort metadata (cohort name/description is not agent-PII). If Derek wants tighter rule-level scoping, that needs a denormalized field — flag as Open Q3.

### Anti-Patterns to Avoid
- **Widening the read-only allow-list.** Phase-6 LOCKED read-only to analytics aggregates + KB read. Adding ANY read-only grant in Phase 7 (even PDPA text) is a defect unless Derek explicitly decides it (D-19). Every Phase-7 rule must DENY read-only.
- **Storing conversation content on a flag.** `conversationFlags` carries `conversationId` only (D-10). Storing message text reintroduces a PII surface that the existing audited viewer already governs.
- **Hard-coding a model ID anywhere.** Surface 6 reads/writes strings to Remote Config; `REMOTE_CONFIG_FALLBACKS` is the cold-bootstrap fallback only and must not become an allow-list.
- **`publishTemplate(template, {force:true})`.** Blind-overwrite discards a concurrent admin's change (D-16). Always publish with the ETag the read returned; surface a conflict on stale ETag.
- **Client-side Firestore reads of `auditLogs`/`agentProfiles`/`conversationFlags`.** `collections.ts` uses `adminDb` (server-only). These surfaces read via Server Components / Server Actions, never `clientDb`.
- **Nav-only hiding as the gate.** `app-sidebar-nav.ts` is UX-only (T-06-15). The `requireRole()` page gate + Firestore rules are the boundary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| tenantId stamping on new collections | Manual `tenantId` on every write | `makeConverter<T>()` | Auto-stamps; no write can omit it (existing registry). |
| Server-side role gate | A new redirect-and-verify block per page | `requireRole({lang, allowed, fallback})` | Single tested helper; handles the NEXT_REDIRECT-outside-try pitfall (require-role.ts:22). |
| Admin-only Server Action gate | Re-implement token verify + role check | Copy `getSessionUser()` + `user.role==='admin'` from `roles/actions.ts` | Verbatim-proven pattern; reads role from verified token (T-02-31). |
| Audited read-on-drilldown | Inline `createHash` + audit write | `auditDrilldown(actorUid, targetRef)` | Standardizes action label + hashes-only row (audit/log.ts:120). |
| Audit row hashing | Hash PII manually before writing | `audit.log({raw:{...}})` | `log()` sha256-hashes EVERY value in `raw` (audit/log.ts:57). Pass pillar+model-id as `raw`. |
| Remote Config model resolution (read) | Parse RC JSON manually | `modelFor(pillar)` / `getServerTemplate().evaluate().getString()` | Existing single resolution surface (provider.ts:70). |
| Bounded list with pagination | `getDocs()` then slice in memory | `.orderBy(...).limit(50).startAfter(cursor)` | `searchConversations` (actions.ts:160) is the bounded template; never fetch-all. |
| Trilingual key parity | Eyeball the three catalogs | `i18n-parity.test.ts` (CI) | Already enforces key-set equality; just add keys to all three. |
| Downline-scoped read | New filter logic per surface | `getDownline`/`getOpenStalls` pattern (`where('seniorCoachId','==',uid)`) | Existing AUTH-06 double-gate (queries.ts). |

**Key insight:** Phase 7 is overwhelmingly a *composition* phase. The single highest-leverage move is to copy the existing proven patterns (converter, requireRole, getSessionUser+admin gate, auditDrilldown, bounded query, parity test) rather than write anything new. The ONLY genuinely net-new mechanism is the Remote Config WRITE round-trip (Surface 6).

## Runtime State Inventory

> This phase adds fields and collections and reassigns a denormalized key (coach). A grep finds files; it does not find runtime/data state. All five categories answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) Existing `agentProfiles/{uid}` docs LACK `cohortId` and `firstCloseAt` (both new optional fields). (2) Existing analytics/signal rows (`replyEdits`, `knowledgeGaps`, `escalations`) carry a denormalized `seniorCoachId` stamped at creation — coach-reassignment (Surface 3) does NOT update these (D-08). | (1) **No backfill needed** — fields are optional; reads treat absent as "no cohort / no close yet" (mirrors `EscalationDoc.resolvedAt`, `KbDocDoc.status` backward-compat pattern). (2) **Code edit only** — `assignRole`-style action updates the live `agentProfiles.seniorCoachId` + `users.uplineCoachId`; historical denorm intentionally left stale (documented; backfill deferred). |
| **Live service config** | Remote Config parameters `model.{pillar}.default` for 5 pillars live in the Firebase-managed Remote Config backend, NOT in git. Surface 6 reads AND writes these. Current published values may differ from `REMOTE_CONFIG_FALLBACKS`. | **API read/write via Admin SDK** (`getTemplate`/`publishTemplate`). The 5 keys must EXIST in the published template for the write round-trip to mutate them; if a key is absent the publish must CREATE the parameter (handle both). Confirm the 5 keys are provisioned (Open Q2). No external scheduler/Vertex involved. |
| **OS-registered state** | None. No Task Scheduler / pm2 / launchd / systemd registrations introduced or renamed by this phase. | None — verified: phase is web-app surfaces only, no scheduled jobs added (on-visit lazy-cron unchanged). |
| **Secrets/env vars** | None new. Admin SDK uses existing ADC (`FIREBASE_SERVICE_ACCOUNT_KEY` / metadata server). No new secret introduced. Remote Config write requires the App Hosting service account to have RC publish permission. | **Verify (Open Q5):** the App Hosting service account has `firebaseremoteconfig.remoteConfig.update` (the publish path needs write scope, not just read). Production read already works (`modelFor`); write is a new permission requirement. |
| **Build artifacts** | None. No package rename, no egg-info/compiled-binary equivalent. New collections require deployed `firestore.rules` + `firestore.indexes.json` (these ARE in git but must be DEPLOYED). | **Deploy step:** `firebase deploy --only firestore:rules,firestore:indexes` after the rules/indexes wave. Composite indexes are eventually-built — queries fail until the index finishes building (Pitfall). |

**The canonical question:** After every file is updated, what runtime systems still hold old/absent state? → (a) Remote Config published template (must be read/written via API, not git), (b) the Firestore index build (must complete before the coach-scoped flag query and audit-log filters work), (c) historical denormalized `seniorCoachId` rows (intentionally stale per D-08).

## Common Pitfalls

### Pitfall 1: Forgetting the rules + rules-test in the same plan (Pitfall 6 mandate)
**What goes wrong:** A new collection ships with a converter + ref factory but no `firestore.rules` match block → it inherits deny-by-default (good) but the *intended* coach/admin read path is untested and may be silently broken; OR a too-broad rule ships untested and leaks.
**Why it happens:** The data-model task feels "done" once `collections.ts` compiles.
**How to avoid:** D-23 mandates collection + rules + rules-unit-test in ONE plan. The Wave-0 RED scaffold must include `cohorts` and `conversationFlags` rows in the unauthenticated-deny loop (rules.test.ts:97) AND a per-collection matrix (4 roles incl. read-only DENY) like the `escalations`/`replyEdits` blocks.
**Warning signs:** A collection name appears in `collections.ts` but not in `firestore.rules` or the `collections` array in `rules.test.ts`.

### Pitfall 2: Re-widening the LOCKED read-only allow-list
**What goes wrong:** A Phase-7 rule grants read-only a read (e.g. PDPA text, cohort metadata) → breaks the Phase-6 least-privilege lock and the LOCKED 06-VALIDATION matrix.
**Why it happens:** Some Phase-7 data (PDPA policy text, cohort names) is *not* PII, so it feels safe to expose.
**How to avoid:** D-19/D-24 are explicit: read-only gets NOTHING new in Phase 7. Every new rule omits any read-only/`isAnalyticsReader()` grant. The Wave-0 scaffold asserts read-only is DENIED on `cohorts`, `conversationFlags`, and every Phase-7 route. Widening PDPA to read-only is an Open Derek decision, NOT a planner choice.
**Warning signs:** `isAnalyticsReader()` or `hasRole('read-only')` or `isReadOnlyRole()` appears anywhere in a new rule; a Phase-7 page's `requireRole` allow-list contains `'read-only'`.

### Pitfall 3: Remote Config write→read coherence + ETag staleness (Surface 6)
**What goes wrong:** (a) Admin publishes a new model ID but `modelFor()` keeps returning the old one. (b) Two admins publish concurrently and one silently overwrites the other.
**Why it happens:** (a) `modelFor` reads via `getServerTemplate()` which can serve a cached/recently-propagated template; RC publish is not instantaneous. (b) Using `{force:true}` or re-using a stale ETag.
**How to avoid:** (a) Both `getTemplate` and `getServerTemplate` hit the **same backend service** `[CITED: firebase.google.com/docs/remote-config/server]`, so a publish IS reflected on the next read after propagation — surface "may take a moment to take effect" copy rather than asserting instant. (b) Read the template, capture `template.etag`, mutate, `publishTemplate(template)` WITHOUT `force`; on a stale-ETag rejection surface a conflict and prompt reload (D-16). Do NOT `{force:true}`.
**Warning signs:** `publishTemplate(t, {force:true})` in the diff; the publish action does not read the template immediately before mutating.

### Pitfall 4: days-to-first-close has no clean "onboarding start" timestamp
**What goes wrong:** The metric `firstCloseAt − start` needs a start, but `AgentProfileDoc` today has NO `createdAt` field (verified: fields are `tenantId, journeyStage, currentCheckpoint, lastActiveAt, activeLeadIds, seniorCoachId`). `lastActiveAt` is a moving timestamp, NOT the onboarding start.
**Why it happens:** D-22 says "onboarding start = `agentProfiles` creation / journey start" but there is no persisted creation timestamp on the doc.
**How to avoid:** Resolve before building (Open Q1). Options: (a) ADD an `onboardingStartedAt?: Date` field set when `setUserClaims` creates the profile (`auth.ts:185` — clean, but only future agents get it; existing agents need a backfill or fallback); (b) use the Firestore document create-time metadata (available via `snapshot.createTime` on Admin SDK reads — no schema change, but not in the converter shape); (c) derive from the agent's `users` doc / first conversation. Recommendation: option (b) (`createTime`) for zero-migration read-time derivation, with an optional explicit field if Derek wants it editable. **This is the one genuinely-undecided data question in the phase.**
**Warning signs:** A plan computes the metric off `lastActiveAt` (wrong) or assumes an `AgentProfileDoc.createdAt` that does not exist.

### Pitfall 5: Idempotency of "record first close" (Surface 8)
**What goes wrong:** Coach clicks "record first close" twice, or two coaches record it → the FIRST-close date gets overwritten by a later date, corrupting the metric.
**Why it happens:** A naive `set({firstCloseAt: now})` is not idempotent.
**How to avoid:** D-21 mandates idempotency: the action reads the current `firstCloseAt`; if already set, no-op (or require explicit admin override). Use a transaction or a conditional `update` guarded by the absence of the field. Wave-0 must include a RED test: "second call does not change `firstCloseAt`."
**Warning signs:** Unconditional `firstCloseAt` write; no read-before-write; no test for the double-call case.

### Pitfall 6: Composite index not built before the coach-scoped flag query / audit filters
**What goes wrong:** `conversationFlags` query `where('seniorCoachId','==',uid).where('status','==','open')` or `auditLogs` `where('action','==',x).orderBy('ts','desc')` throws `FAILED_PRECONDITION: requires an index` at runtime.
**Why it happens:** Firestore needs a composite index for an equality + a different orderBy/equality; indexes build asynchronously after deploy.
**How to avoid:** Add the indexes to `firestore.indexes.json` in the data-model wave (mirror the existing `(seniorCoachId,status)` escalations index and `(seniorCoachId,lastSeenAt)` knowledgeGaps index). Deploy and wait for build BEFORE the consuming surface wave. See §Code Examples for the exact index entries.
**Warning signs:** A coach-scoped or filtered query lands in a plan but `firestore.indexes.json` has no matching entry.

### Pitfall 7: Next.js 16 async cookies/headers + stream-only-from-route-handlers
**What goes wrong:** Calling `cookies()` synchronously, or attempting to stream from a Server Action.
**Why it happens:** Training-data Next.js has sync `cookies()` and different streaming rules.
**How to avoid:** `await cookies()` (already done in `require-role.ts:69` and `roles/actions.ts:44`). NONE of the Phase-7 surfaces stream — they are all CRUD/admin reads — so the streaming rule is satisfied trivially. Use `proxy.ts` (not `middleware.ts`) — but this phase adds no middleware.
**Warning signs:** `cookies()` without `await`; a `streamText()` in a Server Action; `middleware.ts`.

## Code Examples

Verified patterns from the live codebase + official docs.

### Remote Config WRITE with ETag concurrency (Surface 6 — MODEL-02)
```typescript
// Source: firebase-admin/remote-config v13.10.0 .d.ts + CITED firebase.google.com/docs/remote-config/automate-rc
'use server'
import { remoteConfig } from '@/src/firebase/admin'
import type { RemoteConfigTemplate } from 'firebase-admin/remote-config'
// ... getSessionUser() + admin gate (copy from roles/actions.ts) ...

export async function publishModelConfig(pillar: string, modelId: string) {
  // admin gate omitted for brevity — assert user.role === 'admin' from verified token
  const rc = remoteConfig()
  // READ the PROJECT template (carries the writable ETag — getServerTemplate does not expose it the same way)
  const template: RemoteConfigTemplate = await rc.getTemplate()  // template.etag is readonly + carried internally
  const key = `model.${pillar}.default`  // only the 5 known keys (D-16) — validate pillar ∈ {coach,finder,reply,router,grader}

  // Mutate (or create) the parameter's default value. ExplicitParameterValue = { value: string }.
  template.parameters[key] = {
    ...(template.parameters[key] ?? {}),
    defaultValue: { value: modelId },   // model IDs stay free-form strings (D-15)
  }

  try {
    // Publish WITHOUT force — the SDK sends the template's ETag for optimistic concurrency (D-16).
    await rc.publishTemplate(template)   // do NOT pass { force: true }
  } catch (err) {
    // Stale ETag → another admin published since our read. Surface a conflict; prompt reload.
    return { ok: false as const, error: 'conflict', detail: 'Template changed — reload and retry.' }
  }

  // Audit (hashes-only) — log() sha256-hashes every raw value (D-17)
  // audit.log({ actorUid, action: 'model_config_publish', raw: { pillar, modelId } })
  return { ok: true as const }
}
```
> **Why `getTemplate()` (not `getServerTemplate()`) for the write:** `getServerTemplate()` returns a `ServerTemplate` for evaluation; the publish round-trip operates on the project `RemoteConfigTemplate`. Both hit the same backend so the published default is what `modelFor()`'s next `getServerTemplate().evaluate().getString('model.{pillar}.default')` reads `[CITED: firebase.google.com/docs/remote-config/server]`. The READ for display MAY reuse `modelFor`'s server-template path; the WRITE MUST use `getTemplate`/`publishTemplate`.

### Atomic coach-assignment dual-write (Surface 3 — ASSIGN-01)
```typescript
// Source: pattern from roles/actions.ts (admin gate) + Firestore batch (Admin SDK)
'use server'
import { agentProfilesRef, usersRef } from '@/src/firebase/collections'
import { adminDb } from '@/src/firebase/admin'
import * as audit from '@/src/audit'
// ... getSessionUser() + assert user.role === 'admin' ...

export async function assignCoach(agentUid: string, newCoachUid: string) {
  const batch = adminDb.batch()
  // Both writes are unconditional sets → batch is sufficient (no read-gate → no transaction needed).
  batch.update(agentProfilesRef().doc(agentUid), { seniorCoachId: newCoachUid })
  batch.update(usersRef().doc(agentUid), { uplineCoachId: newCoachUid })
  await batch.commit()   // atomic: both or neither (D-06)
  await audit.log({ actorUid: /*admin uid*/'', action: 'coach-assign', targetRef: `agentProfiles/${agentUid}`, raw: { agentUid, newCoachUid } })
  // NOTE: historical replyEdits/knowledgeGaps/escalations denorm seniorCoachId is NOT backfilled (D-08).
  return { ok: true as const }
}
```

### Bounded cursor read for the audit-log viewer (Surface 5 — AUDIT-01)
```typescript
// Source: searchConversations bounded pattern (conversations/actions.ts:160) — admin-only, never fetch-all
'use server'
import { adminDb } from '@/src/firebase/admin'
// ... getSessionUser() + assert user.role === 'admin' (D-13) ...
// NOTE: this viewer does NOT call auditDrilldown — it must NOT self-audit (D-14).

export async function listAuditLogs(opts: { action?: string; actorUid?: string; cursorTs?: number }) {
  let q = adminDb.collection('auditLogs').orderBy('ts', 'desc').limit(50)  // bounded (D-13)
  if (opts.action) q = adminDb.collection('auditLogs').where('action', '==', opts.action).orderBy('ts', 'desc').limit(50)
  // actorUid filter analogous; date-range via where('ts','>=',from).where('ts','<=',to) (needs index)
  if (opts.cursorTs) q = q.startAfter(opts.cursorTs)
  const snap = await q.get()
  // hashes NOT decoded (D-12) — return actorUid, action, targetRef, ts only
  return snap.docs.map(d => { const x = d.data(); return { id: d.id, actorUid: x.actorUid, action: x.action, targetRef: x.targetRef, ts: x.ts } })
}
```

### Composite indexes for the new queries (firestore.indexes.json)
```json
// Source: existing escalations (seniorCoachId,status) + knowledgeGaps (seniorCoachId,lastSeenAt) entries
{ "collectionGroup": "conversationFlags", "queryScope": "COLLECTION",
  "fields": [ {"fieldPath":"seniorCoachId","order":"ASCENDING"}, {"fieldPath":"status","order":"ASCENDING"} ] },
{ "collectionGroup": "conversationFlags", "queryScope": "COLLECTION",
  "fields": [ {"fieldPath":"status","order":"ASCENDING"}, {"fieldPath":"createdAt","order":"DESCENDING"} ] },
{ "collectionGroup": "auditLogs", "queryScope": "COLLECTION",
  "fields": [ {"fieldPath":"action","order":"ASCENDING"}, {"fieldPath":"ts","order":"DESCENDING"} ] },
{ "collectionGroup": "auditLogs", "queryScope": "COLLECTION",
  "fields": [ {"fieldPath":"actorUid","order":"ASCENDING"}, {"fieldPath":"ts","order":"DESCENDING"} ] }
```
> A single-field `orderBy('ts','desc')` does NOT need a composite index (Firestore auto-indexes single fields). The composite indexes are only needed when a `where(...)` filter is combined with the `orderBy('ts')`.

### Optional field addition with backward-compat (COH-02, CLOSE-01)
```typescript
// Source: KbDocDoc.status / EscalationDoc.resolvedAt optional-field pattern (collections.ts)
export interface AgentProfileDoc {
  tenantId: TenantId
  journeyStage: string
  currentCheckpoint: string
  lastActiveAt: Date | FieldValue
  activeLeadIds: string[]
  seniorCoachId: string
  /** Phase-7 COH-02: one-cohort-per-agent membership (D-02). Absent on pre-Phase-7 docs. */
  cohortId?: string
  /** Phase-7 CLOSE-01: first-close signal (D-20). Absent = no close recorded yet. Idempotent set (D-21). */
  firstCloseAt?: Date | FieldValue
}
// No backfill: reads treat absent as "no cohort" / "no close". Mirrors KbDocDoc.status backward-compat.
```

### i18n parity (I18N-07)
```typescript
// Source: src/i18n/__tests__/i18n-parity.test.ts — already enforces identical key sets across en/ms/zh.
// Action: add every new nav + surface string to ALL THREE catalogs (en.json, ms.json, zh.json).
// The test goes RED the moment a key exists in one catalog but not the others. No test change needed.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RC client SDK fetch-and-activate | Server-side `getServerTemplate()` + Admin `getTemplate`/`publishTemplate` | firebase-admin v12.1.0+ (server-side RC) | Project already on 13.10.0; the write path is fully supported. `[CITED: firebase.google.com/docs/remote-config/server]` |
| Next.js sync `cookies()`, implicit fetch cache | Next.js 16 async `cookies()`/`headers()`, opt-in caching, `proxy.ts` | Next.js 16 | Already handled in existing code; Phase-7 surfaces inherit. |

**Deprecated/outdated:**
- Do NOT consult training-data Next.js conventions — read `node_modules/next/dist/docs/` (AGENTS.md mandate) before writing any Next.js-specific code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 5 `model.{pillar}.default` keys are already provisioned in the published Remote Config template (Derek set them) | Pattern 7 / Open Q2 | If absent, `publishTemplate` must CREATE the parameter (handle create-vs-update); a read-only display would show empty/fallback values. Mitigation: the write code handles both create and update of the parameter. |
| A2 | The App Hosting service account has Remote Config *publish* permission (not just read) | Runtime State / Open Q5 | If read-only scope, Surface 6 publish fails in production. Verify the IAM role includes `firebaseremoteconfig.remoteConfig.update`. |
| A3 | A Firestore batch is sufficient for the coach-assignment dual-write (no read-gate needed) | Pattern 6 / Code Examples | If the assignment must be conditional on current state, a transaction is needed instead. Low risk — D-06 describes an unconditional set. |
| A4 | `snapshot.createTime` (Admin SDK doc metadata) is an acceptable "onboarding start" for days-to-first-close | Pitfall 4 / Open Q1 | If Derek wants an explicit editable/journey-derived start, a field addition + start-stamping is needed. This is the one open data-model question. |
| A5 | Cohort coach-read can be rule-admitted broadly (cohort name/description is not agent-PII) with the downline filter applied app-side | Pattern 3 / Open Q3 | If cohort metadata is deemed PII-adjacent, a denormalized field is needed for rule-level scoping. Per D-03 the *intent* is "cohorts containing their downline" — rule cannot express this without denorm. |

**Note:** Package names are all already-installed and verified against `node_modules`; none are `[ASSUMED]`. The assumptions above are about *runtime configuration/IAM state and one data-model gap*, which the planner should gate behind a `checkpoint:human-verify` (confirm with Derek) before the dependent surface ships.

## Open Questions

1. **What is the canonical "onboarding start" timestamp for days-to-first-close?** (Pitfall 4 / A4)
   - What we know: `AgentProfileDoc` has no `createdAt`; `lastActiveAt` is a moving value; D-22 says "agentProfiles creation / journey start."
   - What's unclear: whether to use Firestore `createTime` metadata (zero-migration), add an explicit `onboardingStartedAt` field (future agents only + backfill), or derive from the `users`/first-conversation.
   - Recommendation: default to `snapshot.createTime` for a read-time computation; flag for Derek confirmation. Add an explicit field only if he wants it editable.

2. **Are the 5 `model.{pillar}.default` Remote Config keys already published?** (A1)
   - What we know: `modelFor` falls back to `REMOTE_CONFIG_FALLBACKS` if a key is missing; production should have them.
   - What's unclear: whether all 5 exist in the live template.
   - Recommendation: the publish action handles both create and update of a parameter; the read display falls back to the labeled hints. Confirm provisioning with Derek (checkpoint).

3. **Cohort coach-read scoping — rule-level or app-level?** (A5 / Pattern 3)
   - What we know: a cohort doc has no `seniorCoachId` (membership is on the agent); D-03 wants "cohorts containing their downline."
   - What's unclear: whether broad coach-read of cohort metadata + app-side downline filter is acceptable, or whether a denormalized field is required for rule-level scoping.
   - Recommendation: admit coach read of cohort metadata at the rule level (non-PII names/descriptions), enforce the downline filter in the Server Component query. Escalate to Derek only if cohort metadata is treated as sensitive.

4. **Does the App Hosting service account have RC publish permission?** (A2)
   - Recommendation: verify before the Surface-6 wave; add a `checkpoint:human-verify` task.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| firebase-admin | all backend surfaces | ✓ | 13.10.0 | — |
| firebase-admin/remote-config | Surface 6 read/write | ✓ | (in 13.10.0) | `REMOTE_CONFIG_FALLBACKS` for reads only; no fallback for the write path |
| Firestore emulator | rules-unit-tests (RED scaffold + wave verification) | ✓ (CI job) | — | tests `describe.skip` offline — CI MUST run the emulator or read-only DENY assertions silently skip |
| next | all surfaces | ✓ | 16.2.6 | — |
| next-intl | trilingual catalogs | ✓ | ^4 | — |
| Remote Config publish IAM scope | Surface 6 write (production) | ✗ unverified | — | NONE — verify before shipping Surface 6 (Open Q4) |
| Firestore composite index build | flag coach-query + audit filters | n/a (deploy step) | — | NONE — query fails until index builds; deploy + wait before consuming wave |

**Missing dependencies with no fallback:**
- Remote Config publish IAM permission (production) — must be verified (checkpoint).
- Composite indexes must be deployed AND built before the consuming surfaces run.

**Missing dependencies with fallback:**
- Remote Config READ falls back to labeled constants; the WRITE path has no fallback (by design — it is the surface).

## Validation Architecture

> nyquist_validation is enabled (`config.json` → `workflow.nyquist_validation: true`). This section feeds 07-VALIDATION.md.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit + rules) + Playwright (e2e) + `tsc` typecheck |
| Config file | `package.json` scripts (no explicit vitest config path) |
| Quick run command | `npm run test && npm run typecheck` (offline; Firestore rules suite `describe.skip`s without the emulator) |
| Full suite command | `firebase emulators:exec --only firestore "npm run test:rules"` + `npm run test` + `npm run test:e2e` + `npm run typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COH-01 | `cohorts` deny-by-default (unauth read denied); admin write OK; new-agent write denied | rules | `firebase emulators:exec --only firestore "npm run test:rules"` | ❌ Wave 0 (extend rules.test.ts) |
| COH-01/COH-03 | read-only DENIED read+write on `cohorts` | rules | same | ❌ Wave 0 |
| COH-02 | `AgentProfileDoc` compiles with optional `cohortId`; absent on old docs is valid | unit/typecheck | `npm run typecheck` + collections type test | ❌ Wave 0 |
| FLAG-01 | `conversationFlags` deny-by-default; client create/update/delete denied (Admin-SDK only) | rules | rules emulator | ❌ Wave 0 |
| FLAG-02/FLAG-03 | coach reads own-downline flag (`seniorCoachId==uid`); cross-coach denied; admin reads all; read-only DENIED | rules | rules emulator | ❌ Wave 0 |
| PROF-02 | coach profile read writes `auditDrilldown` BEFORE returning; non-downline read denied | unit | `vitest run src/dashboard/queries.test.ts` (extend) | ✅ extend |
| ASSIGN-01 | dual-write batch sets both `agentProfiles.seniorCoachId` + `users.uplineCoachId`; non-admin → Forbidden | unit | new `coach-assignment/actions.test.ts` | ❌ Wave 0 |
| AUDIT-01 | bounded `limit(50)`; admin-only; does NOT call `auditDrilldown`; hashes not decoded | unit | new `audit-log/actions.test.ts` | ❌ Wave 0 |
| MODEL-02 | publish reads template, mutates only `model.{pillar}.default`, publishes WITHOUT force; stale ETag → conflict; non-admin → Forbidden; audit row written | unit (mock RC) | new `model-config/actions.test.ts` | ❌ Wave 0 |
| CLOSE-01 | second "record first close" call does NOT overwrite `firstCloseAt` (idempotent); coach own-downline + admin only | unit | new `record-close/actions.test.ts` | ❌ Wave 0 |
| CLOSE-02 | days-to-first-close = close − start; absent close → null/excluded; org+per-agent | unit | extend `src/dashboard/queries.test.ts` | ✅ extend |
| NAV-01 | 8 nav items appear under correct sections per role; read-only sees none of them | unit | extend `app-sidebar-nav` test | ✅ extend |
| I18N-07 | en/ms/zh key sets identical incl. all new keys | unit | `vitest run src/i18n/__tests__/i18n-parity.test.ts` | ✅ green-gate |
| Gate | No hard-coded model ID; no `src/ → app/` import; no read-only grant in any new rule; no `{force:true}` publish | grep/lint guard | CI grep assertion | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test && npm run typecheck` (offline; rules skip).
- **Per wave merge:** `firebase emulators:exec --only firestore "npm run test:rules"` (the new-collection read-only DENY + coach-scope assertions only execute here) + `npm run test:e2e`.
- **Phase gate:** Full suite green (unit + rules-on-emulator + e2e + typecheck) before `/gsd-verify-work`. The pre-Phase-7 v1+Phase-6 baseline must stay green (no regression).

### Wave 0 Gaps
- [ ] Extend `src/firebase/__tests__/rules.test.ts` — add `cohorts` + `conversationFlags` to the unauth-deny loop AND per-collection matrices (4 roles incl. read-only DENY) — covers COH-01/03, FLAG-01/02/03.
- [ ] `app/[lang]/(admin)/coach-assignment/actions.test.ts` — dual-write + admin-gate (ASSIGN-01).
- [ ] `app/[lang]/(admin)/audit-log/actions.test.ts` — bounded + no-self-audit + admin-gate (AUDIT-01).
- [ ] `app/[lang]/(admin)/model-config/actions.test.ts` — mock RC; ETag/no-force/conflict/audit (MODEL-02).
- [ ] `app/[lang]/(admin)/record-close/actions.test.ts` (or wherever the close action lives) — idempotency (CLOSE-01).
- [ ] Extend `src/dashboard/queries.test.ts` — profile composer audit-before-read (PROF-02) + days-to-first-close (CLOSE-02).
- [ ] Extend `app-sidebar-nav` test — 8 new items, read-only sees none (NAV-01).
- [ ] CI grep guard — no hard-coded model ID / no `src/→app/` import / no read-only rule grant / no `{force:true}`.
- [ ] Framework install: NONE — all test infra exists.

## Security Domain

> `security_enforcement` is not `false` in config → enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Core/shell split (`src/` never imports `app/`); server-only `collections.ts`/`admin.ts`. |
| V2 Authentication | yes | `requireUser` verifies Firebase ID token; role from verified token only (auth.ts). |
| V4 Access Control | yes (PRIMARY) | `requireRole()` server gate + Firestore deny-by-default rules; read-only DENIED on every Phase-7 surface (D-24). Admin-only Server Actions assert role from verified token (T-02-31). |
| V5 Input Validation | yes | Pillar must be ∈ {coach,finder,reply,router,grader} (MODEL-02); cohort/flag fields validated server-side; model ID free-form string (no allow-list, but bounded to the 5 keys). |
| V6 Cryptography | yes | Audit hashes via Node `crypto` sha256 in `audit/log.ts` — never hand-rolled; one-way by design (D-12 hashes not decoded). |
| V7 Error Handling/Logging | yes | Audit fire-and-forget (never rethrows into hot path); NEVER log PII (CLAUDE.md). Audit-log viewer surfaces metadata only. |
| V8 Data Protection / PDPA | yes | `tenantId` on every doc; `conversationFlags` content-free (D-10); PDPA-settings static (D-18); coach drilldown audited (PROF-02). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client forges a `conversationFlags`/`cohorts` write | Tampering | `create,update,delete: if false` for flags (Admin-SDK only); admin-write for cohorts; rules-unit-tested. |
| read-only role reaches a Phase-7 surface | Elevation of Privilege | `requireRole` allow-list excludes `'read-only'`; rules omit any read-only grant; tested (Pitfall 2). |
| Concurrent model-config publish overwrites a peer's change | Tampering | ETag optimistic concurrency; publish WITHOUT `{force}` (D-16). |
| Coach reads a non-downline agent profile / flag | Information Disclosure | `where('seniorCoachId','==',uid)` app-gate + Firestore rule second-gate (AUTH-06 double-gate). |
| Coach drilldown of agent PII not logged | Repudiation | `auditDrilldown` BEFORE returning data (PROF-02). |
| Audit-of-audit recursion | (design) | Audit-log viewer does NOT self-audit (D-14); server gate is the control. |
| Spoofing role via action args | Spoofing/EoP | Role read from verified token, never from Server Action args (roles/actions.ts pattern). |
| Cross-tenant read | Information Disclosure | `sameTenant()` on every read rule; `incomingTenant()` on writes. |

## Sources

### Primary (HIGH confidence)
- Live codebase (VERIFIED via Read): `src/firebase/collections.ts`, `src/llm/provider.ts`, `src/firebase/admin.ts`, `src/firebase/auth.ts`, `src/audit/log.ts`, `src/dashboard/queries.ts`, `app/[lang]/_lib/require-role.ts`, `app/[lang]/(admin)/roles/actions.ts`, `app/[lang]/(admin)/conversations/actions.ts`, `app/[lang]/(admin)/layout.tsx`, `app/[lang]/_components/app-sidebar-nav.ts`, `firestore.rules`, `firestore.indexes.json`, `src/firebase/__tests__/rules.test.ts` + `rules-helpers.ts`, `src/i18n/__tests__/i18n-parity.test.ts`.
- `node_modules/firebase-admin/package.json` (13.10.0) + `.../remote-config/remote-config.d.ts` + `remote-config-api.d.ts` (VERIFIED API surface: `getTemplate`, `publishTemplate(template, {force?})`, `RemoteConfigTemplate.etag` readonly, `parameters[key].defaultValue`).
- `node_modules/next/package.json` (16.2.6).
- `.planning/phases/07-console-ia-v2-net-new-surfaces/07-CONTEXT.md` (27 locked decisions) + `06-CONTEXT.md` (split + locked read-only allow-list) + `06-VALIDATION.md` (Nyquist format).

### Secondary (MEDIUM confidence)
- `[CITED: firebase.google.com/docs/remote-config/server]` — `getTemplate`/`publishTemplate` and `getServerTemplate` hit the same backend Remote Config service; server-side RC supported in firebase-admin v12.1.0+.
- `[CITED: firebase.google.com/docs/remote-config/automate-rc]` — ETag usage; publish-with-latest-ETag for consistency; `validateTemplate`/`publishTemplate`.
- `[CITED: firebase.google.com/docs/remote-config/templates]` — template management flow (get → modify → validate → publish).

### Tertiary (LOW confidence)
- None — every load-bearing claim is grounded in the codebase or official Firebase docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified from installed `node_modules`; no new installs.
- Architecture/patterns: HIGH — every pattern is a copy of an existing, tested codebase pattern.
- Pitfalls: HIGH — derived from the live code (the `AgentProfileDoc` missing-createdAt gap, the read-only lock, the rules-test mandate, the index requirement are all observed facts).
- Remote Config write path: MEDIUM-HIGH — API surface VERIFIED in installed `.d.ts`; write→read coherence CITED to official docs.

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable — brownfield over a locked codebase; the only external-doc dependency is Remote Config, which is stable)
