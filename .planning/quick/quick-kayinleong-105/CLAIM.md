# Claim: quick-kayinleong-105
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-105 (from quick-kayinleong-104, whose planner writes `area` and gross prices)
- started: 2026-11-21
- status: done
- summary: Import the 21 Nov client workbook (_D2 Project Info.xlsx, sha256 0a390f6e…) so the Finder gets each project's Area and the new layout prices, including Pavilion Damansara Heights and its Royal Suites.

## What will change
- Rebuild the normalized sheet, mapping and held-back list from the 21 Nov workbook with the claim 096 builder, into `build/` in this claim directory, as claim 101 did.
- Fix the builder only where the new workbook needs it:
  - The new price formats: "RM630k - RM959k", "RM1.18m - RM1.6mil", "Rm4.77mil – Rm6,59mil".
  - psf-only gross cells ("RM 1.6k-2.3k psf") stay not-a-total and are never multiplied by a size.
  - The `=AI("Fill an appropriate value…")` formula cells (rows 20 and 79) are held back, never loaded.
  - Pavilion Damansara Heights' single "Phase 1" row is loaded as a layout.
- Diff against what 096/101 loaded, then dry-run the 096 import runner against live data. The report goes in this claim directory.
- Live writes happen only after the user approves the dry-run fingerprint. They also wait for the user's corrected workbook ("Damansara Height" → "Damansara Heights", rows 2 and 21).
- Update (2026-11-21): the user has no corrected workbook ("this is the only excel i got"). The apply goes ahead on this one, and the search handles the spelling instead: "Height" and "Heights" match.

## What has changed
Commits c3e4f8a (builder + import flag) and 0f68c92 (build and dry runs). Nothing has been written to Firestore yet.

**Builder** (`.planning/quick/quick-kayinleong-096/build-client-sheet.py`, `wbparse.py`). The 21 Nov sheet stopped it at four points:
- **Unfilled `=AI("Fill an appropriate value…")` formulas** sit in 77 Size cells across about 65 projects. They are blanked and listed in HELD-BACK.md. A formula in any other column refuses the workbook.
- **"Top Reasons Why" one reason per row**, down the unit rows (PDH Imperial, PDH Royal Suites, Southpoint). These are joined onto the project row. Any other project-level value on a continuation row is still refused.
- **Labels and ranges:**
  - Digit-first codes are now labels ("Type 1A", "Type 2B/2B1"; Bangsar Hill Park). "Type 1 Bedroom" is not.
  - A "Phase N" row is a label (Pavilion DH).
  - A size range ("605-2803sqft") is held. It used to be read as its upper end.
  - A bedroom range ("1 bedroom up to 4+1") is left unstated.
- **A project whose unit rows carry no label** loads no units (`none`) instead of failing invariant 8. Its rows still appear in HELD-BACK.md (Clouthaus KLCC's "635sf 1BR Type K", Enlace's project-wide range).
- **New flags:** `--skipped-new` (the three October new projects now exist) and `--source-label` (this build says 21 November 2026, not 19 October).
- **Verifier:** 14 new parser cases (106 in total) plus a formula-detection gate.

**Import runner** (`scripts/import-client-workbook.ts`): `--report-dir` (`.planning/quick/<claim>` only). Backups always go to the gitignored 096 backups dir.

**Build** (`build/`): 83 projects mapped (81 exact, 2 variant, plus 3 Sheet1 aliases), 123 layouts across 18 projects, 130 values held back.
- Compared with the 27 Oct build: 67 projects are identical.
- Changed, all from the sheet:
  - Royal Suites: nett prices on all 10 layouts.
  - Pavilion DH: a "Phase 1" layout, RM930k-6.4M nett.
  - Bangsar Hill Park: 7 new priced layouts, replacing 6 vague unpriced ones.
  - Southpoint: new prices, and 5 layouts now sold out.
  - Conlay: a new Type E.
  - PDH Imperial: tenure.
  - Fact changes on 14 projects (fact sheets: 17 with content changes, counting the three projects created in October).

## Verification
- **Verifier** (`verify-client-sheet.py`):
  - P (106 parser cases + gates), S (scanner) and J (10 invariants) pass.
  - Self-test catches 8 of 8 injected defects.
  - G fails by design: it pins the 19 Oct workbook hash.
- **Contact-detail scan** of all 90 output files with the project scanner: 0 hits.
- **Import dry run** (`IMPORT-DRYRUN.md`, live, read-only): 84 projects planned, 77 changed, 178 field changes, 4 re-embeds. Fingerprint `097001a56f9fddf29a433fbb0f1dc1ba1726353766d680f861bff8eb6d3548c5`.
  - `area` on 77 projects.
  - from-price changes: Pavilion DH RM861,120 (WhatsApp-sourced) → RM930,000; Royal Suites RM652,284 → RM630,000; Southpoint RM1.74M → RM1.84M (cheaper layouts sold out); Bangsar Hill Park 0 → RM841,000.
  - Gross prices on 38 layouts.
  - Warnings: 6 unpriced Bangsar Hill Park layouts dropped. Conlay's size range becomes 635-1,432 sqft: the 2,787 came from its write-up, not a listed layout.
- **Fact-sheet dry run** (`build/FACTSHEETS-DRYRUN.md`): 83 updates, 0 creates, 0 refused. Fingerprint `967a85d39dc9849f50eb84451d2838c34c2645bb6c8b733c1db028135ff46c34`.
  - 17 have content changes.
  - 66 change only the source date.
- **Search simulation** (the planned import applied in memory to the live docs, with the 104 code):
  - Damansara Heights, RM1.5M-2.5M returns Royal Suites (in area), Pavilion DH (in area) and One Eleven (nearby). With rows 2 and 21 fixed, it also returns DC Residensi.
  - Bangsar Hill Park leaves the above-RM2M and above-RM3M searches. Its price was unknown and admitted before; now its dearest layout is RM1.7M gross.

## Applied (live, 2026-11-21)
The user approved applying this build as is.
- **Project import** (`IMPORT-APPLY.md`, fingerprint `097001a5…`): 77 written, 77 re-read and asserted, 77 audit rows, 4 re-embedded (0 failed). Backup: `.planning/quick/quick-kayinleong-096/backups/2026-11-21T08-32-52-107Z/projects-backup.json` (gitignored). Restore: `scripts/import-client-workbook.ts --restore <backup>`, dry run, then `--apply --expect-plan`.
- **Fact sheets** (`build/FACTSHEETS-APPLY.md`, fingerprint `967a85d3…`): 83 updated, 0 refused, 83 of 83 audit rows. Each new version has published chunks, and the old doc is recorded as superseded.

## Code changed after the apply
- c501713 **`src/inventory/search.ts`**: `normalizeLocationText` folds a trailing plural "s" off ASCII words of 5+ letters (not "ss"), on the needle and the haystack alike. The qualifier / place-type / compass / region sets are folded the same way.
  - The sheet's "Damansara Height" and a typed "damansara height" now match "Damansara Heights".
  - 2 new tests. The 104 test that pinned the old behaviour is updated.
- 0faabfe **`src/agents/finder/prompt.ts`**: the budget rule forbids saying that units of a bedroom count, size or type fit the budget until projectDetail's unitTypes is read. A real run had said DC Residensi's "2- and 3-bedroom units are well within the band"; those layouts are sold out.

## Verification after the apply
- **Location gate with and without the fold** (live, 38 area searches): 36 unchanged. "Damansara Heights" goes 6 → 7 (+DC Residensi). "damansara height" goes 2 → 7.
- **The real Finder** (claude-sonnet-4-6, this branch's code, live data) on the reported message. It applied RM1.5M-2.5M and "Damansara Heights". The table shows:
  - in the area: DC Residensi (from RM1.2M), Pavilion Damansara Heights (from RM930k), Royal Suites (from RM630k);
  - around it: One Eleven Menerung @ Bangsar.
  - Before 104/105: One Eleven only.
- **Wording.** After the prompt fix, the AI points to Details for which 2- and 3-bedroom units remain, instead of claiming they fit.
- **Tests and checks:**
  - `npx vitest run`: 1685 passed, 223 skipped. The only failure is `tests/finder-corpus-gates.test.ts`, which needs the gitignored `projects.inventory.json` (it failed before this claim too).
  - `project-detail.test.ts` timed out once under the full parallel run and passes alone (47/47).
  - `tsc` clean.
  - `eslint`: 0 errors (the test file's existing `_args` warnings).

## Regression report
- **Builder.** 67 of 83 projects come out identical to the 27 Oct build. Every difference traces to a changed cell in the 21 Nov sheet. All 92 earlier parser cases still pass, and the self-test catches 8 of 8 defects.
- **Import.** The planned writes matched the dry run exactly (same fingerprint at apply). The backup and restore path is unchanged. `area` is not embedded, so only 4 projects re-embedded (price / bedroom / tenure changes).
- **Plural fold.** The live comparison above shows only the two intended searches change. The existing location tests all pass: 050 / 085 / 098 proximity runs, compass words, the region skip, the in-area / nearby split. Distinct places (Bukit Jalil / Bukit Bintang) stay distinct (test).
- **Prompt.** Wording only. The search, the table and matchedCriteria are untouched.

## Known limitations
- **The live site still runs the old code.** The data is live, but the old code reads neither `area` nor gross prices, and it checks the floor against the from price. The Damansara Heights result appears only once 104 and 105 are merged and deployed.
- **Values held back until the client fixes them** (HELD-BACK.md):
  - the 77 `=AI(...)` formula cells;
  - "Rm6,59mil" (PDH Imperial H1a nett);
  - "RM8978k-RM1.1mil" (Bangsar Hill Park 2A1 nett);
  - psf-only gross cells ("RM 1.6k-2.3k psf", "RM 2k psf +"), which are not totals, so the floor uses nett there;
  - Pavilion DH's size range.
- **Clouthaus KLCC's 11 rows** load only if written as "Type K: 635sf".
- **Conlay's size range** is now 635-1,432 sqft, from its layout list. The 2,787 sqft in its write-up is not a listed layout.
