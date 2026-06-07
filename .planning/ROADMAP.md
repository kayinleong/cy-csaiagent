# Roadmap: D2 Customer Service AI Agent Platform

## Overview

This roadmap takes the D2 platform from an empty Next.js skeleton to a production-ready, three-pillar AI agent system on Firebase, scoped to a 2-engineer / 16-week envelope. We build foundations first (every shared component in thin form, plus three de-risking spikes), then ship the lowest-risk pillar (Onboarding Coach) end-to-end to a 5–10 agent pilot, then layer in Property Finder and activate true multi-pillar intent routing, then add the highest-reputational-risk pillar (Reply Assistant), then harden for a ~400-agent rollout. The structure is dictated by hidden dependencies (shared memory, audit, eval, i18n, and `tenantId` must precede any agent) and a deliberate risk gradient (Coach → Finder → Reply). Multilingual support and PDPA audit logging are baked in from Phase 1 because retrofitting either is far more expensive than building it in.

## Roadmap-Level Constraints (every phase plan must honor)

These are hard, non-negotiable boundaries carried from PROJECT.md / config. No phase plan may drift past them:

- **No Google Cloud Functions.** All server logic lives in Next.js Route Handlers / Server Actions / Server Components on Firebase App Hosting.
- **No GCP services beyond the Firebase SDK surface.** Only Firebase Auth, Firestore, Storage, Hosting/App Hosting. (Upstash QStash is the one sanctioned external dependency, used solely to fill the scheduled-jobs gap.)
- **No WhatsApp Business API in v1.** Paste-and-draft only; WABA is a post-pilot graduation milestone gated on a reply-quality bar.
- **No auto-send.** The Reply Assistant suggests drafts; the agent always reviews and sends from their own phone. Copy-to-clipboard only.
- **Model-agnostic.** Claude (Sonnet 4.6) is the default behind a provider abstraction; model IDs live in Remote Config, never hard-coded.
- **PDPA / Malaysian data residency.** Firestore + Storage pinned in-region (`asia-southeast1` candidate); PII pseudonymized at the Claude boundary; audit log on every client-related conversation; no PII in logs.
- **Multilingual from day one.** EN / BM / 中文 affect retrieval, routing, and UI copy — not a late add-on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

(Internally these map to the research Build Order's P0–P4; here they are 1-indexed per GSD convention: Phase 1 = Foundations through Phase 5 = Hardening.)

- [x] **Phase 1: Foundations** - Shared platform core (Firebase, llm/memory/rag/audit/eval/i18n, chat shell, streaming) plus the three de-risking spikes — *complete; gates user-confirmed filled 2026-06-02*
- [x] **Phase 2: Coach + Admin v1** - Onboarding Coach end-to-end, KB CRUD admin, senior-coach dashboard v1, to a 5–10 agent pilot — *code-complete + verified (0 code gaps); go/no-go SIGNED 2026-06-02; live-stack proofs run during pilot rollout*
- [x] **Phase 3: Finder + Intent-Routing Activation** - Property Finder pillar and the LLM intent classifier; two pillars share one surface, pilot expands to 15–20 — *code-complete + verified (0 code gaps); 9/9 plans, 13/13 reqs; live finder/router evals + Playwright e2e + FIND-12 pilot provisioning are the live-gated human-action step*
- [x] **Phase 4: Reply Assistant + Reply Analytics** - Paste-and-draft WhatsApp replies in D2's voice, never auto-sent, with edit-as-signal analytics — *code-complete + verified (0 code gaps) 2026-06-05; 10/10 plans, 16/16 reqs; live index/rules deploy + kbChunks.pillar backfill + emulator rules tests + live Reply evals + browser click-through are the live-gated human-action step*
- [ ] **Phase 5: Hardening + Scale-Up** - PDPA erasure, cost/perf passes, coach dashboard v2, funnel metrics, load test for ~400 agents

## Phase Details

### Phase 1: Foundations
**Goal**: Every shared component exists in thin, working form, the three project-defining risks are spiked to resolution, and a logged-in user can send a message and get a streamed, audited, persisted Coach response.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11, AUTH-01, AUTH-04, AUTH-05, QUAL-01, QUAL-03, QUAL-04, QUAL-05, QUAL-07
**Required Spikes (Phase-1 gates — block all downstream phases until resolved):**
  - **SPIKE-RAG**: Firestore `findNearest` latency / read-cost / BM+Mandarin recall on ~500 multilingual chunks. Pass: p95 < 800ms, read-cost < 10× naive, BM/ZH recall ≥ 70% of EN. Fail → swap `rag/` adapter to Pinecone Serverless or swap embeddings.
  - **SPIKE-DEPLOY**: SSE streams chunk-by-chunk on App Hosting `asia-southeast1` from a real 4G mobile network; cold-start acceptable; secrets via Secret Manager. Fail → non-streaming fallback, or Vercel front-end + Firebase backend (needs Derek residency sign-off).
  - **SPIKE-CRON**: QStash → App Hosting signed callback verifies, retries on 5xx, honors `Asia/Kuala_Lumpur`. Fail → GitHub Actions scheduled workflow backup.
  - (Recommended, same window: SPIKE-AI-SDK, SPIKE-INGEST, Next.js 16 caching audit, PDPA cross-border TIA.)
**Success Criteria** (what must be TRUE):
  1. A user can sign in with Firebase Auth, send "hi", and watch a Coach response stream token-by-token on a phone over a real mobile network.
  2. That message persists across a browser refresh, and an append-only audit row is written for the conversation.
  3. At least one of EN / BM / 中文 works end-to-end (UI copy + retrieval) and the chosen embedding model clears the multilingual recall bar.
  4. The same chat call succeeds against a second LLM provider via the abstraction layer (model swap provable), with no PII reaching the model unredacted.
  5. All three required spikes are resolved with a documented pass/fallback decision, and a signed PDPA Transfer Impact Assessment is on file.
**Plans**: 13 plans (waves 0-6)
- [ ] 01-01-PLAN.md — G1 region sign-off with Derek + provision Firebase/App Hosting/QStash/Secret Manager
- [ ] 01-02-PLAN.md — All test/build infra (vitest/playwright/promptfoo/rules-unit-testing) + llm provider interface + deterministic fake provider + CI PII scan + Next.js-16 lint
- [ ] 01-03-PLAN.md — src/firebase init + typed 14-collection refs (tenantId source of truth) + deny-by-default firestore.rules + rules-unit-tests (3 roles)
- [ ] 01-04-PLAN.md — Auth + custom claims (3 roles) + new-agent sign-in + session persistence + Admin SDK claim script
- [ ] 01-05-PLAN.md — src/audit append-only hashes-only writer + PDPA boundary redaction + pdpa_redacted gate + TIA artifact
- [ ] 01-06-PLAN.md — i18n scaffold: proxy.ts + 3 next-intl catalogs (en/ms/zh) + app/[lang] segment + franc-min per-message detection
- [ ] 01-07-PLAN.md — src/router heuristic stub + src/memory (subcollection + leadContext slots + journey seam) + src/ratelimit real decrement
- [ ] 01-08-PLAN.md — SPIKE-RAG + SPIKE-DEPLOY (escalates to Derek) + SPIKE-CRON + SPIKE-AI-SDK + SPIKE-INGEST + apphosting.yaml
- [ ] 01-09-PLAN.md — src/rag scaffold: Voyage embed + findNearest (DOT_PRODUCT, lang pre-filter) + chunk-ID citations + Pinecone fallback seam
- [ ] 01-10-PLAN.md — src/kb chunked client-driven ingestion (idempotent sha256) + minimal authenticated CRUD form + seed one EN doc
- [ ] 01-11-PLAN.md — src/escalation interface + QStash-signed /api/jobs/stall-detect + heartbeat (no Cloud Functions)
- [ ] 01-12-PLAN.md — modelFor (Remote Config) + minimal-but-extensible Coach via router + Node SSE chat route spine + mobile-first chat shell
- [ ] 01-13-PLAN.md — Promptfoo trilingual eval + Opus judge + proof-slice E2E (sign-in→stream→persist→audit) + model-swap test (QUAL-01)
**UI hint**: yes

### Phase 2: Coach + Admin v1
**Goal**: A new agent can be coached end-to-end by a D2-grounded Coach agent — onboarding state tracked, stalls escalated, AI disclosed, handoff available — while Derek manages the knowledge base and a senior coach watches their downline. Ship to a 5–10 agent pilot.
**Depends on**: Phase 1
**Requirements**: AUTH-02, AUTH-03, AUTH-06, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, COACH-01, COACH-02, COACH-03, COACH-04, COACH-05, COACH-06, COACH-07, COACH-08, COACH-09, COACH-10, CDASH-01, CDASH-02, CDASH-03, CDASH-04, CDASH-05, CDASH-06, CDASH-07, ADMIN-01, ADMIN-03, QUAL-06
**Gate (between Phase 2 and Phase 3):** A signed week-4 mid-build go/no-go memo must be committed before Phase 3 work begins (per Impl Plan).
**Success Criteria** (what must be TRUE):
  1. A pilot agent (one of 5–10) can ask training questions and get D2-grounded, cited answers — never generic real-estate advice — on a mobile-first chat surface, in EN/BM/中文 with auto-detect.
  2. The agent sees an upfront AI disclosure, can tap "talk to my coach" to hand off with full context, and a KB miss auto-escalates to their senior coach.
  3. When an agent falls 2+ days behind, a proactive nudge fires; after 48h of no response it auto-escalates — visible as a stall alert on the senior-coach dashboard.
  4. Derek can create, edit, and version knowledge-base documents in plain language through the admin app, with no engineer involved, and the change is retrievable by the Coach.
  5. A senior coach signs in, sees only their own downline's onboarding stage and questions-being-asked, and can correct the AI inline.
**Plans**: 8 plans
Plans:
- [x] 05-01-PLAN.md — Wave-0 failing-test scaffold (erasure coverage/audit-exemption/sweep, usage capture/rollup, admin actions) + k6 load-test harness
- [x] 05-02-PLAN.md — 3 new collections (usageEvents/usageRollups/erasureRequests) + deny-by-default rules + index + rules-test 16->19 + EscalationDoc.resolvedAt
- [ ] 05-03-PLAN.md — PDPA erasure spine: PII_ERASURE_MANIFEST + eraseDataSubject (recursiveDelete, audit-exempt) + idempotent erasure-sweep lazy-cron
- [ ] 05-04-PLAN.md — ONE usage/cost pipeline: route onFinish capture (final.totalUsage) -> usage-rollup lazy-cron -> usageRollups + resolveStall.resolvedAt
- [ ] 05-05-PLAN.md — Nav + trilingual i18n foundation + PDPA erasure UI (type-to-confirm destructive flow) + admin-gated Server Action
- [ ] 05-06-PLAN.md — Admin conversation-log viewer (read-only, audited) + role/permission matrix + setUserClaims assignment
- [ ] 05-07-PLAN.md — Admin usage+cost dashboard (usageRollups) + coach dashboard v2 panels (funnel/ramp/knowledge-gap/correction-eval)
- [ ] 05-08-PLAN.md — Artifacts: PERF-COST.md, HARDENING.md, PDPA-SIGNOFF.md (Derek gate), docs/operations/ handover, TIA update
**UI hint**: yes

### Phase 3: Finder + Intent-Routing Activation
**Goal**: An agent can paste lead criteria and get ranked, collateral-attached D2-project matches, and the chat surface now genuinely routes between two pillars via an activated LLM classifier. Pilot expands to 15–20 agents.
**Depends on**: Phase 2
**Requirements**: FIND-01, FIND-02, FIND-03, FIND-04, FIND-05, FIND-06, FIND-07, FIND-08, FIND-09, FIND-10, FIND-11, FIND-12, ADMIN-04
**Success Criteria** (what must be TRUE):
  1. An agent pastes a lead's criteria and receives ranked D2-project matches, each with attached collateral (poster/video/fact sheet) and a "why this match" rationale — and only active/available projects appear.
  2. When the agent says the lead's budget or preference shifted mid-conversation, the matches re-rank without re-typing; per-lead context is remembered across messages.
  3. Investment-vs-own-stay and financing/affordability are reflected in results, and a sub-threshold or ineligible lead gets a clear refusal-with-explanation rather than a bad match.
  4. The agent can run filtered queries (e.g., "which projects have completed VP this year") and get correct, inventory-grounded answers.
  5. In one conversation the surface routes between Coach and Finder automatically (with a manual-override chip available), proving multi-pillar intent routing.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Reply Assistant + Reply Analytics
**Goal**: An agent can paste an incoming WhatsApp message and get a D2-voiced draft reply grounded in reply SOPs, edit it, and copy it to send themselves — never auto-sent — with edits captured as signals to refine the SOPs.
**Depends on**: Phase 3
**Requirements**: REPLY-01, REPLY-02, REPLY-03, REPLY-04, REPLY-05, REPLY-06, REPLY-07, REPLY-08, REPLY-09, REPLY-10, REPLY-11, REPLY-12, ADMIN-05, ADMIN-06, QUAL-02
**Success Criteria** (what must be TRUE):
  1. An agent pastes an incoming WhatsApp message and gets a draft grounded in D2 reply SOPs (cold-prospect qualifying, objection-handling, financing) that reads in D2's voice, not generic AI — and is presented with explicit "edit before sending" UX, never auto-sent.
  2. Drafts stay isolated per lead across parallel conversations (no cross-lead context bleed), and a message with no matching SOP is flagged rather than hallucinated.
  3. When the agent edits a draft, the edit is captured as a signal, and the change surfaces in a reply-quality dashboard showing edit-rate per SOP trending down.
  4. The Reply Assistant is reachable through the intent router alongside Coach and Finder — all three pillars active in one chat surface.
  5. Reply SOPs are manageable through the admin app, and the WABA graduation gate criteria are documented (criteria only, not implemented).
**Plans**: 10 plans (waves 0-6)
- [ ] 04-01-PLAN.md — Wave-0 failing-test stubs (PDPA coverage, reply agent, diff, router, rules, rag/kb pillar, route, gold sets, e2e)
- [ ] 04-02-PLAN.md — PDPA gate closure: free-text IC/email/RM-financial redaction [security blocker]
- [ ] 04-03-PLAN.md — kbChunks.pillar schema + ingest write + backfill + parameterized retrieval + composite vector index
- [ ] 04-04-PLAN.md — Router 3-pillar extension (heuristic precedence + ternary classifier)
- [ ] 04-05-PLAN.md — Reply agent core (mirror Finder) + read-only tools + ReplySlot/readReplySlot
- [ ] 04-06-PLAN.md — 3-pillar route dispatch + required-leadId fail-closed + GATE-3 lead-name injection + replySlot onFinish
- [ ] 04-07-PLAN.md — replyEdits collection + deny-by-default downline rules + indexes + editRatio util + captureReplyEdit action
- [ ] 04-08-PLAN.md — Reply draft card (copy-only) + lead selector + override chip + disclosure + all Phase-4 i18n
- [ ] 04-09-PLAN.md — Reply SOP admin pillar filter (ADMIN-05) + tone-aware judge rubric + Reply gold sets
- [ ] 04-10-PLAN.md — Reply Quality dashboard panel (REPLY-11/ADMIN-06) + WABA-GATE.md (REPLY-12)
**UI hint**: yes

### Phase 5: Hardening + Scale-Up
**Goal**: The platform is provably ready for a ~400-agent rollout — PDPA erasure works, costs and performance are understood and bounded, the coach dashboard shows full funnel/knowledge-gap signals, and the system is load-tested and documented for handover.
**Depends on**: Phase 4
**Requirements**: CDASH-08, ADMIN-02, ADMIN-07, ADMIN-08, QUAL-08, QUAL-09, QUAL-10
**Success Criteria** (what must be TRUE):
  1. An admin can run a PDPA data-erasure request and confirm the subject's data is removed within the <72h target; full audit-log surfaces are viewable.
  2. A cost/usage dashboard shows token spend and read/write breakdown per agent and per pillar, and a performance pass keeps p95 within budget under load.
  3. The senior-coach dashboard v2 shows funnel metrics tied to the 60-day → 7–10-day compression target plus knowledge-gap signals and inline-correction-to-eval feedback.
  4. A load test demonstrates the system holds for ~400 concurrent agents, and the hardening checklist (SLOs, runbooks, backup/restore, security audit, cost projection) is complete with PDPA sign-off.
  5. Internal handover documentation exists so D2's own team can operate the platform.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → [week-4 go/no-go gate] → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 0/13 | Not started | - |
| 2. Coach + Admin v1 | 0/TBD | Not started | - |
| 3. Finder + Intent-Routing | 0/TBD | Not started | - |
| 4. Reply Assistant + Analytics | 0/10 | Planned | - |
| 5. Hardening + Scale-Up | 1/8 | Executing | - |
