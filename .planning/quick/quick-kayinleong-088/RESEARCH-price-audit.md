# RESEARCH — Finder price column audit (quick-kayinleong-088)

Read-only diagnostic. Measured against **live Firestore** on 2026-09-05 and against the
local scrape artifacts (`projects.json`, `projects.inventory.json`, `projects.tokens.json`).
No source file was modified; the census scripts were throwaways in the session scratchpad.

**Headline: the render path is correct and the plumbing is correct. The `projects`
collection genuinely does not hold a price for 32 of 83 active projects, and the source
write-ups for 29 of those 32 never stated one. Separately — and worse — 21 of the 51
prices we DO hold have no stated total in their source text and were invented or derived
by the extractor LLM.**

---

## Census

Live `projects` collection, all docs (`adminDb.collection('projects').get()`).

| Metric | Count |
|---|---|
| **Total docs** | **87** |
| `priceValue` missing / undefined | **0** |
| `priceValue` not a number | 0 |
| `priceValue === 0` | **36** (41.4%) |
| `priceValue < 0` | 0 |
| `priceValue > 0` | **51** (58.6%) |
| — min / median / max of `priceValue > 0` | RM 68,370 / **RM 1,300,000** / RM 7,700,000 |
| `sizeMinSqft` not a number (null/absent) | 20 |
| `sizeMaxSqft` not a number (null/absent) | 20 |
| `embedding` missing or empty | 0 |
| `embedding.length !== 1024` | 0 |

`priceValue` is **never absent** — every doc carries the field. `0` is the encoded
"unknown" sentinel, written deliberately by the importer (see Root cause).

### `priceBand` distribution

| Band | Count |
|---|---|
| `under_500k` | **38** |
| `500k_800k` | 11 |
| `800k_1.2m` | 9 |
| `above_1.2m` | 29 |

`priceBand` is 100% consistent with `priceBandFor(priceValue)` — **0 mismatches**. That
consistency is the problem: `priceBandFor(0) === 'under_500k'`, so **36 of the 38
`under_500k` projects are unpriced, not cheap.** Only 2 docs are genuinely under RM 500k
(The Stride Office @ BBCC RM 68,370; Luminar Residence Subang RM 360,000). The band field
is therefore actively misleading and must never be used as a price fallback —
`src/inventory/search.ts:513-518` already documents this and `FinderRow` deliberately
omits it.

### `bedrooms` distribution

| `bedrooms` | Count | Share |
|---|---|---|
| **0** (unknown) | **33** | 37.9% |
| **1** | **18** | 20.7% |
| 2 | 14 | 16.1% |
| 3 | 11 | 12.6% |
| 4 | 6 | 6.9% |
| 5 | 3 | 3.4% |
| 6 | 2 | 2.3% |

### `status` distribution

| `status` | Count |
|---|---|
| `active` | **83** |
| `hidden` | 4 |
| `sold_out` | **0** |

**Active-only** (what the Finder actually searches): 83 total, **51 priced / 32 unpriced**,
bedrooms `0`×29, `1`×18, `2`×14, `3`×11, `4`×6, `5`×3, `6`×2.

### Live docs vs. the import preview

The preview holds 82 records; Firestore holds 87. The 5 extras were added after the import:

| Name | status | priceValue | bedrooms |
|---|---|---|---|
| Property 1 | active | 1,400,001 | 4 | (test doc) |
| Aetas Damansara | hidden | 0 | 0 |
| Stonor 3 | hidden | 0 | 0 |
| Tribeca Bukit Bintang | hidden | 0 | 0 |
| Papyrus North Kiara | hidden | 0 | 0 |

### Named lookups

- **"Imperial Residences"** — EXISTS as `PDH: Imperial Residences RA`
  (docId `WsCKdwpNCvFwHy5cHTH6`): `priceValue: 1700000`, `priceBand: above_1.2m`,
  `bedrooms: 3`, `tenure: Freehold`, `status: active`, `vpStatus: false`, `vpDate: null`,
  `bumiQuota: false`, `foreignEligible: true`, `sizeMinSqft: 3380`, `sizeMaxSqft: 7459`,
  `locationText: "Pavilion Damansara Heights Phase 2, Centre of KL"`,
  `description` 2,827 chars, `embedding.length = 1024`.
- **"Pavilion Damansara"** — 2 docs, both `priceValue: 0` → `priceBand: under_500k`:
  `Pavilion Damansara Heights: Royal Suites(RC)` (`ggTnQ5DGqxlNBpYZwvhj`, bedrooms 1,
  452–1,679 sqft) and `Pavilion Damansara Heights` (`hAAy2kb4t5Aigzmv7MPO`, bedrooms 0,
  605–2,803 sqft, `vpStatus: true`). Both `embedding.length = 1024`.
- **"Ritz-Carlton"** — no doc matches the hyphenated string; the stored name has a stray
  space: `The Ritz- Carlton Residences` (`priceValue: 0`, `bedrooms: 1`).

---

## Root cause

### Why the screenshot shows `—` on nearly every row

The screenshot is **not** a rendering bug and **not** a lost-at-the-tool-boundary bug.
Every row named in it is `priceValue: 0` in Firestore right now — One Eleven Menerung,
Core Residence @ TRX, 26 Araville PJ, Eaton Residences by Sutera, TRX Residences,
The Ritz- Carlton Residences — and Luminar Residence Subang genuinely holds `360000`,
which is exactly what rendered. `formatPrice` (`app/[lang]/chat/match-table.tsx:65-70`)
returns `null` for `priceValue <= 0` and the cell falls back to the em-dash. Correct
behaviour over missing data.

The **row-mix amplifier** is `projectMatchesPrice` (`src/inventory/search.ts:526-533`),
which by the quick-085/D2 decision **admits every unpriced project through any price
bound**. So a price-bounded query drops priced projects but keeps all 32 unpriced ones,
inverting the ratio. Reproduced live by calling `searchProjects` directly:

| Query | rows | priced | unpriced | top-10 priced |
|---|---|---|---|---|
| `luxury condominium in KL KLCC` (segment unknown) | 83 | 51 | 32 | 4/10 |
| same, `own_stay` | 83 | 51 | 32 | 4/10 |
| same, `investment` | 83 | 51 | 32 | 7/10 |
| `show me all available projects` | 83 | 51 | 32 | 3/10 |
| **`priceMin: 1_500_000` + Klang Valley** | **50** | **18** | **32** | 6/10 |

The last row reproduces the screenshot's "50 MATCHING PROJECTS" exactly: **64% of the
returned rows (32/50) have no price**, because the RM 1.5M floor removed 33 of the 51
priced projects and removed none of the 32 unpriced ones. I could not recover the user's
exact prompt from the screenshot, so I cannot claim which of these five it was — but any
price-bounded query produces the same em-dash-dominated table by the same mechanism.

### (a)/(b)/(c)/(d) split for the 32 unpriced ACTIVE projects

Classification of each project's own `description` (which is verbatim `p.body.text` from
Skool — `to-inventory.ts:88`), with fee contexts (loan / booking / stamp duty / MOT /
maintenance / rebate / furnishing) excluded and asking-psf rates counted separately:

| Category | Count | Share |
|---|---|---|
| **(d) genuinely absent from source** — no total, no asking psf, no price of any kind | **30** | **93.8%** |
| **(a) never extracted — model never saw it** (price past the 6,000-char prompt truncation) | **1** | 3.1% |
| **(c) present but in a dropped shape** (a range, every layout marked SOLD OUT) | **1** | 3.1% |
| **(b) extracted then written as 0** | **0** | 0% |

**(b) is definitively ruled out.** In `projects.inventory.json`, all 32 zero-records have
`extraction.priceValueRM === 0` — the model itself returned 0 — and there are **0**
records where `extraction.priceValueRM !== input.priceValue`, so `toInput` maps faithfully
(`to-inventory.ts:85`). There were **0** extraction errors across all 82 records. The
extractor is doing precisely what its schema instructs: *"0 if no price is stated"*
(`to-inventory.ts:46-48`).

The PSF-conversion hypothesis is also **ruled out for the unpriced set**: **0 of the 32**
state a plausible asking RM/sqft rate (RM 200–5,000/sqft). The psf figures in those
write-ups are maintenance fees (RM 0.22–2.00 psf). There is nothing to convert.

### The inverse defect — 21 of the 51 stored prices are model-authored

Running the identical classifier over the **51 priced** active projects:

| What the source text actually states | Count | Share |
|---|---|---|
| A total asking price (legitimate extraction) | **30** | 58.8% |
| **Only an asking RM/sqft rate — no total anywhere** | **18** | 35.3% |
| **No asking price in any form** | **3** | 5.9% |

So **21 of 51 (41%) stored prices have no stated total in their source.** A stricter
independent check — does the stored number appear literally anywhere in the raw text under
any Malaysian formatting (`1,240,000` / `1.24mil` / `1240k` / `1.24 juta`), with maximally
generous unit expansion — finds **10 of 50** preview-priced records with **no literal
source at all**: The Lantern Bangsar (798,800), Pinnacle Bangsar Residence (5,150,000),
AT6 Residensi (6,425,000), Clouthaus KLCC (3,168,700), Platinum Face Suite 2 KLCC
(1,100,000), Armani Hallson (860,800), PSQ Pavilion Square (1,315,200), Jewel by Oxley
KLCC (1,490,600), The Stride Office @ BBCC (68,370), The Atera PJ (603,600). That 10 is a
**floor**, not a ceiling — the generous expansion counts `RM900-1000psf` → `900,000` as a
"literal" match, which is exactly the misread we are hunting.

This means the ONE price the user can see in the screenshot is itself suspect. **Luminar
Residence Subang, RM 360,000**: its write-up states `Gross Price: RM720 psf` and
`Prices below RM800K!!` — no RM 360,000 anywhere. `360,000 = 720 × 500`, and the project's
smallest stored layout is 549 sqft. The number is model-arithmetic on an invented sqft.

---

## Evidence

Five concrete raw-Skool excerpts where a price-shaped string exists and no correct
`priceValue` resulted. (1) is the only true extraction miss among the unpriced; (2) is the
sold-out edge; (3)–(5) are the far larger inverse defect — a psf rate silently converted
into a fabricated total.

**1. Royal Lexis KL — `priceValue: 0`; the price is past the prompt truncation.**
Body text is 6,855 chars; `extractPrompt` sends `String(p.body.text).slice(0, 6000)`
(`scripts/scrape-skool/to-inventory.ts:135`). The price sits at index **6,332**:
> `…✔️ 10 nights FREE stay every year 🏝️ All from RM1.72mil — 573sqft in a rare 371-unit tower near KLCC.`

The model never saw the string. Parseable value: RM 1,720,000. Stored: 0.

**2. d'Brightton titiwangsa — `priceValue: 0`; a stated range, all layouts sold out.**
> `…1,194 sqft — SOLD OUT   Penthouse: 2,163 – 2,400 sqft — RM1.23M – RM1.35M — SOLD OUT   Villa (3 Storey): 2,900 sqft — RM1.5M — SOLD OUT`

Prices ARE stated (RM 1.23M / 1.35M / 1.5M) but every unit is SOLD OUT, so the schema's
"lowest price if a range is given" rule had no live inventory to price. The doc is
nonetheless `status: 'active'` — a separate correctness problem, given that
`searchProjects` enforces `status:'active'` precisely to avoid recommending sold-out stock.

**3. Bangsar Hill Park — `priceValue: 900000`, fabricated from a psf band.**
The ONLY price-shaped strings in the write-up are per-sqft:
> `✅ Affordable entry price of RM900-1000psf for a new condo in Bangsar (under 10 years old).`
> `Nadi Bangsar RM1300psf` / `Alfa Bangsar RM1300psf` / `TNB Gold Pantai RM1200psf`

`RM900-1000psf` became `priceValue: 900000`. The Finder now presents a **rate per square
foot as an asking price.**

**4. The Lantern Bangsar — `priceValue: 798800`, derived, never stated.**
> `Price & Maintenance Fee:` / `Price: RM1,400 psf (Gross)` / `Maintenance Fee: RM0.715 psf` / `Booking Fee: RM5,000`

798,800 ÷ 1,400 = 570.6 sqft. The model multiplied the psf rate by a size it chose itself.
No RM 798,800 exists in the source.

**5. Pinnacle Bangsar Residence — `priceValue: 5150000`, derived, never stated.**
> `Price Packages:` / `Package A (Bare Unit): ~RM1,100 psf` / `Package B …: ~RM1,200 psf` / `Package C …: ~RM1,300 psf`

5,150,000 ÷ 1,100 = 4,681 sqft. Same fabrication. Compare **Riana Trees Residences**,
which the extractor got right because the source actually says it:
`Selling Price: From RM628,000` → stored `628000`.

---

## What a fix must do

1. **Stop treating this as a UI defect.** `formatPrice`, `FinderRow`, the sink, and the
   `priceBand` exclusion are all correct and already carry the invariants in comments.
   Changing any of them makes things worse, not better. The gap is in the DATA and in the
   IMPORT step that produced it.

2. **Recognise the ceiling.** 30 of 32 unpriced active projects have no price in their
   source material at all. No parser, prompt, or model can recover them — the number does
   not exist in the corpus. Any fix that promises to "fill in the prices" is promising
   something the source cannot supply. A real remedy needs Derek/D2 to supply prices, or
   the UI must make "price on request" a first-class, honest state rather than a silent
   em-dash. This is a content problem wearing an engineering costume.

3. **Fix the two recoverable cases.** Royal Lexis KL (RM 1.72M, lost to the 6,000-char
   `slice`) and d'Brightton titiwangsa (priced but sold out). Raising or removing the
   truncation is cheap — the whole corpus is 168,706 extraction input tokens
   (`projects.tokens.json`), so full bodies cost little. d'Brightton should probably be
   `status: 'sold_out'`, not `active`.

4. **Treat the 21 model-authored prices as the higher-severity bug.** A missing price
   renders an honest em-dash. A **wrong** price renders as authoritative fact to an agent
   quoting it to a client, and `matchedCriteria.priceMax` will assert a *verified budget
   match* on it (`search.ts:838-843`) because the invariant only checks `priceValue > 0`,
   not `priceValue` provenance. Minimum bar: the extractor must never emit a total it did
   not read verbatim. Options — add an explicit `priceIsPerSqft` / `priceSource` field,
   forbid arithmetic in the prompt ("return 0 unless a TOTAL price is written in the
   text"), or make extraction return the literal source substring alongside the number so
   a deterministic post-check can reject anything not present in the body.

5. **Re-derive `priceBand` only from real prices.** `priceBandFor(0) === 'under_500k'`
   currently files 36 unpriced projects into the cheapest band, and 38 of 87 docs sit in a
   band that is 95% noise. A dedicated `unknown` band (or a nullable `priceBand`) would
   stop this being a latent trap for any future code that pre-filters on the band.

6. **Bedrooms is a naming problem, not a data bug — do not "fix" it blindly.**
   `bedrooms: 1` is a genuine extraction, not a default. The schema asks for *"the SMALLEST
   layout offered"* (`to-inventory.ts:49`), and **11 of the 18** projects with `bedrooms: 1`
   have raw text that also names 2–6 bed layouts (Core Residence @ TRX, Eaton Residences,
   Pavilion Damansara Royal Suites, DC Residensi, Parkside, Conlay by E&O, Quill Residences
   KLCC, The Lantern Bangsar …). So a column headed **Beds** showing `1` for a project that
   sells up to 3-bed units is accurate-but-misleading. The 33 `bedrooms: 0` rows are the
   documented unknown sentinel and correctly render `—` (26 Araville PJ is one of them).
   The fix is either a min/max bedroom range (mirroring what `sizeMinSqft`/`sizeMaxSqft`
   already do) or a header renamed to "Beds (from)". Note `search.ts:598` sorts `own_stay`
   by `bedrooms` DESC, so a min-semantics field is currently ranking projects by their
   *smallest* layout.

### Not measured

- The user's exact Finder prompt behind the screenshot. I reproduced the row mix with five
  plausible queries; all show the same mechanism, but I cannot attribute the specific one.
- Whether any admin has edited `priceValue` through the admin UI since import. Firestore
  holds no per-field audit trail, and 5 docs differ from the preview by name alone.
- The 4 `hidden` docs were excluded from the active-only figures but are counted in the
  87-doc totals.
