# Claim: quick-kayinleong-104
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-104
- started: 2026-11-21
- status: done
- summary: Finder Damansara Heights search. The budget floor checks a project's gross layout prices instead of its cheapest "from" price, and the client sheet's Area is saved on existing projects and used by the location search.

## The report
"budget around RM1.5MIL TO RM2.5MI 2 OR 3 BEDROOM IDEALLY ... under damansara height". The Finder showed The Cedar and One Eleven Menerung @ Bangsar. D2 has five projects in Damansara Heights. Measured on the live data (read-only):

| Project | from price (priceValue) | Why it was dropped |
|---|---|---|
| Pavilion Damansara Heights | RM861,120 | from price under the RM1.5M floor |
| Pavilion DH: Royal Suites (RC) | RM652,284 | same |
| DC Residensi | RM1,200,000 | same, and its address ("Pusat Bandar Damansara, ...") does not say Damansara Heights |
| The Cedar | RM2,946,200 | over RM2.5M (the user's run let it through, so that run did not cap at RM2.5M) |
| PDH: Imperial Residences | RM5,050,000 | over RM2.5M |

A re-run of the real Finder on the same message applied RM1.5M-2.5M and returned only One Eleven Menerung (nearby, Bangsar).

## What will change
1. **Budget floor on gross prices** (the user's call: "use gross price").
   - `UnitTypeEntry` gains `grossMinRM` / `grossMaxRM`. The client-sheet import stores the sheet's Gross Price per layout next to the nett price. A psf-only gross cell ("RM 1.6k-2.3k psf") is not a total and stays null; it is never multiplied by a size.
   - `projectMatchesPrice`: the floor (`priceMin`) is checked against the project's TOP price: the highest gross price among its available layouts, else their highest nett price, else the from price (`priceValue`) as today. The ceiling (`priceMax`) stays on the from price. Unknown price is still admitted.
   - Measured on the live data: keeping every project without layout prices would let 74 of 82 through an "above RM3M" search (today 33). The fallback to the from price keeps that at today's behaviour.
   - The Finder prompt's budget rule is corrected: a from price under the floor is expected when larger layouts reach it.
2. **Area column used for search.**
   - The import writes the sheet's Area to a new `area` field on existing projects (a blank cell never clears it; `locationText` is never overwritten). New projects get it too.
   - The location gate and the in-area/nearby classification read `area` as part of the project's own address.
3. **Not in this claim's code:** importing the new workbook (`_D2 Project Info.xlsx`, sha256 0a390f6e…). It is built and dry-run here; the apply is a production write and waits for the user. The sheet needs two fixes first: "Damansara Height" → "Damansara Heights" (rows 2 and 21), and the `=AI(...)` formula cells (rows 20 and 79).

## What has changed
Commit a2dbdb6.

**1. Budget floor on gross layout prices**
- `src/firebase/collections.ts`: `UnitTypeEntry` gains optional `grossMinRM` / `grossMaxRM`. `priceMinRM` / `priceMaxRM` is documented as the nett price for sheet entries.
- `src/inventory/client-workbook.ts` `mergeUnits`:
  - A matched layout takes the sheet's gross range. If the sheet cell is blank, it keeps the stored one and the raw line says "kept from previous record: gross price".
  - A sold-out layout carries none.
  - New layouts carry the sheet's gross range.
  - The keys are added only when a gross total exists, so a sheet without one leaves stored entries unchanged.
- `src/inventory/search.ts`:
  - New exported `projectTopPrice(doc)`: per available layout, gross max → gross min → nett max → nett min, then the highest of those and `priceValue`. Sold-out layouts are skipped.
  - `projectMatchesPrice` checks the floor against it and the ceiling against `priceValue`, as before. Unknown `priceValue` is still admitted.
- `src/inventory/client-workbook-run.ts`: the report's unit table has a Gross (RM) column.

**2. Area saved and searched**
- `collections.ts`: `ProjectDoc.area?: string`. `'area'` is added to `ClientWorkbookField`.
- `client-workbook.ts` `planProjectPatch` R8b:
  - A non-blank sheet Area is planned as `area`, trimmed.
  - A blank Area never clears it, and `locationText` is never written.
  - `area` is in `WORKBOOK_FIELDS`, so it joins `clientWorkbookFields`. It is not an embedded field, so there is no re-embed.
  - New projects get it through the same planner (`client-workbook-new.ts` docstring).
- `search.ts`:
  - `locationHaystack` adds the address clauses of `area` (new `sheetAreaText`). The proximity-run rule applies, so "near Kuchai Lama" in an Area cell is not an address.
  - `projectLocationMatch` reads `area` through `ownAddressText` as own address (in_area).

**3. Finder prompt** (`src/agents/finder/prompt.ts`)
- The budget rule says the floor reads the dearest layout. A from price under `priceMin` is expected and must never be called out of budget.
- A unitTypes entry with gross keys is shown as Nett and Gross.

**Tests**
- `src/inventory/search.test.ts`: 5 new (top price, the reported RM1.5M-2.5M case, Area in the gate, a landmark in an Area cell, `searchProjects` end to end).
- `src/inventory/client-workbook.test.ts`: 7 new (Area ×3, gross ×4).
- 4 existing expectations updated for intended changes:
  - "never writes area" is now "never writes name/description/locationText/status".
  - Ashbourne's `clientWorkbookFields` now includes area.
  - 2 report rows have the extra Gross cell.

## Verification
**Live data, read-only (2026-11-21).**
- The real Finder (`scripts/diag-finder-toolpick.ts`, claude-sonnet-4-6) on the reported message applied RM1.5M-2.5M and "Damansara Heights", and returned only One Eleven Menerung. That is the defect. The user's own run also showed The Cedar (RM2,946,200), so that run did not cap at RM2.5M. The model reads the budget differently from run to run, and the chat does not store the tool input.
- Floor rule options were measured over the 82 active residential projects. Only 16 have layout prices.
  - "No layout prices → admit": an above-RM3M search passes 74 instead of 33. Rejected.
  - The fallback to the from price is what shipped.
- Simulation (`planProjectPatch` with the 27 Oct normalised sheet, applied in memory to the live docs; nothing written):
  - 81 projects planned. `area` written on 73. 31 layouts gain a gross price.
  - **Location, 34 area searches, before → after:**
    - No project removed anywhere.
    - Added, each from its Area cell: KLCC +The Oval; Bangsar +ViiA, +Riana Trees (Area "Bangsar South"); TRX +Golden Crown; Ampang +Sierra Hijau, +Ritz-Carlton ("105, Jalan Ampang"), +18 Madge (nearby, slash rule); Setapak +Padang; Shah Alam +DAYA; Ukay Perdana +2; Jalan Ampang +2; Desa Melawati +The Reya; Segambut +Miranda Hill (nearby).
    - Kuchai Lama stays at 0: the Area cell's "near Kuchai Lama" is dropped.
  - **Budget, 10 ranges:**
    - Ceiling-only searches are unchanged (23 / 43 / 66).
    - Floor searches gain 1–6 and lose none. RM1.5M-2.5M goes 31 → 34 (+SO Sofitel KLCC, +DC Residensi on its gross RM2.1M, +Parkside).
  - **The reported query (DH, RM1.5M-2.5M):**
    - Before: One Eleven (nearby).
    - After: the same, because DC Residensi's Area reads "Damansara Height".
    - With that typo fixed: One Eleven (nearby) + DC Residensi (in_area).
    - Royal Suites and Pavilion DH need the layout prices that are only in the new workbook (see Known limitations).

**Tests and checks.**
- `npx vitest run`: 1683 passed, 223 skipped. 1 suite failed, and it was already failing: `tests/finder-corpus-gates.test.ts` needs the gitignored `projects.inventory.json`.
- `src/agents/finder/project-detail.test.ts` timed out once under the full parallel run (8.5s). It passes alone, 47/47.
- `npx tsc --noEmit -p .`: clean.
- `eslint` on the changed files: 0 errors. The warnings are the test files' existing `_args` / `_text` mock pattern, plus one more in the new block.
- Secret scan of the diff: clean.

## Regression report
- **Location gate.** Projects without `area` produce the same haystack as before, apart from an extra " , " separator, which normalisation collapses. All earlier location tests pass (050 / 085 / 098 / 103). The live simulation removed no project from any of the 34 searches.
- **In-area / nearby.** It still only classifies and never removes. `area` can only turn nearby into in_area for a project whose Area names the place.
- **Price gate.**
  - The ceiling path is unchanged (same comparison against `priceValue`).
  - Unknown-price admission is unchanged.
  - The floor can only admit more, never fewer: `projectTopPrice` is at least `priceValue`.
  - `matchedCriteria.priceMax` logic is untouched.
- **Import.**
  - Stored entries without gross are byte-identical after a merge (keys added only when present). So a re-run of the old sheet changes only `area`, `clientWorkbookFields` and the timestamp.
  - Restore handles the new field generically: an absent field is deleted on restore.
  - `area` is not embedded, so the re-embed list is unchanged.
- **Backfill guards.** `isClientWorkbookField` is a list lookup, and no backfill writes `area`.
- **Finder output schema.** Unchanged. `unitTypes` reaches the model verbatim, so gross keys are visible to it, and the prompt says how to label them.

## Known limitations
- **Live behaviour waits on a deploy and an import.** The code changes nothing live until this branch is merged and rolled out. `area` and gross prices exist only after the client sheet is imported again.
- **The new workbook is not built or imported.** `_D2 Project Info.xlsx` (21 Nov, sha256 0a390f6e…) differs from the 19 Oct sheet. The build script (`.planning/quick/quick-kayinleong-096/build-client-sheet.py`) pins the old sha and import date, so it needs a new claim. That claim also needs to:
  - Have the client fix "Damansara Height" → "Damansara Heights" (rows 2 and 21).
  - Drop the `=AI("Fill an appropriate value…")` cells (rows 20 and 79, The Cedar's Size).
  - Parse the new price formats ("RM630k - RM959k", "RM1.18m - RM1.6mil", "Rm4.77mil – Rm6,59mil").
  - Switch Pavilion Damansara Heights from `unitMode: none` to merge for its "Phase 1" row.
  - Keep psf-only gross cells ("RM 1.6k-2.3k psf") as not-a-total.
- **The model can still misread a budget.** The user's run let a RM2.95M project through a RM2.5M ceiling. The search tool applies whatever budget the model passes, and the stored chat does not keep the tool input, so that run cannot be replayed.
- **Text-based area matching.** "Bangsar" matches an Area of "Bangsar South", and "Ampang" matches "Jalan Ampang". This is the same phrase rule as `locationText`.
