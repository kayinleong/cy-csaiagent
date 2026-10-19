# Claim: quick-kayinleong-096
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: claimed
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
