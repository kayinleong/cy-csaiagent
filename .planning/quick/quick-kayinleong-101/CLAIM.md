# Claim: quick-kayinleong-101
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-101
- started: 2026-10-27
- status: done
- summary: ingest the updated client workbook (_D2 Project Info.xlsx, sha256 8b7c1c9a…) so every project returns the workbook's values: load changed values and the projects 096 skipped, and make projectDetail always attach the project's own client fact sheet

## What will change

- Rebuild the normalized sheet, mapping, held-back list and fact sheets from the new workbook
  with the claim 096 builder (`build-client-sheet.py`), into this claim directory.
- Diff against what 096 loaded, and check every project and field against live Firestore.
- Apply the missing and changed values through the 096 import runner and fact-sheet ingest.
  This is dry-run first, fingerprint-gated, with a backup; live writes happen only after the
  user approves.
- Create the projects 096 skipped as new (Binastra Cochrane, Lagenda Tunku (Villa Gemilang),
  Ashbourne), with user-confirmed eligibility flags.
- Code: `projectDetail` always includes the project's own client fact sheet (looked up by
  exact title, not by similarity), and the prompt makes the client sheet win over older
  records.
- Re-test every property through the chat and score against the new workbook.

Note: the new workbook's Developer column still carries the offset found in the 2026-10-27
re-test (rows 91-93, 114-125). The user asked for answers to match the workbook, so they will;
the offset is reported, not corrected.

Waves: the code change (tools.ts / prompt.ts / tests) and the new-project build are
independent and were done in parallel; the live writes wait on user approval; the chat
re-test waits on both the code and the writes.

## What has changed

### Ingestion check (read-only, 2026-10-27)

- The new workbook rebuilt with the 096 builder (`build/`) differs from what 096 loaded in
  **0** values for all 81 mapped projects.
- Live check of every mapped project against `build/client-sheet.normalized.json`: all layouts
  (size, nett price, sold-out) and every fact-sheet fact are present. The 9 layout "gaps" in the
  first pass were artefacts of the check's label matching (`Type H1 (North Wing)` vs `H1`,
  `J3` vs `Type J3`, and Rafflesia's `Hill 4 · ` prefix); the values match. 5 projects store a
  more specific tenure (`Leasehold 2121`) than the sheet's `Leasehold`, which the 096 planner
  keeps on purpose (R7).
- Fact-sheet ingest dry-run with the new build's manifest: **80 unchanged**, 0 create/update.
- Not ingested: the 3 projects 096 skipped as new.

### New projects

- `build-new-projects.py`: reuses the 096 builder's parsing to build Binastra Cochrane (row 85),
  Lagenda Tunku (Villa Gemilang) (row 185) and Ashbourne (rows 186-193, 8 layouts) into
  `new-projects/` (normalized JSON, 3 fact sheets, manifest). Document IDs are pinned in
  `new-project-ids.json`. Nothing held back.
- `src/inventory/client-workbook-new.ts` (+ test): builds each record through
  `planProjectPatch`; defaults status active, price unknown, bumiQuota/foreignEligible false
  (not mentioned in the sheet), locationText = the sheet's Area, description = the sheet's
  cells line by line.
- `scripts/add-client-workbook-projects.ts`: dry-run / fingerprint-gated create (create() never
  overwrites), audit row, re-read check.
- `scripts/ingest-client-factsheets.ts`: the report is now written beside the manifest it is
  given, so a second manifest cannot overwrite 096's committed reports.

### Code

- `src/agents/finder/tools.ts`: `projectDetail` reads the project's client fact sheet by its
  exact title (`clientFactSheetTitle`, now shared from `src/kb/client-factsheets.ts`) and puts
  its chunks first, ahead of up to `KB_CHUNKS_FOR_DETAIL` ranked extracts. None, several, an
  unpublished or a non-Finder sheet attaches nothing; a failed read loses only the sheet.
- `src/agents/finder/prompt.ts`: the fact sheet is the authority over older sales-kit text and
  the write-up; a "not confirmed (under review)" cell is reported as being confirmed.

### Live writes (approved 2026-10-27)

- Projects: `add-client-workbook-projects.ts --apply --expect-plan a632ff54…` created
  `lYok7RdyP2P2PUZCIpX2` Binastra Cochrane, `k3e1jzoxD0byzkzsAWYi` Lagenda Tunku (Villa Gemilang)
  and `14k1U1AbW4O0RHKmPRzn` Ashbourne; each re-read matched (`NEW-PROJECTS-APPLY.md`).
- Fact sheets: `ingest-client-factsheets.ts --manifest new-projects/factsheets/index.json --apply
  --expect-plan c8ad9228…` created 3 (1, 1 and 2 chunks); audit rows expected 3, found 3.
- Undo = delete those 3 project documents and 3 kbDocs (a delete; needs explicit approval).

## Verification

### Read-only checks after the writes

- The 3 projects read back active, Freehold, price unknown, bumiQuota/foreignEligible false,
  vpStatus false, 1024-d embedding; Ashbourne carries its 8 layouts (1,491-2,661 sf). Each has
  exactly one published Finder fact sheet with published, vector-typed chunks.
- Fact-sheet dry-run on the new manifest after apply: 3 unchanged. Live: 90 projects, 86 active.

### Tests

- `npx tsc --noEmit`: exit 0. `eslint` on every changed file: exit 0.
- `npx vitest run`: 1614 passed, 223 skipped. The one failing file is
  `tests/finder-corpus-gates.test.ts`, which needs the gitignored `projects.inventory.json` and
  fails the same way without this change.
- New: 8 in `project-detail.test.ts` (sheet attached when search misses it, order, de-dupe, cap,
  none/duplicate/unpublished/non-Finder ignored, read failure degrades, title helper, prompt
  rule) and 7 in `client-workbook-new.test.ts` (run on the real build output).

### Chat re-test, run 3 (script-driven, 2026-10-27)

The user could not get the Browser pane to attach and I do not type passwords into a sign-in
that goes to Firebase Auth, so at the user's choice the re-test drove the real Finder loop from a
script (`retest/run3.ts`): the route's system prompt, tools, PDPA scrubbing, 12-step budget and
32k output, model `gemini-3.5-flash` through `modelFor` + `LOCAL_MODEL_OVERRIDE`, as runs 1-2.
It skips the chat UI and the route's auth/rate-limit layers. 89 prompts, 0 errors, all `stop`.

- Scored field by field against the Excel (`retest/score3.js`, then every flag read by hand,
  `retest/overrides.json`). The scorer was checked against a deliberately corrupted answer
  (wrong land title, fee and layout price/size, missing units): all 5 caught.
- **80 of 83 properties match the Excel in every field**; 538 field cells PASS, 2 DIFFERS, 1
  PARTIAL, 8 HELD (held-back values). The fact sheet was attached on 82 of 83 lookups (Exsim
  Project has none: no facts in the Excel).
- Not matching: Eaton (led with an older kit's 632 units over the Excel's 960, with the sheet in
  context), Yanu Hills (bot says Selangor; the Excel says KL but its own land title says Selangor),
  The Lantern (bot labels the 570 sf layout A1 and adds an A2; known 096 near-duplicate).
- Search cases: F9, F5, N2 unchanged and Pass; F1 and F13 unchanged and still need Derek's ruling;
  F11 changed: it now returns the new Binastra Cochrane (Cheras, unpriced, admitted by the 085
  unpriced rule) with a note to confirm price and bedrooms. Needs a ruling.
- Report: `docs/UAT-Field-Check-Retest-2026-10-27-run3.xlsx` (not committed, like runs 1-2).

### Regression surface

- `projectDetail` is the only caller of the fact-sheet read. 83 live detail lookups ran with no
  tool failure; the ranked extracts still follow the sheet (quick-100 scoping unchanged; its 5
  tests pass).
- `searchProjects` is untouched: F9/F5/F1/N2/F13 return exactly run 2's sets. F11's change is
  the new data, not code.
- `ingest-client-factsheets.ts`: the default manifest still reports into the 096 directory
  (`dirname(dirname(manifest))`); the 096 directory has no changes in `git status`.
- `loadFactSheets` title check now goes through `clientFactSheetTitle`; identical string; 80 + 3
  sheets loaded and verified.
- Ruled out: the Coach and Reply pillars (no shared code changed); the client UI (no app/ change).

### Open items for the client and Derek

- Eaton total units (632 vs 960), Yanu Hills area (KL vs Selangor), Lantern Type A / A1 / A2.
- The Developer column offset (rows 91-93, 114-125) is still in the new Excel.
- Whether unpriced projects should appear for budgeted leads (F11), D-014 (F1), F13 source rule.
- 23 held-back values (`HELD-BACK.md`).
- Security: the shared admin test account on the live project has a weak password; rotate it
  after testing (raised with the user in chat, not recorded here).
