# quick-kayinleong-085 — Research

**Researched:** 2026-09-03
**Domain:** Property Finder retrieval + chat render path (codebase-grounded)
**Confidence:** HIGH on current state (read the code), HIGH on data availability (measured against the real 82-project corpus), MEDIUM on the recommended split because it is a new seam not yet exercised here.

---

## Headline

The "5 cards" is **not** the reason the user sees too few results. Measured against the real
corpus, the user's own example prompt collapses to **3 projects before any cap is applied**:

```
"Klang Valley"  -> locationNeedles => [{phrase:"klang valley", tokens:["klang","valley"]}]
                => 5 of 82 active projects survive the location gate
   + priceMax 1,000,000  => 3 survive
```
[VERIFIED: faithful port of `src/inventory/search.ts:243-437` run against `projects.inventory.json` (82 records)]

For comparison, on the same corpus: `"Kuala Lumpur"` / `"KL"` / `"Selangor"` all yield
`needles === null` and the gate is **skipped** (all 82 survive); `"Cheras"` yields **0**;
`"Bangsar"` yields 8; `"Petaling Jaya"` yields 4.

"Klang Valley" is a *region* that contains essentially the entire D2 corpus, but the gate treats
it as a literal substring of `name + locationText`, so it behaves like a narrow neighbourhood
filter. `MAX_MATCHES = 8` never even engages. **Fixing the table without fixing this returns a
3-row table.**

Separately: **32 of 82 projects have `priceValue === 0`** ("unknown"), and
`projectMatchesPrice` hard-excludes unpriced projects whenever any bound is stated
(`src/inventory/search.ts:429-437`). So "1mil" alone already drops 32 projects, deliberately.
Only **18 of 82** have a known price ≤ RM1,000,000. [VERIFIED: measured]

---

## 1. Current state

### A. Retrieval path (server)

| What | Where | Detail |
|---|---|---|
| Finder tool | `src/agents/finder/tools.ts:156` `makeSearchProjectsTool(userLang)` | `inputSchema` (`:170-186`) = segment, priceMin, priceMax, monthlyIncome, financingNote, nationality, bumiputera, locationPref, tenurePref, bedrooms, freeText. `tenurePref` is accepted and **silently dropped** — `execute` (`:190-205`) does not forward it to `searchProjects`. |
| Tools wired | `src/agents/finder/index.ts` `finderAgent.makeTools(userLang, uid, leadId)`, called at `app/api/chat/route.ts:783` | Per-request construction — a sink/`toModelOutput` is easy to add here. |
| Core search | `src/inventory/search.ts:546` `searchProjects(criteria): Promise<SearchResult>` | Two-stage. |
| `status:'active'` gate | `src/inventory/search.ts:554` | `projectsRef().where('status','==','active')` — unconditional, first line, never skipped. Also enforced in `queryInventory` (`:761`). ✅ |
| Eligibility gate (Stage A, Firestore) | `:557-565` | `foreignEligible==true` when `nationality==='foreign'`; `bumiQuota==false` when `bumiputera===false`. Equality only. |
| Location gate | `:620-635` (helpers `:373` `locationNeedles`, `:403` `projectMatchesLocation`, `:296` `locationHaystack`) | **In-memory hard filter.** Haystack = `name` + non-proximity clauses of `locationText`; `description` deliberately excluded (`:288-295`). Phrase tier + all-tokens tier. `needles===null` ⇒ gate skipped. `PROXIMITY_CLAUSE` (`:294`) drops "near X" clauses. **No alias/region table — documented as out of scope (`:366-370`).** |
| Price gate | `:639-649` via `projectMatchesPrice` (`:429`) | In-memory, inclusive; `priceValue <= 0` excluded when any bound is stated. |
| Affordability gate | `:653-666` | `monthlyIncome × 12 × 4.5` (`DSR_MULTIPLE`, `:167`). |
| **Scoring** | `:673-679` | **In-memory dot product** (`dotProduct`, `:527`) against `doc.embedding`. **NOT `findNearest`.** `projects.embedding` is written as a plain `number[]` — only `kbChunks` uses `FieldValue.vector()` (`src/kb/ingest/pipeline.ts:281`, `src/kb/crud.ts:600`). The `projects` vector index in `firestore.indexes.json` is therefore **unused**. Confirms STATE quick-030. |
| Relevance floor | `MIN_RELEVANCE = 0.20` (`:207`) | The comment at `:193-206` states it is **currently a no-op** — 83/83 clear it for every probe query, including nonsense. |
| **THE CAP** | **`MAX_MATCHES = 8` (`src/inventory/search.ts:221`), applied at `:697`** `applySegmentWeights(...).slice(0, MAX_MATCHES)` | The only result cap in the pipeline. |
| Secondary cap | `INLINE_COLLATERAL_MATCHES = 3` (`src/agents/finder/tools.ts:48`), applied at `:221` | Only the top 3 matches get collateral attached inline. `MAX_COLLATERAL_ITEMS = 12` (`:38`) per project. |
| Prompt cap | **none** | `src/agents/finder/prompt.ts` has no "top N" / "shortlist of 3" instruction. [VERIFIED: grepped `top|shortlist|three|five|maximum|limit`] |
| UI cap | **none** | `match-list.tsx:132` maps every element of `matches`. |

**So caps live in exactly two places: `MAX_MATCHES=8` and `INLINE_COLLATERAL_MATCHES=3`.**
The "5 cards" the user saw = the model chose to emit 5 of the ≤8 it was handed (the model owns
the `matches` array — see §1C).

Reads are already whole-collection: Stage A pulls **all** active docs into memory
(`:571-577`). Returning more rows costs **zero extra Firestore reads**.

### B. Render path (client)

The Finder payload is **NOT a typed tool result**. It is a **JSON envelope the model writes as
assistant text**, parsed on the client:

```
model emits bare JSON (prompt.ts:149 "Return ONLY the bare JSON object")
  -> streamed as text deltas by app/api/chat/route.ts (toUIMessageStreamResponse, route.ts:19-25)
  -> app/[lang]/chat/decode-structured-output.ts:350 decodeFinderOutput(content)
       normalizeFinderShape(:285) -> dropUnrenderableMatches(:319) -> FinderOutputSchema.safeParse(:357)
  -> app/[lang]/chat/message-list.tsx:131 <MatchList output={msg.finderOutput} className="max-w-[90%]" />
  -> app/[lang]/chat/match-list.tsx:65 MatchList -> :168 MatchCard  (one Card per match)
```
Pillar is chosen from **server-authoritative `messageMetadata`**, not the client's chip
(`decode-stream-chunk.ts:117 parseMessageMetadata`, produced at `route.ts:1219-1247`).

**Answer to #9:** structured *shape*, model-authored *content*. Good enough to iterate rows;
**useless as a source of attributes**, because the schema carries none (§2).

There is already precedent for the server overriding what the model wrote:
- `route.ts:1242-1247` puts `collateralByProject` on `messageMetadata`;
- `route.ts:662-668` **decodes the envelope server-side, calls
  `attachCollateral(decoded, collateralByProject)` and re-serialises it before persisting.**

That is the exact pattern to reuse (§4, Move 2).

⚠ `messageMetadata` only fires on `start` and `finish` — documented at `route.ts:1224-1228`
(they tried `finish-step` and it does not fire). A truncated turn gets no metadata and the client
reloads the persisted row. **Therefore attribute rows must go into the persisted envelope, not
only into metadata**, or a reloaded thread renders an empty table.

### C. Existing programmatic-prompt mechanism (answer to #12) — reuse this, do not invent

```
chat-shell.tsx:211  handleSuggestion(prompt, pillar)
                    -> setSubmittedSuggestion({ id: Date.now(), text: prompt, pillar })
chat-shell.tsx:335  <ChatInput submittedSuggestion={submittedSuggestion} .../>
chat-input.tsx:57   interface SubmittedSuggestion { id; text; pillar? }
chat-input.tsx:606-615  useEffect: new id -> setInput(text) + void sendMessage(text, pillar)
```
`id` de-dupes re-fires; the pillar is applied **to that dispatch only** (deliberately not pinned —
quick-046). `HeroEmptyState` already uses it (`chat-shell.tsx:310`).

The "show more" button needs one new prop threaded **chat-shell → MessageList → MatchList → row**,
calling `handleSuggestion(prompt, 'finder')`. `MessageList` currently takes only
`{messages, isStreaming, className}` (`chat-shell.tsx:317-321`).
⚠ `app/[lang]/chat/lead-required.test.ts:68` guards prop-forwarding **through `ChatInput` into
`useChatStream`** — a new `MessageList` prop is outside that guard, but the *lesson* (hand-written
forwarding silently drops props) applies directly.

---

## 2. Available attributes — what can actually become a column

`ProjectDoc` — `src/firebase/collections.ts:215-268`. This is the **complete** field list.
Coverage measured on `projects.inventory.json` (82 records, the corpus that was imported).

| Field | Type | Coverage | Column-ready? |
|---|---|---|---|
| `name` | string | 82/82 | ✅ always |
| `status` | `'active'\|'sold_out'\|'hidden'` | 82/82 | ✅ (always `active` in results — grounding gate) |
| `priceValue` | number (RM) | **50/82 known, 32 are `0` = unknown** | ⚠ sometimes — render "—" for 0, never "RM0" |
| `priceBand` | `under_500k\|500k_800k\|800k_1.2m\|above_1.2m` | 82/82 | ⚠ **misleading**: `priceBandFor(0) === 'under_500k'` (`collections.ts:207`), so all 32 unpriced projects are labelled "under 500k". Do **not** show as a price column. |
| `bedrooms` | number | **53/82 > 0, 29 are `0` = unknown** | ⚠ sometimes. Also semantically "the SMALLEST layout offered" (`scripts/scrape-skool/to-inventory.ts:49`) |
| `tenure` | string ("Freehold"/"Leasehold"/"Leasehold 2113") | 82/82 | ✅ always (free-form string, not an enum) |
| `locationText` | string | 82/82 | ✅ always — but it is **prose** ("…, 400m to Bangsar LRT, near KL Sentral"), 60-120 chars. Needs truncation. |
| `vpStatus` | boolean | 82/82 | ✅ always |
| `vpDate` | `Date \| FieldValue \| null` | null when `vpStatus===false` | ⚠ sometimes. ⚠ **RSC/serialization trap** — quick-029/030/031 were all this exact bug. |
| `bumiQuota` | boolean | 82/82 | ✅ always |
| `foreignEligible` | boolean | 82/82 | ✅ always |
| `description` | string | 82/82, **avg 2,553 chars** | ✅ present but **unstructured prose** — see below |
| `embedding` | `number[]` (1024-d, plain array) | 82/82 | ❌ never render; ~8 KB/project (STATE deferred item: strip from client payloads) |
| `tenantId` | `'d2'` | 82/82 | ❌ internal |
| **`size` / `sqft` / built-up** | — | **FIELD DOES NOT EXIST** | ❌ |
| **`bathrooms`** | — | **FIELD DOES NOT EXIST** | ❌ |
| **`developer`** | — | **FIELD DOES NOT EXIST** | ❌ |
| **`projectType`, `totalUnits`, `maintenanceFee`, `facilities`, `features`, `highlights`** | — | **NONE EXIST** | ❌ |

**The user asked for "price, size, rooms and etc". `size` is not a field.**
It exists only as prose inside `description`: **61/82 descriptions mention sqft**, **73/82 mention
"Developer"** [VERIFIED: measured]. Example (`projects.inventory.json`, DC Residensi):

```
Developer: Damansara City Sdn Bhd …
Built-Up Sizes & Layouts:
  1 Bedroom: 904 sqft | 1 car park bay
  2+1 Bedrooms: 1,600 – 1,800 sqft | 2 car park bays
Facilities: 50m infinity pool, gymnasium, jacuzzi …
Maintenance Fee: RM0.65 psf
```

So size is a **range across layouts**, not a scalar. A `sqft: number` column is not derivable
without a modelling decision (which layout?) — see Open Question Q1.

### What the model's output schema carries today (the real blocker)

`FinderMatchSchema` (`src/agents/finder/schema.ts:140-207`) — **`projectId`, `name?`,
`rationale`, `matchedCriteria`, `collateral?`** and nothing else. No price, no bedrooms, no
tenure, no location. `ProjectMatch` (`src/inventory/search.ts:116-138`) **does** carry
`priceBand, priceValue, tenure, vpStatus, bumiQuota, foreignEligible, bedrooms, locationText,
score` — but that shape stops at the tool boundary and only reaches the model, never the client.

⚠ `FinderOutputSchema` is a plain `z.object`, which **strips unknown keys**. Any new attribute
field must be added to the schema or `safeParse` silently deletes it.

**Existing precedent for a renderable project table:**
`app/[lang]/(admin)/inventory/project-list.tsx:100-127` already renders exactly
Name / Status / Price / Tenure / Bedrooms / Location with i18n keys
`inventory.colName|colStatus|colPrice|colTenure|colBedrooms|colLocation` (all three catalogs).
That is the columns-that-exist set, already translated.

---

## 3. WhatsApp features linkage — the decisive answer (#6, #7)

**WhatsApp-derived feature TEXT is not on the project doc, and KB chunks have no `projectId`.**

- `KbDocDoc` (`src/firebase/collections.ts:302-340`) fields: `tenantId, title, sourcePath,
  version, supersedesId?, supersededBy?, status?, correctedBy?, lang, pillar, copiedFromId?,
  category?, publishedAt`. **No `projectId`.**
- `KbChunkDoc` (`:342-…`): `tenantId, docId, text, lang, ownerCollection, status?, pillar?,
  category?, embedding`. **No `projectId`.**
- The only link is a **project-NAME string**:
  `scripts/scrape-skool/to-kb.ts:151,173,178` sets
  `title = "<projectName> — <fileName>"` and `category = <projectName>`.
  `category` is denormalized onto chunks (quick-078). Joining chunk → project therefore requires
  **fuzzy name matching**, and D2 names drift ("Southpoint Residences (IGB )", "Exsim Project").

- The WhatsApp-import admin surface (quick-045) is **classify-only**
  (`app/[lang]/(admin)/whatsapp-import/actions.ts:12-20`) and dispatches to three existing
  actions: transcript text → `createKbDocAction` (kbDocs, name-string link only); media →
  `attachCollateralAction`; new project → `createProjectAction`.

**But the *substance* of those WhatsApp/Drive "important features" is already on the project doc.**
`scripts/scrape-skool/to-inventory.ts` LLM-extracts the scraped material into
`ProjectDoc.description` (avg 2,553 chars) — that is where the "Quick Facts / Built-Up Sizes /
Facilities / Developer's Incentives" block lives. It is **also 97% of the embedded text**
(`search.ts:196-198`), which is why the semantic re-rank works at all.

**Supporting documents are cheap.** `CollateralDoc` (`collections.ts:274-300`) **does** carry
`projectId`, plus `type` (`'whatsapp-media'` for WhatsApp imports), `storagePath`,
`externalUrl?`, `lang`. `collateralFor(projectId)` is already called inline for the top 3
(`tools.ts:221-241`) and already rendered as a per-card file list
(`match-list.tsx:246-282`, filenames recovered by `collateral-label.ts`, quick-062).

**Verdict:**
| Ask | Cost | Source |
|---|---|---|
| Price / rooms / tenure / location / VP / eligibility columns | **CHEAP** | already structured on `ProjectDoc`; already in `ProjectMatch` |
| "Features" / size column | **EXPENSIVE** | prose inside `description` only — needs LLM extraction or new fields + re-embed |
| "Supporting documents" | **CHEAP** | `collateral` keyed by `projectId`, already wired |
| Pulling WhatsApp KB chunks per project | **EXPENSIVE + fuzzy** | name-string join, no `projectId` |

---

## 4. Recommended approach — 3 moves, in this order

### Move 1 (must be first) — make "Klang Valley" match (`src/inventory/search.ts`)
Without this, everything downstream renders a 3-row table.

Add a **region tier** alongside the existing qualifier tier. The corpus is 100% Klang Valley, so
the correct behaviour is identical to `"Kuala Lumpur"`: **needle-less ⇒ gate skipped ⇒ 82
candidates ⇒ `matchedCriteria.locationPref` stays `null`** so nothing claims a location match it
did not make (the invariant at `:635` / `:718-724`).

- Cheapest correct change: add a `REGION_ALIASES` set of multi-token region names
  (`klang valley`, `greater kl`, `lembah klang`, `巴生谷`) checked in `locationNeedles`
  (`:373-402`) **before** the qualifier strip; a segment that reduces to a region ⇒ drop the
  segment (same as an all-qualifier segment ⇒ `null` ⇒ skip).
- Do **not** invent a geographic taxonomy — `:366-370` explicitly rules that out of scope, and
  a bad adjacency table produces silent false positives.
- Update `src/inventory/search.test.ts` (47 KB, already the location-gate's home) with the
  measured expectations: `Klang Valley` ⇒ needles `null`; `Cheras` ⇒ 0; `Bangsar` ⇒ 8.

Also decide `tenurePref`: the tool accepts it (`tools.ts:184`) and `execute` drops it
(`:191-201`). Either forward it or delete it from `inputSchema` — a parameter the model is told
about and that does nothing is a false affordance.

### Move 2 — split the cap: bounded prompt, complete table (server owns the rows)
The rows must come from **tool truth**, not from what the model chose to retype.

Two options, both already precedented in this repo:

**2a (preferred) — `toModelOutput`.** `tool({ … toModelOutput })` **exists in the installed SDK**
(`node_modules/@ai-sdk/provider-utils/dist/index.d.ts:772`, `ai@5.0.193`) with the doc
"Optional conversion function that maps the tool result to an output that can be used by the
language model." So:
- `searchProjects` returns **all** matches (raise/remove the `:697` slice, or make `MAX_MATCHES`
  a `modelCap` and add `MAX_ROWS`);
- `toModelOutput` down-samples to the top-8 compact summary → the model's context is unchanged;
- the route already reads full tool output in `onStepFinish` (`route.ts:879-905`, using the
  `output`-vs-`result` fix from quick-071 at `:138`) so the complete rows are available server-side.

**2b (lower-risk fallback) — a request-scoped sink.** `finderAgent.makeTools(userLang, uid, leadId)`
is constructed per request (`route.ts:783`); pass a collector the tool writes full rows into.
No new SDK surface.

Then **mirror the collateral plumbing exactly**:
- extend `FinderMatchSchema` with an optional server-only `attributes` object
  (`priceValue|null, bedrooms|null, tenure, locationText, vpStatus, bumiQuota, foreignEligible,
  priceBand, score`) — remember `z.object` strips unknown keys;
- add `rowsByProject` to `messageMetadata` (`route.ts:1229-1247`) and to
  `StreamMessageMetadata` + `parseMessageMetadata` (`decode-stream-chunk.ts:81-140`);
- add `attachProjectRows(output, rowsByProject)` next to `attachCollateral`
  (`decode-structured-output.ts:385`) and call it **both** client-side on merge **and** server-side
  in the persist path at `route.ts:662-668` — otherwise a reloaded thread has no attributes
  (`messageMetadata` fires only on `start`/`finish`, `route.ts:1224-1228`);
- add one prompt line mirroring the existing one at `prompt.ts:151`:
  *"Do NOT include an attributes field; the system attaches them."* And, because the table now
  shows everything, tell the model to list **every** project `searchProjects` returned in
  `matches` rather than self-editing a shortlist.

Also raise `INLINE_COLLATERAL_MATCHES` cautiously — collateral is re-sent on **every** step of
the 5-step loop (`tools.ts:216-220`, the quick-054 blowup). Prefer attaching collateral rows
server-side from tool results (route already does this) rather than widening the inline slice.

### Move 3 — the table + the row action (client)
- New `app/[lang]/chat/match-table.tsx` composing **vendored `components/ui/table.tsx`**.
  `@tanstack/react-table` is **not** a dependency and is **not needed** — the admin surfaces all
  use the plain vendored table. [VERIFIED: `package.json`]
  `Table` already wraps itself in `<div className="relative w-full overflow-x-auto">`
  (`components/ui/table.tsx:7-19`), which is the horizontal-scroll affordance.
- Columns: reuse the exact set that exists — Name · Price · Beds · Tenure · Location · VP ·
  (action). Reuse the already-trilingual keys `inventory.colName|colPrice|colTenure|colBedrooms|
  colLocation` and add only what is missing under a new `chat.matchTable.*` namespace.
- Paginate with the shared primitive: `usePagination(rows, 10)` + `<Paginator>` from
  `app/[lang]/_components/paginator.tsx:55` (quick-027; `pagination.previous|next|pageOf` already
  exist in all three catalogs). Precedent: `project-list.tsx:73,177`.
- Keep `MatchList`'s refusal / clarifyingQuestion / answer branches untouched
  (`match-list.tsx:69-122`) — only the `matches.length > 0` branch (`:125`) swaps to the table.
  Keep the card renderer for ≤N matches, or as the sub-`sm` fallback (see §5).
- Last column button → `onAsk(prompt)` threaded chat-shell → MessageList → MatchTable, landing on
  `handleSuggestion(prompt, 'finder')` (`chat-shell.tsx:211`). Prompt text should name the project
  **and** ask for documents, e.g.
  `Tell me more about ${name} (${projectId}) — full details and all supporting documents.`
  Including the `projectId` matters: it is the grounding citation (D-04) and the Finder's
  conversational branch is the `answer` field (`prompt.ts:142-147`), which already renders as
  markdown. The prose "show more" answer will then route through `FinderOutput.answer` and
  `fetchCollateral` picks up the files for a project the search's inline top-3 missed
  (`prompt.ts:90` says exactly that is what `fetchCollateral` is for).

---

## 5. Pitfalls

1. **Mobile width is the central risk.** Primary surface is a phone; the user's device is **440px**
   (memory + quick-083/084). The bubble is already `max-w-[90%]` (`message-list.tsx:131`) ⇒ ~380px
   of usable width. A 6-column attribute table will not fit.
   Patterns that already exist in this repo:
   - `components/ui/table.tsx:7-19` — built-in `overflow-x-auto` container;
   - `markdown-message.tsx:66` — `<div className="mb-2 overflow-x-auto">` around markdown tables;
   - `chat-header.tsx:203` — a `min-w-0 … overflow-x-auto` strip, **with the quick-081 warning at
     `:199-202` that `justify-center` on an `overflow-x-auto` container clips BOTH ends**. Never
     centre a scrolling row.
   - `usage-dashboard.tsx:372`, `correction-eval-panel.tsx:94` — plain `overflow-x-auto` wrappers.
   Guards that will police this: `app/[lang]/chat/mobile-layout.test.ts` (asserts the header's
   `min-[400px]:` gates and forbids `sm:`-gated wraps) and `tests/dialog-mobile-width.test.ts`
   (scans **every** `<DialogContent>` call site and requires `sm:max-w-*`, never bare `max-w-*`).
   **Recommendation:** essential columns visible at 440px (Name · Price · Beds + action), the rest
   behind horizontal scroll; or card-list below `sm` and table from `sm` up. Tailwind `sm` is
   640px — the quick-083 lesson is to gate on measured widths (`min-[400px]:`), not on `sm`, when
   440px phones are the target. Measure at 320/399/400/440 in-page rather than eyeballing.

2. **LLM context bloat.** The tool result is re-sent on **every** step of `stopWhen: stepCountIs(5)`
   (`route.ts:841`). `MAX_MATCHES`'s own sizing note (`search.ts:210-221`): uncapped = 83 projects
   ≈ 36,400 chars ≈ 10,100 tokens/step ⇒ ~50k tokens/turn on inventory payload alone. `TOKEN_CAP`
   is **300,000** per 24h per agent (`src/ratelimit/window.ts:50`), enforced at
   `src/ratelimit/index.ts:75`. Six uncapped Finder turns would exhaust an agent's daily budget.
   **This is why the model cap must stay ~8 and only the client rows go wide.** Adding attribute
   rows to the *client* payload is free; adding them to the *model* payload is not.
   Related: a turn that runs long gets killed by the platform mid-flight (quick-067/070) — the
   whole persistence-checkpoint machinery exists because of it. Do not lengthen the model loop.

3. **i18n parity is enforced.** `src/i18n/__tests__/i18n-parity.test.ts` fails the moment a key
   exists in one of `en.json|ms.json|zh.json` and not the others. `match-list.tsx` is currently
   **not internationalized at all** — `'No match found'`, `'Eligibility issue'`,
   `` `${n} files to share` ``, `'No results returned…'` are hardcoded English (`:97, :148, :249`).
   Do not extend that: put new headers under `chat.matchTable.*` in all three catalogs.
   `inventory.col*` and `pagination.*` already have full parity and can be reused.

4. **Grounding rules a "return everything" change can break.**
   - `status:'active'` — safe as long as the extra rows still come from `searchProjects`
     (`search.ts:554`). Never build a second query path that forgets it.
   - Source-ID citation (D-04) — `projectId` must stay on every row; it is the grounding
     citation and the admin key. Keep it visible or in a `title`/`data-project-id` attribute
     (`match-list.tsx:176`).
   - `matchedCriteria` must remain honest: `locationPref`/`priceMax` are nulled when the gate
     did not run (`search.ts:718-731`). A region-alias skip **must** leave `locationPref: null`,
     or every row falsely claims "location: Klang Valley".
   - Never render `priceBand` as a price (`priceBandFor(0) === 'under_500k'`).
   - No hard-coded model IDs — nothing in this change should touch `modelFor`.
   - `tenantId` on every doc — read-only change, unaffected.

5. **RSC→Client serialization.** Four separate claims (029/030/031) were "Only plain objects can
   be passed to Client Components", every time a Firestore `Timestamp` or a raw doc crossing the
   boundary. If `vpDate` becomes a column, normalize it to `Date`/millis at the boundary. Also do
   **not** let `embedding` into any client payload (~8 KB × N rows; already a deferred STATE item).

6. **Zod strips unknown keys.** New attribute fields silently vanish unless added to
   `FinderMatchSchema` (`schema.ts:140`). And `dropUnrenderableMatches`
   (`decode-structured-output.ts:319`) exists precisely because over-strict requirements once
   deleted every real match — make new fields **optional with defaults**, never required.

7. **No new Firestore index needed.** Stage A is `where('status','==','active')` plus optional
   equality filters; existing indexes cover `(status, priceBand)`, `(status, vpDate)` and two
   vector indexes (`firestore.indexes.json`). Scoring is in-memory, so returning more rows adds
   **no reads and no index**. The `projects` vector indexes are currently dead weight —
   `projects.embedding` is a plain array, not `FieldValue.vector()`; if anyone "fixes" that to
   use `findNearest`, note the range-filter limitation documented at `collections.ts:230-236`
   and `search.ts:668-672`.

8. **Truncated turns are the norm, not the exception** (quick-051/053/056/070/072). Any new field
   must survive `repairTruncatedJson` (`decode-structured-output.ts:72`) and
   `salvageStructuredText` (`:426`). Server-attached attributes (Move 2) are *more* robust than
   model-emitted ones for exactly this reason — which is the argument quick-071 already made for
   collateral.

---

## 6. Open questions for the user

**Q1 — What is the "size" column?** There is no `size`/`sqft` field. It exists only as a
per-layout range inside `description` ("1 Bedroom: 904 sqft … Penthouses: 2,900 – 4,855 sqft"),
present in 61/82 records. Options:
(a) omit the column for now; (b) show a text range extracted at render time from `description`
(fragile, unlabelled provenance); (c) add real `sizeMinSqft` / `sizeMaxSqft` fields to
`ProjectDoc` + a one-off re-extraction over 82 projects — a data migration plus a re-embed
decision (`crud.ts:EMBEDDING_RELEVANT_FIELDS`), i.e. its own claim.
**Recommendation: (a) now, (c) as a follow-up claim.** Same question applies to `developer`
(73/82 in prose) and `bathrooms` (absent entirely).

**Q2 — "Klang Valley" semantics.** Confirm that treating it as "no discriminating location
filter" (⇒ all 82 candidates, and the row does not claim a location match) is what is wanted.
The alternative — a real region→area table — is explicitly out of scope in the current code and
would be a bigger claim.

**Q3 — Unpriced projects.** 32 of 82 have `priceValue: 0` and are **deliberately excluded** when
a budget is stated (`search.ts:415-427`: "the remedy is to backfill `priceValue`, not to loosen
the gate"). For "1mil in Klang Valley" that means 32 projects are invisible. Should the table
show them in a separate "price unknown" section, or stay excluded?

**Q4 — How many rows before pagination?** `usePagination` defaults to 10/page. With Q2 resolved,
"1mil Klang Valley" yields ~18 rows. Confirm 10/page, or show all with scroll.

**Q5 — "Features" column.** The WhatsApp/Drive feature text is in `description` (2,553 chars avg)
or in KB chunks with **no `projectId`** (name-string link only). A short per-row highlight is
achievable by asking the model for a `highlight` string per match (grounded, but model-authored
and therefore variable run to run — the exact failure mode quick-071 fixed for collateral).
Is a model-authored highlight acceptable, or should the features column wait for Q1(c)?

---

## Sources

**Primary (HIGH — read in this session)**
`src/inventory/search.ts`, `src/inventory/crud.ts`, `src/firebase/collections.ts`,
`src/agents/finder/{schema,tools,prompt}.ts`, `app/api/chat/route.ts`,
`app/[lang]/chat/{match-list,message-list,chat-shell,chat-input,decode-structured-output,decode-stream-chunk,mobile-layout.test}.{ts,tsx}`,
`app/[lang]/(admin)/inventory/project-list.tsx`, `app/[lang]/_components/paginator.tsx`,
`components/ui/table.tsx`, `src/ratelimit/window.ts`, `src/i18n/__tests__/i18n-parity.test.ts`,
`tests/dialog-mobile-width.test.ts`, `scripts/scrape-skool/{to-inventory,to-kb}.ts`,
`src/whatsapp/parse.ts`, `app/[lang]/(admin)/whatsapp-import/actions.ts`,
`firestore.indexes.json`, `package.json`, `.planning/STATE.md`.

**Measured (HIGH)** — `projects.inventory.json` (82 records) probed with a faithful port of the
`search.ts` location/price gates: region-name match counts, price/bedroom/sqft coverage.

**SDK (HIGH — installed version, not training data)** — `ai@5.0.193`;
`toModelOutput` confirmed at `node_modules/@ai-sdk/provider-utils/dist/index.d.ts:772`.
`@tanstack/react-table` confirmed **absent** from `package.json`.

**[ASSUMED]** — that "Klang Valley" covers the entire current corpus (inferred from every
`locationText` being KL/Selangor, plus `Kuala Lumpur`/`Selangor` already being treated as
non-discriminating qualifiers). Not a locked geographic fact — see Q2.

---

## RESEARCH COMPLETE

`/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent/.planning/quick/quick-kayinleong-085/RESEARCH.md`
