# Requirements: D2 Customer Service AI Agent Platform

**Defined:** 2026-05-31
**Core Value:** Compress new-agent ramp-up from 60 days to 7–10 days via a D2-grounded multi-pillar AI chat surface.

## v1 Requirements

Requirements for the initial release covering the three pillars + admin + senior-coach dashboard, scoped to the 16-week impl plan.

### Foundations (cross-cutting, no UI of its own)

- [ ] **FND-01**: Next.js 16 app deployed on Firebase Hosting / App Hosting with Firebase Auth, Firestore, Cloud Storage wired up
- [ ] **FND-02**: Model abstraction layer wraps Claude (default) with a swappable interface so OpenAI / Gemini can be plugged in
- [ ] **FND-03**: RAG pipeline scaffold — embedding generation, vector store, retrieval interface
- [ ] **FND-04**: Agent profile schema (which agent, which senior coach, training stage, active leads)
- [ ] **FND-05**: Shared memory layer that all three specialist agents read/write from
- [ ] **FND-06**: Intent router stub (single-pillar mode in Phase 1; multi-pillar wired in Phase 2)
- [ ] **FND-07**: Evaluation harness — prompt regression tests + conversation quality scoring
- [ ] **FND-08**: Initial knowledge base populated from Derek's project briefs, reply SOPs, PowerBoost transcripts, lead-gen playbooks
- [ ] **FND-09**: PDPA posture: signed NDA, agreed data handling, Malaysian data residency for Firestore
- [ ] **FND-10**: Background-job mechanism without Cloud Functions (stall detection runs on a recurring schedule)
- [ ] **FND-11**: Audit logging primitive that every client-related conversation can write to

### Authentication & Roles (AUTH)

- [ ] **AUTH-01**: New agent can sign in to the chat app via Firebase Auth
- [ ] **AUTH-02**: Senior coach can sign in to the coach dashboard
- [ ] **AUTH-03**: Admin can sign in to the admin web app
- [ ] **AUTH-04**: Role-based access enforced via Firebase Auth custom claims + Firestore Security Rules (new-agent / senior-coach / admin)
- [ ] **AUTH-05**: Session persists across browser refresh and across sessions on the same device
- [ ] **AUTH-06**: Senior coaches can only see their own downline; admin sees all

### Chat Surface (CHAT)

- [ ] **CHAT-01**: Mobile-first responsive chat UI usable on a phone at 11pm
- [ ] **CHAT-02**: Persistent conversation history across sessions
- [ ] **CHAT-03**: Single chat surface routes between Coach, Finder, and Reply Assistant via the intent router
- [ ] **CHAT-04**: Streaming responses (LLM tokens stream to the UI)
- [ ] **CHAT-05**: Upfront AI disclosure — user is told they're talking to AI before first interaction
- [ ] **CHAT-06**: Inline human-handoff control ("talk to my coach") with context-pass-through
- [ ] **CHAT-07**: Conversation list / search across past threads
- [ ] **CHAT-08**: Language support: English, Bahasa Malaysia, Mandarin — auto-detect + manual override

### Pillar 1 — AI Onboarding Coach (COACH)

- [ ] **COACH-01**: Day-one pairing — Coach introduces itself, confirms senior coach assignment, kicks off PowerBoost playlist
- [ ] **COACH-02**: Coach agent answers training questions grounded in D2 onboarding KB (no generic real-estate advice)
- [ ] **COACH-03**: Onboarding journey state machine tracks each agent's current checkpoint and next step
- [ ] **COACH-04**: Proactive nudge fires when agent falls 2+ days behind on training
- [ ] **COACH-05**: Auto-escalation to senior coach after 48 hours of no agent response
- [ ] **COACH-06**: Knowledge-base miss triggers explicit handoff to senior coach with full context
- [ ] **COACH-07**: Step-by-step walkthrough of first Meta ad campaign for a specific project
- [ ] **COACH-08**: Channel-specific playbook delivery (Meta, WhatsApp, Google, iProperty, content marketing)
- [ ] **COACH-09**: Comprehension checkpoints replace passive video-watching
- [ ] **COACH-10**: Coach pilot includes 5–10 new agents in Phase 1

### Pillar 2 — AI Property Finder (FIND)

- [ ] **FIND-01**: Agent pastes lead criteria, gets ranked D2-project matches with collateral attached (posters, videos, fact sheets from Drive)
- [ ] **FIND-02**: Project inventory ingested from D2's existing data sources
- [ ] **FIND-03**: Matching engine — criteria parsing + ranked recommendations
- [ ] **FIND-04**: Each project linked to its marketing collateral
- [ ] **FIND-05**: Per-lead context — Finder remembers what the agent discussed about each lead
- [ ] **FIND-06**: Returning client context — new launches surfaced without re-typing criteria
- [ ] **FIND-07**: Filtered queries (e.g., "which projects have completed VP this year")
- [ ] **FIND-08**: Mid-conversation re-ranking when lead's budget or preferences shift
- [ ] **FIND-09**: Investment vs own-stay segmentation reflected in matches
- [ ] **FIND-10**: Financing situation factored into recommendations
- [ ] **FIND-11**: Intent router activated — Coach and Finder coexist in one chat surface
- [ ] **FIND-12**: Finder pilot expands to 15–20 agents in Phase 2

### Pillar 3 — AI Reply Assistant (REPLY)

- [ ] **REPLY-01**: Reply SOP knowledge base ingested and retrievable
- [ ] **REPLY-02**: Agent pastes incoming WhatsApp message, gets a draft grounded in D2 SOPs
- [ ] **REPLY-03**: Per-lead thread context persisted across parallel conversations
- [ ] **REPLY-04**: Draft generation with explicit "edit before sending" UX — drafts are never auto-sent
- [ ] **REPLY-05**: Cold-prospect reply uses qualifying-questions framework, not a pitch
- [ ] **REPLY-06**: Objection-handling drafts (price, competitor comparison, timing)
- [ ] **REPLY-07**: Loan / financing questions answered using D2's financing SOP
- [ ] **REPLY-08**: Tone calibration against historical D2 conversations (anonymized samples)
- [ ] **REPLY-09**: Edit-feedback capture — agent edits feed back as signals to refine SOPs
- [ ] **REPLY-10**: Reply Assistant added to intent router — all three pillars active in one chat
- [ ] **REPLY-11**: Reply quality analytics dashboard
- [ ] **REPLY-12**: WhatsApp Business API graduation criteria defined (gate criteria, not implementation)

### Senior-Coach Dashboard (COACH-DASH)

- [ ] **CDASH-01**: Senior coach can view their downline's onboarding stage at a glance
- [ ] **CDASH-02**: Stall alerts when a downline agent falls behind
- [ ] **CDASH-03**: View of questions agents are asking the AI (knowledge-gap signals)
- [ ] **CDASH-04**: Override mechanism — coach corrects AI in real-time; correction feeds back to KB
- [ ] **CDASH-05**: Funnel metrics: training → first lead → first close
- [ ] **CDASH-06**: Escalation alerts within working hours
- [ ] **CDASH-07**: Reporting tied to the 60-day → 7-10 day compression target
- [x] **CDASH-08**: Coach dashboard v2 — full funnel metrics (Phase 4)

### Admin Web App (ADMIN)

- [ ] **ADMIN-01**: Separate web app for knowledge management in plain language (no engineering involvement)
- [x] **ADMIN-02**: Conversation log viewer
- [ ] **ADMIN-03**: Knowledge-base CRUD: create / read / update / delete documents and chunks
- [ ] **ADMIN-04**: Project inventory management — add / edit / hide projects, attach collateral
- [ ] **ADMIN-05**: Reply SOP management
- [ ] **ADMIN-06**: Feedback-loop visibility — thumbs-down responses, coach rewrites, escalation rate
- [x] **ADMIN-07**: Role and permission controls (coach sees downline, admin sees all)
- [x] **ADMIN-08**: Usage analytics — active agents, message volume, resolution time, escalation rate

### Cross-cutting Quality, Privacy & Ops (QUAL)

- [ ] **QUAL-01**: Model-agnostic architecture (Claude default, swappable) — provable via integration test
- [ ] **QUAL-02**: Non-API WhatsApp posture (suggested drafts only) — agent always reviews
- [ ] **QUAL-03**: PDPA-compliant data handling
- [ ] **QUAL-04**: Data residency aligned with Malaysian regulations (Firestore region selection)
- [ ] **QUAL-05**: Audit logging on all client-related conversations
- [ ] **QUAL-06**: Prompt regression suite catches tone drift, hallucinations, and language-quality regressions
- [ ] **QUAL-07**: Token-usage tracking + per-agent rate limiting
- [x] **QUAL-08**: Performance + cost optimization pass before production rollout
- [x] **QUAL-09**: PDPA audit + sign-off before production rollout
- [x] **QUAL-10**: Internal documentation for D2's team (handover)

## Phase 6 Requirements — Console IA v2 (Restructure + Read-only Role)

Derived during `/gsd-plan-phase 6` (2026-06-10) from `.planning/phases/06-console-ia-v2/` (CONTEXT/RESEARCH/UI-SPEC/PATTERNS/VALIDATION). Phase 6 is a brownfield IA restructure: relocate/consolidate existing v1 surfaces under a 6-section nav, add a least-privilege read-only stakeholder role, and add a few light read-only surfaces — **no regression to any v1 feature** (the overriding success criterion). The relocated surfaces keep their existing AUTH-/ADMIN-/CDASH-/REPLY- behaviours unchanged; these NEW REQ-IDs cover only the Phase-6 net-new/relocate work.

### Navigation Information Architecture (IA)

- [ ] **IA-01**: Console navigation presents the six fixed business sections (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), role-filtered, with every existing v1 surface reachable under the correct section — regrouped OVER the existing routes (no route folder moved; hrefs unchanged); a section with zero visible items for a role renders nothing. Nav filtering is UX-only, never the authorization gate.
- [ ] **IA-02**: The latent broken KB deep-link (`/${lang}/admin/kb/...` → `/${lang}/kb/...`; route group `(admin)` never appears in the URL) is fixed at `kb-doc-list.tsx` and `kb/[docId]/page.tsx`; KB list→detail navigation no longer 404s.

### Read-only Stakeholder Role (RO)

- [ ] **RO-01**: A 4th `read-only` role exists end-to-end — added to the `Role` union + `VALID_ROLES` (`src/firebase/auth.ts`) and `AssignableRole` (`roles/actions.ts`); `setUserClaims('read-only')` succeeds via the existing sole-sanctioned claim path while unknown roles still throw `InvalidRoleError`; read-only gets no agent profile.
- [ ] **RO-02**: Read-only access is enforced **server-side** — a centralized `requireRole(allowed)` gate helper (regression-covered) plus the route-group `layout.tsx` gates redirect read-only away from every write/admin surface; read-only lands on Home (never chat/dashboard); denial is proven by tests, not nav-hiding.
- [ ] **RO-03**: Firestore rules grant read-only an `isAnalyticsReader()` read on analytics aggregates only (`usageRollups`, `usageEvents`, `evals`) + inherited signed-in-tenant KB reads (`projects`/`collateral`/`kbDocs`/`kbChunks`/`kbIngestionJobs`); read-only is DENIED read on every PII/owner-scoped collection (`conversations`/`messages`/`leads`/`leadContext`/`auditLogs`/`erasureRequests`/`rateBudgets`/`users`/`agentProfiles`/`knowledgeGaps`/`escalations`/`replyEdits`) and DENIED write everywhere — proven by the rules-unit-test matrix over a 4th synthetic read-only user.
- [ ] **RO-04**: Every analytics surface read-only may see has BOTH its page/layout gate AND its backing read path widened (the usage analytics surface renders for read-only, not empty/Forbidden); all write/admin Server Actions (`assignRole`, `resolveStall`, `submitCorrection`, KB CRUD, erasure) still return Forbidden for read-only.
- [ ] **RO-05**: Admin can assign the read-only role from the role-assignment UI (role matrix shows read-only as analytics-read only; read-only has no write/manage/conversations/erasure/assign capability); read-only cannot self-assign.

### Home Surface (HOME)

- [ ] **HOME-01**: `/${lang}` renders a per-role Home landing for console roles (read-only/senior-coach/admin) composed ONLY from existing aggregations (usageRollups — never raw usageEvents — scoped stall/knowledge-gap/funnel counts), reusing the existing stale-watchdog + em-dash empty patterns; no new lazy-cron job, no new pipeline, no write; read-only sees org usage/cost KPIs only (no PII/alerts); new-agent still redirects to chat.

### Knowledge Management (KM)

- [ ] **KM-01**: KB version-history viewer is reachable read-only — the existing `buildVersionChain` timeline (no schema change, no extra reads) renders for read-only/coach with the edit form OMITTED; admin keeps the full edit form. KB + Inventory are grouped under the Knowledge Management section.

### Senior-Coach KB Contribution (CKB)

- [ ] **CKB-01**: A senior coach can contribute to the KB scoped to their downline and audited (via the existing `assertAdminOrCoach` + `correctKbDoc`/`listDocsForReview` + audit/re-ingest pipeline), beyond today's inline-correction panel; read-only and out-of-downline targets are denied; all other KB CRUD stays admin-only.

### Analytics & Performance (AP)

- [ ] **AP-01**: Admin can pivot the read-only analytics aggregations by a chosen coach (`coachUid` → `seniorCoachId == coachUid`, gated to `role === 'admin'`, count()/select() never fetch-all, audited via `auditDrilldown`); a non-admin can never pass `coachUid` (stays scoped to own downline) — no other coach's downline can leak. Coach-dashboard + org usage are grouped under Analytics & Performance.

### System & Compliance (SC) + i18n (I18N)

- [ ] **SC-01**: A static, admin-only Integrations management shell exists under System & Compliance with NO send / connect / auto-send affordance (no Button(send/connect/enable/authorize), Switch, Input, form, or onClick), no data model, no Server Action — proven by a render-invariant test. The v1 hard constraints "No WhatsApp Business API in v1" and "No auto-send, ever" remain in force.
- [ ] **I18N-01**: All six section labels + every new Phase-6 surface string exist in en/ms/zh, and a new `i18n-parity.test.ts` (CI) asserts the three catalogs have identical key sets (no parity check existed before Phase 6).

## Phase 7 Requirements — Console IA v2 (Net-new Surfaces)

Derived during `/gsd-plan-phase 7` (2026-06-11) from `.planning/phases/07-console-ia-v2-net-new-surfaces/` (CONTEXT/RESEARCH/UI-SPEC/PATTERNS/VALIDATION). Phase 7 builds the 8 net-new surfaces deferred out of Phase 6 INTO the established 6-section IA + read-only role (neither rebuilt). Two new collections (`cohorts`, `conversationFlags`) + two optional `AgentProfileDoc` fields (`cohortId?`, `firstCloseAt?`) are the entire net-new data model; everything else composes existing data. **read-only is DENIED on every Phase-7 surface (D-24) — the Phase-6 least-privilege allow-list is preserved.** These NEW REQ-IDs map back to the 27 CONTEXT decisions (D-01..D-27) and the 5 ROADMAP Phase-7 success criteria.

### Cohort Management (COH)

- [x] **COH-01**: `cohorts/{cohortId}` is a first-class collection (converter via `makeConverter` stamping `tenantId` + numbered ref factory `cohortsRef()` = Collection 21) with fields `tenantId, name, description, createdAt, createdBy`; deny-by-default Firestore rules + a per-collection rules-unit-test ship in the SAME plan (Pitfall 6). [D-01, D-23]
- [x] **COH-02**: Cohort membership is a denormalized optional `cohortId?: string` on `AgentProfileDoc` (one cohort per agent; NOT a UID array, NOT a join collection); filtered via `where('cohortId','==',cid)`; absent on pre-Phase-7 docs (backward-compat, no backfill). [D-02]
- [x] **COH-03**: Cohort CRUD is an admin-only audited Server Action; read = admin (all) + senior-coach (cohort metadata, downline filter applied app-side); read-only DENIED. [D-03, D-24]

### Agent Profile Pages (PROF)

- [x] **PROF-01**: A read-only agent profile drill-in composes ONLY existing data (`agentProfiles/{uid}` + new `cohortId`/`firstCloseAt`, joined with that uid's `usageRollups`, `escalations`/`knowledgeGaps` counts, funnel position); NO journey-state write path anywhere (editing the journey state machine is out of scope). [D-04]
- [x] **PROF-02**: Profile access = admin (any agent) + senior-coach (own-downline only, `seniorCoachId == uid`); every coach read writes `auditDrilldown(coachUid,'agentProfiles')` BEFORE returning; read-only DENIED. [D-05, D-24]

### Coach-Assignment (ASSIGN)

- [x] **ASSIGN-01**: An admin-only audited Server Action atomically dual-writes `agentProfiles.seniorCoachId` + `users.uplineCoachId` (existing fields, no schema change) via `adminDb.batch()`. A senior-coach can NEVER reassign their own downline (admin-only, D-07). [D-06, D-07]
- [x] **ASSIGN-02**: Historical denormalized `seniorCoachId` on prior analytics rows (`replyEdits`/`knowledgeGaps`/`escalations`) is LEFT AS-IS on reassignment (documented); only future rows pick up the new coach. Backfilling historical denorm is out of scope. [D-08]

### Conversation Flagged Queue (FLAG)

- [x] **FLAG-01**: `conversationFlags/{flagId}` is a first-class collection (converter + ref factory `conversationFlagsRef()` = Collection 22) storing a `conversationId` REFERENCE only (no conversation content) + a denormalized `seniorCoachId` for coach read-scope; deny-by-default rules (client create/update/delete DENIED, Admin-SDK only) + rules-unit-test in the same plan. [D-09, D-10, D-23]
- [x] **FLAG-02**: A manual flag Server Action (Admin-SDK write) lets a coach (own-downline conversation) or admin flag a conversation; it looks up + stamps the denormalized `seniorCoachId`; no AI auto-flagging in v1; audited. [D-09, D-11]
- [x] **FLAG-03**: The flagged-queue read view shows admin all open flags + senior-coach own-downline flags (bounded limit 50, status filter, composite index); rows deep-link to the EXISTING audited conversation viewer; read-only DENIED. [D-11, D-24]

### Audit-Log Viewer (AUDIT)

- [x] **AUDIT-01**: A read-only admin surface over existing `auditLogs` shows `actorUid, action, targetRef, ts` (hashes NOT decoded — sha256 one-way by design); bounded `orderBy('ts','desc').limit(50)` + cursor pagination + filter by action/actorUid/date (composite indexes); the viewer does NOT self-audit (avoids audit-of-audit recursion); admin-only; read-only DENIED. [D-12, D-13, D-14, D-24]

### Model-Config Admin UI (MODEL)

- [x] **MODEL-01**: Model-config reads the current `model.{pillar}.default` for the 5 pillars (`coach, finder, reply, router, grader`) via the existing `getServerTemplate` read path; `REMOTE_CONFIG_FALLBACKS` values are shown as hints, never a hard-coded allow-list. [D-15]
- [x] **MODEL-02**: Model-config WRITE publishes via the Admin SDK Remote Config path (`getTemplate()` → mutate only `parameters['model.{pillar}.default'].defaultValue` → `publishTemplate(template)` WITHOUT `{force:true}` — ETag optimistic concurrency, conflict surfaced never blind-overwrite); only the 5 keys editable; model IDs stay free-form strings; admin-only; every publish writes an audit row (`model_config_publish`). [D-15, D-16, D-17, D-24]

### PDPA-Settings Display (PDPA)

- [x] **PDPA-01**: A static, read-only, admin-only PDPA policy display sourced from a single policy-constants module (residency `asia-southeast1`, PII-pseudonymized-at-boundary, `usageEvents` 90d TTL, audit hashes-only, <72h erasure SLA) + a link to the existing erasure flow; zero editable knobs; widening to the read-only role is an open Derek decision, not assumed. [D-18, D-19, D-24]

### Days-to-First-Close (CLOSE)

- [x] **CLOSE-01**: A minimal close signal — optional `firstCloseAt?: Date` on `AgentProfileDoc` (NOT a full `deals` collection) — set by an audited, idempotent "record first close" Server Action invoked by senior-coach (own downline) or admin (records the FIRST close only; a second call does not overwrite). [D-20, D-21]
- [x] **CLOSE-02**: days-to-first-close = `firstCloseAt − onboarding start` (start = the `agentProfiles` doc `snapshot.createTime`, NEVER `lastActiveAt`), computed read-time in Analytics & Performance as an org/cohort aggregate (avg/median) AND per-agent on the profile page; absent close renders an em-dash; wires the real signal behind the CDASH-05 funnel stage. A full `deals` ledger is deferred. [D-22]

### Cross-cutting Nav + i18n (NAV / I18N)

- [x] **NAV-01**: 8 role-filtered nav entries are placed under the correct Phase-6 sections (Agents & Cohorts: cohorts/agentProfiles/coachAssignment; Conversations & Escalations: flags; System & Compliance: auditLog/modelConfig/pdpaSettings; Analytics & Performance: daysToFirstClose); read-only sees NONE of the 8 (nav filtering is UX-only; the `requireRole()` page gate + Firestore rules are the authorization boundary). [D-25, D-24]
- [x] **I18N-07**: Every new Phase-7 surface string + nav label exists in all three `next-intl` catalogs (en/ms/zh) with identical key sets; the existing `i18n-parity.test.ts` (Phase 6) enforces parity in CI. [D-26]

## v2 Requirements

Deferred. Acknowledged but not in current roadmap.

### WhatsApp Business API Graduation
- **WABA-01**: Direct WhatsApp Business API integration once reply quality is trusted
- **WABA-02**: Account-safety / volume monitoring

### Public Surface
- **PUB-01**: Public-facing property recommender on D2 website
- **PUB-02**: Auto-assignment of self-served prospects to available agents

### Advanced Coaching
- **COACH2-01**: Voice / audio input for coaching sessions
- **COACH2-02**: Personalized PowerBoost playlist sequencing per agent

### Scale
- **SCALE-01**: White-label / multi-tenant readiness for other brokerages
- **SCALE-02**: Native mobile apps (iOS / Android)

## Out of Scope

Explicit exclusions documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Google Cloud Functions | User-imposed constraint — all server logic in Next.js routes |
| Cloud Run / Vertex AI / BigQuery / Pub/Sub | User-imposed constraint — Firebase services only |
| Direct WhatsApp send (no human review) | Account-safety risk; reply mistakes carry highest reputational risk |
| Voice / audio input in v1 | Out of scope for 16-week MVP; text suffices for the 11pm-on-phone scenario |
| Real-time multi-agent collaboration on one thread | Single-agent ownership of each lead conversation is simpler and matches D2's workflow |
| Native mobile apps | Mobile-responsive PWA suffices; native delays shipping |
| Generic real-estate knowledge | All answers must be D2-grounded; generic content is an anti-feature |
| AI-graded only evals (no humans-in-loop) | Tone drift escapes pure-LLM eval; D2 coaches must score samples |
| Fine-tuning Claude on client conversations | PDPA / consent constraints; prompt + RAG only in v1 |
| Phase-6 net-new surfaces (cohorts +data model, agent profiles, coach-assignment UI, flagged queue, audit-log viewer, model-config UI, PDPA-settings display, days-to-first-close) | Deferred to **Phase 7** — net-new, not relocate (CONTEXT split decision 2026-06-10) |
| WhatsApp Business API integration / any auto-send | Deferred to **Phase 8** — graduation-gated; overrides v1 "no WABA / no auto-send" which stays in force through Phases 6 & 7 |

## Traceability

Filled by the roadmapper. Each v1 requirement maps to exactly one phase.

Phases are 1-indexed per GSD convention (research Build Order P0–P4 → Phase 1–5):
Phase 1 = Foundations · Phase 2 = Coach + Admin v1 · Phase 3 = Finder + Intent-Routing · Phase 4 = Reply Assistant + Analytics · Phase 5 = Hardening + Scale-Up · Phase 6 = Console IA v2 (Restructure + Read-only Role).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| FND-07 | Phase 1 | Pending |
| FND-08 | Phase 1 | Pending |
| FND-09 | Phase 1 | Pending |
| FND-10 | Phase 1 | Pending |
| FND-11 | Phase 1 | Pending |
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 1 | Pending |
| AUTH-05 | Phase 1 | Pending |
| AUTH-06 | Phase 2 | Pending |
| CHAT-01 | Phase 2 | Pending |
| CHAT-02 | Phase 2 | Pending |
| CHAT-03 | Phase 2 | Pending |
| CHAT-04 | Phase 2 | Pending |
| CHAT-05 | Phase 2 | Pending |
| CHAT-06 | Phase 2 | Pending |
| CHAT-07 | Phase 2 | Pending |
| CHAT-08 | Phase 2 | Pending |
| COACH-01 | Phase 2 | Pending |
| COACH-02 | Phase 2 | Pending |
| COACH-03 | Phase 2 | Pending |
| COACH-04 | Phase 2 | Pending |
| COACH-05 | Phase 2 | Pending |
| COACH-06 | Phase 2 | Pending |
| COACH-07 | Phase 2 | Pending |
| COACH-08 | Phase 2 | Pending |
| COACH-09 | Phase 2 | Pending |
| COACH-10 | Phase 2 | Pending |
| FIND-01 | Phase 3 | Pending |
| FIND-02 | Phase 3 | Pending |
| FIND-03 | Phase 3 | Pending |
| FIND-04 | Phase 3 | Pending |
| FIND-05 | Phase 3 | Pending |
| FIND-06 | Phase 3 | Pending |
| FIND-07 | Phase 3 | Pending |
| FIND-08 | Phase 3 | Pending |
| FIND-09 | Phase 3 | Pending |
| FIND-10 | Phase 3 | Pending |
| FIND-11 | Phase 3 | Pending |
| FIND-12 | Phase 3 | Pending |
| REPLY-01 | Phase 4 | Pending |
| REPLY-02 | Phase 4 | Pending |
| REPLY-03 | Phase 4 | Pending |
| REPLY-04 | Phase 4 | Pending |
| REPLY-05 | Phase 4 | Pending |
| REPLY-06 | Phase 4 | Pending |
| REPLY-07 | Phase 4 | Pending |
| REPLY-08 | Phase 4 | Pending |
| REPLY-09 | Phase 4 | Pending |
| REPLY-10 | Phase 4 | Pending |
| REPLY-11 | Phase 4 | Pending |
| REPLY-12 | Phase 4 | Pending |
| CDASH-01 | Phase 2 | Pending |
| CDASH-02 | Phase 2 | Pending |
| CDASH-03 | Phase 2 | Pending |
| CDASH-04 | Phase 2 | Pending |
| CDASH-05 | Phase 2 | Pending |
| CDASH-06 | Phase 2 | Pending |
| CDASH-07 | Phase 2 | Pending |
| CDASH-08 | Phase 5 | Complete |
| ADMIN-01 | Phase 2 | Pending |
| ADMIN-02 | Phase 5 | Complete |
| ADMIN-03 | Phase 2 | Pending |
| ADMIN-04 | Phase 3 | Pending |
| ADMIN-05 | Phase 4 | Pending |
| ADMIN-06 | Phase 4 | Pending |
| ADMIN-07 | Phase 5 | Complete |
| ADMIN-08 | Phase 5 | Complete |
| QUAL-01 | Phase 1 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 1 | Pending |
| QUAL-04 | Phase 1 | Pending |
| QUAL-05 | Phase 1 | Pending |
| QUAL-06 | Phase 2 | Pending |
| QUAL-07 | Phase 1 | Pending |
| QUAL-08 | Phase 5 | Complete |
| QUAL-09 | Phase 5 | Complete (code-ready; live drill + Derek sign-off live-gated) |
| QUAL-10 | Phase 5 | Complete |
| IA-01 | Phase 6 | Pending |
| IA-02 | Phase 6 | Pending |
| RO-01 | Phase 6 | Pending |
| RO-02 | Phase 6 | Pending |
| RO-03 | Phase 6 | Pending |
| RO-04 | Phase 6 | Pending |
| RO-05 | Phase 6 | Pending |
| HOME-01 | Phase 6 | Pending |
| KM-01 | Phase 6 | Pending |
| CKB-01 | Phase 6 | Pending |
| AP-01 | Phase 6 | Pending |
| SC-01 | Phase 6 | Pending |
| I18N-01 | Phase 6 | Pending |
| COH-01 | Phase 7 | Done (07-02) |
| COH-02 | Phase 7 | Pending |
| COH-03 | Phase 7 | Done (07-03) |
| PROF-01 | Phase 7 | Done (07-03) |
| PROF-02 | Phase 7 | Done (07-03) |
| ASSIGN-01 | Phase 7 | Done (07-03) |
| ASSIGN-02 | Phase 7 | Done (07-03) |
| FLAG-01 | Phase 7 | Done (07-02) |
| FLAG-02 | Phase 7 | Complete |
| FLAG-03 | Phase 7 | Complete |
| AUDIT-01 | Phase 7 | Done (07-05) |
| MODEL-01 | Phase 7 | Done (07-05) |
| MODEL-02 | Phase 7 | Done (07-05; RC-publish IAM live-gated) |
| PDPA-01 | Phase 7 | Done (07-05) |
| CLOSE-01 | Phase 7 | Done (07-03) |
| CLOSE-02 | Phase 7 | Done (07-03 per-agent + 07-06 org aggregate tile) |
| NAV-01 | Phase 7 | Done (07-06) |
| I18N-07 | Phase 7 | Done (07-06) |

**Coverage:**
- v1 requirements: 85 enumerated REQ-IDs (FND 11, AUTH 6, CHAT 8, COACH 10, FIND 12, REPLY 12, CDASH 8, ADMIN 8, QUAL 10). (Prior header said "86 total"; the actual enumerated REQ-ID count is 85 — discrepancy noted and reconciled by the roadmapper.)
- Phase 6 requirements: 13 NEW REQ-IDs (IA 2, RO 5, HOME 1, KM 1, CKB 1, AP 1, SC 1, I18N 1) — each derived during planning, each mapped to ≥1 Phase-6 plan.
- Phase 7 requirements: 18 NEW REQ-IDs (COH 3, PROF 2, ASSIGN 2, FLAG 3, AUDIT 1, MODEL 2, PDPA 1, CLOSE 2, NAV 1, I18N 1) — each derived during `/gsd-plan-phase 7`, each mapped to ≥1 Phase-7 plan and to ≥1 CONTEXT decision (D-01..D-27).
- Mapped to phases: 116 (85 v1 + 13 Phase-6 + 18 Phase-7) — each to exactly one phase
- Unmapped: 0 ✓
- Duplicates (a REQ in >1 phase): 0 ✓

**Per-phase totals:** Phase 1 = 19 · Phase 2 = 31 · Phase 3 = 13 · Phase 4 = 15 · Phase 5 = 7 · Phase 6 = 13 · Phase 7 = 18 → 116 ✓

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-06-11 — Phase 7 (Console IA v2 — Net-new Surfaces) requirements + traceability appended by planner (`/gsd-plan-phase 7`).*
