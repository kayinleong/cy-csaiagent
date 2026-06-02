# D2 Customer Service AI Agent Platform (cy-csaiagent)

## What This Is

A multi-pillar AI agent platform for D2, a Malaysian real-estate sales organization. New real-estate agents talk to a single mobile-first chat surface that routes between three specialist AI agents — an Onboarding Coach, a Property Finder, and a Reply Assistant — each grounded in D2's proprietary playbooks, project inventory, and reply SOPs. A separate admin web app lets non-engineers (Derek + ops) manage the knowledge base, and senior coaches get a dashboard showing their downline's training progress and knowledge gaps.

## Core Value

**Compress new-agent ramp-up from 60 days to 7–10 days** by giving every agent 24/7 access to D2-grounded coaching, project matching, and reply drafting — without enlarging the senior coach team. If only one thing must work, it's that a new agent gets a *useful, D2-specific* answer in their pocket at 11pm on a Tuesday.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. See .planning/REQUIREMENTS.md for the full REQ-ID list. -->

**Pillar 1 — AI Onboarding Coach (highest priority, ships first)**
- [ ] New agent can chat with a Coach agent grounded in D2 onboarding playbooks and PowerBoost content
- [ ] Onboarding journey state machine tracks checkpoint progress per agent
- [ ] Proactive nudges fire on stall (2+ days behind), auto-escalate to senior coach after 48h no-response
- [ ] Explicit AI disclosure + human-handoff UX
- [ ] Comprehension checkpoints (vs passive video watching)

**Pillar 2 — AI Property Finder**
- [ ] Agent pastes lead criteria, gets ranked D2-project matches with collateral attached (posters, videos, fact sheets)
- [ ] Per-lead context memory; re-ranks when criteria shift mid-conversation
- [ ] Investment vs own-stay segmentation, financing-situation factoring
- [ ] Filtered queries ("which projects have completed VP this year")

**Pillar 3 — AI Reply Assistant**
- [ ] Agent pastes incoming WhatsApp message, gets a draft grounded in D2 reply SOPs
- [ ] Per-lead thread context across parallel conversations
- [ ] Edit-feedback loop; edits become signals to refine SOPs
- [ ] Tone calibrated to D2's voice, NOT generic AI
- [ ] Drafts are suggested only — never auto-sent

**Cross-cutting**
- [ ] Single chat surface routes between all three pillars via intent router
- [ ] Persistent conversation history across sessions
- [ ] Multi-language: English, Bahasa Malaysia, Mandarin
- [ ] Senior-coach dashboard: downline progress, stall alerts, knowledge-gap signals, in-line AI correction
- [ ] Admin web app: knowledge-base CRUD in plain language, no engineering involvement
- [ ] Funnel metrics tied to the 60-day → 7-10 day target
- [ ] Model-agnostic architecture (Claude default, provider-swappable)
- [ ] PDPA-compliant data handling, Malaysian data residency, audit logging on client-related convos

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Google Cloud Functions** — explicitly excluded by user constraint; all server logic runs in Next.js routes
- **GCP services beyond Firebase SDK surface** — explicitly excluded; only Firebase Auth, Firestore, Storage, Hosting
- **Direct WhatsApp Business API integration** — v1 is paste-and-draft only; account-safety posture. WABA is a graduation milestone (post-pilot) gated on reply-quality bar
- **Auto-sending replies** — agent always reviews and sends from their own phone in v1
- **Public-facing property recommender on D2 website** — long-term, post-pilot
- **Auto-assignment of self-served prospects to available agents** — long-term, post-pilot
- **Native mobile apps** — web-first, mobile-responsive PWA suffices
- **Voice/audio input** — text-only chat surface
- **Real-time multi-user collaboration on conversations** — single-agent ownership of each thread

## Context

**Project origin.** D2 (Malaysian real estate sales) wants to compress their new-agent ramp-up time. The current bottleneck is senior-coach availability — new agents wait hours/days for answers that should be instant. Three problem areas were identified: (1) onboarding/training, (2) live lead matching against D2 inventory, (3) drafting WhatsApp replies in D2's voice. Project lead Derek is the primary product stakeholder.

**Team model.** Two-person implementation team:
- *Full-stack / AI engineering lead* — agentic architecture, model integration, RAG pipeline, knowledge base, intent router, prompt engineering, evaluations
- *Full-stack / product engineering* — chat UI, admin web app, auth, DB, deployment, analytics, integrations

**Timeline.** 16-week implementation plan (Phase 0 foundations → Phase 1 Coach MVP → Phase 2 Finder → Phase 3 Reply Assistant → Phase 4 hardening). Pilot group of 5–10 agents in Phase 1, expanding to 15–20 in Phase 2, full rollout post-Phase 4 targeting ~400 agents.

**Data source.** Derek supplies project briefs, reply SOPs, PowerBoost transcripts, lead-gen playbooks (Meta, WhatsApp, Google, iProperty, content marketing). NDA + PDPA posture agreed at kickoff.

**Pre-existing scaffold.** A Next.js 16.2.6 + React 19.2.4 + shadcn/Radix project skeleton already exists at the workspace root. Tailwind 4 + lucide-react + sonner + cmdk + recharts are installed. No Firebase wiring yet.

## Constraints

- **Tech stack**: Next.js (16.2.6 already installed) + shadcn/ui — locked
- **Backend**: Firebase services only (Auth, Firestore, Storage, Hosting). **No Cloud Functions, no other GCP services.** All server logic lives in Next.js Route Handlers / Server Actions / Server Components running on Firebase Hosting + the Next.js framework adapter
- **AI Provider**: Claude default; abstraction layer required for provider swap (model-agnostic is an explicit requirement)
- **Data residency**: Aligned with Malaysian PDPA. Firestore region selection must be reviewed (asia-southeast1 / asia-southeast2 candidates — to be confirmed in Phase 0)
- **WhatsApp posture**: Non-API in v1 (paste-and-draft, manual send). Account safety > convenience
- **Privacy**: No client PII in logs. Audit log on every client-related conversation. Anonymization required for tone-calibration training samples
- **Multilingual**: EN / BM / 中文 — affects RAG retrieval, intent routing, and UI copy from day one
- **Timeline**: 16-week MVP-to-production envelope per Impl Plan
- **Team size**: 2 engineers — architecture must respect this. No microservice sprawl. Monolith Next.js app + Firebase

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js + Firebase, no Cloud Functions | User-imposed constraint; reduces vendor surface and keeps server logic colocated in Next.js | — Pending |
| Claude as default LLM with model abstraction | Quality + provider-swap requirement explicit in requirements | — Pending |
| Three pillars behind one chat surface | Single UX entry-point reduces agent cognitive load; intent router stays simple in v1 | — Pending |
| Build Coach first, then Finder, then Reply Assistant | Coach exercises every shared component, lowest reputational risk per Impl Plan | — Pending |
| Suggested-drafts-only WhatsApp posture (no WABA in v1) | Reply mistakes carry highest reputational risk; account-safety > auto-send | — Pending |
| Web-first PWA, not native mobile | Faster shipping with one codebase; mobile-responsive suffices for 11pm-on-phone scenario | — Pending |
| Firestore + Storage region `asia-southeast1` (G1) | Region is immovable at create-time (TSD §14 G1); SG default per stack/PDPA posture | (proposed — pending Derek sign-off, see G1-REGION-SIGNOFF.md) |
| G2 Anthropic residency: direct API + TIA + boundary pseudonymization | No Anthropic Asian residency 2026-05; pseudonymize PII at the Claude boundary (01-05); Bedrock-SG is the documented fallback | (proposed — pending Derek sign-off, see G1-REGION-SIGNOFF.md) |
| Embeddings: Gemini `gemini-embedding-001` @ 1024-d (Developer API, `@ai-sdk/google`) — replaces Voyage | User directive 2026-06-01; Gemini Dev API (not Vertex) honors the no-GCP constraint; 1024-d keeps the existing vector index + the standardize-1024-d decision | Adopted 2026-06-01 (overrides Voyage) |
| Scheduling: on-visit lazy-cron Server Action — replaces Upstash QStash | User directive 2026-06-01; removes the last non-Firebase backend dependency. Tradeoff accepted: jobs fire on visit, not wall-clock; UI watchdog surfaces stale last-run | Adopted 2026-06-01 (overrides QStash; SPIKE-CRON retired) |
| D-09 nudge scheduling: **on-visit nudges** (NOT the wall-clock GitHub-Actions hatch) | User decision 2026-06-02; accept that an idle overnight defers the nudge for the pilot; measure whether it matters before adding a scheduler | Confirmed 2026-06-02 (resolves the 02-05 D-09 checkpoint) |
| Working-hours gate: Asia/Kuala_Lumpur 09:00–18:00, Mon–Fri | Default coded; bundled with D-09 for Derek to confirm exact window before pilot | Default adopted 2026-06-02 (confirm window with Derek) |
| Live Opus-judge eval calibration (Derek + a coach, >85% agreement) approved | User approved 2026-06-02; the calibration run feeds the Phase 2→3 go/no-go memo | Approved 2026-06-02 (resolves the 02-07 calibration checkpoint approach; live run after stack is up) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-31 after initialization*
