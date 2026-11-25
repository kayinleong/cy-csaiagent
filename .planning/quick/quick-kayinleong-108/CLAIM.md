# Claim: quick-kayinleong-108
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-108 (from origin/main a755215, after PR 56 merged 106 + 107)
- started: 2026-11-25
- status: done
- summary: Finder layout per the client: recommended table, then each recommended project's quick facts, then the nearby table and its quick facts. The table's Details button opens an inline, collapsible dropdown of the server-built details instead of asking the AI.

## What will change
The user's answers (2026-11-25):
1. **Layout.** The table of recommended (in-area) projects comes first, with no detail blocks under it. Then a numbered Quick Facts block per recommended project, in the database's Quick Facts format, keeping the AI "Best for" and "Key selling points" lines. Then the nearby table ("Other projects around <area>") and the nearby projects' quick facts. With no location there is one table plus its quick facts.
2. **Details button.** It opens a dropdown under that row with the project's server-built details (claim 107). The dropdown collapses again. It no longer sends a new AI turn. A row with no details on record (an older saved turn) keeps the old AI behaviour.

## What has changed
f40f36c (executor report in `SUMMARY-layout.md`):
- **`match-list.tsx`:** new `MatchGroups`.
  - The recommended table comes first: in-area rows, or every row when no location was applied.
  - Then `QuickFactsList`, then the nearby heading, the nearby table and its `QuickFactsList`.
  - The in-table group heading rows are gone.
- **`match-summaries.tsx`:** `QuickFactsList` replaces the full-details list.
  - Numbered blocks per group, at most 10, with a translated "rest under Details" line after that.
  - Each block: Best for, Key selling points, then one "Label: value" line per quick fact, from the server-built quickFacts section (the D2 sheet first).
  - `ProjectDetailsPanel` is the 107 renderer without its header.
- **`match-table.tsx`:** Details opens a full-width `match-table-details` row under its row.
  - The button reads "Details" / "Hide details" and carries aria-expanded. Several rows can be open at once.
  - It never calls `onAsk`; a row with no server details keeps the AI turn.
  - The panel is `sticky left-0 w-[100cqw]` inside an `@container` wrapper, so it stays within the visible width of the sideways-scrolling table.
- **`search.ts` mapper / `tools.ts`:** layouts and details are built for EVERY row. The model's `quickFacts` excerpt still goes to the top 8 only, and the model view still strips layouts and details.
- **Caps:** the `summaries` cap goes from 8 to 100 in the schema and in `attachSummaries`.
- **Prompt:** the Summary section names the quick facts and the Details dropdown.
- **i18n:** four new keys in EN/BM/ZH.

## Verification
- **Real Finder** (claude-sonnet-4-6, live data, route-equivalent PDPA) on the reported Damansara Heights message: 38 s, 16k input / 1.9k output tokens. 7 rows, 7 matches, 7 summaries.
- **Interactive preview.** The real `MatchList` was bundled with esbuild, given that run's output and the built CSS, and driven in the preview browser at 375 px:
  - **Order:** recommended table (3) → quick facts (3 blocks) → nearby table (4) → quick facts (4 blocks).
  - **Opening:** Details opens the dropdown, the button becomes "Hide details" with aria-expanded="true", and the AI is never asked.
  - **Pinned:** the panel stays at 28–347 px inside the table's 16–359 px box at both ends of the table's sideways scroll (scrollWidth 869 vs 343). The page never scrolls sideways.
  - **Content:** 7 sections in the panel.
  - **Collapsing:** clicking again closes it.
  - Screenshots checked.
- **Size:** all 86 active projects' summaries come to 281,509 bytes; at most 8,440 bytes per project. The worst case (100 rows) is about 0.33 MB per persisted turn, under Firestore's 1 MB limit. 0 contact-scan hits over 6,870 values.
- **Tests:**
  - `vitest --maxWorkers=4`: 1857 passed. `finder-corpus-gates` needs the gitignored Skool payload, as before.
  - `tsc` clean.
  - `eslint` on the changed files: 0 errors.
  - `next build` OK (executor run; no source changed after it).

## Regression report
- **Model view:** unchanged, with no layouts or details. Input tokens were 16k, as before.
- **Rows:** the FinderRow 14-key allowlist is unchanged. `groupHeadingBefore` is still exported for `project-sheet.test.ts`.
- **Older saved turns:** a turn without summaries keeps the AI Details button (test), and a turn without sections still decodes.
- **Answers:** the conversational answer branch and the stray-answer note above the table are unchanged (tests).
- **Fallback:** `showMorePrompt` / `projectDetail` remain the fallback path.

## Known limitations
- **Not merged or deployed.**
- **Bigger raw search output.** The raw search output the AI SDK streams to the browser now carries layouts and details for every row, about 0.3 MB in the worst case; before, it carried the top 8 only. This is part of the proposed "raw tool output" follow-up.
- **No live click test.** There is no DOM test environment, so the click itself is tested through pure helpers; the live click was checked in the preview browser.
- **Sheet text shown as written.** Some D2 sheet values carry their own label or typo ("Completion: Completion Date: 2017…", "Area: Damansara Height").
