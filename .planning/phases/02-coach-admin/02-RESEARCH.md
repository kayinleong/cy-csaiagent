# Phase 2: Coach + Admin v1 - Research

**Researched:** 2026-06-02
**Domain:** Multi-surface AI coaching platform — Coach pillar depth + senior-coach dashboard + admin KB manager, on the Phase-1 Next.js 16 / Firebase / AI-SDK-v5 / Gemini-embeddings core.
**Confidence:** HIGH for the existing-code seams (read directly), MEDIUM for the dashboard/recharts + AI-SDK-v5 structured-streaming specifics (verified against current docs), LOW where flagged in the Assumptions Log (checkpoint taxonomy, working-hours definition).

This phase is **grow-not-fork**: every capability extends a Phase-1 seam that I read in source. No new architecture. The genuinely-open work is (1) downline data modelling + double-layer access enforcement, (2) the config/KB-driven journey state machine, (3) wiring real job bodies into the lazy-cron registry, (4) the dashboard read surface, (5) correction→re-ingest loop, (6) admin KB publish/version surface, and (7) the eval regression suite. Each is detailed below with the exact P1 file it grows.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 … D-15)
- **D-01 — Conversation model:** ONE persistent primary "Coach" thread per agent, PLUS a conversation list + search view for history (CHAT-07). Mobile-first: active thread is default screen; history is a drawer/list.
- **D-02 — Trilingual UX:** per-message auto-detect (`franc-min`, already built) drives reply language; a manual language-override chip pins EN/BM/中文 (CHAT-08). UI copy from existing `next-intl` catalogs (extend for P2 strings).
- **D-03 — Streaming + persistence reuse the P1 spine** unchanged: Node-runtime `/api/chat` SSE (`toUIMessageStreamResponse`, `X-Accel-Buffering:no`) → messages subcollection → `after()` audit. Do not re-architect the spine; grow the Coach behind it.
- **D-04 — AI disclosure:** one-time first-run disclosure screen + persistent "AI" badge in chat header (PDPA-aligned, shown before first interaction).
- **D-05 — Handoff control:** inline "Talk to my coach" action in chat header that bundles context (rolling `leadContext` summary + recent messages + `journeyStage`) into an **escalation row** via the P1 `emitHandoffSignal` seam → dashboard. KB-miss (COACH-06) reuses the same path automatically.
- **D-06 — Journey model:** config-driven **linear journey of named checkpoints/stages** in `agentProfiles.journeyStage` / `currentCheckpoint`, with **comprehension checks at key gates** (COACH-09). Journey content references **KB doc IDs** so Derek edits via admin app (no code change). Day-one pairing (COACH-01) introduces Coach, confirms senior-coach assignment, kicks off the KB-driven PowerBoost playlist.
- **D-07 — Playbooks & walkthroughs (COACH-07/08):** delivered as **KB-grounded structured guidance** — channel playbooks (Meta/WhatsApp/Google/iProperty/content) + first-Meta-ad walkthrough are KB docs the Coach retrieves and walks through conversationally with comprehension checkpoints. **No bespoke per-playbook UI.**
- **D-08 — Nudge/escalation engine:** grow the P1 on-visit lazy-cron Server Action (`src/jobs/runDueJobs.ts`) with `stall-detect` (2+ days → in-app nudge into the agent's coach thread, COACH-04), `escalate` (48h no response → escalation row + dashboard stall alert, COACH-05/CDASH-02), and working-hours gating on escalation delivery (CDASH-06).
- **D-09 — ⚠ KNOWN TENSION:** lazy-cron fires on an authorized visit, so a truly idle overnight defers nudges, softening "proactive nudge at 11pm". For the pilot, **in-app-on-visit nudges are the default**; the GitHub Actions scheduled-workflow escape hatch must be **escalated to the user as an explicit decision**, not chosen by an agent.
- **D-10 — Dashboard scope:** single focused downline-scoped dashboard covering all 7 CDASH reqs (downline list w/ stage, stall-alert inbox, knowledge-gap feed, inline AI correction, funnel + ramp metrics) rendered with vendored `recharts`.
- **D-11 — Downline scoping (AUTH-06):** a coach sees ONLY their downline; admin sees all. Enforced by custom claims (`role` + `uplineCoachId`/`seniorCoachId`) AND deny-by-default Firestore rules — **both layers, rules-tested** (extend the P1 CI gate).
- **D-12 — Inline correction → KB feedback (CDASH-04):** a coach correction creates an **attributed KB correction entry that re-ingests** (new `kbDocs` version → re-embed via the existing chunked-poll pipeline). Admin oversight via existing versioning (`supersedesId`). NOT a flag-for-later queue.
- **D-13 — Admin KB: grow, don't fork:** evolve the existing `app/[lang]/(admin)/kb` surface into the full plain-language manager (multi-doc list, version history, plain-language create/edit, multi-format upload, publish/unpublish) behind the `admin` role + AUTH-03 sign-in. **No separate app/deployment.**
- **D-14 — Sign-in surfaces for coach & admin:** add real sign-in for `senior-coach` (→ dashboard) and `admin` (→ KB app), reusing the P1 `requireUser` gate + session-cookie pattern; `set-claims` remains the provisioning path for roles + downline.
- **D-15 — Prompt regression suite (QUAL-06):** expand the P1 single trilingual gold fixture into a Coach regression suite (training Q&A, journey prompts, playbooks) with Opus-judge rubrics for grounding, tone drift, hallucination, language-match — wired into CI (changed-prompt) + the lazy-cron `eval-nightly` job; execute the P1 human-calibration plan with Derek + a coach (>85% judge-human agreement).

### Claude's Discretion (research/planning defaults)
- Exact checkpoint taxonomy / number of journey stages — derive from the D2 onboarding KB + Impl Plan; propose in planning.
- Dashboard information architecture / component composition — choose using vendored shadcn + recharts.
- Voice-sample capture UX during onboarding (P1 reserved `voiceSamples[]`; consumed Phase 4) — **low priority**; include only if it doesn't expand the pilot critical path, else defer.

### Deferred Ideas (OUT OF SCOPE)
- Property Finder + Reply Assistant pillars; LLM intent-classifier activation — Phase 3 / 4.
- WhatsApp Business API / any auto-send — v1 constraint.
- Email/SMS nudge channels — only if pilot proves in-app-on-visit nudges insufficient (ties to D-09).
- Full funnel automation / CRM integration beyond read-only dashboard metrics — later.
- Voice-sample consumption (voice fingerprint in replies) — Phase 4.
- Multi-tenant / white-label, native apps, public recommender — v2.
</user_constraints>

<phase_requirements>
## Phase Requirements (31 IDs — every one must be addressed by the plan)

| ID | Description | Research Support (which finding/seam enables it) |
|----|-------------|--------------------------------------------------|
| AUTH-02 | Senior coach signs in to dashboard | §Auth surfaces — reuse `SignInForm` + `requireUser` + `/api/auth/session` cookie; role-gate redirect to `(coach)` group |
| AUTH-03 | Admin signs in to admin app | §Auth surfaces — same machinery, role-gate to `(admin)` group (KB page already role-checks) |
| AUTH-06 | Coach sees only downline; admin sees all | §1 Downline model + §Security — claims (`uplineCoachId`/`seniorCoachId`) AND firestore.rules double-gate; rules already partially present, must extend conversations/messages/knowledge-gap reads |
| CHAT-01 | Mobile-first chat usable at 11pm | Already shipped (chat shell, `h-[100dvh]`); P2 adds disclosure + handoff + history nav |
| CHAT-02 | Persistent history across sessions | `appendMessage`/`loadRecent` over messages subcollection exist; P2 wires real `cid` persistence (currently client-generated, see Pitfall 2) |
| CHAT-03 | Single surface routes between pillars | Router seam exists (heuristic→coach); P2 keeps heuristic→Coach (multi-pillar is Phase 3) — seam stays, no classifier |
| CHAT-04 | Streaming responses | Shipped (`toUIMessageStreamResponse` + custom SSE parser in `chat-input.tsx`) |
| CHAT-05 | Upfront AI disclosure | §Chat surface — first-run modal + header badge; client-side `localStorage`/Firestore `users.disclosureAckAt` flag |
| CHAT-06 | Inline human-handoff w/ context | §Chat surface + `emitHandoffSignal` — header action bundles `leadContext` summary + recent msgs + `journeyStage` |
| CHAT-07 | Conversation list / search | §Chat surface — `conversations` indexed `(ownerUid, createdAt)`; client-side substring search (Firestore has no native full-text — Pitfall) |
| CHAT-08 | EN/BM/中文 auto-detect + override | `detectLang` (franc-min) shipped; P2 adds manual override chip → passes `override` lang to route + RAG pre-filter |
| COACH-01 | Day-one pairing | §2 Journey — first-checkpoint flow; confirm `seniorCoachId`; kick off KB-driven playlist via journey config |
| COACH-02 | Grounded training Q&A (no generic advice) | Shipped Coach prompt + `retrieveKnowledge` tool + citation contract; P2 grows prompt/tools, keeps grounding mandate |
| COACH-03 | Journey state machine tracks checkpoint | §2 — `agentProfiles.journeyStage`/`currentCheckpoint` + `updateJourneyStage` exist; P2 adds the config + transition logic |
| COACH-04 | Proactive nudge at 2+ days behind | §3 — wire `stall-detect` job body to write an in-app nudge message into the agent's coach thread |
| COACH-05 | Auto-escalate after 48h no response | §3 — wire `escalate` job (currently no-op stub) → `emitHandoffSignal(reason:'stall')` after 48h |
| COACH-06 | KB-miss → explicit handoff w/ context | Shipped (`coachAgent.run` emits handoff on miss); P2 enriches contextBundle + dashboard receives it |
| COACH-07 | First-Meta-ad walkthrough | §2/D-07 — KB-grounded conversational walkthrough; KB doc(s) + checkpoint gating, no bespoke UI |
| COACH-08 | Channel playbook delivery | §2/D-07 — KB docs per channel; Coach retrieves + walks through |
| COACH-09 | Comprehension checkpoints replace passive video | §2 — free-text paraphrase + semantic match (LLM judge or embedding-sim); gates checkpoint advance |
| COACH-10 | Pilot includes 5–10 agents | Provisioning via `set-claims` (assign `uplineCoachId`); ops task, not code |
| CDASH-01 | Downline onboarding stage at a glance | §4 — query `agentProfiles where seniorCoachId == coach.uid`; render stage/last-active/stall |
| CDASH-02 | Stall alerts | §4 — query `escalations where seniorCoachId == coach.uid, status:'open'` (index exists) |
| CDASH-03 | Knowledge-gap feed (questions asked) | §4 + §6 — aggregate KB-miss escalations / low-confidence turns; **needs a queryable signal store** (see Pitfall 7) |
| CDASH-04 | Inline AI correction → KB | §5 — correction → `updateDoc`(new version) → re-ingest via chunked poll; attribute to coach |
| CDASH-05 | Funnel metrics (training→lead→close) | §4 — read-only aggregate; **lead/close data is thin in P2** (Finder is P3) → mostly training-stage funnel (see Pitfall 8) |
| CDASH-06 | Escalation alerts within working hours | §3 — working-hours gate on escalation delivery (timezone Asia/Kuala_Lumpur) |
| CDASH-07 | Reporting tied to 60→7-10 day compression | §4 — derive days-in-journey + checkpoint velocity per agent |
| ADMIN-01 | Plain-language KB management, no engineer | §6/D-13 — grow `(admin)/kb` into full manager |
| ADMIN-03 | KB CRUD docs + chunks | §6 — `createDoc`/`updateDoc`/`deleteDoc`/`listDocs` exist; P2 adds list UI, version history, publish/unpublish, orphan-chunk cleanup |
| QUAL-06 | Prompt regression suite | §7/D-15 — expand gold set + rubrics (judge already 4-domain) + CI + nightly |
</phase_requirements>

## Summary

Phase 2 is an extension sprint over a verified Phase-1 core (read in full: `src/agents/coach`, `router`, `memory`, `escalation`, `jobs`, `rag`, `kb`, `firebase`, `app/api/chat`, the chat + admin surfaces, and `firestore.rules`). The architecture, stack, exec model, and security posture are locked and **must not be re-litigated** (TSD §1–§11, PROJECT.md Key Decisions incl. the 2026-06-01 Gemini + lazy-cron overrides). Embeddings are **Gemini `gemini-embedding-001` @1024-d** via `@ai-sdk/google` (already wired in `src/rag/embed.ts`); scheduling is the **on-visit lazy-cron Server Action** (`src/jobs/runDueJobs.ts`, already concurrency-safe). Stream method is `toUIMessageStreamResponse()` (v5, verified). [VERIFIED: source files + SPIKES.md]

The genuinely-open implementation questions cluster in seven areas, all detailed below: downline data + double-layer access (AUTH-06), the config/KB-driven journey state machine + comprehension checks (COACH-01/03/09), the nudge/escalate/eval job bodies in the lazy-cron registry (COACH-04/05, CDASH-06), the full chat surface (history/search/disclosure/handoff/language-override), the correction→re-ingest loop (CDASH-04), the admin KB manager with publish/version (ADMIN-01/03), and the Promptfoo regression suite (QUAL-06).

**Primary recommendation:** Treat Phase 2 as "wire the stubs + build the read surfaces", not "build new systems". The escalation seam, journey fields, job registry, KB CRUD, and grounding contract all already exist as thin-but-real code. The four highest-leverage risks the planner must front-load are: (1) the **D-09 lazy-cron-vs-wall-clock tension** — escalate to the user before pilot; (2) a **knowledge-gap signal store** that is queryable per-coach (CDASH-03 currently has nowhere to read from); (3) **KB publish/supersede semantics** — retrieval today does NOT filter by published/superseded status, so a re-ingest (D-12) leaves stale chunks retrievable (orphan-chunk + double-answer bug); and (4) **conversation persistence wiring** — the chat route persists only the assistant message and the client generates throwaway `cid`s, so CHAT-02/07 need real conversation lifecycle work.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Downline access enforcement (AUTH-06) | API/Backend (firestore.rules + Admin SDK) | Frontend server (claims read in RSC) | Authorization is server-owned; both rules + claims must agree (deny-by-default). Never trust client. |
| Journey state transitions (COACH-03/09) | API/Backend (`src/memory` + new journey config) | — | State writes go through Admin SDK / Server Actions; agentProfiles is rules-protected (self + coach + admin). |
| Comprehension-check grading (COACH-09) | API/Backend (`src/agents/coach` + LLM/embedding) | — | Semantic match needs the model/embedder — server-only (PDPA + key custody). |
| Nudge/escalate/eval jobs (COACH-04/05, CDASH-06, QUAL-06 nightly) | API/Backend (lazy-cron Server Action) | — | Admin-SDK writes (escalations, nudge messages, evals) bypass rules; must run server-side. |
| Chat streaming (CHAT-04) | API/Backend (Node Route Handler) | Browser/Client (SSE consumer) | Locked: stream from Route Handler, never Server Action. Client parses UIMessage chunks. |
| Conversation history + search (CHAT-02/07) | API/Backend (Firestore reads) | Browser/Client (search UI) | Firestore has no native full-text; client-side substring filter over server-paginated list. |
| AI disclosure (CHAT-05) | Browser/Client (modal + badge) | API/Backend (ack flag persist) | Pure UX; ack persisted to `users` doc or localStorage. |
| Senior-coach dashboard reads (CDASH-01..07) | API/Backend (RSC server reads via Admin SDK after role gate) | Browser/Client (recharts render) | Reads must be downline-scoped server-side; recharts is a `'use client'` island. |
| Inline correction → re-ingest (CDASH-04/D-12) | API/Backend (`src/kb` Server Action + chunked-poll) | Browser/Client (poll loop) | Re-embed is long-running → chunked client-driven poll (never one request). |
| Admin KB manage (ADMIN-01/03) | API/Backend (Server Actions, role-gated) | Browser/Client (forms/list) | Mutations via Server Actions; admin gate on both page + action (already patterned). |

## Standard Stack

**No new core dependencies are required for Phase 2.** Everything is already in `package.json` (verified). [VERIFIED: package.json]

### Core (already installed — versions verified in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.6` | App Router, RSC, Route Handlers, Server Actions | Locked. `proxy.ts` not middleware; async `cookies()`/`headers()`; no implicit fetch cache. |
| `react` | `19.2.4` | UI runtime | Required by AI SDK v5 streaming. |
| `ai` | `^5.0.193` | streamText + tools + structured output | Locked at v5; stream method `toUIMessageStreamResponse()` (v4 `toDataStreamResponse` does NOT exist in v5). [VERIFIED: SPIKES.md + source] |
| `@ai-sdk/anthropic` | `^2.0.80` | Claude provider (Sonnet default, Opus judge) | Model IDs from Remote Config via `modelFor()` — never hard-coded. |
| `@ai-sdk/google` | `^2.0.74` | Gemini `gemini-embedding-001` @1024-d embeddings | Overrides Voyage (2026-06-01). Wired in `src/rag/embed.ts`. |
| `firebase` / `firebase-admin` | `^12.14` / `^13.10` | Auth, Firestore (system of record + vector store + bus), Storage | Locked. Admin SDK server-only; client SDK for client reads. |
| `recharts` | `^3.8.0` | Dashboard metrics charts (CDASH-05/07) | Vendored. SVG-based; works in Next.js client components with `'use client'`. May need `react-is` override pin under React 19. [VERIFIED: npm + recharts#4558] |
| `next-intl` | `^4.13` | Trilingual UI copy (extend catalogs for P2 strings) | Catalogs at `src/i18n/messages/{en,ms,zh}.json`. |
| `franc-min` | `^6.2` | Per-message language detection | `detectLang()` shipped; reused for CHAT-08. |
| `zod` | `^4.4.3` | Output schemas + AI SDK tool `inputSchema` | Coach output schema already enforces citation contract. |
| `promptfoo` | `^0.121.13` | Eval suites (Opus judge) | Judge rubric already 4-domain in `src/eval/judge.ts`. |
| `vitest` / `@playwright/test` / `@firebase/rules-unit-testing` | `^4.1.7` / `^1.60` / `^5.0.1` | Unit / E2E / rules tests | CI gates extend to new rules + flows. |

### Supporting (vendored UI — use, don't add)
| Library | Purpose | When to Use |
|---------|---------|-------------|
| shadcn/ui (`components/ui/`) | All dashboard + admin + chat UI primitives (55 components vendored) | Dashboard tables, dialogs (disclosure modal), forms, badges (AI badge), drawers (history) |
| `sonner` | Toasts | Handoff/nudge notifications (already used in chat) |
| `cmdk` | Command palette | Optional: conversation search (CHAT-07) |
| `react-resizable-panels` | Split layouts | Dashboard panels (optional) |
| `date-fns` | Date math | Days-in-journey, working-hours gating, stall windows |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side substring conversation search | Algolia / Typesense | FEATURES.md says substring + tag filter is acceptable for MVP; external search service adds a dependency + cost. Stay client-side for the pilot. |
| Firestore-only knowledge-gap aggregation | BigQuery | Forbidden by C2 (no GCP beyond Firebase). Aggregate in Firestore with a queryable signal collection. |
| AI-SDK `experimental_output` structured streaming for Coach | Keep current `run()` JSON-parse path | AI SDK v5 structured output **with tools** is OpenAI-only as of current docs; Coach uses Anthropic + a tool. Keep the existing tool-result + post-parse citation path. [VERIFIED: ai-sdk.dev docs] |

**No install needed.** If recharts fails to render under React 19, add an `overrides` pin for `react-is` matching React 19 in `package.json` (known recharts/React-19 fix). [CITED: github.com/recharts/recharts#4558]

## Architecture Patterns

### System Architecture Diagram (Phase-2 data flow)

```
                         ┌──────────────────────────────────────────────┐
   agent (mobile)        │  app/[lang]/(chat)  — disclosure modal + AI   │
   ───────────────▶      │  badge + history drawer + lang-override chip  │
                         └───────────────┬──────────────────────────────┘
                                         │ POST /api/chat (Bearer)  [SSE]
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │ /api/chat (Node Route Handler) — UNCHANGED SPINE                      │
   │  requireUser → ratelimit → pseudonymize+assertRedacted → route(coach) │
   │  → coachAgent(systemPrompt + journey-context + tools) → streamText    │
   │  → toUIMessageStreamResponse                                          │
   │  onFinish: appendMessage + decrement + after(audit.log)               │
   └───────┬──────────────────────────────┬──────────────────────────────┘
           │ retrieveKnowledge tool         │ KB miss → emitHandoffSignal
           ▼                                ▼
   ┌───────────────┐               ┌──────────────────┐
   │ src/rag       │  findNearest  │ escalations/{eid} │◀──── stall-detect /
   │ (Gemini embed,│◀──kbChunks────│ (reason: kb_miss  │      escalate jobs
   │ lang-filter)  │               │  | stall)         │      (lazy-cron)
   └───────▲───────┘               └─────────▲─────────┘
           │ published+current chunks only    │ downline-scoped read
           │ (NEW filter — Pitfall 3)         │
   ┌───────┴───────────────┐        ┌─────────┴──────────────────────────┐
   │ src/kb (CRUD + version│        │ app/[lang]/(coach) DASHBOARD (RSC)  │
   │ + chunked re-ingest)  │        │ downline list / stall inbox /       │
   │  ▲ correction (D-12)  │        │ knowledge-gap feed / inline correct │
   │  │                    │        │ / funnel+ramp (recharts client)     │
   └──┼────────────────────┘        └─────────────────────────────────────┘
      │ updateDoc(new version)              ▲ AUTH-06: claims + firestore.rules
      │ → /api/kb/ingest/process poll       │ (downline-only) — BOTH layers
   ┌──┴───────────────────────────┐
   │ app/[lang]/(admin)/kb MANAGER │  admin role-gated (page + action)
   │ list / version hist / publish │
   │ / multi-format upload         │
   └───────────────────────────────┘

   on-visit lazy-cron (Server Action triggered from any authed page):
     runDueJobs() → { stall-detect (nudge), escalate (48h), eval-nightly,
                      usage-rollup } — last-run-per-window guard, heartbeat
```

### Recommended Project Structure (additions only — grow, don't fork)
```
app/[lang]/
├── (coach)/                      # NEW route group — senior-coach dashboard
│   ├── dashboard/page.tsx        #   RSC: role-gate senior-coach, downline reads
│   ├── _components/              #   'use client' islands: charts (recharts),
│   │                             #   stall inbox, gap feed, inline-correct dialog
│   └── layout.tsx                #   coach shell
├── (admin)/kb/                   # GROW existing — full manager
│   ├── page.tsx                  #   (exists) + version history, publish toggle
│   ├── [docId]/page.tsx          #   NEW: edit/version-history per doc
│   └── kb-doc-form.tsx           #   (exists) extend for plain-language edit
├── (auth)/sign-in/               # GROW: role-aware post-sign-in redirect
└── (chat)/...                    # GROW chat shell: disclosure modal, AI badge,
                                  #   history drawer, lang-override chip

src/
├── coach/journey/                # NEW: config-driven journey state machine
│   ├── config.ts                 #   stages/checkpoints referencing KB doc IDs
│   ├── transition.ts             #   advance/gate logic (pure, testable)
│   └── comprehension.ts          #   semantic-match grading (COACH-09)
├── agents/coach/                 # GROW prompt + tools (journey/playbook context)
├── jobs/runDueJobs.ts            # GROW: wire stall-detect nudge body + escalate
├── escalation/                   # GROW: contextBundle enrichment + dashboard reads
├── kb/                           # GROW: publish/supersede semantics + orphan cleanup
└── dashboard/                    # NEW (optional): downline query helpers (core/shell)
```

### Pattern 1: Route Handler streams, Server Action mutates (LOCKED)
**What:** SSE/streaming lives ONLY in `/api/chat` (Node Route Handler). All KB/journey/correction mutations are Server Actions. Long re-ingest is chunked client-driven poll, never one request, never inside `after()`.
**When to use:** Every Phase-2 write.
**Example:** `app/[lang]/(admin)/kb/actions.ts` (Server Action mutation pattern) + `app/api/kb/ingest/process/route.ts` (poll worker). Disclosure-ack write, journey advance, correction submit → Server Actions.

### Pattern 2: Double-layer downline authorization (AUTH-06)
**What:** Authorization enforced in BOTH custom claims (role + relationship) AND `firestore.rules`. Server reads use Admin SDK (bypass rules) but MUST apply the same downline filter in query (`where('seniorCoachId','==',coach.uid)`); client reads are rules-gated.
**When to use:** Every dashboard read of downline data; every coach-scoped collection.
**Example (existing, extend):**
```
// firestore.rules — agentProfiles already has the pattern:
match /agentProfiles/{uid} {
  allow read: if isSelf(uid)
    || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant())
    || (hasRole('admin') && sameTenant());
}
// escalations already scoped to seniorCoachId; conversations/messages are
// owner-only + admin — NO senior-coach read path yet. P2 must ADD a downline
// drilldown rule for conversations/messages IF the dashboard shows transcripts
// (CDASH-03 / Pitfall 27) — and audit-log every coach read of agent data (PDPA).
```
**Source:** `firestore.rules` lines 72–84 (agentProfiles), 196–206 (escalations). [VERIFIED: source]

### Pattern 3: Config/KB-driven journey state machine (COACH-03/06/07/09)
**What:** A pure, framework-free linear journey config in `src/coach/journey/config.ts`: ordered stages → checkpoints, each checkpoint referencing KB `docId`(s) for content and an optional comprehension gate. State lives in `agentProfiles.journeyStage` / `currentCheckpoint` (fields already exist + `updateJourneyStage()` already written). Advancement is a pure transition function; gating uses semantic match on a free-text paraphrase (COACH-09 — "evidence", not MCQ, per FEATURES.md line 106).
**When to use:** Day-one pairing (COACH-01), checkpoint tracking (COACH-03), playbook/walkthrough delivery (COACH-07/08 reference KB docs), comprehension gates (COACH-09).
**Example (grows the existing seam):**
```ts
// src/memory/agentProfile.ts already exports:
//   updateJourneyStage(uid, stage, checkpoint?)  // sets journeyStage + lastActiveAt
//   touchLastActive(uid)
// P2 adds src/coach/journey/transition.ts (pure):
export function nextCheckpoint(config: JourneyConfig, stage: string, checkpoint: string): Step | null
// and src/coach/journey/comprehension.ts:
//   gradeParaphrase(answer, canonicalChunkText): {pass: boolean; score: number}
//   via embedding cosine-sim (reuse embedText) or an Opus/Sonnet judge call.
```
Journey content references KB doc IDs so Derek edits content (not code) — honors D-06.

### Pattern 4: Lazy-cron job bodies (COACH-04/05, CDASH-06, QUAL-06 nightly)
**What:** Wire the existing **no-op stubs** in `JOB_REGISTRY` (`src/jobs/runDueJobs.ts`). The runner is already concurrency-safe (Firestore transaction, last-run-per-window) and writes heartbeats. Each body must be idempotent.
**When to use:** stall-detect (nudge), escalate (48h), eval-nightly.
**Example (the stubs to fill):**
```ts
// src/jobs/runDueJobs.ts JOB_REGISTRY:
'stall-detect': { windowMs: ONE_DAY_MS, run: /* EXISTS: findStalled(2d) → emitHandoffSignal('stall') */ }
//   P2: ALSO write an in-app nudge message into the agent's coach thread (COACH-04).
escalate:       { windowMs: ONE_DAY_MS, run: async () => {} }  // STUB → wire 48h escalation
'eval-nightly': { windowMs: ONE_DAY_MS, run: async () => {} }  // STUB → run Promptfoo, write evals/
'usage-rollup': { windowMs: ONE_DAY_MS, run: async () => {} }  // Phase-3 (leave stub)
```
**Working-hours gate (CDASH-06):** gate *escalation delivery/visibility* by Asia/Kuala_Lumpur business hours using `date-fns`; the job may *detect* outside hours but should not surface an alert until working hours (decide: defer-write vs write-but-hide). [ASSUMED — exact working-hours definition not specified]
**Source:** `src/jobs/runDueJobs.ts` lines 68–106, `src/jobs/heartbeat.ts`. [VERIFIED]

### Pattern 5: Correction → versioned re-ingest (CDASH-04 / D-12)
**What:** A coach inline-correction calls `updateDoc(user, docId, {content})` which already creates a **new versioned `kbDocs`** (`supersedesId`) and shards a re-ingest job. The browser then polls `/api/kb/ingest/process` to embed the new chunks. Attribution: store the correcting coach's uid on the new version (NEW field).
**When to use:** CDASH-04 inline correction.
**CRITICAL gap:** see Pitfall 3 — old (superseded) chunks are NOT removed and retrieval does NOT filter by version/published, so after a correction the Coach can retrieve BOTH the old and corrected content. Must add a publish/supersede filter to retrieval + an orphan-chunk cleanup, or the correction loop produces double/contradictory answers.
**Source:** `src/kb/crud.ts` `updateDoc` lines 171–222; `src/kb/ingest/pipeline.ts`. [VERIFIED]

### Anti-Patterns to Avoid
- **Streaming from a Server Action** — locked prohibition; stream only from `/api/chat` Route Handler.
- **Re-architecting the chat spine** — D-03 forbids; grow the Coach behind the unchanged pipe.
- **Activating the LLM intent classifier** — Phase 3 only; router stays heuristic→Coach (`classifyIntent` throws `NotActivatedError`; do not import it into `heuristic.ts`).
- **Bespoke per-playbook UI** — D-07 forbids; playbooks are KB docs walked through conversationally.
- **Hard-coding model IDs** — resolve from Remote Config via `modelFor()`.
- **Inline message arrays** — messages stay in the subcollection (`appendMessage`); never an array on the conversation doc (1 MB trap).
- **Blanket `if signed-in` rules** — deny-by-default; every new rule checks ownership/role + tenant.
- **MCQ comprehension checks** — FEATURES.md: gameable; use free-text paraphrase + semantic match.
- **Over-nudging** — PITFALLS #16: cap nudge cadence (≤1 in-app nudge/stall window); do not add multiple daily nudges.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scheduled jobs | A new cron service / QStash | Existing `runDueJobs` lazy-cron registry | Concurrency-safe + heartbeat already built; locked decision. |
| Stall detection | New query logic | `findStalled({days})` in `src/escalation/detect.ts` | Built + unit-tested with injectable clock. |
| Escalation rows + dedup | New escalation writer | `emitHandoffSignal()` (dedup-guarded) | Built; dashboard reads the same `escalations` collection. |
| KB chunking + idempotent ingest | New pipeline | `shardJob` + `processBatch` (sha256 idempotency) | Built; multi-format extract already done. |
| KB versioning | New version scheme | `updateDoc` → `supersedesId` + version bump | Built; just add publish filter + cleanup. |
| Embeddings | Any other embedder | `embedText()` (Gemini @1024-d, normalized) | Built + locked; matches the 1024-d index. |
| Citation contract | New citation format | `buildCitations` + `CoachOutputSchema` | Built; never fabricate chunk IDs (T-01-27). |
| Language detection | New detector | `detectLang()` (franc-min) | Built + tested incl. BM/ZH code mapping. |
| Auth gate + claims | New auth | `requireUser` + `setUserClaims` + `/api/auth/session` cookie | Built; role union validated; fails closed. |
| Conversation full-text search | Algolia/Typesense (for MVP) | Client-side substring + tag filter over server-paginated list | FEATURES.md accepts substring for MVP; Firestore has no native full-text. |
| Charts | Custom SVG/canvas | Vendored `recharts` | Vendored; D-10 specifies recharts. |

**Key insight:** Nearly every "system" Phase 2 needs already exists as a thin-but-real seam. The work is *wiring bodies into stubs* and *building read surfaces*, not building infrastructure. The two places you genuinely build new logic are the **journey config/transition/comprehension** module and the **knowledge-gap signal store** (CDASH-03 has no queryable source today).

## Runtime State Inventory

> Phase 2 is mostly additive (new fields, new collections-of-records, new routes). The migration-relevant items:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `agentProfiles.journeyStage` defaults to `'onboarding'` / `currentCheckpoint:'start'` (set by `setUserClaims` for new-agents). Existing pilot agents provisioned in P1 already have these defaults — the P2 journey config must treat `'start'` as the entry checkpoint or migrate. `kbDocs` already in store have `publishedAt` but NO `status`/`published`/`supersededBy` field. | Code: journey config maps existing defaults. Data: if adding a `published`/`status` field to `kbDocs`, backfill existing docs to `published` (or retrieval breaks). |
| Live service config | Firebase **Remote Config** holds model IDs (`model.*`) + must add `model.grader.default` (judge) if not present (referenced by `src/eval/judge.ts`). NOT in git — Derek manages in console. | Manual: confirm Remote Config keys exist before eval-nightly runs. |
| OS-registered state | None — no OS schedulers (lazy-cron is in-app). | None. |
| Secrets/env vars | `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `JUDGE_MODEL` (eval runner reads from env, populated from Remote Config). No new secrets in P2. | None new; ensure `JUDGE_MODEL` set in CI for eval-nightly. |
| Build artifacts | None new. | None. |
| Firestore indexes | Existing composite indexes cover `(ownerUid,createdAt)` conversations, `lastActiveAt` agentProfiles, `(seniorCoachId,status)` escalations, kbChunks vector+lang, projects. **NEW queries P2 likely needs:** knowledge-gap feed aggregation, conversation list per owner ordered (covered), possibly `kbDocs` ordered by `(pillar, publishedAt)` and a `supersedesId`/`supersededBy` filter. | Add indexes to `firestore.indexes.json` for any new composite query (esp. knowledge-gap signal collection + kbDocs status filter). |

**Verified by reading:** `src/firebase/auth.ts` (setUserClaims defaults), `firestore.indexes.json`, `src/eval/judge.ts`, `src/kb/crud.ts`.

## Common Pitfalls

### Pitfall 1: D-09 — lazy-cron defers the "11pm proactive nudge" (PRODUCT-LEVEL RISK)
**What goes wrong:** Nudges/escalations fire only when *some authorized user visits* and triggers `runDueJobs()`. A genuinely idle overnight (no agent opens the app) defers the nudge — directly softening the core value ("a useful answer in their pocket at 11pm" / proactive nudge).
**Why it happens:** On-visit lazy-cron has no wall-clock; the last-run guard only ensures at-most-once-per-window when a visit happens. [VERIFIED: `runDueJobs.ts` + TSD §3.4]
**How to avoid:** For the pilot, accept in-app-on-visit nudges (D-09 default). The documented escape hatch (GitHub Actions scheduled workflow pinging a thin authenticated endpoint) is an **explicit user decision** — surface it to the user *before* the pilot, not after (CONTEXT.md "Specifics" calls this the single biggest open risk). The heartbeat + UI watchdog (built) surfaces a stale last-run.
**Warning signs:** Coach reports "no stall alerts in weeks" with no way to tell if nobody stalled or the cron didn't fire (PITFALLS #11/#17).

### Pitfall 2: Conversation persistence is half-wired (CHAT-02 / CHAT-07)
**What goes wrong:** Today `/api/chat` persists ONLY the assistant message (`appendMessage(cid, assistantMsg)` in `onFinish`) — the **user message is never persisted**, and the client generates a throwaway `cid` (`conv-${Date.now()}`) on each mount. There is no `conversations/{cid}` doc created, no user-message write. History (CHAT-02) and list/search (CHAT-07) have nothing durable to read.
**Why it happens:** P1 was a proof-slice; persistence was minimal.
**How to avoid:** P2 must (a) create/lookup the persistent primary "Coach" thread per agent (D-01) — a stable `cid` (e.g., `coach-${uid}`), (b) persist the user message too, (c) write the `conversations/{cid}` doc (`ownerUid`, `pillar`, `lang`, `createdAt`, `summary`), (d) load history via `loadRecent(cid, n)` on mount. The rules already allow owner create/read of conversations + messages.
**Warning signs:** Refresh loses the thread; history drawer is empty. [VERIFIED: `app/api/chat/route.ts` lines 173–207, `chat-input.tsx` line 94]

### Pitfall 3: Re-ingest leaves stale chunks retrievable — correction loop double-answers (CDASH-04 / D-12 / ADMIN publish-unpublish)
**What goes wrong:** `updateDoc` creates a NEW versioned `kbDocs` (`supersedesId`) and embeds new chunks, but (a) old chunks are NOT deleted (`deleteDoc` comment: "associated kbChunks are NOT automatically deleted in v1") and (b) `firestoreRetrieve` queries `kbChunks` with only a `lang` pre-filter — **no published / not-superseded filter**. After a coach correction, the Coach can retrieve BOTH the wrong (old) and corrected (new) chunks → contradictory grounded answers. Same bug defeats ADMIN publish/unpublish: an "unpublished" doc's chunks remain retrievable.
**Why it happens:** P1 retrieval keys only on `lang`; KB versioning and retrieval were built independently.
**How to avoid:** P2 must connect them: add a `status`/`published` flag (and/or `supersededBy`) to `kbChunks` (denormalized from `kbDocs`), and add that filter to `firestoreRetrieve` (`where('status','==','published')`), OR delete/replace old chunks on re-ingest. Backfill existing chunks to `published`. Add a new composite index (`lang` + `status` + vector). This is the load-bearing fix for both D-12 and publish/unpublish (D-13). PITFALLS #19 (stale KB) is the same failure mode.
**Warning signs:** Coach cites two contradictory chunks; "unpublished" content still answered. [VERIFIED: `src/rag/search.ts` lines 80–90, `src/kb/crud.ts` lines 250–253, `firestore.indexes.json`]

### Pitfall 4: CDASH-03 knowledge-gap feed has no queryable source
**What goes wrong:** The dashboard must show "questions agents asked the AI" / knowledge gaps. Today the only durable signal of a gap is a KB-miss `escalations` row (`reason:'kb_miss'`) whose `contextBundle` deliberately stores **no query text** (PDPA — only `conversationId`, `lang`). There is no collection of "questions asked" or low-confidence answers to aggregate per coach.
**Why it happens:** P1 audit/escalation store hashes/references only (PDPA-correct), so the raw signal needed for a gap feed isn't captured anywhere queryable.
**How to avoid:** P2 needs a deliberate, PDPA-safe signal store: either (a) store a pseudonymized/redacted query summary on kb_miss escalations (the query is the agent's own training question — generally not client PII, but apply the same redaction gate to be safe), or (b) a new `knowledgeGaps` collection keyed by `(seniorCoachId, topicHash, count)` aggregated by a job. Decide the schema in planning; add the index. CDASH-03 cannot be built without this.
**Warning signs:** Gap feed is empty or requires reading raw transcripts (PDPA hazard). [VERIFIED: `src/escalation/handoff.ts` contextBundle, `src/jobs/runDueJobs.ts` stall body]

### Pitfall 5: Senior-coach transcript drilldown needs a NEW rule + audit (PDPA)
**What goes wrong:** `firestore.rules` for `conversations` + `messages` allow ONLY owner + admin reads — there is **no senior-coach downline read path**. If the dashboard shows downline conversation transcripts (CDASH-03 drilldown / handoff context, PITFALLS #27), the rules must be extended AND every coach read of agent conversation data must be audit-logged (TSD §5.1 "read-only conversation drilldown (audit-logged)").
**Why it happens:** P1 scoped conversations to owner-only.
**How to avoid:** Decide whether the dashboard shows full transcripts or just summaries/escalation bundles. If transcripts: add a downline rule (`hasRole('senior-coach') && <agent.uplineCoachId == coach.uid>`) — note this requires a cross-doc lookup (the conversation has `ownerUid`, not `uplineCoachId`), so either denormalize `uplineCoachId` onto the conversation or do server-side reads via Admin SDK with an explicit downline filter + audit row. Prefer server-side reads + audit; keep client rules owner-only. Rules-test the new path.
**Warning signs:** Either the dashboard can't load downline data, or it over-reads (cross-coach leak). [VERIFIED: `firestore.rules` lines 87–115]

### Pitfall 6: Structured-output streaming + tools is not available for Anthropic (Coach)
**What goes wrong:** Tempting to switch the Coach to AI SDK `experimental_output` to stream the structured `{answer, citations, handoff}` object directly. But structured output **combined with tools** is OpenAI-only in current AI SDK v5; the Coach uses Anthropic + the `retrieveKnowledge` tool.
**Why it happens:** Provider capability gap.
**How to avoid:** Keep the existing approach: stream plain text via `toUIMessageStreamResponse()`, extract citations from the tool result (`buildCitations`), and validate/assemble the structured output server-side in `coachAgent.run()`. P2: actually populate `MessageDoc.citations` from tool results in `onFinish` (currently hard-coded `citations: []` — TODO at route.ts line 179). [VERIFIED: ai-sdk.dev structured-data docs + `app/api/chat/route.ts`]
**Warning signs:** Citations never persist; grounding evidence lost in history.

### Pitfall 7: recharts under React 19 / RSC
**What goes wrong:** recharts charts fail to render under React 19 / when mounted in a Server Component.
**How to avoid:** Render charts only inside `'use client'` islands (dashboard panels). If render fails, add a `react-is` `overrides` pin matching React 19 in `package.json`. [CITED: recharts#4558]
**Warning signs:** Blank chart area, `react-is` version mismatch warnings.

### Pitfall 8: Funnel metrics (CDASH-05) are thin in Phase 2
**What goes wrong:** "training → first lead → first close" funnel assumes lead/close data — but the Finder pillar (leads/projects) is **Phase 3**, and there's no close-tracking in P2.
**How to avoid:** Scope CDASH-05/07 to what exists in P2: training-stage funnel (checkpoints completed, days-in-journey, checkpoint velocity, stall rate) and the 60→7-10-day ramp proxy (days to checkpoint-N). Surface lead/close columns as "coming with Finder (P3)" or omit. Confirm scope with the planner against ROADMAP success criteria (which emphasize onboarding-stage visibility, not close data, for P2). [VERIFIED: REQUIREMENTS traceability — FIND-* is Phase 3]

### Pitfall 9: Over-nudging / nudge cadence (PITFALLS #16)
**What goes wrong:** Multiple nudges/day → agent disables notifications → AI loses its channel.
**How to avoid:** In-app nudge only (no push in v1), ≤1 nudge per stall window, dedup-guarded (reuse `emitHandoffSignal` dedup pattern for nudges too). Pilot survey asks "helpful or annoying?".

## Code Examples

### Wiring the escalate job body (COACH-05) — fill the stub
```ts
// src/jobs/runDueJobs.ts — replace `escalate: { run: async () => {} }`
// 48h no-response escalation: find agents stalled ≥2 days whose stall has aged
// past 48h without a coach-thread reply, emit a 'stall' escalation if not already open.
escalate: {
  windowMs: ONE_DAY_MS,
  run: async () => {
    const stalled = await findStalled({ days: 2 })          // existing
    for (const a of stalled) {
      // gate by working hours (Asia/Kuala_Lumpur) before surfacing — CDASH-06
      await emitHandoffSignal({                             // existing, dedup-guarded
        agentUid: a.agentUid, seniorCoachId: a.seniorCoachId,
        reason: 'stall', contextBundle: { lastActiveAt: a.lastActiveAt },
      })
    }
    await writeHeartbeat('escalate')
  },
},
// Source: src/jobs/runDueJobs.ts (registry), src/escalation/* (findStalled, emitHandoffSignal)
```

### Persisting citations from tool results (Pitfall 6 fix)
```ts
// app/api/chat/route.ts onFinish — replace `citations: []`
// AI SDK v5 exposes tool calls/results on the finish payload; map the
// retrieveKnowledge result's citations[].chunkId into the persisted message.
const citationIds = extractCitationChunkIds(final)  // from tool results
const assistantMsg: MessageDoc = { /* ... */ citations: citationIds /* ... */ }
// Source: app/api/chat/route.ts lines 173–186; src/agents/coach/tools.ts RetrieveHit.citations
```

### Downline dashboard read (server-side, downline-scoped) — CDASH-01/02
```ts
// In app/[lang]/(coach)/dashboard/page.tsx (RSC) AFTER role-gate to senior-coach:
const coach = await requireUser(syntheticReqFromSessionCookie)   // existing pattern
if (coach.role !== 'senior-coach' && coach.role !== 'admin') redirect(...)
const downline = await agentProfilesRef()
  .where('seniorCoachId', '==', coach.uid).get()                 // index exists
const openStalls = await escalationsRef()
  .where('seniorCoachId', '==', coach.uid).where('status','==','open').get() // index exists
// Source: src/firebase/collections.ts refs; firestore.indexes.json (both indexes present)
```

## State of the Art

| Old Approach (P1 / pre-2026-06-01) | Current Approach (P2) | When Changed | Impact |
|------------------------------------|-----------------------|--------------|--------|
| Voyage `voyage-3-large` embeddings | Gemini `gemini-embedding-001` @1024-d (`@ai-sdk/google`) | 2026-06-01 override | KB + retrieval use Gemini; 1024-d index unchanged; already wired. |
| QStash / Cloud Scheduler cron | On-visit lazy-cron Server Action | 2026-06-01 override | No external scheduler; SPIKE-CRON retired; D-09 tension introduced. |
| AI SDK v4 `toDataStreamResponse()` | v5 `toUIMessageStreamResponse()` | AI SDK v5 (2025-07) | v4 method does NOT exist in installed v5.0.193; route already uses v5 method. |
| Coach prompt thin (proof-slice) | Coach prompt + journey/playbook context + comprehension gating | P2 | Grow prompt; keep grounding mandate + Zod schema. |
| Conversations not persisted (throwaway cid) | Persistent primary thread + history/search | P2 | Must wire conversation lifecycle (Pitfall 2). |

**Deprecated/outdated (do not use):**
- `toDataStreamResponse()` — does not exist in `ai@5.0.193`.
- Voyage / QStash references in 01-CONTEXT.md and older TSD wording — superseded.
- `classifyIntent` LLM router — dormant until Phase 3 (throws `NotActivatedError`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Working-hours for CDASH-06 = Asia/Kuala_Lumpur business hours (e.g. 9–18); exact window unspecified | Pattern 4 / Pitfall 1 | Escalations surface at wrong times; needs Derek's definition. |
| A2 | Comprehension grading (COACH-09) can use embedding cosine-sim against canonical chunk text OR a Sonnet/Opus judge; either is acceptable for the pilot | Pattern 3 | If a stricter rubric is required, grading logic changes; verify acceptable accuracy with Derek + a coach. |
| A3 | Knowledge-gap signal (CDASH-03) can be derived from kb_miss escalations + a new aggregation; agent *training questions* are generally not client PII | Pitfall 4 | If treated as PII, must redact before storing → schema changes. |
| A4 | Funnel (CDASH-05) is scoped to training-stage metrics in P2 (no lead/close data until Finder/P3) | Pitfall 8 | If Derek expects lead/close columns in P2, scope expands beyond Coach pillar. |
| A5 | Checkpoint taxonomy / stage count derived from the D2 onboarding KB (PowerBoost) — not yet enumerated | Discretion / Pattern 3 | Journey config shape depends on actual D2 content; propose in planning, confirm with Derek. |
| A6 | Dashboard shows escalation bundles + summaries, not full raw transcripts, to avoid the PDPA drilldown rule complexity | Pitfall 5 | If full transcript drilldown is required, add rule + audit + denormalization. |
| A7 | `recharts@3.8` renders under React 19 in `'use client'` islands (may need `react-is` override) | Pitfall 7 | If render fails without override, add `overrides` pin — minor. |
| A8 | A `published`/`status` field added to `kbChunks` + retrieval filter is the chosen fix for stale-chunk retrieval | Pitfall 3 | Alternative (delete old chunks on re-ingest) changes the re-ingest path; pick one in planning. |

## Open Questions

1. **Wall-clock nudges (D-09).** Should the pilot ship the GitHub Actions scheduled-workflow escape hatch, or accept on-visit-only nudges? — *Recommendation: escalate to the user before pilot; default to on-visit per D-09; build the heartbeat/watchdog regardless.*
2. **Knowledge-gap signal schema (CDASH-03).** New `knowledgeGaps` collection vs. enriched kb_miss escalations? — *Recommendation: decide in planning; lean toward a dedicated aggregated collection so the dashboard read is cheap (Pitfall: read-cost #9).*
3. **KB stale-chunk fix (Pitfall 3).** Status-filter retrieval vs. delete-on-reingest? — *Recommendation: status-filter (`published`) on `kbChunks` + backfill + index; it also gives publish/unpublish for free (D-13).*
4. **Transcript drilldown depth (CDASH-03).** Summaries/bundles vs. full transcripts? — *Recommendation: bundles + summaries for the pilot (avoids the PDPA rule + audit complexity); revisit post-pilot.*
5. **Working-hours definition (CDASH-06).** Exact business-hours window + timezone confirmation. — *Needs Derek.*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Live Firebase (Auth/Firestore/Storage/App Hosting) `asia-southeast1` | All P2 runtime | ✗ (gated) | — | **BLOCKS execution** — Phase-1 gate 01-01 provisioning + Derek region sign-off must close first |
| Gemini Developer API key (`GOOGLE_GENERATIVE_AI_API_KEY`) | Embeddings, comprehension grading | ✗ (gated) | — | Bind via Secret Manager (01-01) |
| Anthropic API key (`ANTHROPIC_API_KEY`) | Coach + Opus judge | ✗ (gated) | — | Bind via Secret Manager (01-01) |
| Firebase Remote Config (`model.*`, `model.grader.default`) | Model resolution + eval judge | ✗ (gated) | — | Derek configures keys in console before eval-nightly |
| `node_modules` libraries (ai, recharts, next-intl, promptfoo, etc.) | Build/test | ✓ | per package.json | — |
| Firestore `findNearest` live latency/recall (SPIKE-RAG) | RAG quality bar | ✗ (gated) | — | Pinecone Serverless fallback behind `rag/` adapter if SPIKE-RAG fails |
| SSE on App Hosting (SPIKE-DEPLOY) | Streaming chat | ✗ (gated) | — | Non-streaming fallback / Vercel front-end (needs residency sign-off) |
| Chunked PDF ingest within budget (SPIKE-INGEST) | KB ingestion | ✗ (gated) | — | Smaller batch limit / re-chunk |

**Missing dependencies with no fallback (BLOCK Phase-2 execution — planning may proceed):**
- Phase-1 open gates: 01-01 live provisioning + region sign-off; SPIKE-RAG, SPIKE-DEPLOY, SPIKE-INGEST live runs; live-stack proof (Playwright + Promptfoo). **Phase-2 build is explicitly blocked until these close** (CONTEXT.md ⛔ Execution gate, STATE.md).

**Missing dependencies with fallback:**
- SPIKE-RAG → Pinecone Serverless (adapter seam exists, `src/rag/pinecone.ts`).
- SPIKE-DEPLOY → non-streaming fallback or Vercel front-end.

**Dependency note:** Where SPIKE-RAG could fail, Phase-2 retrieval-dependent work (Coach grounding, comprehension grading, correction loop) would shift to the Pinecone adapter — same `rag/` interface, so plans should reference `retrieve()`/`embedText()` (the interface), not Firestore-specific calls, to stay fallback-safe.

## Validation Architecture

> nyquist_validation treated as enabled (no `.planning/config.json` override read disabling it). Test infra (vitest/playwright/promptfoo/@firebase/rules-unit-testing) is installed and exercised in P1 (153+ passing). Each P2 requirement maps to a test type so a VALIDATION.md can be derived.

### Test Framework
| Property | Value |
|----------|-------|
| Unit framework | `vitest ^4.1.7` |
| Rules framework | `@firebase/rules-unit-testing ^5.0.1` (emulator) |
| E2E framework | `@playwright/test ^1.60` |
| Eval framework | `promptfoo ^0.121.13` (Opus judge, rubric in `src/eval/judge.ts`) |
| Quick run command | `npx vitest run <path>` (e.g. `npx vitest run src/coach/journey`) |
| Rules run command | `npm run test:rules` (`vitest run src/firebase/__tests__/rules`) |
| Full suite command | `npm test` (`vitest run`) + `npm run eval` (promptfoo) + Playwright |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-02/03 | Coach/admin sign-in + role redirect | E2E (Playwright) + unit | `npx playwright test e2e/auth-roles.spec.ts` | ❌ Wave 0 |
| AUTH-06 | Coach reads ONLY downline; admin all; cross-coach denied | Rules unit | `npm run test:rules` (extend `rules.test.ts`) | ⚠️ extend existing |
| CHAT-02 | Message persists across refresh (user+assistant) | E2E + unit (`appendMessage`/`loadRecent`) | `npx vitest run src/memory` + Playwright persist slice | ⚠️ extend |
| CHAT-05 | Disclosure shown before first interaction | E2E (Playwright) | `npx playwright test e2e/disclosure.spec.ts` | ❌ Wave 0 |
| CHAT-06 | Handoff bundles context → escalation row | Integration (`emitHandoffSignal`) + E2E | `npx vitest run src/escalation` | ⚠️ extend |
| CHAT-07 | History list + search returns own threads | Unit + E2E | `npx vitest run src/memory` + Playwright | ❌ Wave 0 |
| CHAT-08 | Auto-detect + manual override picks reply lang | Unit (`detectLang` + override) | `npx vitest run src/i18n` | ⚠️ extend |
| COACH-02 | Grounded answer cites real chunk IDs; refuses generic | Eval (Promptfoo grounding/scope rubric) | `npm run eval` | ⚠️ extend gold set |
| COACH-03 | Journey advances checkpoint correctly | Unit (`src/coach/journey/transition`) | `npx vitest run src/coach/journey` | ❌ Wave 0 |
| COACH-04 | Stall (2d) writes in-app nudge into coach thread | Unit (job body, injectable clock) | `npx vitest run src/jobs` | ⚠️ extend `jobs.test.ts` |
| COACH-05 | 48h no-response → escalation row | Unit (escalate job, dedup) | `npx vitest run src/jobs src/escalation` | ⚠️ extend |
| COACH-06 | KB-miss → handoff (no hallucination) | Unit (`coach.test.ts`) + eval | `npx vitest run src/agents/coach` | ✅ exists, extend |
| COACH-07/08 | Walkthrough/playbook grounded in KB doc | Eval (Promptfoo) | `npm run eval` | ❌ Wave 0 gold set |
| COACH-09 | Comprehension gate passes/fails paraphrase | Unit (`comprehension.ts`) | `npx vitest run src/coach/journey` | ❌ Wave 0 |
| CDASH-01/02 | Downline list + stall inbox scoped correctly | Integration (downline query) + Rules | `npx vitest run src/dashboard` + `npm run test:rules` | ❌ Wave 0 |
| CDASH-03 | Knowledge-gap feed aggregates per coach | Integration (signal store) | `npx vitest run src/dashboard` | ❌ Wave 0 |
| CDASH-04 | Correction → new KB version → re-ingest; old not retrievable | Integration (`updateDoc` + retrieval filter) | `npx vitest run src/kb src/rag` | ⚠️ extend (Pitfall 3) |
| CDASH-05/07 | Funnel/ramp metrics compute from journey data | Unit (metric derivation) | `npx vitest run src/dashboard` | ❌ Wave 0 |
| CDASH-06 | Escalation gated to working hours | Unit (working-hours gate, injectable clock) | `npx vitest run src/jobs` | ❌ Wave 0 |
| ADMIN-01/03 | KB create/edit/version/publish/delete (admin-only) | Integration (`crud`) + Rules + E2E | `npx vitest run src/kb` + `npm run test:rules` | ✅ `kb.test.ts` exists, extend |
| QUAL-06 | Regression suite catches grounding/tone/hallucination/lang | Eval (Promptfoo, expanded gold set + rubrics) | `npm run eval` | ⚠️ extend `src/eval/judge.ts` rubric coverage |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed-module-path>` (< 30s).
- **Per wave merge:** `npm test` + `npm run test:rules` (full unit + rules) green.
- **Phase gate:** Full unit + rules + Playwright smoke + `npm run eval` (trilingual gold sets, >85% judge-human agreement) green before `/gsd-verify-work`; plus the **signed week-4 go/no-go memo** committed before Phase 3.

### Wave 0 Gaps
- [ ] `src/coach/journey/transition.test.ts` — covers COACH-03 (state transitions)
- [ ] `src/coach/journey/comprehension.test.ts` — covers COACH-09 (paraphrase grading)
- [ ] `src/dashboard/*.test.ts` — covers CDASH-01/02/03/05/07 (downline queries + metrics)
- [ ] `src/jobs/jobs.test.ts` — extend for escalate (COACH-05) + working-hours gate (CDASH-06) + nudge body (COACH-04)
- [ ] `src/firebase/__tests__/rules.test.ts` — extend for AUTH-06 downline reads (any new senior-coach rule) + knowledge-gap collection
- [ ] `src/rag/rag.test.ts` + `src/kb/kb.test.ts` — extend for published/superseded filter (Pitfall 3 / CDASH-04)
- [ ] `e2e/auth-roles.spec.ts`, `e2e/disclosure.spec.ts`, `e2e/coach-dashboard.spec.ts`, `e2e/kb-edit-retrieval.spec.ts` — Playwright flows (TSD §12: admin KB edit → Coach retrieval; handoff bundle)
- [ ] `evals/` — expand trilingual gold set (training Q&A, journey prompts, playbooks) + tone-drift/hallucination/lang rubric coverage (QUAL-06)
- [ ] Promptfoo `eval-nightly` wiring into `runDueJobs` (currently a stub)

## Security Domain

> `security_enforcement` treated as enabled. Phase 2 expands the role surface (coach + admin sign-in) and downline-scoped reads — the highest-risk area is authorization (AUTH-06).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Firebase Auth + custom claims (`role`,`tenantId`); `requireUser` fails closed; session cookie (httpOnly) via `/api/auth/session`. |
| V3 Session Management | yes | LOCAL persistence (AUTH-05, P1) + httpOnly `__session` cookie; verified server-side. |
| V4 Access Control | yes (PRIMARY) | Deny-by-default `firestore.rules` + custom claims double-gate (D-11); downline scoping (`seniorCoachId`/`uplineCoachId`); admin-gate on both page + Server Action; rules-unit-tested in CI. |
| V5 Input Validation | yes | Zod (`CoachOutputSchema`, tool `inputSchema`, action inputs); validate journey/correction inputs. |
| V6 Cryptography | partial | sha256 idempotency keys + audit hashes (PDPA — hashes only, never raw PII). Don't hand-roll crypto. |
| V7 Error Handling/Logging | yes | Append-only `auditLogs` via `after()`; **never log tokens/PII/claims** (CLAUDE.md); coach drilldown reads must be audit-logged (TSD §5.1). |
| V8 Data Protection (PDPA) | yes | Pseudonymize at the Claude boundary + `pdpa_redacted` gate; contextBundle/knowledge-gap stores keep references/hashes only; consentFlag; in-region Firestore. |

### Known Threat Patterns for {Next.js 16 + Firebase + multi-role dashboard}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Coach reads another coach's downline (horizontal privilege) | Elevation/Info-disclosure | `seniorCoachId == request.auth.uid` in rules AND server query filter; rules-unit-test the cross-coach-denied case. |
| Client claim spoofing (role in body) | Spoofing | Read role/tenant ONLY from `verifyIdToken` (already enforced in `requireUser`); never from body. |
| Cross-tenant read | Info-disclosure | `sameTenant()` on every rule; `tenantId` stamped by converters. |
| Blanket allow-if-signed-in | Elevation | Deny-by-default; explicit rule per collection (existing posture — preserve). |
| KB-miss / knowledge-gap signal leaking client PII | Info-disclosure | Store hashes/pseudonyms/references only (T-01-36); apply redaction gate to any stored query summary. |
| Coach correction injecting unvetted content into KB | Tampering | Attribute correction to coach uid; admin oversight via versioning (`supersedesId`); re-ingest goes through the same chunker (no privileged path). |
| Audit-log tampering | Tampering | `auditLogs` create-only / immutable (rules: `create/update/delete: if false`); Admin-SDK write only. |
| Coach drilldown over-read of agent conversations | Info-disclosure | Prefer server-side downline-filtered reads + audit row; keep client rules owner-only (Pitfall 5). |

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/agents/coach/{prompt,tools,index,schema}.ts` — Coach agent, grounding contract, KB-miss handoff.
- `src/router/{heuristic,index,classifier}.ts` — heuristic→Coach; dormant classifier (Phase 3).
- `src/memory/{agentProfile,conversation,leadContext}.ts` — journey fields, subcollection writer, slot writer.
- `src/escalation/{detect,handoff,index}.ts` — `findStalled`, `emitHandoffSignal` (dedup-guarded).
- `src/jobs/{runDueJobs,heartbeat}.ts` + `app/_actions/jobs.ts` — lazy-cron registry + stubs + trigger.
- `src/rag/{search,citations,embed}.ts` — Gemini embed @1024-d, `findNearest` (lang-only filter), citations.
- `src/kb/{crud,ingest/pipeline}.ts` — versioned CRUD, chunked idempotent ingest, no orphan cleanup.
- `src/firebase/{collections,auth}.ts` + `firestore.rules` + `firestore.indexes.json` — typed refs, roles, deny-by-default rules, indexes.
- `app/api/chat/route.ts`, `app/[lang]/chat/{page,chat-shell,chat-input}.tsx`, `app/[lang]/(admin)/kb/{page,actions}.tsx`, `app/[lang]/(auth)/sign-in/sign-in-form.tsx` — surfaces to grow.
- `src/eval/judge.ts` — 4-domain Opus rubric (grounded/scoped/language/voice).
- `.planning/TSD.md` (§3–§9, §11, §12), `.planning/PROJECT.md` (Key Decisions), `.planning/ROADMAP.md` (Phase 2), `.planning/REQUIREMENTS.md` (traceability), `.planning/STATE.md`, `.planning/phases/01-foundations/SPIKES.md`, `.planning/phases/02-coach-admin/02-CONTEXT.md`.
- `.planning/research/{FEATURES,PITFALLS}.md` — Coach table-stakes + multi-surface pitfalls.
- `package.json` — verified installed versions.

### Secondary (MEDIUM confidence — verified against current docs)
- ai-sdk.dev — AI SDK v5 `experimental_output` / `experimental_partialOutputStream`; structured-output-with-tools is OpenAI-only. [WebSearch verified]
- npmjs.com/package/recharts (3.8.1) + github.com/recharts/recharts#4558 — React 19 compatibility, `'use client'`, `react-is` override. [WebSearch verified]

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Working-hours window (A1), comprehension-grading method (A2), knowledge-gap PII classification (A3), checkpoint taxonomy (A5) — require Derek/planning confirmation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read from package.json + source; no new deps.
- Architecture / seams: HIGH — every seam read directly in P1 source.
- Pitfalls: HIGH for the four code-verified gaps (persistence, stale-chunk retrieval, knowledge-gap source, transcript rule); MEDIUM for product-level D-09.
- Journey/dashboard specifics: MEDIUM — patterns clear, exact taxonomy/IA is Claude's discretion + needs D2 content.
- External-doc facts (AI SDK structured streaming, recharts/React 19): MEDIUM — verified via current web docs.

**Research date:** 2026-06-02
**Valid until:** ~2026-07-02 for external library facts (fast-moving AI SDK); source-seam findings valid until the code changes.
