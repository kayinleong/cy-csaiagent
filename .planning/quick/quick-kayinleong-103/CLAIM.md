# Claim: quick-kayinleong-103
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-103
- started: 2026-11-06
- status: done
- summary: Finder result presentation. The table no longer cuts off names and locations. Projects that only sit around the requested area are labelled as nearby alternatives. A project's details read like its Skool page, with the PIC, the WhatsApp group link and the project and marketing links.

## What will change
Three reports from the user, all on the Finder result surface. Example query: "i just need damansara height projects".

1. **Text cut off.** `app/[lang]/chat/match-table.tsx` truncates Name, Location and Highlight to one line with an ellipsis ("The Cedar Damansara H…"). The cells will wrap instead, so the full text shows.
2. **Nearby projects shown as if they were in the area.** The DH search returns 6 projects. Two of them are in another area: One Eleven Menerung @ Bangsar ("Bangsar, between BSC & Pavilion Damansara Heights, …") and Majestic @ Kiara Reserve ("Mont Kiara / Damansara Heights, …").
   - `src/inventory/search.ts` will mark each location match `in_area` or `nearby`. It is `in_area` when the area is in the project name or in the first part of its address, otherwise `nearby`. In-area projects rank first.
   - The table will show the nearby ones under "Other projects around <area>".
   - `src/agents/finder/prompt.ts` will tell the model to present them the same way and never call them in the area.
3. **Details in the Skool quick-facts format.**
   - The projectDetail answer will follow the Skool layout: Quick Facts, Built-Up Sizes & Layouts, prices and fees, Facilities.
   - Below it, a server-attached project sheet shows the PIC / project leaders, the WhatsApp group link, and the project and marketing links. These are parsed from the stored write-up and the collateral records, never typed out by the model.
   - A Copy button lets the agent paste everything into WhatsApp.

## What has changed
Commit 21d5aea.

**1. Full text in the table**
- `app/[lang]/chat/match-table.tsx`: Name, Location and Highlight wrap (`whitespace-normal break-words`) inside a min/max width instead of `truncate`. The Name column stays sticky, with a 1px edge so scrolled cells visibly slide under it.

**2. Nearby projects labelled**
- `src/inventory/search.ts`:
  - New `projectLocationMatch(doc, needles)` → `'in_area' | 'nearby'`. It is `in_area` when the area is in the project name or its own address: the gate's address clauses, with "between …" also opening a proximity run. In a slash pair only the first name counts, unless the clause ends in area / district / region ("KLCC/Bukit Bintang area" counts for both).
  - The gate's clause splitting moved into `splitAddressClauses`, unchanged.
  - When a location was applied, in-area matches rank first (stable). Each match carries `locationMatch`, and a nearby match's `matchedCriteria.locationPref` is null.
- `src/agents/finder/schema.ts`: `FinderRow` gains optional `locationMatch` and `locationArea`. `toFinderRow` in `tools.ts` fills them from the search input.
- `match-table.tsx`: `groupHeadingBefore` puts "Other projects around {area}" above the first nearby row on a page, and "In {area}" on top when both groups exist. Strings are in EN / BM / 中文.
- `src/agents/finder/prompt.ts`: a "locationMatch nearby" rule. Present nearby matches after the in-area ones, as "other projects around <area>", never as in the area. "around" is the only proximity wording allowed, and still no distances.

**3. Skool-style project details**
- `src/agents/finder/project-sheet.ts` (new, pure) parses the write-up and collateral:
  - `extractWhatsappGroupUrl`: the group invite, without its query string.
  - `extractProjectContacts` / `cleanContactName`: PIC / leader / co-leader names only. Links, brackets, phone numbers and digits are stripped.
  - `sheetLinks`: the curated (non-`whatsapp-media`) collateral, grouped project vs marketing, capped at 12.
  - `buildProjectSheet`.
- `schema.ts`: `ProjectSheetSchema`, and `FinderOutput.projectSheets` (optional, max 3).
- `tools.ts`:
  - `collateralFor` is split into `readCollateral` + `rankAndCapForModel`, with the same result for the model.
  - projectDetail records a sheet in the request sink (`FinderRowSink.sheets`, `recordProjectSheet`). The model never sees it.
  - `index.ts` passes the sink.
- `app/api/chat/route.ts`: the sheets go on `messageMetadata.projectSheets`, and into the persisted envelope of an `answer` (`attachProjectSheets` in `decode-structured-output.ts`).
- `decode-stream-chunk.ts` validates the sheets item by item, and `chat-input.tsx` attaches them.
- `app/[lang]/chat/project-sheet.tsx` (new) has three parts:
  - The PIC / leaders and the WhatsApp group (with the Skool "only join if marketing" note) above the answer.
  - The project links and marketing materials below it.
  - "Copy to share". It copies the answer as WhatsApp text (bold, bullets, tables turned into lines, KB citations dropped) plus the links. It leaves out the PIC and the group invite, which are internal.
- `match-list.tsx`: the answer branch renders it.
- `prompt.ts`:
  - A details answer uses the Skool layout: Quick Facts / Built-Up Sizes & Layouts / Prices & Fees / Facilities, bullets not tables, one bullet per layout.
  - It never writes the PIC, the group link or any document link.
- Tests:
  - `src/inventory/search.test.ts`: 5 new.
  - `src/agents/finder/project-sheet.test.ts`: 26 new.
  - `app/[lang]/chat/project-sheet.test.ts`: 19 new.
  - 4 existing tests updated for intended changes: the table's truncate classes (2), the 12-key row allowlist (now 14), and the route's sink shape.

## Verification
**Live data checked first (read-only, 2026-11-06, 86 active projects).**
- The DH search returns 6. Two of them: "One Eleven Menerung @ Bangsar" ("Bangsar, between BSC & Pavilion Damansara Heights, …") and "Majestic @ Kiara Reserve" ("Mont Kiara / Damansara Heights, …").
- The tier rule was run over 34 area searches against every live project. Only border cases come out nearby:
  - DH: One Eleven, Majestic.
  - Mont Kiara: Miranda Hill ("North Kiara/Mont Kiara").
  - Bukit Bintang: Quill, TRX Residences.
  - Mid Valley: Aspire ("Bangsar / Mid Valley fringe").
  - Pavilion: One Eleven.
- A first version also flagged "KLCC/Bukit Bintang area" projects and landmark-first addresses (PSQ, Golden Crown). The rule was fixed before commit, and both cases have tests.
- Write-ups: 72 have a WhatsApp link line, and 70 have a PIC / leader line, many with a personal phone number or wa.me link. The Skool links are the non-`whatsapp-media` collateral (project-info, fb-ads, reels, drone-footage, demand-gen, showroom-video, drive, google-doc).

**Tests.**
- `npx vitest run`: 1671 passed, 223 skipped.
  - 1 suite failed, and it was already failing: `tests/finder-corpus-gates.test.ts` needs the gitignored `projects.inventory.json`.
- `npx tsc --noEmit -p tsconfig.typecheck.json`: clean.
- `eslint` on the changed files: 0 errors. The warnings are the test files' existing `_args` mock pattern.

**Browser.** A temporary fixture page rendered the real `MatchList` with the 6 DH rows and a DC Residensi answer plus sheet. The page was not committed and was moved out of the repo afterwards.
- Full names and locations wrap. "In Damansara Heights" and "Other projects around Damansara Heights" headings show.
- PIC / co-leader / WhatsApp group appear above the quick facts, with the links below.
- At a 375px container the pinned name column wraps and the table scrolls in its own strip.
- Links first rendered lime on cream (`text-primary`), which was hard to read. They now use the chat markdown link style.
- "Copy to share" put WhatsApp-formatted text with the links on the clipboard and showed the toast. No console warnings.

**Real agent (claude-sonnet-4-6, the live model).** Same prompt, tools and step cap as the route, read-only.
- "i just need damansara height projects": the rows came back in_area ×4, then One Eleven and Majestic as nearby. The model's shortlist kept to the 4 in-area projects.
- "Full details for Damansara City Residency (DC Residensi) …": projectDetail by name. The sheet had a PIC (no digits), the WhatsApp invite, 1 project link and 4 marketing links. The answer followed the Skool layout and wrote no contact name and no URL.
  - Runs 1–2 drew the layouts as a markdown table. The unitTypes rule ("the per-layout table") was reworded to one bullet per layout.
  - Run 3 gives one bullet per layout and groups the sold-out ones. The copy text also turns any table into lines as a fallback.
- About 70k tokens in total across the 4 runs.

## Regression report
- **Location gate.** `locationHaystack` gives the same output (the code moved into `splitAddressClauses`). All 55 existing search tests pass, including the proximity-run cases from 050/085/098. Tiering never removes a project.
- **Ranking.** Changes only when a location was applied, and then only puts in-area first. Without a location, no `locationMatch` is set and the order is unchanged (test).
- **matchedCriteria.** A nearby match now has `locationPref: null`, so the MatchCard fallback shows no "location" badge for it. That is deliberate.
- **Collateral.** `fetchCollateral` and searchProjects' inline collateral still go through `collateralFor`, now `readCollateral` + rank/cap, with the same output. projectDetail hands the model the same ranked top 12 as before. All collateral tests pass.
- **Persisted turns.**
  - `projectSheets`, `locationMatch` and `locationArea` are optional, so older envelopes decode unchanged.
  - An answer with sheets is now stored as the decoded and re-serialized envelope, as matches already were. An answer without sheets is stored as before.
- **Answer branch.** With no sheets it renders the markdown alone, as before. The container is now a flex column, which has no visual effect with one child.
- **Copy.** It never includes the PIC, the group invite or KB citations (test).
- **PDPA.** Phone numbers and wa.me links in contact lines are stripped at parse time (13 formats tested), and names only reach the client. Nothing new is logged. The description was already in the model's projectDetail input.

## Known limitations
- The PIC / leader is shown by name only. If agents need the phone number shown, that is a separate decision.
- A write-up whose WhatsApp group is a hyperlink with non-URL text ("Click here") lost the URL at scrape time, so no group link shows. About 14 of 72 cases.
- The tier rule is text-based. "TRX Residences" (KLCC/Bukit Bintang, no "area") counts as nearby for Bukit Bintang.
- The model's narrative (rationale) is not rendered when the table is shown. So "other projects around DH" reaches the agent through the table heading.
- Not yet deployed. The live site keeps the old behaviour until this branch is merged and rolled out.
