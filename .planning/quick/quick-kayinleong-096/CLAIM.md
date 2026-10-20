# Claim: quick-kayinleong-096
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: done
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

## Live run (2026-10-20, user-approved)

The live dry runs and the apply were run by kayinleong in their own terminal, using
`tsx --env-file=.env`. This session's auto-mode classifier blocked the first live read,
so the user ran them. The user then asked the orchestrator to run the two read-only
re-checks and the re-export.

**Import** (fingerprint `e276716d…053c`, approved as shown)

| Measure | Count |
| --- | --- |
| Projects changed | 37 of 81 |
| Field changes | 112 |
| Written | 37 |
| Re-read and asserted | 37 |
| Audit rows | 37 |
| Re-embedded | 10 (0 failed) |

- **Backup:** `backups/2026-10-20T02-50-24-090Z/projects-backup.json` (170 KB). It is
  gitignored, as confirmed with `git check-ignore`. This is the undo path:
  `--restore <backup>`.
- **Idempotency:** the next dry run showed `projects changed: 0`.
- **Report:** `IMPORT-APPLY.md` holds the full before → after record.

**Fact sheets** (fingerprint `00f4a188…52a3`)

- 80 created and 113 chunks published, with 80 of 80 audit rows.
- The next dry run showed `unchanged 80`.

**Snapshot re-exported** (2026-10-20T02:53Z), with spot-checks against plan:

| Project | Price | Units |
| --- | --- | --- |
| DC Residensi | RM1,200,000 | 18 (14 sold out) |
| Southpoint | RM1,740,000 | 11, prices kept |
| Rafflesia | RM2,900,000 | 9 |
| Parkside | RM588,000 | 10 |

**T6 (UAT refresh, `d6335ad`)**

- **F14** now expects DC Residensi's nett price from RM1.2m, and must not offer a
  sold-out layout.
- **F24** now accepts the 10 Royal Suites layouts.
- The 095 snapshot date is now 2026-10-20, and the plan doc's DC Residensi note and Q14
  are updated.
- The 095 gate passes 38 checks and its self-test passes. E6 had a false positive on
  "Type E1"; the pattern now ignores layout names.

## Verification

### What was tested

- **TS:**
  - 131 core tests, 198 runner and contract tests (emulator suite 32/32), 9 guard tests,
    44 fact-sheet tests and 3 projectDetail tests.
  - Typecheck is clean.
  - Full suite: 1,562 tests passed, and 1 suite failed: `tests/finder-corpus-gates`. That
    suite loads the gitignored `projects.inventory.json`, which is absent on this
    machine, so it errors on load. It is unrelated to this claim.
- **Python stage 1:** 12 checks, 0 FAIL. The self-test catches 8 of 8 injected defects.
- **Gates bite:**
  - T1: 5 rule mutations each fail the tests.
  - T4: with the guards disabled, 8 of 9 tests fail.
  - T3: a wrong `--expect-plan` refuses before writing.
- **Live:** apply, re-read asserts, audit counts, a re-run showing 0 changes, and fact
  sheets showing unchanged 80.

### What was ruled out and why

- **Invented prices (the quick-088 failure):**
  - psf is never multiplied by a size;
  - the "from" price is the lowest stated nett figure across available units (approved by
    the user);
  - doubtful values were held back: 23 values in `HELD-BACK.md`.
- **Clobbering:**
  - a blank cell never clears a value, and units merge by label, so Southpoint kept its 7
    prices and Rafflesia kept RM2.9m;
  - the three backfill scripts now skip fields the workbook owns.
- **PII:**
  - the phone number and URL in the Developer cell (Raw Data!G21) were scrubbed;
  - every fact sheet and report passed the contact scanner, and an independent grep
    found nothing;
  - the backup, which holds descriptions, is gitignored.
- **Search breakage:**
  - Area was not written to `locationText`;
  - 10 projects were re-embedded as plain arrays (see the `ac7cd28` incident), and the
    write is checked by reading it back.

### Regression surface

- **Finder:** search, the results table and `projectDetail` (`soldOut` passes through,
  plus a prompt rule).
- **Scripts:**
  - the 3 backfill scripts are guarded;
  - the export carries the new markers;
  - the inventory admin form is unchanged;
  - `reembed-projects` is unchanged.
- **KB:** the ingest path is reused, and nothing in it was modified.
- **UAT 095:** the gate is green.

## Open items for the client and Derek

- **Held-back values:** the 23 entries in `HELD-BACK.md`, including the DC E1 size, the
  Imperial H1a and H2 prices, Puncak's gross column, the Sentral Suites column shift and
  5 ambiguous completion dates.
- **New projects:** Binastra Cochrane, Lagenda Tunku and Ashbourne. Adding them is a
  separate step.
- **Location text:** for 26 projects, the sheet's Area isn't in the stored location text
  (e.g. "Bukit Bintang"), so Finder location searches may miss them. Deciding whether to
  append the Area to `locationText` is a separate decision; doing so would trigger a
  re-embed.
- **Near-duplicate layouts:** Lantern "Type A" vs "Type A1", Parkside "Type C" vs "C1",
  and Southpoint "Type A3 & B3" alongside A3 and B3.
