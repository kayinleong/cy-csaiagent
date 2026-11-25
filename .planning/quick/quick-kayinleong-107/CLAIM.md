# Claim: quick-kayinleong-107
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-107 (from quick-kayinleong-106 73d7553, not yet merged)
- started: 2026-11-25
- status: in-progress
- summary: Each project in the Finder's list under the table shows the full Details-page information, built by the server from the stored record and the D2 sheet, with the AI "Best for" and "Key selling points" lines kept on top.

## What will change
The client wants "all information", not only the quick-facts summary of claim 106.
- The user chose "Same as Details page", then "Server-built Details", once shown the measured cost of the AI version: one Details answer is about 19,600 tokens and 36 s, so 7 per search would use about 137k of an agent's 300k daily cap.
- Each listed project shows the Details sections (Quick Facts, Built-Up Sizes & Layouts, Prices & Fees, Facilities and the other write-up sections, plus the D2 sheet's furnishing, car park and top reasons), filled from stored data.
- No extra model call.
- Contact details are never shown.

## What has changed
### Part A: D2 sheet facts on each project (orchestrator)
- **8c58481, planner rule R8c** (`src/inventory/client-workbook.ts`). The sheet's project-level facts go to a new `clientFacts` field: area, developer, land title, tenure, maintenance fee, units, storeys, completion, top reasons, furnishing and car park, plus the focus lists.
  - They are merged over the stored object, so a blank cell never clears a fact (D4).
  - The focus lists follow Sheet1 exactly.
  - The field is marked as a sheet field and is not embedded.
  - The report lists the fact keys, not the values.
  - Type `ClientFacts` in `src/firebase/collections.ts`. Six planner tests.
- **f65c9bd:** the read-only export now carries `area` and `clientFacts`.
- **Applied live** (the user approved fingerprint `53a8fdba…`; `IMPORT-APPLY.md`): 83 written, 83 re-read, 83 audit rows, 0 re-embedded. Exsim has no sheet facts.
  - Backup: `quick-kayinleong-096/backups/2026-11-25T03-24-37-528Z` (gitignored).
  - A repeat dry run plans 0 changes.

### Part B: server-built Details per listed project (executor)
(in progress)

## Verification
(pending)
