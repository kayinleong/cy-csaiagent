# Stack Research — D2 Customer Service AI Agent Platform

**Domain:** Multi-pillar conversational AI (customer-service / agent-coaching) for a Malaysian real-estate brokerage
**Researched:** 2026-05-31
**Overall confidence:** MEDIUM-HIGH (high on locked-in items and well-documented surfaces; medium where Firebase App Hosting / Next.js 16.2 adapter parity is still maturing)

This document is prescriptive within the hard constraints. It is **not** a menu — every primary recommendation is paired with a single named fallback and a confidence rating. Items flagged `SPIKE` must be validated in Phase 0 before Phase 1 build starts.

---

## 1. Recommended Stack — Headline Decisions

| Layer | Pick | Version | Confidence |
|---|---|---|---|
| **Web framework** | Next.js (App Router) | `16.2.6` (already installed — keep) | HIGH (locked) |
| **React** | React | `19.2.4` (already installed) | HIGH (locked) |
| **UI primitives** | shadcn/ui + Radix / Base UI | `radix-ui ^1.4.3` + `@base-ui/react ^1.5.0` + `shadcn ^4.8.3` (already installed) | HIGH (locked) |
| **Styling** | Tailwind v4 | `^4` with `@tailwindcss/postcss` (already installed) | HIGH (locked) |
| **Hosting** | **Firebase App Hosting** in `asia-southeast1` (Singapore) | n/a — region selection at create-time | MEDIUM — Phase 0 SPIKE |
| **Auth** | Firebase Auth + custom claims for `role` | `firebase ^12.13`, `firebase-admin ^13.10` | HIGH |
| **Primary database** | Cloud Firestore (Native mode) in `asia-southeast1` | via `firebase` / `firebase-admin` | HIGH |
| **Vector store** | **Firestore native vector field + KNN** (`FieldValue.vector`, `findNearest`) | Admin SDK v13 / Web SDK v12 | MEDIUM — Phase 0 SPIKE |
| **File storage** | Cloud Storage for Firebase | bucket pinned to `asia-southeast1` | HIGH |
| **Bot/abuse defence** | Firebase App Check (reCAPTCHA Enterprise) | `firebase/app-check` | HIGH |
| **Server config flags** | Firebase Remote Config | Web/Admin SDK | HIGH |
| **Analytics** | Firebase Analytics (GA4) | Web SDK | HIGH |
| **LLM SDK (direct)** | `@anthropic-ai/sdk` (the API SDK — NOT the agent SDK) | `^0.100.1` | HIGH |
| **Default model** | `claude-sonnet-4-6` for everyday turns | n/a | HIGH |
| **Heavy model** | `claude-opus-4-7` for hard cases / evals only | n/a | HIGH |
| **Model abstraction** | Vercel **AI SDK** v5 (`ai` + `@ai-sdk/anthropic`) on top of `@anthropic-ai/sdk` | `ai ^5`, `@ai-sdk/anthropic ^3.0.81` | MEDIUM-HIGH |
| **Embeddings** | **Voyage AI** `voyage-3-large` (1024-d, multilingual) — Anthropic's documented partner | `voyageai` (REST or npm client) | MEDIUM-HIGH |
| **i18n** | `next-intl` v4 | `^4` | HIGH |
| **Validation** | Zod | `^4` | HIGH |
| **Eval framework** | Promptfoo | `^0.x` latest stable | MEDIUM |
| **Scheduled jobs** | **Upstash QStash** (HTTP cron → Next.js Route Handler) | `^2.x` | MEDIUM — Phase 0 SPIKE |
| **Testing** | Vitest + Playwright | `vitest ^2`, `@playwright/test ^1.5x` | HIGH |
| **Logging / telemetry** | OpenTelemetry → Cloud Logging (auto on App Hosting) | n/a | MEDIUM |

---

## 2. Already-Installed Inventory (do not re-pick)

From `/Users/ka.yin.leong/Documents/cy-csaiagent/package.json`:

- `next@16.2.6`, `react@19.2.4`, `react-dom@19.2.4`, `eslint-config-next@16.2.6`, `typescript ^5`
- UI: `@base-ui/react ^1.5.0`, `radix-ui ^1.4.3`, `shadcn ^4.8.3`, `class-variance-authority ^0.7.1`, `clsx ^2.1.1`, `tailwind-merge ^3.6.0`, `tw-animate-css ^1.4.0`, `next-themes ^0.4.6`
- Tailwind: `tailwindcss ^4`, `@tailwindcss/postcss ^4`
- Icons / widgets: `lucide-react ^1.17.0`, `cmdk ^1.1.1`, `sonner ^2.0.7`, `recharts ^3.8.0`, `vaul ^1.1.2`, `embla-carousel-react ^8.6.0`, `react-day-picker ^10.0.1`, `react-resizable-panels ^4.11.2`, `input-otp ^1.4.2`, `date-fns ^4.4.0`

**Implication:** the front-end shell is essentially done at the dependency level. We add only Firebase, AI, i18n, validation, eval, and testing dependencies.

---

## 3. AI / LLM Layer (Question 1)

### 3.1 SDK choice — use BOTH packages, in layers

```
React UI ──► Vercel AI SDK (`ai` v5 + `@ai-sdk/anthropic` v3) ──► [provider abstraction]
                                                                  │
                                                                  ├─► @anthropic-ai/sdk (default)
                                                                  ├─► @ai-sdk/openai (swap)
                                                                  └─► @ai-sdk/google  (swap)
```

- **`@anthropic-ai/sdk` `^0.100.1`** for any escape-hatch needs (raw beta headers, fine-grained prompt-caching control, exotic tool-use shapes). Confidence: HIGH ([npm](https://www.npmjs.com/package/@anthropic-ai/sdk)).
- **`ai` `^5` + `@ai-sdk/anthropic` `^3.0.81`** for the application-level abstraction, streaming, `useChat`, tool-result types, and trivial provider swap. Confidence: MEDIUM-HIGH ([AI SDK 5 blog](https://vercel.com/blog/ai-sdk-5), [@ai-sdk/anthropic on npm](https://www.npmjs.com/package/@ai-sdk/anthropic)).
- **DO NOT** use `@anthropic-ai/claude-agent-sdk` here. That SDK is designed for building Claude-Code-style coding agents with a tightly scoped subagent/MCP loop. Our three pillars are conversational LLM pipelines, not autonomous code-writing agents. ([@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)).

### 3.2 Model selection per pillar

| Pillar / use | Model | Why |
|---|---|---|
| Pillar 1 — Onboarding Coach (default turns) | `claude-sonnet-4-6` | Strong reasoning + low latency + ~$3/M input cost; multilingual handling is excellent; SWE-bench-class reasoning is overkill, conversational coaching is the bar |
| Pillar 2 — Property Finder (ranking / filtered queries) | `claude-sonnet-4-6` | Same — the heavy lifting is RAG retrieval & structured output, not raw reasoning |
| Pillar 3 — Reply Assistant (draft generation) | `claude-sonnet-4-6` | Tone calibration is a prompt + few-shot problem, not a model-capability problem |
| Intent router (which pillar) | `claude-haiku-4-5` if available, else `claude-sonnet-4-6` | Cheap, fast classification |
| **Phase 0 / eval grader** (LLM-as-judge) | `claude-opus-4-7` | Use Opus only as the JUDGE in promptfoo runs, not in production hot path |
| Edge cases / unresolved hard tickets | `claude-opus-4-7` (manual escalation) | Keep behind a feature flag; not the default hot path |

Source: [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Sonnet 4.6 vs Opus 4.7 comparison](https://www.qubrid.com/blog/claude-sonnet-46-vs-claude-opus-47-which-model-wins-for-your-workload). Confidence: HIGH.

**Rule:** never hard-code model strings. All model IDs live in Firebase Remote Config keyed by pillar, e.g. `model.coach.default`, `model.intent_router.default`, `model.grader.eval`. Remote Config refresh interval ≤ 1 hour in production.

### 3.3 Streaming approach

- **Server → Client:** Use the AI SDK's `streamText` in a Next.js Route Handler. AI SDK v5 emits **Server-Sent Events (SSE)** which `useChat`/`useCompletion` consume directly. ([AI SDK 5 blog](https://vercel.com/blog/ai-sdk-5))
- **Why SSE not WebSocket:** SSE works through CDNs, App Hosting, and Cloud Run with no extra config; WebSocket would require bidirectional state.
- **Next.js 16 specifics:** the streaming docs explicitly warn that proxies/CDNs can buffer SSE — set `X-Accel-Buffering: no` (already documented in `node_modules/next/dist/docs/01-app/02-guides/streaming.md`) and add `Cache-Control: no-cache, no-transform` on the chat route.

### 3.4 Tool-use pattern

- Use AI SDK v5 typed `tool({ description, inputSchema: z.object({...}), execute })`. The `inputSchema` is Zod v4. ([AI SDK 5 blog](https://vercel.com/blog/ai-sdk-5))
- Tools per pillar — keep them **read-only against Firestore**:
  - Coach: `getCheckpointStatus`, `getPlaybookSnippet`, `markCheckpointDone`
  - Finder: `searchProjects(criteria)`, `getProjectDetails(id)`, `attachCollateral(id)`
  - Reply Assistant: `searchSopBySituation`, `getLeadThreadHistory`
- All tool `execute` functions run server-side in the Route Handler. They authenticate as the user via Firebase ID-token verification (no admin bypass).

### 3.5 Prompt-caching strategy

Anthropic prompt caching (`cache_control: { type: "ephemeral" }`) gives ~90% read-cost reduction on cached prefixes; 5-minute TTL standard, 1-hour TTL available since Feb 2026 at extra write cost. ([Prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))

Recommended cache layout, **always in this order** so the cache key prefix is stable:

```
[1] System prompt + pillar persona            ← cache_control: ephemeral (5m)
[2] Static D2 voice/tone guide                ← cache_control: ephemeral (5m)
[3] Static SOP/playbook chunk(s) for context  ← cache_control: ephemeral (5m)
[4] Tool definitions                          ← cache_control: ephemeral (5m)
[5] Conversation history (mutable)            ← NOT cached
[6] Latest user message                       ← NOT cached
```

For the Coach pillar (likely 8K-token persona + 15K-token playbook), expected steady-state input cost drops from ~$0.07/turn to ~$0.007/turn. Pay attention to the 4-cache-breakpoint limit — segments 1+2 can collapse into one breakpoint.

Confidence: HIGH ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Markaicode prompt caching guide](https://markaicode.com/anthropic-prompt-caching-reduce-api-costs/)).

---

## 4. Model Abstraction Layer (Question 2)

**Decision: Use Vercel AI SDK v5 (`ai` + `@ai-sdk/*`). Do not roll our own.**

Reasons:
1. The AI SDK already does exactly what the requirement asks: a unified `generateText` / `streamText` / `tool` API across Anthropic, OpenAI, Google, Bedrock, Mistral, xAI, etc.
2. AI SDK v5 is the first version with **fully typed tool I/O end-to-end** (`UIMessage<Tools>`), which Pillar 2's structured property-match output needs.
3. Reinventing this layer in a 16-week, 2-engineer project is a clear over-spend.

**Caveat:** the AI SDK abstracts away some Anthropic-specific knobs (beta headers, advanced cache_control on tool definitions). For those, drop down to `@anthropic-ai/sdk` directly. AI SDK 5 added tool-level provider options to mitigate this for Anthropic specifically — verify in Phase 0 spike #1.

**Internal interface (in our code):**

```ts
// /lib/ai/provider.ts
import { generateText, streamText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export function modelFor(pillar: "coach" | "finder" | "reply" | "router" | "grader"): LanguageModel {
  const id = remoteConfig().get(`model.${pillar}.default`).asString();
  // start with anthropic; abstraction keeps the switch surface tiny
  return anthropic(id);
}
```

Anywhere we want OpenAI/Gemini, we swap `anthropic(id)` for `openai(id)` / `google(id)` — call-site code does not change.

Confidence: MEDIUM-HIGH. Verify Next.js 16 streaming compatibility with `useChat` in Phase 0 (the SDK is React-19-ready but App-Router-16 corner cases like `proxy.ts` rename can bite).

---

## 5. RAG Pipeline Within the Firebase Constraint (Question 3)

### 5.1 The blunt facts about Firestore vector search

- Firestore has a first-class `FieldValue.vector([...])` type and `findNearest()` KNN query — **callable directly from the Node Admin SDK and the Web SDK**. No Cloud Functions required. ([Firebase docs](https://firebase.google.com/docs/firestore/vector-search))
- Maximum vector dimensions: **2048**. Voyage `voyage-3-large` defaults to 1024, voyage-3 family to 1024 — both fit.
- Distance functions: `EUCLIDEAN`, `COSINE`, `DOT_PRODUCT`. Use `DOT_PRODUCT` with normalised vectors (math equivalent of cosine, faster).
- Limits: max 1000 results per query; **does not support real-time snapshot listeners** (irrelevant for RAG); **requires a vector index** created via gcloud CLI or Console (one-time, ops task — not Cloud Functions).
- Pricing: **1 read per up-to-100 vector entries scanned**. With pre-filters (e.g. `where("locale", "==", "ms")`), real cost is small.

### 5.2 Recommendation: **Firestore vector search is the primary store**

- Embedding generation: **call Voyage AI's HTTPS API from a Next.js Route Handler / Server Action**, get the vector, write it to Firestore with `FieldValue.vector(embedding)`. No Cloud Functions in the loop.
- Retrieval: **call `findNearest()` from the same Next.js Route Handler** that handles the chat turn, before calling Claude.

Why this wins:
- Zero new vendor on the critical path.
- Same database as our application data → joins and filters are trivial (`where("pillar", "==", "coach").where("locale", "==", "ms").findNearest(...)`).
- Same access-control model as everything else (Security Rules).
- Residency stays in `asia-southeast1`.

### 5.3 Fallback if Firestore vector search blows up in Phase 0

**Pinecone Serverless** in `aws-ap-southeast-1` (Singapore). Reasoning:
- Has a Malaysia-adjacent serverless region.
- Pay-per-use, no infra.
- Mature TypeScript SDK.
- Drop-in: change the `embeddings.search()` adapter; everything else unchanged.

**Rejected runners-up:**
- **Upstash Vector** — fine for prototypes, but its Singapore region maturity for production scale at end-of-2026 is unverified.
- **Turbopuffer** — excellent price/perf for cold data, but residency control is weaker than Pinecone Serverless.
- **Qdrant Cloud** — best self-hosted feature set, but no clean Singapore-region serverless tier as of May 2026.
- **pgvector on a managed Postgres** — would introduce a second database; we said no microservice sprawl.

### 5.4 Code shape (illustrative, not final)

```ts
// app/api/chat/route.ts (excerpt)
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { voyageEmbed } from "@/lib/embed/voyage";

const q = await voyageEmbed(userMessage, { model: "voyage-3-large", inputType: "query" });
const snap = await adminDb
  .collection("kb_chunks")
  .where("pillar", "==", "coach")
  .where("locale", "in", [userLocale, "en"]) // fall back to EN
  .findNearest({
    vectorField: "embedding",
    queryVector: FieldValue.vector(q),
    limit: 8,
    distanceMeasure: "DOT_PRODUCT",
  })
  .get();
```

### 5.5 Phase 0 SPIKE — required

`SPIKE-RAG`: Index ~500 chunks across 3 languages, measure:
- p50/p95 latency of `findNearest` at `limit=8`
- Read-op cost per query (kNN entries scanned)
- Behaviour when pre-filter is selective (`where(locale==ms)` then KNN)
- Whether index propagation delay after writes is workable for ops (`< 2 min` is OK)

If p95 > 800 ms or read-cost > 10x naive expectation, switch to the Pinecone Serverless fallback before Phase 1 lock-in.

Confidence: MEDIUM (the API is GA and well documented, but production-scale Singapore-region performance under multilingual filters is something we have not measured).

---

## 6. Knowledge Base Ingestion (Question 4)

Ops (Derek + admin) uses the **admin web app** (a section of the same Next.js app, route-guarded by `role: "admin"`). Flow:

```
Admin UI (Next.js Server Component + Server Action)
    │
    │ 1. Upload PDF/DOCX/TXT/MD via Cloud Storage upload widget
    ▼
Cloud Storage (asia-southeast1, App Check enforced)
    │
    │ 2. Server Action POSTs storage path + metadata
    ▼
Next.js Server Action `ingestDocument()`
    ├─► 3a. Download blob from Storage via Admin SDK
    ├─► 3b. Parse:
    │      • PDF      → `pdfjs-dist` (Node-side)
    │      • DOCX     → `mammoth`
    │      • TXT/MD   → fs read
    │      • Transcript → already text
    ├─► 3c. Chunk (semantic, 400–800 tokens, 50-token overlap) via `llamaindex` / custom splitter
    ├─► 3d. Detect language per chunk (`franc-min`) → store `locale` field
    ├─► 3e. Voyage AI embed each chunk (`voyage-3-large`, `inputType: "document"`)
    ├─► 3f. Write to `kb_chunks` with `FieldValue.vector(embedding)`
    └─► 3g. Write parent doc to `kb_documents` with versioning
```

Why this works without Cloud Functions:
- All steps are I/O — perfectly suited to a long-running Server Action (Cloud Run on App Hosting has a default request timeout of up to 60 minutes; we'll stay well under).
- For very large PDFs (>50 pages), the Server Action streams chunks and uses `after()` to enqueue remaining work for the same request — no separate job runner needed for v1.

**Phase 0 SPIKE-INGEST:** validate that App Hosting's Cloud Run backend allows 5–10 minute Server Action runtimes for a 200-page PDF ingest. If not, split into a "create job + admin polls progress" pattern with QStash-driven HTTP callbacks (see §13).

Libraries to add:
- `pdfjs-dist` `^4.x` — PDF text extraction (NOT `pdf-parse`, which is abandoned)
- `mammoth` `^1.x` — DOCX → text
- `franc-min` `^6.x` — language detection (small enough to run on every chunk)
- `gpt-tokenizer` `^2.x` — token-aware chunking
- `llamaindex` `^0.x` — only if we want their semantic splitter; otherwise hand-roll. Lean: skip llamaindex, write the splitter ourselves; it's <80 LOC.

Confidence: MEDIUM-HIGH.

---

## 7. State / Shared Memory Layer (Question 5) — Firestore Schema Sketch

> Full schema lives in TSD. This is the spine the three agents share.

```
users/{uid}                       (Auth user record mirror)
  ├─ role: "agent" | "senior_coach" | "admin"
  ├─ uplineCoachId: string|null
  ├─ locale: "en" | "ms" | "zh"
  ├─ onboardingState: { phase, checkpoints, lastSeenAt, stalledAt|null }
  └─ createdAt, updatedAt

leads/{leadId}                    (per-lead context — shared by Finder + Reply)
  ├─ agentUid
  ├─ criteria: { budget, type, location, ownStayOrInvest, financing, ... }
  ├─ summary: string              (LLM-maintained running summary)
  ├─ status: "active" | "won" | "lost" | "dormant"
  └─ updatedAt

leads/{leadId}/messages/{msgId}   (the inbound + draft history per lead)
  ├─ direction: "in" | "draftOut" | "sentOut"
  ├─ body, locale, attachments[]
  └─ createdAt

conversations/{convId}            (the chat-surface session, any pillar)
  ├─ uid (agent)
  ├─ activePillar: "coach" | "finder" | "reply" | null
  ├─ leadId: string|null          (link to leads/{} when Finder/Reply active)
  ├─ summary: string              (rolling, refreshed every N turns)
  └─ updatedAt

conversations/{convId}/turns/{turnId}
  ├─ role: "user" | "assistant" | "tool"
  ├─ pillar, content, toolCalls[], toolResults[]
  └─ createdAt, model, tokensIn, tokensOut, cacheHits

kb_documents/{docId}              (source-of-truth document metadata)
  ├─ title, sourceType, ownerUid, locale, storagePath
  ├─ tags: [pillar...], status: "published" | "draft" | "archived"
  └─ version, publishedAt

kb_chunks/{chunkId}               (vector-indexed chunks)
  ├─ docId, pillar, locale
  ├─ text, tokenCount
  ├─ embedding: VectorValue       ← `FieldValue.vector([...])`, 1024-d
  └─ chunkIndex, headingPath

audit_logs/{logId}                (client-related interactions — PDPA)
  ├─ uid, action, leadId|null, redactedSummary, ts
  └─ retentionUntil

stall_alerts/{alertId}            (computed by scheduled job)
  ├─ uid, kind: "checkpoint_overdue" | "no_response", since, escalatedAt|null

evals/{runId}                     (Promptfoo run records)
  └─ {…}
```

How the three pillars share context:
1. **Coach** reads from `users/{uid}.onboardingState` and from `kb_chunks` filtered by `pillar == "coach"`.
2. **Finder** reads from `leads/{leadId}.criteria`, writes ranked matches into a turn record, and re-uses `leads/{leadId}.summary` as input to its system prompt.
3. **Reply Assistant** reads `leads/{leadId}` + last N `messages` + `kb_chunks` filtered by `pillar == "reply"`, drafts go into `leads/{leadId}/messages` with `direction: "draftOut"`.

The cross-pillar handoff is purely Firestore reads — no extra service. The intent router (a Sonnet call) picks the pillar; the chosen pillar's handler queries the schema fields above.

Confidence: HIGH on schema shape; the TSD/architecture doc will lock field types and indexes.

---

## 8. Auth + Authorization (Question 6)

### 8.1 Pieces

| Piece | Tool | Where |
|---|---|---|
| Sign-in | Firebase Auth (Email link primary; Google OAuth secondary) | Web SDK in client; Admin SDK in Route Handlers |
| Role attachment | `setCustomUserClaims(uid, { role })` | Admin SDK, only callable from admin Server Actions |
| Client → server identity | Firebase ID token in `Authorization: Bearer <token>` | Verified server-side per request |
| Server-side enforcement | `getAuth().verifyIdToken(token, true)` | Wrapped in `requireUser(req)` helper |
| Firestore enforcement | Security Rules using `request.auth.token.role` | Rules file in repo |
| Storage enforcement | Storage Rules using `request.auth.token.role` | Rules file in repo |

### 8.2 Custom claim shape

```json
{
  "role": "agent" | "senior_coach" | "admin",
  "uplineCoachId": "uid-of-senior-coach" | null
}
```

Claims refresh on next ID-token refresh (~1 h). For instant role changes (rare), force token refresh on the client: `auth.currentUser.getIdToken(true)`.

### 8.3 Security Rules sketch — Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function isAdmin() { return isSignedIn() && role() == "admin"; }
    function isCoach() { return isSignedIn() && role() == "senior_coach"; }
    function isAgent() { return isSignedIn() && role() == "agent"; }
    function ownsUser(uid) { return isSignedIn() && request.auth.uid == uid; }

    // Agents read their own user doc; coaches read their downline; admins all
    match /users/{uid} {
      allow read: if ownsUser(uid) || isAdmin()
                  || (isCoach() && resource.data.uplineCoachId == request.auth.uid);
      allow update: if ownsUser(uid) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role','uplineCoachId']);
      allow create, delete: if isAdmin();
    }

    // Conversations: owner-only read/write; coaches read downline's; admins all
    match /conversations/{cid} {
      allow read, write: if ownsUser(resource.data.uid)
                          || isAdmin()
                          || (isCoach() && get(/databases/$(database)/documents/users/$(resource.data.uid)).data.uplineCoachId == request.auth.uid);
    }

    // Leads: owner-only
    match /leads/{lid} {
      allow read, write: if ownsUser(resource.data.agentUid) || isAdmin();
    }

    // KB: agents/coaches read published; admins full CRUD
    match /kb_documents/{did} {
      allow read: if isSignedIn() && resource.data.status == "published";
      allow write: if isAdmin();
    }
    match /kb_chunks/{cid} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }

    // Audit log: insert-only by server (admin SDK bypasses rules); read by admins
    match /audit_logs/{id} {
      allow read: if isAdmin();
      allow write: if false;  // only Admin SDK writes
    }
  }
}
```

Confidence: HIGH (the rule pattern is well-established).

---

## 9. Deployment (Question 7)

### 9.1 Decision

**Firebase App Hosting** in `asia-southeast1` (Singapore). Vercel is rejected because:
- Vercel hosts the app in non-Singapore regions by default, breaking the residency posture.
- Two-vendor deployments mean two billing surfaces and two incident channels — a 2-engineer team should not absorb that.
- Cookies/session/admin-SDK setup is identical on App Hosting; Vercel offers no real Next.js feature edge for our use cases.

### 9.2 What works on App Hosting today (May 2026)

- **Next.js 16.2 stable Deployment Adapter API** is supported. Firebase publicly committed to this milestone in March 2026. ([Firebase blog — Next.js Deployment Adapters](https://firebase.blog/posts/2026/03/nextjs-adapters/), [Next.js blog — Across Platforms](https://nextjs.org/blog/nextjs-across-platforms))
- **Server Components**: full support.
- **Server Actions**: full support.
- **Route Handlers with streaming SSE**: supported (Cloud Run backend supports response streaming).
- **`after()`**: supported in principle (Cloud Run graceful-shutdown drain).
- **App Hosting regions**: `asia-southeast1` available since Oct 2025. ([Firebase blog — App Hosting regions](https://firebase.blog/posts/2024/10/app-hosting-regions/))

### 9.3 What is still rough — flag for SPIKE

- **Cache Components (`'use cache'`)** and the **Proxy** (formerly Middleware) are explicitly called out as having "architectural hurdles" outside Vercel. We will **not use `'use cache'` in v1** — we already lean on Firestore for state. We will use `proxy.ts` for locale-prefix redirection only (a lightweight redirect rule). ([Next.js blog — Across Platforms](https://nextjs.org/blog/nextjs-across-platforms))
- **Partial Prerendering (PPR)** — same caveat. Not in scope for v1.
- **Cold starts on Cloud Run**: chat-surface latency on a cold start can be 2–5s. Mitigation: minimum-instances=1 once we start the pilot.

### 9.4 Phase 0 SPIKE-DEPLOY

`SPIKE-DEPLOY`: deploy a thin "hello, stream me 100 tokens from Claude" Next.js 16.2 app to App Hosting in `asia-southeast1`. Measure:
- TTFB on a streamed Route Handler
- Whether `useChat` SSE actually streams chunk-by-chunk (no buffering)
- Cold-start p95 with `minInstances=0` and `minInstances=1`
- Whether environment variables (Anthropic API key) are injected correctly via App Hosting secrets

Confidence: MEDIUM. The pieces are individually documented as supported; we have not yet verified the seam in production.

---

## 10. Multilingual (EN / BM / 中文) (Question 8)

### 10.1 i18n in Next.js 16

**`next-intl` v4** — purpose-built for the App Router and Server Components. ([next-intl on npm](https://www.npmjs.com/package/next-intl), [next-intl 4.0 release](https://next-intl.dev/blog/next-intl-4-0))

- File layout: `app/[locale]/(routes)`. `proxy.ts` (note: was `middleware.ts` pre–Next.js 16) handles locale detection from `Accept-Language` and rewrites/redirects.
- Locales: `en`, `ms`, `zh-Hans` (use `zh-Hans` not `zh` so we can add `zh-Hant` later without breaking).
- Translation files: `/messages/{locale}.json`.
- Server-side translation: `getTranslations()` (async, returns server-only translations).
- Client-side: wrap client components in `<NextIntlClientProvider>` (root layout).

**Reject:**
- `next-i18next` — Pages-router-era, not App-Router-native.
- Native (the docs example) — works for trivial cases but lacks formatting, pluralisation, and ICU support we'll need for BM/ZH.

**Known wart:** `next-intl` currently forces dynamic rendering when `useTranslations` is hit in Server Components — meaning `'use cache'` won't compose cleanly. We are not using `'use cache'` in v1, so this does not bite us.

### 10.2 Multilingual RAG retrieval — ONE index, two query strategies

Recommendation: **one Firestore collection `kb_chunks` with a `locale` field**, not three collections.

Reasons:
- Voyage `voyage-3-large` is **multilingual by design** — embeddings of "deposit" (EN), "deposit" (BM), and "定金" (ZH) cluster correctly.
- A single index means cross-language fallback is trivial: when the user query is BM and only EN chunks exist, the search still finds them.

Query strategy:
1. Detect query locale (server-side, `franc-min`).
2. First pass: `where("locale", "==", userLocale).findNearest(...)`
3. If <3 results above similarity threshold: fall back to `where("locale", "in", [userLocale, "en"]).findNearest(...)`
4. If still empty: drop the locale filter entirely.

Claude itself is fluent in EN/BM/ZH; we do not need to translate the system prompt per language. The system prompt is one EN block that instructs: *"Respond in the same language as the user's most recent message."*

Confidence: MEDIUM-HIGH. Voyage's multilingual quality on Malay specifically is the soft spot — verify in `SPIKE-RAG`.

---

## 11. Observability / Evals (Question 9)

### 11.1 Logging & tracing

- **Cloud Logging**: automatic on App Hosting (Cloud Run captures stdout/stderr). Use structured JSON logs (`{ level, msg, traceId, uid, pillar, tokensIn, tokensOut, model }`).
- **OpenTelemetry**: Next.js 16 has native OTel support via the `instrumentation.ts` file. Configure once to ship spans to Cloud Trace (free quota generous). ([Next.js 16 OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry))
- **Token-usage tracking**: log `tokensIn`, `tokensOut`, `cacheReadTokens`, `cacheWriteTokens` per LLM call to Firestore (`conversations/{cid}/turns/{tid}` schema field). Aggregate daily via a scheduled job (see §13) into `usage_daily/{date}/{uid}` for dashboard reads.
- **PDPA-compliant logging**: NEVER log full user/lead messages to Cloud Logging. Log message IDs and a server-side `redactedSummary` only. Audit logs go to Firestore with retention markers, not to Cloud Logging.

### 11.2 Evals

- **Promptfoo** as the evaluation harness. Declarative YAML, runs in CI, supports Anthropic out of the box. ([promptfoo on GitHub](https://github.com/promptfoo/promptfoo))
- Eval suites per pillar:
  - **Coach**: 30-question golden set, LLM-rubric grader (Opus 4.7), assert factuality against playbook source.
  - **Finder**: 20-criteria-set golden, assert top-3 contains expected project IDs (`contains` assertions).
  - **Reply**: 15 incoming-message golden, LLM-rubric grader for tone + content accuracy.
- Eval grader: **`claude-opus-4-7` as judge** — uses the strongest model where it costs us little (eval runs ≪ production traffic).
- Run on every PR via GitHub Actions; fail PR if pass-rate < threshold.
- Store run results in `evals/{runId}` so dashboard can plot regressions.

**Reject:**
- Braintrust — overkill for a 2-engineer team in 16 weeks; we don't yet need its data-tooling surface. Re-evaluate post-pilot.
- DIY — Promptfoo solves 95% of what we'd build, with battle-tested LLM-rubric grading.

Confidence: MEDIUM (Promptfoo is industry standard, but the eval *content* is the hard part, not the framework).

---

## 12. Real-time Updates (Question 10)

### 12.1 Decision per use case

| Use case | Mechanism | Why |
|---|---|---|
| Chat surface streaming the assistant turn | **SSE from Next.js Route Handler** (via AI SDK `streamText`) | Single direction, native fit |
| Coach dashboard — stall alerts updating live | **Firestore onSnapshot listener** on `stall_alerts` collection, filtered to `where("uid", "in", downlineUids)` | Auth-rule-enforced, no extra server route |
| Coach dashboard — downline progress | **Firestore onSnapshot** on `users` collection filtered to downline | Same |
| Admin KB ingest progress | **SSE from Server Action `streamResponse`** OR Firestore doc with `progress` field + onSnapshot | SSE for the active ingest tab; onSnapshot for navigating away/returning |
| Sonner toast on new lead-thread message | **Firestore onSnapshot** on `leads/{leadId}/messages` | Trivial, free |

### 12.2 Why mix the two

- **SSE** is a *response stream*: it's perfect when the server is generating something *now*.
- **Firestore listeners** are a *state stream*: it's perfect when the server has written something and the client wants to know.

The coach dashboard never "subscribes to a request response" — it subscribes to a state collection. Build a parallel WebSocket/SSE state-broadcaster for that would be redundant given Firestore listeners exist.

### 12.3 Caveat

Firestore listener cost = 1 read per document delivered. Cap dashboard pagination to ≤ 50 docs in the listened window; use cursor-based pagination for older.

Confidence: HIGH.

---

## 13. Background Jobs Replacement (Question 11)

**This is the answer the constraint forces us to give a concrete name to.**

### 13.1 Decision: **Upstash QStash → HTTPS callback to a Next.js Route Handler**

- QStash supports **cron schedules with IANA timezones** (so `Asia/Kuala_Lumpur` works directly).
- QStash signs the callback request — we verify `Upstash-Signature` in the Route Handler before executing.
- The Route Handler does the work *as the platform service account* (using the Firebase Admin SDK), not as any user.
- We can put a long-running ingest behind `after()` if needed (App Hosting supports it).

```ts
// app/api/cron/stall-detection/route.ts
import { Receiver } from "@upstash/qstash";
const receiver = new Receiver({ currentSigningKey: ..., nextSigningKey: ... });

export async function POST(req: Request) {
  const sig = req.headers.get("upstash-signature") ?? "";
  const body = await req.text();
  await receiver.verify({ signature: sig, body });

  // … run stall-detection logic against Firestore
  return new Response("ok");
}
```

### 13.2 Scheduled jobs we need

| Job | Cadence | What it does |
|---|---|---|
| `stall-detection` | hourly | Scan `users` where `onboardingState.stalledAt < now-48h` → write `stall_alerts` |
| `usage-rollup` | daily 02:00 MYT | Aggregate token usage from `conversations/*/turns/*` into `usage_daily/{date}` |
| `eval-regression` | weekly + on-demand | Re-run Promptfoo golden set, write to `evals/{runId}` |
| `kb-reindex-check` | weekly | Detect drift between `kb_documents.updatedAt` and last embed time |

### 13.3 Alternatives evaluated

| Option | Verdict |
|---|---|
| **Cloud Scheduler → HTTPS to Next.js** | Technically GCP and *technically* not on the forbidden list (Scheduler isn't a Firebase SDK service, but it's the same Cloud Scheduler that backs Firebase scheduled functions). Avoid for posture clarity: the constraint reads "any GCP service that isn't surfaced through the Firebase SDK." |
| **Client-driven cron** (the dashboard hits an endpoint on open) | Unreliable; misses overnight. Reject. |
| **`after()` chained from user requests** | OK for *deferred-from-request* work (already used in §6 ingest). Cannot replace true scheduled jobs. |
| **cron-job.org / EasyCron** | Free, but no signing, no TZ handling for paid features, no JS SDK. Worse DX than QStash. |
| **Vercel Cron** | Vercel-only; we're not on Vercel. Reject. |

### 13.4 Phase 0 SPIKE-CRON

Verify QStash → App Hosting in `asia-southeast1`: latency, signature verification on the App Hosting URL, retry behaviour on 5xx. Confidence: MEDIUM. We have a clear answer; we have not verified the seam in our region.

---

## 14. Specific Package Versions (Question 12)

Verified May 2026 unless noted.

### 14.1 Add to `dependencies`

```bash
npm install \
  firebase@^12.13 \
  firebase-admin@^13.10 \
  @anthropic-ai/sdk@^0.100 \
  ai@^5 \
  @ai-sdk/anthropic@^3 \
  voyageai@^0 \
  next-intl@^4 \
  zod@^4 \
  pdfjs-dist@^4 \
  mammoth@^1 \
  franc-min@^6 \
  gpt-tokenizer@^2 \
  @upstash/qstash@^2
```

### 14.2 Add to `devDependencies`

```bash
npm install -D \
  vitest@^2 \
  @vitest/ui@^2 \
  @playwright/test@^1.5 \
  promptfoo@latest \
  @types/node@^20
```

### 14.3 Version notes & compatibility

| Package | Version | Notes & source |
|---|---|---|
| `next` | `16.2.6` already installed | Locked. Adapter API GA in 16.2. |
| `react` / `react-dom` | `19.2.4` already installed | Required for AI SDK v5 streaming. |
| `firebase` (Web SDK) | `^12.13` | Latest stable May 2026 ([npm](https://www.npmjs.com/package/firebase), [Firebase JS SDK releases](https://github.com/firebase/firebase-js-sdk/releases)). |
| `firebase-admin` | `^13.10` | Latest May 2026 ([npm](https://www.npmjs.com/package/firebase-admin)). Use Node 22+ runtime — Node 18/20 deprecated. |
| `@anthropic-ai/sdk` | `^0.100.1` | ([npm](https://www.npmjs.com/package/@anthropic-ai/sdk)) |
| `ai` | `^5` | AI SDK 5 — SSE-based streaming, typed tools ([blog](https://vercel.com/blog/ai-sdk-5)). |
| `@ai-sdk/anthropic` | `^3.0.81` | Latest ([npm](https://www.npmjs.com/package/@ai-sdk/anthropic)). |
| `voyageai` | `^0.x` (Node client; or use REST) | Anthropic's documented embedding partner ([Anthropic cookbook](https://github.com/anthropics/claude-cookbooks/blob/main/third_party/VoyageAI/how_to_create_embeddings.md)). Move to `voyage-4` if a Phase 0 spike shows it's worth the migration. |
| `next-intl` | `^4` | App-Router-native ([npm](https://www.npmjs.com/package/next-intl), [4.0 release](https://next-intl.dev/blog/next-intl-4-0)). |
| `zod` | `^4` | 100x faster validation, 57% smaller bundle ([blog](https://pristren.com/blog/zod-v4-validation-guide/)). |
| `@upstash/qstash` | `^2` | Cron + signed-callback delivery ([Upstash docs](https://upstash.com/docs/qstash/features/schedules)). |
| `promptfoo` | latest | YAML-driven evals + Anthropic-native judge ([GitHub](https://github.com/promptfoo/promptfoo)). |
| `vitest` | `^2` | Node + JSDOM tests for adapters/helpers. |
| `@playwright/test` | `^1.5x` | E2E for chat surface, admin app, coach dashboard. |

### 14.4 Removed / not adding

- `langchain` / `langgraph` — over-abstracts; AI SDK + Anthropic SDK + our own pillar handlers are clearer for 3 pillars.
- `tiktoken` — replaced by `gpt-tokenizer` (pure JS, no native build).
- `pdf-parse` — abandoned package; use `pdfjs-dist`.
- `axios` — `fetch` is in the runtime; no extra HTTP client needed.
- `@google-cloud/aiplatform`, `@google-cloud/firestore`, `@google-cloud/storage` — direct GCP SDKs are out of scope.

---

## 15. Alternatives Considered

| Recommended | Alternative | Use the alternative when |
|---|---|---|
| Firestore vector search | Pinecone Serverless (ap-southeast-1) | `SPIKE-RAG` shows >800ms p95 or read-cost blow-up |
| Voyage `voyage-3-large` embeddings | OpenAI `text-embedding-3-large` (3072-d, needs reduction to ≤2048) | Voyage's BM quality scores < OpenAI's in spike eval |
| Vercel AI SDK v5 abstraction | Roll own thin wrapper over `@anthropic-ai/sdk` | AI SDK introduces a Next.js 16 streaming bug we can't work around in Phase 0 |
| Upstash QStash | Cloud Scheduler → App Hosting URL | We get a written exception to the GCP constraint |
| Firebase App Hosting | Vercel + Firebase (residency loss) | App Hosting fails `SPIKE-DEPLOY` on streaming OR an executive overrides residency |
| `next-intl` v4 | `paraglide-next` | Translation file size becomes a bundle-budget issue |
| Promptfoo | Braintrust (managed) | Post-pilot, when we want a hosted eval workspace with team review UX |
| Anthropic prompt caching (ephemeral 5m) | Anthropic prompt caching (1h) | Production traffic shows cache invalidation more often than 5m |

---

## 16. What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| Google Cloud Functions / Cloud Run (direct) / Cloud Functions for Firebase | Hard constraint forbids them | All server logic in Next.js Route Handlers / Server Actions on App Hosting |
| Vertex AI (any flavour) | Hard constraint forbids non-Firebase GCP | Voyage AI for embeddings; Anthropic for generation |
| Pub/Sub, BigQuery, Cloud Tasks | Hard constraint forbids non-Firebase GCP | Firestore for state; QStash for scheduled HTTP triggers; Firestore aggregation queries for analytics |
| `@anthropic-ai/claude-agent-sdk` | Designed for autonomous-coding agents; wrong shape for conversational LLM pillars | `@anthropic-ai/sdk` + Vercel AI SDK |
| Realtime Database | Firestore covers our needs; two-database split is wasted complexity | Firestore listeners |
| `middleware.ts` (the old name) | Renamed to `proxy.ts` in Next.js 16 — `middleware.ts` will not be picked up | `proxy.ts` |
| `'use cache'` directive in v1 | Adapter parity outside Vercel is still rough; next-intl interaction is unresolved | Firestore as the cache of record; `cacheLife` only inside helper functions extracted from Route Handlers |
| WebSocket layer | SSE + Firestore listeners cover every realtime need | SSE for streamed responses; Firestore listeners for state |
| `pdf-parse` | Abandoned, security issues | `pdfjs-dist` |
| `langchain` for orchestration | Adds abstractions we'll fight more than use, for only 3 pillars | Hand-roll thin pillar handlers calling AI SDK directly |
| Auto-sending WhatsApp messages / WABA in v1 | Hard product constraint; reputational risk | Paste-and-draft only |
| Logging raw user/lead message content | PDPA violation risk | Log message IDs + server-side redacted summary |

---

## 17. Stack Patterns by Variant

**If `SPIKE-RAG` succeeds (Firestore vector p95 < 800ms):**
- Single-vendor data plane; Firestore for state + vectors. This is the path we plan for.

**If `SPIKE-RAG` fails:**
- Move vectors to Pinecone Serverless (`aws-ap-southeast-1`). Keep all *application* state in Firestore. Embedding generation logic does not change; only the `vectorStore.upsert/search` adapter changes.

**If `SPIKE-DEPLOY` shows App Hosting can't sustain streaming:**
- Fall back to Vercel for the front-end with the same Firebase backends. Document the residency trade-off in writing for Derek's sign-off before doing this.

**If we hit AI SDK v5 + Next.js 16 incompatibility we can't work around:**
- Drop to `@anthropic-ai/sdk` direct for the chat route, write our own SSE encoder. Keep AI SDK in unaffected places (tools, structured-output).

**If model costs blow budget in pilot:**
- Move the *router* and *Reply Assistant* to `claude-haiku-4-5`; keep Coach + Finder on Sonnet 4.6.

---

## 18. Version Compatibility Matrix

| Package A | Compatible with | Note |
|---|---|---|
| `next@16.2.6` | `react@19.2.4` | Already verified — App Router uses React canary internally regardless |
| `next@16.2.6` | `next-intl@^4` | Yes; `proxy.ts` (not `middleware.ts`) is the new file name |
| `ai@^5` + `@ai-sdk/anthropic@^3` | `react@19.2.4` | Verified per AI SDK 5 announcement |
| `firebase@^12.13` (Web) | `firebase-admin@^13.10` (Node) | Wire-protocol compatible; both target Firestore vector field |
| `firebase-admin@^13.10` | Node `>=22` | Node 18/20 deprecated as of 2026 |
| Voyage `voyage-3-large` (1024-d) | Firestore vector field (max 2048-d) | Fits comfortably |
| Voyage `voyage-4` family (variable) | Firestore vector field | Only certain configs ≤ 2048; verify per-model |
| `zod@^4` | AI SDK v5 `tool()` `inputSchema` | Yes — AI SDK v5 typed-tool flow uses Zod v4 standard-schema |
| `next-intl@^4` | `'use cache'` directive | Known mutual-exclusion when `useTranslations` in Server Components → we don't use `'use cache'` in v1, so fine |

---

## 19. Confidence Summary and Phase 0 Spike List

| Item | Confidence | Phase 0 spike? |
|---|---|---|
| Next.js 16 + React 19 + shadcn/Tailwind base | HIGH | — |
| Anthropic SDK + Vercel AI SDK as model abstraction | MEDIUM-HIGH | `SPIKE-AI-SDK` recommended (small) |
| Claude model tiering (Sonnet default, Opus eval-judge, optional Haiku router) | HIGH | — |
| Prompt caching layout | HIGH | — |
| **Firestore vector search as primary RAG** | **MEDIUM** | **`SPIKE-RAG` required** |
| Voyage embeddings (BM/ZH quality) | MEDIUM | folded into `SPIKE-RAG` |
| **Firebase App Hosting in asia-southeast1 with streaming SSE** | **MEDIUM** | **`SPIKE-DEPLOY` required** |
| Firestore schema spine | HIGH | — |
| Custom claims + security rules pattern | HIGH | — |
| `next-intl` v4 | HIGH | — |
| **QStash → Next.js for scheduled jobs in our region** | **MEDIUM** | **`SPIKE-CRON` required** |
| Promptfoo for evals | MEDIUM | — |
| App Check (reCAPTCHA Enterprise) on Route Handlers | MEDIUM | small spike folded into `SPIKE-DEPLOY` |
| PDF/DOCX ingest in a Server Action (long-running) | MEDIUM | `SPIKE-INGEST` recommended |

**Three required Phase 0 spikes**: `SPIKE-RAG`, `SPIKE-DEPLOY`, `SPIKE-CRON`. Two recommended: `SPIKE-AI-SDK`, `SPIKE-INGEST`. Each spike should be a half-day at most; total Phase 0 spike budget ~3 engineering days.

---

## 20. Sources

Primary documentation and reference material consulted (with confidence weight applied):

**Authoritative (HIGH weight):**
- Next.js bundled docs at `node_modules/next/dist/docs/01-app/02-guides/*.md` (deploying-to-platforms, self-hosting, streaming, ai-agents, internationalization) and `01-app/01-getting-started/15-route-handlers.md`. These shipped with `next@16.2.6` and are version-matched.
- [Anthropic Models Overview — platform.claude.com](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic Prompt Caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Firebase docs — Vector search](https://firebase.google.com/docs/firestore/vector-search)
- [Firebase docs — Hosting Next.js](https://firebase.google.com/docs/hosting/frameworks/nextjs) and [App Hosting](https://firebase.google.com/docs/app-hosting)
- [Firebase docs — Custom claims & security rules](https://firebase.google.com/docs/auth/admin/custom-claims)
- [next-intl docs — App Router setup](https://next-intl.dev/docs/getting-started/app-router) and [4.0 release notes](https://next-intl.dev/blog/next-intl-4-0)
- [Upstash QStash — Schedules](https://upstash.com/docs/qstash/features/schedules)
- [Promptfoo on GitHub](https://github.com/promptfoo/promptfoo)
- [npm: @anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) (v0.100.1)
- [npm: ai](https://www.npmjs.com/package/ai), [npm: @ai-sdk/anthropic](https://www.npmjs.com/package/@ai-sdk/anthropic) (v3.0.81)
- [npm: firebase](https://www.npmjs.com/package/firebase) (v12.13), [npm: firebase-admin](https://www.npmjs.com/package/firebase-admin) (v13.10)
- [Anthropic Cookbooks — Voyage AI embeddings](https://github.com/anthropics/claude-cookbooks/blob/main/third_party/VoyageAI/how_to_create_embeddings.md)

**Supplementary (MEDIUM weight):**
- [AI SDK 5 announcement — Vercel](https://vercel.com/blog/ai-sdk-5)
- [Firebase blog — Next.js Deployment Adapters, March 2026](https://firebase.blog/posts/2026/03/nextjs-adapters/)
- [Next.js blog — Across Platforms](https://nextjs.org/blog/nextjs-across-platforms)
- [Firebase blog — App Hosting GA](https://firebase.blog/posts/2025/04/apphosting-general-availability/) and [App Hosting regions](https://firebase.blog/posts/2024/10/app-hosting-regions/)
- [Sonnet 4.6 vs Opus 4.7 — qubrid.com](https://www.qubrid.com/blog/claude-sonnet-46-vs-claude-opus-47-which-model-wins-for-your-workload)
- [Zod 4 — pristren.com](https://pristren.com/blog/zod-v4-validation-guide/)
- [Anthropic prompt caching guide — markaicode.com](https://markaicode.com/anthropic-prompt-caching-reduce-api-costs/)

**Cross-checked (LOW weight, used only to corroborate):**
- Third-party comparison and tutorial posts (kalyna.pro, oneuptime.com, aistackchoice.com, knightli.com) — used to confirm claims already supported by primary sources.

---

*Stack research for: multi-pillar conversational AI platform for a Malaysian real-estate brokerage*
*Researched: 2026-05-31*
*Author: gsd-researcher agent*
