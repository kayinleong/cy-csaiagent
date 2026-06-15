# Technical Specification Document (TSD)
## D2 Customer Service AI Agent Platform — `cy-csaiagent`

**Status:** Draft v1.0 · **Date:** 2026-05-31 · **Owner:** AI engineering lead + product engineering lead (2-person team)
**Source of truth for:** system architecture, data model, server-execution model, AI layer, security, and the non-negotiable constraints every phase plan must honor.
**Derived from:** `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/{STACK,ARCHITECTURE,FEATURES,PITFALLS,SUMMARY}.md`, `.planning/ROADMAP.md`.

> This document specifies HOW the system is built. WHAT it must do lives in REQUIREMENTS.md; WHEN it ships lives in ROADMAP.md. When this TSD and the research docs disagree, this TSD wins — update it deliberately and note the change in §15 Change Log.

---

## 1. Overview

D2 is a Malaysian real-estate brokerage. New agents currently wait 60 days to ramp; the goal is 7–10 days. The platform is a single mobile-first chat surface that fronts three Claude-powered specialist agents — **Onboarding Coach**, **Property Finder**, **Reply Assistant** — each grounded in D2's proprietary knowledge (PowerBoost transcripts, project inventory, reply SOPs, lead-gen playbooks). A separate admin web app lets non-engineers manage knowledge; a senior-coach dashboard surfaces downline progress, stall alerts, and knowledge gaps.

**Shape:** one Next.js 16 monolith deployed on Firebase App Hosting, with Firestore as the single system of record + vector store + cross-agent message bus. No microservices. No Cloud Functions. No external scheduler — periodic work is an on-visit lazy-cron Server Action. External API surfaces are limited to Anthropic (Claude) and Google AI Studio (Gemini embeddings, Developer API).

### 1.1 Hard Constraints (non-negotiable — see also ROADMAP §Constraints)

| # | Constraint | Consequence |
|---|-----------|-------------|
| C1 | **No Google Cloud Functions** | All server logic runs in Next.js Route Handlers / Server Actions / Server Components on App Hosting |
| C2 | **No GCP beyond the Firebase SDK surface** | Allowed: Firebase Auth, Firestore, Cloud Storage for Firebase, App Hosting, App Check, Remote Config, Analytics. Forbidden: Cloud Run (direct), Vertex AI, BigQuery, Pub/Sub, Cloud Scheduler, Cloud Functions |
| C3 | **No WhatsApp Business API in v1** | Reply Assistant is paste-and-draft only; WABA is a post-pilot graduation milestone |
| C4 | **No auto-send, ever** | Reply Assistant emits drafts; agent reviews + sends from own phone. Copy-to-clipboard only |
| C5 | **Model-agnostic** | Claude Sonnet 4.6 default behind a provider abstraction; model IDs in Firestore (`appConfig/modelConfig`), never hard-coded |
| C6 | **PDPA / Malaysian data residency** | Firestore + Storage pinned in-region; PII pseudonymized at the Claude boundary; audit log on every client-related conversation; no PII in logs |
| C7 | **Multilingual from day one** | EN / BM / 中文 affect retrieval, routing, and UI — not a late add-on |

---

## 2. Technology Stack

Versions verified against current docs/registries as of 2026-05-31. Installed = already in `package.json`.

### 2.1 Frontend (installed, locked)
- **Next.js** `16.2.6` — App Router. Note: `proxy.ts` (not `middleware.ts`); sync `cookies()`/`headers()` removed (await them); implicit data-fetch caching removed (opt in with `'use cache'` — deferred in v1 due to non-Vercel adapter parity).
- **React** `19.2.4` — required by AI SDK v5 streaming hooks.
- **UI** — shadcn `4.8.3` + `radix-ui ^1.4.3` + `@base-ui/react ^1.5.0` + Tailwind `^4`. Full component set already vendored under `components/ui/`. Charts via `recharts ^3.8`, toasts via `sonner`, command palette via `cmdk`.

### 2.2 Backend / Data plane
- **Firebase Auth** + custom claims (`role`, `tenantId`) — `firebase ^12.13` (web), `firebase-admin ^13.10` (server, Node 22+ runtime).
- **Cloud Firestore** (Native) in `asia-southeast1` — system of record. *Region is immovable once set — confirm with Derek in Phase 1 (§14 G1).*
- **Vector store** — Firestore native vector field + `findNearest` KNN (`FieldValue.vector`, ≤2048-d). **No Cloud Functions required.** Fallback: Pinecone Serverless `aws-ap-southeast-1` (swap behind the `rag/` adapter only).
- **Cloud Storage for Firebase** — bucket pinned to `asia-southeast1` (KB source files, collateral).
- **Hosting** — Firebase App Hosting (Cloud Run substrate, managed). Secrets via Secret Manager binding.

### 2.3 AI layer
- **Abstraction** — Vercel **AI SDK v5** (`ai ^5` + `@ai-sdk/anthropic ^2` + `@ai-sdk/google ^2` for embeddings) as the streaming + tool-calling surface; `@anthropic-ai/sdk ^0.100.1` as an escape hatch for features the SDK lags on. **Not** `@anthropic-ai/claude-agent-sdk`. (v5 stream method is `toUIMessageStreamResponse()`; the v4 `toDataStreamResponse()` does not exist in v5.)
- **Models** — `claude-sonnet-4-6` default (all three pillars); `claude-opus-4-7` reserved for the eval judge + manual escalation; `claude-haiku-4-5` for the intent router if/when activated. **Model IDs resolved from the Firestore `appConfig/modelConfig` doc at request time** (quick-kayinleong-017 — replaced Remote Config).
- **Embeddings** — Gemini `gemini-embedding-001` (1024-d via `outputDimensionality`, normalized, multilingual) through `@ai-sdk/google` (Gemini **Developer API**, key `GOOGLE_GENERATIVE_AI_API_KEY` — NOT Vertex AI). Standardize **1024-d across all collections**. Fallback: Pinecone Serverless / alternate embedder (decided by SPIKE-RAG).
- **Prompt caching** — Anthropic ephemeral cache, 4-segment layout (system → voice guide → SOP/KB context → tools).

### 2.4 Supporting libraries
- **Scheduled jobs** — on-visit **lazy-cron Server Action** (no external scheduler); a Firestore last-run-per-window doc gates execution.
- **i18n** — `next-intl ^4` (App-Router-native), `app/[lang]/` segment, locale detection in `proxy.ts`.
- **Validation** — Zod `^4` (also AI SDK tool `inputSchema`).
- **Evals** — Promptfoo (latest), Opus 4.7 as cross-model judge.
- **Ingestion** — `pdfjs-dist ^4` (not `pdf-parse`), `mammoth ^1` (.docx), `franc-min ^6` (language detect), `gpt-tokenizer ^2` (chunk sizing).
- **Testing** — `vitest ^2`, `@playwright/test ^1.5x`, `@firebase/rules-unit-testing` (security-rules CI).
- **Telemetry** — OpenTelemetry → Cloud Logging (auto on App Hosting); structured JSON logs, no raw PII.

---

## 3. System Architecture

### 3.1 Layout

```
cy-csaiagent/
├─ app/                         # Next.js App Router — UI + server entrypoints
│  ├─ [lang]/                   # i18n segment (en | ms | zh)
│  │  ├─ (chat)/                # agent-facing chat surface (mobile-first)
│  │  ├─ (coach)/               # senior-coach dashboard
│  │  └─ (admin)/               # admin web app (KB, inventory, SOPs, analytics)
│  ├─ api/
│  │  ├─ chat/route.ts          # SSE streaming chat endpoint (Node runtime)
│  │  ├─ kb/ingest/process/     # chunked ingestion worker endpoint
│  │  └─ (no /api/jobs/* cron routes — stall-detect / escalate / eval-nightly /
│  │      usage-rollup run as an on-visit lazy-cron Server Action in src/jobs/)
│  └─ proxy.ts                  # locale detection, auth gate (was middleware.ts)
├─ src/                         # framework-agnostic application core
│  ├─ agents/                   # one folder per pillar: prompt + tools + schema + handoff
│  │  ├─ coach/  finder/  reply/
│  ├─ router/                   # intent classifier (heuristic → LLM fallback)
│  ├─ llm/                      # model abstraction over AI SDK v5; fake provider for tests
│  ├─ memory/                   # leadContext shared doc + rolling summaries
│  ├─ rag/                      # embed, findNearest retrieval, citation building (adapter)
│  ├─ kb/                       # ingestion pipeline, chunking, versioning
│  ├─ escalation/               # stall detection, handoff bundle construction
│  ├─ audit/                    # append-only PDPA audit writer
│  ├─ ratelimit/                # per-agent token + request budgets
│  ├─ i18n/                     # message catalogs, language detection helpers
│  └─ firebase/                 # admin + client SDK init, typed converters
├─ components/ui/               # shadcn (installed)
├─ evals/                       # Promptfoo configs + trilingual gold sets
└─ .planning/                   # GSD artifacts (this TSD lives here)
```

**Rule:** `app/` may import from `src/`; `src/` must never import from `app/`. The core is portable and unit-testable without Next.

### 3.2 Component responsibilities

| Module | Responsibility | Reads | Writes |
|--------|----------------|-------|--------|
| `agents/<pillar>/` | System prompt, tool set, output schema, handoff rules per pillar. Tools are **read-only** against Firestore and authenticate **as the user**. | KB, projects, SOPs, leadContext | (via tools — none directly) |
| `router/` | Pick the pillar for a turn. Heuristic-first; LLM-classifier fallback (activated Phase 3); manual-override chip escape hatch. | conversation, message | route decision (logged) |
| `llm/` | Streaming-native abstraction over AI SDK v5. `generate({messages, tools, model})` → stream. Fake provider for deterministic tests. | Firestore `appConfig/modelConfig` (model IDs) | token-usage telemetry |
| `memory/` | `leadContext/{leadId}` shared doc with **agent-scoped write slots** + rolling summary. The cross-pillar handoff medium. | leadContext | leadContext (slot-scoped) |
| `rag/` | Embed query (Gemini `gemini-embedding-001`, 1024-d), `findNearest` retrieval with `lang`/`ownerCollection` pre-filters, citation assembly. **Adapter** — Firestore default, Pinecone fallback. | kbChunks (vector) | — |
| `kb/` | Chunked client-driven ingestion, chunk metadata, versioning/supersedes. | Storage, kbIngestionJobs | kbDocs, kbChunks |
| `escalation/` | Stall detection (cron), handoff-bundle construction, senior-coach queue. | agentProfiles, conversations | escalations |
| `audit/` | Append-only immutable audit log via `after()`. | — | auditLogs (create-only) |
| `ratelimit/` | Per-agent token + request budgets; refuse runaway conversations. | rateBudgets | rateBudgets |

### 3.3 Data flow per pillar

**Coach (Phase 2):**
`user msg → proxy auth+locale → /api/chat → router (heuristic → coach) → coach agent → rag.retrieve(onboarding KB, lang-filtered) → llm.stream(Sonnet, cached system+KB) → SSE tokens → UI`; side effects: `memory` updates journey checkpoint, `audit` writes a row via `after()`, `ratelimit` decrements budget.

**Finder (Phase 3):**
`user pastes criteria → router → finder agent → tool: searchProjects({status:'active', filters})` (deterministic Firestore query, **not** vector-only) `→ optional rag rerank rationale → tool: fetchCollateral(projectId) → llm.stream → ranked cards + "why this match"`; `memory` records per-lead criteria for re-rank.

**Reply Assistant (Phase 4):**
`user pastes WhatsApp → router → reply agent → tool: getLeadThread(leadId)` (hard server-side `leadId` ownership check) `→ rag.retrieve(reply SOPs, cite SOP-IDs) → llm.stream(voice-fingerprint few-shot) → anti-AI-tell check → draft (copy-only)`; agent edit → `editSignal` captured for SOP refinement. Emits `no_sop_match` flag rather than hallucinating.

### 3.4 Server execution model (the C1/C2-forced decisions)

- **Streaming:** `/api/chat/route.ts` is a **Node-runtime Route Handler** returning `streamText().toDataStreamResponse()`. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`. Server Actions are for mutations only — **never** for streaming. *(Verify end-to-end on App Hosting: SPIKE-DEPLOY.)*
- **Long-running ingestion:** two-step, chunked, client-driven. Upload to Storage → Server Action shards into `kbIngestionJobs/{jobId}` → browser polls `/api/kb/ingest/process?limit=N` until `remaining:0`. Idempotent (sha256 file hash), resumable. Never embed a large PDF in one request or inside `after()` (Cloud Run request-timeout trap). *(SPIKE-INGEST confirms chunk budget.)*
- **Scheduled jobs:** **on-visit lazy-cron Server Action** (decision override — replaces QStash). When an authorized user loads the app, a Server Action runs any DUE jobs (stall-detect, escalate, eval-nightly, usage-rollup) via the Admin SDK, gated by a Firestore `jobRuns`/heartbeat last-run-per-window doc so each job fires at most once per window and is idempotent under concurrent visits. No QStash, no Cloud Scheduler, no Cloud Functions. **Accepted tradeoff:** not wall-clock cron — jobs fire on visit, so a truly idle period defers them; a UI watchdog surfaces a stale last-run. (SPIKE-CRON is retired; if firm wall-clock scheduling is later required, the documented escape hatch is a GitHub Actions scheduled workflow pinging a thin endpoint.)
- **Secrets:** App Hosting env + Secret Manager binding (`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). Never in client bundles, never logged.

---

## 4. Data Model (Firestore)

14 collections. Every document carries `tenantId` (single-tenant now: `"d2"`; design avoids a rewrite if D2 ever white-labels). Messages live in a **subcollection**, never an inline array (1 MB doc-size trap).

| Collection | Key fields | Notes / indexes |
|-----------|-----------|-----------------|
| `users/{uid}` | `role`, `tenantId`, `uplineCoachId`, `lang`, `voiceSamples[]` | mirrors Auth custom claims; voice samples captured at onboarding |
| `agentProfiles/{uid}` | `journeyStage`, `currentCheckpoint`, `lastActiveAt`, `activeLeadIds[]`, `seniorCoachId` | drives stall detection; index `lastActiveAt` |
| `conversations/{cid}` | `ownerUid`, `pillar`, `leadId?`, `lang`, `createdAt`, `summary` | index `(ownerUid, createdAt)` |
| `conversations/{cid}/messages/{mid}` | `role`, `content`, `citations[]`, `routeDecision`, `tokens`, `redacted` | subcollection — unbounded-safe |
| `leads/{leadId}` | `ownerUid`, `name(pseudonymized)`, `phoneHash`, `consentFlag`, `nationality`, `segment` | per-agent lead registry |
| `leadContext/{leadId}` | `coachSlot`, `finderSlot`, `replySlot`, `rollingSummary`, `updatedAt` | **shared cross-pillar memory**; agent-scoped write slots |
| `projects/{pid}` | `name`, `status:'active'|'sold_out'|'hidden'`, `priceBand`, `tenure`, `vpStatus`, `bumiQuota`, `foreignEligible`, `embedding(1024)` | Finder source; index `status`, `priceBand`; vector field |
| `collateral/{coid}` | `projectId`, `type`, `storagePath`, `lang` | linked marketing assets |
| `kbDocs/{docId}` | `title`, `sourcePath`, `version`, `supersedesId?`, `lang`, `pillar`, `publishedAt` | versioned; only `published` chunks retrievable |
| `kbChunks/{chunkId}` | `docId`, `text`, `lang`, `ownerCollection`, `embedding(1024)`, `tokens` | vector field; pre-filter `(lang, ownerCollection)`; `findNearest` DOT_PRODUCT |
| `kbIngestionJobs/{jobId}` | `fileHash`, `total`, `remaining`, `status` | drives chunked ingestion loop |
| `escalations/{eid}` | `agentUid`, `seniorCoachId`, `reason`, `contextBundle`, `status`, `openedAt` | coach queue; index `(seniorCoachId, status)` |
| `auditLogs/{alid}` | `actorUid`, `action`, `targetRef`, `hashes{}`, `ts` | **append-only, immutable** (create-only rule); 12-mo TTL |
| `evals/{runId}` | `suite`, `lang`, `score`, `judgeModel`, `failures[]` | nightly cron writes; dashboard reads |

**Vector specifics:** embeddings normalized → `findNearest(DOT_PRODUCT, limit≈8)`; query pre-filtered `where('lang','in',[userLang,'en'])` with cross-lingual fallback. One language-tagged KB collection (not three) — Gemini multilingual embeddings cluster cross-language.

---

## 5. Security & Authorization

### 5.1 Roles (Firebase Auth custom claims)
- `new-agent` — own conversations/leads only.
- `senior-coach` — own profile + **downline** (agents whose `uplineCoachId == coach.uid`); read-only conversation drilldown (audit-logged).
- `admin` — full tenant access (KB, inventory, SOPs, analytics).

Claims set server-side via Admin SDK; refreshed on role change. `tenantId` claim on every user.

### 5.2 Security Rules posture
- **Deny by default.** No `if request.auth != null` blanket allows (the Sept-2025 mass-leak pattern).
- Every read/write checks ownership (`resource.data.ownerUid == request.auth.uid`) or a defined role + `tenantId` match.
- Coach downline access resolved via `uplineCoachId` lookup.
- `auditLogs` — create-only, no update/delete from any client.
- **CI gate:** `@firebase/rules-unit-testing` covers every collection on every PR; quarterly emulator pen-test.

```
// illustrative — agentProfiles
match /agentProfiles/{uid} {
  allow read: if isSelf(uid)
           || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant())
           || (hasRole('admin') && sameTenant());
  allow write: if isSelf(uid) || (hasRole('admin') && sameTenant());
}
```

### 5.3 PDPA / cross-border (C6)
- **Transfer Impact Assessment** documented before any real PII flows (valid 3 yrs) — Phase 1 gate.
- **Pseudonymize at the boundary:** names → `<LEAD_ID:…>`, phones → `<PHONE_HASH>`; reconstitute client-side. A `pdpa_redacted:true` gate refuses unredacted production model calls.
- Audit log stores **hashes only**, never raw PII.
- Per-lead `consentFlag`. 12-month retention + tested erasure pipeline (<72h) in Phase 5.
- Anthropic has no Asian data residency as of 2026-05; TIA + pseudonymization is the v1 path. **Bedrock-Singapore is the documented fallback** if legal requires in-region inference (§14 G2).

---

## 6. AI / Agent Design

- **One agent per pillar**, each owning: a scoped system prompt, a read-only tool set, a Zod output schema, and explicit handoff rules. Agents never share a prompt.
- **Grounding mandate:** answers cite sources (KB chunk IDs / SOP IDs / project IDs). Coach refuses generic real-estate advice; Reply emits `no_sop_match` instead of inventing SOP content; Finder's `searchProjects` enforces `status:'active'` so sold-out units cannot be recommended.
- **Voice/tone:** per-agent voice fingerprint (10 of the agent's own anonymized replies as few-shot, captured at onboarding); explicit anti-AI-tell pattern list in the system prompt; pre-display detector flags "Certainly!"/em-dash tells; edit-distance telemetry (>40% change = flag).
- **Prompt caching:** cache system + voice guide + retrieved context + tool defs as ephemeral segments to cut cost/latency on multi-turn threads.
- **Model swap:** `llm/` resolves the model ID from the Firestore `appConfig/modelConfig` doc; an integration test proves the same chat call succeeds on a second provider (QUAL-01).

---

## 7. Internationalization (C7)

- `next-intl ^4`, `app/[lang]/` segment, locale detected in `proxy.ts` (Accept-Language → user preference override).
- **Per-message** language detection (`franc-min`) — agents code-switch BM/EN/中文 mid-thread.
- KB content translated into all three languages with **native review** (not raw MT) and indexed per-language; retrieval pre-filters by language with cross-lingual fallback.
- Eval gold sets are **trilingual and scored independently** — English-only evals hide BM/Mandarin regressions.

---

## 8. Evaluation & Quality

- **Promptfoo** suites per pillar; Opus 4.7 as cross-model judge (mitigates self-preference bias).
- Gold sets: trilingual, seeded in Phase 1 (small), grown from real pilot conversations. Human calibration: Derek + a coach, target >85% judge-human agreement.
- Runs: pre-merge (changed-prompt suites in CI) + full regression via the lazy-cron Server Action (eval-nightly job, runs at most once per day on first visit) → `evals/{runId}`.
- Catch: hallucination (sold-out projects, fabricated SOPs), tone drift, multilingual quality cliff, citation integrity.

---

## 9. Observability, Cost & Rate-Limiting

- Structured JSON logs (no PII) → Cloud Logging via OTel (auto on App Hosting).
- **Token-usage telemetry** per agent/pillar written on each `llm` call; Phase 5 cost dashboard aggregates spend + per-collection read/write.
- **Rate limiting** (`ratelimit/`): per-agent request + token budgets; a runaway conversation is refused, not allowed to burn the monthly budget.
- **Last-run heartbeats** + UI watchdog banner so a long idle gap (no visits → lazy-cron never fired) is surfaced rather than silently breaking stall detection.

---

## 10. Deployment

- **Firebase App Hosting**, region `asia-southeast1`, `minInstances=1` (cold-start mitigation for streaming).
- Secrets via Secret Manager binding.
- CI: lint (incl. Next.js-16 anti-pattern rules — `proxy.ts`, async `cookies()`, no implicit cache assumptions), `vitest`, security-rules tests, Playwright smoke, Promptfoo changed-suites.
- Rollback: App Hosting revisions; Firestore rules versioned in repo.

---

## 11. Phase → Spec Mapping

| Phase | TSD sections that must be realized | Spikes / gates |
|-------|-----------------------------------|----------------|
| 1 Foundations | §3 (layout, exec model), §4 (schema), §5 (rules + TIA), §6 (`llm/` + fake), §7 scaffold, §8 harness, §9 ratelimit | SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON; TIA on file |
| 2 Coach + Admin v1 | §3.3 Coach flow, §4 (agentProfiles/conversations/kb*), §6 Coach agent, admin KB CRUD, coach dashboard v1 | week-4 go/no-go memo before Phase 3 |
| 3 Finder + Routing | §3.3 Finder flow, `router/` LLM activation, §4 projects/collateral, bumi/foreign filters | — |
| 4 Reply + Analytics | §3.3 Reply flow, §6 voice fingerprint, §4 leadContext/editSignal, reply dashboard | — |
| 5 Hardening | §5.3 erasure, §9 cost dashboard, perf pass, dashboard v2, load test ~400 | PDPA sign-off |

---

## 12. Testing Strategy

- **Unit** (`vitest`): `src/` core in isolation using the `llm/` fake provider; pure functions (chunking, redaction, route heuristics).
- **Rules** (`@firebase/rules-unit-testing`): every collection, every role, in CI — deny-by-default proven.
- **Integration**: model-swap proof (QUAL-01); ingestion idempotency/resume; cron signature verification.
- **E2E** (`@playwright/test`): sign-in → stream → persist; admin KB edit → Coach retrieval; handoff bundle.
- **Eval** (Promptfoo): per-pillar trilingual suites, judged by Opus 4.7.

---

## 13. Risks (top 5 — full set in PITFALLS.md)

| Risk | Mitigation | Phase |
|------|-----------|-------|
| PII to Claude violates PDPA cross-border | TIA + boundary pseudonymization + `pdpa_redacted` gate | 1 |
| Firestore Rules cross-tenant/agent leak | Deny-by-default + CI rules tests + quarterly pen-test | 1 (re-audited each phase) |
| Tone drift → drafts read as AI | Voice fingerprint + anti-tell detector + "sounds like D2" rubric | foundation P1, build P4 |
| Multilingual quality cliff (BM/中文) | Verified multilingual embeddings + native-reviewed translations + trilingual evals | 1, enforced 2–4 |
| Streaming silently fails on App Hosting | SPIKE-DEPLOY on real mobile network + non-streaming fallback ready | 1 |

---

## 14. Open Questions / Gaps (resolve in Phase 1 with Derek)

- **G1 — Firestore region:** `asia-southeast1` (Singapore) vs `asia-southeast2` (Jakarta). Immovable once set. Default: `asia-southeast1`. **Confirm before any Firebase resource is created.**
- **G2 — Anthropic Asian residency:** direct API has none (2026-05). v1 = TIA + pseudonymization; Bedrock-Singapore is the fallback if legal requires in-region inference. Log decision in PROJECT.md Key Decisions.
- **G3 — Embedding model BM/Mandarin quality:** verified in SPIKE-RAG with a Malaysian test set; Mesolitica/Cohere fallback.
- **G4 — Project inventory source format:** how D2's existing inventory exports (CSV? Sheet? Drive docs?) — shapes the Phase 3 ingestion adapter.
- **G5 — Voice-sample capture consent:** anonymization + consent flow for using agents' own historical replies as few-shot.

---

## 15. Change Log

| Date | Change | By |
|------|--------|-----|
| 2026-05-31 | Initial TSD v1.0 synthesized from research + roadmap | new-project workflow |

---
*This TSD is a living document. Update it at phase transitions when architecture decisions are made or revised, and record the change above.*
