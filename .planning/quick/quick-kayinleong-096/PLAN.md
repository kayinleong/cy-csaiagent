---
phase: quick-kayinleong-096
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Wave 1 — T1 (TS core tracer)
  - src/firebase/collections.ts
  - src/inventory/client-workbook-safety.ts
  - src/inventory/client-workbook.ts
  - src/inventory/client-workbook.test.ts
  - src/agents/finder/prompt.ts
  - src/agents/finder/project-detail.test.ts
  # Wave 1 — T2 (Python stage 1, claim dir only)
  - .planning/quick/quick-kayinleong-096/wbparse.py
  - .planning/quick/quick-kayinleong-096/build-client-sheet.py
  - .planning/quick/quick-kayinleong-096/verify-client-sheet.py
  - .planning/quick/quick-kayinleong-096/pii-vectors.json
  - .planning/quick/quick-kayinleong-096/project-mapping.json
  - .planning/quick/quick-kayinleong-096/client-sheet.normalized.json
  - .planning/quick/quick-kayinleong-096/HELD-BACK.md
  - .planning/quick/quick-kayinleong-096/factsheets/index.json
  - .planning/quick/quick-kayinleong-096/factsheets/*.md
  # Wave 2 — T3 (stage 2 import)
  - src/inventory/client-workbook-run.ts
  - src/inventory/client-workbook-run.test.ts
  - src/inventory/client-workbook.contract.test.ts
  - scripts/import-client-workbook.ts
  - .gitignore
  # Wave 2 — T4 (re-run guards + export)
  - scripts/backfill-unit-types.ts
  - scripts/backfill-project-sizes.ts
  - scripts/fix-fabricated-prices.ts
  - scripts/export-projects-for-workbook.ts
  - scripts/client-workbook-guards.test.ts
  # Wave 2 — T5 (stage 3 KB fact sheets)
  - src/kb/client-factsheets.ts
  - src/kb/client-factsheets.test.ts
  - scripts/ingest-client-factsheets.ts
  # Wave 3 — T6 (post-apply UAT refresh, claim 095 files)
  - .planning/quick/quick-kayinleong-095/uat-cases.json
  - docs/UAT-Output-Test-Cases.xlsx
  - docs/UAT-Output-Test-Plan.md
autonomous: false
requirements: [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13]

estimate:
  tokens: 340000
  raw_tokens: 340000
  tasks: 6
  confidence: low

must_haves:
  truths:
    - "After the approved apply, every one of the 14 matched projects with unit rows has had its unitTypes merged unit by unit (D5 as amended by the orchestrator, 2026-10-19). A sheet unit that matches a stored entry overwrites only the values the sheet states. An unmatched sheet unit is added. A stored entry is dropped only when it is an untyped grouped entry ('1+1 Bedrooms', '5+1 bedrooms') in a project other than Rafflesia, and every drop is named in the dry run and can be held. A blank cell never clears a stored unit value: Southpoint keeps all 7 stored per-layout prices, and Rafflesia keeps its 9 entries, 2 of which become 'Hill 4 · Type E & E1' and 'Hill 4 · Type G & G1'. Projects without unit rows keep their unitTypes untouched"
    - "priceValue is the lowest stated price among the available (not sold out) entries of the FINAL merged unit list (DC Residensi 1,200,000; SO Sofitel 1,212,640; Jewel by Oxley 1,601,663 …). For Rafflesia, which the sheet covers only in part, the stored 2,900,000 also counts as a candidate, so it stays. When the winning figure is a sheet nett, priceSource is 'client-workbook'. priceBand comes from priceBandFor and priceProvenance is 'stated'. No stored figure is psf × size, and no psf outside RM200–5,000 is stored (D2, as amended)"
    - "Sold-out units carry soldOut:true and null prices, never count toward priceValue or the size range, and a Finder detail answer is instructed to label them sold out and never offer them. No project's status is changed by this claim (D3)"
    - "A blank cell never clears a stored value, and re-running backfill-unit-types, backfill-project-sizes or fix-fabricated-prices leaves every workbook-sourced field as the import wrote it. Behaviour tests prove each guard (D4)"
    - "Every value that fails a sanity gate is absent from the record and from the KB, and is listed in HELD-BACK.md with the reason, together with the DC Residensi brochure conflicts and the 3 new projects that were skipped (D5, D9)"
    - "Each mapped project with at least one fact has exactly one current finder KB fact sheet, titled '{inventory name} — D2 project facts (client sheet)'. It carries the provenance line and the unit table and no contact details, and a second ingest run creates nothing (D1)"
    - "No production write happens unless: the env guard passes; the user has approved the dry-run diff, bound by the --expect-plan fingerprint; a full pre-write backup exists at a gitignored path; and, after the write, every written field is re-read and asserted and the auditLogs rows are counted (D10, D11, D13)"
    - "Every re-embedded project vector is a plain 1024-length number[], never a Firestore vector value, and only projects whose embedded fields changed are re-embedded (D10, commit ac7cd28)"
  artifacts:
    - path: src/inventory/client-workbook-safety.ts
      provides: "import-free env guard, contact-detail scanner, workbook-field marker check, actor constants"
    - path: src/inventory/client-workbook.ts
      provides: "client-sheet contract (zod + invariant gates) and planProjectPatch merge rules"
    - path: src/inventory/client-workbook-run.ts
      provides: "dry-run / apply / restore orchestration with injected I/O, fingerprint, report"
    - path: scripts/import-client-workbook.ts
      provides: "stage 2 CLI (dry run default; --apply --expect-plan; --restore)"
    - path: src/kb/client-factsheets.ts
      provides: "fact-sheet manifest loader, idempotent create/update/unchanged planner, ingest runner"
    - path: scripts/ingest-client-factsheets.ts
      provides: "stage 3 CLI (dry run default; --apply --expect-plan)"
    - path: .planning/quick/quick-kayinleong-096/client-sheet.normalized.json
      provides: "reviewable, PII-gated normalised workbook (the stage 1 → 2 contract)"
    - path: .planning/quick/quick-kayinleong-096/project-mapping.json
      provides: "reviewed workbook name → docId mapping (78 exact + 2 variants + 3 Sheet1 aliases)"
    - path: .planning/quick/quick-kayinleong-096/HELD-BACK.md
      provides: "plain-language list of held-back values and conflicts for the user and client"
    - path: .planning/quick/quick-kayinleong-096/factsheets/index.json
      provides: "fact-sheet manifest with sha256 per file"
    - path: .planning/quick/quick-kayinleong-096/verify-client-sheet.py
      provides: "stage 1 gate, plus --self-test that proves the gates bite"
  key_links:
    - from: .planning/quick/quick-kayinleong-096/client-sheet.normalized.json
      to: scripts/import-client-workbook.ts
      via: "parseClientSheet: zod parse plus the same invariant gates the Python stage runs (gate equivalence)"
    - from: src/inventory/client-workbook.ts planProjectPatch
      to: "Firestore projects/{docId}"
      via: "update() by docId, only after the env guard, an --expect-plan match and a re-read backup"
    - from: "UnitTypeEntry.soldOut"
      to: "Finder detail answer"
      via: "getProjectDetail passes unitTypes whole (src/inventory/search.ts:1092) + the sold-out rule after src/agents/finder/prompt.ts:175"
    - from: "ProjectDoc.clientWorkbookFields"
      to: "scripts/backfill-unit-types.ts, backfill-project-sizes.ts, fix-fabricated-prices.ts"
      via: "isClientWorkbookField guard at the top of each per-doc loop"
    - from: .planning/quick/quick-kayinleong-096/factsheets/index.json
      to: "kbDocs / kbChunks (pillar finder)"
      via: "createDoc (src/kb/crud.ts:130) or updateDoc (crud.ts:288) → shardJob (src/kb/ingest/pipeline.ts:116) → processBatch (pipeline.ts:263), which supersedes the old version at :379"
    - from: "embedProject (src/inventory/embedText.ts)"
      to: "projects.embedding"
      via: "plain number[] written by the runner, Array.isArray + length 1024 asserted before and after"
    - from: "projects.export.json (re-exported after apply)"
      to: ".planning/quick/quick-kayinleong-095/verify-uat-workbook.py"
      via: "--export plus updated meta.snapshot_exported_at (D12)"
---

<objective>
Ingest the client's updated workbook "_D2 Project Info.xlsx" (sha256 `d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f`) into the EXISTING `projects` records. The import writes per-unit sizes, rooms, nett ranges (gross goes in the raw line), sold-out flags, tenure and completed-VP facts. Every fact with no field in the record goes into one clean finder KB fact sheet per project (D1–D13).

Purpose: Finder answers about these projects are currently built from Skool write-ups that the client has now superseded. The client's sheet becomes the field-by-field authority (D4). It must not repeat the quick-088 failure of plausible but invented prices, and nothing reaches production without the user approving an exact diff (D11).

Output:
- Stage 1 (Python, claim dir): the mapping, the normalised JSON, HELD-BACK.md and the fact sheets, plus a verifier whose gates bite.
- Stage 2 (TS): `scripts/import-client-workbook.ts`. Dry run by default, apply gated by fingerprint, backup, re-read asserts, audit rows, selective re-embed, restore.
- Stage 3 (TS): `scripts/ingest-client-factsheets.ts`. Idempotent ingest through the existing KB pipeline.
- Re-run guards on the three backfill scripts, and a sold-out rule for the Finder.
- After the approved apply: a refreshed snapshot and an updated claim-095 UAT pack (D12).

Commit prefixes: `feat(quick-kayinleong-096)` / `fix(quick-kayinleong-096)` for code, `docs(quick-kayinleong-096)` for docs. The orchestrator owns git. Executors never run git and never run anything against live Firestore, Gemini or Anthropic (D11).
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@AGENTS.md
@.planning/quick/quick-kayinleong-096/CLAIM.md
@.planning/quick/quick-kayinleong-096/RESEARCH-pipeline.md
@.planning/quick/quick-kayinleong-096/RESEARCH-workbook.md
@.planning/quick/quick-kayinleong-094/CLAIM.md
@.planning/quick/quick-kayinleong-088/CLAIM.md

Code anchors (verified 2026-10-19):
- `src/firebase/collections.ts`: `priceBandFor` :223, `ProjectDoc` :233, `priceSource` :355, `priceSourceChunkId` :363, `unitTypes` :380, `embedding` :382, `UnitTypeEntry` :393. The file imports `adminDb` at :54, so ANY value import from it initialises the admin SDK.
- `src/inventory/search.ts`: `getProjectDetail` mapper :1058-1097; it passes `unitTypes` whole at :1092, so a new per-unit key reaches the model with no mapper change.
- `src/agents/finder/prompt.ts:175`: the unitTypes bullet.
- `src/inventory/embedText.ts`: `embedProject` and `composeProjectEmbeddingText`. `src/inventory/crud.ts:90-97`: `EMBEDDING_RELEVANT_FIELDS`.
- KB path:
  - `src/kb/crud.ts`: `createDoc` :130, `updateDoc` :288 (version+1, supersedesId), `shardJobForContent` :934 (it does not pass category on update).
  - `src/kb/ingest/pipeline.ts`: `shardJob` :116 (sha256 fileHash idempotency :118-123) and `processBatch` :263, which supersedes the old version at :379-389 and writes kbChunks as a Firestore VECTOR.
  - Script precedent: `scripts/ingest-kb-seed.ts:101` (synthetic admin user) and :124-138 (processBatch loop with a no-progress break).
  - Project attribution precedent: `scripts/scrape-skool/to-kb.ts:178`, title `"{project} — {file}"` plus `category: project`.
- Writers to guard:
  - `scripts/backfill-unit-types.ts`: loop :104-136, write at :135.
  - `scripts/backfill-project-sizes.ts`: loop :59-86, write at :85.
  - `scripts/fix-fabricated-prices.ts`: loop :384-469, write at :468.
  - `scripts/sync-kb-prices-to-inventory.ts:165-168` already skips any doc with a price or a psf, so it needs no guard.
- `scripts/reembed-projects.ts:107` writes a plain number[]. Commit `ac7cd28` documents what breaks otherwise.
- `src/audit/log.ts:76-97`: `log()` hashes every raw value and swallows failures, so the caller must count rows. Synthetic-actor precedent: `skool-import-039`.
- `src/audit/pdpa.ts:73-87`: its phone/IC/email regexes are module-private and miss local-format numbers ("012-000 0000") and URLs. That is why a dedicated contact scanner is specified below instead of reusing them.
- Test mocking precedent for modules that import collections: `tests/finder-corpus-gates.test.ts:37-40` (`vi.mock('@/src/firebase/admin', …)`).
- The vitest include covers `src/**/*.test.ts` and `scripts/**/*.test.ts`. The typecheck gate is `npm run typecheck` (`tsconfig.typecheck.json`, which excludes `.next`). Do not filter its errors; see the 088 vacuous-gate incident.
- The repo has SheetJS `xlsx ^0.18.5` (used by `src/kb/ingest/pdf.ts:201`). It is deliberately NOT used here; see the xlsx-reader decision under Discretion.
</context>

<interfaces>

## Contract 1: `client-sheet.normalized.json` (written by T2, read by T1's `parseClientSheet`, T3 and the contract test)

Key order, types and nullability are exact. Projects are sorted by `sheetRow` ascending. Sheet1-only projects (`sheetRow: null`) come last, sorted by `inventoryName`. Units keep sheet row order.

```json
{
  "meta": {
    "schema": "client-sheet/1",
    "source_label": "D2 project info sheet supplied by the client, 19 October 2026",
    "import_date": "2026-10-19",
    "workbook_sha256": "d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f",
    "mapping_sha256": "{sha256 hex of the project-mapping.json bytes}"
  },
  "projects": [
    {
      "docId": "UI9V4ibcLUMuYQkd5lQK",
      "inventoryName": "Damansara City Residency (DC Residensi)",
      "sheetName": "Damansara City Residency (DC Residensi)",
      "sheetRow": 2,
      "unitMode": "merge",
      "labelPrefix": "",
      "units": [
        {
          "sheetRow": 2, "label": "Type S1", "sizeSqft": 904, "bedrooms": 1,
          "nettMinRM": 1200000, "nettMaxRM": 1350000, "grossMinRM": 1750000, "grossMaxRM": 1800000,
          "psfRM": null, "soldOut": false,
          "raw": "Type S1: 904 Sqft | 84 Sqm | 1 Bedroom | Nett: RM1.2mil-RM1.35mil | Gross: RM1.75mil-RM1.8mil",
          "held": []
        }
      ],
      "tenure": "Freehold",
      "completion": { "kind": "completed_year", "year": 2017 },
      "area": "Damansara Height",
      "facts": {
        "area": "Damansara Height", "developer": "{scrubbed text or null}", "landTitle": "Commercial (HDA)",
        "maintenanceFee": "RM0.65 psf (inclusive of sinking fund)", "tenure": "Freehold", "totalUnits": "370",
        "floors": "27 Storeys", "completion": "Completion Date: 2017 — Ready to Move In",
        "topReasons": null, "furnishing": null, "carPark": null
      },
      "focusLists": ["HIGH COMM 8% OR > RM100K COMMISSION MAIN CONTRIBUTORS"],
      "factSheet": "factsheets/damansara-city-residency-dc-residensi-UI9V4i.md"
    }
  ],
  "skipped": [ { "sheetName": "Ashbourne", "sheetRow": 186, "unitRows": 8, "reason": "new project, not in the inventory" } ],
  "heldBack": [ { "docId": "UI9V4ibcLUMuYQkd5lQK", "inventoryName": "Damansara City Residency (DC Residensi)", "sheetRow": 10, "unit": "Type E1", "column": "Size", "sheetText": "Type E1: 2,072 Sqft | 251 Sqm", "reason": "sqft and sqm disagree by more than 3% (2,072 sqft is 192 sqm, the sheet says 251)" } ],
  "conflicts": [ { "inventoryName": "Damansara City Residency (DC Residensi)", "unit": "Type B4", "column": "Rooms", "sheet": "2BR+1", "reference": "2BR+1+1", "referenceSource": "quick-kayinleong-094 brochure transcription", "action": "sheet value written" } ]
}
```

Field rules:
- `unitMode` is one of `merge`, `partial` or `none` (amended 2026-10-19: every project with unit rows is merged unit by unit; see R1).
  - `partial` is used only for Rafflesia, with `labelPrefix` "Hill 4 · " (a middle dot U+00B7 with one space either side, so the full prefix is "Hill 4" + " · "). The sheet covers only part of the project, so stored entries are never dropped, and the stored priceValue counts as a price candidate.
  - `merge` is used for the other 13 mapped projects that have unit rows, with `labelPrefix` "".
  - `none` means `units` is empty and `labelPrefix` is "".
- `tenure` is null or matches `^(Freehold|Leasehold( \d{4})?)$`.
- `completion` is null when the cell is blank. Otherwise it is `{kind, year}`, where `kind` is one of `completed_year`, `completed_no_year`, `future_or_expected` or `ambiguous`. `year` is an integer only for `completed_year`, and is then less than the import year (2026).
- `facts.*` values are strings or null. A held-back fact is null and appears in `heldBack` with the `column` set to the sheet header.
- For Developer, a removed contact line is reported as `{column: "Developer", sheetText: null, reason: "N line(s) with contact details removed"}`. The text itself is never stored.
- `units[].held` lists the column names held for that unit: "Size", "Rooms", "Nett" or "Gross". Each held value is null.
- `raw` joins the non-empty cells as `{Size} | {Rooms} | Nett: {Nett} | Gross: {Gross}`. Each cell is whitespace-collapsed, with newlines turned into spaces and runs of spaces into one.
  - A held cell is written as `{Column} not confirmed`. For a held Size cell the label is kept, as in "Type E1: size not confirmed".
  - "TBC" is kept verbatim. Sold-out cells are kept verbatim ("Sold out").

**Invariants.** Python enforces these before it writes anything, and TS `parseClientSheet` re-enforces them on load. A violation is a hard error that names the docId, unit and invariant, never the cell text.
1. `label` is non-empty and `raw` is non-empty.
2. `sizeSqft` is null or an integer from 100 to 30,000.
3. `bedrooms` is null or an integer from 0 to 10.
4. Nett and gross are each either both null or both integers from 50,000 to 100,000,000, with min ≤ max.
5. When nett and gross are both present, grossMin ≥ nettMin and grossMax ≥ nettMax.
6. `psfRM` is null or an integer from 200 to 5,000.
7. `soldOut` true means nett, gross and psf are all null.
8. The `unitMode` and `labelPrefix` rules above hold.
9. The `tenure` and `completion` rules above hold.
10. No string under `projects`, `skipped`, `heldBack` or `conflicts` hits the contact scanner. `meta` is excluded because the hashes are hex.

## Contract 2: `project-mapping.json` (T2 generates it; T3 and the dry-run report display it)

```json
{
  "meta": { "schema": "project-mapping/1", "export_exported_at": "2026-09-18T06:31:24.701Z", "workbook_sha256": "d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f" },
  "entries": [
    { "sheet": "Raw Data", "sheetName": "PDH: Royal Suites(RC)", "docId": "ggTnQ5DGqxlNBpYZwvhj", "inventoryName": "Pavilion Damansara Heights: Royal Suites(RC)", "matchedBy": "variant", "unitMode": "merge", "labelPrefix": "" },
    { "sheet": "Raw Data", "sheetName": "Rafflesia @ Hill 4", "docId": "t384yiOBBy3lwLl3m28w", "inventoryName": "Rafflesia @ Hill 2, 3 & 4", "matchedBy": "variant", "unitMode": "partial", "labelPrefix": "Hill 4 · " },
    { "sheet": "Sheet1", "sheetName": "AETAS SEPUTEH", "docId": "0l9kNIDgoi0ZKcM8Ighd", "inventoryName": "Aetas Seputeh", "matchedBy": "sheet1-alias", "unitMode": "none", "labelPrefix": "" }
  ],
  "skippedNew": ["Binastra Cochrane", "Lagenda Tunku (Villa Gemilang)", "Ashbourne"]
}
```

Matching uses exact names only, plus these hard-coded tables. There is no fuzzy matching (D5).
- `VARIANTS` (Raw Data): `PDH: Royal Suites(RC)` → `Pavilion Damansara Heights: Royal Suites(RC)`, and `Rafflesia @ Hill 4` → `Rafflesia @ Hill 2, 3 & 4`.
- `SHEET1_ALIASES`: `Southpoint Residences (IGB)` → `Southpoint Residences (IGB )`; `AETAS TAMAN DESA` → `Aetas Taman Desa`; `AETAS SEPUTEH` → `Aetas Seputeh`.
- `SKIPPED_NEW`: the 3 names above.
- Any other unmatched name is a hard failure that lists the names.
- Expected result: 78 `exact`, 2 `variant` and 3 `sheet1-alias` entries, which resolve to 81 distinct docIds.

## Contract 3: `factsheets/index.json` and the fact-sheet template (T2 writes them, T5 reads them)

```json
{ "meta": { "schema": "factsheets/1", "source_label": "D2 project info sheet supplied by the client, 19 October 2026", "workbook_sha256": "d432…" },
  "sheets": [ { "file": "factsheets/{slug}-{docId first 6}.md", "docId": "…", "inventoryName": "…",
                "title": "{inventoryName} — D2 project facts (client sheet)", "category": "{inventoryName}",
                "sha256": "{sha256 hex of the exact file bytes}" } ] }
```

The fact-sheet markdown is written exactly in this shape. Lines whose value is null are omitted, and so is a section that has no lines. Every section heading repeats the project name, so every 400-token chunk stays attributable to the project.

```markdown
# {inventoryName}: D2 project facts

Source: D2 project info sheet supplied by the client, 19 October 2026.
Listed in the sheet as: {sheetName}.          ← only when sheetName differs

## {inventoryName}: project facts
- Area: {facts.area}
- Developer: {facts.developer}
- Land title: {facts.landTitle}
- Tenure: {facts.tenure}
- Maintenance fee: {facts.maintenanceFee}
- Total units: {facts.totalUnits}
- Total floors / storeys: {facts.floors}
- Expected completion / vacant possession: {facts.completion}
- Furnishing: {facts.furnishing}
- Car park allocation: {facts.carPark}

## {inventoryName}: top reasons why
{facts.topReasons, one line per sheet line}

## {inventoryName}: D2 focus lists (2026)
- {heading 1}

## {inventoryName}: unit types (part {k} of {n})
| Type | Size | Rooms | Nett price | Gross price | Sold out |
|---|---|---|---|---|---|
| {label} | {Size cell} | {Rooms cell} | {Nett cell} | {Gross cell} | Yes or blank |
```

Unit tables hold at most 8 rows per part. Cell text is the verbatim sheet text, whitespace-collapsed, with `|` replaced by `/`. A held cell renders as "not confirmed (under review)"; TBC renders verbatim. Angle brackets and control characters are stripped everywhere. The Rafflesia table uses the sheet labels, without the "Hill 4 · " prefix, under the heading `{inventoryName}: Hill 4 unit types`. KB writes use `pillar: finder`, `lang: en`, and `category` = the inventory name (the to-kb.ts:178 precedent).

## Contact-detail scanner (Python `scan_contact_details`, TS `scanForContactDetails`). Same semantics in both

All patterns are case-insensitive. The scanner returns class names only, never the matched text:
- `email`: `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`
- `url`: `https?://\S+`, `\bwww\.\S+`, or `\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|my|net|org|io|co|biz|info|asia)(?:\.[a-z]{2})?\b`
- `wa.me`: `\bwa\.me\b`
- `phone`: `(?<![0-9A-Za-z,.])\+?\d(?:[ -]?\d){8,12}(?![0-9A-Za-z,])` or `\(0\d{1,2}\)\s?\d{3,4}[ -]?\d{4}`
- `ic`: `(?<!\d)\d{6}-\d{2}-\d{4}(?!\d)`

`pii-vectors.json` (T2 writes it; T1 inlines the same vectors; T5 cross-checks the file). All of these are synthetic:
- `hit` (each must produce ≥1 class): "Call 012-000 0000", "+60 12-000 0000", "Tel 03-0000 0000", "(03) 0000 0000", "someone@example.com", "https://example.com/brochure", "www.example.com", "visit example.com.my", "wa.me/60120000000", "000000-00-0000".
- `miss` (each must produce 0 classes): "RM1,243,856–RM1,784,150", "Type A1 BU 3899sqft  LA 4101-8181 sqft", "H1: 3,380 sq.ft.", "Leasehold till 10 March 2118 (94 years as of 2024)", "Completion Date: 2019/2020", "1,434 units", "Q4 2024/Q1 2025", "St. Regis Residences Kuala Lumpur", "E&O – City of Elmina", "RM0.65 psf (inclusive of sinking fund)", "d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f", "Rm4.77mil – Rm6,59mil".

## Parser cases (T2's `wbparse.py` must produce exactly these; `verify-client-sheet.py` asserts every row)

Size cell → (label, sizeSqft | held reason). The label regex is `Type\s+[A-Z][A-Za-z0-9]*(?:-[A-Z0-9]+)?(?:\s*&\s*[A-Z][A-Za-z0-9]*)?` or `[A-Z]{1,3}\d+[a-z]?`, matched after a strip. A row with no label is held as a whole. For the size, use the `BU` number when "BU" is present. Otherwise take the first `(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s*(sq\.?\s*ft\.?|sqft|sft|sf)(?![a-z])`, case-insensitive. When a `NNN Sqm` is present and |sqft/10.7639 − sqm|/sqm > 3%, hold the size. Sizes must fall in 100–30,000.
- "Type S1: 904 Sqft | 84 Sqm " → Type S1, 904
- "Type E1: 2,072 Sqft | 251 Sqm " → Type E1, held (sqm disagreement)
- "Type E2: 2982 Sqft | 277 Sqm " → Type E2, 2982
- "\nH1: 3,380 sq.ft." → H1, 3380
- "H2a: 4,090 sq.ft. \n" → H2a, 4090
- "Type A2: 689sft" → Type A2, 689
- "Type A: 570 sf" → Type A, 570
- "Type D: 109s sf" → Type D, held (unparseable)
- "Type M1-A: 1012 Sqft " → Type M1-A, 1012
- " Type J1:  635 sqft" → Type J1, 635
- "DK1:  1,302 sqft " → DK1, 1302
- "Type A1 BU 3899sqft  LA 4101-8181 sqft" → Type A1, 3899 (LA is land area: fact-sheet text only)
- "Type A: 549sft/1-2CP" → Type A, 549
- "Type B : 721sft/2CP" → Type B, 721
- "Type D - 2 +1 rooms 2 baths: 1076sft/2CP" → Type D, 1076
- "Type E & E1 - 3,964sf\n" → Type E & E1, 3964
- "Type B1A: 681sf" → Type B1A, 681
- "Type A3a: 9,192 Sqft" → Type A3a, 9192
- "Type D1: 19,031 Sqft" → Type D1, 19031

Rooms cell → bedrooms. Use `^\s*studio\b` → 0; otherwise `^\s*(\d{1,2})\s*(?:\+\s*\d\s*)*bed`, which gives the first integer (the "+N" never counts). Anything else gives null.
- "1 Bedroom" → 1; "1 Bedroom + 1" → 1; "2 Bedrooms + 1 + 1" → 2; "3 Bedrooms + 1+1" → 3; "2 Bedroom + 1" → 2; "4+1 Bedrooms" → 4
- "1+1 Bedroom, 1Bathroom" → 1; "1 bedroom, 1 bathroom" → 1; "2+1 Bedroom, 2Bathrooms" → 2; "3 Bedroom, 2 Bathrooms, 1 Balcony" → 3
- "2 Bedrooms, 2 Bathrooms + 1 Studio + 1 Bath" → 2; "Studio" → 0
- "Suite" → null; "Dual Key" → null; "1 flexi room 1 bath" → null
- "5+1 Bedroom + 6 Bathroom + 1 Powder" → 5; "4+2 Bedroom, 5 Bathrooms + 1 Powder" → 4; "5+2 Bedrooms, 6 Bathrooms" → 5

The layout code is used only for the DC Residensi cross-check: `{N}BR` followed by "+1" once for each `+ digit` group before the first comma. So "2 Bedroom + 1" → 2BR+1 and "3 Bedrooms + 1+1" → 3BR+1+1.

Price cell (Nett or Gross) → kind. Lowercase the cell, map – and — to -, and collapse spaces around "-".
- `sold out` → sold_out
- `tbc` → tbc (held)
- `^(?:from\s+)?(?:rm\s*)?(\d[\d,]*)\s*psf$` → psf, which must fall in 200–5,000 or it is held
- a non-string (float/int) cell, or a bare string number below 10,000 with no suffix → ambiguous (held)
- otherwise the full-match total `AMOUNT(?:-AMOUNT)?`, where AMOUNT = `(?:rm\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(mil|m|k)?`
  - mil and m mean ×1,000,000; k means ×1,000. Multiply with `decimal.Decimal` and round to an int.
  - If exactly one side has a suffix → unparseable (held).
  - The value must fall in 50,000–100,000,000, and min ≤ max.
  - Anything else → unparseable (held).

Cases:
- "RM1.2mil-RM1.35mil" → 1200000–1350000; "Sold out" → sold_out; "Rm5.05mil – Rm7.15mil" → 5050000–7150000
- "Rm4.77mil – Rm6,59mil" → unparseable; "Rm19.2mil" → 19200000–19200000; "903k-950k" → 903000–950000; "877k" → 877000–877000
- "RM1.03Mil- RM1.06Mil" → 1030000–1060000; "RM815k- RM860k" → 815000–860000; "RM4.6m-Rm5m" → 4600000–5000000
- "RM1,243,856–RM1,784,150" → 1243856–1784150; "RM1,525,440" → 1525440–1525440; "3.717Mil-3.783Mil" → 3717000–3783000; "RM30.9Mil" → 30900000–30900000
- "1350psf" → psf 1350; "from RM1960psf" → psf 1960; "RM2200psf" → psf 2200; "988psf" → psf 988
- "TBC" → tbc; 690.0 (float cell) → ambiguous; "150psf" → psf held (out of range); "RM2mil-RM1mil" → held (min > max)

Unit-level gates:
- If Nett or Gross is sold_out, the unit is soldOut with all prices null.
- A psf in the Gross column fills `psfRM`, and gross stays null.
- If gross (total) < nett on either bound, hold both Nett and Gross for that unit.

Tenure → value. Strip the cell first.
- Starts with "freehold" and does not contain "leasehold" → "Freehold".
- Contains "leasehold" and not "freehold" → "Leasehold", plus " YYYY" when exactly one distinct 4-digit year in 2050–2200 is present.
- If the cell matches `\bunits?\b`, it is a column shift: hold Tenure, Total units and Floors for that project.
- Anything else → held ("not a tenure value").

Cases:
- "Freehold\n\n\n\n" → Freehold; "Freehold Residential" → Freehold; " Leasehold" → Leasehold
- "Leasehold till 2116 (developer to attempt renewal for 95–99 …" → Leasehold 2116; "Leasehold 99 years (expiring 11 May 2113)" → Leasehold 2113
- "Leasehold (until 31st Dec 2114)" → Leasehold 2114; "Leasehold till 10 March 2118 (94 years as of 2024)\xa0" → Leasehold 2118; "Leasehold expiring yr 2114" → Leasehold 2114
- "Leasehold (to be renewed fresh 99 years by 2029)" → Leasehold; "88 years Leasehold" → Leasehold
- "Residential (under HDA)" → held; "1,434 units\n\n\n" → column shift (held)

Completion → kind. Strip a leading `Completion Date`, `VP Date` or `Completion/VP Date` label and the colon.
- An empty remainder → blank (null).
- Let `years` = the distinct 4-digit years 1990–2100, `marker` = `\bcompleted\b|ready to move in`, and `expect` = `target|estimat|\best\.|planned|expected|anticipat|tentative|phase|from spa|months`.
- marker and no years → completed_no_year.
- More than one year → ambiguous.
- One year with expect → future_or_expected if the year ≥ 2026, else ambiguous.
- One year without expect → completed_year if the year < 2026, else future_or_expected.
- No years and no marker → ambiguous.

Cases:
- "Completion Date: 2017 — Ready to Move In" → completed_year 2017; "Completion Date: September 2021" → 2021; "VP Date: March 2023" → 2023; "Completion Date: Q4 2024" → 2024; "Completion Date:  2010" → 2010
- "Completion Date: Completed" → completed_no_year; "Completion Date: 12 years completed" → completed_no_year
- "VP Date: Q4 2029" → future_or_expected; "Completion Date: Q1 2026" → future_or_expected; "Completion/VP Date: Q3 – Q4 2026" → future_or_expected; "Completion Date: Target 2nd Half 2029" → future_or_expected
- "Completion Date: Target 2025" → ambiguous; "Completion Date: 2019/2020" → ambiguous; "Completion Date: Q4 2024/Q1 2025" → ambiguous
- "Completion Date:\n1. Phase 1: Q2 2025\n2. Phase 2: Q1 2028" → ambiguous; "Completion Date: End of 2025\nFor Phase 2E & 2H" → ambiguous
- "Completion Date: " → blank

Fact gates. Each one holds the fact and lists it in heldBack.
- Every fact: control characters and angle brackets are stripped; a fact longer than 2,000 characters is held; a fact that matches the injection pattern `ignore (?:all |any )?(?:previous|prior|above) instructions|system prompt|disregard (?:the )?(?:above|previous)|you are now` is held.
- Maintenance fee must match `rm|psf|tbc|per\s*sq`, so The Oval "Residential" and TRX Residences "Commercial HDA for residential use" are held.
- Total units and Floors must contain a digit. A Total units float such as 370.0 becomes "370".
- Developer is split into lines. Any line that hits the scanner is dropped and only the count is reported. The developer text from Raw Data!G21 (Imperial) must come out with zero scanner hits.

Expected unit-level holds. The verifier asserts exactly this set: 8 units.
1. DC Residensi Type E1: Size.
2. The Lantern Bangsar Type D: Size.
3. PDH: Imperial Residences RA H1a: Nett.
4. Imperial H2: Nett and Gross, because gross is below nett.
5. Parkside Residences Type E1: Nett and Gross (TBC).
6. Puncak Wangsamas Phase 2 Type A1: Gross (ambiguous).
7. Puncak Wangsamas Phase 2 Type A2: Gross (ambiguous).
8. Puncak Wangsamas Phase 2 Type A4: Gross (ambiguous).

Expected project-level holds:
- Riana Trees Residences: Tenure.
- Sentral Suites @ KL Sentral: column shift (Tenure, Total units).
- The Oval Kuala Lumpur: Maintenance fee.
- TRX Residences: Maintenance fee.

Expected ambiguous completions, listed in HELD-BACK as "not written to the record":
- Bangsar Hill Park
- IJM Sierra Hijauan
- SO Sofitel Residences KLCC
- Star Residences KLCC
- 26 Araville PJ

Expected DC Residensi conflicts with `.planning/quick/quick-kayinleong-094/unit-types.json`: Rooms {B4, B6, B7, E2} and Size {E1}. This computed set is the D9 conflict set; it replaces the earlier "B4–B7" wording (orchestrator amendment, 2026-10-19). B5 agrees with the brochure and is not listed. The sheet value is written for every rooms conflict. The E1 size is also held back.

Expected counts:
- 83 distinct Raw Data projects (Park Green at Pavilion Bukit Jalil appears twice; its row-112 duplicate is empty and is ignored and reported).
- 80 of them map, plus Aetas Seputeh from Sheet1, for 81 projects in the JSON. 3 are skipped (Ashbourne has 8 unit rows).
- 106 units across 14 projects. 16 are soldOut: DC 14, One Eleven 1 (M2), Eden 1 (C1).
- "HIGH TICKET SUBSALE" has no names.
- Exsim Project has no facts, so it gets no fact sheet and is reported.

## Planner rules: `planProjectPatch` (T1). Apply R1–R13 in order

Amended 2026-10-19 by the orchestrator. The earlier whole-list replace broke the user's rule that a blank cell never clears a stored value. It is replaced by the unit-level merge in R1 (U1–U6), and every derived value (R3–R5) is computed over the FINAL merged list.

- **R1. Unit-level merge.** This applies to every project with unitMode `merge` or `partial`, i.e. every matched project with unit rows, Rafflesia included. Build the final unit list with U1–U6.
  - **U1. Label key.** `labelKey(label, labelPrefix)` works in this order:
    1. remove a leading labelPrefix if present;
    2. remove ONE trailing parenthetical qualifier, `\s*\([^)]*\)\s*$` (a planner extension, flagged under Discretion; without it, stored "Type H1 (North Wing)" never matches the sheet's "H1");
    3. lowercase;
    4. remove a leading `type` word;
    5. replace every run of non-alphanumeric characters with one space, then trim.

    Examples:
    - "Type H1 (North Wing)" → "h1"
    - "H1a" and "Type H1A (South Wing)" → "h1a"
    - "Type M1-A" → "m1 a"
    - "Type A3 & B3" → "a3 b3"
    - "Hill 4 · Type E & E1", with the prefix → "e e1"
    - "J3" and "Type J3" → "j3"
    - "1+1 Bedrooms" → "1 1 bedrooms"

    Rafflesia's sheet units are matched by their sheet label without the prefix.
  - **U2. Matching.** Walk the sheet units in sheet order. Each stored entry can be matched at most once. The candidates are the unmatched stored entries with an equal key.
    - Exactly one candidate → match.
    - More than one → keep only the candidates whose `sizeSqft` equals the sheet unit's `sizeSqft`. If exactly one remains, match it. Otherwise there is no match: raise an `ambiguous-label-match` warning and add the unit (U4).

    Rafflesia has two stored "Type E & E1" entries (3,879 and 3,964 sqft); the sheet unit is 3,964, so it matches the 3,964 entry.
  - **U3. Merging a matched pair.** The merged entry stays in the stored entry's position.
    - `label`: the stored label. In `partial` mode it becomes labelPrefix + the stored label with any earlier prefix removed, so a re-run is a no-op.
    - `sizeSqft` and `bedrooms`: the sheet value when it is non-null, otherwise the stored value.
    - `priceMinRM`/`priceMaxRM`, as a pair:
      - the sheet nett when it is non-null;
      - null and null when the sheet unit is sold out (a "Sold out" cell is a stated value, not a blank);
      - otherwise the stored pair.
    - `soldOut`:
      - true when the sheet unit is sold out;
      - kept from the stored entry only when the sheet row states no availability at all (nett and gross both null, and neither "Nett" nor "Gross" in `held`);
      - otherwise the key is omitted.
    - `raw`: the sheet raw line. When at least one non-null stored value was kept, append ` | kept from previous record: {fields}`. The fields are comma-separated in the fixed order size, bedrooms, price, soldOut, so a re-run produces the identical string.
  - **U4. Unmatched sheet unit.** It becomes a new entry `{label: labelPrefix + label, sizeSqft, bedrooms, priceMinRM: nettMinRM, priceMaxRM: nettMaxRM, raw}`, plus `soldOut: true` only when it is sold out. Omit the key otherwise; never write undefined, because Firestore rejects it.
  - **U5. Stored entry with no match.**
    - In `partial` mode (Rafflesia), it is always kept.
    - In `merge` mode, it is kept unless it is a grouped or bucket entry AND the sheet lists at least one unit for the project. A grouped entry is one whose label, after the prefix is removed and the label is trimmed, does NOT start with a type code. A type code matches the T2 label regex, case-sensitive, at the start: `Type\s+[A-Z]…` or `[A-Z]{1,3}\d+[a-z]?`.
      - Grouped examples: "1 Bedroom", "1+1 Bedrooms", "2+1 Rooms", "5+1 bedrooms", "Penthouses", "Studio".
      - Not grouped: "Type A3 & B3", "J3", "Type H1 (North Wing)".
    - Every drop raises a `unit-dropped` warning that names the label and says whether the dropped entry carried a price.
    - Hold group `unitDrops` (R9) keeps every would-be-dropped entry for that project.
  - **U6. Final list.** The stored entries in their original order (merged in place, or kept), minus the dropped ones, followed by the new entries in sheet order.
- **R2. When unitTypes is planned.** It is planned when unitMode is `merge` or `partial` and the project has at least one sheet unit. For `none`, or when there are no units, unitTypes and the derived values in R3–R5 are not planned.
- **R3.** `available` = the final list with sold-out entries removed. The size pool is the available entries with a non-null size; when available is empty, it is every final entry with a size. If the pool is empty, plan no size keys. Otherwise `sizeMinSqft` = min and `sizeMaxSqft` = max.
- **R4.** `bedrooms` = the smallest `bedrooms ≥ 1` over the available final entries (over the whole final list when available is empty). If none, plan no key. Studios (0) are excluded because the project-level 0 means unknown.
- **R5.** `priceValue` comes from a candidate set:
  - the non-null `priceMinRM` of the available final entries;
  - in `partial` mode only, also the stored project `priceValue` when it is > 0. The sheet covers only part of the project, so the stored figure may describe the units the sheet omits. This is a planner extension, flagged under Discretion; without it Rafflesia would rise to 3,717,000, because its stored entries carry no prices.

  There is no fallback to sold-out entries. Plan no price keys when the candidate set is empty or its minimum equals the stored priceValue; in `partial` mode with the stored figure winning, also raise a `partial-coverage-price-kept` warning. Otherwise:
  - If the minimum is a sheet nett (a tie goes to the sheet): plan `priceValue`, `priceBand` = `priceBandFor(v)`, `priceProvenance` = 'stated' and `priceSource` = 'client-workbook', plus `priceSourceChunkId` = `DELETE_FIELD` when the stored doc has that key.
  - If the minimum is a stored unit price that was kept: plan `priceValue`, `priceBand` and `priceProvenance` = 'stated' only. Leave `priceSource` as it is, and raise a `price-from-kept-unit` warning.
- **R6.** `pricePsfMin`/`pricePsfMax` = the min/max of `psfRM` over non-sold-out workbook units. If none, plan no psf keys. When psf is planned, price is not, and the existing `priceValue` is not > 0, plan `priceProvenance` = 'psf_only'.
- **R7.** Plan `tenure` when the sheet tenure is non-null and differs from the stored one, with one exception: sheet "Leasehold" against an existing value matching `^Leasehold \d{4}$` → no key, plus a `tenure-kept-specific` warning (never overwrite with weaker evidence; this is a quick-088 rule).
- **R8.** `completed_year` → `vpStatus: true` and `vpDate: new Date(Date.UTC(year, 0, 1))` (the to-inventory.ts:180 convention). `completed_no_year` → `vpStatus: true` only. Every other kind → nothing. Warn with `vp-conflict` when the existing vpStatus is true and the kind is future_or_expected or ambiguous, or when the existing vpDate year differs from the sheet year.
- **R9.** Holds come from `review-holds.json` and use these groups:
  - `unitTypes`: unitTypes (the stored list stays exactly as it is)
  - `unitDrops`: no field. It keeps every U5 would-be-dropped entry in the final list, and the derived values in R3–R5 are recomputed with them included
  - `sizes`: sizeMinSqft, sizeMaxSqft
  - `bedrooms`: bedrooms
  - `price`: priceValue, priceBand, priceProvenance, priceSource, priceSourceChunkId
  - `psf`: pricePsfMin, pricePsfMax
  - `tenure`: tenure
  - `vp`: vpStatus, vpDate

  Drop the keys of every held group, with one `hold-applied` warning per group. An unknown group is an error.
- **R10.** Keep only the keys whose planned value differs from the existing one. Use deep equality; compare a Date with a Timestamp-like value by milliseconds; `DELETE_FIELD` differs only when the key exists.
- **R11.** `asserted` = the ClientWorkbookFields planned by R1–R8 after holds, whether or not they changed. Plan `clientWorkbookFields` = the sorted union of the existing list and `asserted`, and include it if it differs. When any change remains, plan `clientWorkbookImportedAt` = importedAt.
- **R12.** `reembed` = whether the changes touch `priceValue`, `tenure` or `bedrooms`. The import never writes name, description or locationText. Never plan `status`. `allUnitsSoldOut` = the final list is non-empty and available is empty; when it is true, add an `all-units-sold-out` warning ("status left unchanged; user decides", D3).
- **R13.** Further warnings. Every one is rendered in the dry-run report:
  - `unit-dropped`: one per U5 drop, naming the label and flagging a carried price (for example, Puncak's "5+1 bedrooms" carried 3,600,000).
  - `kept-from-previous`: one per merged entry that kept a stored value, naming the label and the fields.
  - `ambiguous-label-match` (U2), `partial-coverage-price-kept` and `price-from-kept-unit` (R5).
  - `area-not-in-location`: the lowercased, trimmed sheet area is not a substring of the lowercased locationText (D6). Show the area value only.

**Workbook-only baseline.** T3's contract test pins these against a stored doc with NO unitTypes and `priceValue: 0`. That isolates the sheet side of the rules from the stored lists, which exist only in live data.
- priceValue:
  - DC Residensi 1,200,000; PDH: Imperial Residences RA 5,050,000; ViiA Residences 862,000; One Eleven Menerung @ Bangsar 1,920,000; Parkside Residences 588,000
  - Puncak Wangsamas Phase 2 3,200,000; Eden BRDB, Taman Duta 8,500,000; SO Sofitel Residences KLCC 1,212,640; Jewel by Oxley KLCC 1,601,663
  - Luminar Residence Subang by BRDB 411,000; Rafflesia @ Hill 2, 3 & 4 3,717,000 (in the baseline the stored priceValue is 0, so there is no partial candidate)
  - No price key for The Lantern Bangsar, PDH Royal Suites or Southpoint
- psf:
  - ViiA 1350–1350; One Eleven 1760–2200; Parkside 1200–1300; Eden 1625–1700; Luminar 700–847; Rafflesia 988–1006
  - None for the others. psf comes from sheet units only, because it is not stored per entry.
- Sizes: DC 904–2982, Eden 5307–19031, Lantern 570–852.
- Bedrooms: Imperial 4, One Eleven 2, Eden 4, SO Sofitel 1.

**Stored lists for T1 fixtures.** These are copied from the 2026-09-18 snapshot and hold labels, sizes, bedrooms and prices only (no PII). Each entry is label / sqft / bedrooms / price.
- Southpoint Residences (IGB ), stored priceValue 1,740,000:
  - Type C 1119 / 2 / 1,740,000
  - Type D 1636 / 3 / 2,380,000
  - Type E 2282 / 3 / 3,210,000
  - Type E1 2303 / 3 / 3,260,000
  - Type A3 & B3 2347 / 3 / 3,490,000
  - Type A2 2809 / 3 / 4,270,000
  - Type B2 3477 / 5 / 5,260,000
  - Type A1 5210 / 5 / null
  - Type B1 5877 / 5 / null
- Rafflesia @ Hill 2, 3 & 4, stored priceValue 2,900,000, sizes null/null, bedrooms 5. All entries have bedrooms null and price null:
  - Type A & A1 3655
  - Type B & B1 3879
  - Type C & C1 3655
  - Type D & D1 3655
  - Type E & E1 3879
  - Type E & E1 3964
  - Type F & F1 3950
  - Type G & G1 3877
  - Type H & H1 3877
- DC Residensi: "1 Bedroom" 904 / 1, "1+1 Bedrooms" 1100 / 1, "2+1 Bedrooms" 1600 / 2, "3+1 Bedrooms" 2700 / 3 (all unpriced, all grouped).
- PDH: Imperial Residences RA: "Type H1 (North Wing)" 3380, "Type H1A (South Wing)" 3380, "Type H2 (North Wing)" 4090, "Type IR1 (Penthouse)" 7459 (bedrooms and prices null).
- Puncak Wangsamas Phase 2: "5+1 bedrooms" 4000 / 5 / 3,600,000 (grouped).

**Expected T1 fixture outcomes.** T1 tests assert these exactly.
- Southpoint: stored 9 entries → final 11.
  - 8 merged in place: C, D, E, E1, A2, B2, A1, B1. Their size and bedrooms come from the sheet. C, D, E, E1, A2 and B2 keep their stored price, and their raw ends with " | kept from previous record: price".
  - "Type A3 & B3" is kept untouched; it has a type code and no sheet match.
  - "Type A3" and "Type B3" are appended as new and unpriced.
  - **7 priced entries before and after.** priceValue 1,740,000 is unchanged, so no price keys are planned; sizes 1119–5877 and bedrooms 2 are unchanged.
- Rafflesia: stored 9 entries → final 9.
  - "Type E & E1" (the 3,964 sqft entry, chosen by the U2 tie-break) and "Type G & G1" are merged in place and relabelled "Hill 4 · Type E & E1" and "Hill 4 · Type G & G1". They gain bedrooms 5, nett 3,717,000–3,783,000 and 3,901,000–4,217,000, and the sheet raw.
  - The other 7 entries are kept unchanged.
  - **priceValue stays 2,900,000.** The stored figure is lower than 3,717,000, so a `partial-coverage-price-kept` warning is raised and no price keys are planned.
  - sizeMinSqft/sizeMaxSqft go from null/null to 3655/3964, psf from null to 988–1006, and bedrooms stays 5.
  - Planning again against the merged doc gives zero changes.
- DC Residensi: all 4 grouped entries are dropped, with 4 `unit-dropped` warnings. With hold `unitDrops`, they are kept and the sizes are recomputed over 22 entries. The final list is the 18 sheet units, priceValue is 1,200,000 and sizes are 904–2982.
- Imperial: the 4 stored entries match H1, H1a, H2 and IR1 through the U1 qualifier strip, and keep their stored labels. H2a is appended. That gives 5 entries.
- Puncak: "5+1 bedrooms" is dropped with a `unit-dropped` warning that flags its 3,600,000 price. priceValue is 3,200,000.

**Predicted live outcomes.** These are against the 2026-09-18 snapshot; the CP-A dry run is authoritative.

| Project | Stored → final entries | Matched / added / kept unmatched / dropped | priceValue before → after |
|---|---|---|---|
| Damansara City Residency (DC Residensi) | 4 → 18 | 0 / 18 / 0 / 4 grouped | 0 → 1,200,000 |
| PDH: Imperial Residences RA | 4 → 5 | 4 / 1 / 0 / 0 | 0 → 5,050,000 |
| ViiA Residences | 0 → 5 | 0 / 5 / 0 / 0 | 846,000 → 862,000 |
| The Lantern Bangsar | 5 → 6 | 3 (B, C, D; D keeps stored size 1,092) / 1 (Type A) / 2 (Type A1, Type A2) / 0 | 0 → no key; sizes stay 561–1092 |
| One Eleven Menerung @ Bangsar | 1 → 6 | 1 (L) / 5 / 0 / 0 | 1,745,000 → 1,920,000 |
| Pavilion Damansara Heights: Royal Suites(RC) | 3 → 10 | 3 (J3, M1, M2) / 7 / 0 / 0 | 652,284 unchanged |
| Parkside Residences | 6 → 10 | 5 / 4 (C1, C2, E1, E2) / 1 (Type C) / 0 | 920,000 → 588,000 |
| Puncak Wangsamas Phase 2 | 1 → 3 | 0 / 3 / 0 / 1 grouped, priced | 3,495,000 → 3,200,000 |
| Eden BRDB, Taman Duta | 0 → 5 | 0 / 5 / 0 / 0 | 7,700,000 → 8,500,000 |
| Southpoint Residences (IGB ) | 9 → 11 | 8 / 2 / 1 (Type A3 & B3) / 0 | 1,740,000 unchanged |
| SO Sofitel Residences KLCC | 0 → 15 | 0 / 15 / 0 / 0 | 1,350,000 → 1,212,640 |
| Jewel by Oxley KLCC | 1 → 9 | 0 / 9 / 0 / 1 grouped ("2+1 Rooms") | 0 → 1,601,663 |
| Luminar Residence Subang by BRDB | 5 → 5 | 5 / 0 / 0 / 0 | 0 → 411,000 |
| Rafflesia @ Hill 2, 3 & 4 | 9 → 9 | 2 / 0 / 7 / 0 (partial never drops) | 2,900,000 unchanged |

Near-duplicates are kept by design, because type-coded stored entries are never dropped. The user should review them at CP-A:
- Lantern "Type A1" against the sheet's "Type A", both 570 sqft;
- Parkside "Type C" (646) against "Type C1" (646) and "Type C2";
- Southpoint "Type A3 & B3" against "Type A3" and "Type B3".

## Finder prompt rule (T1). Insert as a new bullet directly after `src/agents/finder/prompt.ts:175`

`- **Sold-out layouts.** A unitTypes entry with "soldOut": true is SOLD OUT. When you list it, put "sold out" on the same line, never offer it as available, and never quote a price for it. If every layout is sold out, say so plainly and do not present the project as available stock.`

## Env guard (T1 `assertSafeTarget`)

- If `FIRESTORE_EMULATOR_HOST` is non-empty: `FIREBASE_PROJECT_ID` (or `GCLOUD_PROJECT`) must start with `demo-`, and the result is 'emulator'. Otherwise throw (an emulator host with a real project id is refused).
- Else if `FIREBASE_PROJECT_ID === 'cy-csaiagent'` → 'live'.
- Otherwise throw `refusing to run: FIREBASE_PROJECT_ID is "{value or unset}"; expected cy-csaiagent or the emulator`.

The guard never reads or prints any credential variable.

## Fingerprint (T3 `planFingerprint`)

sha256 hex of `JSON.stringify` over `{mappingSha256, holds, plans}`:
- `plans` = `[{docId, changes: [{field, after}]}]`, sorted by docId and then by field.
- `clientWorkbookImportedAt` is excluded.
- A Date becomes its ISO string, and `DELETE_FIELD` becomes `"$delete"`.
- Arrays keep their order. Object keys are sorted recursively.
- The fact-sheet fingerprint (T5) is the same idea over `[{title, action, sha256}]`.

</interfaces>

## Waves, ownership and live steps

| Wave | Task | Who | Owns (writes) | Must not touch |
|---|---|---|---|---|
| 1 | T1 tracer: TS core contract, planner, sold-out read path | executor (claude-sonnet-5-5) | collections.ts, client-workbook-safety.ts, client-workbook.ts, client-workbook.test.ts, prompt.ts, project-detail.test.ts | everything else |
| 1 | T2: Python stage 1 (parse, gates, mapping, HELD-BACK, fact sheets, verifier) | executor | claim-dir files listed in T2 only | src/, scripts/, .gitignore, claim 095 |
| 2 | T3: stage 2 runner + CLI + contract test + gitignore | executor | client-workbook-run.ts(+test), client-workbook.contract.test.ts, scripts/import-client-workbook.ts, .gitignore | T1/T2 outputs (read only) |
| 2 | T4: re-run guards + export allowlist | executor | the 3 backfill scripts, export script, scripts/client-workbook-guards.test.ts | everything else |
| 2 | T5: stage 3 fact-sheet ingest | executor | src/kb/client-factsheets.ts(+test), scripts/ingest-client-factsheets.ts | src/kb/crud.ts, pipeline.ts (read only) |
| — | CP-A: live dry runs → user decision (checkpoint:decision, blocking-human) | ORCHESTRATOR only | IMPORT-DRYRUN.md, FACTSHEETS-DRYRUN.md, review-holds.json | — |
| — | CP-B: live apply → verify → re-export (checkpoint:human-verify, blocking-human) | ORCHESTRATOR only | IMPORT-APPLY.md, FACTSHEETS-APPLY.md, backups/ (gitignored), projects.export.json (gitignored) | — |
| 3 | T6: refresh claim-095 UAT facts | executor | 095 uat-cases.json, docs/UAT-Output-Test-Cases.xlsx, docs/UAT-Output-Test-Plan.md (only if a stated fact changed) | 096 files |

Sequencing reasons:
- Wave 2 consumes T1's exported types and helpers, and T2's committed JSON, fact sheets and pii-vectors.
- The two wave-1 tasks build against the frozen contracts above. Their agreement is proven in wave 2 by T3's contract test, which feeds the real T2 JSON through the T1 schema and planner, and by T5's scanner-equivalence test.
- No 095 file is scheduled before CP-B, because a sibling agent is editing claim 095 now (D12).
- The orchestrator commits each task separately at the wave boundary.

<tasks>

<task type="tracer" tdd="true">
  <name>T1 (wave 1, tracer): a sold-out unit travels end to end through the TS core: client-sheet contract → planProjectPatch → stored UnitTypeEntry → projectDetail payload → Finder sold-out rule</name>
  <files>src/firebase/collections.ts, src/inventory/client-workbook-safety.ts, src/inventory/client-workbook.ts, src/inventory/client-workbook.test.ts, src/agents/finder/prompt.ts, src/agents/finder/project-detail.test.ts</files>
  <behavior>
    - parseClientSheet accepts a valid fixture and rejects each of the 10 invariants in the interfaces (e.g. psfRM 150, nett min above max, gross below nett, soldOut with a price, sizeSqft 50, a synthetic phone in a fact string). Each error names the docId and unit, never the cell text.
    - No stored list (ViiA-like): unitTypes is the sheet entries in sheet order; nett goes in priceMin/Max; raw is verbatim; available units have no soldOut key.
    - labelKey and isGroupedLabel give every U1/U5 example in the interfaces exactly.
    - Southpoint fixture (the stored list in the interfaces) → exactly the "Expected T1 fixture outcomes":
      - 11 entries;
      - 7 priced before and after;
      - C, D, E, E1, A2 and B2 keep their stored price, and their raw ends with " | kept from previous record: price";
      - "Type A3 & B3" is untouched;
      - A3 and B3 are appended;
      - no price, size or bedrooms keys.
    - Rafflesia fixture → exactly the expected outcome:
      - 9 entries, 2 relabelled "Hill 4 · …" and priced, the E & E1 match chosen by size;
      - no price keys, plus a `partial-coverage-price-kept` warning;
      - sizes 3655/3964 and psf 988–1006 planned;
      - planning again against the merged doc gives zero changes.
    - DC fixture: 4 grouped entries dropped with 4 `unit-dropped` warnings. With hold `unitDrops` they are kept. Imperial fixture: the qualifier labels match, H2a is appended, 5 entries. Puncak fixture: the priced grouped entry is dropped, and the warning flags 3,600,000.
    - Merge field rules (U3):
      - a sheet null keeps the stored value and names it in the raw suffix;
      - a sheet sold-out unit nulls a stored price;
      - a stored entry not in the sheet with a type code is kept;
      - two stored entries with the same key and no size tie → `ambiguous-label-match`, and the sheet unit is added.
    - Sold-out exclusion (DC-like): priceValue is 1,200,000, from the non-sold-out S1/S2/A3 only; the size range is 904–2982, from non-sold-out units only; sold-out entries carry soldOut:true and null prices.
    - All units sold out: sizes fall back to every unit; no price keys are planned; allUnitsSoldOut is true; the patch has no `status` key.
    - A blank never clears: a sheet project with no units, tenure null and completion null yields no unitTypes/size/price/tenure/vp keys.
    - Price provenance: priceBand comes from priceBandFor; 'stated' + 'client-workbook'; priceSourceChunkId is planned as DELETE_FIELD only when it exists. In the psf-only case with existing priceValue 0 → 'psf_only', and priceSource is not planned.
    - Tenure: sheet 'Leasehold' against existing 'Leasehold 2116' → no change plus a warning; 'Freehold' against 'Unknown' → change.
    - Completion: completed_year 2017 → vpStatus true and vpDate 2017-01-01T00:00:00.000Z; completed_no_year → vpStatus only; future_or_expected against an existing vpStatus true → no vp keys plus a vp-conflict warning.
    - Holds ['price','unitTypes'] remove those groups and warn; hold 'unitDrops' keeps the grouped entries; an unknown group throws.
    - Markers: clientWorkbookFields is the sorted union; clientWorkbookImportedAt is present only when other changes exist; re-planning against the post-apply doc gives zero changes (idempotent).
    - reembed is true only when priceValue, tenure or bedrooms change. area-not-in-location fires for "Damansara Height" against a locationText that lacks it.
    - assertSafeTarget matrix: emulator + demo- → 'emulator'; emulator + cy-csaiagent → throws; live id → 'live'; unset or other → throws.
    - scanForContactDetails: every interface `hit` vector hits and every `miss` vector misses.
    - getProjectDetail, fed a doc whose unitTypes holds one soldOut:true entry, returns that entry with soldOut true. FINDER_SYSTEM_PROMPT contains `"soldOut": true` and `never offer it as available`.
  </behavior>
  <action>
Implement the shared TS core that every later task consumes. Follow the interfaces section exactly (Contract 1, the scanner, R1–R13, the env guard and the prompt rule). This task implements D2, D3, D4, D6, D7 and D8 in pure code, and the TS half of D9/D10.

1. `src/firebase/collections.ts`. Change types and doc comments only, and nothing else in the file.
   - `UnitTypeEntry` (:393): add `soldOut?: boolean`. The comment says it is set true only when the client sheet says sold out; absent means not stated sold out; sold-out entries carry null prices; the Finder must label them (D3).
   - `ProjectDoc.priceSource` (:355): widen to `'whatsapp-kb' | 'client-workbook'` and extend its comment: 'client-workbook' = the lowest non-sold-out nett figure stated in the client project info sheet (quick-kayinleong-096, D2).
   - Add `export type ClientWorkbookField` = the 13-member union 'unitTypes' | 'sizeMinSqft' | 'sizeMaxSqft' | 'bedrooms' | 'priceValue' | 'priceBand' | 'priceProvenance' | 'priceSource' | 'pricePsfMin' | 'pricePsfMax' | 'tenure' | 'vpStatus' | 'vpDate'.
   - Add optional `clientWorkbookFields?: ClientWorkbookField[]` and `clientWorkbookImportedAt?: Date | FieldValue` to ProjectDoc. The comment records the D4 choice: ONE field list rather than per-field `*Source` props, because it covers sizes, bedrooms, tenure and vp, which a `unitTypesSource` flag cannot. Each guard checks exactly the field it would write, and the restore path knows what to undo. `priceSource` stays as D2 requires.
   - Do not touch EMBEDDING_RELEVANT_FIELDS (crud.ts) or any converter.
   - Then run `grep -rn "whatsapp-kb" src app scripts tests`. Confirm that no switch or enumeration besides the type needs widening. The expected hits are the type, the sync-kb writer and the export passthrough. Record the result in SUMMARY (D2).
2. Create `src/inventory/client-workbook-safety.ts`. It has NO runtime imports, only `import type { ClientWorkbookField } from '@/src/firebase/collections'`. The reason: collections.ts imports adminDb at :54, so the CLIs must run the env guard before anything initialises the admin SDK. Export:
   - `CLIENT_WORKBOOK_SOURCE = 'client-workbook' as const`, `CLIENT_WORKBOOK_ACTOR = 'client-workbook-import-096'`, `CLIENT_FACTSHEET_ACTOR = 'client-factsheets-096'` and `LIVE_PROJECT_ID = 'cy-csaiagent'`.
   - `assertSafeTarget(env)`, per the interfaces.
   - `isClientWorkbookField(data: Record<string, unknown>, field: ClientWorkbookField): boolean`. It is true when `data.clientWorkbookFields` is an array containing the field. For the price group (priceValue, priceBand, priceProvenance, priceSource) it is also true when `data.priceSource === CLIENT_WORKBOOK_SOURCE`.
   - `scanForContactDetails(text: string): string[]`, which returns class names only (the interface patterns).
3. Create `src/inventory/client-workbook.ts`. It is pure: no Firestore calls and no node fs. It imports zod (^4, already a dependency), `priceBandFor` and the types from collections, and the safety exports. Export:
   - `ClientSheetSchema`, a zod schema mirroring Contract 1 key for key.
   - `parseClientSheet(json: unknown): ClientSheet`, which runs the zod parse and then the 10 invariants.
   - The `DELETE_FIELD` unique-symbol sentinel and the `HOLD_GROUPS` map.
   - Types `SheetProject`, `HoldGroup` and `ProjectPlan` (`{docId, inventoryName, patch, changes: {field, before, after}[], asserted, warnings: {code, message}[], reembed, allUnitsSoldOut}`).
   - `labelKey(label, labelPrefix)`, `isGroupedLabel(label, labelPrefix)` and `mergeUnits({stored, sheetUnits, unitMode, labelPrefix, holds})`. The last returns `{final, matched, added, keptUnmatched, dropped, warnings}`, which T3 renders in the dry-run report (U1–U6, orchestrator amendment 2026-10-19).
   - `planProjectPatch({docId, existing, sheet, holds, importedAt})`, which applies R1–R13 in order and derives every value from the final merged list.

   Keep the functions small and named after the rules so T3 can reuse them. The amended D5 rule replaces whole-list replacement everywhere: never write a unitTypes list that discards a stored value the sheet leaves blank, except a U5 grouped-entry drop.
4. `src/agents/finder/prompt.ts`: insert the sold-out bullet from the interfaces verbatim, as a new line directly after the unitTypes bullet at :175 (D3). Change nothing else in the prompt.
5. Tests.
   - `src/inventory/client-workbook.test.ts` must begin with `vi.mock('@/src/firebase/admin', () => ({ adminDb: {} }))`, the same as `tests/finder-corpus-gates.test.ts:37-40`, because importing `priceBandFor` loads collections. Use small inline fixtures modelled on the real sheet values in the interfaces (ViiA, DC Residensi, Imperial, Puncak, Rafflesia, Southpoint), and copy the stored lists verbatim from "Stored lists for T1 fixtures". Assert the Southpoint and Rafflesia outcomes exactly as written in "Expected T1 fixture outcomes", and cover every behavior bullet.
   - In `src/agents/finder/project-detail.test.ts`, add a NEW describe block that reuses the file's existing mocking mechanism to serve one project with a soldOut:true entry, and assert the payload carries it. Add an assertion on FINDER_SYSTEM_PROMPT. Do not change the existing fixtures or counts (PROJECT_COUNT, TARGET), because existing ranking tests depend on them.
6. Run the verify command. If typecheck reports an error in a file another agent owns (T2 runs concurrently but writes no TS), re-run once. Never edit outside your files. Run no git commands and no live commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>npx vitest run src/inventory/client-workbook.test.ts src/agents/finder/project-detail.test.ts src/agents/finder/finder.test.ts src/agents/finder/tools.test.ts src/inventory/search.test.ts && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - Every behavior bullet has at least one passing test, and the suites named in the verify command pass with 0 failures. `npm run typecheck` exits 0, and no `.next` errors are filtered out.
    - client-workbook-safety.ts has no runtime import statements: only `import type` lines, or none at all.
    - The prompt diff is exactly one added bullet after :175.
    - The SUMMARY records the `whatsapp-kb` grep result.
  </acceptance_criteria>
  <done>The TS core exists and is tested.
- A sold-out unit planned from a contract fixture lands as `soldOut: true` with null prices, does not count toward price or size, comes back through projectDetail, and is governed by an explicit Finder rule.
- The unit-level merge keeps every stored value the sheet leaves blank. The Southpoint fixture shows 7 priced entries before and after, and Rafflesia's from-price stays 2,900,000. Only untyped grouped entries are dropped, and each drop is named and can be held.
- All 13 R-rules, U1–U6 and the env guard are proven by tests.</done>
</task>

<task type="auto">
  <name>T2 (wave 1): Python stage 1: parse the workbook into a gated, reviewable normalised JSON, mapping, HELD-BACK.md and PII-clean fact sheets, with a verifier whose gates bite</name>
  <files>.planning/quick/quick-kayinleong-096/wbparse.py, .planning/quick/quick-kayinleong-096/build-client-sheet.py, .planning/quick/quick-kayinleong-096/verify-client-sheet.py, .planning/quick/quick-kayinleong-096/pii-vectors.json, .planning/quick/quick-kayinleong-096/project-mapping.json, .planning/quick/quick-kayinleong-096/client-sheet.normalized.json, .planning/quick/quick-kayinleong-096/HELD-BACK.md, .planning/quick/quick-kayinleong-096/factsheets/index.json, .planning/quick/quick-kayinleong-096/factsheets/*.md</files>
  <precondition>The file `/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx` exists with sha256 d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f, and `projects.export.json` exists at the repo root with exportedAt 2026-09-18T06:31:24.701Z.</precondition>
  <action>
Build stage 1 per D10, using the precedent of quick-094's build/verify pair (`.planning/quick/quick-kayinleong-094/build-unit-types.py` and `verify-unit-types.py`). Implement D1, D5, D6, D7, D8 and D9 at the data layer. Every output must match Contracts 1–3, the scanner and the parser cases in the interfaces section.

Untrusted-input discipline (threat T-096-07, and D13):
- Run every script as `python3 -I -B`. Each script bootstraps itself with `site.addsitedir('/Users/ka.yin.leong/Library/Python/3.9/lib/python/site-packages')` and `sys.path.insert(0, str(Path(__file__).resolve().parent))`; `-I` drops the script dir and `-B` stops `__pycache__` being written.
- Pass the workbook only as `--workbook PATH`. Never copy it into the repo.
- Refuse the workbook when:
  - its suffix is not `.xlsx`;
  - it is larger than 5 MB;
  - its sha256 differs from the pinned constant EXPECTED_WORKBOOK_SHA256 above (the `--workbook-sha256 HEX` override exists for a future client revision);
  - the `Raw Data` header row, stripped, does not equal the 16 known headers in order.
- Open with `openpyxl.load_workbook(path, read_only=True, data_only=True)`. defusedxml is installed, and openpyxl uses it.
- Never print a cell value. Print only counts, project names, column names and class names. This is absolute for the Developer column.
- The code is Python 3.9: no `match` statements and no `X | Y` type unions.

Files:
1. `wbparse.py` holds only pure functions, importable by both scripts:
   - `parse_label`, `parse_size` (BU rule, sqm 3% gate, 100–30,000 range), `parse_rooms`, `rooms_layout_code` and `classify_price_cell`;
   - `normalise_tenure`, which detects a column shift;
   - `classify_completion(text, import_year)`;
   - `scan_contact_details`, `scrub_developer` (drop contact lines and return `(text, removed_count)`), `clean_fact` (control characters, angle brackets, whitespace; `|` becomes `/` in table cells) and `injection_hit`.

   Each function implements exactly the rules and cases in the interfaces section.
2. `build-client-sheet.py`. Arguments: `--workbook`, `--export` (default `projects.export.json`), `--import-date` (default 2026-10-19), `--regen-mapping` and `--workbook-sha256`. Steps:
   - (a) Group Raw Data rows by carrying the Project name down. A later group with the same name and no values is ignored and reported (Park Green row 112). A duplicate name WITH values is refused.
   - (b) Mapping. Load the export, then reduce every record to `{projectId, name, status}` immediately and never touch description; this is the 095 loader pattern.
     - Build `project-mapping.json` (Contract 2) only when it is absent or `--regen-mapping` is passed. Otherwise load it and require that it covers every sheet name.
     - Refuse on any unmatched name (D5).
   - (c) Units for mapped projects with unit rows: run the parsers, then the unit-level gates (sold out, psf in the Gross column, gross below nett, TBC, ambiguous); fill `held`; build `raw` with held cells written as "{Column} not confirmed".
   - (d) Project fields: `tenure`, `completion` and `area` (D6, D7, D8). Build `facts` through `clean_fact`, the Developer scrub, the maintenance-fee, digit, length and injection gates.
   - (e) Sheet1 focus lists. A heading is a cell whose text equals one of the 5 known headings; the following non-empty cells, up to the next heading, are names, resolved through the mapping (SHEET1_ALIASES). An unresolved name is refused.
   - (f) DC Residensi cross-check against `.planning/quick/quick-kayinleong-094/unit-types.json`, matching on the type code (label minus "Type "), sqft and layout code. It fills `conflicts`. The sheet value is still written (D9).
   - (g) Build every output in memory: the normalised JSON (Contract 1, deterministic ordering, `ensure_ascii=False`, indent 2, trailing newline, no timestamps), `HELD-BACK.md`, `factsheets/*.md` with `factsheets/index.json` (Contract 3; the sha256 is computed over the exact bytes to be written), and the mapping when regenerating.
   - (h) Run the PII gate over every output string (excluding `meta`). Any hit → exit 1 naming the file and the class, and write NOTHING.
   - (i) Only then write the files.

   Every fact sheet must contain the provenance line verbatim. Fact sheets contain workbook facts only, verbatim or lightly normalised, never derived (D1).
3. `HELD-BACK.md` is plain language for the user and the client, with no file paths or code. Sections:
   - values we did not load, and why (project, unit, column, what the sheet says, what we need from the client); Developer entries show the count of lines removed, never the text;
   - differences from the DC Residensi brochure. Use exactly the computed set, which replaces D9's "B4–B7" wording by orchestrator amendment: rooms differ for B4, B6, B7 and E2, where the sheet value is written and the brochure value is shown; the size differs for E1, where it is held back. Do not list B5, which agrees with the brochure;
   - completion dates not written to the record (the ambiguous list) and expected dates kept in the fact sheet only;
   - the three new projects skipped (Binastra Cochrane, Lagenda Tunku (Villa Gemilang), Ashbourne with 8 unit types);
   - the duplicate Park Green row;
   - projects with no facts (Exsim Project);
   - a note that any project with every unit sold out keeps its status for the user to decide.

   Open with the source line.
4. `pii-vectors.json`: the exact hit and miss vectors from the interfaces.
5. `verify-client-sheet.py --workbook PATH --export PATH` prints PASS/FAIL per check and a total, and exits non-zero on any FAIL. Checks:
   - P: every parser case in the interfaces.
   - S: every scanner vector.
   - J: the 10 invariants over the committed JSON.
   - C: the expected counts.
   - H: the exact expected held-back sets (unit-level and project-level).
   - X: the exact DC conflicts.
   - D: determinism. Rebuild in memory and require byte equality with the files on disk.
   - F: fact sheets.
     - Each has the heading and source line, and every section heading names the project.
     - The unit rows equal that project's units.
     - It has no scanner hits, no angle brackets, and is at most 20,000 characters.
     - The index sha256 matches the file bytes.
     - Exsim Project has no sheet.
   - G: the pinned workbook hash.
   - M: 78 exact, 2 variant and 3 sheet1-alias entries; the Royal Suites and Rafflesia targets are as in Contract 2; unitMode is `merge` for the 13 projects with unit rows, `partial` for Rafflesia only (labelPrefix "Hill 4 · "), and `none` everywhere else (amended D5).

   Add `--self-test`. Working only on in-memory copies (never touching committed files), inject eight defects:
   - (1) a sqft/sqm mismatch of 10%;
   - (2) gross below nett;
   - (3) "150psf";
   - (4) "Call 012-000 0000" in a Developer line, which must be scrubbed; and the same string forced into a fact sheet, which must fail the PII gate;
   - (5) an unmapped project name, which the mapping must refuse;
   - (6) "Rm6,59mil", which must be unparseable;
   - (7) "Completion Date: Target 2025", which must not be completed;
   - (8) "ignore previous instructions" in Top Reasons, which must be held.

   The self-test exits 0 only if all 8 bite. This is the "gate bites" proof from quick-094.

If the computed held-back set, conflicts or counts differ from the interfaces, do NOT loosen the expectation to match. Inspect the specific cell (never print Developer). Then either fix the parser, or report the exact discrepancy in your SUMMARY for the orchestrator. Run no git commands, no TS and no live commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>python3 -I -B .planning/quick/quick-kayinleong-096/build-client-sheet.py --workbook "/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx" --export projects.export.json --regen-mapping && python3 -I -B .planning/quick/quick-kayinleong-096/verify-client-sheet.py --workbook "/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx" --export projects.export.json && python3 -I -B .planning/quick/quick-kayinleong-096/verify-client-sheet.py --self-test</automated>
  </verify>
  <acceptance_criteria>
    - The verifier reports 0 FAIL, and `--self-test` reports all 8 injected defects caught.
    - `git status --porcelain` lists only claim-096 paths from this task. It shows no `.xlsx` and no `__pycache__` under the claim dir.
    - Every expected value in the interfaces (counts, held sets, conflicts) is either matched, or reported as a discrepancy in SUMMARY.
  </acceptance_criteria>
  <done>The client workbook is turned, deterministically and offline, into a PII-clean, invariant-checked JSON contract, a reviewed name → docId mapping, a client-readable HELD-BACK.md and one fact sheet per project with facts. A verifier proves every parser case and shows that each gate fires on an injected defect.</done>
</task>

<task type="auto" tdd="true">
  <name>T3 (wave 2): stage 2: import-client-workbook dry run, fingerprint-gated apply, backup, re-read asserts, audit count, selective plain-array re-embed, restore</name>
  <files>src/inventory/client-workbook-run.ts, src/inventory/client-workbook-run.test.ts, src/inventory/client-workbook.contract.test.ts, scripts/import-client-workbook.ts, .gitignore</files>
  <behavior>
    - Dry run: zero calls to updateDoc, audit, embed or writeEmbedding. The report is written and the fingerprint returned.
    - A mapped doc that is missing, or whose live name differs from inventoryName by a single character, makes the run refuse before any write.
    - Apply without --expect-plan, or with a fingerprint that differs, refuses with zero writes.
    - Apply call order (asserted from a call log): backup written → backup re-read and parsed with N docs and no `embedding` key → first updateDoc.
    - The fake store's update throws for a missing doc (update semantics); the runner has no set/create path.
    - If a re-read differs from the planned value, the runner throws naming the docId and writes no further docs.
    - One audit row per written doc: actor client-workbook-import-096, targetRef projects/{docId}, raw holding only docId, field names and the fingerprint. If the count after the run differs (simulated swallowed failure), it exits non-zero.
    - Re-embed runs only for plans with reembed true. writeEmbedding receives a plain Array of 1024 finite numbers; a non-array or wrong-length vector is refused; the post-write re-read must satisfy Array.isArray with length 1024.
    - The report never contains the existing description, locationText or any existing raw line (sentinel strings in the fixture), and the run aborts before writing if the report would hit the scanner.
    - Restore: apply, then restore from the produced backup. Every patched field equals its pre-image, clientWorkbookFields and clientWorkbookImportedAt are removed, and restore also requires its own --expect-plan.
    - Contract test (real committed JSON):
      - parseClientSheet succeeds and the interface counts hold;
      - 13 projects have unitMode `merge` and only Rafflesia has `partial`;
      - the "Workbook-only baseline" priceValue, psf, size and bedrooms tables hold, against stored docs with no unitTypes and priceValue 0;
      - meta.mapping_sha256 equals the sha256 of the project-mapping.json bytes, and every project docId is in the mapping.
    - The dry-run report shows each project's merge outcome from mergeUnits: matched, added, kept-unmatched and dropped, with every dropped label named and every kept-from-previous field listed.
    - A static check, filtering comment lines, finds no call to the Firestore vector wrapper (FieldValue's vector method) and no `.set(` or `.create(` in scripts/import-client-workbook.ts or client-workbook-run.ts.
  </behavior>
  <action>
Implement stage 2 per D10, D11 and D13 on top of T1's `parseClientSheet`, `planProjectPatch`, `DELETE_FIELD` and the safety module. Do not re-implement any planner rule.

1. `src/inventory/client-workbook-run.ts` is portable, with all I/O injected. Export:
   - `planFingerprint` (interfaces).
   - `renderDryRunReport`. It produces markdown with:
     - a header: target, fingerprint, counts, the workbook sha and the mapping sha;
     - the mapping table: sheet name, inventory name, docId, matchedBy;
     - per doc, a field | before | after table. unitTypes is rendered as a compact sub-table (status matched / added / kept / dropped, label, size, bedrooms, nett min–max, soldOut, kept-from-previous fields), using T1's `mergeUnits` result. The before side never shows `raw`. Numbers use en-MY thousands separators, and DELETE_FIELD is shown as "(removed)";
     - a warnings section grouped by code: unit-dropped (each label named, priced drops marked), kept-from-previous, ambiguous-label-match, partial-coverage-price-kept, price-from-kept-unit, vp-conflict, area-not-in-location, tenure-kept-specific, all-units-sold-out and hold-applied;
     - the re-embed list, and the skipped and held-back counts with a pointer to HELD-BACK.md.

     It then runs scanForContactDetails over the whole text and throws on any hit.
   - `runClientWorkbookImport(deps, opts)`. The deps are `{readDoc, updateDoc, embed, writeEmbedding, audit, countAuditRows, writeFile, readFile, now, sleep}`; opts are `{mode: 'dry-run'|'apply'|'restore-dry-run'|'restore-apply', expectPlan?, sheet, mapping, mappingSha256, holds, backupDir, reportPath, target, delayMs}`. Behaviour, per the behaviors above:
     - (a) Validate the mapping against the sheet. Read every mapped doc and require the exact name.
     - (b) Plan every doc, then fingerprint and render.
     - (c) In dry run, write the report and return.
     - (d) In apply, require `expectPlan === fingerprint`, and require the embedding key's presence to be confirmed by the caller (a boolean opt) whenever any plan has reembed.
     - (e) Write the backup to `{backupDir}/{ISO stamp}/projects-backup.json` as `{meta: {fingerprint, createdAt, target, workbook_sha256, mapping_sha256}, docs: [{docId, before, plannedFields}]}`. `before` is the full doc minus `embedding`, with Timestamp-like and Date values serialised as `{"$ts": ISO}`. Re-read and parse it before the first update.
     - (f) Write sequentially with updateDoc, mapping DELETE_FIELD through `deps.deleteSentinel`.
     - (g) Re-read and assert every changed field: dates by milliseconds; a deleted field must be absent; clientWorkbookImportedAt within 10 minutes of the run start.
     - (h) Write an audit row per doc, then `countAuditRows(actor, runStartMs)` must equal the number of docs written.
     - (i) Re-embed the plans with reembed true: re-read, embed, validate the vector, writeEmbedding, re-read and assert, sleeping delayMs between calls. On a failure, keep going, then exit non-zero listing the docIds plus the recovery command `node_modules/.bin/tsx --env-file=.env.local scripts/reembed-projects.ts --apply`.
     - (j) Write the apply report.

     Restore modes read a backup, plan the inverse (restore every plannedField from `before`, or DELETE_FIELD when it was absent; delete both markers), fingerprint that plan, and apply it with the same expect-plan, re-read, audit and re-embed rules.
2. `scripts/import-client-workbook.ts`. Its top-level imports are only node built-ins and `@/src/inventory/client-workbook-safety`.
   - In `main()`, call `assertSafeTarget(process.env)` FIRST, then `await import(...)` `@/src/firebase/admin`, `@/src/inventory/client-workbook`, `@/src/inventory/client-workbook-run`, `@/src/inventory/embedText` (embedProject) and `@/src/audit/log`. This is the D13 / T-096-05 ordering.
   - Flags: `--apply`, `--expect-plan SHA`, `--restore BACKUP_PATH`, `--sheet`, `--mapping`, `--holds` (default `.planning/quick/quick-kayinleong-096/review-holds.json`, absent = no holds, format `{"holds": {"docId": ["price"]}}`) and `--delay` (default 120).
   - Reports go to `.planning/quick/quick-kayinleong-096/IMPORT-DRYRUN.md` (or `IMPORT-APPLY.md`, `RESTORE-DRYRUN.md`, `RESTORE-APPLY.md`). Backups go to `.planning/quick/quick-kayinleong-096/backups/`.
   - Wire the deps:
     - `readDoc`: `adminDb.collection('projects').doc(id).get()`;
     - `updateDoc`: `.update(patch)`, never set; this is the raw collection, as the backfill scripts use it;
     - `deleteSentinel`: `FieldValue.delete()`;
     - `audit`: `log({actorUid: CLIENT_WORKBOOK_ACTOR, action: 'client_workbook_import', targetRef, raw})`;
     - `countAuditRows`: `adminDb.collection('auditLogs').where('actorUid','==',actor).get()` filtered in memory on `ts >= since`, a single-field equality that needs no composite index;
     - `embed`: `embedProject`;
     - `writeEmbedding`: `.update({embedding: vec})` with the plain array.
   - Pass `hasEmbeddingKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)` as a presence check only; never print the value.
   - Log only counts, docIds, names, field names, paths and the fingerprint. Never log a record, description or cell text.
   - The header doc comment carries the usage lines, in the house style of scripts/reembed-projects.ts.
3. `src/inventory/client-workbook-run.test.ts` uses an in-memory fake store and fake embed/audit, and covers every behavior bullet. `src/inventory/client-workbook.contract.test.ts` reads the committed `.planning/quick/quick-kayinleong-096/client-sheet.normalized.json` and `project-mapping.json` through node fs, and pins the interface expectations. Both test files start with the admin mock that T1 uses.
4. `.gitignore`: append a commented quick-kayinleong-096 block with `/.planning/quick/quick-kayinleong-096/backups/`, `/.planning/quick/quick-kayinleong-096/__pycache__/` and `/.planning/quick/quick-kayinleong-096/*.xlsx`. The comment explains that backups hold full records, including description prose with PIC contact details (D13). Then run `git check-ignore -v .planning/quick/quick-kayinleong-096/backups/x.json`; this is a read-only git query and the only git command you may run.

Never run the CLI against anything, and never set FIRESTORE_EMULATOR_HOST to point at a real project. Tests use fakes only (D11). Run no git write commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>npx vitest run src/inventory/client-workbook-run.test.ts src/inventory/client-workbook.contract.test.ts src/inventory/client-workbook.test.ts && npm run typecheck && git check-ignore -q .planning/quick/quick-kayinleong-096/backups/probe.json</automated>
  </verify>
  <acceptance_criteria>
    - All behavior bullets have passing tests.
    - The contract test pins every workbook-only baseline value (priceValue, psf, size, bedrooms) from the interfaces against the real committed JSON.
    - The report test shows a named unit-dropped line and a kept-from-previous line for a Southpoint-like and a DC-like fixture.
    - The typecheck is clean, and the backups path is ignored by git.
    - The script's top-level import list contains only node built-ins and client-workbook-safety.
  </acceptance_criteria>
  <done>The orchestrator can run one read-only command to get a reviewable per-field diff with a fingerprint. It can also run one gated command that writes exactly that diff to production with a pre-write backup, re-read proof, counted audit rows and plain-array re-embeds. The same backup can be restored through the same CLI.</done>
</task>

<task type="auto" tdd="true">
  <name>T4 (wave 2): guard the three backfill scripts against clobbering workbook-sourced fields, and carry the new markers in the export</name>
  <files>scripts/backfill-unit-types.ts, scripts/backfill-project-sizes.ts, scripts/fix-fabricated-prices.ts, scripts/export-projects-for-workbook.ts, scripts/client-workbook-guards.test.ts</files>
  <behavior>
    - backfill-unit-types --apply: a doc with clientWorkbookFields containing 'unitTypes' is never passed to the bulk writer. A normal doc whose description parses to a different table IS updated, which proves the test is not vacuous.
    - backfill-project-sizes --apply: a doc marked for sizeMinSqft or sizeMaxSqft is skipped, and a normal doc with a differing parsed range is updated.
    - fix-fabricated-prices --apply: a doc with priceSource 'client-workbook', or clientWorkbookFields containing 'priceValue' or 'pricePsfMin', gets no patch. A normal doc with "Gross Price: RM720 psf" and a stored 360,000 IS patched to 0 / psf_only.
    - Each script prints a "skipped (client workbook)" count. Docs with no markers behave exactly as before.
    - The export includes `clientWorkbookFields` (an array, default []) and `clientWorkbookImportedAt` (an ISO date or null), and still omits the embedding.
  </behavior>
  <action>
Implement the D4 re-run guards with T1's `isClientWorkbookField` (from `@/src/inventory/client-workbook-safety`). Insert each guard as the first statement after the doc data is read, before any extraction or patch construction:
- `scripts/backfill-unit-types.ts`: after :109 (description), before `extractUnitTypes` at :111. Skip when the field `unitTypes` is a workbook field: increment a `workbookSkipped` counter, log `· skip (client workbook) {name}`, continue. Print the counter in the summary block.
- `scripts/backfill-project-sizes.ts`: after :62, before `extractSizeRange` at :64. Skip when `sizeMinSqft` or `sizeMaxSqft` is a workbook field, with the same counter and log.
- `scripts/fix-fabricated-prices.ts`: immediately after :386 (name), before the description/fallback logic. Skip when `priceValue` or `pricePsfMin` is a workbook field. The safety helper already treats `priceSource === 'client-workbook'` as the price group. Use the same counter and log, and keep the skipped docs out of the provenance counts.
- `scripts/export-projects-for-workbook.ts`: after `priceSourceChunkId` at :75, add `clientWorkbookFields: d.clientWorkbookFields ?? []` and `clientWorkbookImportedAt: toISODate(d.clientWorkbookImportedAt)`, using the file's existing `toISODate` at :31. The allowlist stays an allowlist.
- Change no other behaviour in these scripts. In particular, do not change their dry-run defaults, write paths or idempotency checks. `sync-kb-prices-to-inventory.ts` needs no guard (:165-168 already skip any priced doc); state this in the SUMMARY.

`scripts/client-workbook-guards.test.ts` is a behaviour test, not a grep.
- For each script: `vi.resetModules()`, then `vi.mock('@/src/firebase/admin', ...)` with a fake `adminDb` whose `collection('projects')` supports the query shapes the script uses: `.limit(n).get()`, `.orderBy('__name__').limit(n).get()` and `.startAfter(id)`.
- Each fake doc has `{id, ref, data()}`. `bulkWriter()` returns `{update: vi.fn(), close: vi.fn()}`.
- Set `process.argv` to include `--apply` before `await import('./backfill-unit-types')` (and so on). Spy `process.exit` to resolve a promise instead of exiting, and silence `console.log`.
- Assert the update calls by ref. Take the fixture descriptions from the existing passing cases in `src/inventory/unit-types.test.ts` and `src/inventory/size-extract.test.ts`, so the "normal doc is updated" half genuinely fires.
- For the export, test the record shape the same way, or by extracting the record mapper into an exported function inside the same file if the module structure requires it. Keep `main()` behaviour identical.

Run no git commands and no live commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>npx vitest run scripts/client-workbook-guards.test.ts src/inventory/unit-types.test.ts src/inventory/size-extract.test.ts scripts/ci-guards.test.ts && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - Each guard has a skip test and a not-vacuous test. All pass.
    - The diff of each backfill script is limited to: the import, the guard block, the counter and its summary line.
    - The typecheck is clean.
  </acceptance_criteria>
  <done>Re-running any of the three backfill scripts after the import cannot silently overwrite workbook-sourced unitTypes, sizes or prices, and the export carries the provenance markers the 095 refresh and future audits need.</done>
</task>

<task type="auto" tdd="true">
  <name>T5 (wave 2): stage 3: idempotent ingest of the per-project fact sheets into the finder KB through the existing createDoc/updateDoc → processBatch path</name>
  <files>src/kb/client-factsheets.ts, src/kb/client-factsheets.test.ts, scripts/ingest-client-factsheets.ts</files>
  <behavior>
    - loadFactSheets refuses the whole run, naming titles only, when any of these fail for a sheet: the sha256 of its bytes matches the manifest; its title equals "{inventoryName} — D2 project facts (client sheet)"; its category equals inventoryName; its content starts with "# {inventoryName}: D2 project facts"; the source line is present; it is at most 20,000 characters; it has zero scanner hits.
    - Plan per sheet:
      - no finder doc with that title that is not superseded → create;
      - exactly one such doc, with a job fileHash equal to the sha256 of the content → unchanged;
      - exactly one, with a different hash → update (supersede that id);
      - more than one → refuse.
    - Dry run: zero calls to createDoc, updateDoc, processBatch or audit. A report is written with a fingerprint.
    - Apply refuses without a matching --expect-plan.
    - create calls createDoc(user, {title, content, lang:'en', pillar:'finder', category}) and loops processBatch(jobId, 5) to 0. update calls updateDoc(user, oldId, {content}) and loops on its jobId. A processBatch that makes no progress raises an error.
    - Post-apply asserts: at least 1 published chunk for the new docId; on update, the old doc status is 'superseded'; one audit row per ingested sheet, counted.
    - A second plan run after the apply reports every sheet as unchanged.
    - Equivalence: scanForContactDetails agrees with every vector in the committed pii-vectors.json, and every committed fact sheet in factsheets/index.json loads with zero hits.
  </behavior>
  <action>
Implement D1's ingest half on the existing KB path. Do not modify `src/kb/crud.ts` or `src/kb/ingest/pipeline.ts`.
- The path: createDoc (crud.ts:130) → shardJobForContent (:934) → shardJob (pipeline.ts:116, whose sha256 fileHash is over the exact UTF-8 content bytes) → processBatch (pipeline.ts:263). processBatch writes kbChunks as a Firestore VECTOR and supersedes the old version at :379-389 when a job carries supersedesId, which updateDoc (crud.ts:288) sets.
- Attribution follows `scripts/scrape-skool/to-kb.ts:178`: a project-led title and `category` = the inventory name. That keeps `sync-kb-prices-to-inventory`'s title-based subject parse attributing it correctly. Note: updateDoc does not carry category onto the new chunks. That is harmless for the finder, which never filters chunks by category; record it in the SUMMARY.

1. `src/kb/client-factsheets.ts` is portable, with all I/O injected; it imports only zod, node:crypto, and T1's safety module. Export:
   - `FactSheetManifestSchema` (Contract 3) and `loadFactSheets(manifest, readFile)`. Pass the content verbatim: no trim, no newline normalisation, because the hash identity depends on the exact bytes.
   - `planFactSheets(sheets, deps)` (`findDocsByTitle`, `jobHashesForDoc`) and `factSheetFingerprint`.
   - `renderFactSheetReport`, PII-scanned. It shows a title | action | chars table and counts, never content.
   - `runFactSheetIngest(deps, opts)`. The deps are `{createDoc, updateDoc, processBatch, countPublishedChunks, docStatus, audit, countAuditRows, writeFile, now}`; the modes are dry-run and apply. Its behaviour is per the behaviors above.

   The synthetic user is `{uid: CLIENT_FACTSHEET_ACTOR, role: 'admin', tenantId: 'd2'}` (precedent: scripts/ingest-kb-seed.ts:101). The audit row is `action: 'client_factsheet_ingest'`, `targetRef: 'kbDocs/{id}'`, with raw holding the title and sha256 only.
2. `scripts/ingest-client-factsheets.ts`. Its top-level imports are only node built-ins and the safety module. In `main()`, call `assertSafeTarget(process.env)` first, then dynamically import `@/src/firebase/admin`, `@/src/kb/crud` (createDoc, updateDoc), `@/src/kb/ingest/pipeline` (processBatch), `@/src/audit/log` and `@/src/kb/client-factsheets`. Wire the deps:
   - `findDocsByTitle`: `adminDb.collection('kbDocs').where('title','==',title).get()`, mapped to `{id, pillar, status}`;
   - `jobHashesForDoc`: `adminDb.collection('kbIngestionJobs').where('docId','==',id).get()`, mapped to fileHash;
   - `countPublishedChunks`: `adminDb.collection('kbChunks').where('docId','==',id).get()`, counting status 'published' in memory to avoid needing a composite index;
   - `docStatus`: read kbDocs/{id}.

   Flags are `--apply` and `--expect-plan SHA`, plus `--manifest`, default `.planning/quick/quick-kayinleong-096/factsheets/index.json`. Reports go to `.planning/quick/quick-kayinleong-096/FACTSHEETS-DRYRUN.md` or `FACTSHEETS-APPLY.md`. Log titles, actions and counts only. Embedding needs GOOGLE_GENERATIVE_AI_API_KEY; check its presence (never its value) before an apply.
3. `src/kb/client-factsheets.test.ts` uses fakes for every dep and covers every behavior bullet, including the equivalence test over the committed claim-dir files read with node fs. Add the admin mock only if an import requires it; the module itself must not import collections.

Never run the CLI. Tests use fakes only (D11). Run no git commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>npx vitest run src/kb/client-factsheets.test.ts src/kb && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - All behavior bullets have passing tests, including the equivalence test over the committed pii-vectors.json and the fact sheets.
    - The existing `src/kb` suites stay green, and the typecheck is clean.
    - crud.ts and pipeline.ts are unmodified.
  </acceptance_criteria>
  <done>The orchestrator can ingest every fact sheet into the finder KB with one gated command. A re-run creates nothing, a changed sheet supersedes its previous version through the existing version chain, and no sheet with contact details or a tampered hash can be ingested.</done>
</task>

<task type="checkpoint:decision" gate="blocking-human">
  <name>CP-A (ORCHESTRATOR, after wave 2 is committed): run the live dry runs, show the user the diff and the held-back list, and record the decision</name>
  <decision>Approve writing the dry-run diff to production `cy-csaiagent` and ingesting the fact sheets; or approve with per-project holds; or abort (D11).</decision>
  <context>
Live steps, run by the orchestrator only. Both commands are READ-ONLY against live Firestore.

1. Preconditions:
   - waves 1–2 are committed as one commit per task;
   - `npx vitest run` and `npm run typecheck` are green;
   - `python3 -I -B .planning/quick/quick-kayinleong-096/verify-client-sheet.py --workbook "/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx" --export projects.export.json` reports 0 FAIL;
   - `git status --porcelain` shows no backups/ and no .xlsx.
2. Run `node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts`. It writes `.planning/quick/quick-kayinleong-096/IMPORT-DRYRUN.md` and prints the IMPORT fingerprint.
3. Run `node_modules/.bin/tsx --env-file=.env.local scripts/ingest-client-factsheets.ts`. It writes `FACTSHEETS-DRYRUN.md` and prints the FACTSHEETS fingerprint.
4. Show the user:
   - IMPORT-DRYRUN.md: every field before → after, and the warnings. Call out these specifically:
     - Every `unit-dropped` line. The prediction is 6: the 4 DC Residensi grouped entries, Jewel's "2+1 Rooms", and Puncak's "5+1 bedrooms", which carried RM3,600,000. Each one can be held with `unitDrops`.
     - The kept near-duplicates (Lantern Type A1 / Type A, Parkside Type C / C1 / C2, Southpoint Type A3 & B3 / A3 / B3).
     - The confirmations that the merge kept stored values: Southpoint still has 7 priced layouts, and Rafflesia keeps 2,900,000 (`partial-coverage-price-kept`).
     - The vp-conflict rows, the area-not-in-location rows (D6), and any all-units-sold-out projects, for a status decision (D3).
   - HELD-BACK.md: the 8 unit holds, the tenure and fee holds, the DC Residensi brochure conflicts, the 3 skipped new projects, and the ambiguous completions.
   - FACTSHEETS-DRYRUN.md: the create count.
5. Ask the user to choose.
6. If the user chooses holds: write `.planning/quick/quick-kayinleong-096/review-holds.json` as `{"holds": {"docId": ["price"|"unitTypes"|"unitDrops"|"sizes"|"bedrooms"|"psf"|"tenure"|"vp"]}}`, re-run step 2, and present the NEW fingerprint for approval again.

Never auto-approve. This gate is `blocking-human` because config has auto_advance true.
  </context>
  <options>
    <option id="approve">
      <name>Approve as shown</name>
      <pros>Writes exactly the reviewed diff (bound by the fingerprint) and ingests the fact sheets</pros>
      <cons>The grouped stored entries listed as unit-dropped are removed (the backup keeps them), and the near-duplicate type-coded entries stay</cons>
    </option>
    <option id="approve-with-holds">
      <name>Approve with holds (e.g. unitDrops for Puncak, price or bedrooms for a project)</name>
      <pros>The user vetoes any field group per project without code changes</pros>
      <cons>Needs one more dry run and a new fingerprint</cons>
    </option>
    <option id="abort">
      <name>Abort</name>
      <pros>Nothing is written</pros>
      <cons>Finder keeps the superseded Skool data</cons>
    </option>
  </options>
  <resume-signal>"approve IMPORT={fingerprint} FACTSHEETS={fingerprint}", or "hold {project}: {groups}", or "abort"</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>CP-B (ORCHESTRATOR, only after an explicit approval in CP-A): apply, prove idempotency, re-export, and show the user the result</name>
  <what-built>
The approved production write: project fields, a backup, audit rows, re-embeds, and the finder KB fact sheets. Run in this order:

1. Run `node_modules/.bin/tsx --env-file=.env.local scripts/import-client-workbook.ts --apply --expect-plan {IMPORT fingerprint}`. It prints the backup path; confirm `git check-ignore -q` on it. The run writes, re-reads and asserts, counts audit rows, re-embeds, and writes IMPORT-APPLY.md.
2. Re-run the dry run (no flags). It must report 0 changes, which proves idempotency.
3. Run `node_modules/.bin/tsx --env-file=.env.local scripts/ingest-client-factsheets.ts --apply --expect-plan {FACTSHEETS fingerprint}`. It writes FACTSHEETS-APPLY.md. Re-run its dry run: every sheet must be unchanged.
4. Run `node_modules/.bin/tsx --env-file=.env.local scripts/export-projects-for-workbook.ts` to refresh the gitignored `projects.export.json` (D12).
5. Run `node_modules/.bin/tsx --env-file=.env.local scripts/data-completeness-report.ts --no-write` as a regression check.

If any assert fails: stop. Run `scripts/import-client-workbook.ts --restore {backup path}` (dry run), show the user the restore diff, and apply it only with their approval and its own fingerprint.
  </what-built>
  <how-to-verify>
    1. IMPORT-APPLY.md shows: N docs written = N re-read asserts passed = N audit rows counted. The re-embed count equals the number of plans flagged reembed, with 0 failures. The second dry run shows 0 changes.
    2. FACTSHEETS-APPLY.md shows every sheet ingested with at least 1 published chunk, and the second dry run shows all sheets unchanged.
    3. Spot-check the new export without printing descriptions, using a 5-field node read: DC Residensi priceValue 1200000 and 14 soldOut entries out of 18. Southpoint 11 unitTypes, 7 of them priced, priceValue 1740000. Rafflesia 9 unitTypes, 2 labelled "Hill 4 · …", priceValue 2900000. SO Sofitel priceSource client-workbook.
    4. Optional, by the user in the app: Finder → Details on DC Residensi. The 14 sold-out layouts must be labelled sold out, and S1, S2, A3 and E2 shown as the available ones.
  </how-to-verify>
  <resume-signal>"verified", or describe the issue (which triggers the restore path)</resume-signal>
</task>

<task type="auto">
  <name>T6 (wave 3, post-apply only): refresh claim-095 UAT facts to the new snapshot (D12)</name>
  <files>.planning/quick/quick-kayinleong-095/uat-cases.json, docs/UAT-Output-Test-Cases.xlsx, docs/UAT-Output-Test-Plan.md</files>
  <precondition>CP-B is verified. `projects.export.json` has an exportedAt later than 2026-10-19T00:00:00Z. The sibling claim-095 agent has finished: `git status --porcelain .planning/quick/quick-kayinleong-095 docs/UAT-Output-Test-Cases.xlsx docs/UAT-Output-Test-Plan.md` is empty.</precondition>
  <action>
Bring claim 095's pinned Finder facts in line with the post-import snapshot (D12).
1. Run `python3 .planning/quick/quick-kayinleong-095/verify-uat-workbook.py --export projects.export.json`. The 095 scripts read only repo files, so plain python3 is correct here. Expect B1 to fail (the snapshot date), and B3 to fail for any declared project whose priceValue changed. DC Residensi is the known case: 0 → 1,200,000.
2. Set `meta.snapshot_exported_at` in uat-cases.json to the new export's exportedAt.
3. For each B3 failure, update `expect` to the export values. Read the export only through the verifier's own 5-field reduced loader approach, and never print descriptions.
4. Review every case whose clauses or prompts name a project changed by this claim. Take the list from IMPORT-APPLY.md's changed-docs table: the 14 unit-row projects plus every tenure or vp change. Update the stated facts (prices, layouts such as the Royal Suites types, tenure, sold-out wording) to the new record and fact sheet.
5. If a changed fact moves a project across a case's own budget or size bound, update that clause and list the case id in the SUMMARY for the user's review. Do not silently re-scope a case.
6. Rebuild the workbook with `python3 .planning/quick/quick-kayinleong-095/build-uat-workbook.py`. Edit docs/UAT-Output-Test-Plan.md only if it states a changed fact or a count.
7. Re-run the verifier until it shows 0 FAIL, then run `--self-test`.

Keep 095's PII rules: only the synthetic placeholders. Touch no claim-096 file. Run no git commands and no live commands.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>python3 .planning/quick/quick-kayinleong-095/verify-uat-workbook.py --export projects.export.json && python3 .planning/quick/quick-kayinleong-095/verify-uat-workbook.py --self-test</automated>
  </verify>
  <acceptance_criteria>
    - The 095 verifier shows 0 FAIL against the refreshed export, and the self-test passes.
    - meta.snapshot_exported_at equals the export's exportedAt.
    - Every case with a changed fact is listed in the SUMMARY, with re-scoped cases flagged.
  </acceptance_criteria>
  <done>The client UAT pack pins the facts the app now actually serves, so testers are not failing correct post-import answers against stale 2026-09-18 expectations.</done>
</task>

</tasks>

<threat_model>
ASVS Level 1. The plan blocks on high: every high threat is mitigated before CP-B.

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client workbook → stage 1 | An untrusted xlsx from outside the team. Every cell is data, never an instruction. |
| claim-dir JSON / fact sheets → TS stages | Committed artifacts, re-validated on load (schema, invariants, sha256, scanner). |
| operator shell → production Firestore | Admin SDK credentials via `--env-file=.env.local`; the Admin SDK bypasses security rules. |
| KB fact sheet → Finder model context | Sheet text becomes retrievable prose that the model reads. |
| repo → git history | Anything committed is permanent, so contact details must never reach a commit. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-096-01 | Tampering (integrity) | wrong values written to production `projects` | high | mitigate | Mitigations: the D9 gates hold back doubtful values; the workbook sha256 is pinned; the verifier asserts every parser case plus an 8-defect self-test; TS `parseClientSheet` re-runs the invariants; mapping is by docId, with the exact live name checked; the user approves the dry-run diff, bound by the `--expect-plan` fingerprint; writes use `update()` only; a full backup is re-read before the first write; every field is re-read and asserted; `--restore` exists. |
| T-096-02 | Tampering | re-run scripts clobbering the import | high | mitigate | `clientWorkbookFields` and `priceSource` guards in backfill-unit-types, backfill-project-sizes and fix-fabricated-prices, proven by T4's behaviour tests. sync-kb-prices already skips priced docs. reembed-projects writes only `embedding`. |
| T-096-03 | Information disclosure | Developer contact details (Raw Data!G21: a phone number and a URL) reaching KB docs, logs or commits | high | mitigate | Developer lines with contact details are dropped. The same contact scanner runs in Python (all outputs, before any write) and in TS (on load, before ingest, and before every report write), with an equivalence test over pii-vectors.json. Cell values are never printed. The workbook is never copied into the repo, and `*.xlsx` in the claim dir is gitignored. |
| T-096-04 | Information disclosure | backups and reports carrying description prose with PIC contact details | medium | mitigate | The backup dir is gitignored and checked with `git check-ignore`. Reports never render description, locationText or existing raw lines (sentinel tests). Logs hold counts, ids and names only. |
| T-096-05 | Spoofing / Elevation | credentials, or running against the wrong project | high | mitigate | `assertSafeTarget` lives in an import-free module and runs before the admin SDK is dynamically imported. The emulator requires a `demo-` id, and live requires `cy-csaiagent`. Credentials load only via `tsx --env-file=.env.local`. Agents never read `.env*`, and live runs are orchestrator-only (D11, D13). Only key presence is checked, never values. |
| T-096-06 | Denial of service / Integrity | the bulk-embedding format incident (ac7cd28): a vector value on `projects` zeroes every search score | high | mitigate | The runner writes a plain number[] and asserts Array.isArray plus length 1024 before and after the write. A static test bans the Firestore vector wrapper in the import code. kbChunks keep the VECTOR type through the untouched pipeline. Only docs whose embedded fields changed are re-embedded, and there is a documented full-re-embed recovery. |
| T-096-07 | Tampering / Injection | untrusted workbook input (XML bombs, formulas, prompt injection in Top Reasons or Developer, markdown injection) | medium | mitigate | `python3 -I -B` with a path argument; a 5 MB cap; .xlsx only; header check; read_only + data_only openpyxl, with defusedxml present. Control characters and angle brackets are stripped, and pipes are escaped. Facts over 2,000 characters are held, and injection phrases are held. Fact sheets are cited KB data, not instructions (Finder grounding rules). |
| T-096-08 | Repudiation | production edits with no trace | medium | mitigate | One auditLogs row per written doc and per ingested sheet, with synthetic actors `client-workbook-import-096` and `client-factsheets-096`, and the rows counted after the run, because `log()` swallows failures. Docs carry `clientWorkbookImportedAt` and `clientWorkbookFields` markers. KB versions chain through supersedesId. |
| T-096-09 | Integrity | sold-out units offered to a lead as available | medium | mitigate | `soldOut` flag; exclusion from price and size; a Finder prompt rule and tests; `status` is never auto-changed, and all-sold-out projects are surfaced for the user's decision (D3). |
| T-096-10 | Integrity | duplicate or stale KB fact sheets on re-run | low | mitigate | Deterministic title, a content-hash "unchanged" check, the updateDoc version chain, a refusal when more than one current doc shares the title, and a second dry run that must show all unchanged. |
| T-096-11 | Tampering | approval drift: live state changes between the dry run and the apply | medium | mitigate | `--expect-plan` recomputes the fingerprint from live state at apply time and refuses on any difference. Holds re-trigger a new dry run and a new approval. |
| T-096-SC | Tampering | npm/pip/cargo installs | high | accept | No package is installed. openpyxl 3.1.5, defusedxml, zod ^4, vitest and tsx are already present, so no legitimacy checkpoint is needed. |
</threat_model>

<verification>
Phase-level checks, run by the orchestrator after each wave and again before CP-A:
- `npx vitest run`: the full suite is green, and the count of new tests is reported per task.
- `npm run typecheck`: clean. Never filter its output; see 088.
- `npx eslint src/inventory/client-workbook*.ts src/kb/client-factsheets*.ts scripts/import-client-workbook.ts scripts/ingest-client-factsheets.ts scripts/client-workbook-guards.test.ts`: clean.
- `python3 -I -B .planning/quick/quick-kayinleong-096/verify-client-sheet.py --workbook "/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx" --export projects.export.json` and `--self-test`: 0 FAIL, and 8 of 8 defects caught.
- Git hygiene: `git status --porcelain` shows no `backups/`, no `.xlsx` and no `__pycache__` under the claim dir, and `git check-ignore -q .planning/quick/quick-kayinleong-096/backups/probe.json` exits 0. Re-scan the staged diff for contact details with the Python scanner before each commit.

## Regression surface. Each item is checked by a named test or step

| Surface | Why it is touched | Proof |
|---|---|---|
| Finder `searchProjects` | priceValue, priceBand, bedrooms, tenure and embedding change for imported docs | `src/inventory/search.test.ts`, `tests/finder-corpus-gates.test.ts` (T1 verify); CP-B plain-array assert |
| Finder table (`toFinderRow`, match-table) | the size range, Price and Beds are now derived from the merged unit list, excluding sold-out units | `src/agents/finder/tools.test.ts` (T1 verify); predicted per-project values in the interfaces table |
| `projectDetail` | per-unit `soldOut` reaches the model; merged entries may carry " \| kept from previous record: …" in `raw`; kept near-duplicate type-coded entries are listed as separate layouts; the prompt gains one rule | `src/agents/finder/project-detail.test.ts`, `finder.test.ts` (T1); near-duplicates reviewed at CP-A |
| Stored per-layout prices (amended D5) | unit-level merge instead of replace, so a blank sheet cell never clears a stored unit value | T1 Southpoint fixture (7 priced before and after) and Rafflesia fixture (2,900,000 kept); CP-B spot-check |
| `queryInventory` / `toInventoryRows` | spreads the doc, so `clientWorkbookFields` and `clientWorkbookImportedAt` now ride along (accepted: small metadata) | `tools.test.ts` (T1 verify) |
| Inventory admin form (`project-form.tsx` → `crud.updateProject`) | uses `update()`, so the new fields survive an admin edit; the form requirements are unchanged | `src/inventory/crud.test.ts` in the full suite |
| backfill-unit-types, backfill-project-sizes, fix-fabricated-prices | guards added | `scripts/client-workbook-guards.test.ts` (T4) |
| reembed-projects | unchanged; it is the recovery path | full suite; CP-B re-embed counts |
| export-projects-for-workbook | allowlist extended | T4 test; CP-B re-export |
| data-completeness-report | read-only, unaffected | CP-B `--no-write` run |
| KB ingest (createDoc, updateDoc, processBatch) | used, not modified | `src/kb` suites (T5 verify); CP-B chunk-count asserts |
| sync-kb-prices-to-inventory | skips priced docs (:165-168), no change | stated in the T4 SUMMARY |
| core/shell rule (src never imports app) | new src modules | `scripts/ci-guards.test.ts` (T4 verify) |
| UAT 095 verifier | facts change after apply | T6 (0 FAIL + self-test) |
</verification>

## Source audit

| SOURCE | ID | Item | Task | Status |
|---|---|---|---|---|
| GOAL | — | Workbook facts into the EXISTING project records; facts with no field go to Finder KB fact sheets | T1–T5, CP-A, CP-B | COVERED |
| CONTEXT | D1 | One fact sheet per project; finder, en; attribution; verbatim; unit table; provenance; idempotent; PII gate; no schema fields for these facts | T2 (content), T5 (ingest) | COVERED |
| CONTEXT | D2 | nett → priceMin/Max; gross in raw and the fact sheet; priceValue = the lowest stated price among available entries of the final merged list (amended), with the partial-coverage candidate for Rafflesia; priceBandFor; stated + client-workbook when a sheet nett wins; union widened; psf 200–5,000, never multiplied; bare numbers held | T1 (R5, R6, union), T2 (parse) | COVERED |
| CONTEXT | D3 | soldOut flag; excluded from price and size with the all-sold-out size fallback; prompt rule; no status change; tests | T1, T2 | COVERED |
| CONTEXT | D4 | Workbook wins; blank never clears; markers (single `clientWorkbookFields` + priceSource, justified); guards plus tests | T1 (R10, R11), T4 | COVERED |
| CONTEXT | D5 (amended 2026-10-19) | Reviewed mapping; 2 variants. Unit-level merge for every matched project with unit rows: label-key matching; sheet values win only when present; unmatched sheet units added; untyped grouped stored entries dropped (named, can be held), except Rafflesia, which keeps all and gets the "Hill 4 · " prefix; derived values computed over the final list. 3 new projects skipped; update() only; no fuzzy matching | T2 (mapping, unitMode), T1 (R1–R5, U1–U6), T3 (report) | COVERED |
| CONTEXT | D6 | Area not written; area-not-in-location report | T1 (R13), T2 (fact sheet) | COVERED |
| CONTEXT | D7 | Tenure normalised; full text in the fact sheet | T2, T1 (R7) | COVERED |
| CONTEXT | D8 | Past completed VP → vpStatus and 1 Jan vpDate; future → fact sheet only | T2 (classify), T1 (R8) | COVERED |
| CONTEXT | D9 (amended 2026-10-19) | Gates; HELD-BACK.md. The DC conflict set is the computed one: rooms B4, B6, B7 and E2 (sheet value written), plus the E1 size (held back) | T2, T1 (parse invariants) | COVERED |
| CONTEXT | D10 | Python stage 1 + verifier; TS stage 2 (env guard, backup first, update, re-read, audit count, selective plain re-embed); stage 3; Vitest with fixtures only | T2, T3, T5 | COVERED |
| CONTEXT | D11 | Live access orchestrator-only; dry run → user → apply | CP-A, CP-B | COVERED |
| CONTEXT | D12 | Re-export; 095 verifier with --export and a new snapshot date; no 095 edits before apply | CP-B step 4, T6 | COVERED |
| CONTEXT | D13 | Secrets; gitignored backups; workbook never staged; JSON committed after the PII gate | T3 (.gitignore), T2 (PII gate), threat model | COVERED |
| RESEARCH | pipeline §3 | Backfill re-run hazard | T4 | COVERED |
| RESEARCH | pipeline §6 | Backup-after-write hazard (089) | T3 (backup re-read before the first update) | COVERED |
| RESEARCH | workbook | Contact details in G21; Sheet1 name variants; psf in the Gross column; defects | T2 | COVERED |

No item is missing.

## Discretion choices and flagged risks (for the orchestrator to show the user)

Discretion, documented:
- **xlsx reader.** openpyxl in Python, not the repo's SheetJS `xlsx@0.18.5`. Reasons: D10 recommends it; quick-094 is the precedent; the npm 0.18.x line has published advisories for crafted files (prototype pollution, ReDoS) and the workbook is untrusted. The TS side only ever reads the gated JSON.
- **D4 marker.** One `clientWorkbookFields` list, kept beside `priceSource`. It covers sizes, bedrooms, tenure and vp, which a single `unitTypesSource` flag cannot.
- **Project `bedrooms`.** Set to the smallest non-sold-out bedroom count that is 1 or more (R4). The project-level value means "smallest layout", and 0 means unknown. This changes SO Sofitel 2 → 1, Imperial 3 → 4 and Eden 0 → 4. It can be vetoed with a `bedrooms` hold.
- **Held cells in `raw`.** These become "{Column} not confirmed", so a known-bad figure such as E1's 2,072 sqft cannot be quoted from the audit line.
- **Sheet1 aliases.** "Southpoint Residences (IGB)", "AETAS TAMAN DESA" and "AETAS SEPUTEH" are handled as 3 explicit, reviewed aliases. This is not fuzzy matching.
- **Completion dated in the import year** (e.g. "Q1 2026") is treated as expected, not completed. This is conservative.
- **New `--restore` mode, holds file and fingerprint.** These are added so that the backup can actually be restored and so that the user's approval binds the exact write.

Orchestrator amendment (2026-10-19), adopted:
- **D5 is amended.** Whole-list replace became a unit-level merge (R1, U1–U6), with derived values computed over the final list. This resolves the two earlier flags: Southpoint keeps its 7 stored per-layout prices, and Rafflesia keeps 2,900,000.
- **D9 is amended.** The DC Residensi conflict set is the computed one (rooms B4, B6, B7, E2; size E1), replacing "B4–B7" in the plan and in HELD-BACK.md.

Gaps in the amendment, resolved by the planner and flagged for the orchestrator to confirm or revert:
- **Qualifier strip in the label key (U1 step 2).** Without it, Imperial's stored "Type H1 (North Wing)", "Type H1A (South Wing)", "Type H2 (North Wing)" and "Type IR1 (Penthouse)" never match the sheet's H1, H1a, H2 and IR1, and Imperial would end with 9 near-duplicate layouts instead of 5.
- **Size tie-break for duplicate stored keys (U2).** Rafflesia stores two "Type E & E1" entries. The sheet's 3,964 sqft unit merges into the 3,964 entry, and an unresolvable tie adds the unit with a warning.
- **Partial-coverage price candidate (R5).** Rafflesia's stored unit entries carry no prices. Rule 5 as written would therefore give 3,717,000 (Hill 4 only), not the "stays at the existing Hill 2/3 figure" the amendment expects. The stored project priceValue is added as a candidate in `partial` mode only.
- **Matched entries keep the stored label and position.** Rafflesia's get the "Hill 4 · " prefix. New units are appended in sheet order.
- **A sheet "Sold out" cell nulls a stored unit price.** It is a stated value, not a blank. A kept stored price is otherwise the only price on such an entry.
- **A winning kept stored unit price** sets priceValue without priceSource 'client-workbook' (`price-from-kept-unit`). This does not occur in the snapshot.
- **Near-duplicates survive by design,** because type-coded stored entries are never dropped: Lantern Type A1 / Type A, Parkside Type C / C1 / C2, Southpoint Type A3 & B3 / A3 / B3. They are visible at CP-A. Removing them would need a further rule; holds can only keep entries.

Still flagged:
- Checkpoints use `gate="blocking-human"` because `.planning/config.json` has `auto_advance: true`, under which a plain `blocking` gate would auto-approve the production write.

<success_criteria>
- T1–T5 complete, with every listed verify command green, the full suite and typecheck green, and the Python verifier at 0 FAIL with 8 of 8 defects caught.
- The user explicitly approves at CP-A. The apply in CP-B reports equal written, asserted and audited counts and 0 re-embed failures, and the second dry runs show 0 changes and all sheets unchanged.
- No contact details, backups or workbook copies in git. HELD-BACK.md is ready to send to the client.
- T6 brings the claim-095 verifier to 0 FAIL against the refreshed snapshot.
- The orchestrator writes CLAIM.md "What has changed" and "## Verification" (the regression report built from the table above) and sets the status to done.
</success_criteria>

<output>
Each executor writes its SUMMARY (status: complete, with Goal / Changes Made with file:line / Verification / Regression / Blockers) into its final report for the orchestrator. The orchestrator records the outcomes in `.planning/quick/quick-kayinleong-096/CLAIM.md`. These files stay in the claim dir:
- the stage 1 outputs;
- IMPORT-DRYRUN.md, IMPORT-APPLY.md, FACTSHEETS-DRYRUN.md and FACTSHEETS-APPLY.md, which are committed after a PII re-scan;
- `backups/`, which is never committed.
</output>
