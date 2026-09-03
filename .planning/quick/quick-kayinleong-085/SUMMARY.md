---
phase: quick-kayinleong-085
plan: 01
subsystem: property-finder
tags: [finder, retrieval, inventory, chat-ui, i18n, mobile]
requires:
  - src/inventory/search.ts (location + price gates)
  - src/agents/finder/{schema,tools,prompt,index}.ts
  - app/api/chat/route.ts (messageMetadata + persist path)
  - app/[lang]/chat/{decode-structured-output,decode-stream-chunk,chat-input,match-list,message-list,chat-shell}
provides:
  - REGION_ALIASES region-qualifier skip in locationNeedles
  - unpriced-project admission with per-project matchedCriteria.priceMax
  - ProjectDoc.sizeMinSqft / sizeMaxSqft + extractSizeRange + backfill script
  - MAX_ROWS / MAX_MATCHES cap split (toModelOutput + FinderRowSink)
  - FinderRowSchema + rows on FinderOutputSchema + optional per-match highlight
  - MatchTable - paginated Finder result table with a per-row chat action
affects:
  - Finder retrieval breadth for every budgeted or region-scoped query
  - the Finder chat rendering (table replaces cards when rows are present)
  - the persisted assistant envelope and messageMetadata payload
tech-stack:
  added: []
  patterns:
    - server-attached output fields (attachFinderRows mirrors attachCollateral, quick-071)
    - toModelOutput to bound model context while the client receives the full result
    - request-scoped tool sink read by the route
    - deterministic regex extraction into real schema fields, persisted by a dry-run-first backfill
key-files:
  created:
    - src/inventory/size-extract.ts
    - src/inventory/size-extract.test.ts
    - scripts/backfill-project-sizes.ts
    - tests/finder-corpus-gates.test.ts
    - src/agents/finder/tools.test.ts
    - app/[lang]/chat/match-table.tsx
    - app/[lang]/chat/match-table.test.ts
  modified:
    - src/inventory/search.ts
    - src/inventory/search.test.ts
    - src/firebase/collections.ts
    - src/agents/finder/schema.ts
    - src/agents/finder/tools.ts
    - src/agents/finder/prompt.ts
    - src/agents/finder/index.ts
    - src/agents/finder/finder.test.ts
    - app/api/chat/route.ts
    - app/api/chat/route.test.ts
    - app/[lang]/chat/decode-structured-output.ts
    - app/[lang]/chat/decode-structured-output.test.ts
    - app/[lang]/chat/decode-stream-chunk.ts
    - app/[lang]/chat/decode-stream-chunk.test.ts
    - app/[lang]/chat/chat-input.tsx
    - app/[lang]/chat/match-list.tsx
    - app/[lang]/chat/message-list.tsx
    - app/[lang]/chat/chat-shell.tsx
    - src/i18n/messages/en.json
    - src/i18n/messages/ms.json
    - src/i18n/messages/zh.json
decisions:
  - D4 - a region name ("Klang Valley", "greater KL", "Lembah Klang", CJK equivalent) carries no discriminating information, so the location gate is SKIPPED and matchedCriteria.locationPref stays null. No region-to-area mapping table.
  - D2 - unpriced projects (priceValue 0, 32 of 82) are ADMITTED when a budget is stated; the user was shown the tradeoff and chose it. Safe only because matchedCriteria.priceMax is per project, formatPrice(0) is null, and priceBand never reaches the client.
  - D1 - real ProjectDoc.sizeMinSqft/sizeMaxSqft populated by a deterministic regex and a one-off backfill; the table reads the stored fields and never re-parses prose. NOT added to EMBEDDING_RELEVANT_FIELDS, so no re-embed.
  - D3 - a short model-authored per-row highlight, presentation-only and optional; populated for the top ~8 rows the model sees and deliberately left empty below.
  - The cap was SPLIT, not raised - MAX_ROWS=100 for the client table, MAX_MATCHES=8 for the model via toModelOutput, plus a request-scoped sink the route reads.
  - toModelOutput returns { type: json, value } - the installed ai@5.0.193 requires LanguageModelV2ToolResultOutput, not a bare object (plan deviation, anticipated by the plan).
metrics:
  commits: 3
  mutation_checks: 12
  suite: 1248 passed / 0 failed / 197 skipped
  corpus_before: 5 of 82 after location, 3 after budget
  corpus_after: 82 of 82 after location, 50 after budget (18 priced + 32 unpriced)
  sizes_parsed: 66 of 82 (16 null, 6 mis-parses found by eye and guarded)
  completed: 2026-09-04
status: complete
---

# Quick Task quick-kayinleong-085: Finder result table Summary

The 5-card cap was never the bug - the location gate was matching "Klang Valley" as a literal
substring and surviving only 3 of 82 projects once a budget applied, so `MAX_MATCHES = 8` never
fired; fixing the region gate, admitting unpriced projects, adding real sqft fields and splitting
the cap turns that into 50 rows in one paginated table with a per-row "details + supporting
documents" action.

## What shipped

| commit | scope |
|---|---|
| `c279491` | D4 region-qualifier skip, D2 unpriced admission with per-project `matchedCriteria`, D1 size fields + extractor + backfill |
| `e061917` | the cap split - `MAX_ROWS` / `toModelOutput` / `FinderRowSink`, `FinderRowSchema`, `rows`, optional `highlight`, route + client plumbing |
| `1ce49c2` | `MatchTable`, the per-row action wired through the existing one-shot prompt path, `chat.matchTable.*` in en/ms/zh |

## Measured outcome

For `show me a list of 1mil property within Klang Valley` over the real 82-project corpus:

| stage | before | after |
|---|---|---|
| after location gate | 5 | **82** |
| after `priceMax 1,000,000` | 3 | **50** (18 priced + 32 unpriced) |

Real area filtering is unaffected: Cheras 0, Bangsar 8, Petaling Jaya 4 - all unchanged.

Size extraction: 66 of 82 parsed, 16 null. Six wrong ranges (facilities decks and land plots
folded into the built-up range) were found by reading all 82 lines against their source text and
are now guarded by `NON_BUILT_UP_LABEL`.

## Verification

All twelve mandated mutation checks were run, each failed its named test, each was reverted.
Mutation 8 found a real gap the plan predicted: a `priceBand` leak into `FinderRow` - the exact
hazard D2 rests on - passed the entire 1,412-test suite silently. That gap is now closed by a
schema-shape allowlist assertion.

Gates: `tsc --noEmit` exit 0 - `vitest run` 1248 passed / 0 failed (ten consecutive clean runs) -
`eslint app src tests` 0 errors, 77 pre-existing warnings - `npm run build` compiled successfully.

Full regression report, mutation table, parse audit and gate table: `CLAIM.md`.

## Not verified

Six items need a live authenticated browser and are listed in `CLAIM.md` section "Known gaps":
the end-to-end render, the row button's follow-up turn, 320/399/400/440px layout, the
reloaded-thread path, BM/CJK end to end, and the backfill `--apply` run. **Until `--apply` runs,
the Size column is correctly empty for every row.**

Flagged limitations: no re-embed (D1), Highlight populates the top ~8 rows only (D3 addendum),
and new inventory imports will not populate the size fields until the backfill is re-run.
