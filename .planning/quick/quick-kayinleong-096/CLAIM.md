# Claim: quick-kayinleong-096
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: in-progress (built and tested; live dry run pending)
- summary: ingest the client's updated "_D2 Project Info.xlsx" (per-unit-type sizes, nett/gross prices, sold-out units, project facts, 2026 cross-sell list) into the existing project records

## What will change

The client supplied a workbook with updated data for projects that already exist in
the inventory. This claim maps that workbook onto the existing project records and
writes the new values. It does not create new projects.

How the data is merged, and which environment it goes into, are confirmed with the
user before anything is written to live Firestore.

## Research

- `RESEARCH-pipeline.md`: how project data is written today. It covers the schema, who reads
  which fields, the writer scripts and their re-run hazards, the admin surface, the KB side,
  precedents, name matching and environments.
- `RESEARCH-workbook.md`: a profile of the client workbook. It has 83 projects, 183 data rows
  and 15 projects with unit-level rows. 78 names match exactly, 2 are name variants and 3
  are new. It also lists the value formats and defects. One Developer cell, `Raw Data!G21`,
  holds a phone number and a URL.

## Decisions (user, 2026-10-19)

- **Facts with no field in the record go to Finder KB fact sheets.** These include
  Developer, Land Title, Maintenance, Units, Floors, Expected Completion, Reasons,
  Furnishing, Car Park and the 2026 focus lists. Each project gets one clean fact sheet,
  and no schema fields are added.
- **The price basis is Nett.** Unit price ranges are nett, and the project "from" price is
  the lowest stated nett figure across unit types that are not sold out. Gross is kept on
  each unit line and in the fact sheet.
- **Sold-out units are flagged per unit.** Each gets `soldOut: true` and is excluded from the
  from-price and the size range. The Details answer must say "sold out". The project's
  status is never changed automatically.
- **The workbook wins, field by field.** A blank cell never clears an existing value.
- **Only existing projects are updated.** The 3 new projects are skipped and reported.
- **Name variants are mapped explicitly.** There is no fuzzy matching.
- **Suspect values are held back and listed for confirmation**, not guessed. An example is
  the DC Residensi E1 sqft/sqm mismatch.
- **Area is not written to `locationText`.** It is the search gate, so Area goes to the fact
  sheet only.
- **Live access is orchestrator-only.** The live dry-run diff and the held-back list go to
  the user first, and `--apply` runs only after explicit approval.

## What has changed (built, not yet applied to live)

Nothing has been written to live Firestore.

**Wave 1**

- **T1 `9e250dc`: TS core.**
  - Adds `UnitTypeEntry.soldOut`, `priceSource: 'client-workbook'`, and the
    `clientWorkbookFields` / `clientWorkbookImportedAt` markers.
  - `client-workbook-safety.ts` provides the live-project guard and the contact scanner.
  - `client-workbook.ts` implements the zod contract and `planProjectPatch`. Precedence: the
    workbook wins, a blank never clears, units merge by label, and derived values are taken
    from the final merged list.
  - Adds the Finder prompt sold-out rule.
  - Tests: 131 for the core, plus 3 for projectDetail.
- **T2 `83fa411` (+ `f41709c` wording fix): Python stage 1.**
  - Outputs: `client-sheet.normalized.json`, `project-mapping.json`, `HELD-BACK.md` and 80
    fact sheets.
  - Results: 80 projects mapped, 106 units, 16 sold out, 23 held-back values, 3 new projects
    skipped.
  - Verifier: 12 checks, 0 FAIL. The self-test catches 8 of 8 injected defects.

**Wave 2**

- **T4 `9b291d8`: backfill guards.** `backfill-unit-types`, `backfill-project-sizes` and
  `fix-fabricated-prices` now skip fields the workbook owns, and the export carries the
  markers. 9 behaviour tests; 8 of them fail when the guards are disabled.
- **T5 `b58fb6c`: idempotent finder fact-sheet ingest.** It goes through
  `createDoc` / `updateDoc` → `processBatch`. Each sheet is classified as create, update,
  unchanged or refuse, a PII gate runs before any write, and apply is gated on the
  fingerprint. 44 tests.
- **T3 `1873b35`: import runner.**
  - Dry-run diff report and fingerprint-gated `--apply`.
  - Writes a backup and re-reads it before the first write, writes with `update()` only, and
    re-reads after the write to assert it.
  - Counts audit rows, re-embeds selectively as plain arrays, and supports `--restore`.
  - Tests: 198. The emulator suite (32) and an emulator CLI smoke run both pass.
  - The `.gitignore` now covers the backups.

**Checks:** typecheck clean.

**Process note:** the T3 agent deleted its own temporary seed file at the repo root with
`rm -f`. The global rules ask for confirmation before that. Nothing else was affected.

## Pending (orchestrator, needs the user)

- **CP-A, live read-only dry runs.** The session's auto-mode classifier blocked live
  Firestore access, so the user runs these, or grants permission for them.
- **CP-B, apply after approval.** Followed by T6, refreshing the claim-095 UAT facts against
  the new snapshot.
