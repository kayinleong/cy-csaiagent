# Project Research Summary

**Project:** D2 Customer Service AI Agent Platform (cy-csaiagent)
**Domain:** Multi-pillar conversational AI for a Malaysian real-estate brokerage (coaching + property-matching + reply-drafting), Next.js 16 + Firebase, PDPA-regulated
**Researched:** 2026-05-31
**Confidence:** MEDIUM-HIGH

> This is the executive read. Full detail lives in `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`. This document is **decisive** — it presents the chosen approach, not a menu. Rejected alternatives get a one-line note. Everything is tagged by phase (P0 = Foundations · P1 = Coach MVP · P2 = Finder · P3 = Reply · P4 = Hardening).

---

## Executive Summary

This is a single Next.js 16 monolith on Firebase App Hosting that fronts three Claude-powered specialist agents — Onboarding Coach, Property Finder, Reply Assistant — behind one mobile-first chat surface, plus an admin web app and a senior-coach dashboard. The expert pattern for this category (Intercom Fin, Sierra, Ada, Lofty, Structurely, Gong all converge here) is: intent-routed single surface, RAG-grounded answers with citations, structured per-lead/per-agent state, explicit AI disclosure, human-handoff with context, and an eval gate that catches regressions before they ship. We build exactly that, scoped hard to a 2-engineer, 16-week envelope.

The recommended approach is **single-vendor by default**: Firestore is the system of record *and* the vector store (native `findNearest` KNN, no Cloud Functions, no Pinecone unless a spike forces it); Claude Sonnet 4.6 is the everyday model behind a Vercel AI SDK v5 abstraction (Opus 4.7 reserved for the eval judge, optional Haiku for the cheap intent router); Voyage `voyage-3-large` does multilingual embeddings; and the one unavoidable external dependency is **Upstash QStash**, which fills the scheduled-jobs gap that the no-Cloud-Functions constraint creates. Streaming is SSE from Route Handlers (never Server Actions); long-running KB ingestion is chunked and client-driven (never a single mega-request); shared cross-pillar state lives in a single `leadContext/{leadId}` document with agent-scoped write slots.

The dominant risks are not technical novelty — they are **trust and compliance**. The five highest-severity failure modes are: (1) sending real lead PII to Claude without a PDPA Transfer Impact Assessment and pseudonymization; (2) Firestore Security Rules that leak cross-agent/cross-tenant data; (3) tone drift that makes drafts read as obviously AI-generated and burns agent reputation; (4) multilingual quality cliffs where BM/Mandarin retrieval and drafts are materially worse than English; and (5) streaming silently failing on App Hosting. All five are mitigated in or before P0 (TIA + redaction layer, deny-by-default tested rules, a per-agent voice/tone artifact + eval rubric, a trilingual eval set with verified embedding recall, and a deploy spike). Three Phase 0 spikes are non-negotiable: `SPIKE-RAG`, `SPIKE-DEPLOY`, `SPIKE-CRON`.

---

## Key Findings

### Recommended Stack

The front-end shell is already done at the dependency level (Next.js 16.2.6, React 19.2.4, shadcn/Radix/Base UI, Tailwind 4 all installed). We add only the Firebase, AI, i18n, validation, eval, and ingestion layers. The chosen data plane is single-vendor Firebase in `asia-southeast1` (Singapore) for PDPA residency, with Claude via a provider abstraction so the model is swappable. The only non-Firebase backend dependency is QStash for cron. (Full table: `STACK.md` §1.)

**Chosen stack — bulleted spec with versions:**

- **Web framework:** Next.js App Router `16.2.6` (installed, locked) — note: `proxy.ts` not `middleware.ts`; no `'use cache'` in v1 (adapter parity outside Vercel still rough).
- **React:** `19.2.4` (installed, locked) — required for AI SDK v5 streaming.
- **UI:** shadcn `4.8.3` + `radix-ui ^1.4.3` + `@base-ui/react ^1.5.0` + Tailwind `^4` (all installed).
- **Hosting:** Firebase App Hosting (Cloud Run substrate) in `asia-southeast1` — region set at create-time, immovable. [P0 SPIKE]
- **Auth:** Firebase Auth + custom claims for `role` / `tenantId` — `firebase ^12.13`, `firebase-admin ^13.10` (Node 22+ runtime).
- **Database:** Cloud Firestore (Native) in `asia-southeast1` — system of record.
- **Vector store:** Firestore native vector field + `findNearest` KNN (`FieldValue.vector`, max 2048-d, no Cloud Functions). [P0 SPIKE] Fallback: Pinecone Serverless `aws-ap-southeast-1`.
- **File storage:** Cloud Storage for Firebase, bucket pinned to `asia-southeast1`.
- **LLM SDK:** `@anthropic-ai/sdk ^0.100.1` (escape hatch) under Vercel **AI SDK v5** (`ai ^5` + `@ai-sdk/anthropic ^3.0.81`) as the abstraction. NOT `@anthropic-ai/claude-agent-sdk`.
- **Models:** `claude-sonnet-4-6` default (all three pillars); `claude-opus-4-7` as eval judge / manual escalation only; `claude-haiku-4-5` for intent router if available. Model IDs live in **Firebase Remote Config**, never hard-coded.
- **Embeddings:** Voyage `voyage-3-large` (1024-d, multilingual). [BM quality verified in SPIKE-RAG] Fallback: OpenAI `text-embedding-3-large` or Mesolitica/Cohere multilingual.
- **Scheduled jobs:** **Upstash QStash** `^2` → signed HTTPS callback to Next.js Route Handler. [P0 SPIKE]
- **i18n:** `next-intl ^4` (App-Router-native), `app/[lang]/` segment, `proxy.ts` locale detection.
- **Validation:** Zod `^4` (also AI SDK v5 tool `inputSchema`).
- **Evals:** Promptfoo (latest) — Opus 4.7 as judge; cross-model judge to mitigate self-preference bias.
- **Ingestion libs:** `pdfjs-dist ^4` (NOT `pdf-parse`), `mammoth ^1`, `franc-min ^6`, `gpt-tokenizer ^2`.
- **Testing:** `vitest ^2`, `@playwright/test ^1.5x`.
- **Telemetry:** OpenTelemetry → Cloud Logging (auto on App Hosting); structured JSON logs, no raw PII.

### Expected Features (Table Stakes per Pillar)

Triangulated against five competitor families; anything violating the hard constraints is automatically an anti-feature. (Full inventory: `FEATURES.md` §3–§9.)

**Cross-cutting (foundation — all pillars):**
- Single chat surface with intent routing — one entry point is required; cheap classifier, not a separate ML model.
- Persistent conversation history + per-user threads — "pick up where I left off" at 11pm.
- Explicit AI disclosure — static banner at thread start; never per-message.
- Human-handoff to senior coach with full context bundle.
- Multilingual EN/BM/中文 with per-message (not per-session) language detection.
- PDPA-compliant audit logging on every client-related conversation.

**Pillar 1 — Onboarding Coach (P1, ships first):**
- RAG-grounded Q&A over PowerBoost + playbooks with citations — D2-specific, never generic real-estate advice.
- Onboarding journey state machine + checkpoint tracking (Firestore per-agent progress doc).
- Comprehension checkpoints as scenario-based generative practice (free-text paraphrase + LLM semantic match), not gameable quizzes.
- Proactive nudge on 2-day stall + auto-escalate at 48h no-response (depends on QStash cron).

**Pillar 2 — Property Finder (P2):**
- Paste lead criteria → ranked D2-project matches via **tool call** (`searchProjects` with `status:'active'` filter), not vector-search-only — availability is enforced, not retrieved.
- Each match carries attached collateral (poster/video/fact sheet) and a "why this match" rationale.
- Per-lead context memory; mid-conversation re-rank when criteria shift.
- Investment-vs-own-stay segmentation + financing/affordability factoring as deterministic filters before LLM rerank.

**Pillar 3 — Reply Assistant (P3, highest reputational risk):**
- Paste incoming WhatsApp → AI-drafted reply grounded in reply SOPs (cite SOP-IDs; emit `no_sop_match` flag when none apply).
- Edit-and-send loop — copy-to-clipboard only, **never auto-sent**.
- Per-lead thread context isolated by `lead_id` (hard server-side check; no cross-lead bleed).
- Tone calibrated to D2 voice (per-agent voice fingerprint + few-shot from agent's own anonymized replies); anti-AI-tell detector pre-display.

**Admin web app (P1→P4 incremental):** plain-language KB CRUD + versioning/supersedes, project-inventory CRUD, reply-SOP editor, embedding-index refresh control, RBAC.

**Senior-coach dashboard (P1→P3):** downline progress at a glance, stall alerts, read-only conversation drilldown (audit-logged), knowledge-gap signals, in-line AI correction → KB.

**Should have (differentiators):** per-agent voice fingerprint, KB regression eval-gate before publish, knowledge-gap inbox, edit-as-signal SOP refinement, "why this match" explanations, D2 lifestyle ontology.

**Defer (v1.1 / v2+):** cross-pillar shared lead memory (R&D risk per mem0/Zep), WABA integration (quality-bar gated), coach ghost-mode, top-rep pattern mining, Tamil, full automated eval gating.

### Architecture Approach

A single Next.js 16 monolith: `app/` holds UI surfaces and Route Handlers/Server Actions; `src/` holds a framework-agnostic application core (`agents/`, `router/`, `llm/`, `memory/`, `rag/`, `kb/`, `evals/`, `escalation/`, `audit/`, `ratelimit/`, `i18n/`, `firebase/`). Firestore is the system of record, the vector index, and the cross-agent message bus — no event bus, no extra services. The whole thing respects "monolith Next.js + Firebase, no microservice sprawl." (Full map: `ARCHITECTURE.md` §1–§2.)

**Major components:**
1. **`agents/<name>/`** — one specialist per pillar (Coach/Finder/Reply), each owning prompt + tools + output schema + handoff rules. Tools are read-only against Firestore and authenticate as the user.
2. **`router/`** — heuristic-first, LLM-classifier-fallback intent router with a manual-override chip escape hatch. Seam exists in P0 (Coach invoked through it from day one); LLM classifier activates in P2.
3. **`llm/`** — small, streaming-native model abstraction over AI SDK v5; fake provider for deterministic eval/tests. Cheap model for router/summary, Sonnet for user-facing.
4. **`memory/`** — `leadContext/{leadId}` shared document with agent-scoped write slots + rolling summary; Firestore is the handoff medium.
5. **`rag/` + `kb/`** — Voyage embeddings, Firestore vector search with `lang`/`ownerCollection` pre-filters, citation building; chunked client-driven ingestion.
6. **`escalation/` + `audit/`** — QStash-cron-driven stall detection; append-only immutable audit log written via `after()`.

**Background-jobs answer (the constraint's forced decision):** Scheduled work (stall detection every 6h, auto-escalate hourly, weekly digest, nightly evals) runs via **Upstash QStash → HMAC-signed HTTPS callback to `/api/jobs/*` Route Handlers**, executed as the platform service account via Admin SDK. QStash gives cron + IANA timezones (`Asia/Kuala_Lumpur`) + retries + dead-letter with zero infra. Rejected: client-driven cron (misses overnight), cron-job.org (no signing/retry), Cloud Scheduler (honor the "Firebase-SDK-surface only" boundary), Firestore-trigger tricks (require Cloud Functions). Each cron writes a heartbeat; a watchdog banner surfaces missed windows. [P0 SPIKE-CRON verifies the seam in `asia-southeast1`.]

**RAG-without-Cloud-Functions answer:** Firestore has first-class `FieldValue.vector()` + `findNearest()` KNN callable directly from the Admin/Web SDK — **no Cloud Functions needed**. Embedding generation calls Voyage's HTTPS API from a Route Handler/Server Action, writes the 1024-d vector to `kbChunks`; retrieval calls `findNearest` (DOT_PRODUCT on normalized vectors, `limit≈8`) from the same handler before the Claude call, with `where(lang IN [userLang,'en'])` pre-filter and cross-lingual fallback. One KB collection, language-tagged chunks (not three KBs) — Voyage multilingual embeddings cluster cross-language. [P0 SPIKE-RAG measures p50/p95 latency, read-cost, and BM/Mandarin recall; if p95 > 800ms or read-cost blows up, swap the `rag/` adapter to Pinecone Serverless — application state stays in Firestore.]

**Long-running ingestion answer:** Two-step, chunked, client-driven. Upload PDF to Storage → Server Action shards into `kbIngestionJobs/{jobId}` records → browser polls `/api/kb/ingest/process?limit=N` until `remaining:0` (idempotent via sha256 file hash; resumable if the tab closes). Avoids the 60s Firebase Hosting / Cloud Run request-timeout trap. Never embed a 100-page PDF in one request or inside `after()`.

### Critical Pitfalls

See "Top 5 Risks + Mitigations" below for the ranked set with chosen mitigations. (Full 36: `PITFALLS.md`.)

---

## Top 5 Risks + Mitigations

Ranked by severity × likelihood. These are the load-bearing risks; the roadmapper and planner must hold these.

1. **PII to Claude violating PDPA cross-border transfer (Pitfall 7, 32, 35 — severity HIGH).**
   Anthropic's API stores prompts ~7 days in US infrastructure; Malaysia's Cross-Border Data Transfer Guidelines (Apr 2025) require a Transfer Impact Assessment or substantially-similar-law finding. **Mitigation:** documented TIA in P0 (valid 3 years); pseudonymize at the boundary (names → `<LEAD_ID:…>`, phones → `<PHONE_HASH>`, reconstitute client-side); `pdpa_redacted:true` gate refuses unredacted production calls; audit log stores hashes only; per-lead consent flag; evaluate Bedrock-Singapore as a residency path. **Phase: P0.**

2. **Firestore Security Rules leak cross-agent / cross-tenant data (Pitfall 6 — severity HIGH).**
   Test-mode or `if request.auth != null` rules exposed ~150 top apps in the Sept 2025 disclosure. **Mitigation:** P0 ships deny-by-default rules; every read/write checks ownership or a defined role; coach access scoped to own downline via `uplineCoachId` lookup; `tenantId` on every doc from P0; `@firebase/rules-unit-testing` runs in CI covering every collection; quarterly emulator pen-test. **Phase: P0, re-audited at every boundary.**

3. **Tone drift — drafts read as obviously AI-generated (Pitfall 3, 12 — severity HIGH, reputational).**
   Stock models default to corporate-AI register ("Certainly!", em-dashes); a lead asking "are you using ChatGPT?" destroys agent trust and kills adoption. **Mitigation:** per-agent voice fingerprint (10 of the agent's own anonymized replies as few-shot, captured at onboarding in P0); explicit anti-pattern list in system prompt; pre-display anti-AI-tell detector; LLM-judge "sounds like D2" rubric; edit-distance telemetry (>40% char change = flag). **Phase: P3 build, foundation (voice samples + rubric) in P0.**

4. **Multilingual quality cliff — BM/Mandarin materially worse than English (Pitfall 4, 33 — severity HIGH).**
   English-first embeddings give weak cross-lingual recall (BM query → English SOP misses); English-only eval sets hide the regression; non-English agents stop using the product. **Mitigation:** verify multilingual embedding recall on a BM/Mandarin test set before committing (folded into SPIKE-RAG); translate SOPs/briefs into all three languages with native review (not raw MT); trilingual parallel eval set scored independently; pilot group includes a BM-primary and a Mandarin-primary agent. **Phase: P0 (embedding decision + eval scaffolding), enforced P1/P2/P3.**

5. **Streaming silently fails on Firebase App Hosting (Pitfall 23 — severity MEDIUM-HIGH, blocks the core UX).**
   App Hosting may buffer SSE so agents see "thinking…" then a 30s dump; the chat surface is the product. **Mitigation:** P0 deploy spike of a minimal streaming endpoint, tested from a real 4G mobile network (not localhost); explicit `Cache-Control: no-store`, `Content-Type: text/event-stream`, `X-Accel-Buffering: no`; documented non-streaming fallback ready before committing to streaming UX. **Phase: P0 (SPIKE-DEPLOY).**

> Runner-up risks the planner should still track: hallucinated project inventory / sold-out units (P2, tool-based `status:'active'` search), cron silently breaking (P1, heartbeat + watchdog), Firestore 1MB doc limit on inline message arrays (P0, subcollection from start), Next.js 16 implicit-caching removal spiking API cost (P0, explicit reads), and Derek-as-KB-bottleneck (P0/P1, progressive-disclosure admin UX).

---

## Phase 0 Spikes

All spike candidates consolidated from STACK (SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON, plus recommended SPIKE-AI-SDK and SPIKE-INGEST) and from PITFALLS (Next.js 16 caching behavior, PDPA cross-border). Total budget ~3 engineering days; each spike a half-day. **All resolve in P0 before P1 build starts.**

| Spike | Phase | Question to answer | Pass criterion | If it fails |
|-------|-------|--------------------|----------------|-------------|
| **SPIKE-RAG** (required) | P0 | Firestore `findNearest` latency, read-cost, and BM/Mandarin recall on ~500 multilingual chunks | p95 < 800ms; read-cost < 10× naive; BM/ZH recall ≥ 70% of EN | Swap `rag/` adapter to Pinecone Serverless `aws-ap-southeast-1`; or swap embeddings to Mesolitica/Cohere |
| **SPIKE-DEPLOY** (required) | P0 | Does SSE stream chunk-by-chunk on App Hosting `asia-southeast1` from real mobile network? Cold-start p95? Secrets injected? | Incremental tokens on 4G; cold-start acceptable with `minInstances=1`; `ANTHROPIC_API_KEY` via Secret Manager works | Non-streaming fallback with loading indicator; or Vercel front-end + Firebase backend (requires Derek sign-off on residency) |
| **SPIKE-CRON** (required) | P0 | QStash → App Hosting URL: signature verification, latency, retry on 5xx in-region | Signed callback verifies; retries behave; TZ `Asia/Kuala_Lumpur` honored | GitHub Actions scheduled workflow as backup; paid scheduler |
| **SPIKE-AI-SDK** (recommended) | P0 | AI SDK v5 `useChat`/`streamText` + typed tools work on Next.js 16 App Router; Anthropic cache_control reachable | Streaming + tool I/O typed end-to-end | Drop to `@anthropic-ai/sdk` direct for the chat route; keep AI SDK for tools/structured output |
| **SPIKE-INGEST** (recommended) | P0 | Can a Server Action / chunked-poll ingest a 100–200-page PDF inside timeout budget? | Each chunk request < 30–60s; resumable; idempotent | Confirm the chunked client-driven loop as the only pattern |
| **Next.js 16 caching audit** (PITFALLS 21/22) | P0 | Confirm implicit caching removed; `proxy.ts` not `middleware.ts`; async `cookies()/headers()`; `updateTag` Server-Action-only | CI lint rule + cost monitoring in place | — (verification, not a build risk) |
| **PDPA cross-border TIA** (PITFALLS 7) | P0 | Is a documented Transfer Impact Assessment on file before any real PII flows? | Signed TIA exists; redaction layer unit-tested | Bedrock-Singapore residency path; block pilot until resolved |

---

## Build Order

Phase boundaries derived from `ARCHITECTURE.md` §10 (hidden dependencies surfaced) and reconciled with `REQUIREMENTS.md` traceability. This is the structure the roadmapper should start from. Timeline ~16 weeks, 2 engineers.

### Phase 0 — Foundations (~3 weeks)
**Rationale:** every shared component must exist in thin form before any pillar; retrofitting audit, ratelimit, i18n scaffolding, evals, or `tenantId` mid-build is far more expensive than baking them in. The three required spikes de-risk the whole project here.
**Delivers:** Firebase wiring (Auth + custom claims, Firestore + region, Storage, deny-by-default tested rules); `llm/` + fake provider; `memory/` (`leadContext`); `audit/` append-only; `rag/` scaffold; `kb/` chunked ingestion for 1 playbook; `router/` heuristic stub picking Coach; `evals/` harness + 1 toy fixture + human-calibration plan; `ratelimit/`; chat UI shell with streaming; App Hosting pipeline + Secret Manager; QStash account + signature helper; voice-sample capture in onboarding; PDPA TIA + redaction layer; trilingual eval scaffolding.
**Maps to:** FND-01–11, AUTH-01/04/05, QUAL-01/03/04/05/07.
**Avoids:** Pitfalls 6, 7, 8, 9, 21, 22, 32, 35 (all P0).
**Exit:** logged-in user sends "hi" → Coach streams a response → message persists → audit row written; one of EN/BM/中文 surface works. **All P0 spikes resolved.**

### Phase 1 — Coach + Admin v1 (~4 weeks)
**Rationale:** Coach exercises every shared component end-to-end and carries the lowest reputational risk — the right testbed. Ship to 5–10 pilot agents.
**Delivers:** full Coach agent (prompt, tools, citations); onboarding state machine + checkpoint UI (scenario-based, not quizzes); admin KB CRUD + versioning/supersedes; senior-coach dashboard v1 (downline list, read-only drilldown); escalation (stall-detection cron via QStash + senior-coach queue + heartbeat watchdog); AI-disclosure UI + human-handoff with structured context artifact.
**Maps to:** CHAT-01–08, COACH-01–10, CDASH-01–07, ADMIN-01/03, QUAL-06.
**Avoids:** Pitfalls 11, 16, 17, 18, 19, 20, 24, 27, 28, 29, 30, 31 (P1).
**Exit:** 5–10 pilot agents use Coach daily; stalls escalate; Derek edits KB; **signed week-4 mid-build go/no-go memo committed before P2.**

### Phase 2 — Finder + Intent-Routing Activation (~3 weeks)
**Rationale:** depends on P1's proven shared components; activating the LLM classifier only makes sense once a second pillar shares the surface. Pilot expands to 15–20 agents.
**Delivers:** project inventory ingestion + embeddings; Finder agent + tools (`searchProjects` with `status:'active'`, `fetch-collateral`); **LLM classifier activated in `router/`** + 3-chip override UI; per-lead memory populated by Finder; investment-vs-own-stay + affordability + bumi/foreign deterministic filters; filtered queries; legal-topics disclaimer taxonomy.
**Maps to:** FIND-01–12, CDASH (Finder-relevant), ADMIN-04.
**Avoids:** Pitfalls 1, 13, 14, 15, 36 (all P2).
**Exit:** agent pastes lead criteria → ranked, cited matches; Coach↔Finder handoff works mid-conversation; foreign lead with sub-threshold budget gets a refusal-with-explanation.

### Phase 3 — Reply Assistant + Reply Analytics (~3 weeks)
**Rationale:** highest reputational risk; depends on P2's real lead context. Voice/tone foundation laid in P0 pays off here.
**Delivers:** reply-SOP ingestion (BM/中文 variants where edit-rate signals need); Reply agent + tools (`retrieve-sop`, `get-lead-thread`); per-lead thread isolation (hard `lead_id` check); edit-as-signal diff capture; reply-quality dashboard (edit-rate per SOP); D2-voice eval suite; pasted-message handling (emojis, voice-note markers, URLs preserved).
**Maps to:** REPLY-01–12, ADMIN-05/06.
**Avoids:** Pitfalls 2, 3, 5, 12, 25, 26 (all P3).
**Exit:** pilot agents draft ~80% of WhatsApp replies through the assistant; edit-rate measured and trending down; never auto-sent.

### Phase 4 — Hardening + Scale-Up (~3 weeks)
**Rationale:** concrete resilience deliverables before 400-agent rollout; defend against scope creep with a parking lot.
**Delivers:** full PDPA audit-log surfaces + tested erasure pipeline (<72h); cost-monitoring dashboard (token spend per agent/pillar, per-collection read/write breakdown); performance pass (RAG cache, embedding cache, P95 budget); coach-dashboard v2 (knowledge-gap signals, in-line correction → evals); BM/中文 polish; funnel metrics (60-day → 7–10-day); load-test for 400 agents.
**Maps to:** CDASH-08, ADMIN-02/07/08, QUAL-08/09/10.
**Avoids:** Pitfalls 9 (cost), 28 (eval drift), 34 (scope creep), 35 (erasure).
**Exit:** ready for full D2 rollout; hardening checklist complete (SLOs, runbooks, backup/restore, security audit, load test, cost projection validated).

### Phase Ordering Rationale
- **Dependencies force the order:** `memory/`, `audit/`, `ratelimit/`, `evals/`, i18n scaffolding, and `tenantId` must exist before any agent (ARCHITECTURE §10 "hidden dependencies"). The intent-router *seam* exists in P0 but its LLM classifier doesn't activate until P2 (a second pillar).
- **Risk gradient drives pillar sequencing:** Coach (low reputational risk, exercises everything) → Finder (medium, wrong match wastes a lead) → Reply (high, wrong reply burns reputation). PROJECT.md and FEATURES.md both lock this.
- **Multilingual and audit are NOT v2:** both are baked in from P0 because retrofitting causes index rebuilds (multilingual) or PDPA-vulnerable backfill (audit).

### Research Flags

Phases likely needing `/gsd-research-phase` during planning:
- **Phase 0:** carries all three required spikes — RAG performance, App Hosting streaming, and QStash seam are unverified in `asia-southeast1`. Deepest research need.
- **Phase 2:** Malaysian bumiputera-quota and foreign-buyer threshold rules are state-specific and change; the legal-topics taxonomy and unit-eligibility data model need a focused domain pass.
- **Phase 3:** per-agent voice fingerprinting and edit-as-signal tone calibration are the empirically hardest "sounds like D2" problem; eval rubric design needs research.

Phases with standard patterns (lighter research):
- **Phase 1:** Coach RAG Q&A, checkpoint state machine, and admin KB CRUD are well-documented patterns once P0 spikes pass. Auth/RBAC/security-rules patterns are established.
- **Phase 4:** hardening is a known checklist (SLOs, load test, cost dashboard); no novel research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | HIGH on locked/installed items, Claude tiering, Firestore schema, auth/rules, next-intl, prompt caching. MEDIUM on the three spike items (Firestore vector at scale, App Hosting streaming, QStash seam) — all in `asia-southeast1`. |
| Features | HIGH | Table-stakes converge across five competitor families. MEDIUM only on D2-specific differentiators (voice fingerprint, lifestyle ontology) and deferred cross-pillar memory (mem0/Zep landscape immature). |
| Architecture | HIGH | Next.js + Firebase plumbing and the scheduled-job recommendation are well-grounded in bundled Next.js 16 docs + Firebase docs. MEDIUM on agent-routing specifics (LLM ecosystem moves fast — validate router thresholds at build). |
| Pitfalls | MEDIUM-HIGH | HIGH on Firebase/Next.js 16 specifics (official docs) and PDPA cross-border (Hogan Lovells / pdp.gov.my). MEDIUM on multilingual quality and WhatsApp ban patterns (secondary sources). |

**Overall confidence:** MEDIUM-HIGH. The architecture and feature scope are well-understood; residual uncertainty is concentrated in the three P0 spikes and in multilingual/tone quality, all of which have named fallbacks.

### Gaps to Address

- **Firestore region final pick** (`asia-southeast1` Singapore vs `asia-southeast2` Jakarta) — STACK/ARCHITECTURE differ on which is "closest"; immovable once set. **Resolve in P0 with Derek before project creation.**
- **Anthropic Asian residency** — direct API has no Asian residency as of May 2026. TIA + pseudonymization is the v1 path; Bedrock-Singapore is the documented fallback if legal requires in-region inference. **Decide in P0, log in Key Decisions.**
- **Voyage BM/Mandarin embedding quality** — the soft spot; verified in SPIKE-RAG with a Malaysian test set, Mesolitica/Cohere as fallback.
- **Embedding dimension consistency** — ARCHITECTURE shows `kbChunks` at 1024-or-1536 and `projects` at 1536; STACK locks Voyage at 1024. **Standardize on 1024-d in P0** (fits Firestore's 2048 ceiling) and pin one model per collection.
- **Eval content, not framework** — Promptfoo is settled; the gold-set content and human-calibration (Derek + a coach, >85% judge-human agreement) is the real work. Start the trilingual gold set in P0.

## Sources

### Primary (HIGH confidence)
- Bundled Next.js 16.2.6 docs (`node_modules/next/dist/docs/01-app/`) — streaming, `after()`, internationalization, ai-agents, caching, route-handlers (version-matched).
- Anthropic platform docs — models overview, prompt caching, data residency.
- Firebase docs — Firestore vector search (2048-d ceiling, no listeners), App Hosting, custom claims & security rules, storage-size (1MB limit).
- Malaysia PDPA cross-border guidelines — Hogan Lovells, pdp.gov.my PCP 05/2024 (TIA requirements).
- npm registries for pinned versions: `firebase` 12.13, `firebase-admin` 13.10, `@anthropic-ai/sdk` 0.100.1, `ai` 5, `@ai-sdk/anthropic` 3.0.81, `next-intl` 4, `@upstash/qstash` 2.
- Multilingual Malaysian embedding (arxiv 2402.03053) — BM recall evidence.
- Foreign-buyer / bumiputera thresholds — iProperty (domain-authoritative).

### Secondary (MEDIUM confidence)
- AI SDK 5 announcement (Vercel); Firebase blog (Next.js adapters Mar 2026, App Hosting regions); Next.js "Across Platforms" blog.
- Competitor analyses: Intercom Fin, Sierra, Ada, Lofty, Structurely, Gong/Chorus guides (2026).
- Sonnet 4.6 vs Opus 4.7 comparison; Zod 4 guide; Anthropic prompt-caching guide.
- LLM-judge bias evidence (arxiv 2602.20379); RAG eval guidance (Evidently, Anyscale).

### Tertiary (LOW confidence — corroboration only)
- Third-party tutorials and field reports on App Hosting + Next.js 16 quirks (Medium, squaredtech, kalyna.pro) — used only to confirm primary-source claims.

---
*Research completed: 2026-05-31*
*Ready for roadmap: yes*
