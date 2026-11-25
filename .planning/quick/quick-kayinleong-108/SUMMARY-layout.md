---
status: complete
---

## Goal
Show the recommended table, its quick facts, then the nearby table and its quick facts, and make the row Details button an inline dropdown (no AI turn) with server-built details for every row.

## Changes Made
- `app/[lang]/chat/match-list.tsx` — new `MatchGroups`: recommended table + `QuickFactsList`, then nearby table (heading above it) + `QuickFactsList`; `MatchSummaries` no longer used.
- `app/[lang]/chat/match-table.tsx` — takes `summaries` and `heading`; no in-table group rows; Details toggles a full-width `match-table-details` row (colSpan 8); `toggleOpen` and `handleDetailsClick` helpers; fallback to `onAsk` when the row has no details; `@container` wrapper around the Table; panel `sticky left-0 w-[100cqw] max-w-[100cqw]`.
- `app/[lang]/chat/match-summaries.tsx` — `MatchSummaries` replaced by `QuickFactsList` (max 10 blocks per group + "rest under Details" line), `ProjectDetailsPanel` (107 renderer, no own header), `hasDetails`, `quickFactLines`, `GROUP_PAGE_SIZE`.
- `src/inventory/search.ts` (mapper + `summaryFields` only) — layouts + details on every row, `quickFacts` excerpt top `MAX_MATCHES` only.
- `src/agents/finder/tools.ts` — sink `summaries` covers every row with layouts or sections; model view unchanged (strips them, slices to `MAX_MATCHES`).
- `src/agents/finder/schema.ts` — `FinderOutput.summaries` max 100. `app/[lang]/chat/decode-structured-output.ts` — `attachSummaries` cap 100. `decode-stream-chunk.ts` and `app/api/chat/route.ts` had no cap: untouched.
- `src/agents/finder/prompt.ts` (Summary section) — quick facts under the table, full details in the Details dropdown; fields stay short.
- `src/i18n/messages/{en,ms,zh}.json` — `chat.matchTable.{quickFactsTitle,hideDetails,detailsAria,restUnderDetails}`.
- Tests: `match-table.test.ts`, `match-summaries.test.ts`, `tools.test.ts`, `finder.test.ts`, `search.test.ts` (mapper test).

## Verification
- Size check (scratch script, outside repo) over `projects.export.json`, 86 active projects: 85 have layouts or sections; `summaries` JSON = 281,509 bytes total (avg 3,311, max 8,440 per project). A 100-row result is about 0.33 MB, well under Firestore's 1 MB limit. `scanForContactDetails` over all 6,870 string values: 0 hits.
- `npx vitest run --maxWorkers=4`: 1855 passed, 2 failed, 223 skipped; the failures are `project-detail.test.ts` ("OLD BEHAVIOUR…") and `reply.test.ts` (5 s timeouts under load); both pass when rerun alone (63 passed). `tests/finder-corpus-gates.test.ts` fails on the missing gitignored inventory (known).
- `npx tsc --noEmit`: clean. `npx eslint` on changed files: 0 errors (16 pre-existing unused-var warnings in `search.test.ts`). `npx next build`: succeeds; built CSS has `.\@container{container-type:inline-size}` and `w-[100cqw]`.
- Mobile: the `@container` wrapper sits outside the table's scroller, so `100cqw` equals the visible width; the panel is `sticky left-0` inside the scroller, so it stays in view while the table scrolls under it; text uses `break-words`. Not verified in a real browser.

## Regression
Checked: `groupHeadingBefore` still exported (project-sheet.test passes); 14-key `FinderRow` test unchanged; model view still has no layouts/details; projectDetail / showMorePrompt path kept as the fallback; `route.test.ts` unchanged and passing; old turn without sections still decodes.

## Blockers
- No DOM env, so the click is tested through `handleDetailsClick`/`toggleOpen`, and the open panel by rendering `ProjectDetailsPanel` directly; no real-browser check of the sticky panel.
- The raw tool output streamed to the browser now carries layouts/details for every row (about 0.3 MB worst case).
