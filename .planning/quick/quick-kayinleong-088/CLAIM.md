# Claim: quick-kayinleong-088
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-05
- status: in-progress
- summary: the Finder's Price column was not a render bug — 36 of 87 projects hold no price, and 21 of the 51 that do were INVENTED by the extractor multiplying a psf rate by a square footage it made up. Separately, all 25,153 finder kbChunks were stored as plain arrays, so `findNearest` silently returned nothing and the entire Skool/Drive/WhatsApp knowledge base was unreachable

## The two reported symptoms

1. **Detail depth (Task 1).** When a client asks for more details the agent must answer at the
   depth of the stakeholder's pasted "Imperial Residences (RA)" reference: per-layout size →
   price ranges, Quick Facts (developer, title, VP target, bookings, parking, maintenance fee,
   furnishing, panel bankers + margins), and selling points.
2. **Missing prices (Task 2).** The Finder table renders 50 matching projects with Price (RM)
   `—` on all but one. Suspected cause: material uploaded but never ingested.

## What research established

Three parallel read-only research agents. Full reports in this directory:
`RESEARCH-price-audit.md`, `RESEARCH-ingestion-coverage.md`, `RESEARCH-detail-output.md`.

### Finding 1 — the knowledge base was ingested but invisible (the big one)
1,079 kbDocs / **25,210 chunks** existed, 8.76M embedding tokens already paid for. But
`kbChunks.embedding` was a plain `number[]`, and a Firestore vector index does not cover plain
arrays — so `findNearest` returned **zero rows for every Finder query, silently, with no error**.
Measured reachability before the fix: coach 47/47, reply 10/10, **finder 0 of 25,153**.

`quick-kayinleong-066` diagnosed this exact bug and fixed it for `--pillar coach` (14 chunks).
`backfill-kbchunk-vectors.ts` was **never run for finder**. Every Skool Drive doc, OCR
transcription and WhatsApp transcript predated the pipeline fix and was left behind.

### Finding 2 — 21 of 51 stored prices are fabricated
Not missing data — *wrong* data. The extractor turned a stated per-sqft rate into a total by
multiplying by a square footage it invented. Verified verbatim against `projects.json`:

| Project | Source text states | Stored `priceValue` |
|---|---|---|
| Luminar Residence Subang | `Gross Price: RM720 psf` + `Prices below RM800K!!` | RM 360,000 |
| The Lantern Bangsar | `Price: RM1,400 psf (Gross)` | RM 798,800 |
| Bangsar Hill Park | `RM900-1000psf` | RM 900,000 |
| Pinnacle Bangsar Residence | `Package A (Bare Unit): ~RM1,100 psf` | RM 5,150,000 |

The one price visible in the user's screenshot (Luminar, RM 360,000) is fabricated — and its
own write-up says prices are *below RM800K*. `matchedCriteria.priceMax` was asserting a
verified budget match on these numbers.

### Finding 3 — `priceBandFor(0) === 'under_500k'`
36 unpriced projects were stored and vector-pre-filtered as the cheapest stock in the
inventory. `src/agents/finder/schema.ts:242` had already documented the trap and worked around
it downstream instead of fixing the source.

### Finding 4 — missing prices are mostly genuinely absent from source
Of the 32 unpriced active projects: **30 state no price of any kind**, 1 was cut off by
`extractPrompt`'s 6,000-char `slice` (Royal Lexis KL, price at char 6,332), 1 is an all-sold-out
range. So **re-ingesting Skool text cannot supply them** — the per-layout price tables live in
the Google Drive sales kits, only 7 of 82 Skool write-ups contain one.

### Finding 5 — the "Details" button was never a detail endpoint
085's per-row action pushes a canned translated sentence back through a normal Finder turn,
re-running the same semantic search. The model sees only `MAX_MATCHES=8`, so clicking row 37 of
50 can hand it eight *different* projects. No by-id lookup existed anywhere in the repo.

## Decisions (user-confirmed 2026-09-05)

- **D1 — Fabricated prices: null them, store psf honestly.** Set the 21 to `priceValue: 0`,
  add `pricePsfMin`/`pricePsfMax`, render `RM1,400 psf` rather than a fake total. The Price
  column gets emptier; that is correct. A wrong price quoted to a client is worse than a blank.
- **D2 — Also produce a data-completeness report** (user's explicit follow-up): per property,
  which fields are missing.
- **D3 — Full scope for Task 1:** project-scoped detail tool + deterministic `unitTypes[]`
  layout extraction + re-ingest the Drive material.
- **D4 — All ingestion/extraction AI runs on the user-supplied Gemini key** for this session,
  not the production Claude/Gemini credentials. Key verified working for
  `gemini-embedding-001` @1024-d and `gemini-3.5-flash`. Held in a `chmod 600` file OUTSIDE the
  repo; never committed, never logged, referenced in docs only as `<GEMINI_API_KEY>`.

## What has changed

- **`src/firebase/collections.ts`** (commit `e299fcc`) — schema contract: `'price_unknown'`
  band; `priceBandFor(v<=0)` returns it; `ProjectDoc` gains `pricePsfMin`/`pricePsfMax`,
  `priceProvenance`, `unitTypes?: UnitTypeEntry[]`; new `UnitTypeEntry` interface carrying `raw`
  as the grounding audit trail.
- **All 25,210 kbChunks converted to the Firestore VECTOR type** via
  `backfill-kbchunk-vectors.ts --pillar finder --apply` (25,153 converted; the other 57 were
  already done by quick-066). Zero token cost — it re-wraps existing vectors.

- **Finder retrieval lane — DONE** (commits `8ba6992`, `a0c90d2`, `f8a1871`, `981ccc5`):
  - `src/inventory/search.ts` — new `getProjectDetail(projectId)` + `ProjectDetail` type. A
    direct `projects/{pid}` read; the repo had no by-id or by-name lookup at all. Built
    field-by-field, never a spread, so `embedding` is structurally unreachable from a model
    payload and a future `ProjectDoc` field cannot leak into one by default.
  - `src/agents/finder/tools.ts` — `makeProjectDetailTool`: the scalars **plus
    `description`**, `unitTypes`, `pricePsfMin/Max`, `priceProvenance`, ranked `collateral`,
    and `retrieve(name + question, lang, { pillar:'finder' })` for the sales-kit prose with
    its chunk IDs. Registered as a fourth tool in `finder/index.ts`.
  - `src/agents/finder/prompt.ts` — a "DETAIL REQUEST" section binding the marker
    `projectId: <id>` to `projectDetail` and forbidding `searchProjects` for it; plus the
    `unitTypes`-verbatim, psf-is-a-rate-not-a-total, cite-the-KB and no-bank-in-details rules.
  - `src/i18n/messages/{en,ms,zh}.json` + `match-table.tsx` — the Details button now emits
    that marker in all three languages (marker deliberately untranslated).
  - `src/agents/finder/tools.ts` — `toInventoryRows` strips `embedding` from
    `queryInventory`'s result and excerpts `description`.
  - `src/rag/search.ts` — `MIN_SIMILARITY` re-measured and now **per-pillar**
    (`MIN_SIMILARITY_BY_PILLAR` + `minSimilarityFor`).

In flight (parallel executors): unit-type parser + price correction + completeness report;
ETL provider switch + prompt hardening + Drive ledger rebuild.

## Verification

### Retrieval — the fix is proven, not asserted
`backfill-kbchunk-vectors.ts` re-run dry across **all** pillars after apply:
`scanned 25210 · converted 0 · already vector 25210 · no embedding 0`.

Live `retrieve(q, 'en', { pillar: 'finder' })` probe — this content was returning **nothing** an
hour earlier:

| | Query | Hits | Top score | Top chunk |
|---|---|---|---|---|
| ✅ | panel bankers loan margin for Imperial Residences | 8 | **0.8337** | `Panel Bankers EF for Imperial Residences RA: 1. MBB (Margin up to 90%}…` |
| ✅ | Imperial Residences Pavilion Damansara Heights price per layout | 8 | **0.8015** | `PAVILION DAMANSARA HEIGHTS PARCEL 2 RA … (A) SELLING PR…` |
| ✅ | maintenance fee per square foot and booking fee | 8 | 0.7117 | `Maintenance fee - RM 0.80 psf + 10% sinking fund…` |
| ✅ | studio 504 sqft price range | 8 | 0.7072 | `Unit Floor Side Type Sqft SPA Price SPA PSF …` |
| ⚠ | *control:* banana bread recipe | 8 | 0.5700 | — |
| ⚠ | *control:* how do I change a car tyre | 2 | 0.5576 | — |

The Task 1 reference content — panel bankers with margins, selling prices, maintenance fee psf,
per-unit SPA price tables — **is in the corpus and now reachable.**

### Finder retrieval lane — measured results

**`projectDetail`, live, on the real corpus** (`PDH: Imperial Residences RA`,
`WsCKdwpNCvFwHy5cHTH6`): `found:true`, **2,827 chars of write-up** (the field every other
Finder path dropped), 12 ranked collateral items out of 288, **5 KB citations** whose top
chunk is `Panel Bankers EF for Imperial Residences RA: 1. MBB (Margin up to 90%} 2. CIMB
(Margin up to 85%)…` — content the prior research measured as **0 of 82** in the Skool
corpus. Whole payload 13,078 chars (~3,535 tokens) for one project; no `embedding`; an
unknown ID returns `found:false`.

**Status decision.** `projectDetail` does NOT filter `status:'active'`; `searchProjects` and
`queryInventory` still do and were not touched. A detail lookup is not a recommendation —
an agent who cannot look up a sold-out project cannot tell a lead it is sold out. The guard
rail is that `status` travels with the payload and a loud `availability` warning is raised
for anything non-active, which the prompt requires the agent to lead with. Pinned by test
(`sold_out` and `hidden` both flagged; `active` carries no warning field, so the field keeps
its meaning; `searchProjects` still asserts `['status','==','active']`).

**Details-button fix, proved by reproducing the failure.** On a real 50-project search with
the Details sentence as `freeText`, the target sits at index **36** of the raw result and is
**absent** from the tool's actual `toModelOutput` projection, which carries eight different
projects (`proj-0` first). The by-id read then resolves that same ID with no embed call and
no collection scan. All 50 resolve by ID.

**Embedding payload, measured through the real code path** (83 active projects, one call):
`2,067,567 chars ≈ 558,800 tokens` → `62,374 chars ≈ 16,858 tokens`, **−96.98%**. Per
project the vector was 21,857 of ~24,400 chars (**98%**). Against a `TOKEN_CAP` of 300,000
per agent per 24h, one broad call could have exceeded a full day's budget ~10x.

**Similarity floor, re-measured 2026-09-05** — 10 relevant + 10 off-topic controls per
pillar, `findNearest` with no threshold:

| pillar | chunks | RELEVANT top | CONTROL top | all-chunk gap | floor |
|---|---|---|---|---|---|
| finder | 25,153 | 0.7114 – 0.8337 | 0.5423 – 0.6152 | 0.6152 → 0.6884 | **0.65** |
| coach | 47 | 0.5632 – 0.7076 | 0.4701 – 0.5321 | 0.5321 → 0.5395 | **0.55** |
| reply | 10 | 0.6228 – 0.7457 | 0.4448 – 0.5328 | 0.5328 → 0.5666 | **0.55** |

At 0.55, **52 of 80** finder control chunks were admitted. One number cannot serve all
three: 0.65 on coach would return nothing for "how do I get my REN tag" (top 0.5632); 0.55
on finder admits banana bread. The no-pillar default is the finder number because an
unfiltered query searches a corpus that is 99.8% finder chunks — verified on that path.
Two caveats recorded in the code comment, not smoothed over: 0.55 sits *above* the 0.0074-wide
coach gap (drops the tail of the top-8, keeps every real question's best chunk), and
coach/reply remain thin at 47 and 10 chunks.

### Regression surface opened by this claim
- ~~`MIN_SIMILARITY = 0.55` needs re-measurement~~ **DONE** (`981ccc5`) — see the table
  above. Per-pillar floors; `src/rag/search.ts` is the only consumer, so no call site changed.
- **Known behaviour change, and it is a truthfulness fix.** `src/agents/coach/tools.ts` calls
  `retrieve(query, userLang)` with **no pillar**, so coach questions are answered from the
  finder corpus today ("how do I get my REN tag" → 8 property write-up chunks, 0 coach
  chunks). Under the 0.65 default those return nothing and the Coach emits an honest
  `kb_miss` + handoff (D-10) instead of citing project marketing at an onboarding question.
  The real fix is for the Coach to pass `{ pillar: 'coach' }` — separate claim, a file this
  lane does not own.
- **`queryInventory`'s tool-result shape changed** (`ProjectDoc` → `InventoryRow`:
  no `embedding`, `description` → `descriptionExcerpt` + `descriptionTruncated`). Ruled out:
  the route does not read this tool's result (only `searchProjects`' sink feeds
  `messageMetadata`), nothing persists it, and every scalar FIND-07 answers with is
  untouched — asserted by test.
- **Adding a fourth tool key** widens `ReturnType<typeof finderAgent.makeTools>`, which
  `app/api/chat/route.ts` derives `agentTools` from. Typecheck clean; `route.test.ts` green.
- Ruled out for `getProjectDetail`: purely additive to `src/inventory/search.ts` (161
  insertions, 1 deletion — an import line), and it shares no code path with the Stage-A/B
  search. `searchProjects`, `queryInventory` and the location/price/affordability gates are
  byte-identical.

### Test evidence
`npm run typecheck` clean apart from the two pre-existing `.next/dev/types/validator.ts`
generated-file errors. `npx vitest run src/agents/finder src/inventory/search.test.ts
src/inventory/crud.test.ts src/rag "app/[lang]/chat"` → **19 files, 408 passed, 4 skipped**.
New: `src/agents/finder/project-detail.test.ts` (22), plus blocks appended to
`tools.test.ts`, `rag.test.ts` and `match-table.test.ts`.

⚠ **Unrelated failures seen in the full-suite run, NOT from this lane:**
`tests/finder-corpus-gates.test.ts` (7) and `src/inventory/size-extract.test.ts` (10) assert
corpus counts read from `projects.inventory.json` — a **gitignored local fixture**
(`.gitignore:59`) that a parallel executor regenerated at 22:25 with **3 records** instead
of the 82 those tests were measured against. Neither file imports anything this lane
changed (`locationNeedles`, `projectMatchesLocation`, `projectMatchesPrice`,
`extractSizeRange` are all untouched). Regenerate the full 82-record fixture before reading
those suites.
- Adding `'price_unknown'` to `PRICE_BANDS` widens a model-facing tool enum
  (`finder/tools.ts:359`). Typecheck found no exhaustive-switch breakage.
- Nulling 21 prices means more `priceValue: 0` rows. `priceBand` text sits inside the project
  embedding, so corrected projects are candidates for re-embedding — to be quantified, not
  silently skipped.

### Still outstanding
- Drive coverage: ~90–133 text-bearing files unaccounted for, 94 OCR'd PDFs unrecovered, and
  **3,573 images with no ingest path at all** — likely where the remaining per-layout price
  tables and floor plans live.
- `drive-kb-ledger.json` and the `google-profile` session dir are gone from disk; the ledger
  must be rebuilt from Firestore before any re-ingest, or `to-kb.ts --apply` duplicates
  everything.
