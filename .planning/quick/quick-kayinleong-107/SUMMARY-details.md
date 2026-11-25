---
status: complete
---

## Goal
Show each listed Finder project's full details (server-built, no model call) under the result table.

## Changes Made
- `src/inventory/project-details.ts` (new) — `buildProjectDetails(doc)` -> `DetailSection[]`; clientFacts authority, price merge, layout-section drop when unitTypes non-empty, resources block dropped, stricter contact scan safety net, caps (14 sections, 30 items, 300-char values, 7,000 chars).
- `src/inventory/quick-facts.ts` — `cleanedWriteUpLines` (uncapped cleaning, shared with `quickFactsExcerpt`), `MAX_DETAIL_LAYOUTS = 40`, `summaryLayouts(..., limit)`.
- `src/inventory/search.ts` — `ProjectMatch.details`, `summaryFields` adds `details` and 40 layouts.
- `src/agents/finder/tools.ts` — model view strips `details` and `layouts`; sink summaries are `{projectId, layouts, sections}` for rows with layouts or sections.
- `src/agents/finder/schema.ts` — `DetailItemSchema`, `DetailSectionSchema`, `MatchSummarySchema.sections` (default []), layouts max 40.
- `src/agents/finder/prompt.ts` — Summary section says the system shows full details.
- `app/[lang]/chat/{decode-structured-output,decode-stream-chunk}.ts` — keep entries with layouts OR sections.
- `app/[lang]/chat/match-summaries.tsx` — `FullDetails` block (open by default, aria-expanded toggle), fixed section order.
- `src/i18n/messages/{en,ms,zh}.json` — `chat.matchTable.details.*`.
- Tests: project-details.test.ts (new), tools.test.ts, finder.test.ts, match-summaries.test.ts.

## Verification
vitest (inventory, finder, chat, api/chat): 936 pass, 1 fail = `client-workbook-new.test.ts` (orchestrator's in-flight clientFacts work; `clientWorkbookFields` now includes 'clientFacts'). tsc clean, eslint clean, next build OK. Corpus (90 records, 83 with clientFacts): 2 empty, max 4,559 chars, median 1,335, contact-scan hits 0, "RM 0" 0.

## Regression
Gates, projectPriceRange, AREA_NEIGHBOURS untouched; 14-key FinderRow test unchanged and passing; old turns without `sections` decode to [].

## Blockers
None (client-workbook-new.test.ts failure belongs to the orchestrator's files).
