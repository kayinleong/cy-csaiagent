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
- [ ] **CDASH-08**: Coach dashboard v2 — full funnel metrics (Phase 4)

### Admin Web App (ADMIN)

- [ ] **ADMIN-01**: Separate web app for knowledge management in plain language (no engineering involvement)
- [ ] **ADMIN-02**: Conversation log viewer
- [ ] **ADMIN-03**: Knowledge-base CRUD: create / read / update / delete documents and chunks
- [ ] **ADMIN-04**: Project inventory management — add / edit / hide projects, attach collateral
- [ ] **ADMIN-05**: Reply SOP management
- [ ] **ADMIN-06**: Feedback-loop visibility — thumbs-down responses, coach rewrites, escalation rate
- [ ] **ADMIN-07**: Role and permission controls (coach sees downline, admin sees all)
- [ ] **ADMIN-08**: Usage analytics — active agents, message volume, resolution time, escalation rate

### Cross-cutting Quality, Privacy & Ops (QUAL)

- [ ] **QUAL-01**: Model-agnostic architecture (Claude default, swappable) — provable via integration test
- [ ] **QUAL-02**: Non-API WhatsApp posture (suggested drafts only) — agent always reviews
- [ ] **QUAL-03**: PDPA-compliant data handling
- [ ] **QUAL-04**: Data residency aligned with Malaysian regulations (Firestore region selection)
- [ ] **QUAL-05**: Audit logging on all client-related conversations
- [ ] **QUAL-06**: Prompt regression suite catches tone drift, hallucinations, and language-quality regressions
- [ ] **QUAL-07**: Token-usage tracking + per-agent rate limiting
- [ ] **QUAL-08**: Performance + cost optimization pass before production rollout
- [ ] **QUAL-09**: PDPA audit + sign-off before production rollout
- [ ] **QUAL-10**: Internal documentation for D2's team (handover)

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

## Traceability

Filled by the roadmapper. Each v1 requirement maps to exactly one phase.

Phases are 1-indexed per GSD convention (research Build Order P0–P4 → Phase 1–5):
Phase 1 = Foundations · Phase 2 = Coach + Admin v1 · Phase 3 = Finder + Intent-Routing · Phase 4 = Reply Assistant + Analytics · Phase 5 = Hardening + Scale-Up.

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
| CDASH-08 | Phase 5 | Pending |
| ADMIN-01 | Phase 2 | Pending |
| ADMIN-02 | Phase 5 | Pending |
| ADMIN-03 | Phase 2 | Pending |
| ADMIN-04 | Phase 3 | Pending |
| ADMIN-05 | Phase 4 | Pending |
| ADMIN-06 | Phase 4 | Pending |
| ADMIN-07 | Phase 5 | Pending |
| ADMIN-08 | Phase 5 | Pending |
| QUAL-01 | Phase 1 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 1 | Pending |
| QUAL-04 | Phase 1 | Pending |
| QUAL-05 | Phase 1 | Pending |
| QUAL-06 | Phase 2 | Pending |
| QUAL-07 | Phase 1 | Pending |
| QUAL-08 | Phase 5 | Pending |
| QUAL-09 | Phase 5 | Pending |
| QUAL-10 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 85 enumerated REQ-IDs (FND 11, AUTH 6, CHAT 8, COACH 10, FIND 12, REPLY 12, CDASH 8, ADMIN 8, QUAL 10). (Prior header said "86 total"; the actual enumerated REQ-ID count is 85 — discrepancy noted and reconciled by the roadmapper.)
- Mapped to phases: 85 — each to exactly one phase
- Unmapped: 0 ✓
- Duplicates (a REQ in >1 phase): 0 ✓

**Per-phase totals:** Phase 1 = 19 · Phase 2 = 31 · Phase 3 = 13 · Phase 4 = 15 · Phase 5 = 7 → 85 ✓

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-05-31 — traceability finalized by roadmapper (per-REQ phase assignments)*
