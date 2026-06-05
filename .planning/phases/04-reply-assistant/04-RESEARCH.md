# Phase 4: Reply Assistant + Reply Analytics — Research

**Researched:** 2026-06-05
**Domain:** Adding the third agent pillar (Reply Assistant) + reply-quality analytics to an existing brownfield 2-pillar (Coach + Finder) Next.js 16 + Firebase + Vercel AI SDK v5 platform
**Confidence:** HIGH (all claims grounded in repo code with file:line citations; the only LOW-confidence items are net-new schema/UX shapes the planner must design)

This is a brownfield "grow, don't fork" phase. Every section below is grounded in the actual repo state, not training assumptions. Where the codebase makes a CONTEXT.md decision harder than it reads, it is flagged with ⚠️.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-23 — verbatim intent)

**Reply agent shape & 3-pillar dispatch (REPLY-01/02/04/10)**
- **D-01** — Reply agent mirrors Finder pattern. Create `src/agents/reply/{index.ts, prompt.ts, schema.ts, tools.ts}` matching the Finder shape (system-prompt builder + read-only tools + Zod output schema + offline `run()` path). Invoked through the router. Same `streamText` pipe — no new transport. *Do NOT introduce a parallel agent shape.*
- **D-02** — Chat route grows to 3-pillar dispatch. Extend `app/api/chat/route.ts` so `pillar === 'reply'` → `replyAgent.buildSystemPrompt({ replySlot, incoming, leadId }) + replyAgent.makeTools(...)`. Override-chip type widens from `'coach' | 'finder'` to `'coach' | 'finder' | 'reply'`. GATE ordering unchanged (auth → ratelimit → PDPA pseudonymize → routeAsync → dispatch → stream → onFinish). *Do NOT fork a `/api/reply` endpoint.*
- **D-03** — Read-only tools only. `retrieveReplySop(category?, query)` (Gemini vector + filter `pillar:'reply'`), `fetchVoiceSamples()` (curated org-voice doc, NOT per-user `voiceSamples[]`), `fetchLeadContext(leadId)` (recent Reply turns, leadId-scoped). **No tool writes** — `replySlot` write in `onFinish` (mirror Finder; Pitfall 23/36 avoided).

**Intent classifier with 3 pillars (REPLY-10, SC1)**
- **D-04** — Heuristic patterns extended for Reply (inbound block / "lead said…" / "draft a reply" / "reply to this" / "what should I say"). Finder/Coach patterns untouched. Extend in-place.
- **D-05** — `classifyIntent` schema widens binary→ternary; classifier model still resolved from Remote Config (`claude-haiku-4-5`). Mis-routes feed eval via the `routeDecision` seam + override chip is the user-facing correction.

**Per-lead context isolation (REPLY-03, SC2)**
- **D-06** — `leadContext.replySlot` is the third slot. Stores: parsed inbound classification (cold-prospect / objection / financing / other), latest draft, edit-history pointers, rolling per-lead summary. Cross-lead bleed structurally impossible (keyed by `leadContext/{leadId}`). Wire via existing slot writer; no new memory primitive.
- **D-07** — Required `leadId` for Reply turns. UI: if no `leadId`, show a "Which lead?" selector (downline-scoped) before dispatch. Default to most recent lead the agent touched **only** if < 24h old; otherwise force explicit pick. **No auto-inferred lead linking.**

**Reply SOP knowledge base (REPLY-01/05/06/07, ADMIN-05)**
- **D-08** — Reply SOPs are KB documents. Reuse `kbDocs` unchanged; `pillar` field with `'coach' | 'reply'` (default `'coach'` for existing docs — one-time backfill). `retrieveReplySop` filters `findNearest` by `pillar:'reply'` AND `status:'published'`. *Do NOT create a `replySops` collection.*
- **D-09** — SOP categories via doc metadata. Categories: `cold-prospect`, `objection-handling`, `financing`. Stored as `category` field on `kbDocs`. `retrieveReplySop` accepts optional category filter. Free-form `category`; canonical values seeded but not hard-coded.
- **D-10** — Grow the existing admin KB surface; do NOT fork. Add a pillar filter/tab to `(admin)/kb`. ADMIN-05 = a filter view on the existing manager.
- **D-11** — No-SOP-match → grounded refusal. `retrieveReplySop` no hit above threshold → `no_sop_match` (mirrors Finder `no_match`). Message: "I don't have a D2 reply SOP for this — please draft manually, or check with your senior coach." Log a `kb-miss` event (same path as Phase-2 knowledge-gap feed). Never invent SOP content.

**Voice / tone calibration (REPLY-08, QUAL-02)**
- **D-12** — Curated org-voice doc is the v1 source of voice (`pillar:'reply', category:'voice'`): Derek's anonymized samples + tone rules + 5–10 example exchanges. `fetchVoiceSamples` retrieves it. `users.voiceSamples[]` stays a **deferred per-user signal**.
- **D-13** — Tone-aware eval rubric. Extend `src/eval/judge.ts` with Reply-specific assertions: voice match (vs curated doc), no-AI-tell, qualifying-questions framework (cold-prospect uses questions not pitches — REPLY-05), no auto-pitch, language match. Reuse `voice` + `toneDrift` skeleton. Add Reply gold sets. Extend judge in-place.
- **D-14** — Trilingual voice posture (pragmatic). Voice rubric calibrated EN-first; BM/中文 samples land when Derek provides them. Full trilingual plumbing applies. Flag for Derek.

**Paste-and-draft UX (REPLY-02/04, QUAL-02)**
- **D-15** — Inline in the existing chat surface. No separate `/reply` page. Draft renders as a visually distinct card (mirrors `match-list`): incoming-quoted block + draft text + "Copy draft" button.
- **D-16** — Copy-to-clipboard is the ONLY send path. One action: `Copy draft`. No share/auto-post/system-share-sheet. After copy, card collapses to "Copied 2s ago — go send it from WhatsApp."
- **D-17** — Disclosure reuses Phase-2 machinery (first-run modal + persistent badge). Add one Reply line: "Drafts are AI suggestions — review before sending from your phone." (en/ms/zh).

**Edit-as-signal capture (REPLY-09, ADMIN-06)**
- **D-18** — Capture `originalDraft` (model output) vs `editedFinal` (clipboard at Copy). In-card controlled textarea; `Copy draft` reads textarea, computes diff against `originalDraft`, writes one `replyEdits/{eventId}` row `{leadId, draftId, sopDocIds[], originalDraft, editedFinal, diff, agentUid, lang, timestamp}`. **No WhatsApp webhook.**
- **D-19** — `replyEdits` is a new top-level collection. Downline-scoped rules (agent reads own; coach reads downline; admin reads all). Indexes: `sopDocIds`, `agentUid`, `timestamp`. Append-only. *Do NOT bury edits inside `messages`.*
- **D-20** — Aggregation is on read. Per-SOP edit-rate, common-edit patterns, thumbs-down rate via dashboard queries (Firestore aggregation + small derived caches if needed). No background rollup job in v1. `eval-nightly` picks up only judge-rubric metrics.

**Reply quality analytics dashboard (REPLY-11, ADMIN-06)**
- **D-21** — Grow the senior-coach dashboard. Add a "Reply Quality" panel to `(coach)/dashboard`: edit-rate per SOP, thumbs-down rate, top-edited SOP, escalation rate, drafts-per-agent. Reuse `recharts`. Downline-scoped via existing claims+rules double-gate.
- **D-22** — Admin gets the full org view (same panel, no downline filter). Single component, role-conditional query.

**WABA graduation gate (REPLY-12 — documented, not implemented)**
- **D-23** — `WABA-GATE.md` artifact at `.planning/phases/04-reply-assistant/WABA-GATE.md` listing gate metrics. Thresholds are Derek's call; planning proposes initial values. *Do NOT scaffold any WABA integration code.*

### Claude's Discretion
- Exact Reply system-prompt content + few-shot structure (derive from curated voice doc; researcher/planner propose).
- Canonical SOP categories beyond `cold-prospect / objection-handling / financing` (treat `category` as open-string with a seeded enum).
- Edit-rate / thumbs-down thresholds in WABA-GATE.md (propose initial values; final values Derek's).
- Draft card editor: default to controlled `<textarea>` + shadcn `Input` styling. Tiptap is NOT installed; pulling it in is net-new.

### Deferred Ideas (OUT OF SCOPE)
- WhatsApp Business API integration / auto-send (forever excluded in v1).
- Per-user voice learning from `users.voiceSamples[]` (post-pilot).
- BM/中文 voice-fingerprint depth (plumbing applies; tuned samples land later).
- Webhook-driven edit capture from WhatsApp (depends on WABA).
- Rich draft editor (Tiptap-style).
- Pre-computed analytics rollups.
- Reply Assistant on the senior-coach side (a coach drafting on behalf of an agent).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPLY-01 | Reply SOP KB ingested + retrievable | `kbDocs.pillar` already typed (`collections.ts:278`); reuse `src/kb/crud.ts` + `src/kb/ingest/pipeline.ts`. ⚠️ GAP: `kbChunks` lacks a `pillar` field and `processBatch` doesn't write it (`pipeline.ts:210-220`) — must be added or the pillar filter can't work. |
| REPLY-02 | Paste incoming WhatsApp → draft grounded in D2 SOPs | Mirror `finderAgent` (`src/agents/finder/index.ts`); new `retrieveReplySop` tool wraps a pillar-filtered `firestoreRetrieve` variant. |
| REPLY-03 | Per-lead thread context across parallel conversations | `leadContext/{leadId}` + `writeLeadSlot('replySlot', …)` (`leadContext.ts:31,73`); slot already declared (`collections.ts:126`). |
| REPLY-04 | Draft generation with explicit edit-before-send; never auto-sent | New `reply-draft-card.tsx` (mirror `match-list.tsx`); copy-only (D-16). |
| REPLY-05 | Cold-prospect reply uses qualifying-questions framework, not a pitch | Reply prompt branch + judge assertion (D-13). |
| REPLY-06 | Objection-handling drafts | SOP `category:'objection-handling'` + prompt. |
| REPLY-07 | Loan / financing answered using D2 financing SOP | SOP `category:'financing'`. |
| REPLY-08 | Tone calibration against historical D2 conversations | Curated org-voice doc (D-12) via `fetchVoiceSamples`. |
| REPLY-09 | Edit-feedback capture → signals to refine SOPs | New `replyEdits` collection (D-18/19). |
| REPLY-10 | Reply added to intent router — 3 pillars active | Extend `heuristicPillar` (`heuristic.ts:107`) + `RouteSchema` (`classifier.ts:28`) + route dispatch (`route.ts:289`). |
| REPLY-11 | Reply quality analytics dashboard | Reply Quality panel on `(coach)/dashboard` (D-21). |
| REPLY-12 | WABA graduation criteria defined (gate, not impl) | `WABA-GATE.md` artifact (D-23). |
| ADMIN-05 | Reply SOP management | Pillar filter on `(admin)/kb` (D-10). |
| ADMIN-06 | Feedback-loop visibility (thumbs-down, rewrites, escalation) | `replyEdits` aggregation on the dashboard (D-20/21/22). |
| QUAL-02 | Non-API WhatsApp posture (suggested drafts; agent reviews) | Copy-only UX (D-16) + disclosure line (D-17). |
</phase_requirements>

## Summary

The Reply pillar is the third instance of an agent shape the codebase has now built twice (Coach, Finder). The Finder is the literal template: a frozen `agent` object exposing `buildSystemPrompt()`, `makeTools()`, `outputSchema`, and an offline `run()`; tools are read-only; the per-lead slot is written in the route's `onFinish`, never inside a tool. Mirroring this for `src/agents/reply/` is mechanical and low-risk. The 3-pillar dispatch is a one-branch extension of `app/api/chat/route.ts`, where the GATE ordering, the override-chip enum, and the `onFinish` slot write all already have a Finder analog to copy line-for-line.

The genuine engineering work — and the risk — concentrates in five places that the codebase makes **harder than CONTEXT.md implies**: (1) the PDPA pseudonymize gate currently only redacts **known names passed as an array** plus phone-number regexes, and the chat route passes `names: []` — so a free-text WhatsApp paste's names/addresses/financials flow to the model **unredacted today**; this is the single highest-risk gap and must be closed before any Reply turn ships. (2) `kbChunks` has **no `pillar` field** and `processBatch` doesn't write one, so `retrieveReplySop`'s `pillar:'reply'` filter cannot work without a schema + pipeline change + backfill + a new composite vector index. (3) `firestoreRetrieve` is hard-coded to the Coach contract (no pillar filter, no category filter) — Reply needs a parallel retrieval path or a parameterized one. (4) `replyEdits` requires a brand-new collection ref, converter, deny-by-default rules with downline scoping, **and three composite indexes**, plus a server-side write path (the only writer is the chat route / a Server Action via Admin SDK — clients never write directly). (5) Firestore aggregation-on-read for the dashboard needs new composite indexes and careful downline scoping that mirrors the existing `getDownline`/`getOpenStalls` server-side pattern.

**Primary recommendation:** Build `src/agents/reply/*` as a faithful Finder mirror first (cheap, unblocks everything), then close the PDPA gap as a Wave-0 blocker, then do the `kbChunks.pillar` schema migration (it gates retrieval), then wire dispatch + `replySlot`, then `replyEdits` + dashboard. Treat PII-at-the-boundary and wrong-lead-isolation as the two non-negotiable verification gates.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reply intent detection | API / Backend (`src/router`) | — | `routeAsync` runs server-side in the chat route; heuristic + LLM classifier are core modules. |
| Reply draft generation | API / Backend (`src/agents/reply`) | — | Core agent invoked from the Node Route Handler; streams via `streamText`. Core/shell rule: portable, Next-free. |
| PII pseudonymization | API / Backend (`src/audit/pdpa`) | — | MUST run server-side before the model call (cross-border boundary). Never client-side. |
| Reply SOP retrieval | API / Backend (`src/rag`) | Database (Firestore `findNearest`) | Vector search runs as Admin SDK service account; Firestore is the vector index. |
| Per-lead context isolation | Database (`leadContext/{leadId}`) | API (`writeLeadSlot`) | Firestore doc keyed by leadId is the isolation boundary; slot writer enforces slot-scoping. |
| Draft card rendering | Browser / Client (`reply-draft-card.tsx`) | — | RSC-render-only card + a small client island for the editable textarea + copy. |
| Copy-to-clipboard + edit capture | Browser / Client | API (Server Action to write `replyEdits`) | Clipboard is a browser API; the `replyEdits` write must be server-side (Admin SDK) because rules deny client writes. |
| Reply SOP admin | Frontend Server (RSC) + Server Actions | Database | Mirrors existing `(admin)/kb` Server-Action mutation pattern. |
| Reply analytics | Frontend Server (RSC) | Database (aggregation queries) | Dashboard reads run server-side via Admin SDK with downline filter (AUTH-06). |
| WABA gate | Docs only | — | `.planning/phases/04-reply-assistant/WABA-GATE.md`; zero code. |

## Standard Stack

No new dependencies. Everything Phase 4 needs is already installed. `[VERIFIED: package.json]`

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK v5) | `^5.0.193` | `streamText`, `generateObject`, `tool` | Already the transport for Coach + Finder. `toUIMessageStreamResponse()` is the verified v5 stream method (`route.ts:433`); `toDataStreamResponse()` does NOT exist in 5.0.x. `[VERIFIED: route.ts:24-26]` |
| `@ai-sdk/anthropic` | `^2.0.80` | Claude provider via `modelFor()` | Model ID resolved from Remote Config, never hard-coded (`provider.ts:70-88`). `reply` key already in fallback map (`provider.ts:42`). |
| `@ai-sdk/google` | `^2.0.74` | Gemini `gemini-embedding-001` @1024-d | `embedText` is the single embed path (`embed.ts:67`); Reply SOPs reuse it unchanged. |
| `firebase-admin` | `^13.10.0` | Firestore Admin SDK (server-only) | `findNearest`, typed collection refs, transactions. |
| `zod` | `^4.4.3` | Output + tool input schemas | `ReplyOutputSchema` mirrors `FinderOutputSchema`. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `recharts` | `^3.8.0` | Dashboard charts | Reply Quality panel (D-21). Already used by `metrics-panel.tsx`. |
| `sonner` | `^2.0.7` | Toasts | "Copied" confirmation; handoff/no-SOP toast (already used in `chat-input.tsx:27`). |
| `franc-min` | `^6.2.0` | Per-message language detect | `detectLang()` (`detect.ts:44`) — already wired in the route (`route.ts:235`). Reply reuses unchanged. |
| `next-intl` | `^4.13.0` | Trilingual UI copy | Disclosure line + draft-card labels (D-17). |
| shadcn `Card`/`Badge`/`Textarea`/`Button`/`ToggleGroup` | vendored | Draft card + override chip | All in `components/ui/`. No re-add. |

### No Diff Library Needed (D-18)
⚠️ There is **no diff library installed** (no `diff`, `diff-match-patch`, `jsdiff` in `package.json`). The MVP edit signal (D-18) needs an `originalDraft` vs `editedFinal` diff. **Recommendation:** do NOT add a dependency. Store both raw strings + a cheap computed metric (character-level edit distance / % changed — a ~15-line Levenshtein or a simpler `editedFinal.length`-vs-`originalDraft.length` + token-set diff in a core util `src/reply/diff.ts`). The dashboard aggregation needs a *rate*, not a rich visual diff, so a numeric `editRatio` plus the two raw strings is sufficient. This matches Pitfall 3's "edit-distance telemetry (>40% character change)" framing. `[VERIFIED: package.json — no diff dep]`

**Installation:** none.

**Version verification:** all versions are from the installed `package.json` (not the registry) — they are the authoritative project versions. `[VERIFIED: package.json]`

## Architecture Patterns

### System Architecture Diagram — Reply turn data flow

```
                  ┌─────────────────────────────────────────────────────────────┐
  Agent pastes    │  app/[lang]/chat (client island: chat-input.tsx)            │
  WhatsApp msg    │  - pillarOverride chip widened to coach|finder|reply (D-02) │
  + picks lead ──▶│  - leadId threaded (REQUIRED for reply — D-07)              │
                  │  - POST /api/chat { messages, cid, override?, leadId }      │
                  └───────────────────────────┬─────────────────────────────────┘
                                               │  Bearer ID token
                                               ▼
   ╔═══════════════════════ app/api/chat/route.ts (Node Route Handler) ═══════════════════════╗
   ║  GATE 1 requireUser ─▶ 401   GATE 2 ratelimit.check ─▶ 429                                 ║
   ║  GATE 3 pseudonymize(messages, KNOWN_NAMES) + assertRedacted ─▶ 422  ◀── ⚠️ HIGHEST RISK   ║
   ║          (today names=[] — Reply MUST inject lead names + free-text PII redaction)         ║
   ║  GATE 4 routeAsync({override}) ─▶ pillar ∈ {coach, finder, reply}                          ║
   ║  Dispatch ─┬─ coach  ─▶ coachAgent                                                         ║
   ║            ├─ finder ─▶ finderAgent                                                        ║
   ║            └─ reply  ─▶ replyAgent.buildSystemPrompt({replySlot, leadId})  ◀── NEW BRANCH  ║
   ║                         replyAgent.makeTools(userLang, uid, leadId)                        ║
   ║  GATE 5 streamText({ model: modelFor('reply'), system, tools, stopWhen })                  ║
   ║            tools (READ-ONLY): retrieveReplySop · fetchVoiceSamples · fetchLeadContext      ║
   ║                    │                                                                       ║
   ║                    ▼                                                                       ║
   ║         src/rag retrieve(pillar:'reply', category?, status:'published', lang)              ║
   ║                    │   (Gemini 1024-d query vector → Firestore findNearest)                ║
   ║                    ▼   no hit → no_sop_match (grounded refusal, log kb-miss)               ║
   ║  onFinish: appendMessage(user+assistant, routeDecision) ─▶ writeLeadSlot('replySlot')      ║
   ║            ─▶ ratelimit.decrement ─▶ after(() => audit.log(hashes only))                   ║
   ╚════════════════════════════════════════════════════════════════════════════════════════════╝
                                               │  SSE tokens (UIMessageStream)
                                               ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │  reply-draft-card.tsx (mirror match-list.tsx)               │
                  │  - quoted incoming block + editable <textarea> draft        │
                  │  - "Copy draft" (ONLY action) → reads textarea → clipboard  │
                  │  - on copy: Server Action writes replyEdits/{eventId}       │
                  │    {originalDraft, editedFinal, editRatio, sopDocIds, ...}   │
                  └─────────────────────────────────────────────────────────────┘

   ┌───── Analytics (read-time, D-20) ─────┐    ┌──── Admin (ADMIN-05) ────┐
   │ (coach)/dashboard Reply Quality panel │    │ (admin)/kb pillar filter │
   │ Firestore aggregation over replyEdits │    │ create reply SOPs +      │
   │ downline-scoped (AUTH-06)             │    │ category + voice doc     │
   └───────────────────────────────────────┘    └──────────────────────────┘
```

### Recommended Project Structure (new files vs grown files)

```
src/agents/reply/                 # NEW — literal mirror of src/agents/finder/
├── index.ts                      #   replyAgent: buildSystemPrompt/makeTools/outputSchema/run
├── prompt.ts                     #   buildReplySystemPrompt({replySlot, incoming, leadId})
├── schema.ts                     #   ReplyOutputSchema (draft | no_sop_match | clarifying)
├── tools.ts                      #   retrieveReplySop, fetchVoiceSamples, fetchLeadContext
└── reply.test.ts                 #   mirror finder.test.ts

src/rag/search.ts                 # GROW — add pillar+category filter (or a sibling fn)
src/memory/leadContext.ts         # GROW — add ReplySlot type + readReplySlot()
src/firebase/collections.ts       # GROW — add replyEdits ref/converter; add KbChunkDoc.pillar + KbDocDoc.category
src/kb/ingest/pipeline.ts         # GROW — write pillar onto each kbChunk (⚠️ currently missing)
src/kb/crud.ts                    # GROW — accept/persist `category` field
src/eval/judge.ts                 # GROW — Reply rubric assertions
src/reply/diff.ts                 # NEW — editRatio computation (no dependency)

firestore.rules                   # GROW — replyEdits deny-by-default + downline-scoped read
firestore.indexes.json            # GROW — kbChunks (pillar,status,embedding); replyEdits composites

app/api/chat/route.ts             # GROW — reply dispatch branch + override enum + replySlot onFinish
app/[lang]/chat/chat-input.tsx    # GROW — pillarOverride enum + lead-selector flow (D-07)
app/[lang]/chat/chat-header.tsx   # GROW — pillar chip adds "Reply"
app/[lang]/chat/message-list.tsx  # GROW — render reply-draft-card variant
app/[lang]/chat/reply-draft-card.tsx  # NEW — draft card (mirror match-list.tsx)
app/[lang]/(admin)/kb/*           # GROW — pillar filter/tab + category field in form
app/[lang]/(coach)/dashboard/*    # GROW — Reply Quality panel + queries + actions
app/[lang]/(coach)/_components/reply-quality-panel.tsx  # NEW — recharts panel

evals/gold/reply-*.yaml           # NEW — Reply gold sets (EN first; BM/ZH later)
.planning/phases/04-reply-assistant/WABA-GATE.md  # NEW — doc artifact (D-23)
```

### Pattern 1: The agent object shape (mirror Finder exactly)

The Finder exposes a frozen `as const` object. `[VERIFIED: src/agents/finder/index.ts:83-163]`

```typescript
// Source: src/agents/finder/index.ts:83-121 — the shape replyAgent must mirror
export const finderAgent = {
  systemPrompt: FINDER_SYSTEM_PROMPT,
  buildSystemPrompt(options?: { leadContext?: Record<string, unknown> }): string { ... },
  outputSchema: FinderOutputSchema,
  makeTools(userLang: 'en' | 'ms' | 'zh', agentUid?: string, leadId?: string) {
    return { searchProjects: ..., queryInventory: ..., fetchCollateral: ... }
  },
  async run(args: FinderRunArgs): Promise<FinderRunResult> { ... }, // offline/test path
} as const
```

For `replyAgent`, `makeTools` returns `{ retrieveReplySop, fetchVoiceSamples, fetchLeadContext }` and `buildSystemPrompt` accepts `{ replySlot, incoming?, leadId? }`. The `run()` offline path takes an injected SOP-retrieval result (mirror `injectedSearchResult`) so the no-SOP-match refusal gate is unit-testable without Firestore.

### Pattern 2: Read-only tools, slot write in onFinish (Pitfall 23/36)

Finder tools never write Firestore (`tools.ts:4-13`). The `finderSlot` write happens in the route `onFinish` (`route.ts:374-399`), NOT in a tool. Reply MUST do the same — `replySlot` write in `onFinish`. `[VERIFIED: src/agents/finder/tools.ts:76-91, app/api/chat/route.ts:374-399]`

```typescript
// Source: app/api/chat/route.ts:374-399 — the onFinish slot write Reply must mirror
if (pillar === 'finder' && leadId) {
  const newProjectIds = extractFinderProjectIds(final)
  const discussedProjectIds = mergeDiscussed(prevDiscussed, newProjectIds)
  await writeLeadSlot(leadId, 'finderSlot', { criteria, discussedProjectIds, lastRankedAt: Date.now() })
}
// Reply analog: extract SOP doc IDs + classification from `final.steps`, then
// writeLeadSlot(leadId, 'replySlot', { classification, latestDraft, sopDocIds, lastDraftedAt })
```

### Pattern 3: Tool wraps the rag facade (mirror Coach `retrieveKnowledge`)

`retrieveReplySop` is the closest analog to the Coach's `retrieveKnowledge` (`src/agents/coach/tools.ts:89-127`) — a `tool({ inputSchema, execute })` that calls the rag facade and returns `{ found, citations, context }` or `{ found: false, reason: 'no_sop_match' }`. The difference is the pillar/category filter (see Don't-Hand-Roll + the rag gap below).

### Pattern 4: Structured output via `experimental_output` / app-level XOR invariant

Both Coach and Finder define a Zod `OutputSchema` and enforce a cross-field XOR invariant **at the application level** (Zod can't express it cleanly). `[VERIFIED: src/agents/finder/schema.ts:182-212, src/agents/coach/schema.ts:36-60]` Reply's `ReplyOutputSchema` should follow:
- `draft` present (the reply text + `sopDocIds[]`) XOR
- `noSopMatch` present (grounded refusal) XOR
- `clarifyingQuestion` present (e.g., ambiguous inbound)

### Anti-Patterns to Avoid
- **Tool writes** — any `.set()/.add()/.update()` inside a Reply tool `execute()` is a defect (Pitfall 23/36). `[VERIFIED: finder/tools.ts:4-13]`
- **Forking a `/api/reply` endpoint** — D-02 forbids it; extend the existing route.
- **Hard-coding the model ID** — always `modelFor('reply')` (`provider.ts`). QUAL-01 model-swap test must still pass.
- **Streaming from a Server Action** — never; only the Node Route Handler streams (`route.ts:36-65`).
- **Auto-inferring the lead** — D-07: a wrong-lead reply is the worst Reply failure. `leadId` is required and explicit.
- **Burying edits in `messages`** — D-19: queryability matters; `replyEdits` is its own collection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector retrieval | Custom similarity loop | `src/rag` facade + `embedText` (`embed.ts:67`) | Gemini 1024-d + normalized DOT_PRODUCT + lang pre-filter already solved. |
| PII pseudonymization | New redactor | `pseudonymize` + `assertRedacted` (`pdpa.ts`) | The compliance spine. ⚠️ But it needs *extension* (see Pitfall 1) — extend, don't replace. |
| Per-lead memory | New collection | `leadContext/{leadId}` + `writeLeadSlot` (`leadContext.ts:73`) | Slot-scoped isolation already proven for Finder. |
| Intent routing | New router | `routeAsync` + `heuristicPillar` + `classifyIntent` | The `Pillar` type already includes `'reply'` (`heuristic.ts:26`); extend in place. |
| SOP ingestion | New pipeline | `shardJob`/`processBatch` (`pipeline.ts`) | Chunked, idempotent, client-driven poll — Cloud-Run-timeout-safe. |
| Model resolution | Hard-coded ID | `modelFor('reply')` (`provider.ts:70`) | Remote Config; `reply` key already mapped. |
| Audit logging | New writer | `audit.log` hashes-only (`log.ts:76`) via `after()` | Append-only, PII-safe, fire-and-forget. |
| Aggregation counts | Fetch-all-then-count | Firestore aggregation queries (`count()`/`sum()`/`average()`) | Pitfall 9 cost trap; the dashboard already uses server-side scoped reads. |
| Diff/edit distance | A diff dependency | ~15-line core util `src/reply/diff.ts` | No diff lib installed; only a numeric `editRatio` is needed (D-18/D-20). |

**Key insight:** Phase 4 is ~80% reuse. The custom code is narrow: the reply prompt/schema, the pillar-aware retrieval, the `replyEdits` collection + rules + indexes, and the draft-card UX. Everything else is a call into an existing seam.

## Per-Research-Question Findings

### Q1 — Reply agent construction
`finderAgent` builds its prompt via `buildFinderSystemPrompt({leadContext})` (`prompt.ts:49`), tools via `makeTools` returning three read-only `tool({...})` objects (`tools.ts`), validates output with `FinderOutputSchema` (`schema.ts:193`), and has an offline `run()` that exercises the refusal gate with an `injectedSearchResult` (`index.ts:138-162`). The streaming path is owned by the route, which calls `buildSystemPrompt` + `makeTools` + `modelFor` and passes them to `streamText` (`route.ts:304-337`). **Minimal faithful mirror:** copy the four files; rename `searchProjects`→`retrieveReplySop`, drop `queryInventory`/`fetchCollateral`, add `fetchVoiceSamples` + `fetchLeadContext`. Map onto existing seams: `retrieveReplySop`→`src/rag` (pillar-filtered), `fetchVoiceSamples`→a `kbDocs` read (`pillar:'reply', category:'voice'`), `fetchLeadContext`→`readReplySlot(leadId)` (new, mirrors `readFinderSlot` `leadContext.ts:109`).

### Q2 — 3-pillar dispatch (precise diff to `route.ts`)
1. **Body parse:** widen `override` type + validation (`route.ts:191,208-210`):
   ```typescript
   let override: 'coach' | 'finder' | 'reply' | undefined
   override = (['coach','finder','reply'] as const).includes(body.override as ...) ? ... : undefined
   ```
   The validation pattern (invalid values → `undefined`) is the security control (T-03-28) — preserve it exactly. `[VERIFIED: route.ts:206-210]`
2. **Dispatch branch:** add `else if (pillar === 'reply') { ... }` alongside the Finder branch (`route.ts:289-314`), reading `storedReplySlot = await readReplySlot(leadId)` and building the reply prompt + tools.
3. **`stopWhen`:** Reply uses a tool loop (retrieve SOP → maybe voice → draft), so `stepCountIs(5)` like Finder, not `stepCountIs(1)` (`route.ts:337`).
4. **`onFinish` slot write:** add a `pillar === 'reply' && leadId` block mirroring the Finder block (`route.ts:374-399`), calling `writeLeadSlot(leadId, 'replySlot', …)`.
5. **`agentTools` union type** widens to include `ReturnType<typeof replyAgent.makeTools>` (`route.ts:283`).
⚠️ **leadId is currently optional** in the body (`route.ts:213-215`). Reply must enforce it server-side: if `pillar === 'reply'` and no `leadId`, return a 400 (the UI prevents this per D-07, but the server must fail closed — Pitfall 5).

### Q3 — PII boundary (HIGHEST RISK) — ⚠️ MAJOR GAP
The existing GATE 3 (`route.ts:243-265`) calls `pseudonymize({messages}, [])` — note the **empty `names` array**. Reading `pseudonymize` (`pdpa.ts:162-190`): it redacts (a) **only names explicitly passed in the `names[]` argument** via `replaceNames` (`pdpa.ts:110-130`), and (b) **phone numbers** via two regexes — `MY_PHONE_REGEX` and `INTL_PHONE_REGEX` (`pdpa.ts:70-73`). It does **NOT** detect free-text names, addresses, IC numbers, emails, or financial figures.

Consequences for Reply (the heaviest-PII pillar):
- A pasted WhatsApp message like "Hi, this is Ahmad, my IC is 880101-14-5678, I earn RM6000/month, address 12 Jalan Ampang" → **phone is redacted, but the name, IC, income, and address are sent to Claude in plaintext.** `assertRedacted` still returns true because `pdpa_redacted` is hard-coded `true` in `pseudonymize` (`pdpa.ts:187`) — the gate is a *presence* gate, not a *coverage* gate. This is a real PDPA exposure for production Reply turns. `[VERIFIED: pdpa.ts:162-190, route.ts:248-256]`

**What the planner MUST address (Wave-0 blocker):**
1. **Inject known lead names** for the active `leadId`: read `leads/{leadId}.name` (or the agent's downline lead names) and pass them as `names` to `pseudonymize` — the route comment at `route.ts:252` already flags this: *"knownNames — will inject lead names from leadContext when available"*. This is an unfinished hook.
2. **Add free-text PII patterns** to `pdpa.ts` for the Reply paste: Malaysian IC (`\d{6}-\d{2}-\d{4}`), email, RM-amount financials, and a best-effort address heuristic. Pitfall 32 already names the IC regex. This is an *extension* of `pdpa.ts`, not a rewrite (preserve `assertRedacted`'s throw-don't-warn contract `pdpa.ts:205-209`).
3. **Consider tightening the gate semantics:** today `pdpa_redacted` is always `true`. The planner should decide whether to keep the presence-gate (and rely on coverage tests) or make `pdpa_redacted` reflect actual coverage. Given the 16-week timeline, the pragmatic v1 is: presence-gate + a strong known-names injection + IC/email/financial regexes + comprehensive unit tests proving each PII class is tokenized before the model call.

**Tests that MUST exist (security-critical):** for each PII class (name, MY phone, intl phone, IC, email, RM-financial, address), assert the redacted payload passed to `streamText` contains a token, not the raw value. Plus an integration test on the route asserting the `pseudonymize` call receives a non-empty `names[]` for a Reply turn with a `leadId`.

### Q4 — Per-lead isolation
`leadContext/{leadId}` is one doc with three slots; `writeLeadSlot` writes **only the named slot** (+ optional `rollingSummary` + `updatedAt`) — `leadContext.ts:73-92`. Cross-lead bleed is structurally impossible because the doc is keyed by `leadId`. `ReplySlot` (new) mirrors `FinderSlot` (`leadContext.ts:49-60`):
```typescript
export interface ReplySlot {
  classification: 'cold-prospect' | 'objection' | 'financing' | 'other'
  latestDraft: string          // last model draft (already PDPA-redacted)
  sopDocIds: string[]          // SOPs cited in the latest draft (grounding trail)
  lastDraftedAt: number        // Date.now() epoch ms (framework-free, mirrors lastRankedAt)
}
```
Add `readReplySlot(leadId)` mirroring `readFinderSlot` (`leadContext.ts:109-122`) — same empty-object → null semantics. **Route enforces required leadId** per Q2 step 5. ⚠️ Note `LeadContextDoc.replySlot` is typed `Record<string, unknown>` (`collections.ts:126`) — the converter accepts the `ReplySlot` shape via the same cast pattern Finder uses (`route.ts:307`).

### Q5 — Edit-as-signal capture
- **Diff:** no library available; use a core `src/reply/diff.ts` computing `editRatio` (Levenshtein/normalized char-diff) + keep both raw strings (D-18). `[VERIFIED: package.json — no diff dep]`
- **`replyEdits` schema (new):** `{ tenantId, leadId, draftId, sopDocIds: string[], originalDraft, editedFinal, editRatio: number, agentUid, seniorCoachId, lang, thumbsDown?: boolean, timestamp }`. ⚠️ **Add `seniorCoachId`** (denormalized at write time) so the downline-scoped read rule can match `resource.data.seniorCoachId == request.auth.uid` — exactly how `escalations` (`firestore.rules:196-201`) and `knowledgeGaps` (`firestore.rules:231-236`) scope coach reads. Without it, a coach cannot query their downline's edits with a single `where`.
- **Write path:** clients can NOT write `replyEdits` (deny-by-default). The write must go through the Admin SDK — either a **Server Action** invoked by the draft card's Copy handler, or the chat route. Recommendation: a dedicated Server Action `captureReplyEdit(...)` (mirrors `(admin)/kb/actions.ts` and `(coach)/dashboard/actions.ts` session-cookie → `requireUser` pattern, `actions.ts:34-48`). The card's client island calls it on copy.
- **Rules (new, deny-by-default):**
  ```
  match /replyEdits/{eventId} {
    allow read:
      if (resource.data.agentUid == request.auth.uid && sameTenant())                       // agent reads own
      || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant()) // coach reads downline
      || (hasRole('admin') && sameTenant());                                                 // admin reads all
    allow create, update, delete: if false;  // server-side Admin SDK only (append-only)
  }
  ```
  This is the same structure as `escalations`/`knowledgeGaps`. `[VERIFIED: firestore.rules:196-241]`
- **Indexes (new, 3):** `(seniorCoachId, timestamp DESC)` for the coach feed; `(agentUid, timestamp DESC)` for agent self-view; `sopDocIds` is an array field → an `ARRAY_CONTAINS` single-field index suffices for "edits for this SOP" (or a composite `(sopDocIds ARRAY_CONTAINS, timestamp)`). Model these after the existing `knowledgeGaps (seniorCoachId, lastSeenAt DESC)` index (`firestore.indexes.json:108-115`).
- **Aggregation-on-read (D-20):** per-SOP edit-rate = `count(replyEdits where sopDocIds array-contains X) / count(drafts citing X)`. Use Firestore `count()` aggregation (Pitfall 9). ⚠️ The "drafts citing X" denominator isn't naturally captured by `replyEdits` alone (an unedited copy still cites the SOP). Planner decision: either also write a `replyEdits` row on **every** copy (with `editRatio: 0` when unchanged) so the denominator = total copies citing X, or add a lightweight `replyDrafts` counter. Recommendation: write a row on every Copy (D-18 already triggers capture on copy) — `editRatio: 0` rows are the "clean draft" denominator and keep the math a single-collection aggregation.

### Q6 — Voice calibration
- **Source:** a single curated KB doc `pillar:'reply', category:'voice'` (D-12). `fetchVoiceSamples` reads `kbDocs` filtered to that pillar+category (an admin-seeded doc), returning its text into the prompt. ⚠️ This is a `kbDocs` *read*, not a `kbChunks` vector search — the voice doc is fetched whole (it's small), not retrieved by similarity. Implementation: `kbDocsRef().where('pillar','==','reply').where('category','==','voice').where('status','==','published').limit(1)` then read the chunk text via `kbChunksRef().where('docId','==',voiceDocId)`. (Needs a `(pillar,category,status)` composite index — see Environment Availability.)
- **Eval rubric (D-13):** `src/eval/judge.ts` exports a `judgeRubric` object with six domains (`judge.ts:62-142`) and a `combinedJudgeRubric` (`judge.ts:151-176`). Extend by **adding Reply-specific rubric strings** (voiceMatch-vs-curated-doc, qualifyingQuestions, noAutoPitch) and a `combinedReplyJudgeRubric` that reuses `voice` + `toneDrift` + `languageMatch` and adds the new ones. The `grounded` domain's `[KB:chunk-id]` check maps to Reply's `[SOP:doc-id]` citation — adjust the rubric string. The judge model stays Remote-Config-resolved via `JUDGE_MODEL` (`judge.ts:37`, `promptfooconfig.yaml:65`).

### Q7 — Reply SOP KB — ⚠️ MAJOR GAP (kbChunks.pillar)
- `KbDocDoc.pillar` is **already typed** `'coach' | 'finder' | 'reply'` (`collections.ts:278`) and the CRUD + ingest already carry `pillar` through (`crud.ts:64,138`, `pipeline.ts:52,129`). Good.
- ⚠️ **But `KbChunkDoc` has NO `pillar` field** (`collections.ts:282-302`) and `processBatch` writes chunks **without** pillar (`pipeline.ts:210-220`) even though the job doc carries it (`pipeline.ts:181` destructures `lang` but not `pillar` for the chunk write). The retrieval query filters `kbChunks`, not `kbDocs` (`search.ts:97-107`). **So `retrieveReplySop`'s `pillar:'reply'` filter cannot work until `pillar` is denormalized onto `kbChunks`.**
- **Required work:** (1) add `pillar` to `KbChunkDoc`; (2) write it in `processBatch` (`pipeline.ts:210-220`, destructure `pillar` from `jobData` and add `pillar` to the `chunksRef.add({...})`); (3) **backfill** existing chunks — a one-time script setting `pillar:'coach'` on all existing chunks (mirror the documented `scripts/backfill-kb-status.ts` referenced at `search.ts:67`); (4) the D-08 backfill of `kbDocs.pillar` default `'coach'` likely already holds (the field is required and existing docs were written `'coach'`), but verify and backfill any nulls.
- **Retrieval filter change (`search.ts`):** `firestoreRetrieve` is hard-coded for Coach (lang + status, no pillar/category). Options: (a) add optional `opts?: { pillar?, category? }` to `firestoreRetrieve` and thread through the `retrieve` facade (`index.ts:62`), or (b) add a sibling `firestoreRetrieveSop(query, lang, category?)`. Recommendation (a) — parameterize, keep one code path. The query becomes `.where('pillar','==','reply').where('lang','in',[...]).where('status','==','published').findNearest(...)`. ⚠️ This needs a **new composite vector index** `(pillar, lang, status, embedding 1024-d flat)` — Firestore `findNearest` pre-filters are equality-only and must be backed by a matching index (the existing `(lang,status,embedding)` index `firestore.indexes.json:94-107` won't cover the added `pillar` equality).
  - ⚠️ **Category filter caveat:** adding *both* `pillar` and `category` equality pre-filters to `findNearest` would need yet another index `(pillar, category, lang, status, embedding)`. To avoid index sprawl, recommendation: filter by `pillar` (+lang+status) in the `findNearest` pre-filter, then filter by `category` **in memory** after retrieval (categories are few; the top-8 result set is small). This mirrors the Finder's "equality pre-filter + in-memory affordability" pattern (`collections.ts:185-192`).
- **Admin filter UI (D-10):** `(admin)/kb` has `actions.ts` (createDoc/updateDoc), `kb-doc-form.tsx`, `kb-doc-list.tsx`, `page.tsx`. `CreateDocInput` already carries `pillar` (`crud.ts:64`). Growth: add a `category` field to `CreateDocInput`/`UpdateDocInput` + the form, and a pillar filter/tab on the list page. The Server-Action pattern (`(admin)/kb/actions.ts:63-78`) is the template.
- **kb-miss logging (D-11):** Phase-2 already has a `knowledgeGaps` collection + feed (`collections.ts:369`, dashboard `getKnowledgeGaps`). Reply's `no_sop_match` should log to the same path so Derek sees the SOP gap — but ⚠️ the existing knowledge-gap *writer* path is Phase-2 Coach-specific; the planner must confirm whether a `pillar:'reply'` gap variant is needed or whether `knowledgeGaps` is pillar-agnostic (it has no pillar field today — `collections.ts:369-391`). Recommendation: add a `pillar`/`source` discriminator to `KnowledgeGapDoc` or write Reply misses with a `topicLabel` prefix; keep them on the existing feed.

### Q8 — Intent classifier expansion
- **Heuristic (`heuristic.ts`):** add a `REPLY_PATTERNS: RegExp[]` array (e.g., `/\bdraft (a )?repl/i`, `/\breply to (this|him|her|them)\b/i`, /`\bwhat (should|do) i (say|reply)\b/i`, `/\b(lead|client) (said|wrote|sent|asked)\b/i`, a multi-line quoted-block heuristic) and check it in `heuristicPillar` — ⚠️ **ordering matters**: today Finder is checked first (`heuristic.ts:117`). A pasted inbound containing "RM" or "financing" would currently route to Finder (those are Finder patterns `heuristic.ts:58,73`). The planner must decide precedence: Reply-leaning structural signals (inbound block / "reply to this") should likely be checked **before** the generic Finder keyword scan, or Reply turns will mis-route. Also widen the `heuristicPillar` return type from `'coach' | 'finder'` to include `'reply'` (`heuristic.ts:108-109`).
- **Classifier (`classifier.ts`):** widen `RouteSchema` enum `['coach','finder']` → `['coach','finder','reply']` (`classifier.ts:29`), update `classifyIntent`'s return type (`classifier.ts:82-84`), and add a Reply paragraph to `ROUTER_SYSTEM_PROMPT` (`classifier.ts:42-54`). ⚠️ The classifier test asserts the schema *rejects* `'reply'` today (`classifier.test.ts:95`) — that test must be updated. Model stays `modelFor('router')` (Remote Config, `claude-haiku-4-5`).
- **Observability:** `routeDecision` is already recorded on every message (`route.ts:277,347,365`); mis-routes are already eval-visible. The override chip is the correction (D-05). No new seam.

### Q9 — WABA gate
`WABA-GATE.md` is a **doc artifact only** (D-23). Propose initial thresholds (Derek finalizes): edit-rate < X% (e.g., median `editRatio` < 25%) over ≥ Y weeks (e.g., 4) of pilot data; **zero wrong-client incidents**; judge tone PASS rate ≥ 90% (from `evals/` Reply gold-set scores); audit log clean of any `pdpa_redacted:false` (or coverage-test failures); minimum draft volume (e.g., ≥ N drafts/agent/week to have signal). No WABA integration code — any code touching WhatsApp Business API is out of scope (C3, REQUIREMENTS Out-of-Scope WABA-01).

### Q10 — Pitfalls Reply most easily hits
Drawn from `.planning/research/PITFALLS.md` (note the file's legend has P3 = Reply Assistant). The numbering below uses **CONTEXT.md's pitfall references**, which map to PITFALLS.md content as follows:
- **PII leakage (PITFALLS #7 + #32):** see Q3. The boundary gap is real and unfinished. Avoid: inject known names, add IC/email/financial regexes, comprehensive coverage tests. **This is the #1 watch-item.**
- **Sync-path race (CONTEXT "Pitfall 7" / PITFALLS #11/#23 streaming + sync route):** `routeAsync` is the only async router path the route uses (`route.ts:271`); the sync `route()` is preserved for non-awaiting callers (`heuristic.ts:155`). Don't introduce an async dependency into the sync path. Slot writes are in `onFinish` (post-stream), never blocking the stream.
- **Model invents instead of refusing (PITFALLS #2):** `no_sop_match` grounded refusal (D-11) + the `ReplyOutputSchema` XOR invariant + a judge `grounded` assertion that drafts cite real `[SOP:doc-id]`s. Avoid: the prompt must require citing SOP IDs and emit `no_sop_match` when retrieval misses (mirror Coach `kb_miss`, `coach/tools.ts:107-109`).
- **Cross-conversation bleed (PITFALLS #5):** see Q4 — structurally prevented by `leadContext/{leadId}` + required `leadId` + slot-scoped writes. Eval: a parallel-lead test asserting Lead B's draft never references Lead A.
- **Tool-as-write (PITFALLS #23/#36 framing in CONTEXT):** Reply tools read-only; `replySlot` + `replyEdits` written outside tools. Verify: grep Reply tool `execute()` bodies for `.set/.add/.update`.
- **Judge-rubric drift (PITFALLS #28/#29):** extend (don't fork) the judge; add Reply gold sets; keep human-calibration discipline (`evals/CALIBRATION.md`). EN-first (D-14); add BM/中文 gold sets when Derek supplies voice samples.
- **Single-tenant assumption (PITFALLS #6 rules):** every `replyEdits` doc carries `tenantId` (converter stamps it, `collections.ts:423-435`); rules check `sameTenant()`. CI rules test required for the new collection.
- **Pasted-message parsing (PITFALLS #25):** preserve emojis/URLs/voice-note markers in the inbound paste; don't strip them. The reply prompt should treat emojis as signal.

## Common Pitfalls (Phase-4-specific, with prevention)

### Pitfall A: The PDPA gate gives false confidence
**What goes wrong:** `assertRedacted` passes (because `pdpa_redacted` is hard-coded true) while names/IC/financials reach Claude. **Why:** `pseudonymize` only redacts passed-in names + phone regexes (`pdpa.ts:162-190`). **How to avoid:** inject lead names, add free-text PII regexes, write per-PII-class coverage tests. **Warning signs:** a unit test pasting "IC 880101-14-5678" finds the raw IC in the `streamText` `messages` argument.

### Pitfall B: `retrieveReplySop` silently returns Coach chunks (or nothing)
**What goes wrong:** the pillar filter is applied to `kbChunks` but chunks have no `pillar` field → query returns empty (filter excludes everything) or, if the filter is dropped, returns Coach SOPs. **Why:** `pipeline.ts` never writes `pillar` to chunks. **How to avoid:** add `pillar` to `KbChunkDoc` + `processBatch`, backfill, add the `(pillar,lang,status,embedding)` index. **Warning signs:** Reply drafts cite coach onboarding chunks; or every Reply turn emits `no_sop_match` despite seeded SOPs.

### Pitfall C: Reply turn routed to Finder
**What goes wrong:** a pasted inbound mentioning "RM" or "financing" hits Finder keywords first (`heuristic.ts:58,73`). **How to avoid:** check Reply structural patterns before the generic Finder keyword scan, and rely on the override chip + classifier for ambiguity. **Warning signs:** `routeDecision` shows `finder:heuristic-finder:...` on a "draft a reply" message.

### Pitfall D: Coach cannot read downline `replyEdits`
**What goes wrong:** the read rule needs `resource.data.seniorCoachId == request.auth.uid`, but if the writer doesn't denormalize `seniorCoachId`, the rule can't match. **How to avoid:** write `seniorCoachId` onto every `replyEdits` row (look it up from `agentProfiles/{agentUid}.seniorCoachId`). **Warning signs:** rules test for "coach reads own downline edit" fails permission-denied.

### Pitfall E: Aggregation denominator missing
**What goes wrong:** per-SOP edit-rate has no "total drafts citing this SOP" denominator. **How to avoid:** write a `replyEdits` row on every Copy (even unchanged, `editRatio: 0`). **Warning signs:** dashboard shows edit-rate > 100% or NaN.

### Pitfall F: Missing composite index → runtime query failure
**What goes wrong:** the new pillar-filtered `findNearest` and the `replyEdits` coach query throw `FAILED_PRECONDITION: requires an index`. **How to avoid:** add all indexes to `firestore.indexes.json` and deploy before the query ships. **Warning signs:** integration test against the emulator throws an index error.

## Code Examples

### Reply tool: `retrieveReplySop` (mirror Coach `retrieveKnowledge`)
```typescript
// Pattern source: src/agents/coach/tools.ts:89-127 + src/rag/index.ts:62
export function makeRetrieveReplySopTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Search D2 reply SOPs (cold-prospect / objection-handling / financing) for the ' +
      'inbound message. Call BEFORE drafting. Returns SOP IDs you MUST cite. ' +
      'If nothing matches above threshold, return no_sop_match — never invent a SOP.',
    inputSchema: z.object({
      query: z.string().min(1),
      category: z.enum(['cold-prospect','objection-handling','financing']).nullable(),
    }),
    execute: async ({ query, category }) => {
      // pillar-filtered retrieval (new param on the rag facade — Q7)
      const results = await retrieve(query, userLang, { pillar: 'reply' })
      const filtered = category ? results.filter(r => r.category === category) : results
      if (isRetrievalMiss(filtered)) return { found: false, reason: 'no_sop_match' as const }
      const { citations } = buildCitations(filtered)
      const context = filtered.slice(0,5).map(r => `[SOP:${r.docId}]\n${r.text}`).join('\n\n---\n\n')
      return { found: true, citations, context }
    },
  })
}
```

### `ReplySlot` + `readReplySlot` (mirror `FinderSlot` / `readFinderSlot`)
```typescript
// Pattern source: src/memory/leadContext.ts:49-60, 109-122
export interface ReplySlot {
  classification: 'cold-prospect' | 'objection' | 'financing' | 'other'
  latestDraft: string
  sopDocIds: string[]
  lastDraftedAt: number
}
export async function readReplySlot(leadId: string): Promise<ReplySlot | null> {
  const snap = await leadContextRef().doc(leadId).get()
  const slot = snap.data()?.replySlot as Record<string, unknown> | undefined
  if (!slot || Object.keys(slot).length === 0) return null
  return slot as unknown as ReplySlot
}
```

### Override-enum widening (security control preserved)
```typescript
// Source pattern: app/api/chat/route.ts:206-210 — invalid values → undefined
override = (['coach','finder','reply'] as const).includes(body.override as 'coach'|'finder'|'reply')
  ? (body.override as 'coach'|'finder'|'reply')
  : undefined
```

## Runtime State Inventory

Phase 4 is mostly greenfield code, but the `kbChunks.pillar` denormalization is a migration. Categories below:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `kbChunks` documents written by Phase-2/3 ingestion carry **no `pillar` field** (`pipeline.ts:210-220`). After adding the field, existing chunks are un-filterable. | **Data migration:** one-time backfill script stamping `pillar:'coach'` on all existing `kbChunks` (mirror `scripts/backfill-kb-status.ts` referenced at `search.ts:67`). **Code edit:** add `pillar` to `processBatch`'s chunk write so new ingests carry it. |
| Stored data | `kbDocs.pillar` is required + typed (`collections.ts:278`); existing docs were written `'coach'`. D-08 says default `'coach'`. | Verify no null pillars; backfill if any. `category` field is net-new — existing docs have none (treated as absent/optional). |
| Stored data | `leadContext/{leadId}.replySlot` exists as `{}` (empty object) on docs the Finder/Coach touched (converter default). | None — `readReplySlot` treats empty-object as null (first-touch), same as `readFinderSlot` (`leadContext.ts:119`). |
| Live service config | Firebase Remote Config: `model.reply.default` must be seeded by Derek (fallback `claude-sonnet-4-6` exists `provider.ts:42`). `model.router.default` already used. | **Manual (Derek):** confirm `model.reply.default` is set in Remote Config before pilot. Researcher cannot read RC. |
| Live service config | Firestore composite indexes must be **deployed** (`firebase deploy --only firestore:indexes`) — new ones for `(pillar,lang,status,embedding)`, `replyEdits (seniorCoachId,timestamp)`, `(agentUid,timestamp)`, `kbDocs (pillar,category,status)`. | **Manual deploy step** in the plan; queries fail at runtime without them (Pitfall F). |
| OS-registered state | None. | None — no OS-level registrations. |
| Secrets/env vars | No new secrets. `ANTHROPIC_API_KEY` + `GOOGLE_GENERATIVE_AI_API_KEY` already bound (TSD §3.4). | None. |
| Build artifacts | None — TypeScript only, no compiled packages. | None. |

**The canonical question — after every file is updated, what runtime systems still hold old state?** Only `kbChunks` (needs the pillar backfill) and Remote Config (needs `model.reply.default` confirmed). Everything else is code or new collections.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `toDataStreamResponse()` (TSD §3.4 text) | `toUIMessageStreamResponse()` | ai@5.0.x | Reply reuses the verified method (`route.ts:433`); do NOT use the TSD's name. |
| Voyage embeddings / QStash scheduler (Phase-1 docs) | Gemini `gemini-embedding-001` @1024-d + on-visit lazy-cron | 2026-06-01 override | Reply SOPs use Gemini; `eval-nightly` is a lazy-cron job (`runDueJobs.ts:199-205`), not external cron. |
| Per-user voice fingerprint (TSD §6, PITFALLS #12) | Curated org-voice doc for v1 (D-12) | Phase-4 CONTEXT | `users.voiceSamples[]` stays reserved/deferred; voice = one curated KB doc. |

**Deprecated/outdated for this phase:**
- `middleware.ts` → `proxy.ts` (Next.js 16; not touched in Phase 4 but a hard project rule).
- Synchronous `cookies()`/`headers()` → must be awaited (the Server-Action pattern in `(admin)/kb/actions.ts:34` and `(coach)/dashboard/actions.ts:39` already does this — copy it).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `scripts/backfill-kb-status.ts` script referenced in `search.ts:67` exists and is the pattern for the new `kbChunks.pillar` backfill. | Q7 / Runtime State | LOW — if absent, write a new backfill script following the same shape; the migration is still required. |
| A2 | Writing a `replyEdits` row on **every** Copy (incl. unchanged, `editRatio:0`) is the right denominator for edit-rate. | Q5 / Pitfall E | MEDIUM — alternative is a separate counter; planner should confirm with the dashboard math. Affects write volume + aggregation cost. |
| A3 | `knowledgeGaps` can absorb Reply `no_sop_match` events (it has no pillar field today). | Q7 (D-11) | MEDIUM — may need a `pillar`/`source` field on `KnowledgeGapDoc` to separate Coach vs Reply gaps on the feed. |
| A4 | Filtering `category` in memory (after `pillar`-filtered `findNearest`) is acceptable for v1 (few categories, small top-K). | Q7 | LOW — if SOP volume grows, add a `(pillar,category,...)` index later. |
| A5 | The presence-gate semantics of `pdpa_redacted` (always true) are acceptable for v1 if coverage is proven by tests + known-name injection + IC/email/financial regexes. | Q3 / Pitfall A | HIGH — this is a compliance decision. Derek/legal should confirm the v1 PDPA posture for Reply pastes. The TIA (FND-09) must cover free-text WhatsApp pastes specifically. |
| A6 | The Reply heuristic should be checked before the generic Finder keyword scan to avoid mis-routes on "RM"/"financing" pastes. | Q8 / Pitfall C | MEDIUM — ordering is a routing-quality decision; the override chip + classifier are the safety net. Validate with router gold sets. |
| A7 | `model.reply.default` is (or will be) seeded in Remote Config by Derek. | Runtime State | LOW — fallback `claude-sonnet-4-6` exists (`provider.ts:42`), so it degrades gracefully; but production should set it explicitly. |

## Open Questions (RESOLVED)

> Resolved during Phase-4 planning + the plan-checker revision (2026-06-05). Each item below carries an inline resolution; no open items remain for planning.

1. **PDPA v1 posture for free-text pastes** — RESOLVED.
   - Resolution: v1 ships **regex coverage + known-name injection** (NOT NER). Plan 02 adds IC (`\d{6}-\d{2}-\d{4}`) / email / RM-financial regexes to `pdpa.ts`; Plan 06 injects lead names into the GATE-3 `pseudonymize` call (closing the `names:[]` hook); Plan 01 carries per-PII-class RED coverage tests. The **FND-09 TIA covers WhatsApp paste content** for Reply, with Derek/legal sign-off noted as a manual gate. NER-based redaction is deferred to Phase-5 hardening (not v1).

2. **kb-miss feed integration for Reply** — RESOLVED (now planned).
   - Resolution: Reply `no_sop_match` **reuses the existing `knowledgeGaps` feed** via the Coach `recordKnowledgeGap` primitive (PDPA-safe topicHash/topicLabel). Plan 03 adds an OPTIONAL `KnowledgeGapDoc.pillar?: 'coach'|'reply'` discriminator (absent ⇒ coach, so Phase-2 rows are unchanged); Plan 06's route `onFinish` calls `recordKnowledgeGap({..., pillar:'reply'})` on a Reply miss (outside any tool); Plan 01 asserts the write with a RED route test. Derek sees Reply SOP gaps tagged distinctly on the existing dashboard feed — no separate surface.

3. **Edit-rate denominator** — RESOLVED.
   - Resolution: **row-on-every-copy** (single-collection aggregation). Plan 07's `captureReplyEdit` writes one `replyEdits` row on every Copy (editRatio:0 when unchanged) so the per-SOP edit-rate denominator = total copies citing that SOP. No separate draft counter.

4. **Thumbs-down capture surface (ADMIN-06)** — RESOLVED.
   - Resolution: a **distinct thumbs-down feedback control on the draft card** (NOT a send affordance — checker-confirmed it does not violate HR-1/D-16, since "exactly one action" governs the SEND/egress path, and feedback is not a send). Plan 08 renders an icon-only ghost `ThumbsDown` button (separate `data-testid`, distinct from the Copy CTA) that calls `captureReplyEdit({..., thumbsDown:true})`; Plan 07's `ReplyEditDoc`/action already carries the optional `thumbsDown` field; Plan 01 carries a RED `captureReplyEdit` test asserting the `thumbsDown:true` write — so Plan 10's `count(thumbsDown==true)/count(all)` KPI has a guaranteed producer (closing the prior ADMIN-06 BLOCKER).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vercel AI SDK `ai` | streaming, tools, generateObject | ✓ | 5.0.193 | — |
| `@ai-sdk/anthropic` | Claude via modelFor | ✓ | 2.0.80 | — |
| `@ai-sdk/google` | Gemini embeddings | ✓ | 2.0.74 | — |
| `firebase-admin` | Firestore Admin SDK | ✓ | 13.10.0 | — |
| `recharts` | dashboard panel | ✓ | 3.8.0 | — |
| `zod` | schemas | ✓ | 4.4.3 | — |
| Diff library | edit-signal diff (D-18) | ✗ | — | Core util `src/reply/diff.ts` (no dep needed) |
| Firebase Remote Config `model.reply.default` | model resolution | ? (RC — not readable here) | — | Fallback `claude-sonnet-4-6` (`provider.ts:42`) |
| Firestore composite indexes (new) | pillar-filtered findNearest + replyEdits queries | ✗ (must be added + deployed) | — | None — queries fail without them |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `ANTHROPIC_API_KEY` | embed / model | ✓ (Secret Manager) | — | — |

**Missing dependencies with no fallback (block execution):**
- New Firestore composite indexes (`(pillar,lang,status,embedding)`, `replyEdits` ×2–3, `kbDocs (pillar,category,status)`) — must be authored in `firestore.indexes.json` and deployed before the queries run.

**Missing dependencies with fallback:**
- Diff library → tiny core util (recommended; avoids a new dependency).
- `model.reply.default` → graceful fallback to `claude-sonnet-4-6`; Derek should set it for production.

## Validation Architecture

`workflow.nyquist_validation: true` (`.planning/config.json`) — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Unit/Integration | **Vitest** `^3` — config `vitest.config.ts` (node env, includes `src/**/*.test.ts`, `tests/**/*.test.ts`, `app/**/*.test.ts`) `[VERIFIED: vitest.config.ts:1-16]` |
| Rules tests | **`@firebase/rules-unit-testing`** `^5.0.1` — `src/firebase/__tests__/rules/rules.test.ts` (+ `rules-helpers.ts`); run via `npm run test:rules` `[VERIFIED: package.json, src/firebase/__tests__/rules/]` |
| E2E | **Playwright** `^1.60` — config `playwright.config.ts`; run via `npm run test:e2e` `[VERIFIED: package.json, playwright.config.ts]` |
| Evals | **Promptfoo** (Opus-4.7 judge via `JUDGE_MODEL` from Remote Config) — config `evals/promptfooconfig.yaml`; run via `npm run eval` `[VERIFIED: promptfooconfig.yaml, package.json]` |
| Quick run command | `npm run test` (= `vitest run`) — all unit/integration, offline (no live API) |
| Full suite command | `npm run test && npm run test:rules && npm run typecheck && npm run lint` (e2e + eval are gated by API keys / live server) |

**Estimated runtime:** `vitest run` over the current `src/**/*.test.ts` suite (~12 test files incl. large ones like `route.test.ts` 35KB, `memory.test.ts` 25KB) is on the order of seconds-to-low-tens-of-seconds offline (mocked AI SDK + Admin SDK). Rules tests require the Firestore emulator. `[ASSUMED: runtime estimate — not measured this session]`

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPLY-01 | Reply SOP retrievable, pillar-filtered | integration (mock Firestore) | `npx vitest run src/rag/rag.test.ts` (extend) + `src/kb/kb.test.ts` (pillar on chunk) | ❌ Wave 0 (extend existing) |
| REPLY-02 | Paste → grounded draft | unit | `npx vitest run src/agents/reply/reply.test.ts` | ❌ Wave 0 (new, mirror `finder.test.ts`) |
| REPLY-03 | Per-lead isolation (no bleed) | unit + integration | `npx vitest run src/memory/memory.test.ts` (readReplySlot) + route test parallel-lead | ❌ Wave 0 |
| REPLY-04 | Draft + copy-only, never auto-send | e2e | `npx playwright test tests/e2e/reply-draft.spec.ts` | ❌ Wave 0 |
| REPLY-05 | Cold-prospect → qualifying questions | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` (live; gated) | ❌ Wave 0 (gold set) |
| REPLY-06 | Objection-handling draft | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` | ❌ Wave 0 |
| REPLY-07 | Financing draft from SOP | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` | ❌ Wave 0 |
| REPLY-08 | Tone calibration vs voice doc | promptfoo-eval | `npm run eval -- --filter-pattern "reply"` (voiceMatch rubric) | ❌ Wave 0 |
| REPLY-09 | Edit capture → replyEdits row | unit + integration | `npx vitest run app/api/chat/route.test.ts` (or action test) + `src/reply/diff.test.ts` | ❌ Wave 0 |
| REPLY-10 | 3-pillar routing | unit | `npx vitest run src/router/heuristic.test.ts src/router/classifier.test.ts` (extend) | ⚠️ exists, must extend (`classifier.test.ts:95` asserts reply rejected — update) |
| REPLY-11 | Reply analytics dashboard | unit + e2e | `npx vitest run app/.../dashboard` queries + `playwright test` | ❌ Wave 0 |
| REPLY-12 | WABA gate documented | manual-only | review `.planning/phases/04-reply-assistant/WABA-GATE.md` | ❌ Wave 0 (doc) |
| ADMIN-05 | Reply SOP management (pillar filter) | unit + e2e | `npx vitest run src/kb/kb.test.ts` + `playwright test tests/e2e/kb-admin.spec.ts` | ❌ Wave 0 |
| ADMIN-06 | Feedback-loop visibility (aggregation) | integration | `npx vitest run` dashboard aggregation query test | ❌ Wave 0 |
| QUAL-02 | Copy-only / disclosure (no auto-send) | e2e | `npx playwright test` (assert NO send/share affordance on draft card) | ❌ Wave 0 |
| (security) | `replyEdits` deny-by-default + downline read | rules-test | `npm run test:rules` (add replyEdits cases) | ⚠️ extend `rules.test.ts` |
| (security) | PDPA coverage for Reply pastes | unit | `npx vitest run src/audit/pdpa.test.ts` (add IC/email/financial/known-name cases) | ⚠️ extend `pdpa.test.ts` |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` (e.g., `src/agents/reply/reply.test.ts`) + `npm run typecheck`.
- **Per wave merge:** `npm run test && npm run test:rules && npm run lint`.
- **Phase gate:** full offline suite green + a live Promptfoo Reply gold-set run (≥90% tone PASS, EN) + the PDPA coverage suite green before `/gsd-verify-work`.

### Manual-only behaviors (and why)
- **Live Promptfoo Reply evals** — require `ANTHROPIC_API_KEY` + `JUDGE_MODEL` from Remote Config + seeded Reply SOPs in a live Firestore (`promptfooconfig.yaml:86-99` documents the live-pilot-gating). Cannot run in offline CI.
- **Real-device copy-to-clipboard** — clipboard behavior on a real phone (the 11pm scenario) is a manual smoke test; Playwright can assert the button + clipboard API call but not real WhatsApp paste.
- **BM/中文 voice nuance** — D-14: EN-first; trilingual voice quality is a human-calibration judgment (`evals/CALIBRATION.md`), not an automated assertion, until Derek provides samples.
- **WABA gate review** — a doc; reviewed by Derek.

### Wave 0 Gaps
- [ ] `src/agents/reply/reply.test.ts` — covers REPLY-02/05/06/07/11 (mirror `finder.test.ts`)
- [ ] `src/reply/diff.test.ts` — covers REPLY-09 editRatio
- [ ] Extend `src/audit/pdpa.test.ts` — IC, email, RM-financial, known-name injection coverage (security-critical, Pitfall A)
- [ ] Extend `src/router/heuristic.test.ts` + `classifier.test.ts` — REPLY-10 (and fix `classifier.test.ts:95` reply-rejection assertion)
- [ ] Extend `src/firebase/__tests__/rules/rules.test.ts` — `replyEdits` deny-by-default + agent/coach/admin read scoping
- [ ] Extend `src/rag/rag.test.ts` + `src/kb/kb.test.ts` — pillar filter + `kbChunks.pillar` write/backfill
- [ ] `app/api/chat/route.test.ts` — add reply-dispatch + replySlot-onFinish + required-leadId-400 + parallel-lead-isolation cases (extend the 35KB existing file)
- [ ] `evals/gold/reply-*.yaml` — Reply gold sets (EN; BM/ZH later) + register in `promptfooconfig.yaml`
- [ ] `tests/e2e/reply-draft.spec.ts` — copy-only, no-auto-send, lead-selector (D-07) e2e

## Security Domain

`security_enforcement` is absent from `.planning/config.json` → treated as **enabled**. This phase routes the heaviest-PII payloads of the project.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireUser` Bearer-token gate (`auth.ts:96`); GATE 1 on the route (`route.ts:148-166`). |
| V3 Session Management | yes | Firebase ID tokens; Server Actions read `__session` cookie → `requireUser` (`(coach)/dashboard/actions.ts:39-52`). |
| V4 Access Control | yes | Firestore deny-by-default rules + custom claims; `replyEdits` downline scoping mirrors `escalations`/`knowledgeGaps` (`firestore.rules:196-241`); CI rules tests. |
| V5 Input Validation | yes | Zod tool/output schemas; override-enum allow-list (`route.ts:206-210`); leadId validation. |
| V6 Cryptography | yes | `crypto.sha256` for phone/audit hashing (`pdpa.ts:80`, `log.ts:48`) — never hand-rolled. |
| V7 Error Handling / Logging | yes | Audit log stores **hashes only** (`log.ts`); no PII/token logging (CLAUDE.md). |
| V9 Data Protection (PDPA) | yes (load-bearing) | `pseudonymize` + `assertRedacted` boundary gate (`pdpa.ts`) — ⚠️ needs extension for free-text pastes (Pitfall A). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PII (name/IC/financial) in a WhatsApp paste reaches Claude unredacted | Information Disclosure | Extend `pseudonymize` (known-name injection + IC/email/financial regexes); per-PII-class coverage tests (Pitfall A / Q3). |
| Wrong-lead reply (cross-lead bleed) | Information Disclosure / Tampering | Required explicit `leadId` (D-07, server fail-closed); slot-scoped `leadContext` writes; parallel-lead eval (Q4). |
| Client writes a forged `replyEdits` row | Tampering / Repudiation | Rules `create,update,delete: if false`; server-only Admin SDK write; append-only (Q5/D-19). |
| Coach reads another coach's downline edits | Information Disclosure | Rule `seniorCoachId == request.auth.uid` + denormalized `seniorCoachId` on write (Pitfall D). |
| Override-chip injection (`override: 'admin'`) | Tampering | Allow-list validation → invalid values become `undefined` (`route.ts:206-210`); preserve exactly when widening to `reply`. |
| Model invents SOP content | Spoofing (content) | Grounding mandate: `no_sop_match` + cite real `[SOP:doc-id]` + judge `grounded`/`hallucination` assertions. |
| PII in eval gold sets committed to Git | Information Disclosure | Synthetic-only Reply gold sets (PITFALLS #32); CI PII scan for MY phone / IC regexes. |
| Cross-tenant `replyEdits` access | Information Disclosure | `tenantId` stamped by converter (`collections.ts:423-435`) + `sameTenant()` rule. |

## Sources

### Primary (HIGH confidence — repo code, cited file:line)
- `app/api/chat/route.ts` — GATE ordering, 2-pillar dispatch, onFinish slot write, PDPA gate call (names=[])
- `src/agents/finder/{index,prompt,schema,tools}.ts` — the agent shape Reply mirrors
- `src/agents/coach/tools.ts` — `retrieveKnowledge` (the `retrieveReplySop` analog)
- `src/router/{heuristic,classifier,index}.ts` — routing (Pillar already includes 'reply'; classifier excludes it)
- `src/memory/leadContext.ts` — slot writer + FinderSlot/readFinderSlot
- `src/audit/{pdpa,log,index}.ts` — pseudonymize coverage gap + hashes-only audit
- `src/rag/{search,embed,index,pinecone}.ts` — retrieval contract (no pillar/category filter today)
- `src/kb/{crud,ingest/pipeline}.ts` — pillar carried on docs+jobs but NOT on chunks
- `src/firebase/collections.ts` — KbChunkDoc lacks pillar; LeadContextDoc.replySlot declared; KbDocDoc.pillar typed
- `src/eval/{judge,runNightly}.ts` + `evals/promptfooconfig.yaml` — judge rubric extension point
- `src/jobs/runDueJobs.ts` — eval-nightly lazy-cron job
- `firestore.rules` + `firestore.indexes.json` — deny-by-default patterns + existing indexes
- `src/llm/provider.ts` — modelFor('reply') already mapped
- `app/[lang]/chat/{chat-input,chat-header,match-list,message-list}.tsx` + `chat-shell.tsx` — UI surfaces to grow
- `app/[lang]/(admin)/kb/actions.ts` + `app/[lang]/(coach)/dashboard/{page,actions}.ts` — Server-Action + downline-read patterns
- `vitest.config.ts`, `playwright.config.ts`, `package.json` — test framework + commands
- `.planning/config.json` — nyquist_validation true; stack constraints
- `.planning/TSD.md` §3.3 (Reply flow), §3.4 (exec model), §5.3 (PDPA), §6 (voice fingerprint), §8 (eval), §11 (Phase-4 row)
- `.planning/research/PITFALLS.md` — Reply pitfalls (#2, #5, #7, #12, #25, #32; #6/#9/#23 infra)

### Secondary (MEDIUM confidence)
- `.planning/phases/04-reply-assistant/04-CONTEXT.md` — the 23 locked decisions (authoritative for intent)
- `.planning/REQUIREMENTS.md` — REPLY-01..12, ADMIN-05/06, QUAL-02

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Existence of `scripts/backfill-kb-status.ts` (referenced, not read this session) — A1
- Vitest runtime estimate — not measured

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions from installed `package.json`; no new deps.
- Architecture (agent mirror + dispatch): HIGH — Finder is a complete, working template cited line-by-line.
- Pitfalls: HIGH — the PDPA gap and `kbChunks.pillar` gap are verified in code, not inferred.
- PDPA v1 posture (A5): MEDIUM — the *gap* is HIGH-confidence verified; the *right v1 fix* is a Derek/legal decision.
- Analytics aggregation denominator (A2): MEDIUM — a design choice the planner must lock.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable repo; re-verify if `route.ts`, `pdpa.ts`, `search.ts`, or `pipeline.ts` change before planning)
