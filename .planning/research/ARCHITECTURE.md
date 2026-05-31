# Architecture Research

**Domain:** Multi-pillar conversational AI platform (real-estate sales enablement)
**Researched:** 2026-05-31
**Confidence:** HIGH for the Next.js + Firebase plumbing; HIGH for the scheduled-job recommendation; MEDIUM for the agent-routing patterns (LLM ecosystem moves fast, validate at build time).

---

## 1. System Overview

The system is a single Next.js 16 monolith deployed to Firebase App Hosting, with Firestore as the system of record (including the vector index), Firebase Storage for binary assets, Firebase Auth for identity, and exactly one external dependency (Upstash QStash) to fill the scheduled-jobs gap that the no-Cloud-Functions constraint creates.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (mobile-first PWA + admin web + senior-coach dashboard)             │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │ Chat UI    │  │ Admin UI   │  │ Coach Dashboard│  │ Onboarding UI    │   │
│  └─────┬──────┘  └─────┬──────┘  └────────┬───────┘  └────────┬─────────┘   │
└────────┼───────────────┼──────────────────┼───────────────────┼─────────────┘
         │ HTTPS (SSE for streamed chat)    │                   │
┌────────┴───────────────┴──────────────────┴───────────────────┴─────────────┐
│  NEXT.JS 16 APP (App Hosting, Cloud Run under the hood)                     │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Edge: proxy.ts (locale detection, auth gate, rate limit headers)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │ Route Hdlrs │ │ Server       │ │ Server       │ │ /api/jobs/* (cron  │   │
│  │ /api/chat   │ │ Components   │ │ Actions      │ │  endpoints, QStash │   │
│  │ /api/kb/*   │ │ (RSC)        │ │ (mutations,  │ │  signed)           │   │
│  │ /api/stream │ │              │ │  forms)      │ │                    │   │
│  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘ └─────────┬──────────┘   │
│         │               │                │                   │              │
│  ┌──────┴───────────────┴────────────────┴───────────────────┴──────────┐   │
│  │  Application core (TypeScript, framework-agnostic)                   │   │
│  │  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │   │
│  │  │ agents/  │ │ router │ │ rag/   │ │ memory │ │ kb/    │ │ evals/ │ │   │
│  │  └────┬─────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ │   │
│  │  ┌────┴──────────┴──────────┴──────────┴──────────┴──────────┴────┐ │   │
│  │  │  llm/ (provider abstraction: Claude default, swappable)        │ │   │
│  │  └──┬─────────────────────────────────────────────────────────────┘ │   │
│  │  ┌──┴─────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────────────┐ │   │
│  │  │ escalation │ │ audit       │ │ ratelimit    │ │ i18n           │ │   │
│  │  └────────────┘ └─────────────┘ └──────────────┘ └────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────┬──────────────────────────────┬───────────────┬────────────────────┘
          │                              │               │
┌─────────┴────────────┐  ┌──────────────┴───────┐  ┌────┴──────────────────┐
│  FIREBASE (system of │  │  ANTHROPIC API       │  │  UPSTASH QSTASH       │
│  record + edge)      │  │  (Claude Sonnet, via │  │  (scheduler + signed  │
│                      │  │  AI SDK)             │  │  webhook delivery)    │
│  • Auth + custom     │  │                      │  │                       │
│    claims (RBAC)     │  │  Provider-abstracted │  │  Cron expressions     │
│  • Firestore         │  │  through llm/        │  │  hit /api/jobs/*      │
│    + vector search   │  └──────────────────────┘  │  with HMAC signature  │
│  • Storage (KB PDFs, │                            └───────────────────────┘
│    project posters)  │
│  • App Hosting       │
│    (host this app)   │
└──────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `agents/` | One specialist per pillar — Coach, Finder, Reply. Each owns: system prompt, allowed tools, output schema, hand-off rules. | TS modules exporting an `Agent` interface (`name`, `systemPrompt`, `tools`, `handle(ctx, messages)`). |
| `router/` | Intent classifier that picks an agent for a turn. Returns `{ agent, confidence, reasoning }`. Also detects hand-off mid-conversation. | v1: keyword heuristic + LLM-as-classifier fallback (small prompt, structured output). Pluggable so v2 can swap to an embedding-based router. |
| `memory/` | Shared lead/agent context store. Single Firestore-backed read/write API across all three agents. | Repository pattern over Firestore. `getLeadContext(leadId)`, `appendAgentTurn(...)`, `recordCheckpoint(...)`. |
| `rag/` | Embedding generation, vector search, retrieval, citation building. KB-agnostic — works for Coach KB, Reply SOPs, project metadata embeddings. | Firestore vector fields (native, no Pinecone), top-k cosine, MMR rerank step. Embeddings generated via Anthropic-compatible provider OR Voyage AI (decide in Phase 0 spike). |
| `kb/` | KB ingestion (chunking, embedding, indexing), versioned CRUD, admin surfaces. Chunking strategy lives here, not in `rag/`. | Server Actions for admin CRUD, client-driven chunked ingestion for large PDFs (see §3). |
| `evals/` | Prompt regression tests, conversation-quality scoring, golden-set runner, drift detection. | Vitest harness + a CLI runner. Stored fixtures in `evals/fixtures/`. Runs in CI + nightly via QStash. |
| `escalation/` | Stall detection (2-day no-progress, 48h no-response), routing to senior coach queue, AI-disclosure copy. | Pure logic over `memory/` + Firestore writes. Triggered by QStash cron, not Firestore triggers. |
| `audit/` | PDPA audit log on every client-related conversation; immutable append-only collection. | Single `auditLogs/` collection with security rules forbidding update/delete; writes via `after()` so they don't block responses. |
| `llm/` | Model abstraction. `generate({ messages, tools, model, stream })` returning either a string or an `AsyncIterable<chunk>`. | Vercel AI SDK 5+ with `@ai-sdk/anthropic` provider. Fake provider implementation for tests. |
| `ratelimit/` | Per-user-per-agent token & request quotas. Burst protection. | Firestore counters + sliding-window logic in middleware; reject before LLM call if over. |
| `i18n/` | Language detection (header + cookie + explicit setting), dictionary loading, RAG language steering. | `app/[lang]/` segment + `getDictionary(lang)` helper. KB documents are tagged with `lang`, retrieval filters by it. |

**Refinements to the suggested module list:**

- **Add `llm/`** as its own first-class module. The user's "model-agnostic architecture" requirement is non-trivial and deserves a dedicated abstraction layer; do not bury it inside `agents/`.
- **Add `ratelimit/`** as its own module. Cost/abuse control on AI calls is non-optional given a paid Anthropic backend and 400 agents at full rollout.
- **Add `i18n/`** as its own module. EN/BM/中文 is a day-one requirement that affects routing, retrieval, prompts, and UI; it needs a coherent home.
- **Merge nothing yet.** Each of the originally-suggested modules earns its keep. Resist the urge to fold `escalation/` into `coach/` — escalation runs scheduled, not turn-by-turn, and is shared across pillars (a stuck Finder lead also escalates).

---

## 2. Recommended Project Structure

```
cy-csaiagent/
├── app/                                    # Next.js App Router (UI surfaces)
│   ├── [lang]/                             # i18n segment (en, ms, zh)
│   │   ├── (chat)/                         # Agent-facing chat UI
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                    # Single chat surface
│   │   │   └── leads/[leadId]/page.tsx     # Lead-scoped chat
│   │   ├── (coach)/                        # Senior-coach dashboard
│   │   │   ├── downline/page.tsx
│   │   │   └── stalls/page.tsx
│   │   ├── (admin)/                        # Admin web app
│   │   │   ├── kb/page.tsx
│   │   │   ├── projects/page.tsx
│   │   │   └── evals/page.tsx
│   │   └── layout.tsx
│   ├── api/                                # Route Handlers
│   │   ├── chat/route.ts                   # Streaming chat endpoint (SSE)
│   │   ├── kb/
│   │   │   ├── upload/route.ts             # KB upload initiation
│   │   │   └── chunks/route.ts             # Client-driven chunk ingest
│   │   ├── jobs/                           # QStash-invoked (signed)
│   │   │   ├── detect-stalls/route.ts
│   │   │   ├── weekly-digest/route.ts
│   │   │   └── eval-suite/route.ts
│   │   └── webhooks/
│   │       └── escalation-ack/route.ts
│   └── proxy.ts                            # Edge proxy: locale + auth gate
├── src/                                    # Application core (no Next.js imports here)
│   ├── agents/
│   │   ├── coach/
│   │   │   ├── prompt.ts
│   │   │   ├── tools.ts                    # retrieve-kb, mark-checkpoint, etc.
│   │   │   └── index.ts                    # exports Agent
│   │   ├── finder/
│   │   │   ├── prompt.ts
│   │   │   ├── tools.ts                    # match-projects, fetch-collateral
│   │   │   └── index.ts
│   │   ├── reply/
│   │   │   ├── prompt.ts
│   │   │   ├── tools.ts                    # retrieve-sop, get-lead-thread
│   │   │   └── index.ts
│   │   └── shared/                         # AI-disclosure copy, handoff helpers
│   ├── router/
│   │   ├── heuristic.ts                    # Keyword/regex fast path
│   │   ├── classifier.ts                   # LLM fallback (structured output)
│   │   ├── handoff.ts                      # Mid-conversation pillar switching
│   │   └── index.ts
│   ├── llm/
│   │   ├── provider.ts                     # Anthropic via AI SDK
│   │   ├── fake.ts                         # Test double
│   │   ├── types.ts                        # generate(), Stream, Tool
│   │   └── index.ts
│   ├── memory/
│   │   ├── conversation.ts                 # messages, summaries
│   │   ├── leadContext.ts                  # cross-agent lead state
│   │   ├── agentProfile.ts                 # the user-agent's profile (the real-estate person)
│   │   └── index.ts
│   ├── rag/
│   │   ├── embed.ts                        # Voyage AI or Anthropic embeddings
│   │   ├── search.ts                       # Firestore vector query + MMR
│   │   ├── citations.ts                    # Map chunks to user-visible refs
│   │   └── index.ts
│   ├── kb/
│   │   ├── ingest/
│   │   │   ├── chunker.ts
│   │   │   ├── pdf.ts                      # PDF → text
│   │   │   └── pipeline.ts                 # Orchestrates chunked ingest
│   │   ├── crud.ts                         # Versioned KB CRUD
│   │   └── index.ts
│   ├── evals/
│   │   ├── harness.ts
│   │   ├── scorers/
│   │   │   ├── faithfulness.ts
│   │   │   ├── d2-voice.ts
│   │   │   └── helpfulness.ts
│   │   ├── fixtures/                       # Golden conversations
│   │   └── runner.ts                       # CI + scheduled invocation
│   ├── escalation/
│   │   ├── detect.ts                       # Stall detection rules
│   │   ├── route.ts                        # Assign to senior coach
│   │   └── index.ts
│   ├── audit/
│   │   ├── log.ts                          # Append-only writer
│   │   └── pdpa.ts                         # Redaction helpers
│   ├── ratelimit/
│   │   ├── window.ts
│   │   └── index.ts
│   ├── i18n/
│   │   ├── dictionaries/                   # en.json, ms.json, zh.json
│   │   ├── detect.ts
│   │   └── index.ts
│   └── firebase/
│       ├── admin.ts                        # Server SDK
│       ├── client.ts                       # Client SDK
│       └── collections.ts                  # Typed collection refs
├── components/                             # shadcn UI primitives (existing)
├── hooks/                                  # Client React hooks
├── lib/                                    # UI-adjacent utilities (existing)
└── tests/
    ├── unit/                               # Vitest
    └── eval-fixtures/                      # Mirror of src/evals/fixtures
```

### Structure Rationale

- **`app/` for surfaces, `src/` for core.** Keeping the application core out of `app/` makes it testable without spinning up Next, makes the LLM/router/memory layers reusable across Route Handlers and Server Actions, and prevents accidental import of `react-server-dom` or Next-specific APIs in code that should be pure.
- **`agents/<name>/{prompt,tools,index}`** is the right granularity. Prompts and tools change together; keeping them colocated avoids the "edit prompt in one file, tool schema in another, miss the contract" failure mode.
- **Single `app/[lang]/` segment**, not three apps. EN/BM/中文 share UX and 95% of code; only the dictionary and the RAG language filter differ.
- **`app/api/jobs/` for scheduled work** (not co-located with the domain modules) makes the cron surface auditable in one place and easy to allowlist with QStash signature verification middleware.
- **`src/firebase/collections.ts`** is the single source of truth for typed collection refs — pays for itself the first time you need to rename a field.

---

## 3. Server-Side Execution Model (without Cloud Functions)

This is the most constrained dimension. Every piece of "server logic" must fit one of: Route Handler, Server Action, Server Component, proxy. We must answer three concrete questions.

### 3.1 LLM streaming

**Recommendation:** Next.js Route Handler returning a `ReadableStream` via the Vercel AI SDK (`@ai-sdk/anthropic` + `streamText`).

- Why Route Handler, not Server Action: Server Actions are RPC-style with a request/response shape and do not stream incremental tokens cleanly to the browser. Route Handlers using `ReadableStream` (or `result.toDataStreamResponse()` from AI SDK) give you Server-Sent Events for free and integrate with the `useChat()` client hook.
- Why AI SDK, not raw `fetch` to Anthropic: tool-calling, multi-step reasoning (`maxSteps`), structured output, and provider swap all become one-line changes. Worth the dependency.
- Runtime: **Node.js runtime** (default), not Edge. Firebase App Hosting runs on Cloud Run; the Edge runtime adds restrictions (no Node APIs) without benefit here.
- Set `maxDuration` per route. App Hosting Cloud Run requests can go up to 60 minutes, but we should cap chat routes at 60-90 seconds — anything longer is a runaway and should be rate-limited.

```typescript
// app/api/chat/route.ts (sketch)
export const maxDuration = 90;
export async function POST(req: Request) {
  const { messages, leadId } = await req.json();
  const userId = await requireAuth(req);
  await ratelimit.check(userId, "chat");

  const agentChoice = await router.route(messages, await memory.getLeadContext(leadId));
  const agent = agents[agentChoice.agent];

  const result = streamText({
    model: llm.getModel(agent.model),
    system: agent.systemPrompt,
    messages: await memory.assembleContext(leadId, messages, agent),
    tools: agent.tools,
    onFinish: async (final) => {
      await memory.appendAgentTurn(leadId, agent.name, final);
      after(() => audit.log({ userId, leadId, agent: agent.name, ... }));
    },
  });
  return result.toDataStreamResponse();
}
```

### 3.2 Long-running operations (e.g., embedding a 100-page PDF)

**Recommendation: Chunked, client-driven ingestion. The browser drives a "queue → process N chunks per request → poll for completion" pattern.**

The alternatives and why they lose:

| Approach | Why it loses |
|----------|-------------|
| One big `POST` that processes the whole PDF | Will exceed Cloud Run request timeout (and even within timeout, blows your maxDuration budget and burns memory). |
| Firestore-triggered Cloud Function | Banned by constraint. |
| External worker (own VM / Cloud Run job) | Adds infrastructure surface the project explicitly avoids; "monolith Next.js + Firebase" is a stated constraint. |
| `after()` for embedding work | Still subject to the request's maxDuration cap. Use for analytics-shaped fire-and-forget under 30s, not minutes-long work. |

The pattern:

1. Admin uploads PDF → goes to Firebase Storage.
2. Server Action creates `kbIngestionJobs/{jobId}` with `status: "queued"` and shards the PDF into chunk records (page ranges, ~5 pages per chunk).
3. Browser polls `/api/kb/ingest/process?jobId=...&limit=3` repeatedly. Each call:
   - Reads next `limit` queued chunks from Firestore
   - Extracts text, generates embeddings (parallel, capped concurrency), writes `kbChunks` docs
   - Marks chunks `done`
   - Returns `{ remaining: N }` to the client
4. Client loops until `remaining: 0`, then marks job complete.
5. If the browser tab closes mid-ingest, the next admin to open the KB page sees the resumable job and can continue it.

This is uglier than a true background queue, but it is the **only** option that respects "no Cloud Functions, no other GCP services, monolith Next.js + Firebase". 100 pages at 5 pages per request × 1-2s per request = well inside any single timeout, and total wall-clock is under 5 minutes for a 100-page PDF. Acceptable for a 2-engineer team and an admin who is initiating the upload anyway.

### 3.3 Scheduled jobs (stall detection, weekly digest, scheduled evals)

**Recommendation: Upstash QStash, calling signed `/api/jobs/*` endpoints.**

The shortlist and the verdict:

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| **Upstash QStash** | **CHOSEN** | HTTP-first scheduler with HMAC-signed webhooks, generous free tier, cron expressions, retries, dead-letter handling. Zero infrastructure to run. Aligns with the "small external dependency to fill a constraint gap" pattern. |
| cron-job.org / EasyCron | Rejected | Free, but no HMAC signing built-in (we'd roll our own), no retry semantics, no dead-letter. Saves $0 and adds operational fragility. |
| Vercel Cron | N/A | We are on Firebase App Hosting, not Vercel. |
| Cloud Scheduler (raw GCP) | Rejected by user constraint | "Firebase services only" excludes free-standing GCP services. (Pragmatically: Cloud Scheduler is what QStash and Cloud Functions both call under the hood, but we honor the stated boundary.) |
| Firestore TTL + listener tricks | Rejected | Clever-but-fragile. TTL deletes a doc; you'd need a Firestore trigger to react, which is a Cloud Function. Dead end. |
| Client-driven (open dashboard fires the job) | Rejected | Will not run when nobody's looking. Stalls happen overnight; nobody is watching at 3am. |

QStash setup is one signing key, one cron expression per job, and a webhook verification helper in middleware. Operationally it is one external account and one shared secret — the smallest possible footprint.

```typescript
// app/api/jobs/detect-stalls/route.ts (sketch)
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
export const maxDuration = 300; // 5 min budget for stall sweep
async function handler(req: Request) {
  const stalled = await escalation.findStalledLeads({ days: 2 });
  for (const lead of stalled) {
    await escalation.notifySeniorCoach(lead);
    await escalation.markEscalated(lead.id);
  }
  return Response.json({ processed: stalled.length });
}
export const POST = verifySignatureAppRouter(handler);
```

**Schedules to register at deploy time:**

- `detect-stalls` — every 6 hours (catches 2-day-stall threshold reliably).
- `auto-escalate` — every 1 hour (catches the 48h no-response window).
- `weekly-digest` — Mondays 08:00 SGT.
- `eval-suite-nightly` — daily 02:00 SGT (off-peak Anthropic billing).

---

## 4. State / Data Model

### 4.1 Firestore collections

```
users/{userId}                          # Mirror of Firebase Auth; minimal
  └─ email, displayName, createdAt, defaultLang

agentProfiles/{userId}                  # The real-estate agent's profile (1:1 with users)
  └─ role: "new-agent" | "senior-coach" | "admin"
     uplineCoachId, downlineAgentIds[], onboardingState: {...},
     preferredLang, joinedAt, lastActiveAt

conversations/{conversationId}
  └─ userId, leadId?, title, createdAt, lastMessageAt,
     activeAgent: "coach" | "finder" | "reply" | null,
     handoffHistory: [{ at, from, to, reason }],
     summary  # rolling summary, refreshed every N turns

conversations/{conversationId}/messages/{messageId}
  └─ role: "user" | "assistant" | "tool", agent?, content,
     toolCalls?, citations?, createdAt,
     usage: { promptTokens, completionTokens, costUSD }

leads/{leadId}                          # PII-bearing; tight rules
  └─ ownerUserId, name (encrypted-at-rest by app), createdAt,
     status, criteria (budget, location, type, ownership),
     financingSituation, segment ("invest"|"own-stay"),
     preferredContactLang

leadContext/{leadId}                    # SHARED across all 3 agents
  └─ summary,                            # latest cross-agent summary
     coachState,                         # checkpoint snapshots if Coach helped here
     finderState: {
       lastCriteria, shortlist[], rejectedProjectIds[], shownCollaterals[]
     },
     replyState: {
       lastThread, toneNotes, draftHistory[]
     },
     lastTouched, lastTouchedBy ("coach"|"finder"|"reply")

projects/{projectId}                    # D2 project inventory
  └─ name, location, completionDate, type, priceFromMYR,
     bedrooms, features[], collateralRefs[], lang variants,
     embedding: vector(1536)              # for Finder semantic match

kbDocs/{kbDocId}                        # Logical document (a PowerBoost session, etc.)
  └─ title, source, lang, ownerCollection ("coach"|"reply"|"shared"),
     version, status ("draft"|"published"|"archived"),
     createdBy, createdAt, publishedAt

kbChunks/{chunkId}                      # The retrievable unit
  └─ kbDocId, kbDocVersion, lang, ownerCollection,
     text, position, embedding: vector(1024 or 1536),
     citationLabel  # e.g., "PowerBoost S3, Lead-Gen Playbook"

evals/{evalRunId}
  └─ suite, ranAt, gitSha,
     results: [{ fixtureId, scorers: {...}, pass: bool }],
     summary: { passRate, regressions[] }

auditLogs/{auditId}                     # Append-only; immutable rules
  └─ at, userId, leadId?, conversationId?, action,
     agent?, prompt_redacted, response_redacted, model, costUSD

escalations/{escalationId}
  └─ leadId, userId (the new agent), seniorCoachId,
     reason ("stall_2d"|"unanswered_48h"|"low_confidence"),
     openedAt, acknowledgedAt?, resolvedAt?, notes

roles/{userId}                          # Optional materialized roles
  └─ admin: bool, seniorCoach: bool, newAgent: bool,
     tenantId  # for multi-tenant readiness

kbIngestionJobs/{jobId}                  # For chunked ingestion (§3.2)
  └─ kbDocId, status, totalChunks, processedChunks, startedBy, startedAt

rateLimits/{userId}_{bucket}             # Sliding-window counters
  └─ tokens[], expiresAt
```

### 4.2 Indexing implications

- **Composite indexes** needed early:
  - `conversations`: `(userId, lastMessageAt desc)`, `(userId, leadId, lastMessageAt desc)`
  - `messages` (sub-collection auto-indexes by parent + ID; usually fine)
  - `leads`: `(ownerUserId, lastUpdated desc)`, `(ownerUserId, status, lastUpdated desc)`
  - `kbChunks`: `(ownerCollection, lang, kbDocVersion)` — used as filter alongside vector query
  - `escalations`: `(seniorCoachId, status, openedAt desc)`, `(userId, openedAt desc)`
  - `auditLogs`: `(userId, at desc)`, `(leadId, at desc)`
- **Vector indexes** (Firestore native, max 2048 dims):
  - `projects.embedding` — KNN over project metadata
  - `kbChunks.embedding` — KNN over knowledge base (with `ownerCollection`, `lang` pre-filters)
  - Important constraint: Firestore vector search does not support real-time snapshot listeners. RAG queries are `get()`-style only; that's fine for retrieval but rules out "live updating RAG results".
- **TTL policies:**
  - `rateLimits/*` — TTL on `expiresAt` (1 day max)
  - `kbIngestionJobs/*` — TTL on `completedAt + 7d`

### 4.3 Security rules patterns (role-based)

Use **Firebase Auth custom claims** for the hot path (`role`, `tenantId`) and a `roles/` collection for the cold path (admin-edited overrides, downline assignments). Custom claims refresh every ~1 hour or on token rotate; that's acceptable for role grants but not for instant revocation, so for "remove access NOW" cases, use a fast-path check against the document.

```javascript
// firestore.rules (sketch)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function tenantId() { return request.auth.token.tenantId; }
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
    function isAdmin() { return role() == "admin"; }
    function isSeniorCoach() { return role() == "senior-coach" || isAdmin(); }
    function downlineOf(coachUid, agentUid) {
      return exists(/databases/$(database)/documents/agentProfiles/$(agentUid))
        && get(/databases/$(database)/documents/agentProfiles/$(agentUid)).data.uplineCoachId == coachUid;
    }

    // Agent profiles: agent reads/edits own; senior coach reads downline; admin all.
    match /agentProfiles/{uid} {
      allow read: if isOwner(uid) || isAdmin()
        || (isSeniorCoach() && downlineOf(request.auth.uid, uid));
      allow write: if isOwner(uid) || isAdmin();
    }

    // Conversations: owner only; senior coach read-only on downline conversations.
    match /conversations/{cid} {
      allow read: if isOwner(resource.data.userId) || isAdmin()
        || (isSeniorCoach() && downlineOf(request.auth.uid, resource.data.userId));
      allow create: if isOwner(request.resource.data.userId);
      allow update, delete: if isOwner(resource.data.userId) || isAdmin();
      match /messages/{mid} {
        allow read: if isOwner(get(/databases/$(database)/documents/conversations/$(cid)).data.userId)
          || isAdmin()
          || (isSeniorCoach() && downlineOf(request.auth.uid,
               get(/databases/$(database)/documents/conversations/$(cid)).data.userId));
        // Writes go through Server Actions/Route Handlers using Admin SDK — block direct client writes.
        allow create, update, delete: if false;
      }
    }

    // KB: admin write, all signed-in read (filter by tenantId/lang in queries).
    match /kbDocs/{id} {
      allow read: if isSignedIn() && resource.data.tenantId == tenantId();
      allow write: if isAdmin();
    }
    match /kbChunks/{id} {
      allow read: if isSignedIn() && resource.data.tenantId == tenantId();
      allow write: if false; // Server-only via Admin SDK
    }

    // Audit logs: immutable. Read = own or admin. Write = server only.
    match /auditLogs/{id} {
      allow read: if isAdmin()
        || (isSignedIn() && resource.data.userId == request.auth.uid);
      allow create, update, delete: if false; // Admin SDK only
    }

    // Leads & leadContext: owner agent or admin.
    match /leads/{id} {
      allow read, write: if isOwner(resource.data.ownerUserId) || isAdmin();
    }
    match /leadContext/{id} {
      allow read: if isSignedIn(); // App-layer filter; tighten if cross-tenant risk
      allow write: if false; // Server-only
    }
  }
}
```

**Set custom claims via Server Action** after admin grants a role:
```typescript
await adminAuth.setCustomUserClaims(uid, { role: "senior-coach", tenantId: "d2" });
// Followed by: client calls auth.currentUser.getIdToken(true) to refresh.
```

### 4.4 Multi-tenant readiness

- **Now (v1):** Single tenant `tenantId: "d2"` baked into every doc. Cheap insurance.
- **Future white-label:** Replace `tenantId: "d2"` with the actual tenant. KB collections become `kbDocs` filtered by `tenantId`. Custom claims carry `tenantId`. Security rules already check `resource.data.tenantId == tenantId()`.
- **Don't do now:** Don't introduce subdomain routing, separate Firebase projects, or per-tenant config sources. That's a Phase 5 problem and over-engineers v1.

---

## 5. Intent Router Design

**Recommendation for v1: Heuristic-first, LLM-classifier-fallback, with a "manual override" chip in the UI as escape hatch.**

```
User sends message
   ↓
Heuristic pass (10ms):
   • If message contains "Hi I got a buyer", "lead has criteria",
     "what projects" → finder
   • If pasted with WhatsApp markers ("06:23 PM", emojis density,
     ">>>" forwards) → reply
   • If first turn of a new conversation AND no leadId → coach
   • If message is short and ambiguous → fallthrough
   ↓
LLM classifier (200-400ms, Claude Haiku):
   System: "Classify the user's intent. Output JSON:
            { agent: 'coach'|'finder'|'reply', confidence: 0-1, why: string }"
   Context: last 3 turns + heuristic guess
   ↓
Confidence < 0.6:
   • Use heuristic guess if it had one
   • Otherwise show a 3-chip UI: [Coach] [Finder] [Reply]
   ↓
Pick agent → process turn
```

**Why this over the alternatives:**

| Alternative | Why not (yet) |
|-------------|---------------|
| LLM-only classification every turn | Latency tax on every message (200-400ms before the real LLM starts), and burns tokens on classification when 70%+ of turns are obvious. |
| Pillar-explicit UI (chips only) | UX cost. Requirement says "single chat surface" — three chips is barely a single surface. Use chips as escape hatch, not primary route. |
| Pure heuristic | Won't scale beyond simple keywords; can't catch "Should I send this to her?" (Reply) vs "What should I tell her?" (Coach). |
| Embedding-based router | More work to build; defer to v2 if classification accuracy is a measured problem. |

**Upgrade path:** in Phase 2 or later, collect mispredictions from chip-overrides as training data. When you have ~200 labeled examples, switch the LLM-classifier step to a small fine-tuned classifier or an embedding-based one.

**Sticky agent behavior:** once routed to an agent, stay there until (a) a clear topic shift (LLM-classifier sees >0.8 confidence for a different agent) or (b) the user hits a chip. Don't re-route turn by turn — that creates whiplash.

---

## 6. Shared Memory Layer

The `leadContext/{leadId}` document is the answer. Minimum schema:

```typescript
type LeadContext = {
  leadId: string;
  ownerUserId: string;
  // Rolling 200-word cross-agent summary, refreshed every N turns
  summary: string;
  // Per-agent state slots — read by all, written by their own agent only
  coachState?: {
    lastCheckpoint: string;
    blockers: string[];
    relevantPlaybookRefs: string[];
  };
  finderState?: {
    lastCriteria: { budget?: number; location?: string; type?: string; ownership?: "invest"|"own-stay" };
    shortlist: string[]; // projectIds
    rejected: string[];
    shownCollaterals: string[];
  };
  replyState?: {
    threadSummary: string;
    toneNotes: string[];
    draftHistory: { at: Timestamp; draft: string; edits?: string }[];
  };
  lastTouched: Timestamp;
  lastTouchedBy: "coach" | "finder" | "reply";
};
```

**Rules:**

1. Every agent **reads the whole document** before composing context.
2. Every agent writes **only its own state slot** plus updates `summary`, `lastTouched`, `lastTouchedBy`.
3. `summary` is regenerated by an LLM call when an agent finishes a turn that materially advanced the lead. Trigger: > N tokens added since last summary, or pillar handoff.
4. Cross-agent visibility examples:
   - Coach knows agent has been using Finder for lead-123 → can ask "How's the matching going for [lead]?"
   - Reply knows from Finder state which 3 properties are on the shortlist → drafts a reply mentioning the right project names.
   - Finder knows from Coach state that the agent is still learning investment-vs-own-stay segmentation → suggests collateral that explains the difference.

**When does Coach know about Finder usage?** Whenever Coach is invoked next on this lead. The shared doc is the medium. No event bus, no cross-agent listener — Firestore is the bus.

---

## 7. Multi-language Architecture

**One KB, language-tagged chunks.** Not three separate KBs.

- Each `kbDoc` and each `kbChunk` carries `lang: "en" | "ms" | "zh"`.
- Many D2 source documents only exist in English (PowerBoost transcripts). That's fine — keep them tagged `en`. For BM/中文 user-facing answers, the agent reads `en` chunks and translates in the response. Translation quality from Claude into BM/中文 is high enough for v1.
- Retrieval pre-filter: query `kbChunks` with `lang IN [userLang, "en"]`, prefer same-lang. Use a small boost on same-lang in the rerank step.
- For high-traffic BM/中文 documents (the Reply SOPs are the prime candidate), manually translate and store as separate `kbChunks` with `lang: "ms"` etc. This is a Phase 3 polish, not Phase 0.

**Language detection placement:**

- Initial detection: `Accept-Language` header in `app/proxy.ts` (Next.js 16 proxy file convention) → redirects to `/[lang]/...`.
- User can override: stored in `agentProfiles.preferredLang`. UI dropdown writes here.
- Per-message detection: brief heuristic (script range check + 50-token classifier) in the chat route. If user types in BM mid-conversation while UI is in EN, agent responds in the typed language. This is the right behavior — match the user.

**i18n in Next.js 16 App Router:**

- Use `app/[lang]/` segment as the i18n root.
- `app/proxy.ts` reads `Accept-Language`, picks locale, redirects when missing.
- Dictionaries in `src/i18n/dictionaries/{en,ms,zh}.json`, loaded server-side and passed down. No client-side i18n libraries needed for v1.
- Validated against Next.js 16 docs at `node_modules/next/dist/docs/01-app/02-guides/internationalization.md`.

---

## 8. Model Abstraction Layer

The `llm/` interface should be **small** and **streaming-native**:

```typescript
// src/llm/types.ts
export interface GenerateOptions {
  model: ModelId;
  messages: Message[];
  system?: string;
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface LLMProvider {
  generate(opts: GenerateOptions & { stream: true }): AsyncIterable<StreamChunk>;
  generate(opts: GenerateOptions & { stream?: false }): Promise<GenerateResult>;
  embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}

export type ModelId =
  | "claude-sonnet-4"
  | "claude-haiku-3.5"
  | "fake"; // for tests

export type StreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool-call"; name: string; arguments: unknown; callId: string }
  | { type: "tool-result"; callId: string; result: unknown }
  | { type: "finish"; usage: TokenUsage; finishReason: string };
```

**Implementation:** wrap `@ai-sdk/anthropic`'s `streamText`/`generateText` so calling code stays decoupled. Add `gateway` for cost logging and ratelimit checks in one place.

**Testing against fake models:** `src/llm/fake.ts` exports `createFakeProvider({ scripts })`, where `scripts` is a list of pre-defined responses keyed by a matcher (regex on system prompt, on last user message, or by call counter). Evals run against the fake provider for deterministic tests of routing, tool-use, citation, hand-off logic. Real-model evals are a separate suite (§9).

```typescript
// Example test setup
const fakeLLM = createFakeProvider({
  scripts: [
    { match: { systemContains: "Coach" }, respond: "Welcome to D2 onboarding...", tools: [] },
    { match: { systemContains: "router" }, respond: { agent: "finder", confidence: 0.9 } },
  ],
});
// Inject via DI; agent code never knows it's not Claude.
```

---

## 9. Evaluation Harness Placement

- **Location:** `src/evals/` (logic) + `tests/eval-fixtures/` (data).
- **Runner:** a CLI in `src/evals/runner.ts`. Vitest is the test driver for unit-level evals; a separate Node script for full-suite runs (faster startup, no Vitest overhead).
- **Fake-model evals** (deterministic): run pre-commit via husky, and as a required GitHub Action check on every PR. Ensure routing/handoff/citation logic doesn't regress.
- **Real-model evals** (Claude calls, costs money): nightly via QStash hitting `/api/jobs/eval-suite/route.ts`. Store results in `evals/` collection. Compare against last 7-day baseline; if regression > threshold, emit alert (Slack webhook, email).
- **CI cost guardrail:** the real-model suite is opt-in via PR label `run-real-evals` for PRs that touch prompts. Don't burn the model budget on every commit.

**Three eval suites:**

1. **Routing** (fake): is the intent classifier picking the right agent? 100+ labeled fixtures.
2. **Faithfulness** (real): does the response use the retrieved citations and not hallucinate? LLM-as-judge over fake-RAG-context inputs.
3. **D2 voice** (real): does Reply Assistant output sound like D2, not generic AI? Tone scorer + human-review sampling weekly.

---

## 10. Build Order — Phase Boundaries

Refined from the suggested phases. **Hidden dependencies surfaced.**

### Phase 0 — Foundations (~3 weeks)
**Goal:** every shared component exists in a thin form. Hello-world Coach loop runs end-to-end.

- Auth (Firebase Auth + email link or Google sign-in)
- Firestore project + region selection (asia-southeast1, verify PDPA fit) + initial collections + security rules v1
- `firebase/` admin/client setup
- `llm/` provider with Claude Sonnet 4 + fake provider for tests
- `memory/` (conversation + leadContext), `audit/` (basic append), `i18n/` (en + scaffolding for ms/zh)
- `rag/` scaffold: Firestore vector field on a test collection, embed-and-search round-trip
- `kb/` ingestion pipeline (chunker, PDF, chunked-driver) — workable enough to ingest 1 D2 playbook
- `router/` stub: heuristic only, picks Coach by default
- `evals/` harness with 1 toy fixture proving fake-LLM + scorer round-trip works
- `ratelimit/` middleware (token-bucket per user per agent)
- Chat UI shell: send/receive, streaming render, message persistence
- App Hosting deployment pipeline + apphosting.yaml + Secret Manager wiring for `ANTHROPIC_API_KEY`, `QSTASH_TOKEN`
- QStash account + signature verification helper

**Exit criterion:** a logged-in user sends "hi" → Coach agent responds with streamed tokens, message persists in Firestore, audit log row written. One of: EN/BM/中文 surface works.

### Phase 1 — Coach + Admin v1 (~4 weeks)
**Depends on Phase 0 fully complete.**

- Full Coach agent: prompt, tools (retrieve-kb, mark-checkpoint), citations
- Onboarding journey state machine + checkpoint progress UI
- Admin KB CRUD (upload, list, version, archive)
- Senior-coach dashboard v1: downline list, conversation read-only view (security rules already permit this from Phase 0)
- Escalation: stall detection cron + senior-coach queue (QStash wired up)
- AI-disclosure UI + human-handoff button

**Exit criterion:** 5-10 pilot agents using Coach daily. Stalls escalate. Derek can edit KB.

### Phase 2 — Finder + Intent Routing Activation (~3 weeks)
**Depends on Phase 1 (Coach is the testbed for shared components).**

- Project inventory ingestion (Firestore `projects/` + embeddings)
- Finder agent + tools (match-projects, fetch-collateral)
- **Activate LLM classifier in `router/`** — heuristics alone were enough in Phase 1 (one agent), now you need real routing
- Per-lead memory: `leads/` + `leadContext/` populated by Finder
- Manual-override UI (the 3-chip escape hatch)
- Investment vs own-stay segmentation logic
- Filtered queries ("completed VP this year") — Firestore query composer for Finder's structured-search tool

**Exit criterion:** Pilot agent can paste lead criteria and receive ranked, cited project matches. Coach <-> Finder hand-off works mid-conversation.

### Phase 3 — Reply Assistant + Reply Analytics (~3 weeks)
**Depends on Phase 2 (lead context is now real, not theoretical).**

- Reply SOPs ingestion (likely BM/中文 forward — schedule manual translation Phase 3.1)
- Reply agent + tools (retrieve-sop, get-lead-thread)
- Per-lead reply thread tracking
- Edit-feedback loop: capture diffs between draft and user's actual sent message, store as `replyState.draftHistory`
- Reply-quality dashboard (admin + senior-coach view): edit-rate per SOP, common edit patterns
- D2-voice eval suite

**Exit criterion:** Pilot agents draft 80% of WhatsApp replies through Reply Assistant. Edit-rate measured and trending down week-over-week.

### Phase 4 — Hardening + Scale-Up (~3 weeks)
- Full PDPA audit log surfaces (admin view)
- Cost monitoring dashboard (token spend per agent per pillar)
- Performance: response-time P95 budget, RAG cache layer, embedding cache
- Senior-coach dashboard v2: knowledge-gap signals (questions Coach couldn't answer well), in-line AI correction (admin marks a response wrong → feeds back to evals as new fixture)
- Multi-language polish: BM/中文 SOP variants where edit-rate signals translation needed
- Funnel metrics dashboard (60-day → 7-10 day ramp-up tracking)
- Load-test for 400-agent rollout

**Exit criterion:** ready for full D2 rollout.

### Hidden dependencies surfaced

- **`memory/` must exist before any agent is built.** Don't let agents invent their own state stores.
- **`ratelimit/` must exist in Phase 0**, not retrofitted in Phase 4. Cheap to bake in, expensive to retrofit.
- **`audit/` must exist in Phase 0** for the same reason — if you ship Phase 1 without audit, you have PDPA-vulnerable conversation history that needs back-filling.
- **`evals/` harness in Phase 0** prevents prompt-regression bugs from Phase 1 onward. Skipping this is the #1 path to "the Coach used to be helpful, now it's weird."
- **i18n scaffolding in Phase 0** even if only EN ships in Phase 1. Retrofitting `[lang]/` segments mid-Phase 2 is painful.
- **`router/` LLM classifier doesn't activate until Phase 2**, but the seam must exist in Phase 0 so Coach is invoked through the router from day one.
- **Multi-tenant `tenantId` field on every doc in Phase 0**, even though we only have one tenant. Adding it later requires a migration.

---

## 11. Operational Concerns

### Secrets management
- `apphosting.yaml` declares env vars; sensitive ones (Anthropic API key, QStash signing key, embedding-provider key) reference **Google Secret Manager** entries via `secret: PROJECT_ANTHROPIC_KEY` syntax.
- Set via CLI: `firebase apphosting:secrets:set ANTHROPIC_API_KEY`.
- Console-set env vars override `apphosting.yaml` — useful for emergency rotations, but **policy: only secrets via Secret Manager, only feature flags via console**.
- Never read `.env*` files from outside `node_modules/` in this project — they go through `apphosting.yaml` only. Local dev uses `.env.local` (gitignored).

### Cost monitoring on token usage
- Every LLM call writes `usage: { promptTokens, completionTokens, costUSD }` to the `messages` doc.
- Aggregate via scheduled job → `costSummaries/{userId}_{yyyymmdd}` collection.
- Admin dashboard surfaces 7-day and 30-day spend per user and per pillar.
- **Hard ceiling:** if a user crosses 5x their 7-day median in a single day, ratelimit drops them to fake-model responses with a "you've hit a daily limit, contact admin" message until reviewed. This is the "runaway conversation cost protection" lever.

### Rate limiting on AI calls
- Token-bucket per `(userId, agent)` in `rateLimits/` collection.
- Defaults: 60 turns/hour per agent, 200 turns/day per agent.
- Reset window: sliding 1-hour and 1-day windows.
- Enforcement point: `app/proxy.ts` for the auth+ratelimit gate (early reject before the LLM call).
- Senior coaches and admins have 5x defaults.

### Data residency
- Firestore region: **asia-southeast1 (Jakarta)** is the closest Multi-region option for PDPA. Confirm Derek's preference vs `asia-southeast2 (Singapore)` (lower latency from MY, slightly different residency posture). Either is acceptable; **decide in Phase 0 and don't change later** (Firestore region is set at project creation, not movable).

### Observability
- App Hosting captures Cloud Run logs by default.
- Instrument LLM calls with OpenTelemetry — `instrumentation.ts` hook in Next.js 16 sets this up.
- Forward structured logs to Cloud Logging; no third-party APM in v1.

---

## Architectural Patterns (worth naming)

### Pattern 1: Repository + DI for the application core
**What:** `agents/`, `router/`, `memory/`, `rag/` accept dependencies via constructor/factory, not module-scoped imports. Real Firestore in prod, in-memory fake in tests.
**When:** all of `src/`.
**Trade-offs:** small boilerplate cost; massive payoff in test speed and eval determinism.

### Pattern 2: Server-Action for mutations, Route Handler for streams
**What:** Server Actions handle "click button → write something → revalidate" (KB CRUD, profile edits, mark-resolved on an escalation). Route Handlers handle anything that streams (chat) or that takes external signed requests (QStash webhooks).
**When:** the split is mechanical, not judgment-based.

### Pattern 3: `after()` for fire-and-forget telemetry
**What:** audit-log writes, cost aggregation, and usage analytics use `after()` so they never block the response.
**When:** anything that doesn't change what the user sees.
**Trade-off:** still bounded by `maxDuration`; don't put long work in `after()`.

### Pattern 4: Tool-using agents, not free-text agents
**What:** each agent's contract is "call these tools, then respond". RAG retrieval, lead lookup, checkpoint marking — all tools. Reduces hallucinations and makes the response auditable.
**When:** all three pillars.

### Pattern 5: Single shared context document, agent-scoped slots
**What:** `leadContext/{leadId}` is read by all agents, but each agent writes only its own slot. Plus shared `summary` field.
**When:** anything cross-agent.
**Trade-off:** requires discipline in code review to enforce "write your slot only".

---

## Anti-Patterns

### Anti-Pattern 1: Firestore-trigger-everywhere reflex
**What people do:** Even without Cloud Functions, smuggle event-driven logic in via the client (`onSnapshot` triggers downstream writes).
**Why it's wrong:** Listeners run when a client is connected. Stalls and digests happen when no client is connected.
**Do this instead:** All async/scheduled logic goes through QStash → Route Handler. Listeners are for UI updates only.

### Anti-Pattern 2: One mega-Route-Handler that "is the agent"
**What people do:** Put prompt, tools, RAG, memory, and routing all in one `/api/chat/route.ts`.
**Why it's wrong:** Untestable, untraceable, and you'll have three of them (one per pillar) that all drift.
**Do this instead:** `app/api/chat/route.ts` is a thin orchestrator. All decisions live in `src/agents/` and `src/router/`.

### Anti-Pattern 3: Sharing context via free-form summarization
**What people do:** "We'll just have Coach summarize what it did in the message log, and Finder can read it."
**Why it's wrong:** Lossy. Non-deterministic. Drifts over a long conversation.
**Do this instead:** Structured `leadContext/{leadId}` slots. Summarize for the **prompt** if you must, but persist the structured state.

### Anti-Pattern 4: Server Action for streaming
**What people do:** Try to use Server Actions to stream LLM tokens to the client.
**Why it's wrong:** Server Actions are RPC. They don't naturally support SSE/`ReadableStream`. You will end up reinventing the chunked stream wheel poorly.
**Do this instead:** Route Handler + `streamText().toDataStreamResponse()`.

### Anti-Pattern 5: Embedding generation in the upload Server Action
**What people do:** `await embedPdf(pdf)` inside the upload handler.
**Why it's wrong:** 100-page PDFs take minutes. Cloud Run will time out, or the user closes the tab and the doc ends up in a half-indexed state.
**Do this instead:** Two-step ingestion. Server Action queues the job. Client drives the chunk loop (§3.2).

### Anti-Pattern 6: Ignoring per-agent token cost
**What people do:** Wire up Sonnet for the router classifier "for quality". Cost balloons.
**Why it's wrong:** A router classifier on every message at Sonnet rates is 70% of your bill for 5% of your value.
**Do this instead:** Haiku (or the cheapest Claude class) for classification and summarization. Sonnet for user-facing answers. Encode this in the `agents/<name>/index.ts` config.

---

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 0–50 agents (pilot) | Single Firestore project, single App Hosting backend, single QStash account. No optimization. Watch cost dashboard. |
| 50–400 agents (full D2 rollout) | Add RAG cache (Firestore `ragCache/{queryHash}` with TTL). Add embedding cache. Move stall-detection cron to every 3h instead of 6h (load is spread better). Add read-replicas if Firestore read load gets hot (unlikely). |
| 400+ (multi-tenant white-label) | `tenantId` field becomes load-bearing. Consider per-tenant Firebase projects if data-isolation requirements harden. Move from QStash free tier to paid. Re-evaluate Firestore vector vs external (Pinecone) if KB exceeds ~1M chunks. |

### Scaling priorities (first breakages)

1. **Anthropic rate limits** will hit before Firestore does. Mitigation: ratelimit per user, fall back to a queue with a "your answer in 30s" UX.
2. **Vector search latency** as `kbChunks` grows past ~100k. Mitigation: tighten pre-filters (`lang`, `ownerCollection`), or shard by `kbDocId` prefix.
3. **Single-doc contention** on `leadContext` for very chatty leads. Mitigation: split `leadContext` into `leadContext/{leadId}/state/{slot}` sub-docs if writes-per-second > 1 per lead (unlikely until much larger scale).

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Anthropic API | `@ai-sdk/anthropic` provider via `llm/` | Token usage logged per call; key in Secret Manager. |
| Voyage AI (embeddings, candidate) | HTTP via `rag/embed.ts` | Phase 0 spike: compare against Anthropic-compatible alternatives. Embeddings dim ≤ 2048 (Firestore limit). |
| Upstash QStash | Signed HTTP webhooks to `/api/jobs/*` | One shared signing secret; verify via `@upstash/qstash/nextjs` middleware. |
| Firebase Auth | Direct SDK | Custom claims for `role`, `tenantId`. |
| Firebase Storage | Direct SDK | PDF KB sources, project posters, fact sheets. |
| Firebase Firestore + vector | Admin SDK (server) + client SDK (UI) | Native vector field for RAG; max 2048 dims. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `app/` ↔ `src/` | Direct import (server-only modules) | `src/` modules never import from `app/`. |
| `agents/` ↔ `memory/`, `rag/`, `kb/` | Direct function calls via DI | All agents share same memory/rag interfaces. |
| `router/` → `agents/` | Returns agent name; orchestrator dispatches | Router does not call agents directly. |
| `escalation/`, `audit/` ↔ `memory/` | Direct reads; writes via `after()` where possible | Don't block user responses. |
| QStash → `app/api/jobs/*` | Signed HTTP webhook | Verify signature; reject unsigned. |
| Client → server | Server Actions for mutations; `useChat()` SSE for streams | Don't mix these. |

---

## Sources

- [Next.js 16 Streaming guide (bundled docs)](node_modules/next/dist/docs/01-app/02-guides/streaming.md) — Route Handler streaming patterns, `ReadableStream`, HTTP contract.
- [Next.js 16 `after()` API reference (bundled docs)](node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md) — Post-response work, `waitUntil` semantics.
- [Next.js 16 Internationalization guide (bundled docs)](node_modules/next/dist/docs/01-app/02-guides/internationalization.md) — `[lang]/` segment, `proxy.ts` locale detection.
- [Next.js 16 AI Agents guide (bundled docs)](node_modules/next/dist/docs/01-app/02-guides/ai-agents.md) — Project conventions for AI work.
- [Firebase App Hosting overview](https://firebase.google.com/docs/app-hosting) — Native Next.js support, Cloud Run substrate.
- [Configuring Firebase App Hosting with Google Secrets Manager](https://medium.com/evenbit/configuring-firebase-app-hosting-with-google-secrets-manager-2b83c09f3ad9) — `apphosting.yaml` secrets pattern.
- [Firebase App Hosting March 2026 update — console env vars](https://firebase.blog/posts/2026/03/apphosting-march-update) — Current state of env-var management.
- [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search) — Native vector field, 2048-dim ceiling, no snapshot listeners.
- [Pinecone vs Firestore vector comparison (2026)](https://www.datacamp.com/blog/the-top-5-vector-databases) — When to stay on Firestore vs go external.
- [Vercel AI SDK guide (2026)](https://www.guvi.in/blog/vercel-ai-sdk/) — `streamText`, `toDataStreamResponse`, Claude provider.
- [Building a Claude Streaming Agent with Vercel AI SDK (2026)](https://jangwook.net/en/blog/en/vercel-ai-sdk-claude-streaming-agent-2026/) — Production-ready route handler shape.
- [Upstash QStash getting started](https://upstash.com/docs/workflow/getstarted) — HMAC-signed cron webhooks for Next.js.
- [Upstash QStash + Next.js scheduling pattern](https://supastarter.dev/docs/nextjs/tasks/qstash) — Signature verification, scheduled HTTP.
- [Firestore Custom Claims & Security Rules](https://firebase.google.com/docs/auth/admin/custom-claims) — RBAC pattern, refresh semantics.
- [Firestore role-based access (Firebase docs)](https://firebase.google.com/docs/firestore/solutions/role-based-access) — Helper-function pattern in rules.

---
*Architecture research for: D2 Customer Service AI Agent Platform (multi-pillar conversational AI on Next.js 16 + Firebase, no Cloud Functions)*
*Researched: 2026-05-31*
