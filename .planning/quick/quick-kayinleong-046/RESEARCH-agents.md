# RESEARCH-agents — quick-kayinleong-046

Read-only investigation of the three linked chat defects (A: JSON envelope leak,
B: `kb_miss` on core onboarding content, C: router misclassification).

All three screenshots are explained by **one shared architectural flaw**: the
server's real routing decision is never sent to the client, and the client
substitutes the *manual override chip* for it. That single substitution produces
both the raw-JSON render (A) and the Finder-answers-a-coaching-question (C).

Hard constraints respected throughout: model IDs stay in Firestore
`appConfig/modelConfig` (`modelFor()`); grounding stays mandatory (citations are
never synthesised); `searchProjects` keeps its `status:'active'` filter; Reply
keeps emitting `no_sop_match`; the router's LLM-classifier seam is reused, not
replaced.

---

## Defect A — structured-output envelope leaking into the rendered message

### Root cause

Three independent facts combine. Each alone is survivable; together they render
raw JSON.

**A1. The Coach prompt demands a JSON envelope, but the model is called in
free-form text mode.**

`src/agents/coach/prompt.ts:79-84`

```
## Output format
Return a JSON object matching the CoachOutput schema:
- answer: your response (citing chunk IDs inline as [KB:chunk-id])
- citations: array of { chunkId } objects for every chunk referenced
- handoff (optional): include { reason: "kb_miss" } ONLY when retrieveKnowledge returns no results
```

`src/agents/coach/schema.ts:46-60` defines `CoachOutputSchema` and its docblock
(`src/agents/coach/schema.ts:6-8`) says it "is used with `experimental_output` in
streamText for structured output parsing in Phase 2".

It is not. `app/api/chat/route.ts:494-509`:

```ts
const result = streamText({
  model,
  system: agentSystemPrompt,
  messages: redactedMessages,
  tools: agentTools,
  stopWhen: stepCountIs(5),
  onFinish: async (final) => {
```

No `experimental_output`, no `Output.object({ schema })`, no `streamObject`.
`CoachOutputSchema` is imported by `src/agents/coach/index.ts:28` and used only
inside `coachAgent.run()` (`src/agents/coach/index.ts:142-171`), which is the
**offline/test path** — the streaming route never calls `run()`. So the schema
constrains nothing at runtime.

Consequence: the model is free-form. It satisfies the prompt by *narrating* the
envelope — chat preamble, then a fenced JSON blob, then a prose restatement.
That is exactly the three-part shape in screenshots 1 and 3.

**A2. The stream is piped through verbatim.** `app/api/chat/route.ts:686-691`
returns `result.toUIMessageStreamResponse(...)`, i.e. raw `text-delta` chunks.
`app/[lang]/chat/decode-stream-chunk.ts:20-35` (`parseTextDelta`) concatenates
every `delta` into `assistantContent` unchanged
(`app/[lang]/chat/chat-input.tsx:273-283`). `answer` is never extracted anywhere
on the wire.

**A3. The client-side decoder does not cover the Coach — and is gated on the
wrong signal.**

`app/[lang]/chat/decode-structured-output.ts:17-18` imports only
`ReplyOutputSchema` and `FinderOutputSchema`. There is **no `decodeCoachOutput`**
and no `CoachOutputSchema` import. The only two decoders are
`decodeReplyOutput` (:55) and `decodeFinderOutput` (:72).

Worse, `app/[lang]/chat/chat-input.tsx:294-320` gates decoding on the *client's
manual chip*, not the server's decision:

```ts
// Gated by pillarOverride — the UI reaches Reply/Finder only via the header chip
if (pillarOverride === 'reply') { ... }
else if (pillarOverride === 'finder') { ... }
```

That comment is a false assumption. In **Auto mode `pillarOverride` is
`undefined`** (`app/[lang]/chat/chat-shell.tsx:71`), while the server still
routes to `finder`/`reply` via `routeAsync` (`app/api/chat/route.ts:388-392`).
So in Auto mode *no pillar decodes at all* — Finder and Reply leak raw JSON too,
not just the Coach.

With no decoder hit, `app/[lang]/chat/message-list.tsx:152` falls through to
`<MarkdownMessage content={msg.content} />`, and
`app/[lang]/chat/markdown-message.tsx:85-87` hands the raw text to
`ReactMarkdown` with `remarkGfm`.

The server *does* know the answer: `routeDecision` is computed at
`app/api/chat/route.ts:392-394` and persisted onto the message doc
(`:519`, `:537`) — but it is never emitted on the stream.

### Why the screenshot looks like that

- **"Let me pull up the Meta ads playbook…"** — free-form model chat, unconstrained
  because A1 left the envelope as prose instruction rather than a decoding schema.
- **The visible ```json fence and raw `{answer, citations, handoff}`** — A2 streamed
  it and A3 never decoded it (Auto mode ⇒ `pillarOverride === undefined` ⇒ no
  branch taken ⇒ raw markdown bubble).
- **The `---` inside a monospace code block** — a fence-pairing off-by-one, not a
  renderer bug. The model opened the fence **mid-line**
  (`…at the same time!```json`), and CommonMark only recognises a fence opener at
  the *start* of a line. So that ` ``` ` is literal text, and the model's
  *closing* ` ``` ` — which *is* at line start — becomes an **opening** fence.
  Everything after it (the `---` separator, until the next backtick run) is
  swallowed into a `<pre>`. `markdown-message.tsx:62` has a perfectly good `hr`
  renderer that never gets a chance to fire.
  Contributing detail: `src/agents/coach/tools.ts:118` (and `:238`) joins
  retrieved chunks with `'\n\n---\n\n'`, so `---` is a separator the model has
  been primed to echo between sections.
- **The duplicate prose answer** — the model wrote the envelope *and* a
  human-readable version, because nothing told it the envelope was the sole
  deliverable.

### Fix plan (minimal, concrete)

1. **Emit the server's pillar to the client.** Add the pillar to the stream (e.g.
   `messageMetadata` on `toUIMessageStreamResponse`, or a response header read in
   `chat-input.tsx`) sourced from the existing `decision.pillar`
   (`app/api/chat/route.ts:392`). Do not recompute on the client.
2. **Gate decoding on that pillar, not on `pillarOverride`.** Replace the
   `pillarOverride === 'reply' | 'finder'` conditions at
   `app/[lang]/chat/chat-input.tsx:294,311` with the server-reported pillar. This
   alone fixes Auto-mode Finder/Reply leakage.
3. **Add `decodeCoachOutput`** to `app/[lang]/chat/decode-structured-output.ts`,
   reusing the existing `extractJsonObject` helper (:25) and
   `CoachOutputSchema` from `src/agents/coach/schema.ts`. On success render
   `output.answer` (+ citation chips from `output.citations`); on `handoff` render
   the miss copy. Preserve grounding: render citations from the decoded
   `citations` array / the `citations` already persisted at
   `app/api/chat/route.ts:529-536` — never fabricate.
4. **Constrain the model so the envelope stops being prose.** Either
   (a) attach the schema to the existing `streamText` call via
   `experimental_output` / `Output.object({ schema: CoachOutputSchema })` in
   `app/api/chat/route.ts:494` — which is what `schema.ts:6-8` already promises —
   or (b) if streaming a partial object is undesirable, tighten
   `src/agents/coach/prompt.ts:79-84` to "return **only** the JSON object, no
   preamble, no code fence, no restatement". Prefer (a): it makes A3 a pure
   render concern and kills the fence entirely.
   Keep `modelFor(pillar)` (`app/api/chat/route.ts:485`) untouched — no
   hard-coded model IDs.
5. **Defence in depth (cheap):** if the decoded text still contains a fence,
   strip it before `MarkdownMessage`. `extractJsonObject`
   (`decode-structured-output.ts:29-32`) already tolerates fences; reuse it
   rather than adding a second stripper.

### Regression surface

- `app/[lang]/chat/chat-input.tsx` decode gating — **this is the risky hunk.**
  Switching from `pillarOverride` to the server pillar means Reply/Finder cards
  now render in Auto mode where they previously never did. Verify
  `ReplyDraftCard` and `MatchList` tolerate a turn with no chip pinned, and that
  `replyLeadId`/`replyLang` (:304-305) are still populated correctly.
- The `clarifyingQuestion` cross-render hazard called out at
  `decode-structured-output.ts:12-15` and `chat-input.tsx:292-293` — the old
  `pillarOverride` gate was the guard. The new gate must be equally exclusive
  (`if/else if` on the server pillar, never a "try all decoders" fallback), or a
  Reply turn can render as a Finder card.
- Adding `experimental_output` changes the shape of the `onFinish` payload.
  `extractCitationChunkIds` (`app/api/chat/route.ts:61-83`),
  `extractFinderProjectIds` (:100), `extractReplySopIds` (:140) and
  `replyHadNoSopMatch` (:184) all walk `final.steps[*].toolResults`, and
  `final.text` is persisted at `:535` and used as the Reply draft at `:582`.
  Confirm `steps`/`text` survive structured-output mode, or citations, the
  `knowledgeGaps` row, `usageEvents` and the Reply slot all silently degrade.
- `stopWhen: stepCountIs(5)` (:509) — quick-043 fixed a `stepCountIs(1)`
  regression that emptied Coach responses. Do not touch it.
- Tests: `app/[lang]/chat/decode-structured-output.test.ts`,
  `app/[lang]/chat/decode-stream-chunk.test.ts`,
  `app/[lang]/chat/markdown-message.test.ts`, `app/api/chat/route.test.ts`.
- `isHandoffChunk` (`decode-stream-chunk.ts:41-43`) does a raw substring match on
  `'kb_miss' | 'handoff'`. Once the envelope is no longer streamed as literal
  text, **this detector stops firing** and the D-10 toast
  (`chat-input.tsx:322-326`) goes silent. Re-source it from the decoded
  `handoff` field or from stream metadata in the same change.

---

## Defect B — `kb_miss` on core onboarding content

**Verdict: (i) a genuinely empty KB — specifically, zero `pillar:'coach'`
content was ever ingested.** The retrieval implementation is sound. This is a
data-loading gap, not a `findNearest` bug. Two latent retrieval bugs are noted
below because they will bite immediately *after* the KB is populated.

### Root cause

**B1. The retrieval path is correct.** `src/rag/search.ts:132-148`:

```ts
let baseQuery = adminDb
  .collection('kbChunks')
  .where('lang', 'in', langFilter)
  .where('status', '==', 'published')
...
const snap = await baseQuery.findNearest({
  vectorField: 'embedding',
  queryVector: FieldValue.vector(q),
  limit: FIND_NEAREST_LIMIT,
  distanceMeasure: 'DOT_PRODUCT',
}).get()
```

- Dimensionality is **consistent by construction**: both the ingest path
  (`src/kb/ingest/pipeline.ts:201-207`) and the query path
  (`src/rag/search.ts:116`) call the *same* `embedText`
  (`src/rag/embed.ts:67-94`), which pins `outputDimensionality: EMBED_DIM`
  (=1024, `embed.ts:31,80`) and L2-normalises (`embed.ts:93`, `:100-104`).
- The composite vector index backing this exact shape exists:
  `firestore.indexes.json:86-100` (`lang` + `status` + `embedding` 1024-d flat),
  plus `:110-124` for the pillar-filtered variant.
- `src/kb/ingest/pipeline.ts:216-223` stamps `lang`, `pillar`, `tenantId` and
  `status:'published'` on every chunk. `src/kb/crud.ts:149` stamps
  `status:'published'` on the parent `kbDoc`.
- **There is no `distanceThreshold`.** With `limit: 8` and no threshold,
  `findNearest` returns up to 8 neighbours *whenever the pre-filter set is
  non-empty*, regardless of relevance. Therefore an empty result — the only thing
  that produces `{found:false, reason:'kb_miss'}` at
  `src/agents/coach/tools.ts:107-109` via `isRetrievalMiss` — means **the
  pre-filtered candidate set is literally empty**. Relevance cannot cause this.

**B2. No coach-pillar content was ever loaded — this is the actual cause.**

The two untracked ETL loaders hard-code the wrong pillar for *everything* they
ingest:

`scripts/scrape-skool/to-kb.ts:157`

```ts
const res = await createDoc(ADMIN, { title, content: text, lang: "en", pillar: "finder", category: project || undefined });
```

`scripts/scrape-skool/to-kb-ocr.ts:129` is identical (`pillar: "finder"`). Both
ingest **Google-Drive project collateral**, not training material.

The committed record confirms nothing else filled the gap: quick-kayinleong-039
(`.planning/quick/quick-kayinleong-039/CLAIM.md`) imported "**82 `projects` +
246 `collateral` docs**" — the `projects`/`collateral` collections, **not**
`kbDocs`/`kbChunks`.

And what little did reach `kbChunks` was deleted.
`scripts/scrape-skool/kb-cleanup.ts:1-5`:

```
Cleanup for quick-kayinleong-039: delete orphaned kbDocs (status "partial" in the
ledger — created by createDoc but never embedded because the Gemini key was invalid).
Deletes the kbDoc, its ingestion job, and any stray chunks
```

That matches the recorded `llm-scripts-base-url-model-gotcha` memory (invalid
key / model 404 from scripts). `to-kb.ts:154-168` only marks a ledger entry
`"ingested"` after `processBatch` drains; anything that died mid-run stayed
`"partial"` and was then hard-deleted by `kb-cleanup.ts:26-36`. No
`drive-kb-ledger.json` survives in the repo, consistent with a wiped/never-completed
load.

**B3. The journey config points at KB docs that do not exist.**
`src/coach/journey/config.ts:9` says so outright: "kbDocIds[] are KB document
references — **placeholder IDs**". The onboarding checkpoints reference
`'kb-coach-meta-ads-playbook-en'` (`:138`) and
`'kb-coach-first-meta-ad-walkthrough-en'` (`:154`) — precisely the two documents
screenshot 1 asked for. Nothing ever created them.

`getCheckpointContent` (`src/agents/coach/tools.ts:194-232`) does not fetch those
IDs; it only checks `kbDocIds.length === 0` (`:213`) then re-queries semantically
(`:223-224`). So the placeholders don't *cause* the miss, but they mean the
checkpoint content genuinely has no backing document.

### Answers to the two specific questions asked

- **Would a mismatched `outputDimensionality` silently return zero neighbours?**
  **No — it fails loudly, and it cannot happen here.** `src/rag/embed.ts:86-90`
  throws `Gemini returned unexpected embedding dimension: expected 1024, got N`
  before the query is built, and Firestore rejects a wrong-length query vector
  against a 1024-d index with `INVALID_ARGUMENT`. Both paths share one
  `embedText`, so drift is structurally impossible.
- **Would a missing `lang` field silently return zero neighbours?**
  **Yes — and this is the real silent-zero risk.** Firestore equality/`in`
  filters do not match documents where the field is *absent*, so
  `.where('lang','in',[userLang,'en'])` (`search.ts:134`) and
  `.where('status','==','published')` (`:135`) each silently drop any chunk
  written without that field. Legacy/backfill-missed chunks become permanently
  invisible with no error anywhere. Same hazard for `pillar` when
  `opts.pillar` is set (`:137-139`) — a chunk with no `pillar` is excluded from
  every Reply retrieval.

### Two latent bugs to fix in the same pass (they surface the moment the KB is populated)

- **No `distanceThreshold` (`src/rag/search.ts:141-148`).** Once *any* published
  EN chunk exists, every query returns 8 neighbours. `kb_miss` will vanish and be
  replaced by *confidently wrong, irrelevant citations* — a worse failure than
  the current honest miss, and a direct grounding-mandate violation. Note
  `src/rag/citations.ts:13-14` already claims results "below the confidence
  threshold" count as a miss; no such threshold is implemented.
- **No `tenantId` pre-filter (`src/rag/search.ts:132-135`).** Violates the
  CLAUDE.md "every Firestore doc carries `tenantId`" rule. Latent while
  single-tenant; a cross-tenant leak the day it isn't.

### Why the screenshot looks like that

`kbChunks` has no chunk matching `lang ∈ {en}` + `status == 'published'` (coach
content was never ingested; the finder-pillar attempts were deleted by
`kb-cleanup.ts`). `firestoreRetrieve` returns `[]` (`search.ts:151-153`) →
`isRetrievalMiss` true → `retrieveKnowledge` returns
`{found:false, reason:'kb_miss'}` (`tools.ts:107-109`) → the Coach prompt's rule
at `prompt.ts:55` ("respond ONLY with the handoff signal") fires → the model
emits `handoff:{reason:'kb_miss'}` with `citations: []`.

**The system behaved correctly.** It refused to invent a Meta-ads playbook. The
empty `citations: []` in both screenshots is the proof: the grounding gate held.
Screenshot 3 ("list down all the topics") is the same story — a full-KB question
against an empty KB. The only defect in B's rendering is that the honest refusal
was displayed as raw JSON, which is Defect A.

### Fix plan (minimal, concrete)

1. **Ingest coach content — the actual fix.** Create the `pillar:'coach'` KB
   documents the journey config already names
   (`src/coach/journey/config.ts:107-171`), starting with
   `kb-coach-meta-ads-playbook-en` and
   `kb-coach-first-meta-ad-walkthrough-en`. Use the existing admin surface
   (`app/[lang]/(admin)/kb/`) or `createDoc` + `processBatch` with
   `pillar: 'coach'`. No code change required.
2. **Stop the loaders mislabelling everything.** Make `pillar` a CLI argument in
   `scripts/scrape-skool/to-kb.ts:157` and
   `scripts/scrape-skool/to-kb-ocr.ts:129` instead of the hard-coded
   `"finder"`. Verify `GOOGLE_GENERATIVE_AI_API_KEY` resolves before a bulk run
   so partial-then-deleted docs stop recurring.
3. **Add a `distanceThreshold`** to `src/rag/search.ts:141-148` (a DOT_PRODUCT
   floor on unit vectors, ~0.5-0.6, tuned against the trilingual eval gold set)
   so a genuine topical miss stays a miss once the KB is full. Wire it to
   `isRetrievalMiss`/`buildCitations` so `src/rag/citations.ts:13-14` becomes true.
4. **Add `.where('tenantId','==',TENANT_ID)`** to `src/rag/search.ts:132` and
   extend the composite indexes in `firestore.indexes.json:86-100` and
   `:110-124` to include `tenantId`. **Deploy the index before shipping the
   filter** or every retrieval throws `FAILED_PRECONDITION`.
5. **Observability, so an empty KB is never again indistinguishable from a
   retrieval bug:** have `retrieveKnowledge` distinguish "pre-filter matched 0
   candidates" from "no candidate cleared the threshold". Record the former as a
   `knowledgeGaps` row (`recordKnowledgeGap` is already imported at
   `app/api/chat/route.ts:57`) so Derek sees "KB empty for coach/en" on the
   dashboard instead of a per-user handoff.
6. **Replace the placeholder `kbDocIds`** in `src/coach/journey/config.ts` with
   real IDs once (1) lands, or add a startup/admin validator that flags
   checkpoints whose `kbDocIds` resolve to no `kbDocs` document.

### Regression surface

- **Adding `distanceThreshold` is the risky hunk.** Set too high, every query
  becomes `kb_miss` and the Coach is bricked; too low and it's a no-op. Affects
  all three pillars through the shared facade (`src/rag/index.ts:66-78`) —
  including `retrieveReplySop`, where a new miss silently converts a good draft
  into a `no_sop_match` refusal (`app/api/chat/route.ts:184-204,589-620`).
  Tune against `evals/` + `src/rag/rag.test.ts` before shipping.
- **`tenantId` filter:** index must be deployed first. Any chunk written before
  `pipeline.ts:221` started stamping `tenantId` becomes invisible — audit for
  unstamped chunks, and backfill rather than filter blindly.
- **Ingesting coach content changes Finder behaviour too.** The Coach's
  `retrieveKnowledge` passes **no** `pillar` filter (`tools.ts:105`), so it
  searches *all* chunks including the 82 projects' collateral. Conversely, new
  coach chunks now enter any unfiltered retrieval. Consider passing
  `{ pillar: 'coach' }` from `makeRetrieveKnowledgeTool` — the
  `(pillar,lang,status,embedding)` index already exists
  (`firestore.indexes.json:110-124`) — but note any chunk lacking `pillar`
  becomes invisible to the Coach (see B2 silent-zero).
- `searchProjects` must keep enforcing `status:'active'` — untouched by this fix;
  re-assert in `src/inventory/search.ts` tests.
- Tests: `src/rag/rag.test.ts`, `src/rag/spike-rag.test.ts`, `src/kb/kb.test.ts`,
  `src/agents/coach/coach.test.ts`, `src/firebase/__tests__/rules.test.ts`.

---

## Defect C — router misclassification (coaching question → Property Finder)

### Root cause

**The heuristic is not at fault. A sticky manual override is.**

First, the negative result. I executed the real pattern lists from
`src/router/heuristic.ts:58-127` against the screenshot text:

```
"Walk me through running my first Meta ad for BHP"
  → allFinderMatches = []   allCoachMatches = ['meta ad']
  → heuristicPillar returns { pillar: 'coach', reason: 'heuristic-coach:\bmeta\s+ad' }
```

No `FINDER_PATTERNS` entry matches — not "running", not "for BHP" (`/\b\d+\s?bhk\b/i`
at `:110` needs digits + BH**K**, not "BHP"). `src/router/heuristic.test.ts:44-47`
already asserts this invariant for "How do I run my first Meta ad?" → `coach`.
So the heuristic tier returns **coach**, and the LLM classifier is never even
reached.

The only path that overrides a clear heuristic is the manual chip.
`src/router/index.ts:71-74`:

```ts
// 1. Manual-override chip — wins over all heuristics (T-03-19).
if (opts?.override !== undefined) {
  return { pillar: opts.override, reason: 'manual-override' }
}
```

(identical in the sync path, `src/router/heuristic.ts:249-252`.)

And that chip is **pinned by a hero suggestion card and never cleared.**
`app/[lang]/chat/hero-empty-state.tsx:25-35` — every suggestion card carries a
pillar and fires `onSuggestion(prompt, pillar)`. In
`app/[lang]/chat/chat-shell.tsx:125-130`:

```ts
// Tapping a hero suggestion card: pin the card's pillar, then dispatch its
const handleSuggestion = (prompt: string, pillar: PillarOverride) => {
  setPillarOverride(pillar)
  setSubmittedSuggestion({ id: Date.now(), text: prompt })
}
```

Nothing ever resets it. `handleNewConversation`
(`app/[lang]/chat/chat-shell.tsx:119-123`) clears `activeCid`,
`historyMessages` and `messages` — **not `pillarOverride`**.
`handleSelectConversation` (`:108-113`) likewise. So one tap on the Finder hero
card pins `override:'finder'` for the **entire page session**, across new chats
and thread switches. It is then sent on every request
(`app/[lang]/chat/chat-input.tsx:197-199` → `requestBody.override`), validated
through the allow-list at `app/api/chat/route.ts:298-300`, and honoured
unconditionally by `routeAsync`.

**This also explains the screenshot-1-vs-2 asymmetry that no other theory does.**
Because Defect A's decoder is gated on the same `pillarOverride`
(`chat-input.tsx:294,311`): screenshot 2 had `pillarOverride === 'finder'`, so
`decodeFinderOutput` ran and rendered clean prose (the Finder's `refusal` field);
screenshots 1 and 3 were Auto (`undefined`), so nothing decoded and the raw JSON
showed. One sticky variable produces both symptoms, in exactly the observed
pattern.

**Secondary structural weaknesses (real, and they will cause misroutes even after
the override bug is fixed):**

1. **Assistant text pollutes the routing window.**
   `src/router/heuristic.ts:190-194`:
   ```ts
   const recentText = messages
     .slice(-4)
     .map((m) => m.content)
     .join(' ')
   ```
   No role filter. The client sends the full transcript
   (`chat-input.tsx:165-166`, `:192` `messages: nextMessages.map(...)`), so a
   Finder keyword the *assistant* wrote three turns ago hijacks the current
   user's intent. Verified: `"reach out to the lead trainer"` and
   `"the lead of your cohort"` both match `/\b(?:my|paste|the)\s+lead\b/i`
   (`:62`) → **finder**. Routing is not anchored to the current user message.
2. **Finder is scanned before Coach, first-match-wins, no scoring.**
   `src/router/heuristic.ts:209-221` runs the whole `FINDER_PATTERNS` loop and
   returns on the first hit, only then trying `COACH_PATTERNS`. A single weak
   Finder token beats an explicit `"meta ad"`. There is no score, no tie-break,
   no "count both sides" step.
3. **quick-041 broke the "strong, unambiguous keywords only" invariant** that
   `:56` and `:118-127` still claim. The widened Finder set
   (`:78-110`) added bare single words: `/\bunits?\b/i` (:96),
   `/\bstudio\b/i` (:88), `/\bterrace(?:d)?\b/i` (:90), `/\bpaste\b/i` (:63),
   `/\beligib/i` (:74), `/\bfinancing\b/i` (:73), `/\b\d{2,4}k\b/i` (:102).
   Ordinary coaching prose ("how many units", "eligibility", "financing basics",
   "800k") now routes to Finder.
4. **`/\bmeta\s+ad/i` (`:122`) requires whitespace**, so "meta-ad" and "metaads"
   miss the Coach fast-path entirely — despite `:82`'s own comment listing
   "meta-ad" as coach vocabulary.

### Why the screenshot looks like that

The user tapped a Finder hero suggestion earlier in the session (or the Finder
header chip). `pillarOverride` stayed `'finder'` with nothing to clear it. The
next message — "Walk me through running my first Meta ad for BHP", which the
heuristic correctly classifies as **coach** — was sent with `override:'finder'`,
so `routeAsync` short-circuited at `src/router/index.ts:72-74` with
`reason:'manual-override'` before the heuristic ran. `finderAgent` answered, and
correctly refused: *"running Meta ads falls outside what I'm set up to assist
with… What I can help you with is matching your leads to active D2 projects."*
That refusal is the Finder honouring its scope — the routing was wrong, not the
agent.

`routeDecision` was persisted as `finder:manual-override`
(`app/api/chat/route.ts:392-394`, `:519`, `:537`) — **query
`conversations/{cid}/messages` for `routeDecision` on that turn to confirm
`manual-override` vs `heuristic-finder:*` before implementing.** That one field
settles which of the two mechanisms fired.

### Fix plan (minimal, concrete)

1. **Clear the override when the conversation context changes** — the primary
   fix. Add `setPillarOverride(undefined)` to `handleNewConversation`
   (`app/[lang]/chat/chat-shell.tsx:119-123`) and `handleSelectConversation`
   (`:108-113`).
2. **Make the hero-card pin one-shot.** In `handleSuggestion`
   (`app/[lang]/chat/chat-shell.tsx:127-130`) the pillar should apply to *that
   dispatch only*, then fall back to Auto — or, better, let the card seed the
   prompt and let the router decide (the heuristic already routes each hero
   prompt correctly). If a persistent pin is genuinely wanted, it must be
   unmistakably visible and one-tap clearable in `chat-header.tsx`.
3. **Anchor the heuristic to the current user turn.** In
   `src/router/heuristic.ts:190-194`, filter to `role === 'user'` and weight the
   **last** user message decisively (earlier turns as weak context only). This
   alone kills the assistant-text-pollution class of misroute.
4. **Replace first-match-wins with a score.** In
   `src/router/heuristic.ts:209-221`, count matches per pillar over the window
   and return the winner; return `null` on a tie or a thin margin so it falls
   through to `classifyIntent` — **the existing seam**
   (`src/router/index.ts:83-99`), whose prompt already says "When in doubt,
   prefer coach" (`src/router/classifier.ts:56`) and whose sub-threshold branch
   already defaults to coach (`index.ts:85-92`). No new tier needed.
5. **Demote the over-broad Finder patterns** added by quick-041
   (`heuristic.ts:88,90,96` and `:63,73,74,102`) from "decisive" to "weak
   signal" under the new scoring, so they can no longer single-handedly beat an
   explicit coach keyword.
6. **Widen the Meta-ad coach pattern** at `src/router/heuristic.ts:122` to
   `/\bmeta[\s-]?ads?\b/i`, and add `/\bwalk me through\b/i` +
   `/\bmy first\b/i` as coach signals — the exact phrasing in both screenshots.
7. Keep `modelFor('router')` (`src/router/classifier.ts:87`) as-is — no
   hard-coded model ID.

### Regression surface

- **`heuristic.ts` ordering/scoring is the risky hunk.** `heuristicPillar` is
  consumed by both `route()` (sync, `:248`) and `routeAsync()`
  (`src/router/index.ts:77-80`), which feed the chat route
  (`app/api/chat/route.ts:388`) *and* the stall-detect job. Every existing
  assertion in `src/router/heuristic.test.ts` and
  `src/router/classifier.test.ts` must still pass — especially Behavior 2/2b/2c
  (`:53-70`: budget/RM, bedroom, "paste lead details" → finder) and Behavior
  4b/4c (`:113-124`: the classifier must **not** be called on clear paths;
  a scoring change that returns `null` more often increases LLM cost and
  latency on every ambiguous turn).
- **Reply precedence must survive.** `REPLY_PATTERNS` are deliberately checked
  *before* Finder (`heuristic.ts:196-207`, rationale at `:132-141`): a pasted
  inbound mentioning "RM"/"financing" is a Reply draft. Any scoring rewrite must
  keep the Reply structural signal winning, or Reply turns leak into Finder.
- **`leadId` fail-closed interaction.** `app/api/chat/route.ts:402-407` returns
  400 for a Reply turn with no `leadId`. Routing *more* turns to `reply` will
  surface new 400s — verify the lead-selector gate
  (`chat-shell.tsx:135-142`) still intercepts first.
- **Clearing `pillarOverride` interacts directly with Defect A.** While decoding
  is still gated on `pillarOverride` (`chat-input.tsx:294,311`), clearing it on
  new-conversation *removes* Finder/Reply card rendering for those turns. **Land
  A's fix (server-reported pillar) before or with C's fix**, or C regresses A.
- **Manual-override must keep winning when genuinely set** (T-03-19) —
  `heuristic.test.ts:73-111` Behaviors 3/3c cover this; do not weaken
  `src/router/index.ts:72-74`.
- `routeDecision` string format (`app/api/chat/route.ts:394`) is consumed by
  eval/dashboard observability (D-02). Changing `reason` prefixes breaks
  downstream parsing — keep the `heuristic-*` / `classifier:*` /
  `low_confidence:*` / `manual-override` vocabulary.

---

## Cross-cutting: the one change that fixes the most

`pillarOverride` is currently doing **two unrelated jobs**: telling the server
how to route, and telling the client how to render. Defect A is the render job
failing in Auto mode; Defect C is the routing job never being reset. Splitting
them — server emits the authoritative pillar for rendering, the chip only ever
requests a route — resolves both, and is a prerequisite for C not regressing A.

Suggested landing order:

1. Server emits pillar on the stream + client decodes on it (A1-A3 render path).
2. `decodeCoachOutput` + schema-constrained Coach output (A).
3. Clear/one-shot `pillarOverride` (C primary).
4. Heuristic anchoring + scoring + Meta-ad pattern (C structural).
5. Ingest coach KB content (B primary) — independent, can land first.
6. `distanceThreshold` + `tenantId` filter (B latent) — must land *with or
   after* (5), never before, and index-first.
