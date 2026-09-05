# RESEARCH — ingestion coverage ledger (quick-kayinleong-088)

Read-only audit, 2026-09-05. Live Firestore project `cy-csaiagent`, all counts measured
(no estimates unless flagged). No tracked file was modified; throwaway probe scripts ran
from the session scratchpad.

**Headline:** the material *was* ingested. 25,210 chunks exist. But only **57 of them are
reachable by `findNearest`** — the other **25,153 (99.77%)** are stored with the wrong
embedding type and are invisible to retrieval. "Uploaded but not ingested" is really
"ingested but not indexed."

---

## Coverage ledger

| Source | Available | Ingested | Gap | Evidence |
|---|---|---|---|---|
| Skool projects | 82 | 82 | **0** | `projects.json` `projectCount:82` vs 87 Firestore `projects` (82 matched + 5 non-Skool) |
| Skool collateral | 246 | 246 | **0** | `projects.inventory.json` `stats.collateralTotal:246` = sum of non-WhatsApp `collateral.type` counts |
| Drive files (all types) | 6,265 | 918–961 → kbDoc | **~5,300** | `drive-documents.json` `fileCount:6265` vs kbDoc-title→filename match |
| — Drive text-bearing (`pdf/doc/sheet/slides/gdoc`) | 1,051 | 918–961 | **90–133** | `to-kb.ts` `TEXT_TYPES` filter |
| — Drive images | 3,573 | **0** | **3,573** | no code path exists (see §2) |
| — Drive videos | 1,556 | 0 | 1,556 (by design, D-09) | Drive = links, not files |
| — Drive "other" | 85 | 0 | 85 (by design) | not in `TEXT_TYPES` |
| OCR pass (image-only PDFs) | ≥175 attempted | 175 kbDocs / 1,917 chunks | 94 PDFs still with no kbDoc | `ocr-token-split.ts` live run |
| WhatsApp imports | 105 kbDocs created | **71 chunked** | **34 with zero chunks** | census join `kbChunks.docId → kbDocs` |
| WhatsApp media | 11,774 | 11,774 | 0 | `collateral.type == 'whatsapp-media'` |
| **Retrieval visibility (all pillars)** | **25,210 chunks** | **57 reachable** | **25,153** | `findNearest` probe, §5 |

---

## Per-source detail

### Firestore census (measured)

| Collection | Count | Notes |
|---|---|---|
| `kbDocs` | 1,079 | 100% `status:'published'`, 100% `lang:'en'` (no BM/ZH anywhere) |
| `kbChunks` | 25,210 | 100% `published`, 100% `en`, 100% `ownerCollection:'kbDocs'`; `sum(tokens)=8,761,496` |
| `kbIngestionJobs` | 991 | 990 `complete`, 1 `pending`; created 2026-06-23 → 2026-08-31 |
| `projects` | 87 | 83 `active`, 4 `hidden` |
| `collateral` | 12,020 | 12,018 have `externalUrl`, 0 have neither URL nor path |
| `knowledgeGaps` / `conversations` / `leads` / `evals` | 2 / 159 / 1 / 0 | — |

`kbChunks` by pillar: `finder 25,153` · `coach 47` · `reply 10`.
`kbDocs` by pillar: `finder 1,068` · `coach 7` · `reply 4`.

Source split (via the repo's own `scripts/scrape-skool/ocr-token-split.ts`, live):

| Kind | kbDocs | kbChunks | embedding tokens |
|---|---|---|---|
| Drive text | 799 | 7,719 | 2,644,133 |
| OCR (`… (OCR)` titles) | 175 | 1,917 | 639,353 |
| WhatsApp (`WhatsApp — …` titles) | 105 | 15,569 | 5,476,395 |
| orphan (parent kbDoc deleted) | — | 5 | 1,615 |

### 1. Skool projects — **no gap**

All 82 `titleClean` values in `projects.json` resolve to a Firestore `projects` doc
(normalized name match). `projects.tokens.json` holds 82 `perProject` entries, i.e.
`to-inventory.ts --apply` completed every project. Five extra Firestore projects are not
from Skool: `Property 1` (active), and `Aetas Damansara`, `Stonor 3`,
`Tribeca Bukit Bintang`, `Papyrus North Kiara` (all `hidden` — the WhatsApp-import
placeholder pattern, `status:'hidden'`).

Collateral: 86 of 87 projects have ≥1 collateral doc; only `Property 1` has zero. **No
collateral points at a non-existent projectId** (0 dangling).

### 2. Drive documents — the enumerated-but-never-fetched bulk

`drive-documents.json` indexes 6,265 files across 770 folders, but its own header says
`downloadedBytes: 0` and `documentsWithText: 0` — the crawl ran `GDRIVE_PHASE=enumerate`
only. It is an *index*, not a payload.

Type breakdown and what each type can ever become:

| Type | Count | Ingestion path | Result |
|---|---|---|---|
| `image` | 3,573 | **none** | `to-kb.ts` `TEXT_TYPES` excludes `image`, so images never enter the ledger; `to-kb-ocr.ts` then filters `/\.pdf$/i` on ledger entries. No script in the repo can OCR a Drive image. |
| `video` | 1,556 | none (by design) | D-09: Drive stays a link |
| `pdf` | 947 | `to-kb.ts` → `to-kb-ocr.ts` | 853 ingested (689 text-layer + 164 OCR), **94 with no kbDoc** |
| `other` | 85 | none | — |
| `doc` | 49 | `to-kb.ts` | 20 with no kbDoc |
| `sheet` | 24 | `to-kb.ts` | 1 with no kbDoc |
| `slides` | 16 | `to-kb.ts` | 12 with no kbDoc |
| `gdoc` | 15 | `to-kb.ts` | 6 with no kbDoc |

Matching method: `to-kb.ts` writes `title = "${project} — ${filename}"` and `to-kb-ocr.ts`
appends `" (OCR)"`, so kbDoc titles are reversible back to Drive filenames. Strict
(project+filename) matching gives **918 matched / 133 unmatched**; loose (filename-only)
gives **961 / 90**. Truth is in that band — folder names and LLM-extracted project names
diverge for a handful of projects.

Folders whose text files are most incompletely ingested:
`Golden Crown Residence` (26 un-ingested), `Damansara City Residency (DC Residensi)` (25),
`Exsim Project` (15), `Southpoint Residences (IGB )` (12), `PDH: Imperial Residences RA` (7),
`TRX Residences` (6), `St. Regis Residences Kuala Lumpur` (5, and **zero** kbDocs overall),
`The Manor KLCC` (1, also **zero**).

Only **2 of 68** Drive folders with text-bearing files contributed zero kbDocs, so Drive
text coverage is ~87–91% by file — good. The 3,573 images are the untouched mass.

### 3. OCR path — trialled, run at scale once, then stranded

`ocr-trial.ts` (untracked) is a single-PDF smoke test of `gemini-2.5-flash` vision.
`to-kb-ocr.ts` is the real loader and it **did** run at scale: 175 OCR kbDocs / 1,917
chunks / 639,353 embedding tokens are in Firestore. So this was not abandoned mid-trial.

But it is now **unrunnable**. `to-kb-ocr.ts` selects its work exclusively from the ledger
(`status === "skipped-empty"` && `/\.pdf$/i`) and hard-fails on a missing ledger:

```ts
if (!existsSync(LEDGER)) throw new Error(`no ledger at ${LEDGER}`);
```

I searched the filesystem: **`drive-kb-ledger.json` does not exist**, and neither does the
`google-profile` Playwright directory. `SCRAPE_OUT` was a scratch dir that has been cleaned.
Every resumability guarantee in `scripts/scrape-skool/README.md` depended on that file.

Consequence: the 94 PDFs with no kbDoc cannot be classified as "had no text layer" vs
"download failed" without re-running the text pass first, and the 3,573 images have no
path at all.

### 4. WhatsApp — landed, but a third of the KB docs never chunked

WhatsApp import (`app/[lang]/(admin)/whatsapp-import/`) parses the zip in the browser and
fans out to three places: `projects` (only in `mode:'new'`, stamped `status:'hidden'`),
`kbDocs` + `kbChunks` (one doc per import, `title: "WhatsApp — ${project}"`,
`pillar:'finder'`, `category` = the project name), and `collateral`
(`type:'whatsapp-media'`, one per media file).

Measured:
- **11,774** `whatsapp-media` collateral docs — the media leg completed.
- **105** WhatsApp kbDocs. **71 have chunks (15,569 total). 34 have ZERO chunks.**
- No per-message documents exist anywhere — the whole transcript is chunked as one doc.

The 34 zero-chunk imports are concentrated in a few projects, `Lunar Seputeh` most of all
(10 separate zero-chunk imports), then `PDH: Imperial Residences RA` (3),
`Conlay by E&O` (2), `OAKA Residences, Bukit Jalil` (2),
`Pavilion Damansara Heights: Royal Suites(RC)` (2), and 15 others once each.

There is **no durable failure record** for these. The import form keeps progress only in
React state; `kbIngestionJobs` covers the KB-text leg alone, never the media or project
legs. A failed import leaves a `status:'published'` kbDoc that looks healthy in the admin UI.

### 5. Unembedded / unreachable / orphaned — the dominant finding

`kbChunks.embedding` has two on-disk representations. `FieldValue.vector([...])` is the
Firestore VECTOR type and is covered by the vector index. A plain `number[]` is **not** —
`findNearest` silently skips it, returns zero rows, and raises no error.

Measured with a dummy query vector against the production filter shape from
`src/rag/search.ts` (`lang in [...]`, `status == 'published'`, optional `pillar`):

| Pillar | Chunks in Firestore | Reachable by `findNearest` | Invisible |
|---|---|---|---|
| `coach` | 47 | **47** (100%) | 0 |
| `reply` | 10 | **10** (100%) | 0 |
| `finder` | **25,153** | **0** (0%) | **25,153** |
| **total** | **25,210** | **57** (0.23%) | **25,153** |

Corroborated three ways: (a) `orderBy('embedding').count()` returns 25,210/25,210 — vector-typed
fields are not single-field indexed, so every chunk is still a plain array; (b) six samples
spread across the document-ID space all read back as `Array` with no `.toArray()`;
(c) the `findNearest` counts above.

**Why:** `.planning/quick/quick-kayinleong-066/CLAIM.md` diagnosed this exact bug and its
Verification section states the fix was applied as `--pillar coach --apply` — *"ran the
backfill on the 14 coach chunks"*. `scripts/backfill-kbchunk-vectors.ts` was never run
unscoped or with `--pillar finder`. Coach and Reply grew to 47/10 afterwards via
`ingest-kb-seed.ts`, which writes through the fixed pipeline. The entire Finder corpus —
every Skool Drive document, every OCR transcription, every WhatsApp transcript, ingested
2026-06-23 → ~2026-08-26 — predates the pipeline fix and was left behind.

Other integrity items (all small):
- **1 stuck job**: `kbIngestionJobs/job-8a6ee59c9c5b14dd`, `status:'pending'`,
  `remaining:1`, created 2026-06-23. Its `docId` `4nxtxYPuadTiUXOTXFma` **does not exist** —
  dead job, safe to delete.
- **5 orphan chunks** (all `pillar:'coach'`, 1,615 tokens) share
  `docId: aWXEQ4oqOdRXonDcI9SX`, a kbDoc that no longer exists. These *are* reachable by
  `findNearest`, so retrieval can cite a source that cannot be resolved.
- **88 kbDocs with zero chunks** (54 Drive-text + 34 WhatsApp, 0 OCR) — 1,079 kbDocs vs
  991 with chunks, and exactly 991 ingestion jobs. These are the orphan pattern:
  `createDoc` writes the kbDoc row first, `shardJob` throws on empty/unparseable content,
  and the doc is left `published` with nothing behind it. `src/kb/ingest/pdf.ts` is
  text-layer-only (no OCR anywhere in `src/`), so a scanned PDF uploaded through the admin
  UI reliably produces one of these.
- No chunk anywhere has a null/absent `embedding` — the pipeline writes text and vector in
  one atomic `.add()`, so partial embedding is not a failure mode here.

### 6. Side finding relevant to the claim's price symptom

Not an ingestion gap: **51 of 87 projects already have `priceValue > 0`**; 36 are zero.
Also `bedrooms` is 0/absent on 33, both size fields null on 20, `locationText` empty on 4.
`priceBand` skews to `under_500k` (38) purely because a zero price bands there. Since the
Finder table reportedly shows "—" for all but one of ~50 results while 51 projects carry a
real price, the price symptom points at the Finder tool/render path more than at ingestion.
Worth confirming separately from this coverage work.

---

## What was uploaded but never ingested

Answering the user's question directly, in descending order of impact.

1. **25,153 Finder chunks are ingested but unreachable.** Every Skool Drive document,
   every OCR transcription and every WhatsApp transcript — 1,068 kbDocs, 8.76M embedding
   tokens already paid for — sits in Firestore with a plain-`number[]` embedding and is
   invisible to `findNearest`. The Finder pillar currently retrieves **nothing** from the
   KB. This is one un-run backfill, not a re-ingest.

2. **3,573 Drive images were never ingestible.** Floor plans, price charts, unit-layout
   graphics and brochure pages saved as JPG/PNG. `to-kb.ts` excludes `image` from
   `TEXT_TYPES` so they never even reach the ledger, and `to-kb-ocr.ts` only accepts
   `.pdf`. No script in the repo can turn them into chunks. For a per-layout price
   breakdown this is very likely where that data physically lives.

3. **34 WhatsApp imports produced a kbDoc but zero chunks.** Named examples:
   `Lunar Seputeh` (10 separate imports), `PDH: Imperial Residences RA` (3),
   `Conlay by E&O` (2), `OAKA Residences, Bukit Jalil` (2),
   `Pavilion Damansara Heights: Royal Suites(RC)` (2), plus
   `Eaton Residences by Sutera @ KLCC`, `TRX Residences`, `Golden Crown Residence`,
   `Bangsar Hill Park`, `Star Residences KLCC`, `Southpoint Residences (IGB )`,
   `SO Sofitel Residences KLCC`, `The Ritz- Carlton Residences`, `Anyara Hills`,
   `The MET, Corporate Tower`, `d'Brightton titiwangsa`, `Senja The Jewel Collection`,
   `ViiA Residences`, `Aetas Damansara`, `The Atera, PJ by Paramount Property`.

4. **90–133 Drive text files never produced a kbDoc** (94 PDFs, 20 `doc`, 12 `slides`,
   6 `gdoc`, 1 `sheet`). Worst folders: `Golden Crown Residence` (26),
   `Damansara City Residency (DC Residensi)` (25), `Exsim Project` (15),
   `Southpoint Residences (IGB )` (12). Two folders contributed nothing at all:
   `St. Regis Residences Kuala Lumpur` (5 files) and `The Manor KLCC` (1 file).

5. **54 Drive-text kbDocs exist with zero chunks** — same orphan pattern as (3), e.g.
   `Golden Crown Residence — Golden Crown Sales Kit (English) - V1.pdf`,
   `Sentral Suites @ KL Sentral — MRCB KL Sentral - Final Report.pdf`,
   `Armani Hallson @ Jalan Ampang — Advertisement Guidelines (Updated 7 April…)`.

Not a gap: Skool projects (82/82), Skool collateral (246/246), WhatsApp media
(11,774 files), and dangling-collateral integrity (zero).

---

## Re-ingest plan

Ordered by value-per-effort. **Do #1 before anything else** — until it runs, re-ingesting
more content adds more invisible chunks.

### 1. Convert Finder embeddings to the VECTOR type — highest value, zero LLM cost

```bash
npx tsx --env-file=.env.local scripts/backfill-kbchunk-vectors.ts --pillar finder          # dry run
npx tsx --env-file=.env.local scripts/backfill-kbchunk-vectors.ts --pillar finder --apply
```

- **Env:** `.env.local` only (`FIREBASE_SERVICE_ACCOUNT_KEY` or
  `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_PROJECT_ID`).
- **Cost:** **no embedding or LLM tokens at all** — it re-wraps vectors that are already
  stored. Cost is ~25,153 Firestore document updates plus reading 25,153 × 1024 floats
  (roughly 300 MB at the script's 300-doc page size; budget a long-running job, not a
  fast one).
- **Idempotent + resumable: yes, genuinely.** Paginates `orderBy('__name__')` with a
  `startAfter` cursor; a chunk already stored as VECTOR fails the `Array.isArray` test,
  is counted as `alreadyVector` and skipped. A partial run resumes cleanly. Dry-run by
  default.
- **Do not** run an equivalent conversion on `projects.embedding` — that one is
  deliberately a plain `number[]` because `src/inventory/search.ts` scores in memory and
  never calls `findNearest`.
- **Verify after:** re-run the `findNearest` probe and expect `pillar=finder` to return
  rows instead of 0. Per the memory note, prove the guard by checking the *old* behaviour
  is gone, not just that the script exited 0.

### 2. Reconstruct the Drive ledger — a prerequisite, not optional

`drive-kb-ledger.json` and the `google-profile` directory are both **absent from disk**.
This breaks all three Drive scripts:

- `to-kb.ts` builds its skip-set from the ledger. With no ledger, `done` is empty and an
  `--apply` run re-downloads and **re-ingests all 1,051 text files**, creating ~918
  duplicate kbDocs and burning ~3.3M embedding tokens for nothing.
- `to-kb-ocr.ts` throws immediately (`no ledger at …`) — it cannot run at all.
- `kb-cleanup.ts` reads the ledger to find `partial` docs — also inert.

**Write a small script that rebuilds the ledger from Firestore** before touching either
loader: kbDoc titles are `"${project} — ${filename}"` (plus `" (OCR)"`), so each existing
kbDoc maps back to a `drive-documents.json` entry by `(project, name)`; emit
`{fileId, name, project, status: "ingested" | "ingested-ocr", docId}`. This is the same
join I used for §2 and it reproduces ~918 entries. Everything else in the index becomes a
fresh target. Without this step, options 3 and 4 are unsafe.

### 3. Ingest the 90–133 missing Drive text files

```bash
npx tsx --env-file=<skool.env> scripts/scrape-skool/gdrive-login.ts    # interactive, rebuilds google-profile
npx tsx --env-file=<skool.env> scripts/scrape-skool/to-kb.ts           # dry run first
npx tsx --env-file=<skool.env> scripts/scrape-skool/to-kb.ts --apply
```

- **Env:** `SCRAPE_OUT` (scratch dir, holds `google-profile` + ledger), `DRIVE_INDEX`
  (defaults to `./drive-documents.json`), `KB_LEDGER`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  optional `KB_MIN_CHARS` (default 200), `EMBED_DELAY_MS` (default 400), `KB_PILLAR`.
- **Blocking prerequisites:** a human must complete the interactive Google login
  (headless is blocked), *and* step 2 must have rebuilt the ledger.
- **Cost:** no token meter in this script. Extrapolating from measured Drive-text data
  (7,719 chunks over ~788 docs ≈ 9.8 chunks/doc; 2,644,133 tokens ≈ 343 tokens/chunk):
  **≈ 450k–520k Gemini embedding tokens** for 133 files. Chunking is 400 tokens max,
  50 overlap.
- **Idempotent/resumable:** only through the ledger, which it rewrites after every file.
  It also stops cleanly on a Gemini 429 and resumes on re-run. Dry-run by default
  (`--apply` to write).

### 4. OCR the remaining image-only PDFs

```bash
npx tsx --env-file=<skool.env> scripts/scrape-skool/to-kb-ocr.ts           # dry run
npx tsx --env-file=<skool.env> scripts/scrape-skool/to-kb-ocr.ts --apply
```

- Runs only **after** step 3, because its targets are the ledger rows step 3 marks
  `skipped-empty`.
- **Env:** as step 3 plus `OCR_MODEL` (default `gemini-2.5-flash`), `EMBED_DELAY_MS`
  (default 800).
- **Cost:** measured at 639,353 embedding tokens for 175 OCR docs ≈ **3,653 embedding
  tokens/doc**, plus Gemini vision *input* tokens per PDF, which the script does not
  meter at all. For ~94 candidate PDFs expect **≈ 340k embedding tokens** plus unmetered
  vision input.
- **Idempotent/resumable: yes** — ledger rows become `ingested-ocr` or `ocr-empty`, and it
  stops cleanly on a Gemini rate-limit.

### 5. Drive images — needs new code, not a re-run

3,573 images have no path. `to-kb.ts` never adds them to the ledger and `to-kb-ocr.ts`
filters `/\.pdf$/i`. Making these ingestible means either widening `TEXT_TYPES` to include
`image` with a vision branch, or relaxing the OCR filter and feeding image bytes with the
right `mediaType`. The `ocr-trial.ts` prompt already works for this — only the file-type
plumbing is missing. Scope as its own claim; at ~3,600 vision calls it is the single most
expensive item here and should be sized before it is committed to.

### 6. Cleanups (small, independent)

- Delete `kbIngestionJobs/job-8a6ee59c9c5b14dd` — `pending`, `remaining:1`, parent kbDoc
  `4nxtxYPuadTiUXOTXFma` no longer exists.
- Delete or re-parent the 5 orphan `coach` chunks under
  `docId: aWXEQ4oqOdRXonDcI9SX`; they are retrievable and citable today but their kbDoc is
  gone.
- Decide on the 88 zero-chunk kbDocs (54 Drive-text + 34 WhatsApp). No script re-drives
  them — `kb-cleanup.ts` only handles ledger `partial` rows. Either delete them so the
  admin KB list stops overstating coverage, or re-import each source. The 34 WhatsApp ones
  need the original zips.
- Consider a durable failure record for WhatsApp imports: today a failed media or chunk
  leg leaves a `published` kbDoc and no trace outside transient React state, which is why
  34 empty imports went unnoticed.

---

## Method / reproducibility

- Firestore read via `firebase-admin` using the `.env.local` credential chain, passed with
  `--env-file` only; no credential value was read, printed or logged. No PII (lead names,
  phone hashes, message text) was read or emitted — queries used `.select()` on metadata
  fields, and aggregates only.
- Existing repo script used as-is: `scripts/scrape-skool/ocr-token-split.ts` (read-only).
- Throwaway probes lived in the session scratchpad, never in the repo, and wrote nothing
  to Firestore.
- The one soft number in this document is the Drive file→kbDoc match (918–961), which is a
  title-reversal heuristic. Every other figure is a direct count.
