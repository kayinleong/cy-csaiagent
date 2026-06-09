# quick-kayinleong-006 — As-Built Architecture Research

**Researched:** 2026-06-09
**Goal:** Map the *real* cy-csaiagent architecture from source so the diagram author builds from code, not from intent.
**Method:** Read TSD §3–4 (intent), then traced every hop in source. Every non-obvious claim is `file:line` cited.
**Confidence:** HIGH for code structure (read directly). MEDIUM for "planned-but-not-wired" deltas (cross-checked code vs TSD + STATE.md).

**One-paragraph reality check:** The as-built system matches the TSD intent closely. All three pillars (Coach/Finder/Reply) are wired and dispatched from one SSE route. The LLM intent classifier IS active (TSD said "Phase 3" — it's done). The lazy-cron has 6 jobs (TSD named 4). There are **20 Firestore collections + 2 operational docs**, not 14 (TSD §4 undercounts — see §D/§G). No Cloud Functions, no external scheduler, no forbidden GCP — verified by grep (§G).

---

## A. As-Built Component Inventory (core/shell map)

**Core/shell split is real and clean.** Verified: `src/` files carry a "must NOT import from app/ or next" banner (e.g. `src/router/index.ts:17`, `src/rag/embed.ts:24`, `src/llm/provider.ts:21`). `app/` imports from `@/src/*` freely (e.g. `app/api/chat/route.ts:38-65`).

### `src/` core modules (framework-agnostic)

| Module | Entry file(s) | Exposes / one-liner |
|--------|--------------|---------------------|
| `agents/coach` | `index.ts`, `tools.ts`, `prompt.ts`, `schema.ts` | `coachAgent.{buildSystemPrompt, makeTools, run}`. Tools READ-ONLY: `retrieveKnowledge` + journey tools (`coach/index.ts:76-207`). |
| `agents/finder` | `index.ts`, `tools.ts`, `prompt.ts`, `schema.ts` | `finderAgent.{buildSystemPrompt, makeTools}`. Tools: `searchProjects`, `queryInventory`, `fetchCollateral` — all READ-ONLY (`finder/tools.ts:44-213`). |
| `agents/reply` | `index.ts`, `tools.ts`, `prompt.ts`, `schema.ts` | `replyAgent.{buildSystemPrompt, makeTools}`. Tools: `retrieveReplySop`, `fetchVoiceSamples`, `fetchLeadContext` — READ-ONLY (`reply/tools.ts:77-193`). |
| `router` | `index.ts`, `heuristic.ts`, `classifier.ts` | `routeAsync` (3-tier) + sync `route`. LLM classifier ACTIVE (`router/classifier.ts:84-97`). |
| `llm` | `provider.ts`, `fake.ts`, `index.ts`, `types.ts` | `modelFor(pillar)` resolves model ID from Remote Config → `anthropic(id)` (`llm/provider.ts:70-88`). Adapter over AI SDK v5 + a `fake` provider for tests. |
| `memory` | `index.ts`, `conversation.ts`, `leadContext.ts`, `agentProfile.ts` | `appendMessage`/`loadRecent`/`ensurePrimaryThread`; `writeLeadSlot`/`readFinderSlot`/`readReplySlot`; journey-stage helpers (`memory/index.ts:15-21`). |
| `rag` | `index.ts` (facade), `search.ts`, `embed.ts`, `pinecone.ts`, `citations.ts` | **Adapter**: `retrieve()` dispatches Firestore (default) vs Pinecone via `RAG_ADAPTER` env (`rag/index.ts:43-79`). `embedText` = Gemini 1024-d (`rag/embed.ts:67-94`). |
| `kb` | `crud.ts`, `index.ts`, `ingest/{pdf,chunker,pipeline}.ts` | KB doc CRUD + chunked ingestion (pdfjs-dist, chunker, versioning/supersedes). |
| `inventory` | `search.ts`, `crud.ts`, `import.ts`, `embedText.ts`, `list.ts` | Finder's two-stage engine: `searchProjects` (deterministic gate + in-memory vector re-rank) + `queryInventory` (structured, no vector) (`inventory/search.ts:1-55`). |
| `escalation` | `detect.ts`, `handoff.ts`, `knowledgeGaps.ts`, `index.ts` | `findStalled`, `emitHandoffSignal`, `recordKnowledgeGap`. Consumed by jobs + Coach KB-miss. |
| `coach` (journey) | `journey/{transition,comprehension,config}.ts` | Onboarding journey state machine + comprehension gate (separate from `agents/coach`). |
| `dashboard` | `metrics.ts`, `queries.ts` | Senior-coach dashboard read queries + metric aggregation. |
| `jobs` | `runDueJobs.ts`, `heartbeat.ts`, `workingHours.ts` | On-visit lazy-cron runner + job registry + heartbeat watchdog (`jobs/runDueJobs.ts:88-349`). |
| `pdpa` | `coverage.ts`, `erasure.ts`, `sweep.ts` | PDPA erasure pipeline + coverage proof + chunked sweep (Phase 5). |
| `audit` | `index.ts`, `log.ts`, `pdpa.ts` | `log()` (append-only, hashes-only) + `pseudonymize`/`assertRedacted` PDPA gate (`audit/pdpa.ts:248-295`, `audit/log.ts:76-97`). |
| `ratelimit` | `index.ts`, `window.ts` | `check(uid)` / `decrement(uid, tokens)` per-agent budgets. |
| `usage` | `record.ts`, `rollup.ts`, `types.ts` | `recordUsageEvent` (counts-only) + `rollupUsage` (daily idempotent rollup). Phase 5. |
| `eval` | `judge.ts`, `runNightly.ts` | Promptfoo nightly-eval seam (Opus judge). |
| `i18n` | `routing.ts`, `request.ts`, `detect.ts` | next-intl routing config + `detectLang` (franc-min) per-message detection. |
| `firebase` | `admin.ts`, `client.ts`, `collections.ts`, `auth.ts` | `adminDb`/`adminAuth`/`remoteConfig`; **`collections.ts` = single source of truth for all 20 collections + converters** (`firebase/collections.ts:635-852`); `requireUser()` hard auth gate. |
| `reply` (signals) | `diff.ts` | Edit-ratio diff for the reply edit-as-signal store (separate from `agents/reply`). |

> NOTE: there are TWO `coach`-ish and TWO `reply`-ish folders. `src/agents/coach` vs `src/coach/journey`; `src/agents/reply` vs `src/reply` (diff util). The diagram should label them distinctly: "Coach agent" vs "Journey state machine", "Reply agent" vs "Reply-edit diff".

### `app/` shell (Next 16 entrypoints)

| Path | Type | Role |
|------|------|------|
| `proxy.ts` (repo root) | Next 16 Proxy | Locale routing only (next-intl `createMiddleware`). **NOT an auth boundary** — explicitly optimistic, comment `proxy.ts:10-13`. |
| `app/[lang]/` | i18n segment | `(chat)` surface, `(coach)` dashboard, `(admin)` app, `(auth)` sign-in. |
| `app/api/chat/route.ts` | Route Handler (Node) | **The integration spine** — SSE chat endpoint, all gates + dispatch (`route.ts:234-676`). |
| `app/api/kb/ingest/upload/route.ts` + `process/route.ts` | Route Handlers | Chunked, client-polled PDF ingestion. |
| `app/api/auth/session/route.ts` | Route Handler | Sets `__session` httpOnly cookie from Firebase ID token. |
| `app/api/spike/stream/route.ts` | Route Handler | SPIKE-DEPLOY streaming probe (test artifact, not product path). |
| `app/_actions/chat.ts` | Server Action | Chat-adjacent mutations (e.g. user doc lookup). |
| `app/_actions/jobs.ts` | Server Action | **On-visit lazy-cron trigger** — `triggerDueJobs()` (`_actions/jobs.ts:38-63`). |

**No `app/api/jobs/*` cron routes exist** — confirmed (§E, §G). Periodic work is the Server Action only.

---

## B. End-to-End Chat Data Flow (sequence-diagram-ready)

All hops are in `app/api/chat/route.ts` `POST` unless noted. The flow is **gate-ordered**: no model spend until gates 1–4 pass.

| # | Hop | Real file:function | Notes |
|---|-----|-------------------|-------|
| 0 | Client island sends `POST /api/chat` with Bearer token + body `{messages, cid, langOverride, override, leadId}` | `app/[lang]/chat/chat-input.tsx` (island) → fetch | `chat-shell.tsx:41-79` owns cid/lang/pillar/lead state. |
| 0a | Locale redirect (NOT auth) | `proxy.ts:38` `proxy()` | Edge locale prefix only. API routes are excluded by matcher (`proxy.ts:45`). |
| 1 | **GATE 1 — Auth** `requireUser(req)` → uid; 401 on fail | `route.ts:238-253` → `src/firebase/auth.requireUser` | Claims read from VERIFIED token, never body. |
| 2 | **GATE 2 — Rate limit** `ratelimit.check(uid,'chat')`; 429 over budget | `route.ts:258-271` → `src/ratelimit.check` | Refused BEFORE any token spend. |
| 3 | Parse body + per-message lang detect | `route.ts:279-324` → `src/i18n/detect.detectLang` | `langOverride` chip honored; `override`/`leadId` validated against enum (invalid → undefined). |
| 3a | Resolve stable thread cid | `route.ts:328-330` → `memory.ensurePrimaryThread(uid, lang)` | Creates/looks up persistent `coach-${uid}` thread when no cid given. |
| 4 | **GATE 3 — PDPA** lead-name lookup → `pseudonymize()` → `assertRedacted()`; 422 on fail | `route.ts:347-375` → `src/audit/pdpa.{pseudonymize,assertRedacted}` | Runs for ALL pillars BEFORE the model call. Tokenizes names/phones/IC/email/RM-financial (`pdpa.ts:216-228`). |
| 5 | **GATE 4 — Route** `routeAsync(messages, {override})` → `{pillar, reason}` | `route.ts:381-387` → `src/router/index.routeAsync` | 3-tier: override → heuristic → LLM classifier (§C). `routeDecision = pillar:reason`. |
| 5a | Reply fail-closed: 400 if `pillar==='reply' && !leadId` | `route.ts:395-400` | Reply-only; Coach/Finder keep leadId optional. |
| 6 | **Dispatch** — build system prompt + tools per pillar; read stored slot | `route.ts:410-474` | Finder reads `readFinderSlot` (`route.ts:426`); Reply reads `readReplySlot` (`route.ts:453`); Coach base prompt. |
| 7 | Resolve model from Remote Config | `route.ts:478` → `src/llm/provider.modelFor(pillar)` | `anthropic(id)`; fallback consts only if RC unreachable (`provider.ts:39-45`). |
| 8 | **GATE 5 — `streamText()`** with tools; `stopWhen` 5 steps for finder/reply, 1 for coach | `route.ts:487-495` (`ai` SDK) | The only model call. Multi-step tool loop for finder/reply. |
| 9 | Stream out: `result.toUIMessageStreamResponse({headers})` | `route.ts:670-675` | Headers `Cache-Control: no-store`, `X-Accel-Buffering: no` (SPIKE-DEPLOY). NOTE: TSD §3.4 says `toDataStreamResponse()` — **does not exist in ai@5.0.193**; code uses `toUIMessageStreamResponse()` (deviation, `route.ts:23-26`). |
| 10 | Client decodes final text → interactive card | `app/[lang]/chat/decode-structured-output.ts` `decodeReplyOutput`/`decodeFinderOutput` | Reply/Finder emit JSON in final text; client decodes to `ReplyDraftCard`/`MatchList` (quick-005 gap-closure, commit d01fce4). Coach renders plain text. |

### Side effects (in `onFinish`, `route.ts:496-658`)

| Effect | file:line | Timing |
|--------|-----------|--------|
| Persist user message (subcollection) | `route.ts:500-509` → `memory.appendMessage` | after stream |
| Extract citations (coach) / projectIds (finder) / sopIds (reply) | `route.ts:515, 533, 565` | helper fns `route.ts:87-230` |
| Persist assistant message w/ citations + `routeDecision` | `route.ts:518-527` | after stream |
| Write `finderSlot` (finder + leadId) | `route.ts:532-557` → `memory.writeLeadSlot` | **in onFinish, never in a tool** |
| Write `replySlot` (reply + leadId) | `route.ts:564-571` → `memory.writeLeadSlot` | **in onFinish, never in a tool** |
| Reply `no_sop_match` → `recordKnowledgeGap` | `route.ts:584-605` → `escalation.recordKnowledgeGap` | redacted topic only |
| Decrement rate budget | `route.ts:614` → `ratelimit.decrement` | uses `final.usage.totalTokens` (last-step; documented undercount, `route.ts:608-613`) |
| **Audit log via `after()`** (hashes-only) | `route.ts:619-632` → `audit.log` | post-response, fire-and-forget |
| Usage event via `after()` (counts-only) | `route.ts:639-657` → `usage.recordUsageEvent` | uses `final.totalUsage` (sum across steps) |

**Planned-but-not-fully-wired in this flow:** none material. The `mergedCriteria` write-back is a baseline placeholder — the actual criteria delta parsing happens inside the Finder tool loop and onFinish writes accumulated state (`route.ts:533-557`, comment at `:537-539`). Worth a footnote on the diagram, not a missing hop.

---

## C. Routing Logic (intent router)

**Three-tier `routeAsync` — all three tiers wired** (`src/router/index.ts:67-100`):

1. **Manual override chip** wins unconditionally → `reason:'manual-override'` (`index.ts:72-74`). UI source: `pillarOverride` state in `chat-shell.tsx:59`, sent as `override` in POST body.
2. **Heuristic (keyword/structural, no LLM)** → returns clear pillar or null (`heuristic.ts:153-191`). Precedence: **Reply structural signals checked FIRST** (`heuristic.ts:165-173`) so a pasted inbound mentioning "RM"/"financing" routes to Reply not Finder (Pitfall C). Then Finder keywords, then Coach keywords. `looksLikeInboundPaste` = multiline/quote + reply trigger word (`heuristic.ts:135-139`).
3. **LLM classifier (ACTIVE)** for ambiguous turns → `generateObject` with `RouteSchema` (`classifier.ts:84-97`). Model = `modelFor('router')` (Remote Config, fallback `claude-haiku-4-5`). Ternary schema `coach|finder|reply` (`classifier.ts:29-33`). Below `ROUTER_CONFIDENCE_THRESHOLD = 0.5` → defaults to `coach` with `reason:'low_confidence:…'` (`index.ts:39, 85-92`).

**Classifier state: WIRED, not a stub.** TSD §3.2/§11 implies Phase-3 activation; STATE.md confirms Phase 3 complete. The old `NotActivatedError` stub was removed (`classifier.ts:9-10`). The chat route calls the async `routeAsync` (`route.ts:381`), not the sync fast-path. The sync `route()` is preserved only for non-awaiting callers like the stall-detect job (`heuristic.ts:214-229`).

`routeDecision` is `${pillar}:${reason}` and is persisted on every message + audit row for observability/eval (`route.ts:387, 505, 522, 621`).

---

## D. Data Model (Firestore)

**Single source of truth:** `src/firebase/collections.ts`. Every doc gets `tenantId:'d2'` stamped by a converter `toFirestore` (`collections.ts:635-647`) — no caller can omit it. `TENANT_ID = 'd2'` const (`collections.ts:56`).

**Actual collection count: 20 typed + 2 operational = 22**, not 14 (TSD §4 listed 14; the file header itself admits "+rateBudgets + knowledgeGaps" and grew to 20 across phases, `collections.ts:9-29`).

| # | Collection | Ref fn | Notes |
|---|-----------|--------|-------|
| 1 | `users/{uid}` | `usersRef` | role/lang/voiceSamples mirror Auth claims |
| 2 | `agentProfiles/{uid}` | `agentProfilesRef` | journeyStage, lastActiveAt, seniorCoachId — drives stall detect |
| 3 | `conversations/{cid}` | `conversationsRef` | ownerUid, pillar, leadId?, summary |
| 4 | `conversations/{cid}/messages/{mid}` | `messagesRef(cid)` | **SUBCOLLECTION** — never inline array (`collections.ts:694-708`) |
| 5 | `leads/{leadId}` | `leadsRef` | name pseudonymized, phoneHash, consentFlag |
| 6 | `leadContext/{leadId}` | `leadContextRef` | **cross-pillar memory** — coachSlot/finderSlot/replySlot + rollingSummary (§see below) |
| 7 | `projects/{pid}` | `projectsRef` | status, priceBand+priceValue, vpStatus+vpDate, bumiQuota, foreignEligible, `embedding(1024)` |
| 8 | `collateral/{coid}` | `collateralRef` | storagePath OR externalUrl (no Drive API) |
| 9 | `kbDocs/{docId}` | `kbDocsRef` | version, supersedesId/supersededBy, status, pillar, category |
| 10 | `kbChunks/{chunkId}` | `kbChunksRef` | `embedding(1024)`, denormalized `lang`/`status`/`pillar` for findNearest pre-filter |
| 11 | `kbIngestionJobs/{jobId}` | `kbIngestionJobsRef` | fileHash, total/remaining — chunked-ingest loop |
| 12 | `escalations/{eid}` | `escalationsRef` | agentUid, seniorCoachId, reason, status, resolvedAt? |
| 13 | `auditLogs/{alid}` | `auditLogsRef` | **append-only, hashes only** |
| 14 | `evals/{runId}` | `evalsRef` | nightly eval results |
| 15 | `rateBudgets/{uid}` | `rateBudgetsRef` | per-agent request/token budget (TSD §9) |
| 16 | `knowledgeGaps/{gapId}` | `knowledgeGapsRef` | CDASH-03 + Reply no_sop_match; topicLabel pseudonymized; server-write only |
| 17 | `replyEdits/{eventId}` | `replyEditsRef` | REPLY-09 edit-as-signal; append-only; editRatio + sopDocIds |
| 18 | `usageEvents/{eventId}` | `usageEventsRef` | QUAL-08 per-turn counts; no content; 90d TTL proposed |
| 19 | `usageRollups/{key}` | `usageRollupsRef` | idempotent daily rollup `${day}__${uid}__${pillar}` |
| 20 | `erasureRequests/{reqId}` | `erasureRequestsRef` | PDPA erasure ledger; subjectIdHash only (transient rawSubjectId server-field) |
| op | `jobRuns/{jobName}` | direct `adminDb` | lazy-cron last-run ledger (`runDueJobs.ts:61, 275`) |
| op | `jobHeartbeats/{jobName}` | direct `adminDb` | UI watchdog heartbeat (`heartbeat.ts:38, 51`) |

### Cross-pillar memory doc shape (`leadContext/{leadId}`)

`LeadContextDoc` (`collections.ts:123-134`): one shared doc, three **agent-scoped write slots** + a shared `rollingSummary` + `updatedAt`.
- `writeLeadSlot(leadId, slot, value, summary?)` writes **only the named slot** (+ optional rollingSummary + updatedAt) — slot isolation is the security contract (`leadContext.ts:103-122`).
- `readFinderSlot` / `readReplySlot` treat an empty `{}` slot as "first touch / null" (`leadContext.ts:139-187`).
- `FinderSlot = {criteria, discussedProjectIds[], lastRankedAt}`; `ReplySlot = {classification, latestDraft, sopDocIds[], lastDraftedAt}` (`leadContext.ts:49-90`).
- coachSlot exists in the type but its dedicated writer wiring lives in Phase-1/2 coach memory; finder/reply slots are the Phase-3/4 handoff media. The diagram should show all three slots feeding the rolling summary as the cross-pillar handoff bus.

---

## E. Background Jobs (on-visit lazy-cron)

**Mechanism (verified):**
1. RSC chat page calls `void triggerDueJobs()` fire-and-forget, never blocking render (`app/[lang]/chat/page.tsx:48-51`).
2. `triggerDueJobs()` (Server Action) reads `__session` cookie → `adminAuth.verifyIdToken` → fail-closed silent skip if absent/invalid → `runDueJobs()` (`_actions/jobs.ts:38-63`).
3. `runDueJobs()` loops the registry; each `runJob` uses a **Firestore transaction** on `jobRuns/{jobName}` for exactly-once-per-window under concurrent visitors (`runDueJobs.ts:271-307`). Window check: `now - lastRunAt >= windowMs`.
4. Each job writes a heartbeat (`jobHeartbeats/{jobName}`) for the UI watchdog (`heartbeat.ts:50-59`).

**Registered jobs (6 — TSD §3.4 named only 4):** all in `JOB_REGISTRY` (`runDueJobs.ts:88-255`):

| Job | Window | Body |
|-----|--------|------|
| `stall-detect` | 24h | `findStalled(2d)` → escalation row + cadence-capped in-app nudge into `coach-{uid}` thread |
| `escalate` | 24h | working-hours-gated 48h escalation surface |
| `eval-nightly` | 24h | `runNightlyEval()` (Promptfoo seam) |
| `usage-rollup` | 24h | `rollupUsage(dayKey)` (Phase-5; TSD called it a stub — now wired) |
| `erasure-sweep` | **1h** | `erasureSweep()` chunked PDPA delete (Phase-5; NOT in TSD §3.4) |

**Tradeoff (as designed):** truly idle period defers jobs; watchdog surfaces stale last-run (`runDueJobs.ts:26-30`). No wall-clock guarantee. **No external scheduler / Cloud Function — verified (§G).**

---

## F. External Boundaries

| Boundary | What crosses | Where in code | Constraint honored |
|----------|-------------|---------------|--------------------|
| **Anthropic (US)** — Claude via Vercel AI SDK v5 | redacted prompt + tools → streamed tokens | `route.ts:487` `streamText`; model from `modelFor()` `provider.ts:70-88` | C5 model-agnostic (Remote Config IDs, fallback consts only); C6 PDPA gate runs first |
| **Gemini (Developer API)** — embeddings | text → 1024-d vector | `rag/embed.ts:67-94` `embed()` + `google.textEmbedding('gemini-embedding-001')`; key `GOOGLE_GENERATIVE_AI_API_KEY` | Developer API not Vertex (`embed.ts:6, 28`); normalized for DOT_PRODUCT (`embed.ts:100-104`) |
| **Firebase Auth** | ID token verify | `requireUser` (route GATE 1); `verifyIdToken` (`_actions/jobs.ts:50`) | custom claims role/tenantId from verified token |
| **Cloud Firestore** | system of record + vector index + message bus | `adminDb` everywhere; `findNearest` (`rag/search.ts:141-148`) | single region `asia-southeast1`; no separate vector DB by default |
| **Cloud Storage** | KB files + collateral | `collateral.storagePath` (`collections.ts:246`); kb ingest upload | no Drive API — Storage path or plain externalUrl only (`finder/tools.ts:194-205`) |
| **App Hosting** | deploy substrate + Secret Manager | `apphosting.yaml`, `firebase.json` | Cloud Run substrate (managed); secrets via SM binding |
| **PDPA pseudonymization boundary** | the redaction line itself | `audit/pdpa.ts:248-295` runs at `route.ts:358-375` | sits IMMEDIATELY before `streamText`; `assertRedacted` THROWS (422) on unredacted (`pdpa.ts:291-295`) |

**Pinecone** is a coded-but-dormant fallback adapter (`rag/index.ts:43-47`, `rag/pinecone.ts`) gated by `RAG_ADAPTER=pinecone` env. Default is Firestore. Diagram should draw it as a dashed/optional box.

---

## G. Plan-vs-Reality Deltas

| # | TSD / intent says | Reality | Impact on diagram |
|---|-------------------|---------|-------------------|
| G1 | §3.4 stream via `toDataStreamResponse()` | Code uses `toUIMessageStreamResponse()` (method name differs in ai@5.0.193) | Label the stream method correctly: `toUIMessageStreamResponse()`. |
| G2 | §4 "14 collections" | **20 typed collections + jobRuns + jobHeartbeats** | Draw 20 (+2 op docs). Don't claim "14". |
| G3 | §3.2 router LLM classifier "activated Phase 3" | **Active now** — `classifyIntent` real, ternary coach/finder/reply | Show classifier as live, not a future seam. |
| G4 | §3.4 jobs: stall-detect/escalate/eval-nightly/usage-rollup (4) | **6 jobs** (+ `erasure-sweep` 1h window) | List all 6; note erasure-sweep is the only sub-daily window. |
| G5 | §2.3 model `claude-opus-4-7` eval judge, `claude-haiku-4-5` router | Matches: fallbacks `grader:opus-4-7`, `router:haiku-4-5` (`provider.ts:39-45`) | Faithful. |
| G6 | §4 inventory uses `findNearest` | Inventory (`projects`) uses **in-memory dot-product** re-rank, NOT findNearest (range filters can't combine with findNearest, Pitfall 6). Only `kbChunks` uses findNearest. | Distinguish: KB retrieval = Firestore findNearest; project search = deterministic filter + in-memory vector. |
| G7 | §3.3 finderSlot criteria write | onFinish writes a **baseline/accumulated** criteria; the precise delta parse is inside the tool loop (`route.ts:537-539`) | Minor footnote; not a missing component. |
| G8 | §5.3 erasureRequests stores hashes only | Public type yes, but a **transient server-only `rawSubjectId`** is written then `FieldValue.delete()`d on completion (`collections.ts:586-592`) | If drawing PDPA data-at-rest, note the transient field exists < 72h. |
| G9 | Many gates are "live-gated" (deploy, k6, PDPA drill, Derek sign-off) | Code-complete but **not yet deployed**; STATE.md status `v1.0-code-complete-gaps-closed`, NOT pushed | Diagram = as-coded architecture. Add a one-line "status: code-complete, pre-deploy" caption so it isn't read as live-running. |
| G10 | No Cloud Functions / external scheduler | **Verified by grep**: no `functions/` dir; only comments mention QStash ("replaces…"); no onRequest/onSchedule/Vertex/BigQuery/PubSub in src or app | Safe to assert "zero Cloud Functions, zero external scheduler" on the diagram. |

---

## H. Recommended Diagram Set (format: confirmed Mermaid-in-Markdown)

**Format recommendation: Mermaid embedded in Markdown — confirmed, your prior is right.** It renders natively on GitHub, is diff-able/version-controllable, and needs no build step. The only caveat: Mermaid `sequenceDiagram` and `flowchart` are well-supported on GitHub; avoid newer Mermaid features (e.g. `architecture-beta`) that GitHub's pinned Mermaid version may not render. Stick to `flowchart`, `sequenceDiagram`, and `erDiagram`.

Propose these 5 diagrams:

1. **System context / boundary diagram** (`flowchart LR`) — browser/PWA → Next 16 monolith (App Hosting) → {Anthropic, Gemini, Firebase Auth/Firestore/Storage}. Show the PDPA boundary as a labeled line on the Anthropic edge. One box for the Next app, external services as separate nodes. Pinecone dashed/optional.

2. **Chat request sequence** (`sequenceDiagram`) — the §B table is literally this. Participants: Client, proxy.ts, /api/chat, ratelimit, pdpa, router, agent, rag, llm/Anthropic, Firestore. Show the 5 gates in order + the onFinish side effects (memory/audit/usage) as post-response `after()` notes.

3. **Intent routing decision** (`flowchart TD`) — override? → heuristic (Reply-first → Finder → Coach)? → LLM classifier → confidence≥0.5 ? pillar : coach-default. Mirror §C exactly.

4. **Core/shell module map + data model** (`flowchart` + `erDiagram`) — left: `app/` shell entrypoints; right: `src/` core modules with the import-direction arrow (app→src only). Pair with an `erDiagram` of the key collections, highlighting `conversations → messages` subcollection and `leadContext` 3-slot shape.

5. **Lazy-cron job lifecycle** (`flowchart TD` or small `sequenceDiagram`) — page visit → triggerDueJobs (cookie verify) → runDueJobs loop → per-job Firestore txn on jobRuns (due?) → run body + heartbeat. List the 6 jobs + windows in a side note.

Optional 6th: **PDPA / pseudonymization boundary** detail diagram if the author wants to emphasize compliance — showing pseudonymize → assertRedacted (422) → streamText → reconstitute-client-side, plus audit/hashes-only.

---

## Sources

- **Code (HIGH — read directly):** `app/api/chat/route.ts`, `proxy.ts`, `src/router/{index,heuristic,classifier}.ts`, `src/memory/{index,leadContext}.ts`, `src/jobs/{runDueJobs,heartbeat}.ts`, `src/rag/{index,search,embed}.ts`, `src/audit/{log,pdpa}.ts`, `src/firebase/collections.ts`, `src/llm/provider.ts`, `src/agents/{coach/index,finder/tools,reply/tools}.ts`, `src/inventory/search.ts`, `app/_actions/jobs.ts`, `app/[lang]/chat/{page,chat-shell,decode-structured-output}.ts(x)`.
- **Grep verification (HIGH):** no Cloud Functions / scheduler / forbidden GCP in `src` + `app` (only QStash-replacement comments); no `functions/` dir; 5 api routes only; collection refs centralized.
- **Intent docs (MEDIUM — for delta comparison):** `.planning/TSD.md` §1–5, `.planning/STATE.md` (status `v1.0-code-complete-gaps-closed`, not pushed), project `CLAUDE.md`/`AGENTS.md` constraints.

## RESEARCH COMPLETE
