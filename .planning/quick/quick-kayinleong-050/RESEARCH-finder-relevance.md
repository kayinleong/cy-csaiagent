# RESEARCH — Finder result relevance ("Cheras" returns far-away projects)

**Claim:** quick-kayinleong-050
**Date:** 2026-08-26
**Scope:** read-only investigation. No source files changed.

**Tester report (verbatim):**
> "the agent choose to show projects from other location when asking for cheras. I noticed
> that the agent do acknowledge that there is no project in Cheras but still show the other
> project which is not close to Cheras at all (this is good for extra info but not sure is
> the best way or not)."

The tester flags this as a judgment call. This document establishes the mechanism and lays
out options. It does **not** pick one.

---

## Mechanism

### Short version

`locationPref` is **never used as a filter and never used as a scoring input**. It is
carried through the entire pipeline as a display-only string. There is no location gate,
no location boost, and no minimum relevance score. Every active, eligible, affordable
project is returned to the model — all 83 of them — and for a segmented query the vector
score is only a *tertiary tiebreaker*, so even the semantic signal is discarded.

The model is then handed 83 projects with no instruction about relevance and picks a few.
It is behaving exactly as built.

### 1. `locationPref` is display-only

It enters the tool schema at `src/agents/finder/tools.ts:127`:

```ts
locationPref: z.string().nullable().describe('Location preference (e.g. "Cheras, KL"). null if not stated.'),
```

It is passed into `searchProjects` at `src/agents/finder/tools.ts:144`. Inside
`src/inventory/search.ts` it appears **exactly once** — at line 363, inside the
per-match `matchedCriteria` echo:

```ts
matchedCriteria: {
  segment: criteria.segment,
  priceMax: criteria.priceMax,
  nationality: criteria.nationality,
  bumiputera: criteria.bumiputera,
  locationPref: criteria.locationPref,   // ← src/inventory/search.ts:363 — the ONLY use
  bedrooms: criteria.bedrooms,
},
```

Grep confirmation (`src/inventory/search.ts`): `locationPref` appears at lines 82 (type
decl), 110 (type decl), 363 (echo). Nowhere else. It is not in a `.where()`, not in
`dotProduct`, not in `applySegmentWeights`.

The same is true of `priceMin` and `priceMax` — **also never filtered**. "budget 800k"
does nothing. Only `monthlyIncome` gates anything (via `affordabilityCeiling`), and only
when the model chooses to supply it. `bedrooms` is likewise not a filter; it only appears
as a *sort key* in the own-stay branch.

### 2. Stage A returns everything active

`src/inventory/search.ts:246`:

```ts
let q = projectsRef().where('status', '==', 'active')
```

Then, conditionally, `foreignEligible` (line 250) and `bumiQuota` (line 255). For a typical
tester query ("2-bedroom in Cheras, budget 800k") nationality is `unknown` and bumiputera
is `null`, so **neither conditional fires**. Stage A = all 83 active projects.

The affordability gate at lines 311–314 is skipped when `monthlyIncome` is null:

```ts
const ceiling = affordabilityCeiling(criteria.monthlyIncome)
const affordableDocs = criteria.monthlyIncome !== null
  ? candidates.filter(({ doc }) => doc.priceValue <= ceiling)
  : candidates
```

`affordabilityCeiling(null)` returns `Infinity` (line 153). Nothing is removed.

### 3. Stage B is a dot product over a blurb that is 97% description

`src/inventory/search.ts:331–340`:

```ts
const queryVector = await embedText(criteria.freeText, { inputType: 'query' })

const scored = affordableDocs.map(({ id, doc }) => ({
  id,
  doc,
  score: doc.embedding.length > 0 ? dotProduct(queryVector, doc.embedding) : 0,
}))

// Sort by score descending (highest dot product = most similar)
scored.sort((a, b) => b.score - a.score)
```

The document vector is built by `composeProjectEmbeddingText`
(`src/inventory/embedText.ts:54–68`):

```ts
const parts = [
  project.name,
  project.priceBand,          // e.g. "500k_800k" — price tier signal
  project.tenure,             // e.g. "freehold" | "leasehold"
  project.bedrooms ? `${project.bedrooms} bedrooms` : null,
  project.locationText,
  project.description,
]
return parts.filter((p): p is string => Boolean(p)).join(' · ')
```

Measured against the real import corpus (`projects.inventory.json`, 82 records):

| field | mean length | share of embedded text |
|---|---|---|
| `description` (raw Skool write-up) | 2,553 chars (median 2,226, max 6,855) | ~97% |
| `locationText` | 81 chars | **~3.1%** |

So the location phrase is ~3% of the signal in a single 1024-d vector, competing with a
full marketing write-up that includes the project PIC's name, a WhatsApp group link,
developer boilerplate, unit layouts, and facilities lists. A "Cheras condo" query matching
a Bangsar project on generic condo/KL/2-bedroom language is the expected outcome of this
encoding, not an anomaly.

### 4. There is no minimum-similarity floor

The KB retriever has one — `src/rag/search.ts:105`:

```ts
export const MIN_SIMILARITY = 0.35
```

...applied as `distanceThreshold` at `src/rag/search.ts:182`. **`src/inventory/search.ts`
has no equivalent.** Grep for `threshold` / `MIN_` in that file returns nothing. A project
scoring 0.05 against the query is returned identically to one scoring 0.8.

### 5. Segment weighting overwrites the vector ranking entirely

This is the sharpest part of the mechanism. `applySegmentWeights`
(`src/inventory/search.ts:174–210`) re-sorts the Stage-B output with the vector score
demoted to **tertiary**:

```ts
if (segment === 'investment') {
  return [...ranked].sort((a, b) => {
    if (a.doc.vpStatus !== b.doc.vpStatus) return a.doc.vpStatus ? -1 : 1   // primary
    if (a.doc.priceValue !== b.doc.priceValue) return b.doc.priceValue - a.doc.priceValue  // secondary
    return b.score - a.score                                                // tertiary
  })
}

if (segment === 'own_stay') {
  return [...ranked].sort((a, b) => {
    if (a.doc.bedrooms !== b.doc.bedrooms) return b.doc.bedrooms - a.doc.bedrooms          // primary
    if (a.doc.locationText.length !== b.doc.locationText.length)
      return b.doc.locationText.length - a.doc.locationText.length                          // secondary
    return b.score - a.score                                                // tertiary
  })
}
```

Note line 200–201: own-stay's secondary key is **the character length of `locationText`** —
a "location richness" proxy, acknowledged as such in the comment at line 166. Longer string
wins. This has no relationship to *where* the project is.

Because `priceValue` and `bedrooms` are near-unique across the corpus, the tertiary vector
score is almost never reached. **For any segmented query, the semantic score is
effectively dead.**

Simulating both sorts against the real 82-project corpus:

```
own_stay  top-5  (bedrooms desc, then locationText length desc)
  6br  Vila Setara Happy Garden        — Happy Garden, Kuala Lumpur
  6br  DAYA Residence                  — KWASA Damansara
  5br  Puncak Wangsamas Phase 2        — Wangsa Maju, Kuala Lumpur
  5br  Yanu Hills @ Bon Estates        — Taman Melawati, Selangor
  5br  Rafflesia @ Hill 2, 3 & 4       — Damansara Perdana

investment top-5  (vpStatus, then priceValue desc)
  vp RM6,425,000  AT6 Residensi @ Ampang Tengah
  vp RM5,150,000  Pinnacle Bangsar Residence
  vp RM4,276,250  Katana 2 Residence          — Uthant / KLCC
  vp RM2,280,000  St. Regis Residences KL     — KL Sentral
  vp RM1,740,000  Southpoint Residences (IGB) — Mid Valley City
```

For a "2-bedroom in Cheras, budget 800k" query classified as `investment`, the top of the
list the model sees is a RM6.4M Ampang project. The query text influenced nothing.

### 6. No cap — the model receives all 83 and self-selects

`src/inventory/search.ts:346` maps **every** reranked doc into `matches`; there is no
`.slice()`, no top-K. `FinderOutputSchema.matches` is `z.array(FinderMatchSchema)`
(`src/agents/finder/schema.ts:198`) with no `.max()`. The tool returns the whole
`SearchResult` verbatim (`src/agents/finder/tools.ts:141–152`).

So the production streaming path (`app/api/chat/route.ts:517–537` → `streamText` with
`finderAgent.buildSystemPrompt` + `makeTools`) hands the model an 83-element list and lets
it choose. The model's only guidance about *which* to choose is the prompt, covered below.

**Side finding (relevant to the usage-cap complaint in the same claim):** the serialized
83-project tool result is ~36,400 chars ≈ **10,100 tokens**, and it is re-sent on every
subsequent step of a `stopWhen: stepCountIs(5)` loop (`app/api/chat/route.ts:595`). One
Finder turn can therefore burn a large fraction of the 50,000-token/24h budget on inventory
payload alone. Any option that caps result count also reduces this.

### 7. What the prompt says about refusal

`src/agents/finder/prompt.ts:62–67`:

```
## Grounding (MANDATORY)
- Use the searchProjects tool BEFORE recommending any project.
- Only recommend projects returned by the searchProjects tool. NEVER invent a project, price, or availability.
- If searchProjects returns no_match or ineligible, deliver the grounded refusal — do NOT stretch or fabricate a match.
- Cite the projectId in every recommendation (e.g. "Project ID: project-kl-001").
- You CANNOT recommend a project that the tool did not return. The tool result is ground truth.
```

And `src/agents/finder/prompt.ts:104`:

```
- refusal (optional): { reason: "no_match"|"ineligible", explanation: string } — include ONLY
  when searchProjects returns no match. The explanation should reference the real gate result
  (e.g., financing, eligibility).
```

**This is the second half of the mechanism.** The refusal branch is conditioned entirely on
what the *tool* returns — "include ONLY when searchProjects returns no match". The tool
returned 83 matches. Therefore, per the prompt's own rule, a refusal would be **wrong**.
The model is explicitly forbidden from refusing here.

The prompt says nothing anywhere about location relevance, about how many matches to show,
about a relevance floor, or about labelling a result as outside the requested area. Grep
for "location" in `prompt.ts` returns only line 18 ("emphasise bedrooms, location, lifestyle
fit") and line 82 ("emphasise ... location return signals") — both of which *encourage*
citing location as a positive signal.

The model acknowledging "there is no project in Cheras" and then listing Bangsar/KLCC is
the only behaviour consistent with the instructions it was given: the tool said these are
matches, the prompt says the tool is ground truth, and refusing is prohibited.

### 8. A related mislabelling risk

The offline/test rationale builder `buildRationale` (`src/agents/finder/index.ts:349–354`)
emits, under a heading literally called **"Matched criteria"**:

```ts
if (match.matchedCriteria.locationPref) {
  criteriaHighlights.push(`location preference: ${match.matchedCriteria.locationPref}`)
}
```

and, at lines 344–348, `within budget (max RM800k)` derived from `matchedCriteria.priceMax`
— a field that, as established above, was never filtered on. So a RM2.5M Bangsar project
can be described as "Matched criteria: within budget (max RM800k); location preference:
Cheras".

`buildRationale` is only reached on the offline/`run()` path, not in production streaming.
But the *production* model receives the same `matchedCriteria` object per match in the tool
result, so it is being nudged toward the same false claim. The UI reinforces it:
`app/[lang]/chat/match-list.tsx:221–222` renders `criteria.locationPref` as a badge on the
result set.

---

## Data reality

**The prior probe's finding was a false alarm caused by probing field names that do not
exist.** `ProjectDoc` (`src/firebase/collections.ts:212–269`) has **no** `area`, `location`,
`region`, or `state` field. The only location field is:

```ts
/**
 * Location text (e.g. "Cheras, Kuala Lumpur — near LRT Taman Connaught").
 * Feeds the embedding-text composer for semantic location matching.
 */
locationText: string
```
— `src/firebase/collections.ts:258–261`

A probe printing `area` and `location` would print "—" for all 15 samples because those keys
are `undefined` on every document. That says nothing about the data.

**Verified against the real import corpus** (`projects.inventory.json` — the dry-run preview
that was subsequently `--apply`'d to Firestore by
`scripts/scrape-skool/to-inventory.ts`, generated 2026-07-19, 82 records):

| metric | value |
|---|---|
| records | 82 |
| `locationText` **empty** | **0** |
| `locationText` populated | **82 / 82 (100%)** |
| mean `locationText` length | 81 chars |
| max `locationText` length | 207 chars |
| validation errors | 0 |
| `priceValue == 0` (unknown) | 32 / 82 |
| `bedrooms == 0` (unknown) | 29 / 82 |

The prior probe's live count of 87 projects / 83 active is consistent with these 82 imported
records plus a handful of earlier seed/test projects.

Samples (first 5, verbatim):

```
1. Pusat Bandar Damansara, Jalan Damanlela, Kuala Lumpur; integrated with DC Mall, Sofitel KL Damansara
2. Seputeh, Centre of KL
3. Pavilion Damansara Heights Phase 2, Centre of KL
4. Lorong Maarof, Bangsar, 400m to Bangsar LRT Station & 450m to Bangsar Village Shopping Mall, near KLCC and Bangsar CBD
5. KL Eco City, Kuala Lumpur; near Mid Valley Megamall, The Gardens Mall, LRT & MRT stations
```

The data is not just present — it is rich, human-readable, and consistently structured as
*neighbourhood, city, nearby landmarks/transit*. `to-inventory.ts:55` extracted it with a
dedicated LLM field and `:92` falls back to the Skool section name if extraction is empty,
which is why the empty count is zero.

### The Cheras fact

**There is not one Cheras project in the inventory.** Searching all 82 records across
`name` + `locationText` + `description`: **0 matches** for /cheras/i.

The tester's observation is factually correct.

Area distribution (top tokens across all `locationText` values):

```
23  Kuala Lumpur          5  KL South            3  Seputeh
10  Centre of KL          5  KLCC/Bukit Bintang  3  Damansara Heights
 8  KLCC                  4  Petaling Jaya       3  Bukit Jalil
 7  Bangsar               4  KL East / KL North  3  Jalan Ampang
```

The portfolio is concentrated in central/western KL (Bangsar, Damansara, KLCC, Mid Valley,
Seputeh) and PJ. Cheras is south-east KL. There is genuinely nothing to show.

### The inventory has no geographic concept at all

Grepped `src/` and `app/` for: `adjacent`, `nearby`, `district`, `taxonomy`, `proximity`,
`distance`, `geohash`, `latitude`, `longitude`, plus KL area names. Results:

- `src/rag/search.ts` — "distance" refers to Firestore `DOT_PRODUCT` vector distance.
- `src/reply/diff.ts` — "distance" refers to Levenshtein edit distance.
- `src/inventory/search.ts:263` — "adjacent" refers to adjacent *price bands*.
- `src/coach/journey/config.ts:16` — "taxonomy" refers to onboarding checkpoints.

**No geographic taxonomy, no area list, no adjacency graph, no coordinates, no region
hierarchy exists anywhere in the codebase.** "Close to Cheras" is not computable today, and
nothing in the system can currently distinguish "Ampang is 8km from Cheras" from "Cyberjaya
is 40km from Cheras". Both are simply non-Cheras strings.

### Bonus: the app itself invites this exact query

The suggested-prompt chip shipped in all three locales is a Cheras query:

- `src/i18n/messages/en.json:26` — `"finder": "Find me a 2-bedroom in Cheras, budget 800k"`
- `src/i18n/messages/ms.json:28` — `"Cari saya unit 2 bilik di Cheras, bajet 800k"`
- `src/i18n/messages/zh.json:28` — `"帮我找 Cheras 一间两房单位，预算 80 万"`

The tester most likely tapped the suggestion. The single most-surfaced Finder example in the
product is guaranteed to hit the worst case: an area with zero inventory, plus a budget that
is never applied. Whatever else is decided, this string is a live landmine.

---

## Options

Presented for decision. Not ranked, no recommendation.

All options preserve the two hard constraints: `searchProjects` keeps enforcing
`status:'active'`, and the Finder may only cite projects the tool returned.

---

### Option A — Hard location filter + honest refusal

**What changes.** Add a location gate to Stage A/B: when `locationPref` is non-null, keep
only projects whose `locationText` matches it (normalized substring / token match). If the
set empties, return `{found:false, reason:'no_match'}`. Add a `## Location` section to
`prompt.ts` so the model explains the miss and offers to widen the area.

**Cost.** ~20 lines in `src/inventory/search.ts`, one prompt section, new test cases in
`src/inventory/search.test.ts` (which already fixtures a Cheras project at line 74, so the
harness exists). No new data, no new dependency, no re-embedding.

**Risk.** Naive string matching is brittle. "KL" matches 23 projects; "Bangsar" matches 7
but misses "Bangsar South" vs "Bangsar" nuance; "Mont Kiara" matches nothing in
`locationText` but does appear inside `description`. A user typing "KLCC area" or "南部"
gets nothing. Trades a false-positive problem for a false-negative problem, and false
negatives are invisible — the agent looks like it has no inventory. Also loses the "extra
info" the tester noted was *good*.

**Does the data support it today?** **Yes.** `locationText` is 100% populated and
consistently formatted. Substring matching on it would work for the common KL area names.

---

### Option B — Keep alternatives, but label them explicitly as outside the area

**What changes.** `searchProjects` computes a location match per project and returns it as
a field on `ProjectMatch` (e.g. `locationMatch: 'exact' | 'none'`), partitioning the
response into `matches` (in-area) and something like `alternatives` (out-of-area). Prompt is
updated to state plainly that there is no inventory in the requested area *before* listing
anything, and each alternative is rendered with its actual area. `match-list.tsx:221` stops
rendering `locationPref` as an unqualified badge on out-of-area results.

**Cost.** Larger than A: schema change (`ProjectMatch`, `FinderMatchSchema`,
`FinderOutputSchema`), prompt change, UI change in `app/[lang]/chat/match-list.tsx`, plus
tests. Touches the Finder output contract, so `decode-structured-output.test.ts` and the
route tests move too.

**Risk.** Adds a third output state alongside `matches` / `refusal` / `clarifyingQuestion`,
whose mutual-exclusion invariant is documented at `src/agents/finder/schema.ts:186–187`. Now
"no match" and "here are results" are simultaneously true, which is exactly the ambiguity
that invariant was written to prevent. Needs care or it becomes a source of confused output.

**Does the data support it today?** **Partially.** Labelling something "outside your area"
only needs an exact-match test, which `locationText` supports. But the alternatives shown
would still be ordered by the same broken ranking (Option D applies here too) — you would be
honestly labelling an arbitrary list.

---

### Option C — Build a location taxonomy first, then filter with adjacency

**What changes.** Introduce a KL/Selangor area taxonomy (area → district → region, plus an
adjacency or drive-time table). Add a structured `areaId` to `ProjectDoc`, backfill it for
all 87 projects, resolve `locationPref` to an `areaId` at parse time, then filter on exact
area with a documented fallback to adjacent areas — which would make "close to Cheras"
(Ampang, Kajang, Balakong, Seri Kembangan) an actual computation instead of a guess.

**Cost.** By far the highest. A taxonomy that has to be authored and owned (Derek), a
schema migration + backfill script, a change to the criteria parser, and an ongoing
maintenance burden — every new project import needs a correct `areaId`. Also probably an
`appConfig` surface so the taxonomy is editable without a deploy.

**Risk.** Scope. This is a phase, not a quick task. Malaysian area naming is genuinely
messy (Cheras spans both KL and Selangor; "KL South" is a marketing term, not a boundary).
An adjacency table encodes judgement calls that will be argued about. Highest chance of
being half-built and abandoned.

**Does the data support it today?** **No — but the raw material is there.** `locationText`
is populated and rich enough that an LLM backfill pass could derive `areaId` for most of the
87 projects with human review. Nothing needs to be re-scraped. This is the only option that
makes "close to Cheras" real rather than approximated.

---

### Option D — Fix the ranking, leave the show/no-show policy alone

**What changes.** Do not add a location filter. Instead: (i) add a `MIN_SIMILARITY` floor to
`src/inventory/search.ts` mirroring `src/rag/search.ts:105`; (ii) cap `matches` at top-N
(5–10) rather than returning all 83; (iii) demote `applySegmentWeights` from a full re-sort
to a tiebreak/boost so the vector score stays primary; (iv) optionally weight `locationText`
into the embedded text (repeat it, or drop `description` to a summary) so location is more
than 3% of the vector.

**Cost.** Contained to `src/inventory/search.ts` and `src/inventory/embedText.ts`. Item (iv)
requires **re-embedding all 87 projects** (a Gemini cost + a backfill run). Items (i)–(iii)
are cheap and need no data change. Also cuts the ~10k-token tool payload noted above, which
directly helps the usage-cap complaint in this same claim.

**Risk.** Changes FIND-09 behaviour, which has an explicit test contract — "Investment vs
own-stay MUST produce a different top-1/top-3 for the same eligible set (Pitfall 4)"
(`src/inventory/search.ts:27–29`). Demoting segment weights could break that test and
requires re-deciding what FIND-09 means. Does not solve the reported symptom directly: a
Cheras query would still return non-Cheras projects, just *better-chosen* non-Cheras
projects. The tester might report it again.

**Does the data support it today?** **Yes for (i)–(iii)** — pure logic, no data dependency.
**Yes for (iv)**, since `locationText` is populated; it only needs a re-embed.

---

### Option E — Leave as-is, fix only the suggested prompt

**What changes.** Accept the current behaviour as intentional ("extra info"). Change the
three `suggestions.finder` strings to an area D2 actually sells in (Bangsar, Mont Kiara,
Bukit Jalil) so the flagship demo query stops hitting a zero-inventory area.

**Cost.** Three string edits in `src/i18n/messages/{en,ms,zh}.json`.

**Risk.** The underlying behaviour is unchanged: an agent asking about any real area with no
D2 inventory still gets a confident list of unrelated projects, and the UI still badges them
with the requested location (`match-list.tsx:221`). It hides the demo case without
addressing the trust issue — a new agent shown a Bangsar project under a "Cheras" badge
learns to distrust the tool. Also leaves the false "within budget" claim untouched.

**Does the data support it today?** N/A — no data dependency.

---

## Prerequisite

**The location data is there.** `locationText` is populated on 82/82 imported projects,
averaging 81 characters, consistently formatted as *neighbourhood, city, nearby landmarks*.
Options A, B, D, and E can all proceed today with no data work.

The prior probe's "all empty" reading was an artefact of querying `area` / `location` —
field names that do not exist on `ProjectDoc`. That should not block anything.

**What is genuinely missing is structure, and only Option C needs it.** For adjacency —
i.e. for the system to know that Ampang is near Cheras and Cyberjaya is not — the following
would have to exist first:

1. **A canonical area list** for Klang Valley (Derek-owned; ~60–100 entries), with aliases
   covering EN/BM/中文 forms and marketing labels ("KL South", "Centre of KL", "Golden
   Triangle") that already appear in the corpus.
2. **An `areaId` field on `ProjectDoc`**, backfilled for all 87 projects. Derivable from
   existing `locationText` via an LLM pass plus human review — no re-scrape needed.
3. **An adjacency or drive-time relation** between areas. This is a judgement artefact, not
   a derivable one, and needs an owner.
4. **Area resolution in the criteria parser**, so free-text "Cheras" / "蕉赖" / "Cheras KL"
   all resolve to the same `areaId`.

Without (1)–(4), "not close to Cheras at all" remains a human judgement the system cannot
make. Options A and B can only ever answer *"is this in Cheras: yes/no"* — never *"how far
from Cheras"*.

**One item is independent of whichever option is chosen:** the `matchedCriteria` echo
currently asserts that `locationPref` and `priceMax` were matched when neither was ever
filtered on (`src/inventory/search.ts:363`, surfaced at `src/agents/finder/index.ts:344–354`
and `app/[lang]/chat/match-list.tsx:221`). Under every option except a full location filter,
that echo is a false grounding claim.
