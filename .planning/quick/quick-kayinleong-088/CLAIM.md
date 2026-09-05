# Claim: quick-kayinleong-088
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-05
- status: done
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

- **Data lane — DONE** (`faae499`, `d87ee10`, `f01a3b3`, plus the price apply):
  - `src/inventory/unit-types.ts` + 50 tests — deterministic regex parser, no LLM, mirroring
    the `size-extract.ts` / D1 precedent. Handles both corpus orderings, `sf`/`sft`/`sqft`,
    `k`/`m`/`mil`, and treats `1+1Room` as 1 bedroom. Every guard mutation-tested by
    reintroducing the bug, which exposed a psf guard that could never fire (removed rather
    than shipped as untested dead weight). **50 of 82 write-ups tabulate layouts** — the
    opposite of the 7/82 the earlier research implied, which counted only layout tables that
    also carry prices.
  - `scripts/fix-fabricated-prices.ts --apply` — classified all 87 from the live
    `description`: **stated 32 · psf_only 20 · unknown 35**. 21 `priceValue` → 0 (exactly the
    21 predicted), 57 `priceBand` recomputed, 20 psf rates stored, provenance on all 87.
    Idempotent; re-run is a no-op.
  - `scripts/backfill-unit-types.ts --apply` — 50 projects, **261 layout entries** (24
    priced, 180 with bedrooms). Not re-embedded, per D1.
  - `scripts/data-completeness-report.ts` → `DATA-COMPLETENESS.md`.
- **ETL lane — DONE** (`66c4328`, `89f88cf`, `d9f98c1`):
  - `to-inventory.ts` — one `buildExtractModel()` helper behind an `EXTRACT_PROVIDER` switch
    (`google` → `@ai-sdk/google`; unset/`anthropic` → unchanged, `/v1` pin intact) so the
    provider cannot drift between call sites.
  - Prompt + schema hardened against the fabrication, with **mechanical guards** rather than
    prompt text alone: `priceEvidence` requires the model to quote the verbatim substring and
    the price is zeroed if it is not found in the source; `sanePsf()` clamps to RM200–5,000
    so a RM0.88 maintenance fee can never land in a price field. Truncation raised
    6,000 → 24,000 chars (longest write-up is 6,855 — Royal Lexis's price sat at 6,332).
  - `rebuild-kb-ledger.ts` — reconstructs the lost ledger from Firestore. My follow-up fix:
    a matched kbDoc must have **≥1 chunk** to count as ingested, which pulled 40 scanned
    sales-kit PDFs back into the queue instead of marking them done forever.
  - `.gitignore` — `skool-state.json` / `google-state.json` / `google-profile/` hold **live
    auth cookies** and matched no ignore pattern.
- **`scripts/reembed-projects.ts --apply`** — 87 vectors refreshed after the band change.
- **`src/agents/coach/tools.ts`** — `{ pillar: 'coach' }` on both retrieve calls (see
  Regression surface).

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

**Full suite, after the fixture was restored: 77 files passed / 4 skipped · 1337 tests
passed / 197 skipped · 0 failures.**

The 17 failures a parallel lane reported were mine: my 3-project live Gemini test overwrote
`projects.inventory.json`, a gitignored 82-record fixture that `finder-corpus-gates.test.ts`
and `size-extract.test.ts` read. Regenerating it in full both repaired the fixture and
validated the new extraction across the whole corpus — **82 mapped, 0 validation errors, 0
extraction failures, 34 psf rates captured, 0 unverifiable prices**.

### Corpus gates re-baselined — the movement IS the result
`tests/finder-corpus-gates.test.ts` pinned pre-correction counts. Updated, with the reason
recorded in the test:

| Gate | Before | After |
|---|---|---|
| unpriced projects | 32 | **52** |
| survive a RM1m budget | 50 | **61** |
| priced *within* that budget | 18 | **9** |

That last row is the sharpest measure of what this was worth: of 18 projects that matched a
RM1m budget on a real-looking number, only **9** had a total price written anywhere in
source. Nine were arithmetic. More rows survive now, not fewer, because an unpriced project
passes any bound — the table is honest about what it does not know instead of filling the
column with invention.

### Stale vectors — closed
`composeProjectEmbeddingText` includes `priceBand`, and the price fix recomputed the band for
57 of 87 projects by writing Firestore directly, bypassing `updateProject`'s
embed-on-relevant-change guard. Left alone, that reproduces the original bug in the vector
space: 36 unpriced projects were embedded as `under_500k`, so a semantic query for cheap
stock keeps matching them.

`scripts/reembed-projects.ts --apply` → **87 embedded, 0 failed, 0 dim mismatch**, written
with `FieldValue.vector()`. Final band distribution:

```
price_unknown 57 · above_1.2m 19 · 500k_800k 7 · 800k_1.2m 4     (under_500k: 0, was 38)
```

### Live end-state of the projects the audit named

| Project | `priceValue` | psf | provenance | band | layouts | vector |
|---|---:|---|---|---|---:|---|
| Luminar Residence Subang | 0 | 720 | psf_only | price_unknown | 5 | ✓ |
| Bangsar Hill Park | 0 | 900–1000 | psf_only | price_unknown | 6 | ✓ |
| PDH: Imperial Residences RA | 0 | **1700–2300** | psf_only | price_unknown | 4 | ✓ |
| The Lantern Bangsar | 0 | 1400 | psf_only | price_unknown | 5 | ✓ |
| Pinnacle Bangsar Residence | 0 | 1100–1300 | psf_only | price_unknown | 3 | ✓ |

Imperial Residences reads `1700–2300` psf, which is verbatim its source
("Price range: Rm1700 - Rm2300 per sft"). It was previously stored as RM1,700,000 —
1700 × an invented 1,000 sqft.

### Data completeness (the report the user asked for)
`DATA-COMPLETENESS.md`, live-measured. 87 projects / 83 active. What a client asking
"how much?" can be told:

| Price signal | All 87 | Active |
|---|---:|---:|
| a stated total | 30 (34.5%) | 30 (36.1%) |
| a psf rate only | 20 (23.0%) | 20 (24.1%) |
| per-layout prices only | 0 | 0 |
| **nothing** | **37 (42.5%)** | **33 (39.8%)** |

Missing-field ranking: `pricePsf` 67 · `vpDate` 64 · `priceValue` 57 · `unitTypes` 37 ·
`bedrooms` 33 · `size` 20 · `tenure`/`locationText` 4 (all hidden docs) · `collateral` 1 ·
`description` 0.

### Regression surface
- `'price_unknown'` widens a model-facing tool enum (`finder/tools.ts:359`). Typecheck found
  no exhaustive-switch breakage; full suite green.
- **Coach retrieval regression, found and fixed inside this claim.** Both `retrieve()` calls
  in `src/agents/coach/tools.ts` passed no pillar — harmless only while finder chunks were
  unreachable. Making them reachable meant onboarding questions resolved against a corpus
  that is 99.8% property content, and the new per-pillar floor (no-pillar ⇒ finder's 0.65)
  pushed lower-scoring coach content under the bar. Measured: "how do I get my REN tag" and
  "what training do I need in my first week" both went to **0 hits**; "what is the D2
  onboarding process" returned 8 hits of which **6 were finder chunks**. Fixed by passing
  `{ pillar: 'coach' }`; the two tests that broke were pinning the old two-argument call and
  now assert the pillar, so they guard the fix.
- 2 projects are classified `stated` but hold 0 — the price exists and was lost: Royal Lexis
  KL (RM1.72M, past the old 6,000-char truncation) and d'Brightton (priced but all sold out).
  Which figure is the asking price is Derek's call, not a code fix.

## Still outstanding — blocked, not forgotten

**Further Drive ingestion requires a human Google sign-in. I cannot do this step.**
`drive-documents.json` records `downloadedBytes: 0` — the crawl only ever *enumerated*
metadata, and no payload directory exists on disk. `google-state.json` / `google-profile`
are gone. `gdrive-login.ts` opens a headed browser for a person to complete password + 2FA
and states "No Google credentials are handled here — the human signs in."

Queue once signed in (`SCRAPE_OUT` must be set — `to-kb.ts` asserts it and cannot read a
repo-root ledger):
1. `gdrive-login.ts` → `GDRIVE_PHASE=download` → `to-kb.ts --apply` → `to-kb-ocr.ts`
2. **128 text-bearing Drive files**: 88 with no kbDoc + **40 whose kbDoc holds zero chunks**
   (scanned PDFs — `Aetas Seputeh Sales Kit V1.2`, `Sentral Suites - MRCB Sales Kit (All
   Towers)`, `PAVILION SQUARE LR PROJECT BRIEF`). Delete the stale empty kbDocs first
   (`kb-cleanup.ts`) or re-ingest duplicates them.
3. **3,573 images have no ingest path at all.** Triage before spending: only ~180 have
   document-like filenames, 1,234 are generic camera/WhatsApp names, and many are Facebook
   ad creatives. Sample and measure the yield rather than OCR-ing all of them into the
   corpus — retrieval precision is already the thin margin here.
4. **20 WhatsApp kbDocs hold zero chunks** (Eaton, The MET, Conlay, d'Brightton,
   Ritz-Carlton, OAKA, The Atera, Royal Suites). `KbDocDoc` has no text field, so nothing is
   recoverable from Firestore — these need the original zip re-imported through the admin
   WhatsApp surface. **Not blocked on Google**; blocked on the user having the zip.

Deliberately not done: `unitTypes` adds no new price signal for any project (0 projects are
"per-layout only"), so the 24 priced layout entries enrich detail answers without changing
match counts. The similarity floor is measured on Imperial-Residences-weighted queries
against one corpus and should be re-measured as content grows.
