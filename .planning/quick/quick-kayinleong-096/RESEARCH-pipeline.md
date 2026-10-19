---
status: complete
claim: quick-kayinleong-096
topic: how project data is written today (read-only research, 2026-10-19)
---

# RESEARCH: the project write path

This was a read-only investigation. Nothing was run against Firestore or any API.

The citations were spot-checked: `collections.ts:236`, `crud.ts:90-97`, `backfill-unit-types.ts:135`,
`fix-fabricated-prices.ts:406`, `search.ts:677`, `project-form.tsx:70`,
`sync-kb-prices-to-inventory.ts:315`, `reembed-projects.ts:107` and `admin.ts:45-46`.

**Bottom line:** only Size, Rooms, Tenure and part of Price / Completion have a home in the
project record.

- **No per-unit sold-out flag.** There isn't one today.
- **No field for these columns:** Developer, Land Title, Maintenance Fee, Total Units, Floors,
  Furnishing, Car Park, Top Reasons and cross-sell.
- **Re-run hazard.** Several existing backfill scripts would silently overwrite
  workbook-written values if they were run again.

## 1. Project schema (`src/firebase/collections.ts:233-408`)

`ProjectDoc` is a TypeScript interface; there is no zod schema. The converter stamps
`tenantId` on write (`:967-979`).

| Field | Type / meaning |
|---|---|
| `name` | free string (`:235`) |
| `status` | `'active' \| 'sold_out' \| 'hidden'` (`:236`). `sold_out` has never been written by any code path. |
| `priceBand` | always derived by `priceBandFor(priceValue)` (`:187-231`) |
| `priceValue` | RM number, **0 = unknown** (`:253`) |
| `pricePsfMin` / `pricePsfMax` | the asking rate. Must be RM200–5,000 psf and is never a maintenance fee (`:313-331`). |
| `priceProvenance?` | `'stated' \| 'psf_only' \| 'unknown'`. Absent means unverified (`:332-343`). |
| `priceSource?` | only `'whatsapp-kb'` today, with `priceSourceChunkId?` (`:344-363`) |
| `tenure` | free string. The importer defaults it to the literal `"Unknown"` (`scripts/scrape-skool/to-inventory.ts:196`). |
| `vpStatus` | boolean (`:255-260`) |
| `vpDate` | Date or null, and null when VP is not completed (`:261-268`). The importer writes 1 Jan of the completion year (`to-inventory.ts:180`). **There is no field for an expected future date.** |
| `bumiQuota`, `foreignEligible` | booleans (`:269-270`) |
| `description` | the full Skool write-up. It contains PIC contact details and **is embedded** (`:271-277`). |
| `locationText` | free text, **embedded** (`:278-282`). Search uses it as a location substring gate. |
| `bedrooms` | the **smallest** layout; 0 = unknown (`:287`) |
| `sizeMinSqft` / `sizeMaxSqft` | number or null: the smallest and largest layout (`:288-312`) |
| `unitTypes?` | `{label, sizeSqft, bedrooms, priceMinRM, priceMaxRM: number\|null, raw: string}[]` (`:393-408`). `1+1` is stored as 1 bedroom, and `raw` holds the verbatim source line. **No availability field and no nett/gross split.** |
| `embedding` | `number[]` with 1024 dimensions (`:381-382`). It must stay a plain array: commit `ac7cd28` reverted `FieldValue.vector()` because it broke search. |

There are no developer, landTitle, maintenance, totalUnits, floors, furnishing, carPark,
reasons, cross-sell, timestamp or version fields.

## 2. Who reads which fields

- **`searchProjects`** (`src/inventory/search.ts:670-892`)
  - Hard filters:
    - `status=='active'` (`:677`)
    - `foreignEligible` (`:680`) and `bumiQuota` (`:685`)
    - a returning-client filter on `createdAt`, falling back to `vpDate` (`:712-737`)
    - a location substring match on name + locationText (`:377-383`, `:749-758`)
    - `priceValue`, where unpriced projects pass (`:526`, `:762-772`)
    - affordability (`:778-781`)
  - Ranking:
    - a dot product on `embedding` with a 0.20 floor (`:798-821`)
    - segment sort: vpStatus, then priceValue, then bedrooms (`:589-599`)
  - It never reads `pricePsf*`, `priceProvenance` or `unitTypes`.
- **Finder table** (`toFinderRow`, `src/agents/finder/tools.ts:181-196`; `app/[lang]/chat/match-table.tsx`)
  - Columns: Name, Price (only when priceValue > 0), Size (sizeMin–Max), Beds (> 0), Tenure,
    Location, the model's Highlight, and a Details button that carries `projectId`.
  - It shows no psf, no unitTypes and no status.
- **`projectDetail`** (`search.ts:1058-1097`, `tools.ts:710-814`)
  - It reads by docId with no status filter. Non-active projects get an availability warning
    (`tools.ts:795-802`).
  - The mapper copies fields one by one (`search.ts:1073-1094`), so a **new project-level field
    must be added there**.
  - `unitTypes` is passed whole (`:1092`), so a **new per-unit field reaches the model
    automatically**.
  - It also retrieves 5 finder KB chunks of up to 1,600 characters by project name plus the
    question (`tools.ts:631,641,775-778`), with no projectId link.
  - The prompt's rules for layouts and prices are at `src/agents/finder/prompt.ts:175-181`. It
    says nothing about which source wins when the record and the KB disagree.
- **`queryInventory`** (`search.ts:908-937`) spreads the whole document, and `toInventoryRows`
  (`tools.ts:381-392`) strips only embedding and description.
- **Embedding**
  - The embedded text is `name · priceBand · tenure · "N bedrooms" · locationText ·
    description` (`src/inventory/embedText.ts:55-69`).
  - A re-embed is triggered by name, description, locationText, tenure, bedrooms and
    priceValue (`src/inventory/crud.ts:90-97`).
  - Changes to unitTypes, sizes, psf and status need no re-embed.

## 3. Writer scripts and credentials

All of them import `adminDb` (`src/firebase/admin.ts:40-70`).

- **Credentials:** `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON string) or ADC, plus
  `FIREBASE_PROJECT_ID`.
- **Run:** `node_modules/.bin/tsx --env-file=.env.local scripts/<name>.ts [--apply]`.
- **Common pattern:** dry-run by default; `update()` by document ref, never `set()`; no audit
  log; each one walks the whole collection.

| Script | Writes | Notes |
|---|---|---|
| `backfill-unit-types.ts` | `unitTypes` (`:135`) | Re-derives from `description` and **overwrites when it differs** (`:123-135`) |
| `backfill-project-sizes.ts` | size min/max (`:85`) | **Overwrites when it differs** (`:72-85`) |
| `fix-fabricated-prices.ts` | price fields and provenance (`:439-468`) | **Resets priceValue to 0** when the description states no total (`:406`) |
| `sync-kb-prices-to-inventory.ts` | price fields, `priceSource`, `priceSourceChunkId` | Never overwrites. Needs `GOOGLE_GENERATIVE_AI_API_KEY`. |
| `reembed-projects.ts` | `embedding` as a plain `number[]` (`:94-107`) | Re-embeds **all** projects. `--apply`, `--limit`, `--delay`. Needs the Gemini key. |
| `export-projects-for-workbook.ts` | read-only; writes `projects.export.json` (`:104`) | **Allowlist** of fields (`:65-90`), drops embedding. **Not a full backup.** |
| `data-completeness-report.ts` | read-only; `--no-write` (`:29`) | |
| `firestore-export.ts` | managed export to `gs://<bucket>/firestore-backups/<stamp>` | Needs the Datastore Import Export Admin role |

## 4. Admin inventory surface

- **Bulk import is create-only:** `importProjectsAction` → `createProject`
  (`app/[lang]/(admin)/inventory/actions.ts:178-191`, `src/inventory/import.ts:195-257`). It
  uses a naive `split(',')` CSV parser.
- **The edit form can't save honest unpriced records.** It requires `priceValue > 0` and
  `bedrooms > 0` (`project-form.tsx:69-79`), and has no psf, provenance or unitTypes inputs.
- **No audit row** is written on project edits.
- **Auditing:** `auditLogs` rows are hashes-only and `log()` swallows failures
  (`src/audit/log.ts:76-97`). A synthetic actor has been used before:
  `{uid:'skool-import-039', role:'admin'}` (`to-inventory.ts:54`).
- **Writes:** Firestore rules allow project writes only for the admin role
  (`firestore.rules:195-201`). The Admin SDK bypasses this.

## 5. KB side

- No KB update is required by a project-field change.
- The admin KB upload accepts `.xlsx` (`app/[lang]/(admin)/kb/kb-doc-form.tsx:58`,
  `src/kb/ingest/pdf.ts:201`). A clean per-project document would retrieve better than the
  raw sheet.
- **Precedent for disagreement between the record and the KB:**
  - 30 of 60 stated prices came from chat (quick-090);
  - the Skool sizes contradict the DC Residensi brochure (quick-094);
  - 61 of 901 Drive docs are filed under the wrong project (quick-093).

## 6. Precedents and rules

- **The 090–094 workbooks never wrote to Firestore.** Write-backs happened only in 085, 088
  and 089, all through the scripts above and all dry-run first.
- **Backup ordering is unsafe:** the 089 cleanup backups are written *after* the deletes
  (`fix-coach-pillar-mislabels.ts:130-155`).
- **Rules from the quick-088 invented-price failure** (21 of 51 prices were psf × an invented
  size):
  - never multiply psf by a size;
  - psf must be RM200–5,000;
  - 0 = unknown;
  - record provenance;
  - keep verbatim evidence;
  - never overwrite with weaker evidence;
  - no arithmetic project ranges (quick-093);
  - which stated total is the asking price is Derek's call (`fix-fabricated-prices.ts:420-422`);
  - re-embed after a priceBand change.
- **Incidents:** `ac7cd28` (a bulk embedding write broke search); the 088 typecheck gate
  passed vacuously.

## 7. Names

- **Snapshot:** `projects.export.json` (gitignored, 2026-09-18) holds 87 projects: 83 active and
  4 hidden. `Property 1` is a test record. Doc IDs are auto-IDs, held in `projectId`.
- **No alias helper.** The only normaliser in use is lowercase plus non-alphanumerics → space.
- **Fuzzy matching misfired before** (quick-089 CLAIM:182-186).
- **Prefix collisions:** "Pavilion Damansara Heights" vs "…: Royal Suites(RC)"; "IJM Sierra
  Hijauan" vs "Sierra Hijau (Landed)".

## 8. Environments

- There is no `.firebaserc`. The only live project is `cy-csaiagent` (`apphosting.yaml:76`), and
  there is no staging project.
- The emulator is configured in `firebase.json` (firestore 8080), with project ID
  `demo-cy-csaiagent`. It starts empty.
