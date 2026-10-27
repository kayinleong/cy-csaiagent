# Claim: quick-kayinleong-101
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-101
- started: 2026-10-27
- status: claimed
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
