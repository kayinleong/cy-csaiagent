---
status: complete
---

## Goal
Show a per-project summary (Best for, Layouts & sizing, Key selling points, Details) under the Finder table, hybrid design: layouts built by the server from `unitTypes`, the two prose fields written by the model only from a sanitized Quick Facts excerpt.

## Changes Made
- `src/inventory/quick-facts.ts` (new) — `quickFactsExcerpt` (starts at "Quick Facts", drops whole lines with URLs / wa.me / chat.whatsapp / e-mail / phone / PIC-leader-contact labels, cap 700, '' when empty or no heading), `summaryLayouts` (no `raw`, available first, requested bedrooms first, cap 6, sold-out layouts have all prices nulled, 0/null price becomes null), `CONTACT_LINE` / `WHATSAPP_INVITE` moved here.
- `src/agents/finder/project-sheet.ts:25-28` — imports the two patterns from quick-facts (behavior unchanged).
- `src/inventory/search.ts:88,146-158,1282,1298-1300,1344-1356` — `ProjectMatch.quickFacts?` / `layouts?`, set in the mapper for the top `MAX_MATCHES` only (`summaryFields`). Gates, price range, AREA_NEIGHBOURS untouched.
- `src/agents/finder/schema.ts:235-257` `bestFor` / `sellingPoints` (optional, trim + truncate to 100/200, `.catch(undefined)` so they can never delete a match); `:349-371` `SummaryLayoutSchema`, `MatchSummarySchema`; `:477-484` `FinderOutput.summaries?` (max 8). `FinderRowSchema` unchanged (14 keys).
- `src/agents/finder/tools.ts:185-190` sink `summaries?`; `:231-237` `withoutLayouts`; `:354-360` sink filled from the top 8 with layouts (replaced per search); `:385-392` `toModelOutput` keeps `quickFacts`, strips `layouts`.
- `src/agents/finder/prompt.ts:137-144` new "Summary" section; `:265` output contract lists `bestFor?, sellingPoints?`. Rule text: ONLY from that match's quickFacts, omit rather than infer, no layouts / bedrooms / sizes / prices / budget fit, no yield or rental-demand claims unless stated, plain text, one-sentence rationale.
- `app/[lang]/chat/decode-structured-output.ts:554-576` `attachSummaries` (server wins, only matched ids, no-op when empty). `decode-stream-chunk.ts:138-143,221-229` `summaries` on metadata, validated item by item.
- `app/api/chat/route.ts:661` sink init, `:749-767` persisted envelope, `:1429-1433` messageMetadata. `app/[lang]/chat/chat-input.tsx:383,431,540-546` merge. PDPA block untouched.
- `app/[lang]/chat/match-summaries.tsx` (new) — `MatchSummaries`, `buildSummaryEntries`, `compactRM`, `formatRMRange`, `formatLayoutLine`; rendered in `match-list.tsx:161-167` right after `<MatchTable>`.
- `src/i18n/messages/{en,ms,zh}.json` `chat.matchTable.summaryTitle|bestFor|layouts|sellingPoints|soldOut|sqft|bed|nett|gross`.
- Tests: `src/inventory/quick-facts.test.ts` (13), `app/[lang]/chat/match-summaries.test.ts` (29, includes a `renderToStaticMarkup` render in `NextIntlClientProvider`), additions in `src/agents/finder/tools.test.ts` (4), `finder.test.ts` (4); `app/api/chat/route.test.ts:596,630` expectation now includes `summaries: []`.

## Verification
- `npx vitest run src/inventory src/agents/finder "app/[lang]/chat" app/api/chat`: 28 files passed, 903 tests passed, 26 skipped.
- Full `npx vitest run`: 88 files passed, 1809 tests passed; 1 file fails to load: `tests/finder-corpus-gates.test.ts` (ENOENT `projects.inventory.json`, a gitignored local data file; unrelated).
- `npx tsc --noEmit`: clean. `npx eslint` on all changed files: 0 errors (4 warnings, all pre-existing in `route.test.ts`).
- `npx next build`: succeeded.

## Regression
- Row allowlist: `FinderRowSchema` still 14 keys; `toFinderRow` unchanged; existing key test and 8,000-char model-view test pass.
- `quickFacts`/`layouts` only on the top 8 (mapper), so SSE tool output stays small; raw `description` never on `ProjectMatch`.
- Wave-1 gates / price / neighbours / PDPA code untouched; `search.test.ts` passes. `project-sheet.ts` pattern move covered by existing `project-sheet` tests.
- Persisted older turns without `summaries` / `bestFor` decode and render as before (optional fields, no-op attach).

## Blockers
- None blocking. Deferred: no mapper-level test that only the top 8 get `quickFacts`/`layouts` (`search.test.ts` was outside the owned list; covered indirectly through the tools test with a shaped fixture). Not run: live model output, so prompt adherence (omit-rather-infer, no layout claims) is untested end to end; an optional promptfoo case was not added. Descriptions with no "Quick Facts" heading (about 5 of 86) get no excerpt, so no model-written fields for them.
