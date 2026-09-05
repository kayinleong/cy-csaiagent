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

In flight (parallel executors): unit-type parser + price correction + completeness report;
`projectDetail` tool + Details-button fix + embedding cap + similarity-floor re-measurement;
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

### Regression surface opened by this claim
- `MIN_SIMILARITY = 0.55` was measured against a **14-chunk** corpus and its own comment says to
  re-measure. On the now-reachable 25,153-chunk corpus the controls clear it (0.5700 > 0.55), so
  off-topic questions can return citable chunks. **Assigned for re-measurement.** This exposure
  is *created* by enabling retrieval, so it is in scope, not a separate concern.
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
