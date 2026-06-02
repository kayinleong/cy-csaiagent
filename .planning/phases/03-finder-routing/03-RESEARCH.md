# Phase 3: Finder + Intent-Routing Activation - Research

**Researched:** 2026-06-02
**Domain:** Property-matching agent (LLM criteria-parsing + hybrid vector/structured ranking) + live multi-pillar intent routing on the existing Firebase/Next.js 16 spine
**Confidence:** HIGH (stack + seams verified against installed code & SDKs; LOW only on the D2 inventory source format G4, flagged for Derek)

## Summary

Phase 3 is **a "grow the seams" phase, not a new-architecture phase.** Every load-bearing piece already exists in thin form: the router has a dormant `classifyIntent` seam (`src/router/classifier.ts`) and a manual-override chip in `route()`; the chat spine (`app/api/chat/route.ts`) already has a `pillar === 'coach' ? … : …` dispatch stub and resolves `modelFor('router')`/`modelFor('finder')` from Remote Config (both keys + fallbacks already coded in `src/llm/provider.ts`); the `projects`/`collateral`/`leadContext.finderSlot` schema + typed refs + Firestore rules + a `projects (status, embedding 1024-d flat)` vector index are all already in place; the RAG `findNearest` adapter + Gemini 1024-d `embedText` already work and demonstrate the active-only/published pattern (`status:'published'` pre-filter). The Coach agent (`src/agents/coach/*`) is the exact template Finder mirrors: scoped prompt + read-only AI-SDK `tool()` set + Zod output schema + a grounding-miss → refusal signal.

The genuinely-open work is: (1) **flip the classifier live** — heuristic-first, `generateObject` LLM fallback on ambiguity, record `routeDecision` on the message, keep the override chip authoritative; (2) **build `src/agents/finder/*`** with a `searchProjects` tool that does a **deterministic Firestore query (`status:'active'` ALWAYS) blended with `findNearest` over project embeddings**, plus an LLM criteria-parser (`generateObject`), an eligibility/affordability/segmentation gate that **refuses rather than forces a bad match**, and a grounded "why this match" rationale citing real project fields; (3) **wire `finderSlot`** for per-lead re-rank without re-typing; (4) a **structured filtered-query path** ("which projects completed VP this year") that is inventory-grounded, not vector-only; (5) **inventory ingestion** — a CSV/JSON import adapter (format flagged for Derek, G4) + per-project embedding (reuse the existing chunked-poll job pattern, or a simpler single-doc embed) + collateral as a Storage path/URL on the `collateral` collection; and (6) **ADMIN-04 CRUD** growing the existing admin app (mirror `app/[lang]/(admin)/kb/*`).

**Primary recommendation:** Mirror the Coach agent and KB-admin patterns 1:1; make `searchProjects` a **two-stage tool — deterministic filter FIRST (active-only + hard eligibility), vector re-rank SECOND** — so availability/eligibility can never be overridden by semantic similarity. Treat the active-only enforcement and router mis-route as the two highest-trust-risk surfaces and back both with Promptfoo evals + recorded `routeDecision`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (classifier activation):** Activate the dormant `src/router/classifier.ts` — **heuristic-first → LLM-classifier fallback → manual-override chip** (override wins). Classifier model resolves from **Remote Config** (TSD names `claude-haiku-4-5` for `model.router.default`; never hard-coded).
- **D-02 (observability):** Record the routing decision on the message (`routeDecision`) for observability + eval; a mis-route is correctable via the override chip and feeds eval.
- **D-03 (matching engine):** **Hybrid match** — an LLM parses pasted free-text criteria into a structured query; ranking combines Firestore `findNearest` over **project embeddings (Gemini 1024-d)** + structured filters. **`searchProjects` ALWAYS enforces `status:'active'`** (grounding mandate; no sold-out/hidden recommendations).
- **D-04 (rationale):** Each match carries a **"why this match" rationale grounded in real project fields** (priceBand, tenure, vpStatus, bumiQuota, foreignEligible) + the matched criteria — cites project IDs, never invents.
- **D-05 (eligibility gate):** **Eligibility + segmentation gate the results** — investment-vs-own-stay (D-09) + financing/affordability (D-10) + bumiputera/foreign eligibility filter matches; a sub-threshold/ineligible lead gets a **clear refusal-with-explanation** (`no_match`/`ineligible` signal), never a bad match (SC3).
- **D-06 (per-lead context):** **`leadContext/{leadId}` finderSlot** stores parsed criteria + projects already discussed + a rolling summary. Mid-conversation, the Finder **re-ranks from updated leadContext without re-typing** (SC2/FIND-08); returning-client new-launch surfacing reuses stored criteria (FIND-06).
- **D-07 (filtered queries):** Finder supports **structured/filtered queries** (e.g., "completed VP this year") over `projects` (status, vpStatus, completion date, priceBand) — inventory-grounded, NOT vector-only.
- **D-08 (ingestion):** **Admin-managed `projects` collection** (ADMIN-04 CRUD: add/edit/hide + attach collateral), seeded via a **structured import adapter** (CSV/JSON). The exact D2 source FORMAT (TSD §14 G4) is **flagged for Derek** — build the schema + a pluggable import path; default to a CSV importer.
- **D-09 (collateral):** **`collateral` collection** links each asset (poster/video/fact-sheet) to a `projectId` via a Firebase **Storage path or external URL** (NOT the Drive API — no-GCP constraint). Matches attach the relevant collateral.
- **D-10 (admin surface):** **Grow the Phase-2 admin app** with a project-inventory manager (list + add/edit/hide + collateral attach), reusing the admin route group + role gate + the versioning/publish patterns.

### Claude's Discretion
- Exact criteria-parsing schema + ranking weights (vector vs structured blend) — researcher/planner propose.
- Classifier confidence threshold + heuristic-vs-LLM cutover — tune in planning; default to heuristic for clear keywords, classifier otherwise.
- Project-embedding text composition (which fields feed the 1024-d vector) — planner decides; keep 1024-d standard.

### Deferred Ideas (OUT OF SCOPE)
- Reply Assistant pillar + WhatsApp paste-and-draft — Phase 4.
- Public recommender / auto-assignment — v2 (PUB-01/02).
- Voice-fingerprint consumption — Phase 4.
- Drive-API live sync of collateral — excluded by the no-GCP constraint; collateral is referenced, not API-synced.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIND-01 | Paste lead criteria → ranked matches w/ collateral attached | Finder agent + `searchProjects` tool (Pattern 2) + `fetchCollateral` tool (Pattern 6); match cards mirror `message-list.tsx` Card+Badge |
| FIND-02 | Project inventory ingested from D2 sources | CSV/JSON import adapter (Pattern 8); `projects` schema already in `collections.ts` (matches TSD §4) — G4 format flagged for Derek |
| FIND-03 | Matching engine — criteria parse + ranked recommendations | LLM criteria-parser via `generateObject` (Pattern 3) → two-stage rank (deterministic filter + `findNearest`) (Pattern 4) |
| FIND-04 | Each project linked to its collateral | `collateral` collection (already typed) keyed by `projectId`; Storage path/URL, not Drive (D-09) |
| FIND-05 | Per-lead context memory | `leadContext.finderSlot` via existing `writeLeadSlot('finderSlot', …)` (Pattern 5); finderSlot already in schema |
| FIND-06 | Returning-client new-launch surfacing without re-typing | Read stored `finderSlot.criteria`; re-run `searchProjects` filtered to recently-added active projects (Pattern 5) |
| FIND-07 | Filtered inventory queries ("completed VP this year") | `queryInventory` deterministic tool over `projects` (status/vpStatus/completion) — structured, not vector (Pattern 7) |
| FIND-08 | Mid-conversation re-rank on preference shift | Criteria-parser detects delta → merge into `finderSlot.criteria` → re-run `searchProjects` (Pattern 5) |
| FIND-09 | Investment vs own-stay segmentation in matches | Segmentation field in parsed criteria → profile-conditional ranking weights + prompt branch (Pattern 4; PITFALLS 24) |
| FIND-10 | Financing/affordability factored | Affordability gate (income/financing → price ceiling) before ranking; refusal if sub-threshold (Pattern 4; PITFALLS 36) |
| FIND-11 | Intent router activated — Coach + Finder coexist | Activate `classifyIntent` (Pattern 1); wire into `route()` + chat-route dispatch branch |
| FIND-12 | Finder pilot expands to 15–20 agents | Operational/rollout; no new code surface — covered by rate-limit budgets + eval gate already present |
| ADMIN-04 | Project inventory mgmt — add/edit/hide + attach collateral | Mirror `app/[lang]/(admin)/kb/*` (RSC shell + client form + Server Actions); admin-gated `projects`/`collateral` CRUD (Pattern 8) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Intent classification (heuristic + LLM) | API/Backend (`src/router`) | — | Pure core logic + a server-side model call; classifier reuses `modelFor('router')`. Browser only sends the override chip value. |
| Criteria parsing (free text → struct) | API/Backend (`src/agents/finder`) | — | LLM call via `generateObject`; runs inside the Finder agent, server-side, after the PDPA gate. |
| Project ranking (filter + vector) | API/Backend (`src/agents/finder` tool) + Database (`findNearest`) | — | Deterministic Firestore query + `findNearest` KNN; Firestore is both inventory store and vector index (TSD §1). |
| Eligibility/affordability/availability gate | API/Backend (Finder tool, deterministic) | — | MUST be deterministic Firestore filters — never delegated to the model or to vector similarity (PITFALLS 1, 23, 36). |
| Per-lead context (finderSlot) | API/Backend (`src/memory`) + Database (`leadContext`) | — | Slot-scoped Admin-SDK write; rules enforce owner-only at DB layer. |
| Inventory CRUD + collateral attach | Frontend Server (RSC + Server Actions, admin group) + Database | Storage (collateral files) | Mirrors KB admin: RSC shell gates admin role, Server Actions mutate via core `src/inventory` (new). |
| Project embedding | API/Backend (`src/rag.embedText` + a job) | Database | Reuse `embedText` 1024-d; (re)embed on inventory create/edit. |
| Match cards + collateral display | Browser/Client (chat surface) | Frontend Server (RSC page) | Render-only; mirror `message-list.tsx` Card+Badge pattern. |

## Standard Stack

> **No new dependencies are needed for Phase 3.** Everything below is already installed and used by P1/P2. This table documents *which* installed tool owns each new capability.

### Core
| Library | Version (verified) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| `ai` (Vercel AI SDK v5) | 5.0.193 `[VERIFIED: node require]` | `streamText` (Finder streaming), `generateObject` (criteria parse + classifier), `tool` (searchProjects/queryInventory/fetchCollateral), `stepCountIs` (multi-step tool loop) | Already the project's AI surface; `generateObject`/`stepCountIs` confirmed exported |
| `@ai-sdk/anthropic` | 2.0.80 `[VERIFIED]` | Claude models behind `modelFor()` — `router` (haiku) + `finder` (sonnet) | Already wired; both pillar keys already in `provider.ts` |
| `@ai-sdk/google` | 2.0.74 `[VERIFIED]` | Gemini `gemini-embedding-001` 1024-d via `embedText` for project vectors | Same embedder as KB; keeps 1024-d standard across collections (TSD §2.3) |
| `zod` | 4.4.3 `[VERIFIED]` | Tool `inputSchema` + Finder output schema + criteria-parse `schema` for `generateObject` | Already the validation lib (TSD §2.4) |
| `firebase-admin` | 13.10.0 `[VERIFIED]` | `findNearest` over `projects.embedding`, deterministic `projects`/`collateral` queries, slot writes | `findNearest` + `FieldValue.vector` already proven in `src/rag/search.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next-intl` | ^4 (installed) | Trilingual UI copy for inventory admin + match-card labels + refusal strings | All new UI strings (C7 multilingual) |
| shadcn `components/ui/*` | vendored | Match cards (Card/Badge), inventory table/form, pillar chip | Already vendored — do NOT re-add shadcn |
| `gpt-tokenizer` | ^2 (installed) | (Optional) token sizing if a project embedding text is large | Only if composing long embedding text |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `findNearest` over `projects` | Vector-only retrieval (no structured filter) | REJECTED — vector-only cannot enforce `status:'active'` / eligibility; this is exactly PITFALLS 1 & 23. Structured filter MUST gate. |
| `generateObject` classifier | Heuristic-only routing | Heuristic alone can't disambiguate Coach↔Finder reliably; classifier is the D-01 decision. Heuristic still runs first for clear cases. |
| Reuse `kbIngestionJobs` chunked-poll for project embeds | Single-doc inline embed on create/edit | One project = one short text = one embed call; chunked-poll is overkill. Use single-doc embed inside the Server Action / a small batch script. Chunked-poll only if bulk-importing hundreds at once. |
| CSV importer | Live Drive sync | Drive API is FORBIDDEN (C2). Import adapter ingests an uploaded CSV/JSON file (G4 format TBD). |

**Installation:** None — all dependencies already in `package.json`.

**Version verification:** `node -e "require('ai/package.json').version"` → all five core libs confirmed at the versions above on 2026-06-02.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
  agent pastes criteria   │  app/api/chat/route.ts  (Node SSE spine)     │
  ──────────────────────► │  GATE 1 auth → GATE 2 ratelimit →            │
   {messages, cid,        │  GATE 3 pseudonymize+assertRedacted (PII!) → │
    override?, leadId?}   │  GATE 4 ROUTE ──────────────┐                │
                          └─────────────────────────────┼────────────────┘
                                                         ▼
                        ┌──────────────── src/router (ACTIVATED) ───────────────┐
                        │ override chip set?  ──yes──► use it (reason:override)  │
                        │ else heuristic(messages) clear?  ──yes──► pillar       │
                        │ else classifyIntent(messages) via modelFor('router')   │
                        │   generateObject → {pillar,confidence,reason}          │
                        │   confidence < τ ──► default 'coach' (safe) + flag     │
                        └───────────────┬───────────────────────┬───────────────┘
                            pillar=coach │                       │ pillar=finder
                                         ▼                       ▼
                              (existing Coach path)   ┌──────── src/agents/finder ────────┐
                                                      │ streamText(model=modelFor finder, │
                                                      │   tools, stepCountIs(N))          │
                                                      │  1. parseCriteria (generateObject)│◄─ merge with
                                                      │     ↕ leadContext.finderSlot ─────┼─  stored criteria
                                                      │  2. tool searchProjects(criteria) │   (re-rank, FIND-08)
                                                      │     ├─ STAGE A deterministic:     │
                                                      │     │  projects.where(status      │──► Firestore
                                                      │     │   =='active').where(bumi/   │    projects
                                                      │     │   foreign/priceBand…)        │    (index:
                                                      │     ├─ STAGE B findNearest(        │    status+
                                                      │     │   embedding, DOT_PRODUCT)    │    embedding)
                                                      │     └─ 0 eligible ► {no_match}     │
                                                      │  3. tool fetchCollateral(pid)─────┼──► collateral
                                                      │  4. tool queryInventory(filters)  │    + Storage URL
                                                      │     (FIND-07 structured, no vector)│
                                                      └──────────────┬────────────────────┘
                                                                     ▼
   ranked match cards + "why this match" + collateral  ◄── SSE tokens (toUIMessageStreamResponse)
   OR grounded refusal (ineligible / no_match)              onFinish: appendMessage(routeDecision=
                                                              'finder'|reason), writeLeadSlot('finderSlot'),
                                                              ratelimit.decrement, after(audit.log)
```

### Recommended Project Structure
```
src/
├── router/
│   ├── classifier.ts        # ACTIVATE: real generateObject call (remove NotActivatedError)
│   ├── heuristic.ts         # ADD: content heuristic for clear keywords; import classifier as fallback
│   └── index.ts             # route() becomes async OR add routeAsync(); keep override-wins
├── agents/finder/           # NEW — mirror src/agents/coach/* 1:1
│   ├── index.ts             # finderAgent: buildSystemPrompt + makeTools + run (refusal gate)
│   ├── prompt.ts            # scoped prompt: active-only, segmentation branch, anti-tell, refusal rules
│   ├── tools.ts             # searchProjects, queryInventory, fetchCollateral (READ-ONLY)
│   ├── schema.ts            # Zod: criteria-parse schema + FinderOutput (matches[], rationale, refusal)
│   └── finder.test.ts
├── inventory/               # NEW — core inventory logic (admin CRUD + import + embed text)
│   ├── crud.ts              # createProject/updateProject/hideProject/attachCollateral (assertAdmin)
│   ├── import.ts            # CSV/JSON → ProjectDoc[] adapter (pluggable; G4-format-TBD)
│   ├── embedText.ts         # composeProjectEmbeddingText(project) → embedText(...,'document')
│   └── search.ts            # searchProjects two-stage (filter + findNearest); queryInventory
├── memory/leadContext.ts    # REUSE writeLeadSlot; add a finderSlot typed shape
app/
├── api/chat/route.ts        # EDIT: real finder branch (system/tools/model), route() async, finderSlot write
└── [lang]/(admin)/inventory/ # NEW — mirror (admin)/kb/*: page.tsx + actions.ts + forms + list
```

### Pattern 1: Activate the intent classifier (heuristic → LLM → override)
**What:** Flip `classifyIntent` from `NotActivatedError` stub to a real `generateObject` call; wire it into `route()` behind the heuristic.
**When to use:** Every chat turn once a second pillar is live (FIND-11).
**Key design decisions:**
- **Override wins, always** — `route()` already returns `{pillar: override, reason:'manual-override'}` first. Keep that.
- **Heuristic-first** — add cheap keyword/content matching in `heuristic.ts` (e.g., "paste"/"lead"/"budget"/"RM"/"project"/"bedroom" → finder; training/onboarding/checkpoint verbs → coach). Only call the LLM on ambiguity. Saves cost + latency on the clear majority.
- **Classifier returns `{pillar, confidence, reason}`** (the stub's existing return shape — keep it).
- **Confidence threshold τ (discretion):** below τ → **default to `coach`** (the safe, established pillar) and set a `low_confidence` flag in `reason` so eval can see it. Mis-routing into Finder is higher-trust-risk than staying on Coach.
- **`route()` becomes async** (the classifier is `async`). The chat route already `await`s gates; add `routeDecision = await routeAsync(...)`. Update the `heuristic.test.ts` call sites.
- **Model:** `modelFor('router')` (already returns haiku fallback; key `model.router.default`). NEVER hard-code.

```typescript
// Source: mirrors src/agents/coach criteria + ai@5 generateObject (VERIFIED exported)
// src/router/classifier.ts (activated)
import { generateObject } from 'ai'
import { z } from 'zod'
import { modelFor } from '@/src/llm/provider'

const RouteSchema = z.object({
  pillar: z.enum(['coach', 'finder']),       // 'reply' added in Phase 4
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

export async function classifyIntent(messages: { role: string; content: string }[]) {
  const model = await modelFor('router')      // Remote Config, never hard-coded
  const { object } = await generateObject({
    model,
    schema: RouteSchema,
    system: ROUTER_SYSTEM_PROMPT,             // "coach=onboarding/training; finder=lead criteria/property match"
    prompt: compactSummary(messages),         // last N turns, already PDPA-redacted upstream
  })
  return object
}
```

### Pattern 2: Finder agent mirrors the Coach agent
**What:** `src/agents/finder/{index,prompt,tools,schema}.ts` with the same shape as `coach/*`: `buildSystemPrompt()`, `makeTools(userLang, agentUid, leadId)`, `outputSchema`, `run()`.
**When to use:** When `route()` returns `finder` (chat-route dispatch branch).
**Mirror points (from `coach/index.ts`):** read-only tools; grounding-miss → a structured refusal signal (Coach uses `handoff:{reason:'kb_miss'}`; Finder uses `{reason:'no_match'|'ineligible'}`); model via `modelFor`; output validated by Zod; tools authenticate **as the user** (read `projects` under the agent's token-derived scope — `projects` rules allow any signed-in tenant user to read).
**Anti-pattern carried from Coach:** tools never write Firestore. The `finderSlot` write happens in the route's `onFinish` (like Coach's `appendMessage`), not inside a tool.

### Pattern 3: LLM criteria parser (free text → structured query)
**What:** `generateObject` with a Zod `CriteriaSchema` turns pasted free text ("young couple, ~RM600k, KL, want something near LRT, first home, household income 8k") into a typed query.
**When to use:** First step of a Finder turn, before `searchProjects`.
**Schema (proposed — discretion):**
```typescript
const CriteriaSchema = z.object({
  segment: z.enum(['investment', 'own_stay', 'unknown']),   // FIND-09 — drives ranking branch
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  monthlyIncome: z.number().nullable(),                     // FIND-10 affordability
  financingNote: z.string().nullable(),
  nationality: z.enum(['malaysian', 'foreign', 'unknown']), // eligibility
  bumiputera: z.boolean().nullable(),                       // bumiQuota eligibility
  locationPref: z.string().nullable(),
  tenurePref: z.string().nullable(),
  bedrooms: z.number().nullable(),
  freeText: z.string(),                                     // raw → feeds the vector query
})
```
**Critical:** the parser MUST emit `unknown` for missing fields (do NOT let it invent a nationality/income — PITFALLS 23/36 are about acting on missing data). Missing eligibility-critical fields → the agent should *ask*, not guess.

### Pattern 4: Two-stage `searchProjects` — deterministic filter FIRST, vector SECOND
**What:** The single most important pattern in this phase. Availability + eligibility + affordability are **deterministic Firestore filters**; vector similarity only *re-ranks within the eligible set*.
**When to use:** Every match request and every re-rank.
**Why this ordering:** If vector search runs first, a semantically-perfect sold-out / bumi-reserved / unaffordable project can rank #1 — exactly PITFALLS 1, 23, 36. Filtering first makes those records *unreachable*.

```typescript
// Source: composes existing src/rag/search.ts findNearest pattern + new structured filter
// src/inventory/search.ts
export async function searchProjects(criteria: ParsedCriteria, userLang: Lang) {
  // STAGE A — deterministic eligibility/availability gate (NEVER skipped)
  let q = projectsRef().where('status', '==', 'active')          // D-03 ALWAYS active-only
  if (criteria.priceMax) q = q.where('priceBand', '<=', criteria.priceMax) // see index note
  if (criteria.nationality === 'foreign') q = q.where('foreignEligible', '==', true)
  if (criteria.bumiputera === false)      q = q.where('bumiQuota', '==', false) // not bumi-reserved
  const eligible = await q.get()
  if (eligible.empty) return { found: false, reason: 'no_match' as const }

  // Affordability gate (FIND-10): if monthlyIncome implies a ceiling below all eligible → ineligible
  const ceiling = affordabilityCeiling(criteria.monthlyIncome) // e.g. ~ income * 12 * DSR multiple
  const affordable = filterByCeiling(eligible.docs, ceiling)
  if (affordable.length === 0) return { found: false, reason: 'ineligible' as const, why: 'financing' }

  // STAGE B — vector re-rank WITHIN the eligible+affordable set
  const qv = await embedText(criteria.freeText, { inputType: 'query' })
  // Option 1 (preferred, ≤ a few hundred projects): score in-memory dot-product over `affordable`
  // Option 2 (large inventory): projects.where(status=='active').findNearest(embedding, DOT_PRODUCT)
  //   then INTERSECT with `affordable` ids — findNearest pre-filter only supports equality, so
  //   range filters (priceMax) must be applied in-memory or via the eligible-set intersection.
  const ranked = rankByVector(affordable, qv)
  return { found: true, matches: applySegmentWeights(ranked, criteria.segment) } // FIND-09 branch
}
```
**Index note (HIGH importance):** Firestore `findNearest` pre-filters support **equality only**, not range (`<=`). The existing `projects (status ASC, embedding 1024-d flat)` index supports `where('status','==','active').findNearest(...)`. **Range filters (`priceBand <=`) cannot be combined with `findNearest`** — apply them via the Stage-A `get()` set + in-memory intersection, OR store `priceBand` as discrete equality-filterable bands. The planner must decide; this is a real Firestore constraint, not a preference. `[CITED: firebase.google.com/docs/firestore/vector-search — pre-filters use equality]`
**Segmentation (FIND-09):** for `investment`, weight completion/VP status + yield signals; for `own_stay`, weight lifestyle/location fit (PITFALLS 24 — parallel investor/own-stay queries must produce different top-3).

### Pattern 5: `finderSlot` per-lead memory + re-rank without re-typing
**What:** Reuse `writeLeadSlot(leadId, 'finderSlot', value, summary)` (already built; finderSlot already in schema). Store `{criteria, discussedProjectIds[], lastRankedAt}`.
**When to use:** Every Finder turn with a `leadId`; on re-rank and returning-client recall.
**Re-rank flow (FIND-08):** parse the new message as a *criteria delta* → merge into stored `finderSlot.criteria` → re-run `searchProjects`. The agent never re-asks for prior criteria.
**Returning-client (FIND-06):** read stored criteria + `discussedProjectIds`, run `searchProjects` filtered to projects added/activated after `lastRankedAt`, surface only the *new* eligible launches.
**Write location:** in the chat route `onFinish` (mirrors Coach `appendMessage`), NOT inside a tool (read-only tools rule).

### Pattern 6: Collateral as Storage path / URL (NOT Drive API)
**What:** `fetchCollateral(projectId)` reads the `collateral` collection (already typed: `{projectId, type, storagePath, lang}`) and returns refs; the UI renders a download/preview link from the Storage path or external URL.
**Hard constraint (C2/D-09):** never call the Google Drive API. `storagePath` is either a Firebase Storage object path (signed URL generated server-side) or a plain external share URL string. Match cards attach the project's collateral by `projectId`.

### Pattern 7: `queryInventory` — structured filtered queries (FIND-07)
**What:** A separate deterministic tool for "which projects completed VP this year" / "show active leasehold under RM500k". Pure Firestore query over `projects` — **no vector search**.
**When to use:** When the agent's intent is an *inventory question*, not a *lead match*. The criteria parser or a tool-selection step routes here.
**Note:** requires `vpStatus` + a completion/VP date. Current `ProjectDoc.vpStatus` is a **boolean** — "completed VP **this year**" needs a date. The planner must add a `vpDate` (or `completionDate`) field to `ProjectDoc` + an index, or scope FIND-07 to boolean `vpStatus` only and flag the date-grain question for Derek. (See Open Questions.)

### Pattern 8: Inventory + collateral admin mirrors KB admin
**What:** `app/[lang]/(admin)/inventory/{page.tsx, actions.ts, *-form.tsx, *-list.tsx}` mirrors `(admin)/kb/*` exactly: RSC shell gates `role==='admin'` via `__session` cookie + `requireUser`, lists projects, renders a client form; mutations go through Server Actions (`'use server'`) that re-check admin via `getSessionUser()` then call `src/inventory/crud.ts`.
**CRUD ops (ADMIN-04):** `createProject` (embed on create), `updateProject` (re-embed if embedding-relevant fields changed), `hideProject` (set `status:'hidden'` — soft-hide, mirrors `unpublishDoc`), `attachCollateral` (write `collateral` doc with Storage path/URL).
**Import (D-08):** `importProjects(csvOrJson)` Server Action → `src/inventory/import.ts` parses → validates against `ProjectDoc` → bulk create + embed. **Format is G4-flagged for Derek** — build the adapter behind an interface so the parser can be swapped when the real export format is known.

### Anti-Patterns to Avoid
- **Vector-first ranking** — see Pattern 4. Filter (active/eligible/affordable) FIRST; this is the phase's #1 rule.
- **Letting the model decide availability/eligibility** — the model can *explain* a refusal but must never *override* a deterministic gate. The prompt says "only recommend `status==='active'` records returned by the tool; if the tool returns none, refuse."
- **Inventing missing lead data** — parser emits `unknown`; agent asks rather than guesses nationality/income (PITFALLS 23/36).
- **Writing Firestore inside a tool** — tools are read-only; `finderSlot` write is in `onFinish`.
- **Hard-coding the classifier/finder model** — always `modelFor('router')` / `modelFor('finder')`.
- **Streaming from a Server Action** — Finder streams from the existing `/api/chat` Route Handler only (TSD §3.4).
- **`route()` left sync** — activating the LLM fallback makes routing async; update all call sites + tests.
- **Drive API for collateral** — forbidden (C2). Storage path / URL only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Free-text → structured criteria | A regex/keyword parser | `generateObject` + Zod `CriteriaSchema` | Handles trilingual code-switching + fuzzy phrasing; already the project's structured-output tool (ai@5) |
| Vector KNN over projects | Cosine math + scan | `findNearest(DOT_PRODUCT)` over `projects.embedding` | Already proven in `src/rag/search.ts`; index already exists |
| Project embedding | New embedder | `embedText(text, {inputType:'document'})` | Same Gemini 1024-d standard as KB; one embedder across all collections |
| Per-lead memory slot | New doc/collection | `writeLeadSlot(leadId,'finderSlot',…)` | Slot-scoped writer + rules already built; finderSlot already in schema |
| Model resolution | Hard-coded IDs | `modelFor('router'|'finder')` | Remote Config keys + fallbacks already coded (C5/QUAL-01) |
| Admin CRUD scaffolding | New admin app | Mirror `(admin)/kb/*` RSC+ServerAction pattern | Role gate, session-cookie auth, list/form all established |
| Tool calling / multi-step loop | Manual orchestration | `streamText({tools, stopWhen: stepCountIs(N)})` | AI SDK v5 native; same as Coach |
| Citation/grounding display | New UI | Card+Badge pattern from `message-list.tsx` | Match cards reuse the grounding-proof component |

**Key insight:** Phase 3 adds *one new core module* (`src/inventory`) and *one new agent* (`src/agents/finder`) — everything else is wiring existing seams. If a plan proposes a new dependency, a new vector store, a new scheduler, or a new admin app, it has drifted.

## Runtime State Inventory

> Not a rename/refactor phase. Phase 3 is additive (new collections data + new code). No string-rename runtime state to migrate. The one stateful consideration:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `projects.embedding` must be (re)generated whenever embedding-relevant fields change; stale embeddings = stale matches | Re-embed on `updateProject` for embedding-relevant fields; embed on `createProject`/import |
| Live service config | Remote Config keys `model.router.default` (haiku) + `model.finder.default` (sonnet) must exist in Derek's Remote Config template (fallbacks exist in code if absent) | Confirm/seed Remote Config values; code already falls back safely |
| OS-registered state | None — no schedulers/tasks added (lazy-cron only) | None |
| Secrets/env vars | None new — reuses `ANTHROPIC_API_KEY` + `GOOGLE_GENERATIVE_AI_API_KEY` | None |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: Recommending sold-out / hidden / bumi-reserved projects (PITFALLS 1 & 23 — highest trust risk)
**What goes wrong:** A semantically-matching project that is sold out, hidden, or bumi-reserved/foreign-ineligible gets recommended.
**Why it happens:** Vector retrieval models content, not inventory state or eligibility; embeddings are computed at ingest and never re-checked at recommend-time.
**How to avoid:** Pattern 4 — deterministic `status:'active'` + eligibility filter BEFORE vector re-rank; prompt forbids recommending anything the tool didn't return; eval asserts refusal-with-alternative on a Derek-flagged `sold_out` project and on a foreign-buyer-vs-bumi-quota case.
**Warning signs:** Eval regression on the "sold-out refusal" / "foreign-eligibility" scenarios after a prompt change; Derek reports "still pitching X" after flagging it.

### Pitfall 2: Router mis-route erodes trust (FIND-11, SC5)
**What goes wrong:** A Coach question routes to Finder (or vice versa); the agent gets a wrong-pillar answer and stops trusting the surface.
**Why it happens:** LLM classifier over-confident on ambiguous input; no safe default.
**How to avoid:** Heuristic-first for clear cases; **confidence threshold → default to `coach`** on low confidence; **override chip always wins**; record `routeDecision` (D-02) so every route is auditable + eval-able; Promptfoo router-precision suite with trilingual cases.
**Warning signs:** Rising override-chip usage; eval routing-accuracy drop; `low_confidence` flags spike.

### Pitfall 3: Financing/affordability mismatch (PITFALLS 36, FIND-10)
**What goes wrong:** Recommends RM800k units to a RM6k/month household.
**How to avoid:** Affordability gate in Stage A — derive a price ceiling from income; if all eligible exceed it → `ineligible` refusal-with-explanation, not a stretch match. Parser must capture income; if missing, ask.
**Warning signs:** Lead nationality/income missing on >30% of leads (data-quality signal — flag to Derek).

### Pitfall 4: Segment-blind ranking (PITFALLS 24, FIND-09)
**What goes wrong:** "Nice" interpreted literally for an investor who wants yield.
**How to avoid:** Parser sets `segment`; ranking branches (Pattern 4); eval = parallel investor/own-stay queries with identical surface criteria must yield different top-3.

### Pitfall 5: Legal over-confidence on foreign-buyer thresholds (PITFALLS 27)
**What goes wrong:** Finder states a definitive foreign-buyer price threshold ("yes, RM800k is fine") that is state-dependent and changes.
**How to avoid:** Ground eligibility ONLY in the project's own `foreignEligible`/`bumiQuota` fields + a disclaimer block for legal-threshold questions; refuse to state generic legal thresholds — defer to D2 sales admin. Add the legal-topics disclaimer to the prompt.

### Pitfall 6: `findNearest` range-filter limitation (Firestore constraint)
**What goes wrong:** Plan assumes `where('priceBand','<=',x).findNearest(...)` works; it throws — `findNearest` pre-filters are equality-only.
**How to avoid:** Apply range filters in the Stage-A `get()` + intersect, or use discrete equality-filterable price bands. Decide in planning. `[CITED: firebase.google.com/docs/firestore/vector-search]`

### Pitfall 7: Async-route ripple (regression risk)
**What goes wrong:** Making `route()` async to call the classifier breaks `heuristic.test.ts` and any sync caller (the stall-detect job references the router).
**How to avoid:** Add `routeAsync()` and keep a sync `route()` for the override/clear-heuristic fast path, OR migrate all callers + tests in the same plan and run the full suite. Self-audit every `route(` call site.

### Pitfall 8: Stale project embedding after edit
**What goes wrong:** Admin edits a project's description/price; embedding not regenerated; matches use stale vector.
**How to avoid:** `updateProject` re-embeds when embedding-relevant fields change (composeProjectEmbeddingText delta check).

## Code Examples

### Chat-route Finder dispatch branch (edit the existing stub)
```typescript
// Source: app/api/chat/route.ts (existing pillar === 'coach' ? … : … stub at lines 203-216)
const decision = await routeAsync(
  messages.map((m) => ({ role: m.role, content: m.content })),
  { override: body.override },                    // override chip wins
)
const pillar = decision.pillar                    // 'coach' | 'finder'

let agentSystemPrompt: string
let agentTools: Record<string, unknown>
if (pillar === 'finder') {
  agentSystemPrompt = finderAgent.buildSystemPrompt({ leadContext: storedFinderSlot })
  agentTools = finderAgent.makeTools(userLang, uid, body.leadId)
} else {
  agentSystemPrompt = coachAgent.buildSystemPrompt(journeyContext)
  agentTools = coachAgent.makeTools(userLang, uid)
}
const model = await modelFor(pillar)              // Remote Config; finder→sonnet, coach→sonnet
// streamText({ model, system: agentSystemPrompt, tools: agentTools, stopWhen: stepCountIs(5), onFinish })
// onFinish: persist message with routeDecision = `${pillar}:${decision.reason}` (D-02),
//           writeLeadSlot(leadId,'finderSlot',{criteria, discussedProjectIds}) if pillar==='finder'
```

### Project embedding text composition (discretion — proposed)
```typescript
// Source: composes existing embedText (src/rag/embed.ts), inputType:'document'
export function composeProjectEmbeddingText(p: ProjectDoc): string {
  // Fields that describe the project semantically — NOT status (status is a hard filter, not vector)
  return [p.name, p.priceBand, p.tenure, p.bedrooms, p.locationText, p.description]
    .filter(Boolean).join(' · ')
}
// embedText(composeProjectEmbeddingText(p), { inputType: 'document' })  → projects.embedding (1024-d)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ROADMAP/01-CONTEXT wording: QStash scheduler, Voyage embeddings | Lazy-cron Server Action; Gemini `gemini-embedding-001` 1024-d | 2026-06-01 (PROJECT.md Key Decisions) | Phase 3 uses `embedText` (Gemini) for project vectors; no scheduler work |
| AI SDK v4 `toDataStreamResponse()` | v5 `toUIMessageStreamResponse()` | ai@5 | Finder streams via the same method already in `/api/chat` |
| Router heuristic-only (Coach always) | Heuristic → `generateObject` LLM classifier → override | This phase (D-01) | `classifyIntent` activated; `route()` async |

**Deprecated/outdated:** Ignore ROADMAP §Constraints' "Upstash QStash is the one sanctioned external dependency" and 01-09's "Voyage embed" — both superseded by the 2026-06-01 overrides (authoritative in PROJECT.md). `src/rag/embed.ts` already uses Gemini; `src/jobs/` already uses lazy-cron.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D2 inventory exports as CSV/JSON (G4) | Pattern 8 / FIND-02 | MEDIUM — import adapter is built behind an interface; only the parser changes. **Flag for Derek before finalizing import.** |
| A2 | Affordability ceiling ≈ income × DSR multiple is acceptable for v1 | Pattern 4 / FIND-10 | MEDIUM — exact financing rule is a D2 business decision; confirm the formula with Derek. Gate logic is sound regardless of the constant. |
| A3 | `priceBand` is a string band (current schema) not a numeric value | Pattern 4 | MEDIUM — affects whether range filtering needs in-memory handling or numeric field. May need a numeric `priceValue` field. Planner to resolve. |
| A4 | `vpStatus` boolean is insufficient for "completed VP **this year**" | Pattern 7 / FIND-07 | MEDIUM — likely needs a `vpDate`/`completionDate` field + index. Confirm date-grain with Derek. |
| A5 | Inventory is ≤ a few hundred active projects (in-memory re-rank viable) | Pattern 4 | LOW — if inventory is large, use `findNearest` + intersection. Architecture supports both. |
| A6 | Confidence-threshold default-to-coach is the right safe fallback | Pattern 1 / Pitfall 2 | LOW — tunable; recorded `routeDecision` + eval make it observable and adjustable. |
| A7 | `'reply'` excluded from the router enum until Phase 4 | Pattern 1 | LOW — matches roadmap; classifier enum is `['coach','finder']` this phase. |

## Open Questions (PARTIALLY RESOLVED)

> RESOLVED in planning: price representation → numeric `priceValue` + discrete `priceBand` (03-01); VP date queries → `vpDate` (03-01); affordability → pluggable `affordabilityCeiling` (03-02). **OPEN by design:** the G4 inventory source format is deferred to Derek via a blocking `checkpoint:decision` in 03-08 (the `ProjectSource` interface + CSV default ship regardless).

1. **Inventory source format (G4) — OPEN (by design): Derek checkpoint in 03-08**
   - What we know: build a CSV/JSON import adapter; `projects` schema is fixed in `collections.ts`.
   - What's unclear: the actual D2 export shape (CSV columns? Sheet? per-project doc?).
   - Recommendation: build `import.ts` behind a `ProjectSource` interface; ship a CSV parser as default; confirm format with Derek before the pilot import. Do NOT block planning on this.

2. **Price representation for range filtering**
   - What we know: schema has `priceBand: string`; `findNearest` pre-filters are equality-only.
   - What's unclear: whether to add a numeric `priceValue` + handle range in-memory, or keep discrete bands.
   - Recommendation: add a numeric `priceValue` (or min/max) to `ProjectDoc` for affordability + range filtering; keep `priceBand` for display. Resolve in planning.

3. **VP-date grain for FIND-07**
   - What we know: `vpStatus: boolean` exists; "completed VP this year" needs a date.
   - Recommendation: add `vpDate`/`completionDate` + index; or scope FIND-07 to boolean for v1 and flag the date question for Derek.

4. **Affordability formula**
   - Recommendation: implement a pluggable `affordabilityCeiling(income)`; confirm the DSR/multiple with Derek.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ai` (v5) | classifier, criteria-parse, finder stream/tools | ✓ | 5.0.193 | — |
| `@ai-sdk/anthropic` | router (haiku) + finder (sonnet) via modelFor | ✓ | 2.0.80 | Remote Config fallback consts |
| `@ai-sdk/google` | project embeddings (Gemini 1024-d) | ✓ | 2.0.74 | Pinecone seam (rag adapter) |
| `firebase-admin` | findNearest + projects/collateral queries + slot writes | ✓ | 13.10.0 | — |
| `projects (status, embedding 1024-d flat)` index | searchProjects vector re-rank | ✓ (in firestore.indexes.json) | — | add equality-only composite indexes as needed |
| Firebase Remote Config keys `model.router.default`, `model.finder.default` | model resolution | ⚠ code-fallback present | — | hard-coded fallback consts in provider.ts (haiku/sonnet) |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `ANTHROPIC_API_KEY` (Secret Manager) | embed + model calls | ✓ (P1) | — | — |
| Firebase Storage (collateral files) | collateral storagePath / signed URLs | ✓ (provisioned P1) | — | external share-URL string |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Remote Config router/finder keys (safe code fallbacks already present — confirm Derek seeds them); any new range/date indexes (add to `firestore.indexes.json` in a Wave-0 plan).

## Validation Architecture

> nyquist_validation = true → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2 (unit/integration), Playwright ^1.5x (e2e), `@firebase/rules-unit-testing` (rules CI), Promptfoo (evals, Opus 4.7 judge) |
| Config file | `vitest.config.*` (P1), `playwright.config.*` (P1), `evals/` Promptfoo configs (P1) |
| Quick run command | `npx vitest run src/agents/finder src/router src/inventory` |
| Full suite command | `npx vitest run && npx playwright test && <promptfoo finder + router suites>` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIND-11 | heuristic→classifier→override; low-confidence→coach | vitest unit | `npx vitest run src/router/classifier.test.ts -t routing` | ❌ Wave 0 |
| FIND-11 | router precision (trilingual coach vs finder) | Promptfoo eval | `<promptfoo router-precision>` | ❌ Wave 0 |
| FIND-02 | router records `routeDecision` on message | integration | `npx vitest run app/api/chat/route.test.ts -t routeDecision` | ⚠ extend existing |
| FIND-03 | criteria parser free-text → struct (incl. `unknown` on missing) | vitest unit | `npx vitest run src/agents/finder/finder.test.ts -t parse` | ❌ Wave 0 |
| FIND-01/03 | two-stage searchProjects ranks eligible set | vitest unit | `npx vitest run src/inventory/search.test.ts -t rank` | ❌ Wave 0 |
| FIND-01 | **active-only enforced (sold-out never recommended)** | vitest unit + Promptfoo eval | `npx vitest run src/inventory/search.test.ts -t active-only` + `<promptfoo sold-out-refusal>` | ❌ Wave 0 |
| FIND-09 | investment vs own-stay → different top-3 | Promptfoo eval | `<promptfoo segmentation>` | ❌ Wave 0 |
| FIND-10 | affordability gate → ineligible refusal | vitest unit | `npx vitest run src/inventory/search.test.ts -t affordability` | ❌ Wave 0 |
| FIND-05/08 | finderSlot stored; re-rank w/o re-typing | vitest unit + e2e | `npx vitest run src/memory/memory.test.ts -t finderSlot` + Playwright | ⚠ extend + ❌ e2e |
| FIND-06 | returning-client surfaces only new launches | vitest unit | `npx vitest run src/inventory/search.test.ts -t returning` | ❌ Wave 0 |
| FIND-07 | structured VP query (no vector) | vitest unit | `npx vitest run src/inventory/search.test.ts -t queryInventory` | ❌ Wave 0 |
| FIND-04 | collateral attached by projectId (Storage/URL, no Drive) | vitest unit | `npx vitest run src/inventory/crud.test.ts -t collateral` | ❌ Wave 0 |
| ADMIN-04 | project CRUD admin-gated; rules deny non-admin write | rules-unit-test + vitest | `npx vitest run src/firebase/__tests__/rules.test.ts -t projects` | ⚠ extend rules test |
| ADMIN-04 | add/edit/hide + import via admin UI | Playwright e2e | `npx playwright test inventory-admin` | ❌ Wave 0 |
| FIND-01 (full) | paste criteria → match cards + collateral + rationale, routed | Playwright e2e | `npx playwright test finder-flow` | ❌ Wave 0 |
| (refusal grounding) | no-match/ineligible → grounded refusal, no invented project | Promptfoo eval | `<promptfoo finder-grounding>` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed module>` (router/finder/inventory)
- **Per wave merge:** `npx vitest run && npx playwright test inventory-admin finder-flow`
- **Phase gate:** full vitest + Playwright + Promptfoo finder/router suites green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/router/classifier.test.ts` — covers FIND-11 routing + low-confidence default
- [ ] `src/agents/finder/finder.test.ts` — covers FIND-03 parse + refusal gate
- [ ] `src/inventory/search.test.ts` — covers FIND-01/03/06/07/09/10 + active-only
- [ ] `src/inventory/crud.test.ts` — covers FIND-04 + ADMIN-04
- [ ] Extend `src/firebase/__tests__/rules.test.ts` — projects/collateral admin-write + signed-in-read
- [ ] Extend `app/api/chat/route.test.ts` — finder dispatch branch + routeDecision persistence
- [ ] Extend `src/memory/memory.test.ts` — finderSlot read/write + re-rank merge
- [ ] Promptfoo suites: `evals/finder-*` (sold-out refusal, segmentation, grounding, foreign-eligibility) + `evals/router-precision` (trilingual)
- [ ] Playwright: `inventory-admin` + `finder-flow` e2e specs

## Security Domain

> No `security_enforcement: false` in config → section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Firebase Auth + `requireUser` on chat route + admin RSC/Server Actions (unchanged) |
| V4 Access Control | yes | `projects`/`collateral` rules: signed-in tenant read, **admin-only write** (already in firestore.rules); inventory Server Actions re-check `role==='admin'`; Finder tools read **as the user** |
| V5 Input Validation | yes | Zod on tool `inputSchema` + criteria-parse schema + CSV import validation against `ProjectDoc` before write |
| V6 Cryptography | no (new) | Reuses existing audit hashing; collateral signed URLs via Admin SDK (no new crypto) |
| PDPA boundary (project-specific) | yes | Lead criteria are pasted → **may carry PII** → existing GATE 3 `pseudonymize + assertRedacted` must run before the Finder model call (same gate as Coach); criteria parser sees redacted text; audit stores hashes only |

### Known Threat Patterns for Next.js 16 / Firebase / LLM-agent stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Recommending sold-out/ineligible inventory (grounding failure) | Information disclosure / Repudiation | Deterministic active-only + eligibility filter (Pattern 4); eval gate |
| Lead PII reaching the model unredacted (criteria paste) | Information disclosure (PDPA) | GATE 3 pseudonymize + `assertRedacted` (422 if not redacted) — already enforced on `/api/chat` |
| Non-admin writes to `projects`/`collateral` | Elevation of privilege | `hasRole('admin') && incomingTenant()` write rule (present) + Server Action re-check; rules-unit-test |
| Cross-pillar `finderSlot` overwrite | Tampering | Slot-scoped `writeLeadSlot` (only named slot written) + owner-only rules |
| Prompt-injected "recommend project X" overriding availability | Tampering | Model can only recommend tool-returned active records; gate is deterministic, not prompt-controlled |
| Tool authenticating as admin from a user path | Elevation of privilege | Finder tools read `projects` under the user's signed-in scope (rules allow tenant read); no admin-as-user writes |
| Mis-route leaking wrong-pillar behavior | Repudiation | `routeDecision` recorded on every message (D-02); override chip auditable |

## Sources

### Primary (HIGH confidence)
- Installed code (read this session): `src/router/{classifier,heuristic,index}.ts`, `src/agents/coach/{index,tools,schema,prompt}.ts`, `src/rag/{search,embed,index}.ts`, `src/memory/{leadContext,index}.ts`, `src/firebase/collections.ts`, `src/llm/provider.ts`, `src/kb/{crud.ts, ingest/pipeline.ts}`, `app/api/chat/route.ts`, `app/[lang]/(admin)/kb/{page.tsx,actions.ts}`, `app/[lang]/chat/message-list.tsx`, `firestore.rules`, `firestore.indexes.json` — the actual seams Phase 3 extends.
- Installed SDK versions verified via `node require`: `ai@5.0.193` (generateObject/streamText/tool/stepCountIs all exported), `@ai-sdk/anthropic@2.0.80`, `@ai-sdk/google@2.0.74`, `zod@4.4.3`, `firebase-admin@13.10.0`.
- `.planning/TSD.md` §3.3 Finder flow, §4 data model (`projects`/`collateral`/`leadContext`), §5 security, §6 AI grounding, §14 G4.
- `.planning/PROJECT.md` Key Decisions (2026-06-01 Gemini + lazy-cron overrides — authoritative).
- `.planning/REQUIREMENTS.md` (FIND-01..12, ADMIN-04), `.planning/ROADMAP.md` Phase 3 goal + SC1–5, `.planning/phases/03-finder-routing/03-CONTEXT.md` (D-01..D-10).

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — Pitfalls 1 (sold-out), 23 (bumi/foreign eligibility), 24 (segment-blind), 27 (legal over-confidence), 36 (financing mismatch), 22 (Next.js 16 Server Action vs Route Handler) — Finder-specific, cross-referenced with TSD grounding mandate.

### Tertiary (LOW confidence)
- Firestore `findNearest` pre-filter equality-only limitation `[CITED: firebase.google.com/docs/firestore/vector-search]` — consistent with the existing `src/rag/search.ts` equality pre-filter usage, but the planner should confirm range-filter behavior against current Firestore docs if numeric range filtering is chosen.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every tool installed + version-verified; no new deps.
- Architecture/seams: HIGH — read the actual P1/P2 code; dispatch stubs + finderSlot + project index + router seam all already present.
- Pitfalls: HIGH — Finder pitfalls richly documented in PITFALLS.md and aligned with the grounding mandate.
- Inventory source format (G4): LOW — flagged for Derek; mitigated by a pluggable import adapter.
- Price/VP-date schema grain: MEDIUM — likely needs a numeric `priceValue` + `vpDate` field; resolve in planning.

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (stable internal stack; re-verify only if AI SDK or firebase-admin majors bump)
