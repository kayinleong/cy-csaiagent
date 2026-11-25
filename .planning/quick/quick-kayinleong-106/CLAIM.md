# Claim: quick-kayinleong-106
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-106 (from origin/main 901319f, after PR 55 merged 104 + 105)
- started: 2026-11-25
- status: done
- summary: Finder shows each project's quick facts with the matches table; Damansara Heights' nearby set includes the priced Bangsar projects; "RM1.5mil-RM2.5mil" reaches the Finder as a budget, not a FIN_HASH token; the 25 Nov client workbook (_D2 Project Info.xlsx, sha256 d7e46d3c…) is imported.

## What will change
Four items from the user (2026-11-25). Everything is tested locally before any deploy, because Firebase deploys are costly.

1. **Quick facts with the table.** The user chose the hybrid design (RESEARCH-quickfacts.md):
   - "Layouts & sizing" is built by the server from `unitTypes`.
   - "Best for" and "Key selling points" are written by the model, only from the cleaned Quick Facts excerpt of each shortlisted project.
2. **Nearby set for Damansara Heights.** The user chose "Bangsar, with a price", adding: "sometimes the price also comes from other fields, so also check other fields when querying".
3. **Budget written as "RM1.5mil-RM2.5mil".** The user chose "Finder reads budgets" (RESEARCH-budget.md option b).
4. **25 Nov workbook.** Diff, dry-run, then apply once the user approves.

Waves:
- **Wave 0:** the workbook (orchestrator).
- **Wave 1, in parallel:**
  - the nearby/price gate (orchestrator: `search.ts`, `prompt.ts`);
  - the budget/PDPA work (executor: `src/audit`, `route.ts`, chat display).
- **Wave 2:** the quick-facts summaries (one executor). It touches `search.ts`, `route.ts`, `chat-input.tsx` and `prompt.ts`, so it runs after wave 1.

## What has changed

### Workbook (applied live, 2026-11-25)
**Builder** (685c086: `quick-kayinleong-096/build-client-sheet.py`, `wbparse.py`, `verify-client-sheet.py`). The 25 Nov sheet stopped it at:
- **Car park per layout.** "Car Park Allocation" is listed per layout (Lunar Seputeh, Sentral Suites). The values are joined onto the project row, and a bare count keeps its unit label.
- **Missing first heading.** Sheet1 lost its first heading (A1 is blank). The new `--sheet1-untitled-heading` flag names it. The six names under it are the same as on 21 Nov.
- **Labels.**
  - "Type B/B1" and "Type C2/C2A" keep their alternates.
  - "Type A corner" and "Type C corner" are their own layouts. Before, they collided with "Type A" and "Type C".
- **Sold out in the Size cell.** "(sold out)" written there now marks the layout sold out (Sentral Suites C, C corner and D).
- **Verifier:** 110 parser cases plus 6 new gates.

**Import planner** (8e3322a: `src/inventory/client-workbook.ts`, U2b). A renamed layout matches the stored one instead of being listed twice: Lunar Seputeh's sheet "Type B/B1" is the stored "Type B1 / B1A" (841 sqft, 2 bedrooms, shared code B1). Combined "&" layouts and ties are left alone.

**Build** (`build/`):
- 84 projects. 78 are identical to the 21 Nov build.
- Changed:
  - Lunar Seputeh: 6 priced layouts, area "9 Seputeh", car park, furnishing, fee, top reasons.
  - Sentral Suites: 7 layouts, 3 of them sold out, no prices.
  - Tria Seputeh: area "9 Seputeh", land title.
  - Southpoint: the top reasons are now numbered.
  - OAKA: completion Q1 2028 → Q2 2027, car park, furnishing, top reasons.
  - Rimbun Saujana: units and floors.
- Sheet1 column H, a new list of 53 existing project names with no heading, is ignored. The builder reads column A only.

**Applied** (the user approved both fingerprints):
- **Projects** (`IMPORT-APPLY.md`, fingerprint `866b7fcb…`): 3 written, 3 re-read, 3 audit rows, 1 re-embedded (0 failed). Backup: `quick-kayinleong-096/backups/2026-11-25T01-48-50-075Z/` (gitignored).
- **Fact sheets** (`build/FACTSHEETS-APPLY.md`, fingerprint `a6067f45…`): 83 updated, 83 of 83 audit rows. 6 have new content; 77 change only the source date.

### Nearby and price fields (50b267f: `src/inventory/search.ts`, `src/agents/finder/prompt.ts`)
- **Neighbour map.** `AREA_NEIGHBOURS` lists Damansara Heights → Bangsar, one way. A Bangsar project passes the same address-only gate and is always classified `nearby`.
- **Price from other fields.** `projectPriceRange` reads, in order: the from price, then priced layouts, then psf rate × size range. Rates under RM100 psf are ignored, since those are maintenance fees. The budget gate uses it. An estimate never claims `matchedCriteria.priceMax`.
- **Nearby rows need a price.** With a budget, a nearby project shows only when some price is on record. The in-area unknown-price rule (085 D2) is unchanged.
- **Prompt.**
  - The nearby definition now names the neighbour list.
  - A psf-estimated match is quoted by its rate, never as a computed total.

### Budget masking (7a3874d: `src/audit/pdpa.ts`, `scrub.ts`, `route.ts`, chat display)
- **Regex.** `FINANCIAL_REGEX` is case-insensitive and takes the whole figure, so "RM1.5MIL" no longer leaks ".5MIL". This applies to all pillars.
- **Finder turns.**
  - They are pseudonymized again with `financial: 'non-budget'`, and that result is gated before it goes to the model.
  - Income, loan and bank figures stay masked: an income cue before the figure or a per-month marker after it, in EN/BM/ZH.
  - Reply, Coach, the strict audit path and the router input are unchanged.
- **Display.** `scrubPdpaTokens` keeps a raw token from ever being shown, live or on reload (`chat.hiddenAmount` in EN/BM/ZH).
- **Prompt.** Hidden amounts are never repeated or guessed.

### Quick-facts summaries (88aac94; executor report in `SUMMARY-quickfacts.md`)
- **`src/inventory/quick-facts.ts`** (new):
  - `quickFactsExcerpt` starts at the "Quick Facts" heading and drops every line with a link, a phone number, an e-mail, WhatsApp or a PIC/leader/contact label. It caps at 700 chars. A write-up with no heading gives '' (5 of 86).
  - `summaryLayouts` puts available layouts first, then the requested bedroom count, and caps at 6. Sold-out layouts are never priced.
  - The contact patterns moved here from `project-sheet.ts`, so `src/inventory` never imports `src/agents`.
- **`search.ts`:** `ProjectMatch.quickFacts` / `layouts` are set for the top `MAX_MATCHES` (8) only. The raw description never goes on a match.
- **`tools.ts`:**
  - `toModelOutput` keeps `quickFacts` and strips `layouts`.
  - The sink carries `summaries`, one per top row that has layouts.
- **Schema:**
  - `bestFor` (140) and `sellingPoints` (260) are optional, never fail a match, and are clipped at a word boundary with "…".
  - New `FinderOutput.summaries`.
- **Wiring:**
  - `attachSummaries` (server truth wins; every server summary is kept, also for a top row the model left out).
  - `parseMessageMetadata`.
  - `route.ts`: the sink, the persisted envelope and messageMetadata.
  - `chat-input.tsx`.
- **UI:**
  - New `match-summaries.tsx` under `MatchTable`: a numbered list in table order, with the in-area / around headings.
  - Each entry has Best for, Layouts & sizing, Sold out, Key selling points and Details.
  - EN/BM/ZH keys.
- **Prompt:**
  - **Summary section.** The two fields come from quickFacts only: no layouts, sizes, prices, psf, fees, budget fit, collateral, or yield claims the text doesn't make.
  - **One match per project shown** (was "the strongest handful").
  - **A search result is ALWAYS the matches JSON.**

## Verification (waves 0–1)
- **Builder verifier:** P (110 cases), S and J pass. The self-test catches 8 of 8 injected defects. G fails by design: it pins the 19 Oct workbook hash.
- **Contact-detail scan** of every file in this claim dir: no contact details. Two hits were inspected: the word "wa.me" as a term, and the synthetic IC example quoted from `04-RESEARCH.md`, now masked.
- **Planner regression.** The applied 21 Nov build was re-planned against live with the new planner: 0 changes, and no renamed-layout matches.
- **Location/price gates, live and read-only, main vs this branch** (300 searches: area × 5 budgets):
  - 240 unchanged.
  - The Damansara Heights searches only gain Bangsar-area rows.
  - Every other change is a psf-only project leaving a budget its estimate is outside. Examples: AT6 at about RM3.6–4.5M leaves "≤RM1M"; Pinnacle at about RM4.4M+ leaves "≤RM1M"; The Atera at about RM0.6–1.2M leaves "RM1.5–2.5M".
  - No priced project changed.
- **Real `searchProjects`, live, RM1.5M–2.5M, Damansara Heights:**
  - in the area: Pavilion DH, Royal Suites, DC Residensi;
  - around it: One Eleven, Bangsar Hill Park, Parkside, The Lantern (psf estimate RM785k–1.53M). Residensi 38 (estimate up to RM1.40M) and Pinnacle (RM4.4M+) are out.
- **Tests:**
  - `vitest` over `src/inventory`, `src/agents/finder`, `src/audit`, `app/api/chat` and `app/[lang]/chat`: 922 passed. One run had a single failure that did not reproduce in two re-runs; claim 105 saw the same `project-detail.test.ts` timeout under parallel load.
  - `tsc` clean.
  - `eslint`: 0 errors.

## Verification (wave 2 and end to end)
- **Real Finder** (claude-sonnet-4-6 from `appConfig/modelConfig`, this branch's code, live data). The scratch harness mirrors the route for a Finder turn: strict pseudonymize + gate, then the non-budget pass + gate, then the real tools.
  - **The reported message** ("…under damansara height… budget around RM1.5MIL TO RM2.5MI 2 OR 3 BEDROOM IDEALLY").
    - The strict view still shows `<FIN_HASH>` tokens. The Finder view keeps the budget.
    - searchProjects ran with priceMin 1,500,000, priceMax 2,500,000 and locationPref "Damansara Heights".
    - 7 rows: DC Residensi, Pavilion DH and Royal Suites in the area; One Eleven, Bangsar Hill Park, Parkside and The Lantern around it.
  - **Two turns,** "…2 or 3 bedroom in damansara heights and nearby areas…" then "RM1.5mil-RM2.5mil":
    - turn 2 searched RM1.5M–2.5M;
    - no `<FIN_HASH` in either reply.
  - **JSON reliability on the reported message.**
    - With main's prompt, 1 of 3 runs came back as markdown, which shows no table.
    - With this branch's first prompt, 2 of 3 came back as markdown.
    - With the final prompt, 8 of 8 decoded: 6 runs of the two single-turn prompts and 2 conversation turns.
    - Runs returned 3 or 7 matches; every match carried bestFor and sellingPoints.
    - Lines were grounded in quick facts, e.g. "GuocoLand, completed 2017, integrated with DC Mall and Sofitel KL Damansara, freehold, 370 units".
    - Turn time was 32–52 s (7 matches, about 2.2k output tokens), within the route's 90 s maxDuration.
- **Tests:**
  - `npx vitest run`: 1812 passed, 223 skipped. The only failure is `tests/finder-corpus-gates.test.ts`, which needs the gitignored Skool-scrape `projects.inventory.json`; it failed before this claim too.
  - `tsc --noEmit` clean.
  - `eslint` on every changed file: 0 errors (the warnings are pre-existing `_args` / unused vars in test mocks).
  - `next build` succeeded.

## Regression report
- **Location/price gates.** See the 300-search live diff above.
  - The neighbour map changes only searches whose phrase is "damansara height".
  - The price-field fallback only removes psf-only projects whose estimate is outside the budget.
  - No priced project's result changes, and no row moves between in_area and nearby.
- **PDPA.**
  - The strict GATE 3 path is byte-identical for every pillar.
  - The route tests prove that Reply, Coach and a Finder income line still send `<FIN_HASH:`, and that `assertRedacted` runs before streamText on both passes.
  - The 12 original pdpa tests still pass.
  - The router input is unchanged (see Known limitations).
- **Finder result table.**
  - The 14-key FinderRow allowlist and its test are unchanged.
  - The model view stays under 8 KB for 60 rows.
  - Older persisted turns without `summaries` or `bestFor` decode as before (test).
- **Import.** The applied 21 Nov build re-plans to 0 changes with the new planner.

## Known limitations
- **Not deployed.** Data is live; the code needs merge + an App Hosting rollout.
- **UI not checked in a browser.** The chat needs a signed-in session. The summary block is verified by a `renderToStaticMarkup` test (headings, numbering, sold-out line, no price on sold out) and the build.
- **Non-bumi clients lose bumi-quota projects.** `searchProjects` drops every `bumiQuota: true` project for a buyer with `bumiputera: false`. One Eleven and Bangsar Hill Park are bumi-quota, so a "Malaysian Chinese, non-Bumi" client never sees them, in Bangsar or anywhere. This is pre-existing. It is right only if `bumiQuota` means bumi-only; if it means "has a bumi share", the gate hides most new launches from non-bumi buyers. Needs a decision from Derek.
- **The router sends raw text to Claude.** The router's LLM classifier receives the RAW messages (`app/api/chat/route.ts` routeAsync → `src/router/classifier.ts`), so names, IC numbers, phones and emails can reach the model on an ambiguous turn. This is pre-existing (RESEARCH-budget.md). Separate claim.
- **The browser gets raw tool output.** The AI SDK streams raw tool outputs to the browser, so projectDetail's full description, PIC phone numbers included, reaches the client (RESEARCH-quickfacts.md). This is pre-existing. Separate claim.
- **Prompt adherence on figures.** Some sellingPoints still quote a size range or maintenance fee from the quick facts despite the rule. They are grounded facts, not budget-fit claims; the rationale (not shown in table mode) can still mention "larger layouts reaching the budget".
- **The Lantern makes 4 Bangsar projects.** At RM1.5M–2.5M it qualifies on its psf estimate (RM1,400 psf × up to 1,092 sqft ≈ RM1.53M), so there are 4 Bangsar projects, not the 3 the user expected.
- **Held-back workbook values.** 2 `=AI(...)` formula cells and the existing psf-only gross cells are listed in `build/HELD-BACK.md`. Sentral Suites' Tenure / Total Units / Floors columns are shifted in the sheet ("1,434 units" under Tenure) and are held.
