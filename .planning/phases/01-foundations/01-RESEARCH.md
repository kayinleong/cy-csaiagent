# Phase 1: Foundations - Research

**Researched:** 2026-05-31
**Domain:** Greenfield platform foundations — Next.js 16 + Firebase monolith, Claude/AI-SDK conversational core, Firestore vector RAG, QStash cron, PDPA boundary, trilingual i18n, deny-by-default security
**Confidence:** HIGH on locked stack + Next.js 16 APIs + Firebase security/vector mechanics + PDPA posture; MEDIUM on the three spike outcomes (Firestore vector p95/recall in-region, App Hosting SSE, QStash seam) and on the AI-SDK v5-vs-v6 pin decision — all have named fallbacks.

> TSD is the source of truth for HOW. Where this research and the TSD disagree, TSD wins. This document is **prescriptive within the locked decisions** — it tells the planner what to build and what NOT to hand-roll, not a menu of alternatives. Every claim is tagged `[VERIFIED]`, `[CITED]`, or `[ASSUMED]`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 .. D-12 — copy verbatim, do NOT re-litigate)

**Build shape & "thin" calibration**
- **D-01:** Build as **spine + real-but-thin cross-cutting**. One vertical slice (sign-in → stream → persist → audit) is the integration spine; everything hangs off proving it works on real infrastructure.
- **D-02:** These cross-cutting concerns are **REAL but thin from day 1** (expensive to retrofit per research): `audit/` (append-only, written via `after()`), `tenantId` on every doc, deny-by-default Firestore rules + `@firebase/rules-unit-testing` CI coverage, the `app/[lang]/` i18n segment, the `ratelimit/` interface with real decrement, and the `llm/` abstraction with a deterministic fake provider.
- **D-03:** These stay **deliberate stubs** in Phase 1: the intent router (heuristic-only, always routes to Coach; LLM classifier activates Phase 3), the eval harness (Promptfoo + Opus-judge config + ONE trilingual gold fixture + documented human-calibration plan), and voice-sample capture (reserve `users.voiceSamples[]` schema only; capture UX deferred to Phase 2 onboarding, consumed Phase 4).

**Spike sequencing & gating**
- **D-04:** Run the 3 required spikes (**SPIKE-RAG, SPIKE-DEPLOY, SPIKE-CRON**) in **week 1, in parallel** with spike-independent scaffolding (Auth + custom claims, Firestore schema, deny-by-default rules, i18n segment, `llm/` fake provider). Module implementations that hinge on a spike outcome (`rag/` adapter, chat-route deploy target, `jobs/` handler) wait for that spike's go/no-go.
- **D-05:** **Spike-failure protocol:** SPIKE-RAG fail → swap `rag/` adapter to Pinecone Serverless (app state stays in Firestore); SPIKE-CRON fail → GitHub Actions scheduled-workflow backup. Both **fork in-place and the phase continues**, with the decision logged in PROJECT.md Key Decisions. **SPIKE-DEPLOY failure escalates to Derek** — its fallback (Vercel front-end + Firebase backend) has data-residency implications that are his call, not an engineering default.
- **D-06:** Also in Phase 1 scope alongside the 3 required: **SPIKE-AI-SDK** (AI SDK v5 `useChat`/`streamText` + typed tools + Anthropic `cache_control` on Next.js 16; fallback = `@anthropic-ai/sdk` direct for the chat route), **SPIKE-INGEST** (chunked-poll loop ingests a 100–200pg PDF within timeout budget), and the **Next.js 16 caching audit** (verify implicit caching removed, `proxy.ts` not `middleware.ts`, async `cookies()/headers()`; add CI lint rule). The **PDPA TIA is a non-negotiable gate** regardless.

**Language / multilingual depth**
- **D-07:** **English is the end-to-end proof slice** (UI copy + seeded KB content + retrieval + a real streamed answer). Satisfies success-criterion #3 at lowest cost. The multilingual cliff is **not hidden** because SPIKE-RAG measures BM/中文 recall on ~500 multilingual chunks and the eval fixture is trilingual from day 1.
- **D-08:** **Full trilingual machinery is REAL in Phase 1:** all three `next-intl` catalogs (`app/[lang]`: `en|ms|zh`), `proxy.ts` locale detection, per-message `franc-min` language detection, a trilingual eval gold fixture (1 scenario × 3 languages), and a **documented native-review process** (not raw MT). Only the seeded **KB content** is proof-language (EN) for now; full trilingual KB translation + retrieval proof is Phase 2.

**Phase-1 Coach & the P1↔P2 seam**
- **D-09:** The Phase-1 Coach is **minimal-but-extensible with real grounding**: a thin scoped system prompt + ONE read-only tool (`retrieveKnowledge` → `rag.retrieve` over the seeded EN doc, lang-filtered `findNearest`) + **real citations** (KB chunk IDs) + a Zod output schema, **invoked through the heuristic router** (not called directly). It exercises the full pipe (router→agent→rag→llm→stream→persist→audit) and proves the grounding mandate. Phase 2 grows this *same* Coach — it is not throwaway.
- **D-10:** **Real-but-thin SEAMS** for four capabilities the user pulled into Phase 1 (originally P2-mapped). Present but minimal, matching the spine philosophy — full depth lands in Phase 2:
  - **Journey state machine:** tracks `agentProfiles.journeyStage` / `currentCheckpoint` (no rich checkpoint UI).
  - **Escalation:** `escalation/` interface + a QStash stall-detect job wired (uses SPIKE-CRON output); the senior-coach *receiving* side is thin.
  - **KB-miss handoff:** retrieval miss **emits a handoff signal** (full senior-coach dashboard to land it is Phase 2).
  - **KB + admin:** KB layer stays **multi-doc-capable** with a **minimal authenticated CRUD form** (NOT the full plain-language admin web app). Ingestion is *proven* on a small doc but the data model and CRUD are multi-doc-capable.
- **D-11:** **Consequence of D-10 — three roles needed thin in Phase 1**, not just `new-agent`: the seams require a **thin `senior-coach`** role (to receive a handoff/escalation) and a **thin `admin`** role (to use the KB CRUD form). All three roles must be covered by the deny-by-default rules + CI rules tests. Full sign-in surfaces and dashboards for coach/admin remain Phase 2.
- **D-12:** **Scope note:** D-10/D-11 expand Foundations by ~1 week and partially advance P2 requirements (COACH-03/04/05/06, CHAT-06, ADMIN-01/03, and minimal AUTH-02/06) **without** absorbing Phase 2. The ROADMAP structure stands as-is; the planner must account for the added seams and the ~1-week expansion.

### Claude's Discretion (research/planning defaults)
- **Firebase dev environment (G1):** Default to **emulator-first for rules/unit/integration tests, real in-region project for SPIKE-DEPLOY**. **Region confirmation with Derek is a HARD prerequisite** before any Firebase resource is created (TSD §14 G1 — immovable once set); planner must surface this as a blocking pre-task.
- **Auth role scaffolding depth:** Default to **custom claims + rules coverage + rules-unit-tests for all three; minimal sign-in only for `new-agent`** (the proof slice); coach/admin claims set via script/Admin SDK for seam testing.
- **PDPA TIA ownership + redaction depth:** Default to **team-drafted TIA + Derek sign-off** (escalate to external counsel only if Derek requires); the pseudonymization layer + `pdpa_redacted` gate are **fully implemented + unit-tested** in Phase 1 (cheap, and the gate is load-bearing) even though Phase 1 runs on synthetic data. TIA gates the *pilot*, redaction gates the *build*.

### Deferred Ideas (OUT OF SCOPE — ignore completely)
- **Full Coach depth** (rich checkpoint UI, comprehension checkpoints, channel-specific playbooks) — Phase 2 (COACH-07/08/09).
- **Senior-coach dashboard** (downline list, drilldown, knowledge-gap inbox, inline correction) — Phase 2 (CDASH-01–07); Phase 1 only emits the handoff/escalation signal a thin coach role can receive.
- **Full plain-language admin web app** — Phase 2 (ADMIN-01/03); Phase 1 ships only a minimal authenticated KB CRUD form.
- **Full trilingual KB content + retrieval proof** — Phase 2; Phase 1 seeds EN content only but keeps the machinery trilingual.
- **LLM intent classifier activation** — Phase 3; Phase 1 keeps the heuristic stub.
- **Voice-sample capture UX** — Phase 2 onboarding build; Phase 1 reserves the `voiceSamples[]` schema field only. Consumed in Phase 4.
- **"Full P2 merge" alternative** — user explicitly chose bounded "real-but-thin seams" over a full P2 merge. Revisit only at the P1→P2 boundary if foundations runs ahead.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support (which findings enable the plan) |
|----|-------------|---------------------------------------------------|
| **FND-01** | Next.js 16 app on App Hosting with Auth/Firestore/Storage wired | Standard Stack §Firebase; SPIKE-DEPLOY; `firebase`/`firebase-admin` init in `src/firebase/`; region pre-task (G1) |
| **FND-02** | Model abstraction wraps Claude, swappable | `llm/` over AI SDK; `modelFor(pillar)` resolving from Remote Config; fake provider; QUAL-01 integration test |
| **FND-03** | RAG scaffold — embed, vector store, retrieval interface | SPIKE-RAG; Firestore `findNearest` mechanics (§Code Examples); Voyage 1024-d; `rag/` adapter w/ Pinecone fallback |
| **FND-04** | Agent profile schema (agent, coach, stage, leads) | `agentProfiles/{uid}` (TSD §4); journey-stage seam (D-10) |
| **FND-05** | Shared memory layer all agents read/write | `leadContext/{leadId}` agent-scoped slots + rolling summary (TSD §4, ARCH §6) |
| **FND-06** | Intent router stub (single-pillar Phase 1) | Heuristic-only router → Coach; LLM seam present, dormant (D-03) |
| **FND-07** | Eval harness — regression + quality scoring | Promptfoo + Opus-4-7 judge + 1 trilingual fixture + calibration plan (D-03) |
| **FND-08** | Initial KB populated | Multi-doc-capable `kb/` + minimal CRUD form; seed 1 EN doc; chunked ingestion (D-10, SPIKE-INGEST) |
| **FND-09** | PDPA posture: data handling + MY residency | TIA artifact; pseudonymization + `pdpa_redacted` gate; `asia-southeast1` (G1/G2) |
| **FND-10** | Background-job mechanism w/o Cloud Functions | QStash → signed `/api/jobs/*`; SPIKE-CRON; GH Actions fallback |
| **FND-11** | Audit logging primitive | `auditLogs/` append-only, create-only rules, written via `after()`, hashes-only |
| **AUTH-01** | New agent signs in via Firebase Auth | Firebase Auth web SDK; minimal sign-in for `new-agent` |
| **AUTH-04** | RBAC via custom claims + Security Rules (3 roles) | Custom claims (`role`,`tenantId`); deny-by-default rules; rules-unit-tests for all 3 roles (D-11) |
| **AUTH-05** | Session persists across refresh/sessions | Firebase Auth persistence (default LOCAL); ID-token verify server-side |
| **QUAL-01** | Model-agnostic — provable via integration test | Same chat call on a 2nd provider through `llm/`; integration test |
| **QUAL-03** | PDPA-compliant data handling | Pseudonymize-at-boundary; audit hashes-only; consent flag schema |
| **QUAL-04** | Data residency (Firestore region) | `asia-southeast1` set at create-time; G1 pre-task with Derek |
| **QUAL-05** | Audit logging on all client-related conversations | `audit/` writes a row per conversation turn via `after()` |
| **QUAL-07** | Token-usage tracking + per-agent rate limiting | `ratelimit/` real decrement; token-usage telemetry on each `llm` call |

**Thin-seam REQs partially advanced by D-10/D-11 (not full scope, do not over-build):** COACH-03/04/05/06, CHAT-06, ADMIN-01/03, AUTH-02/06.
</phase_requirements>

## Summary

Phase 1 is a **greenfield foundations build on a stock Next.js 16.2.6 scaffold** (App Router, React 19.2.4, Tailwind 4, 55 shadcn components already vendored in `components/ui/`). There is no `src/` core, no Firebase wiring, no AI SDK, no i18n — the entire portable application core (`agents/router/llm/memory/rag/kb/escalation/audit/ratelimit/i18n/firebase`) is net-new and must follow TSD §3.1 layout exactly. The job is to stand up every shared component in thin-but-real form, resolve three de-risking spikes in week 1, and prove ONE English vertical slice end-to-end on a real phone over a real mobile network: sign-in → heuristic router → grounded Coach (real `rag.retrieve` + KB-chunk-ID citations) → SSE stream → persist to the messages subcollection → append-only audit row.

The mechanics are well-documented and the locked stack is sound: Firestore native `findNearest` KNN (no Cloud Functions), Voyage `voyage-3-large` 1024-d embeddings, the Vercel AI SDK over `@ai-sdk/anthropic` for streaming + typed tools, `next-intl ^4` on the `app/[lang]/` segment, QStash for the cron gap, and deny-by-default Firestore rules with `@firebase/rules-unit-testing` CI coverage. The dominant Phase-1 risks are **trust/compliance and infrastructure-seam uncertainty**, not novelty: PDPA cross-border transfer (TIA + boundary pseudonymization + the `pdpa_redacted` gate), Firestore Rules cross-tenant leaks (deny-by-default + CI tests), and whether SSE actually streams chunk-by-chunk on App Hosting in `asia-southeast1` (SPIKE-DEPLOY). All three required spikes have named fallbacks (Pinecone / GitHub Actions / escalate-to-Derek).

**Primary recommendation:** Treat the vertical slice as the single litmus test and build outward from it. Set the Firestore region with Derek (G1) as a hard pre-task before *any* Firebase resource exists, run the three spikes in parallel in week 1, and bake the four expensive-to-retrofit concerns (`tenantId`, append-only audit, deny-by-default rules + tests, the pseudonymization gate) in from the first commit. **One material divergence the planner must resolve:** the `ai` package has shipped **v6** (registry) while the TSD locks `ai ^5`; pin a version deliberately in SPIKE-AI-SDK (see §State of the Art and §Open Questions).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth sign-in + session persistence | Browser / Client (Firebase Auth web SDK) | Frontend Server (verify ID token in Route Handler / `proxy.ts`) | Client holds the session; the server **must** re-verify the ID token on every privileged call — never trust the client claim alone `[CITED: TSD §5, STACK §8]` |
| Role + tenant authorization | API / Route Handler (verify claims) + Database (Security Rules) | — | Defense-in-depth: claims gate the hot path, Security Rules are the hard boundary that survives a buggy handler `[CITED: TSD §5.2]` |
| LLM token streaming | API (Node-runtime Route Handler, SSE) | — | Server Actions are RPC and cannot stream incrementally; **streaming MUST be a Route Handler** `[CITED: TSD §3.4, ARCH anti-pattern 4]` |
| Intent routing (heuristic→Coach) | Core (`src/router/`) invoked by the chat Route Handler | — | Pure logic, framework-agnostic, unit-testable; the Route Handler is a thin orchestrator `[CITED: ARCH anti-pattern 2]` |
| RAG embed + retrieval | API (Route Handler calls Voyage HTTPS + Firestore `findNearest`) | Database (Firestore vector index) | No Cloud Functions: embedding + KNN run inline in the same handler before the Claude call `[VERIFIED: Firebase vector-search docs]` |
| KB ingestion (large docs) | Browser-driven chunk loop → API (`/api/kb/ingest/process`) | Storage + Database | Chunked + client-driven avoids the Cloud Run request-timeout trap; never one mega-request `[CITED: TSD §3.4, ARCH §3.2]` |
| Scheduled jobs (stall-detect) | External (QStash) → API (signed `/api/jobs/*`) | Database | The no-Cloud-Functions constraint forces an external HTTP scheduler; runs as service account `[CITED: TSD §3.4]` |
| Audit log write | API via `after()` → Database (append-only) | — | Fire-and-forget so it never blocks the response; create-only rule makes it immutable `[CITED: TSD §5.2, ARCH pattern 3]` |
| PII pseudonymization | Core (`src/audit/pdpa.ts`) at the Claude boundary | — | Must run before the prompt leaves the server; `pdpa_redacted:true` gate refuses unredacted prod calls `[CITED: TSD §5.3]` |
| i18n locale detection | Frontend Server (`proxy.ts`) | Browser (Accept-Language) | `proxy.ts` redirects to `/[lang]/`; per-message detection (`franc-min`) happens in the chat handler `[VERIFIED: Next.js 16 i18n + proxy docs]` |
| Rate limiting | API (check before LLM call) | Database (counters) | Reject runaway conversations *before* spending tokens `[CITED: TSD §9, ARCH §11]` |

**Why this matters:** the most common Phase-1 misassignment in this stack is putting streaming in a Server Action (it can't stream) or putting auth enforcement only in the browser (claims are spoofable). The map above is the sanity check the planner and plan-checker should apply to every task.

## Standard Stack

> The frontend shell (Next.js, React, shadcn, Tailwind) is **already installed** — see "Already-Installed Inventory" below; do NOT re-pick or re-add. This section lists what Phase 1 **adds**.

### Core (add in Phase 1)
| Library | Version (TSD lock) | Registry (verified 2026-05-31) | Purpose | Why Standard |
|---------|--------------------|--------------------------------|---------|--------------|
| `firebase` (web SDK) | `^12.13` | **12.14.0** `[VERIFIED: npm]` | Client Auth, Firestore reads, Storage uploads | The data plane; Node 22+ for admin |
| `firebase-admin` (server) | `^13.10` | **13.10.0** `[VERIFIED: npm]` | Server-side Auth verify, custom claims, Firestore writes, `findNearest` | Bypasses rules for service-account work; sets custom claims |
| `@ai-sdk/anthropic` | `^3.0.81` | **3.0.81** `[VERIFIED: npm]` | Claude provider for the AI SDK | Anthropic provider; matches lock exactly |
| `ai` (Vercel AI SDK) | `^5` (TSD) | **6.0.193** `[VERIFIED: npm]` ⚠️ | `streamText`, typed tools, `useChat` | **DIVERGENCE — v6 is now GA; pin decision in SPIKE-AI-SDK (see §Open Questions Q1)** |
| `@anthropic-ai/sdk` | `^0.100.1` | confirm at install | Escape hatch (raw beta headers, fine-grained `cache_control`) | Fallback path if AI SDK lags |
| `voyageai` | `^0` | **0.2.1** `[VERIFIED: npm]` | `voyage-3-large` embeddings (1024-d, multilingual) | Anthropic's documented embedding partner; REST also fine |
| `next-intl` | `^4` | **4.13.0** `[VERIFIED: npm]` | i18n on `app/[lang]/` segment | App-Router-native; locked |
| `zod` | `^4` | **4.4.3** `[VERIFIED: npm]` | Validation + AI SDK tool `inputSchema` + Coach output schema | Standard-schema for AI SDK typed tools |
| `@upstash/qstash` | `^2` | **2.11.0** `[VERIFIED: npm]` | Cron + HMAC-signed callbacks to `/api/jobs/*` | The one sanctioned non-Firebase dependency |

### Supporting (add in Phase 1)
| Library | Version (TSD lock) | Registry (verified) | Purpose | When to Use |
|---------|--------------------|--------------------|---------|-------------|
| `pdfjs-dist` | `^4` (TSD) | **6.0.227** `[VERIFIED: npm]` ⚠️ | PDF → text in `kb/ingest/pdf.ts` | Ingestion; TSD pins `^4` but registry is `6.x` — verify Node parse path at install (Q3) |
| `mammoth` | `^1` | **1.12.0** `[VERIFIED: npm]` | DOCX → text | Ingestion of .docx KB sources |
| `franc-min` | `^6` | **6.2.0** `[VERIFIED: npm]` | Per-message language detection | Chat handler picks response language |
| `gpt-tokenizer` | `^2` (TSD) | **3.4.0** `[VERIFIED: npm]` ⚠️ | Token-aware chunk sizing | Chunker; registry is `3.x` vs TSD `^2` — confirm API at install |
| `promptfoo` | latest | **0.121.13** `[VERIFIED: npm]` | Eval harness, Opus-4-7 judge | 1 trilingual gold fixture + calibration plan |

### Dev / Test (add in Phase 1)
| Library | Version (TSD lock) | Registry (verified) | Purpose |
|---------|--------------------|--------------------|---------|
| `vitest` | `^2` (TSD) | **4.1.7** `[VERIFIED: npm]` ⚠️ | Unit tests for `src/` core; TSD `^2` vs registry `4.x` — pin a current major |
| `@playwright/test` | `^1.5x` | **1.60.0** `[VERIFIED: npm]` | E2E sign-in → stream → persist |
| `@firebase/rules-unit-testing` | (unpinned) | **5.0.1** `[VERIFIED: npm]` | Security-rules CI coverage for all 3 roles, every collection |

### Alternatives Considered (locked — do not re-explore)
| Instead of | Could Use | Tradeoff / when |
|------------|-----------|-----------------|
| Firestore `findNearest` | Pinecone Serverless `aws-ap-southeast-1` | **Only if SPIKE-RAG fails** (p95>800ms or read-cost>10×); swap behind `rag/` adapter, app state stays in Firestore `[CITED: TSD §2.2, D-05]` |
| QStash | GitHub Actions scheduled workflow | **Only if SPIKE-CRON fails** `[CITED: D-05]` |
| App Hosting streaming | Vercel front-end + Firebase backend | **Only if SPIKE-DEPLOY fails — escalate to Derek (residency)** `[CITED: D-05]` |
| AI SDK abstraction | `@anthropic-ai/sdk` direct for chat route | **Only if SPIKE-AI-SDK shows an unworkable Next.js 16 incompatibility** `[CITED: D-06]` |
| Voyage `voyage-3-large` | Mesolitica / Cohere multilingual / OpenAI `text-embedding-3-large` | **Only if SPIKE-RAG BM/中文 recall <70% of EN** `[CITED: G3]` |

**Installation (Phase 1 add):**
```bash
npm install firebase@^12 firebase-admin@^13 @ai-sdk/anthropic@^3 ai@<pin-after-SPIKE-AI-SDK> \
  @anthropic-ai/sdk voyageai next-intl@^4 zod@^4 \
  pdfjs-dist mammoth franc-min gpt-tokenizer @upstash/qstash@^2
npm install -D vitest @vitest/ui @playwright/test promptfoo @firebase/rules-unit-testing @types/node
```

**Version-verification note for the planner:** the TSD version pins were verified ~2026-05-31 and four have since drifted up a major (`ai` 5→6, `pdfjs-dist` 4→6, `vitest` 2→4, `gpt-tokenizer` 2→3). Re-run `npm view <pkg> version` at plan time and pin exact versions in `package.json`. Do NOT blindly take `latest` for `ai` — choose v5 or v6 deliberately in SPIKE-AI-SDK (Q1).

### Already-Installed Inventory (do NOT re-pick) `[VERIFIED: package.json]`
`next@16.2.6`, `react@19.2.4`, `react-dom@19.2.4`, `eslint-config-next@16.2.6`, `typescript ^5`; UI: `@base-ui/react ^1.5.0`, `radix-ui ^1.4.3`, `shadcn ^4.8.3`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `next-themes`; Tailwind `^4` + `@tailwindcss/postcss`; widgets: `lucide-react`, `cmdk`, `sonner`, `recharts`, `vaul`, `embla-carousel-react`, `react-day-picker`, `react-resizable-panels`, `input-otp`, `date-fns`. **55 shadcn components vendored in `components/ui/`**; `lib/utils.ts` (cn), `hooks/use-mobile.ts` present.

## Architecture Patterns

### System Architecture Diagram (Phase-1 vertical slice — data flow)

```
[ Agent's phone, real 4G ]                                    EN proof slice
        │  GET /  (no locale)
        ▼
  proxy.ts  ──(no /[lang]/ prefix? redirect)──►  /en/(chat)        [next-intl locale detect]
        │  signed-in?  (optimistic check only; NOT full auth)
        ▼
  app/[lang]/(chat)/page.tsx  ── renders chat shell (shadcn) ──► useChat() client hook
        │  POST /api/chat   { messages }  + Firebase ID token (Bearer)
        ▼
  app/api/chat/route.ts   (Node runtime, SSE)
        │  1. requireUser(req) → adminAuth.verifyIdToken()      [HARD auth gate]
        │  2. ratelimit.check(uid,'chat')  → reject if over     [before any token spend]
        │  3. router.route(messages) → heuristic → 'coach'      [src/router, dormant LLM seam]
        │  4. coachAgent: assemble context
        │         └─ rag.retrieve(query): voyageEmbed → findNearest(lang-filtered) → citations
        │         └─ pdpa.pseudonymize(context)  → assert pdpa_redacted===true   [GATE]
        │  5. streamText({ model: modelFor('coach'), system, tools:[retrieveKnowledge] })
        │         model id ← Remote Config (never hard-coded)
        ▼  SSE tokens  (Content-Type: text/event-stream, Cache-Control: no-store, X-Accel-Buffering: no)
  useChat() renders tokens incrementally
        │
        │  onFinish (server):
        │    ├─ memory.appendMessage(cid, …)   → conversations/{cid}/messages/{mid}   [subcollection]
        │    ├─ after(() => audit.log({ actorUid, action, hashes{}, ts }))            [append-only]
        │    └─ ratelimit.decrement(uid); token-usage telemetry
        ▼
  Firestore (asia-southeast1)  ── persists; survives browser refresh

  [ Parallel, week-1 ]                              [ Background seam ]
  SPIKE-RAG  : ~500 multilingual chunks,            QStash cron ──► /api/jobs/stall-detect
               measure p95 / read-cost / recall          (HMAC-signed; runs as service account;
  SPIKE-DEPLOY: this SSE path on real App Hosting          IANA TZ Asia/Kuala_Lumpur; writes heartbeat)
  SPIKE-CRON : QStash → /api/jobs signature verify
```

The reader can trace the proof slice from phone → proxy → chat handler → router → rag → llm → SSE → persist → audit by following the arrows. File-to-module mapping is in the Component table below, not the diagram.

### Recommended Project Structure (follow TSD §3.1 exactly — `app/` may import `src/`; `src/` NEVER imports `app/`)
```
cy-csaiagent/
├─ proxy.ts                         # locale detect + optimistic auth gate (NOT middleware.ts)
├─ app/
│  ├─ [lang]/                       # i18n segment: en | ms | zh
│  │  ├─ (chat)/page.tsx            # mobile-first chat shell (uses components/ui/)
│  │  └─ (admin)/kb/page.tsx        # minimal authenticated KB CRUD form (D-10)
│  ├─ api/
│  │  ├─ chat/route.ts              # SSE streaming (Node runtime) — the spine
│  │  ├─ kb/ingest/process/route.ts # chunked client-driven ingestion worker
│  │  └─ jobs/stall-detect/route.ts # QStash-signed cron callback (escalation seam)
│  └─ layout.tsx                    # NextIntlClientProvider wiring
├─ src/                             # framework-agnostic core (unit-testable w/o Next)
│  ├─ agents/coach/{prompt,tools,schema,index}.ts
│  ├─ router/{heuristic,index}.ts   # classifier.ts = dormant seam
│  ├─ llm/{provider,fake,types,index}.ts
│  ├─ memory/{conversation,leadContext,agentProfile,index}.ts
│  ├─ rag/{embed,search,citations,index}.ts          # adapter: Firestore | Pinecone
│  ├─ kb/{ingest/{chunker,pdf,pipeline},crud,index}.ts
│  ├─ escalation/{detect,handoff,index}.ts
│  ├─ audit/{log,pdpa}.ts
│  ├─ ratelimit/{window,index}.ts
│  ├─ i18n/{request,routing,detect}.ts + messages/{en,ms,zh}.json
│  └─ firebase/{admin,client,collections}.ts          # typed collection refs = single source of truth
├─ evals/                          # Promptfoo config + 1 trilingual gold fixture
├─ firestore.rules + tests         # deny-by-default + @firebase/rules-unit-testing
└─ apphosting.yaml                 # Secret Manager bindings, minInstances=1
```

### Pattern 1: Route Handler for streams, Server Action for mutations
**What:** SSE token streaming lives in `app/api/chat/route.ts` (Node runtime, returns the AI SDK stream response). Mutations (KB CRUD, profile edits, marking an escalation) use Server Actions. The split is mechanical, not judgment. `[CITED: TSD §3.4, ARCH pattern 2]`
**When to use:** all server logic.
**Example (verified against Next.js 16 route-handler + streaming docs):**
```ts
// app/api/chat/route.ts  — Node runtime
// Source: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
//       + .../02-guides/streaming.md (Web Streams API in Route Handlers)
import { after } from 'next/server'
export const maxDuration = 90              // cap runaway turns; App Hosting Cloud Run allows more
export async function POST(req: Request) {
  const uid = await requireUser(req)       // adminAuth.verifyIdToken — HARD gate
  await ratelimit.check(uid, 'chat')
  const { messages } = await req.json()
  const route = router.route(messages)     // heuristic → 'coach' (LLM seam dormant)
  const result = streamText({
    model: modelFor('coach'),              // id from Remote Config
    system: coachAgent.systemPrompt,
    messages,
    tools: coachAgent.tools,               // retrieveKnowledge → rag.retrieve
    onFinish: async (final) => {
      await memory.appendMessage(cid, final)
      after(() => audit.log({ actorUid: uid, action: 'chat', hashes: hashOf(final), ts: Date.now() }))
    },
  })
  // AI SDK response method name differs v5 vs v6 — confirm in SPIKE-AI-SDK (Q1).
  return result.toUIMessageStreamResponse({                  // v6 name; v5 = toDataStreamResponse
    headers: { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
```
**Streaming headers are load-bearing** `[VERIFIED: Next.js 16 streaming.md]`: reverse proxies/CDNs buffer SSE by default; `X-Accel-Buffering: no` + `Cache-Control: no-store` are required, and **adapter/serverless streaming support is "platform-specific"** — exactly why SPIKE-DEPLOY exists.

### Pattern 2: `proxy.ts` for locale + optimistic auth (NOT `middleware.ts`)
**What:** Next.js 16 renamed Middleware → **Proxy**. Create `proxy.ts` at project root exporting a `proxy` function (named or default). Use it for locale-prefix redirect and *optimistic* auth checks only — **not** as the real authorization solution. `[VERIFIED: node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md]`
**Example:**
```ts
// proxy.ts  (root, same level as app/)
// Source: 16-proxy.md + 02-guides/internationalization.md
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const locales = ['en', 'ms', 'zh']
  const hasLocale = locales.some(l => pathname.startsWith(`/${l}/`) || pathname === `/${l}`)
  if (!hasLocale) {
    request.nextUrl.pathname = `/${detectLocale(request)}${pathname}`
    return NextResponse.redirect(request.nextUrl)
  }
  return NextResponse.next()
}
export const config = { matcher: ['/((?!_next|api).*)'] }
```
**Note for the planner:** `next-intl ^4` ships its own routing/`createMiddleware`-style integration. Whether next-intl v4 expects `proxy.ts` or still `middleware.ts` under Next.js 16 is **not confirmed** in the bundled docs (Q2) — verify against next-intl v4 docs during planning before locking the i18n task.

### Pattern 3: Firestore `findNearest` RAG with lang pre-filter (no Cloud Functions)
**What:** embed query via Voyage HTTPS, run `findNearest` (DOT_PRODUCT on normalized 1024-d vectors) directly from the Route Handler with a `where('lang', …)` pre-filter, build citations from chunk IDs. `[VERIFIED: Firebase vector-search docs]`
**When:** the Coach `retrieveKnowledge` tool.
**Example:** see §Code Examples → "Firestore vector retrieval".

### Pattern 4: Single shared `leadContext` doc, agent-scoped write slots
**What:** `leadContext/{leadId}` is read whole by any agent; each agent writes only its own slot (`coachSlot`/`finderSlot`/`replySlot`) + the rolling `summary`. Firestore is the cross-pillar bus — no event bus. `[CITED: TSD §4, ARCH §6, pattern 5]`
**When:** Phase 1 wires the seam (Coach slot) even though only Coach exists.

### Pattern 5: Repository + dependency injection for the core
**What:** `agents/router/memory/rag` take dependencies via factory, not module-scoped imports. Real Firestore in prod, in-memory/fake in tests. `[CITED: ARCH pattern 1]` This is what makes the `llm/` fake provider (D-02) and deterministic evals possible.

### Anti-Patterns to Avoid `[CITED: ARCH anti-patterns]`
- **Server Action for streaming** — Server Actions are RPC; they cannot stream SSE cleanly. Streaming MUST be a Route Handler.
- **One mega-Route-Handler that "is the agent"** — keep `/api/chat/route.ts` a thin orchestrator; decisions live in `src/agents` + `src/router`.
- **Inline `messages` array on the conversation doc** — hits the 1 MB doc limit; use the `messages` subcollection from the first commit.
- **Embedding a large PDF inside the upload Server Action or `after()`** — Cloud Run request-timeout trap; use the chunked client-driven loop.
- **`if request.auth != null` blanket rules** — the Sept-2025 mass-leak pattern; deny-by-default with explicit ownership/role checks.
- **Firestore `onSnapshot` to trigger downstream writes** (smuggled event-driven logic) — listeners run only when a client is connected; stalls happen overnight. Use QStash.
- **Hard-coding a model ID** — resolve from Remote Config (C5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM streaming + provider swap + typed tools | Custom Anthropic SSE encoder + per-provider switch | Vercel AI SDK (`streamText`/`useChat`/`tool`) over `@ai-sdk/anthropic` | Provider swap becomes one line; typed tool I/O; `useChat` consumes the stream directly `[CITED: STACK §4]` |
| Vector KNN search | A custom cosine loop over Firestore docs | Firestore native `findNearest` (DOT_PRODUCT) | First-class, no Cloud Functions, same access-control model, in-region `[VERIFIED: Firebase docs]` |
| Embeddings | Self-hosted embedding model | Voyage `voyage-3-large` HTTPS | Multilingual, 1024-d fits the 2048 ceiling, Anthropic's partner `[CITED: STACK §3]` |
| Scheduled jobs | Free cron (cron-job.org) or client-driven cron | QStash signed callbacks | Built-in HMAC signing, retries, DLQ, IANA TZ; free crons silently lapse (Pitfall 11) `[CITED: TSD §3.4]` |
| i18n routing + ICU formatting | Bare `getDictionary` + hand-rolled plurals | `next-intl ^4` | App-Router-native; ICU pluralization needed for BM/中文 `[CITED: STACK §10]` |
| Security-rules testing | Manual emulator clicking | `@firebase/rules-unit-testing` in CI | Asserts deny-by-default per collection/role on every PR `[CITED: TSD §5.2]` |
| Tool input validation + Coach output schema | Hand-rolled JSON checks | Zod `^4` | Same schema powers AI SDK typed tools and the Coach output contract `[CITED: STACK §3.4]` |
| Token counting / chunk sizing | Char-count heuristics | `gpt-tokenizer` | Token-aware chunking matches model accounting `[CITED: STACK §6]` |
| PDF/DOCX parsing | Regex over raw bytes | `pdfjs-dist` (PDF), `mammoth` (DOCX) | `pdf-parse` is abandoned; pdfjs is maintained `[CITED: STACK §16]` |
| Eval harness + LLM-judge | Bespoke scoring script | Promptfoo (Opus-4-7 judge) | YAML-driven, Anthropic-native judge, CI integration `[CITED: STACK §11]` |

**Key insight:** in this domain the custom-build temptation is highest for streaming (write your own SSE) and vector search (write your own cosine). Both are solved better by the AI SDK and Firestore native vector search respectively; the only reason to hand-roll is a spike failure, and even then the fallback is another library, not custom code.

## Runtime State Inventory

> Phase 1 is **greenfield** — no rename/refactor/migration. This section is therefore mostly N/A, but two create-time, immovable-once-set facts behave like locked runtime state and the planner must treat them as such.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing datastore; Firestore is net-new | Seed 1 EN KB doc + synthetic users during build |
| Live service config | **Firestore region (`asia-southeast1`) and Storage bucket region are set at project creation and are IMMOVABLE** (G1). QStash schedules + signing keys live in the QStash dashboard, not git. | (1) **BLOCKING pre-task:** confirm region with Derek before creating any Firebase resource. (2) Register QStash cron + capture signing keys into Secret Manager. |
| OS-registered state | None | — |
| Secrets/env vars | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` — none exist yet | Create via App Hosting + Secret Manager binding (`apphosting.yaml`); never in client bundle, never logged. Global secrets-hygiene rules apply. `[VERIFIED: QStash docs — 3 env vars required]` |
| Build artifacts | None (greenfield) | — |

**The create-time trap:** unlike a code rename, the Firestore region cannot be changed after `gcloud`/Firebase creates the project. Getting Derek's G1 sign-off wrong is unrecoverable without a full project rebuild + data migration. This is why CONTEXT.md makes region confirmation a hard prerequisite.

## Common Pitfalls

> Full set in PITFALLS.md. The P0 set the CONTEXT names (6, 7, 8, 9, 21, 22, 32, 35) plus the streaming/cron seams are below.

### Pitfall A: PII to Claude violates PDPA cross-border (Pitfalls 7, 32, 35 — HIGH) `[CITED: PITFALLS]`
**What goes wrong:** lead names/phones in prompts cross to Anthropic's US infra (≈7-day retention); no TIA = non-compliant. PII can also leak into eval datasets in git.
**Why:** "it's just the API" misconception; no data-flow diagram; eval engineering skips redaction.
**How to avoid:** TIA on file (Phase-1 gate); pseudonymize at the boundary (`names → <LEAD_ID:…>`, `phones → <PHONE_HASH>`); `pdpa_redacted:true` gate refuses unredacted prod calls; audit stores hashes only; CI scans eval JSON for MY phone/IC regex. Redaction is fully implemented + unit-tested even though Phase 1 uses synthetic data (Claude's-discretion default).
**Warning signs:** plaintext phone/name in audit logs; PII found in outbound payload pen-test; no TIA artifact.

### Pitfall B: Firestore Rules leak cross-agent / cross-tenant (Pitfall 6 — HIGH) `[CITED: PITFALLS]`
**What goes wrong:** `if request.auth != null` rules expose everyone's data (Sept-2025 mass-leak pattern).
**How to avoid:** deny-by-default from the first commit; every read/write checks `ownerUid == request.auth.uid` or a defined role + `tenantId`; `auditLogs` create-only; coach access scoped via `uplineCoachId`/`seniorCoachId` lookup; `@firebase/rules-unit-testing` covers **all three roles × every collection** in CI (the D-11 consequence).
**Warning signs:** a collection added without a corresponding rule + test; an unauth `.get()` returns >0 docs.

### Pitfall C: Streaming silently fails on App Hosting (Pitfall 23 — MEDIUM-HIGH) `[CITED: PITFALLS + Next.js 16 streaming.md]`
**What goes wrong:** App Hosting / CDN buffers SSE → "thinking…" then a 30s dump on mobile.
**Why:** proxies, CDNs, compression, and even Safari (<1024-byte buffer) buffer streams; adapter support is platform-specific.
**How to avoid:** SPIKE-DEPLOY on **real 4G, not localhost**; set `X-Accel-Buffering: no` + `Cache-Control: no-store`; `minInstances=1`; non-streaming fallback ready; if it fails → escalate to Derek (Vercel fallback has residency implications).
**Warning signs:** streams fine in dev, batched in prod; App Hosting logs show 60s response with no body progress.

### Pitfall D: Next.js 16 implicit-caching removed → cost/behavior surprise (Pitfalls 21, 22 — MEDIUM) `[CITED: PITFALLS + route-handlers.md]`
**What goes wrong:** assuming Server Components cache by default (they don't in 16) → every page load re-reads Firestore / re-calls Claude. Or: synchronous `cookies()`/`headers()` (removed — must await), or `middleware.ts` (now `proxy.ts`), or `updateTag` in a Route Handler (Server-Action-only).
**How to avoid:** the Next.js-16 caching audit (D-06) + a CI lint/grep rule flagging sync `cookies()/headers()`, `middleware.ts`, and cache-API misuse. **Route Handlers are NOT cached by default** `[VERIFIED: route-handlers.md]` — good for `/api/chat`, but read budgets still need explicit `use cache` on read-heavy helpers (not on LLM calls).
**Warning signs:** Firestore reads/day spike with no traffic growth; build deprecation warnings.

### Pitfall E: 1 MB doc limit + read-cost runaway (Pitfalls 8, 9 — MEDIUM) `[CITED: PITFALLS]`
**What goes wrong:** inline `messages[]` array hits 1 MB; full-history fetch on every load spikes reads.
**How to avoid:** messages subcollection from the start (TSD §4); paginate to last-N; rolling summary for older turns; `tenantId` on every doc.

### Pitfall F: Cron silently breaks (Pitfall 11 — MEDIUM) `[CITED: PITFALLS]`
**What goes wrong:** the stall-detect cron lapses and nobody notices; the AI's proactive value dies in pilot.
**How to avoid:** QStash (signed, retried) not a free cron; each job writes a heartbeat doc; idempotent via Firestore lock tokens; UI watchdog banner if a window is missed by >2× (the watchdog UI itself is Phase-2-thin, but the heartbeat write is Phase 1).

### Pitfall G: Multilingual quality cliff hidden by EN-only proof (Pitfalls 4, 33 — HIGH) `[CITED: PITFALLS, G3]`
**What goes wrong:** EN works, BM/中文 retrieval recall is far worse, regressions invisible.
**How to avoid:** even though the proof slice is EN, SPIKE-RAG measures BM/中文 recall on ~500 multilingual chunks (pass: BM/ZH recall ≥70% of EN) and the eval fixture is trilingual day 1 (D-07/D-08). Embedding fallback = Mesolitica/Cohere.

## Code Examples

### Firestore vector retrieval (the Coach `retrieveKnowledge` tool) `[VERIFIED: Firebase vector-search docs]`
```ts
// src/rag/search.ts (Firestore adapter)
import { adminDb } from '@/src/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { voyageEmbed } from '@/src/rag/embed'

export async function retrieve(query: string, userLang: 'en'|'ms'|'zh') {
  const q = await voyageEmbed(query, { model: 'voyage-3-large', inputType: 'query' }) // 1024-d, normalized
  const snap = await adminDb.collection('kbChunks')
    .where('lang', 'in', [userLang, 'en'])          // cross-lingual fallback; REQUIRES composite vector index
    .findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(q),
      limit: 8,
      distanceMeasure: 'DOT_PRODUCT',                 // normalized vectors → faster, == cosine
    })
    .get()
  return snap.docs.map(d => ({ chunkId: d.id, ...d.data() }))   // chunkId = citation source
}
```
**Vector index creation (one-time ops, NOT a Cloud Function)** `[VERIFIED: Firebase vector-search docs]`:
```bash
gcloud firestore indexes composite create \
  --collection-group=kbChunks \
  --query-scope=COLLECTION \
  --field-config field-path=lang,order=ASCENDING \
  --field-config field-path=embedding,vector-config='{"dimension":"1024","flat":"{}"}' \
  --database='(default)'
```
**Billing model (makes SPIKE-RAG's "read-cost < 10× naive" measurable)** `[VERIFIED: Firebase pricing docs via web search]`: you are charged **1 read per document returned + 1 read per 100 kNN index entries scanned (rounded up)**. Example: `limit:5` returning 5 docs but scanning 1550 index entries = 5 + 16 = **21 reads**. A selective `where('lang',…)` pre-filter cuts index entries scanned, which is the lever SPIKE-RAG exercises.

### `llm/` abstraction + fake provider (FND-02, QUAL-01) `[CITED: STACK §4, ARCH §8]`
```ts
// src/llm/provider.ts
import { anthropic } from '@ai-sdk/anthropic'
import { remoteConfig } from '@/src/firebase/admin'
export function modelFor(pillar: 'coach'|'finder'|'reply'|'router'|'grader') {
  const id = remoteConfig().getString(`model.${pillar}.default`)  // NEVER hard-code
  return anthropic(id)               // swap to openai(id)/google(id) → call sites unchanged (QUAL-01)
}
// src/llm/fake.ts — deterministic test double keyed by matcher (systemContains / lastUserMessage / callCounter)
```
QUAL-01 integration test: run the same chat call through `modelFor` with the provider swapped to a second vendor; assert the pipe (router→agent→stream→persist) succeeds with no PII leaving unredacted.

### QStash signed cron callback (FND-10) `[VERIFIED: QStash Next.js docs]`
```ts
// app/api/jobs/stall-detect/route.ts
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
async function handler(req: Request) {
  const stalled = await escalation.findStalled({ days: 2 })   // runs as service account
  for (const s of stalled) await escalation.emitHandoffSignal(s)
  await writeHeartbeat('stall-detect')                        // watchdog reads this
  return Response.json({ processed: stalled.length })
}
export const POST = verifySignatureAppRouter(handler)         // loads QSTASH_CURRENT/NEXT_SIGNING_KEY from env
```
QStash supports IANA-TZ cron (`Asia/Kuala_Lumpur`) and retries on 5xx with DLQ `[CITED: TSD §3.4]`. SPIKE-CRON confirms the seam in-region; fallback = GitHub Actions scheduled workflow.

### Custom claims + deny-by-default rule sketch (AUTH-04) `[CITED: TSD §5.2]`
```js
// firestore.rules
match /agentProfiles/{uid} {
  allow read: if isSelf(uid)
           || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant())
           || (hasRole('admin') && sameTenant());
  allow write: if isSelf(uid) || (hasRole('admin') && sameTenant());
}
match /auditLogs/{id} { allow create: if false; allow read: if hasRole('admin') && sameTenant(); }
//                       ^ create via Admin SDK only; no update/delete from any client
```
```ts
// set claims server-side, then client refreshes token
await adminAuth.setCustomUserClaims(uid, { role: 'new-agent', tenantId: 'd2' })
```

## State of the Art

| Old Approach (TSD/research baseline, ~2026-05-31) | Current (registry 2026-05-31) | When Changed | Impact |
|---------------------------------------------------|-------------------------------|--------------|--------|
| `ai ^5` (AI SDK v5: `toDataStreamResponse`, flat message content) | **`ai` 6.0.193** (v6: v3 Language Model Spec; `useChat` parts model; provider factory + wire-format changes; codemod available) `[VERIFIED: npm + Vercel AI SDK 6 blog]` | AI SDK 6 GA shipped before 2026-05-31 | **Pin decision required (Q1).** v6 self-described as "not expected to have major breaking changes for most users" with `npx @ai-sdk/codemod v6`, but `useChat` and provider option shapes changed. SPIKE-AI-SDK should pin v5 (matches TSD/research exactly) OR adopt v6 with the codemod — decide once, document in Key Decisions. `@ai-sdk/anthropic 3.0.81` matches the lock; confirm it pairs with the chosen `ai` major. |
| `pdfjs-dist ^4` | **6.0.227** `[VERIFIED: npm]` | — | Confirm the Node text-extraction path still works on `6.x` during SPIKE-INGEST; pin a current major. |
| `vitest ^2` | **4.1.7** `[VERIFIED: npm]` | — | Pin `^4`; no breaking impact on the planned unit suites. |
| `gpt-tokenizer ^2` | **3.4.0** `[VERIFIED: npm]` | — | Confirm tokenizer API names at install. |
| Firestore vector search "GA but unproven at scale" | GA, billing model documented (reads-per-100-index-entries) `[VERIFIED: Firebase pricing]` | — | SPIKE-RAG read-cost criterion is now concretely measurable. |

**Deprecated / do NOT use:** `middleware.ts` (→ `proxy.ts`), synchronous `cookies()/headers()` (→ await), `pdf-parse` (abandoned → `pdfjs-dist`), `@anthropic-ai/claude-agent-sdk` (wrong shape — that's for coding agents, not conversational pillars), any GCP service outside the Firebase SDK surface (Cloud Functions, Cloud Run direct, Vertex, BigQuery, Pub/Sub, Cloud Scheduler).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@ai-sdk/anthropic 3.0.81` is compatible with BOTH `ai` v5 and v6 (provider unchanged across the core bump) | Standard Stack / Open Q1 | If v6 requires a new provider major, the install pin must change; caught in SPIKE-AI-SDK |
| A2 | `next-intl ^4` integrates via `proxy.ts` (not `middleware.ts`) under Next.js 16 | Pattern 2 / Open Q2 | If next-intl v4 still emits `middleware.ts`, the i18n routing task needs a different file convention; verify in next-intl v4 docs before locking |
| A3 | Anthropic still has no Asian data residency as of 2026-05; TIA + pseudonymization is the v1 path, Bedrock-Singapore the fallback | PDPA / Security Domain (G2) | If residency posture changed, the TIA scope changes — confirm with current Anthropic data-residency docs + Derek/legal |
| A4 | `claude-sonnet-4-6` / `claude-opus-4-7` IDs are valid and resolvable from Remote Config at build time | llm/ + Security | If model IDs renamed, Remote Config keys still abstract it — but verify the IDs exist before the QUAL-01 test |
| A5 | App Hosting in `asia-southeast1` supports SSE response streaming through its Cloud Run substrate + CDN | SPIKE-DEPLOY | The entire chat UX depends on this; this is precisely why SPIKE-DEPLOY is required — not a planning assumption to skip |
| A6 | Voyage `voyage-3-large` BM/中文 recall clears ≥70% of EN on a Malaysian test set | SPIKE-RAG (G3) | If false, swap embeddings (Mesolitica/Cohere) behind the `rag/` adapter; spike measures it |
| A7 | `pdfjs-dist 6.x` and `gpt-tokenizer 3.x` retain a Node-side text-extraction / tokenization API equivalent to the TSD-pinned majors | Standard Stack | Minor — confirm at install / SPIKE-INGEST; both have library fallbacks |

**These are the claims that should become user-confirmed decisions (or spike outcomes) before they harden into the plan.**

## Open Questions (RESOLVED)

> All four resolved during planning and folded into plans — see the `RESOLVED:` line under each.

1. **AI SDK version pin: v5 or v6?**
   - What we know: TSD/research lock `ai ^5`; registry ships `ai 6.0.193` GA with a v3 Language Model Spec, `useChat` parts model, and changed provider option shapes; a `@ai-sdk/codemod v6` exists; Vercel calls it low-impact for most users. `@ai-sdk/anthropic 3.0.81` matches the lock. `[VERIFIED: npm + AI SDK 6 blog]`
   - What's unclear: whether `@ai-sdk/anthropic 3.x` pairs with `ai` v6, and whether the `toDataStreamResponse`→`toUIMessageStreamResponse` rename affects the chat route shape.
   - Recommendation: **SPIKE-AI-SDK pins the version deliberately.** Safe default = pin `ai@^5` to match the research exactly and de-risk Phase 1; revisit v6 at the P1→P2 boundary. Whichever is chosen, log it in PROJECT.md Key Decisions and use the exact method name in the chat route.
   - **RESOLVED:** pin `ai@^5` for Phase 1; SPIKE-AI-SDK (plan 01-08) confirms the streaming/tool method name (`toDataStreamResponse`), consumed by the chat route in 01-12.

2. **Does `next-intl ^4` use `proxy.ts` or `middleware.ts` under Next.js 16?**
   - What we know: Next.js 16 renamed Middleware→Proxy `[VERIFIED: 16-proxy.md]`; next-intl historically shipped a `createMiddleware` helper in `middleware.ts`.
   - What's unclear: whether next-intl v4 has a Next.js-16 `proxy.ts` integration or expects the legacy filename (which Next.js 16 may not pick up).
   - Recommendation: verify against next-intl v4 docs during planning; fold a 30-min check into the i18n task. If next-intl insists on `middleware.ts`, reconcile with the project's "proxy.ts not middleware.ts" rule before the task is locked.
   - **RESOLVED:** folded into plan 01-06 Task 1 as a ≤30-min proxy-vs-middleware verification; the chosen integration is recorded in the 01-06 SUMMARY.

3. **Firestore region G1 (`asia-southeast1` vs `asia-southeast2`) — immovable.**
   - What we know: TSD default `asia-southeast1` (Singapore); ARCHITECTURE once referenced Jakarta — reconciled to Singapore. `[CITED: TSD §14, ARCH §11]`
   - What's unclear: Derek's final residency preference; PDPA posture differs slightly between SG and Jakarta.
   - Recommendation: **BLOCKING pre-task** — confirm with Derek before any Firebase resource is created. Cannot be changed afterward.
   - **RESOLVED:** blocking human-gated pre-task in plan 01-01 (G1 sign-off with Derek); default `asia-southeast1` recorded in G1-REGION-SIGNOFF.md before any resource is created.

4. **G2 — Anthropic Asian residency / Bedrock-Singapore fallback.**
   - What we know: direct API has no Asian residency (2026-05); v1 path is TIA + pseudonymization; Bedrock-SG is the documented fallback if legal requires in-region inference. `[CITED: TSD §5.3]`
   - Recommendation: decide in Phase 1 with Derek; log in Key Decisions. The redaction layer + `pdpa_redacted` gate are built regardless.
   - **RESOLVED:** Derek decision captured in plan 01-01 (G2 in G1-REGION-SIGNOFF.md); the redaction layer + `pdpa_redacted` gate are built regardless in plan 01-05.

## Environment Availability

> Phase 1 stands up external dependencies for the first time — most are "to be provisioned," not "already available." The audit below is what the **plan must provision/verify**, since the working directory has none of them wired yet.

| Dependency | Required By | Available Now | Provision Path | Fallback |
|------------|------------|---------------|----------------|----------|
| Firebase project (`asia-southeast1`) | FND-01, all Firebase | ✗ (none) | Create after G1 sign-off; emulator-first for tests | — (region immovable) |
| Firebase emulator suite | rules/unit/integration tests | ✗ | `firebase-tools` install + `firebase emulators:start` | real in-region dev project |
| App Hosting backend | SPIKE-DEPLOY, FND-01 | ✗ | `apphosting.yaml` + deploy | Vercel front-end (residency → Derek) |
| `ANTHROPIC_API_KEY` | llm/, chat | ✗ | Secret Manager binding | — |
| `VOYAGE_API_KEY` | rag/embed | ✗ | Secret Manager binding | Mesolitica/Cohere/OpenAI key |
| QStash account + signing keys | FND-10, SPIKE-CRON | ✗ | QStash dashboard → 3 env vars to Secret Manager | GitHub Actions scheduled workflow |
| Node 22+ runtime | `firebase-admin ^13` | verify locally | `firebase-admin` requires Node 22+ (18/20 deprecated) | — |
| `gcloud` CLI | vector index creation | verify locally | install + auth for `gcloud firestore indexes composite create` | Firebase Console index creation |

**Missing with no fallback (block execution until provisioned):** Firebase project (gated on G1), Anthropic key, Voyage key.
**Missing with fallback:** QStash (→ GH Actions), App Hosting streaming (→ Vercel, Derek call), Voyage embeddings (→ alt embedder).

## Validation Architecture

> Nyquist validation is ENABLED (`workflow.nyquist_validation: true` in config.json). This section lets a VALIDATION.md be derived. Observable signals map 1:1 to the 5 ROADMAP Phase-1 success criteria.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` 4.x (unit), `@playwright/test` 1.60 (E2E), `@firebase/rules-unit-testing` 5.0.1 (rules), `promptfoo` 0.121 (eval) — **all Wave 0 (none installed yet)** |
| Config file | none yet — `vitest.config.ts`, `playwright.config.ts`, `promptfooconfig.yaml` are Wave-0 deliverables |
| Quick run command | `npx vitest run src/` |
| Full suite command | `npx vitest run && npx playwright test && npm run test:rules && npx promptfoo eval` |

### Phase Requirements → Test Map
| Req / Success-criterion | Observable behavior | Test type | Automated command | File exists? |
|-------------------------|---------------------|-----------|-------------------|--------------|
| Slice (SC#1) sign-in→stream | tokens render incrementally after sign-in | E2E (Playwright) + manual on real 4G (SPIKE-DEPLOY) | `npx playwright test e2e/chat-stream.spec.ts` | ❌ Wave 0 |
| SC#2 persist + audit | message survives refresh; 1 append-only `auditLogs` row written | E2E + integration | `npx playwright test e2e/persist.spec.ts`; `vitest run src/audit` | ❌ Wave 0 |
| FND-11 / QUAL-05 audit immutability | client update/delete on `auditLogs` denied | rules-unit-test | `npm run test:rules -- auditLogs` | ❌ Wave 0 |
| AUTH-04 / D-11 RBAC | each of 3 roles can only read permitted collections | rules-unit-test (all roles × every collection) | `npm run test:rules` | ❌ Wave 0 |
| QUAL-01 model swap | same chat call succeeds on a 2nd provider, no PII unredacted | integration (fake + 2nd provider) | `vitest run src/llm/swap.test.ts` | ❌ Wave 0 |
| QUAL-03 pseudonymization | names/phones replaced; `pdpa_redacted===true` before model call | unit | `vitest run src/audit/pdpa.test.ts` | ❌ Wave 0 |
| FND-06 router | heuristic always routes to Coach | unit | `vitest run src/router` | ❌ Wave 0 |
| FND-03 / SC#3 RAG recall | BM/中文 recall ≥70% of EN; p95<800ms; read-cost<10× naive | spike harness (SPIKE-RAG) | `vitest run src/rag/spike-rag.test.ts` (against ~500 chunks) | ❌ Wave 0 |
| FND-02 grounding/citations | Coach answer cites real KB chunk IDs; Zod output schema passes | unit (fake provider) | `vitest run src/agents/coach` | ❌ Wave 0 |
| FND-10 cron signature | unsigned request rejected; signed verified; heartbeat written | integration | `vitest run src/jobs/signature.test.ts` (mock signer) | ❌ Wave 0 |
| FND-07 / SC (eval) | 1 trilingual fixture scored by Opus judge | eval (Promptfoo) | `npx promptfoo eval -c evals/promptfooconfig.yaml` | ❌ Wave 0 |
| QUAL-07 ratelimit | over-budget conversation refused before LLM call | unit | `vitest run src/ratelimit` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched src/ dir>` (the relevant unit slice).
- **Per wave merge:** full `vitest run` + `npm run test:rules`.
- **Phase gate:** full suite green + SPIKE-RAG/DEPLOY/CRON resolved with documented pass/fallback + TIA on file, before `/gsd-verify-work`. Manual real-4G stream check is mandatory (cannot be automated; SPIKE-DEPLOY).

### Wave 0 Gaps (all test infra is net-new)
- [ ] `vitest.config.ts` + `playwright.config.ts` + `promptfooconfig.yaml` — framework install
- [ ] `src/firebase/__tests__/` + emulator harness + `npm run test:rules` script wiring `@firebase/rules-unit-testing`
- [ ] `firestore.rules` + per-collection per-role rules tests (all 3 roles)
- [ ] `src/llm/fake.ts` (deterministic provider) — prerequisite for all agent/router unit tests
- [ ] `src/rag/spike-rag.test.ts` harness + ~500 multilingual chunk fixture (synthetic, redacted)
- [ ] `evals/` Promptfoo config + 1 trilingual gold fixture + human-calibration plan doc
- [ ] `tests/conftest`-equivalent shared fixtures (synthetic users for 3 roles, seeded EN KB doc)
- [ ] CI PII-scan step (MY phone `+?60\d{9,10}` / IC `\d{6}-\d{2}-\d{4}` regex) over eval/test JSON

## Security Domain

> `security_enforcement` not set to `false` in config → enabled. The stack is auth + database + LLM + PII, so most ASVS categories apply.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control (this stack) |
|---------------|---------|-------------------------------|
| V2 Authentication | yes | Firebase Auth; ID-token `verifyIdToken` server-side on every privileged call; never trust client claim `[CITED: TSD §5]` |
| V3 Session Management | yes | Firebase Auth session persistence (LOCAL default → AUTH-05); token refresh on role change `[CITED: STACK §8.2]` |
| V4 Access Control | yes | Custom claims (`role`,`tenantId`) + **deny-by-default Firestore Security Rules** + CI rules tests for all 3 roles; coach scoped to downline `[CITED: TSD §5.2, D-11]` |
| V5 Input Validation | yes | Zod `^4` on tool inputs, Coach output schema, API payloads; preserve pasted message verbatim (future Reply) |
| V6 Cryptography | yes | Phone hashing for `phoneHash`/audit; **never hand-roll** — use a vetted hash (Node crypto); secrets via Secret Manager only `[CITED: TSD §5.3]` |
| V7 Error/Logging | yes | Structured JSON logs, **no raw PII**; audit stores hashes only; OTel → Cloud Logging `[CITED: TSD §9]` |
| V8 Data Protection (PDPA) | yes | TIA on file; pseudonymize-at-boundary; `pdpa_redacted:true` gate; per-lead `consentFlag`; in-region Firestore/Storage `[CITED: TSD §5.3]` |
| V13 API/Service | yes | QStash HMAC signature verification on `/api/jobs/*`; rate limiting before LLM spend; App Check (reCAPTCHA Enterprise) candidate on Route Handlers `[CITED: TSD §3.4, STACK §1]` |

### Known Threat Patterns for {Next.js 16 + Firebase + Claude + PDPA}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant/cross-agent Firestore read (`auth != null` rules) | Information Disclosure | Deny-by-default rules + `tenantId`/ownership checks + CI rules tests `[CITED: Pitfall 6]` |
| Raw PII transferred to Claude (cross-border) | Information Disclosure / Compliance | Boundary pseudonymization + `pdpa_redacted` gate + TIA `[CITED: Pitfall 7]` |
| Forged QStash cron callback | Spoofing | `verifySignatureAppRouter` HMAC verification; reject unsigned `[CITED: TSD §3.4]` |
| Spoofed client role claim | Elevation of Privilege | Server-side `verifyIdToken`; rules re-check; claims set only via admin Server Action `[CITED: TSD §5.1]` |
| API key in client bundle / logs | Information Disclosure | Secrets via Secret Manager, server-only, never logged `[CITED: Security Mistakes table]` |
| Runaway conversation burns token budget | Denial of Service (cost) | `ratelimit/` rejects before the LLM call; per-agent token+request budgets `[CITED: TSD §9]` |
| PII committed in eval/test fixtures | Information Disclosure | Redaction pipeline + CI PII regex scan; synthetic data only `[CITED: Pitfall 32]` |
| Audit log vs right-to-erasure conflict | Compliance | Audit stores pseudonyms/hashes only; canonical PII in separately-deletable `leads/{id}` `[CITED: Pitfall 35]` |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Hard constraints (violation = defect):** No Google Cloud Functions; no GCP beyond the Firebase SDK surface (Auth/Firestore/Storage/App Hosting/App Check/Remote Config only); no WhatsApp Business API; no auto-send; model IDs from Remote Config (never hard-coded); PDPA pseudonymize-at-boundary + audit-on-every-client-conversation + no-PII-in-logs; multilingual EN/BM/中文 from day 1.
- **Core/shell split:** `app/` may import `src/`; `src/` must **never** import `app/`. Core is portable + unit-testable without Next.
- **Every Firestore doc carries `tenantId`** (`"d2"` now). Messages in a subcollection, never inline array.
- **Agent tools are read-only** and authenticate **as the user** — never admin from a user-facing path.
- **Grounding mandatory:** answers cite source IDs; KB miss emits `no_sop_match`/handoff rather than inventing content.
- **Next.js 16 gotchas (AGENTS.md):** `proxy.ts` not `middleware.ts`; async `cookies()/headers()`; implicit fetch caching removed (every fetch uncached unless opted in); stream only from a Route Handler with `X-Accel-Buffering: no`, never a Server Action. **Read `node_modules/next/dist/docs/` before writing Next.js 16 code** (done for proxy, streaming, route-handlers, i18n in this research).
- **GSD workflow / Claim-Before-Start:** no code changes without a committed claim; owner-scoped commit prefixes; Regression Report in CLAIM.md before "done"; secrets-hygiene rules in full (never read `.env*`, never commit/log secrets).
- **Phase-1 spike gate:** SPIKE-RAG/DEPLOY/CRON must resolve (documented pass/fallback) and a PDPA TIA must be on file before downstream phases begin.

## Sources

### Primary (HIGH confidence)
- Bundled Next.js 16.2.6 docs (version-matched): `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `15-route-handlers.md`; `02-guides/streaming.md`, `internationalization.md` — proxy convention, Route Handler streaming via Web Streams API, `X-Accel-Buffering`, platform-specific streaming, `[lang]` segment.
- [Firebase — Firestore vector search](https://firebase.google.com/docs/firestore/vector-search) — `findNearest` signature, DOT_PRODUCT, 2048-d ceiling, gcloud composite vector index, pre-filter requires composite index.
- [Firebase / Firestore pricing](https://firebase.google.com/docs/firestore/pricing) — vector-search billing: 1 read per doc + 1 read per 100 kNN index entries scanned.
- [Upstash QStash — Vercel/Next.js quickstart](https://upstash.com/docs/qstash/quickstarts/vercel-nextjs) — `verifySignatureAppRouter`, 3 required env vars.
- npm registry (verified 2026-05-31): `next-intl` 4.13.0, `@upstash/qstash` 2.11.0, `@ai-sdk/anthropic` 3.0.81, `ai` 6.0.193, `firebase` 12.14.0, `firebase-admin` 13.10.0, `voyageai` 0.2.1, `zod` 4.4.3, `franc-min` 6.2.0, `pdfjs-dist` 6.0.227, `gpt-tokenizer` 3.4.0, `promptfoo` 0.121.13, `vitest` 4.1.7, `@playwright/test` 1.60.0, `@firebase/rules-unit-testing` 5.0.1, `mammoth` 1.12.0.
- Project `.planning/TSD.md`, `CONTEXT.md`, `ROADMAP.md`, `REQUIREMENTS.md`, research `SUMMARY/STACK/ARCHITECTURE/PITFALLS.md` — locked decisions, data model, security posture, pitfalls.

### Secondary (MEDIUM confidence)
- [Vercel — AI SDK 6 blog](https://vercel.com/blog/ai-sdk-6) — v6 GA, v3 LM Spec, codemod, "low-impact for most users."
- [Vercel AI SDK v5→v6 migration playbook (digitalapplied)](https://www.digitalapplied.com/blog/vercel-ai-sdk-v5-to-v6-migration-playbook-2026) — characterizes the v6 breaking-change axes (treat as MEDIUM, cross-checked against Vercel's own post).
- [next-intl App Router setup](https://next-intl.dev/docs/getting-started/app-router) — required files; did NOT confirm proxy.ts-vs-middleware.ts under Next.js 16 (Q2 open).

### Tertiary (LOW confidence — corroboration only)
- Third-party Firestore vector-search tutorials (oneuptime, Medium) — used only to corroborate the official billing/index facts above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH on locked items; MEDIUM on the `ai` v5/v6 pin (registry diverged from TSD) — flagged for SPIKE-AI-SDK.
- Architecture / Next.js 16 APIs: HIGH — verified against bundled version-matched docs (proxy, route handlers, streaming, i18n).
- Firebase vector / security / billing: HIGH — official docs + pricing confirmed.
- Spike outcomes (RAG p95/recall in-region, App Hosting SSE, QStash seam): MEDIUM — unverified in `asia-southeast1`; all have named fallbacks (the reason they are spikes).
- PDPA posture: HIGH on the control set; MEDIUM on G2 residency currency (assumption A3) — confirm with Derek/legal.
- Pitfalls: HIGH on Firebase/Next.js-16 specifics; MEDIUM on multilingual recall (G3, spike-gated).

**Research date:** 2026-05-31
**Valid until:** ~2026-06-30 for stable items; ~2026-06-07 for the AI SDK pin (fast-moving — re-verify the `ai` major before locking the install task).
