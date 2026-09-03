# Claim: quick-kayinleong-085
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-03
- status: done
- summary: the 5-card cap was never the bug — "Klang Valley" survived only 5 of 82 projects and 3 with a budget, because the location gate matched a whole region as a literal substring. Fix the gate, admit unpriced projects, add real sqft fields, then render every row in one paginated table with a per-row "details + supporting documents" action

## What is wrong

**The cap never engaged.** The report was "it only shows 5 cards, show all relevant results in
one table". The obvious suspect was `MAX_MATCHES = 8` at `src/inventory/search.ts:221`. It was
not the cause. Measured against the real 82-project corpus with the actual gate functions:

| gate stage, driving prompt `show me a list of 1mil property within Klang Valley` | before | after |
|---|---|---|
| candidates after the location gate | **5 of 82** | **82 of 82** |
| candidates after `priceMax 1,000,000` | **3 of 82** | **50 of 82** |
| — of which priced within budget | 3 | 18 |
| — of which unpriced (`priceValue: 0`) | 0 | 32 |
| rows the table could ever show | 3 | 50 |

There were never 8 candidates to cap. Shipping a table without fixing the gate would have
rendered three rows and left the complaint untouched.

Two independent causes, both measured:

**1. A region name was treated as a neighbourhood.** `LOCATION_QUALIFIER_TOKENS` already handles
the single-token case — bare `KL`, `Selangor`, `Kuala Lumpur` all reduce to nothing
discriminating, so the gate is skipped and all 82 survive. It cannot handle "Klang Valley",
because neither word is a qualifier on its own. So `locationNeedles` returned
`[{ phrase: 'klang valley', tokens: ['klang','valley'] }]` and `projectMatchesLocation` tested it
as a literal substring of `name + locationText` — 5 hits, all coincidental. Every active D2
project is inside the Klang Valley, so the region carries zero information.

**2. 32 of 82 projects were deliberately invisible.** `projectMatchesPrice` returned `false` for
`priceValue <= 0` whenever any bound was stated, and its own comment said *"the remedy is to
backfill priceValue, not to loosen the gate."* That reasoning is sound in isolation — but the
data gap is not getting backfilled, and the cost was 32 projects vanishing from every budgeted
query. **The user was shown the tradeoff and chose to loosen it** (D2), so the comment now
records the decision rather than contradicting the code.

And the attributes the user asked for could not travel even if the rows existed:
`FinderMatchSchema` carried `projectId / name / rationale / matchedCriteria / collateral` and
nothing else. `ProjectMatch` had price, tenure, bedrooms and location, but that shape died at the
tool boundary — `z.object` strips unknown keys, so nothing reached the client. And `size` was
not a field at all: it lives only as prose inside `description`
("1 Bedroom: 904 sqft … Penthouses: 2,900 – 4,855 sqft").

## What changed

Three commits, one per task.

| commit | task |
|---|---|
| `c279491` | retrieval correctness (D4 + D2) and real size fields (D1) |
| `e061917` | split the cap — bounded model payload, complete client rows (D3 schema + prompt) |
| `1ce49c2` | the table, the per-row action, trilingual strings |

### Task 1 — `c279491`

| file | change |
|---|---|
| `src/inventory/search.ts` | `REGION_ALIASES` (5 entries) checked in `locationNeedles` both raw and after the qualifier strip, so "greater KL" and "in the Klang Valley area" both drop out; `projectMatchesPrice` admits `priceValue <= 0` and is now exported; `matchedCriteria.priceMax` is per project; two stale doc comments and the module header rewritten |
| `src/firebase/collections.ts` | `ProjectDoc.sizeMinSqft` / `sizeMaxSqft` (nullable, optional), documented as built-up and explicitly NOT in `EMBEDDING_RELEVANT_FIELDS` |
| `src/inventory/size-extract.ts` | new, pure, zero imports — `extractSizeRange(description)` with five documented guards |
| `scripts/backfill-project-sizes.ts` | new — dry run by default, `--apply` to write, `bulkWriter().update()` on two fields only, idempotent |
| `src/inventory/size-extract.test.ts` | new — fixture traps + a sweep of all 82 records with pinned counts |
| `tests/finder-corpus-gates.test.ts` | new — the real gates over the real corpus, pinning every number in the table above |
| `src/inventory/search.test.ts` | the unpriced-exclusion case REVERSED to match D2, plus a D4 case, a `matchedCriteria` honesty case, and an over-budget-priced case |

`EMBEDDING_RELEVANT_FIELDS` is untouched — no re-embed (D1, and see Known gaps).

### Task 2 — `e061917`

| file | change |
|---|---|
| `src/inventory/search.ts` | `MAX_ROWS = 100` and the slice moved onto it; `MAX_MATCHES` re-documented as the MODEL cap; `ProjectMatch` carries `sizeMinSqft` / `sizeMaxSqft` read straight from the stored doc |
| `src/agents/finder/schema.ts` | `FinderRowSchema` + `type FinderRow` (12-key allowlist); `rows` on `FinderOutputSchema` (`.default([])`); `highlight` OPTIONAL on `FinderMatchSchema`, max 120 chars |
| `src/agents/finder/tools.ts` | `FinderRowSink`, a private `toFinderRow` projection, an optional `sink` parameter, and `toModelOutput` |
| `src/agents/finder/index.ts` | optional 4th `rowSink` parameter threaded through `makeTools`; the five `FinderOutput` literals carry `rows: []` |
| `src/agents/finder/prompt.ts` | two new sections (omit `rows`, author `highlight`) mirroring the existing collateral rule; Output Format updated |
| `app/api/chat/route.ts` | `finderRowSink` declared next to `collateralByProject`, passed as arg 4, read in `doPersistAssistant` (condition widened to fire on rows OR collateral) and in `messageMetadata` |
| `app/[lang]/chat/decode-structured-output.ts` | `attachFinderRows(output, rows)` |
| `app/[lang]/chat/decode-stream-chunk.ts` | `finderRows` on `StreamMessageMetadata`, validated item by item |
| `app/[lang]/chat/chat-input.tsx` | `serverFinderRows` captured, chained `attachFinderRows(attachCollateral(...))` |
| tests | new `src/agents/finder/tools.test.ts`; additions to `decode-structured-output.test.ts`, `decode-stream-chunk.test.ts`; `route.test.ts` and `finder.test.ts` fixtures updated for the new arg / fields |

**The cap was split, not raised.** `toModelOutput` bounds what the model sees; the sink is what
the route reads. Both exist and neither is redundant — whether `onStepFinish` receives raw or
projected tool output is an SDK-semantics question that cannot be settled offline, and getting it
wrong renders an empty table.

**One deviation from PLAN.md.** The plan described `toModelOutput` as returning the projected
result object. The installed types
(`node_modules/@ai-sdk/provider-utils/dist/index.d.ts:772`, verified as the plan instructed)
require `LanguageModelV2ToolResultOutput`, a tagged union — so it returns
`{ type: 'json', value: bounded }`. The plan anticipated exactly this ("if the signature differs
from expectation read the installed types rather than guessing").

### Task 3 — `1ce49c2`

| file | change |
|---|---|
| `app/[lang]/chat/match-table.tsx` | new client component: 8 columns, 10 rows/page via the shared `usePagination` + `Paginator`, sticky Name column, per-row action button, exported `formatPrice` / `formatSize` |
| `app/[lang]/chat/match-list.tsx` | `onAsk` prop; the `matches.length > 0` branch renders `MatchTable` when `rows` is non-empty and keeps `MatchCard` as the fallback; clarifying / refusal / answer branches untouched |
| `app/[lang]/chat/message-list.tsx` | `onAsk` accepted and forwarded to `MatchList` |
| `app/[lang]/chat/chat-shell.tsx` | `onAsk={(prompt) => handleSuggestion(prompt, 'finder')}` |
| `src/i18n/messages/{en,ms,zh}.json` | `chat.matchTable.*` — 8 keys, identical sets, real BM and 中文 |
| `app/[lang]/chat/match-table.test.ts` | new — formatter units, a parsing i18n cross-check, prop-forwarding guards, mobile guards |

Five of the eight column headers reuse the already-trilingual `inventory.col*` keys, so only 8
new strings entered three catalogs.

## Verification

### The D4 region fix, by actual match counts

Run through the real `locationNeedles` / `projectMatchesLocation` / `projectMatchesPrice` over
`projects.inventory.json` (82 records), pinned in `tests/finder-corpus-gates.test.ts`:

| location preference | survivors before | survivors after |
|---|---|---|
| `Klang Valley` | 5 | **82** (gate skipped) |
| `in the Klang Valley area` | 5 | **82** |
| `greater KL` | — | **82** |
| `Lembah Klang` / `巴生谷` / `Greater Kuala Lumpur` | — | **82** |
| `Bangsar, Klang Valley` | 13 (8 Bangsar + 5 coincidental) | **8** |
| `Cheras` | 0 | **0** (unchanged) |
| `Bangsar` | 8 | **8** (unchanged) |
| `Petaling Jaya` | 4 | **4** (unchanged) |

The last three matter as much as the first: they prove the region skip is not over-broad. A
Cheras request still refuses rather than substituting Bangsar projects — the quick-050 defect.

Driving prompt, both gates: **82 → 50 (18 priced within RM1,000,000 + 32 unpriced)**, against
5 → 3 before. Every one of those figures matches RESEARCH.md's independent measurement exactly;
none was adjusted to fit the code.

### The D1 backfill parse audit — all 82 reviewed by eye

Report mode over every `records[].input.description`, then read line by line against the source
text on 2026-09-03:

| | count |
|---|---|
| total records | 82 |
| parsed a range | **66** |
| left null | **16** |
| parsed WRONGLY (first pass) | **6** — fixed, see below |
| parsed wrongly (final) | **0 wrong measurements; 2 imprecise, detailed below** |

66 rather than RESEARCH's "61 mention sqft" because this extractor also accepts `sq.ft`,
`sq. ft.` and `square feet` — Eaton, Platinum Face, Armani Hallson, Royal Lexis and The Oval all
write `sq. ft.`.

**The review found six genuinely wrong ranges, and they were fixed rather than accommodated.**
The global-min/max rule was folding shared facilities and land plots into the layout range, so
the table would have shown sizes no buyer can purchase:

| project | before the fix | source text that caused it | after |
|---|---|---|---|
| The Lantern Bangsar | 561–**16,800** | `Facilities: (Total 16,800 sqft` | **561–1,092** |
| PSQ Pavilion Square | 504–**15,000** | `Largest Sky Gym (15,000 sq. ft.` | **504–1,272** |
| Aspire office @ KL ecocity | 1,152–**19,000** | `Lifestyle & Amenities: 19,000 sqft` | **1,152–18,690** |
| Puncak Wangsamas Phase 2 | **3,326**–8,181 | `Land Area: 4,101 – 8,181 sqft` | **3,899–4,728** |
| Yanu Hills @ Bon Estates | **6,631–11,184** | `Land Size: 6,631 – 11,184 sqft` | **6,686–8,057** |
| Vila Setara Happy Garden | **1,873**–5,595 | `Land Size: 22x85 (1,873 sqft` | **4,100–5,595** |

`NON_BUILT_UP_LABEL` now rejects a mention whose left context labels it as land, facilities,
amenities, a gym, a clubhouse, a lobby, retail or a floor area. Each of the six inputs is quoted
in the constant's comment and asserted in the test, so the guard cannot be "simplified" away
without a named failure.

**Two remaining imprecisions, reported rather than hidden.** Both are real built-up figures from
the source prose, just not the layout table's own bound:

- **Majestic @ Kiara Reserve** reads 700–3,703; the smallest layout is 1,270. The 700 comes from
  `Built-up: 1,600 sqft + 700 sqft`, an add-on quoted as a built-up.
- **Pinnacle Bangsar Residence** reads 4,000–7,942; the smallest layout is 4,677. The 4,000 comes
  from the prose `With over 4000 square feet`.

Distinguishing "figure inside a layout table" from "figure in marketing prose" needs a per-record
structure parse, which is a bigger change than a minimal-fix claim should carry. Neither is a
wrong *measurement*, and both are inside the plausibility window, so both degrade gracefully.

Spot checks pinned by name in the test, each verified against its own description: DC Residensi
904–4,855 · Eaton 635–2,885 · ViiA 636–1,252 · The Lantern 561–1,092 · Yanu Hills 6,686–8,057 ·
Eden BRDB 5,296–19,041 (largest real layout in the corpus) · Dawn KLCC 348–835 (smallest studio) ·
Vila Setara 4,100–5,595. All 16 nulls are named too, so a future extractor change that starts
inventing a size for them fails loudly.

**Live Firestore dry run** (`npx tsx --env-file=.env.local scripts/backfill-project-sizes.ts`,
no writes): **87 documents** — five more than the 82-record import corpus, later additions such
as "Papyrus North Kiara" — **67 parsed, 20 null, 67 to update, 20 unchanged**. The 20 unchanged
are the nulls, which proves the idempotency skip path works. `--apply` has NOT been run; see
Known gaps.

### The guards were verified by reintroducing the bug — all twelve

A source assertion that has never been seen to fail is not evidence. Twelve mutants, each
reverted immediately after its run:

| # | mutant | observed result |
|---|---|---|
| 1 | delete `'klang valley'` from `REGION_ALIASES` | **4 tests fail** in `finder-corpus-gates.test.ts`: `expected [{ phrase: 'klang valley' … }] to be null`, `expected 5 to be 82`, `expected 13 to be 8`, and the driving-prompt chain `expected 5 to be 82`. Reproduces RESEARCH's 5-of-82 exactly. |
| 2 | restore the `priceValue <= 0 → false` early return | **3 tests fail**: `expected false to be true`, `expected 18 to be 50`, `expected +0 to be 32`. Reproduces the 32 hidden projects. |
| 3 | disable the currency left-context guard in `extractSizeRange` | **1 test fails**, `rejects a currency-prefixed figure`: `expected { minSqft: 1450, maxSqft: 1450 } to be null` — `RM1,450 sq ft` read as an area. |
| 4 | `matchedCriteria.priceMax` back to the blanket `priceApplied` form | **1 test fails**, `D2: an unpriced survivor claims NO budget match`: `expected 800000 to be null`. |
| 5 | remove `toModelOutput` from the tool options | **4 tests fail** in `tools.test.ts`, all `TypeError: toModelOutput is not a function`, including the `< 8,000` character assertion. |
| 6 | stop writing to the sink in `execute` | **4 tests fail**: `expected +0 to be 60`, `expected [] to deeply equal [ 'proj-0', … ]`. |
| 7 | make `attachFinderRows` enrich only existing matches | **3 tests fail** in `decode-structured-output.test.ts`: `expected […2 items] to have a length of 40 but got 2` — the exact "table shows only what the model retyped" regression. |
| 8 | add `priceBand` to `FinderRowSchema` and to `toFinderRow` | **THE GAP THE EXERCISE FOUND.** With the two new assertions temporarily removed, the leak passed the **entire 1,412-test suite silently**. Restoring them: **3 tests fail** — `expected true to be false` on the projection, `expected [ 11 keys ] to deeply equal [ 10 keys ]` on the schema shape, and the strip test. Gap closed by the new `FinderRowSchema is an allowlist` suite plus a `not.toContain('priceBand')` on the table source. |
| 9 | delete the `onAsk` forward in `message-list.tsx` | **1 test fails**, naming the file: `message-list.tsx accepts onAsk and forwards it to MatchList`. |
| 10 | `formatPrice` returns `'RM 0'` for `priceValue: 0` | **1 test fails**: `expected 'RM 0' to be null`. |
| 11 | remove `chat.matchTable.showMorePrompt` from `ms.json` | **5 tests fail** across BOTH guards, as predicted: 3 in `match-table.test.ts` (`ms: chat.matchTable.showMorePrompt: expected 'undefined' to be 'string'`) and 2 in `i18n-parity.test.ts` (`expected [ 'chat.matchTable.showMorePrompt' ] to deeply equal []`). |
| 12 | add `mx-auto justify-center` to the table wrapper | **1 test fails**: `not to contain 'justify-center'` — the quick-081 both-ends-clipped guard. |

All twelve reverted; the suite is green.

Two of the guards had to be repaired during this exercise, and both repairs are themselves
verified:
- The forbidden-class checks initially failed on the component's own *comments* explaining why
  `overflow-x-auto` and `priceBand` must not appear. They now read a comment-stripped copy of the
  source, with a meta-assertion that the stripper kept the JSX and dropped the prose — otherwise
  a stripper bug could pass every negative check vacuously.
- Mutation 8's gap (above) is the one the plan predicted would be *found* rather than confirmed.

### Regression surface

Everything that reads the Finder path. Enumerated, not assumed:

| surface | change | why it cannot regress |
|---|---|---|
| `searchProjects` location gate | region tier added before the qualifier strip | `Cheras` 0 / `Bangsar` 8 / `Petaling Jaya` 4 asserted unchanged over the real corpus; the KLCC proximity guard, the Bukit Jalil / Bukit Bintang phrase guard and the Sri Petaling / Petaling Jaya guard are all still green |
| `searchProjects` price gate | unpriced admitted | priced comparisons untouched and asserted: over-budget 950k still excluded at 800k, `priceMax` still inclusive at the boundary, `priceMin` still inclusive, an all-over-budget set still refuses `no_match` (not `ineligible`) |
| affordability gate | untouched | an unpriced project already passed `0 <= ceiling` before this claim, so its behaviour is identical; affordability is still absent from `matchedCriteria` |
| ranking | untouched | `MIN_RELEVANCE`, `applySegmentWeights` and `RELEVANCE_TIER_WIDTH` unchanged; no unpriced-last tiebreak added (D2 says mix them in). The segment-tier and locationText-length regression tests are green |
| `status:'active'` enforcement | untouched | no second query path exists; rows are projected from `searchProjects` output only, and `where('status','==','active')` is still asserted as the first Firestore filter |
| model context / token budget | bounded harder than before | a 60-row result serializes under 8,000 chars for the model, asserted, with a companion assertion that the full result really is bigger (so the check is not vacuous). `INLINE_COLLATERAL_MATCHES` still 3 |
| `dropUnrenderableMatches` | new optional field only | `highlight` is `.optional()`; a match omitting it still decodes, asserted. An over-long highlight drops that one match, not the envelope |
| older persisted turns | render unchanged | `rows` defaults to `[]`; `attachFinderRows` is a no-op for undefined/empty; `MatchCard` remains the fallback. Asserted |
| truncated turns | rows now survive them | `doPersistAssistant` attaches rows to the stored envelope, because `messageMetadata` fires only on `start`/`finish` (quick-072). Offline-provable only up to the attach; the reload render is a live gap |
| Coach and Reply pillars | untouched | no shared file changed except `route.ts`, where every edit is inside a `pillar === 'finder'` branch or a Finder-only declaration |
| `MessageList` prop forwarding | one prop added | the quick-080 failure mode; guarded per link in the chain, and mutation 9 proves the guard bites |
| chat header / dialogs | untouched | `mobile-layout.test.ts` (13 assertions) and `tests/dialog-mobile-width.test.ts` green |
| `package.json` | untouched | no new dependency; `@tanstack/react-table` still absent |

**Ruled out:**
- *Region skip leaking into an alias table* — `REGION_ALIASES` only ever causes a segment to be
  DROPPED. There is no region→area expansion, so it cannot produce a false positive; the worst
  case is a skipped gate, which `matchedCriteria.locationPref: null` reports honestly.
- *An unpriced row claiming a budget match* — blocked in three independent places:
  `matchedCriteria.priceMax` nulled per project, `priceBand` absent from `FinderRow` by schema,
  and `formatPrice(0) === null`. Mutations 4, 8 and 10 each kill one.
- *`embedding` or `description` reaching the browser* — `FinderRowSchema` is a 12-key allowlist
  and Zod strips the rest; asserted on the projection, on the schema shape, and on the serialized
  model view.
- *A re-embed being triggered* — `EMBEDDING_RELEVANT_FIELDS` is not touched, and the backfill
  writes through `bulkWriter` rather than `updateProject`, so the delta check never runs.
- *The backfill writing anything else* — one `writer.update(ref, { sizeMinSqft, sizeMaxSqft })`
  call, dry by default, idempotent (20 unchanged docs on the live dry run prove the skip path).
- *Secrets* — nothing reads `.env*`; the backfill takes credentials from `--env-file` via `tsx`
  and prints only project names and numbers. No PII, no tokens, no user records logged.
- *`tenurePref`* — still accepted and still dropped by `execute`. A pre-existing false
  affordance, deliberately left alone (deferred item 1).

### Gate

| check | result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **1248 passed**, 0 failed, 197 skipped (79 files) — 22 of 25 runs clean; the 3 failing runs are a load-induced timeout, diagnosed below |
| `npx eslint app src tests` | **0 errors**, 77 warnings (all pre-existing; same count as quick-084 recorded) |
| `npx eslint scripts` | 49 errors — **all pre-existing** in `scripts/scrape-skool/*`, confirmed by re-running with `scripts/` stashed. `scripts/backfill-project-sizes.ts` linted alone: clean |
| `npm run build` | `✓ Compiled successfully in 22.1s` |

**A load-induced timeout flake, diagnosed rather than hand-waved.** Three of 25 full-suite runs
came back with 1, 1 and 4 failures. I initially captured only the summary line — a real reporting
gap — then reproduced it deliberately by running two full suites concurrently, which named it:

| symptom | evidence |
|---|---|
| the failure is always a TIMEOUT, never an assertion | `Error: Test timed out in 5000ms` (vitest's default `testTimeout`; the repo sets none) |
| the affected tests do a dynamic `await import(...)` INSIDE the test body | `reply.test.ts:53`, so cold module resolution is charged against the 5s budget |
| the flaking runs have ~3x the module-import time | 57.9s / 63.7s / 49.6s vs ~20s on every clean run |
| the two files involved touch NOTHING this claim changed | `src/agents/reply` imports nothing from `src/inventory` or `src/agents/finder`; the only file of mine in their graph is `src/firebase/collections.ts`, whose entire runtime diff is two optional TYPE-only fields |
| run in isolation under the same concurrency, they pass | 3 concurrent runs of just those two files: 18 passed, 0 failed, three times |
| there is prior record of it | STATE.md notes a flake in this exact file after quick-084 |

**Honest caveat about my own contribution:** this claim adds 4 test files and ~98 tests, which
makes the whole suite heavier. I did not cause the timeout, but a heavier suite raises the odds of
a pre-existing 5s-budget test tripping on a loaded machine. The cheap remedy — hoist those dynamic
imports into `beforeAll`, or set an explicit `testTimeout` — is a separate claim, not a
minimal-fix edit here. Sequential single runs are clean 22 times out of 22.

## Known gaps

**Needs a live authenticated browser — NOT verified, and not described as verified anywhere above.**
The plan's `<human-check>` list is outstanding in full. This repo's own history is the reason to
say so plainly: quick-080 shipped a data-render path that was only found broken by signing into a
real browser.

1. **The end-to-end render.** That a real Finder turn actually produces a table with data in it.
   Every link is unit-asserted — sink → metadata → parse → attach → `rows` → `MatchTable` — but
   the assembled path has never run against a live model.
2. **The row button's follow-up turn.** That tapping "Details" dispatches a turn, and that the
   reply is prose about that one project *with its supporting documents listed*.
3. **320 / 399 / 400 / 440 px layout.** That the Name column stays pinned while the rest scrolls,
   that neither end of the scroll strip is clipped, and that nothing overflows the viewport.
   Measure in-page with `getBoundingClientRect()` rather than eyeballing — the quick-083 lesson.
4. **The reloaded-thread path.** That a revisited turn renders its table from the persisted
   envelope (the truncated-turn path).
5. **BM and 中文 end to end.** That the headers, the button and the *dispatched prompt* are all
   translated and the reply comes back in that language.
6. **`scripts/backfill-project-sizes.ts --apply`.** Not run. The dry run against live Firestore
   succeeded (87 docs, 67 parsed, 20 null, 67 to update), but nothing has been written. **Until it
   is run, the Size column is correctly empty for every row** — the table is not broken, the data
   is not there yet. The "zero writes on an immediate second `--apply`" claim is therefore also
   unproven end to end, though the 20 unchanged docs in the dry run exercise the same skip path.

**Accepted limitations.**

7. **Highlight populates the top rows only.** The model can only author a `highlight` for the
   matches it sees, and the token cap holds that at `MAX_MATCHES` (~8). On a 50-row table the
   Highlight column is filled for the strongest handful and empty below. The user was shown this
   and chose "leave them empty" over a description-snippet fallback (D3 addendum) — an empty cell
   honestly reads "not assessed", whereas filler would mix curated highlights with truncated
   blurbs in one column. The concrete columns carry every row.
8. **No re-embed (D1).** `sizeMinSqft` / `sizeMaxSqft` are deliberately absent from
   `EMBEDDING_RELEVANT_FIELDS`. The sqft text is already inside the embedded `description`, so
   semantic recall is unaffected and 82 needless re-embeds are avoided. Flagged here rather than
   decided silently.
9. **New inventory imports will not populate the size fields.** D1 scoped this to a one-off
   backfill, so neither `createProject` nor `scripts/scrape-skool/to-inventory.ts` writes them.
   **Mitigation until a follow-up claim: re-run `scripts/backfill-project-sizes.ts --apply` after
   every inventory import.** The live corpus is already 87 docs against the 82 in the import
   snapshot, so this will bite.
10. **Two imprecise size ranges** (Majestic @ Kiara Reserve, Pinnacle Bangsar) — detailed in the
    parse audit above. Real built-up figures, just not the layout table's own bound.
11. **Inline collateral stays at the top 3.** Only 3 rows can show files inline; the row button
    is the path to files for the rest. Raising `INLINE_COLLATERAL_MATCHES` re-opens the quick-054
    token blowup.
12. **Unpriced rows are not sorted last.** D2 says mix them in; relevance order is the honest mix.
13. **The persisted envelope grows.** A 50-row envelope is roughly 10–12 KB of JSON in a message
    doc (Firestore limit 1 MB). Accepted, and `MAX_ROWS = 100` is the ceiling on it.
14. **`tenurePref` is still a false affordance** — accepted by `inputSchema`, dropped by
    `execute`. Pre-existing, out of scope, its own claim.

## What this claim got right that the last few did not

The instinct was to build the table. The 30 minutes spent porting the gate functions over the
real corpus *before* writing any UI is the only reason this claim is not a three-row table with a
nice header. `MAX_MATCHES = 8` was the obvious suspect and the measurement said it had never
fired once.

Two habits reinforced, both already earned earlier in this session:

- **Measure the thing before fixing the thing it looks like.** The reported symptom ("5 cards")
  named the wrong component entirely.
- **Break the guard on purpose.** Mutation 8 is the whole argument: a `priceBand` leak into
  `FinderRow` — the exact hazard D2 rests on — passed 1,412 tests without a murmur. The
  assertion that catches it exists only because the mutation was actually run.
