# Claim: quick-kayinleong-107
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-107 (from quick-kayinleong-106 73d7553, not yet merged)
- started: 2026-11-25
- status: done
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

### Part B: server-built Details per listed project (executor, then orchestrator fixes; c55e69a)
- **`src/inventory/project-details.ts`** (new). `buildProjectDetails(doc)` builds the Details-page sections from stored data:
  - **Quick Facts:** `clientFacts` first, as the authority, then the write-up's fact lines for any fact the sheet doesn't state. Label synonyms include a bare "Title", "No. of Units", "Completion Date" and "VP".
  - **Prices & Fees:** from price, psf rate, maintenance fee, and the write-up's price section.
  - **The write-up's other sections,** in source order.
  - **Top Reasons Why:** the sheet's reasons first.
  - **D2 focus lists.**
- **Dropped from the build:**
  - sales/marketing-resource blocks and "Click the links" lines;
  - contact lines;
  - anything the contact scanner flags: on the real corpus, a bare domain and a bank account number;
  - client/buyer/agent record sections. The Oval's "Client name" and Le Nouvel's "Client" were buyer-profile notes;
  - write-up layout sections, when `unitTypes` covers them.
- **Caps:** 14 sections, 30 items, 300 chars per value (clipped at a word boundary), 7,000 chars per project.
- **Data path:** `search.ts` (top 8 only) → `tools.ts` (the model view strips `details` and `layouts`) → schema `MatchSummary.sections` (optional, so old turns decode) → attach/parse.
- **Layouts:** all layouts, capped at 40.
- **UI (`match-summaries.tsx`):** Best for and Key selling points on top, then a "Full details" block, open by default with a Hide/Show toggle (aria-expanded). Order: Quick Facts, Built-Up Sizes & Layouts (sold out grouped, never priced), Prices & Fees, other sections, Top Reasons Why, D2 focus lists. EN/BM/ZH labels; write-up text shown as stored.
- **`match-list.tsx`:** a stray `answer` note beside matches is shown above the table instead of replacing it. A real run returned both, and before this fix it showed no table.
- **Prompt:** the Summary section says the system shows the full details, so the two AI lines stay short.

## Verification
- **Corpus** (all 90 live projects, fresh export with `clientFacts`):
  - 88 produce sections; median 1,335 chars, max 4,559.
  - 0 contact-scan hits on every built label, value and title; 0 "RM 0".
  - 73 of 83 show the sheet's developer, with no duplicate write-up Developer line.
- **Real Finder** (claude-sonnet-4-6, live data, route-equivalent PDPA) on the reported Damansara Heights message: 45 s, 16k input / 2.1k output tokens, the same as before (the details never reach the model). 7 rows, 7 matches, each with Best for and selling points, and 7 summaries with 6–14 sections each.
- **Rendered preview:** the real MatchList (table plus details) with the built CSS, served locally and checked at 375 px:
  - state "matches";
  - 7 Full details blocks with toggles open;
  - 65 sections;
  - no horizontal scroll;
  - no FIN_HASH, "RM 0" or links.
  - Screenshot checked.
- **Tests:**
  - `vitest --maxWorkers=4`: 1846 passed. One Reply test timed out under machine load (load average about 17); it passes alone, 16 of 16. `finder-corpus-gates` needs the gitignored Skool payload, as before.
  - `tsc` clean.
  - `eslint`: 0 errors.
  - `next build` OK.

## Regression report
- **Model view.** It is unchanged in size: `details` and `layouts` are stripped, so input tokens stayed about 16k.
- **Rows.** The FinderRow 14-key allowlist and the route are unchanged.
- **Old turns.** Older persisted turns without `sections` decode and render as before (test).
- **Answer-only replies.** A conversational answer with no matches still renders as an answer (test).
- **Import.** The planner tests pass, a new project carries `clientFacts` (test updated), and a repeat dry run against live plans 0 changes.

## Known limitations
- **Not deployed.** The code is on quick-kayinleong-107, which is built on quick-kayinleong-106; neither is merged. `clientFacts` is already live data.
- **Long on mobile.** With 7 projects the page is about 15,000 px tall on a phone. Each block can be hidden.
- **No sales-kit extracts.** The server-built Details carry no knowledge-base sales-kit extracts and no AI rewording; the Details button still gives the AI version.
- **Write-up text is not translated.** Write-up headings and values show as stored, often in English; only fixed labels are translated.
- **Sub-headings become sections.** A write-up sub-heading becomes its own small section (Bangsar Hill Park's facility phases), and one emoji line repeated a heading.
- **The browser receives the raw search output.** It now includes details of up to about 7 KB per project for the top 8; the details are cleaned.

## Verification
(pending)
