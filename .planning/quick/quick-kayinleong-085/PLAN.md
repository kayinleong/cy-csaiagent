---
phase: quick-kayinleong-085
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: false
requirements: [FIND-01, FIND-04, D-03, D-04]
files_modified:
  - src/inventory/search.ts
  - src/inventory/search.test.ts
  - src/inventory/size-extract.ts
  - src/inventory/size-extract.test.ts
  - src/firebase/collections.ts
  - scripts/backfill-project-sizes.ts
  - tests/finder-corpus-gates.test.ts
  - src/agents/finder/schema.ts
  - src/agents/finder/tools.ts
  - src/agents/finder/tools.test.ts
  - src/agents/finder/prompt.ts
  - src/agents/finder/index.ts
  - app/api/chat/route.ts
  - app/[lang]/chat/decode-structured-output.ts
  - app/[lang]/chat/decode-structured-output.test.ts
  - app/[lang]/chat/decode-stream-chunk.ts
  - app/[lang]/chat/decode-stream-chunk.test.ts
  - app/[lang]/chat/chat-input.tsx
  - app/[lang]/chat/match-table.tsx
  - app/[lang]/chat/match-table.test.ts
  - app/[lang]/chat/match-list.tsx
  - app/[lang]/chat/message-list.tsx
  - app/[lang]/chat/chat-shell.tsx
  - src/i18n/messages/en.json
  - src/i18n/messages/ms.json
  - src/i18n/messages/zh.json

must_haves:
  truths:
    - '"Klang Valley" no longer narrows the candidate set: the driving prompt yields ~50 rows, not 3 (D4)'
    - Every row shows a sqft range when the project description states one, read from stored fields and never re-parsed at render time (D1)
    - Unpriced projects appear in the same table with an empty price cell and never claim a budget match (D2)
    - The client renders every returned row (paginated 10/page) while the model still receives at most 8
    - Tapping a row's action button dispatches a follow-up chat turn naming that project and asking for its supporting documents
    - Every new table string exists in en/ms/zh and the table is reachable/scrollable at 440px
  artifacts:
    - src/inventory/size-extract.ts
    - scripts/backfill-project-sizes.ts
    - app/[lang]/chat/match-table.tsx
    - tests/finder-corpus-gates.test.ts
    - src/inventory/size-extract.test.ts
    - app/[lang]/chat/match-table.test.ts
  key_links:
    - REGION_ALIASES -> locationNeedles returns null -> location gate skipped -> matchedCriteria.locationPref stays null (no false location claim)
    - projectMatchesPrice admits priceValue 0 -> matchedCriteria.priceMax nulled PER PROJECT for unpriced rows (no false budget claim)
    - extractSizeRange -> backfill --apply -> ProjectDoc.sizeMinSqft/sizeMaxSqft -> ProjectMatch -> FinderRow -> size cell
    - searchProjects slices at MAX_ROWS -> tools.toModelOutput projects to MAX_MATCHES -> model context stays bounded
    - tool row sink -> route messageMetadata.finderRows AND doPersistAssistant -> attachFinderRows -> table has rows on both a live and a reloaded turn
    - onAsk forwarded chat-shell -> MessageList -> MatchList -> MatchTable -> handleSuggestion(prompt, 'finder') -> submittedSuggestion -> chat-input useEffect dispatch
---

<objective>
Property Finder returns every relevant match in one detailed table (price / size / rooms /
tenure / location / highlight) with a per-row action that asks the chat to expand that one
project with its supporting documents.

Purpose: the reported defect is NOT the card count. For the driving prompt
"show me a list of 1mil property within Klang Valley" the location gate survives only 5 of 82
projects and 3 of 82 once the budget applies, so `MAX_MATCHES = 8` never engages. D4 (region
qualifier) is the load-bearing change; a table shipped without it renders 3 rows and the
complaint is unfixed.

Output: retrieval fix + real size fields + a bounded-model / complete-client row split + the
table UI, implementing locked decisions D1-D4 from CONTEXT.md.

Scope discipline: this is a quick claim under minimal-fix rules. Nothing here refactors,
tidies, or "improves" code the four decisions do not require. Out-of-scope temptations are
listed in `<deferred>` and must NOT enter the diff.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/quick/quick-kayinleong-085/CONTEXT.md
@.planning/quick/quick-kayinleong-085/RESEARCH.md
@.planning/quick/quick-kayinleong-085/CLAIM.md
@CLAUDE.md
@AGENTS.md

Read-first source (do NOT re-read a range twice; anchors are current as of this plan):
- `src/inventory/search.ts` — `ProjectMatch` :115-138, `MAX_MATCHES` :221, `LOCATION_QUALIFIER_TOKENS` :237, `PLACE_TYPE_TOKENS` :249, `locationNeedles` :373-402, `projectMatchesLocation` :404-411, `projectMatchesPrice` :429-437, `searchProjects` :546, location gate :620-635, price gate :639-649, top-N slice :697, `matchedCriteria` build :718-731
- `src/firebase/collections.ts` — `priceBandFor` :207, `ProjectDoc` :215-268
- `src/agents/finder/schema.ts` — `FinderMatchSchema` :140-207, `FinderOutputSchema` :234
- `src/agents/finder/tools.ts` — `INLINE_COLLATERAL_MATCHES` :48, `makeSearchProjectsTool` :156-243
- `src/agents/finder/index.ts` — `makeTools` :111-121
- `src/agents/finder/prompt.ts` — collateral rule :89-93, Output Format :140-160
- `app/api/chat/route.ts` — `collateralByProject` :597, `doPersistAssistant` :649-690, `makeTools` call :783, `onStepFinish` harvest :879-910, `messageMetadata` :1219-1249
- `app/[lang]/chat/decode-structured-output.ts` — `normalizeFinderShape` :285, `dropUnrenderableMatches` :319, `decodeFinderOutput` :350, `attachCollateral` :385
- `app/[lang]/chat/decode-stream-chunk.ts` — `StreamMessageMetadata` :81-99, `parseMessageMetadata` :118-155
- `app/[lang]/chat/chat-input.tsx` — metadata capture :414, decode+attach :518, `submittedSuggestion` dispatch :606-615
- `app/[lang]/chat/match-list.tsx` — full file (394 lines), matches branch :125-137, `MatchCard` :168-285
- `app/[lang]/chat/message-list.tsx` — `MessageListProps` :54-59, Finder branch :123-133
- `app/[lang]/chat/chat-shell.tsx` — `handleSuggestion` :211-219, `<MessageList>` :311-316
- `app/[lang]/_components/paginator.tsx` — `usePagination` :53, `Paginator` :75
- `components/ui/table.tsx` — `Table` self-wraps in `relative w-full overflow-x-auto` :7-19
- `scripts/backfill-kbchunk-category.ts` — the dry-run / `--apply` / bulkWriter backfill pattern to mirror
- `src/inventory/search.test.ts` — mocks at :277-301 (`@/src/rag/embed`, `@/src/firebase/admin`, `@/src/firebase/collections`); location-gate suite :635-755
- `app/[lang]/chat/mobile-layout.test.ts` — the "source assertion that carries its reason" precedent
- `projects.inventory.json` (repo root) — `{ count: 82, records: [{ input: <ProjectDoc-shaped> }] }`. Real corpus. Do NOT re-measure it; reuse RESEARCH.md's cited counts.

Next.js 16: read `node_modules/next/dist/docs/` before writing any Next-specific code. This
claim adds no route, no Server Action, and no `cookies()`/`headers()` call, so the async-dynamic
and `proxy.ts` gotchas should not bite — if they do, stop and re-read the docs.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Retrieval correctness (D4 + D2) and real size fields (D1)</name>
  <files>src/inventory/search.ts, src/firebase/collections.ts, src/inventory/size-extract.ts, src/inventory/size-extract.test.ts, src/inventory/search.test.ts, tests/finder-corpus-gates.test.ts, scripts/backfill-project-sizes.ts</files>

  <behavior>
    - `locationNeedles('Klang Valley')` returns null (gate skipped, per D4) — as do 'greater KL', 'Lembah Klang', '巴生谷', and 'in the Klang Valley area'.
    - `locationNeedles('Cheras')` is still non-null and still survives 0 of 82; 'Bangsar' survives 8; 'Petaling Jaya' survives 4. D4 must not disable real area filtering.
    - `projectMatchesPrice(doc, null, 1_000_000)` returns true for a doc with `priceValue: 0` (D2 loosening) and false for `priceValue: 1_500_000`.
    - For the driving prompt over the real corpus: 82 candidates survive the (skipped) location gate; 50 survive `priceMax 1_000_000` — 18 priced within budget + 32 unpriced. (Counts from RESEARCH.md, measured.)
    - `searchProjects` sets `matchedCriteria.priceMax` to the requested bound ONLY for a project with a known price; an unpriced survivor gets `null`.
    - `extractSizeRange('1 Bedroom: 904 sqft')` -> `{ minSqft: 904, maxSqft: 904 }`.
    - `extractSizeRange('2+1 Bedrooms: 1,600 – 1,800 sqft | Penthouses: 2,900 – 4,855 sqft')` -> `{ minSqft: 1600, maxSqft: 4855 }` (global min/max across all layout lines).
    - `extractSizeRange('Maintenance Fee: RM0.65 psf')` -> null. `extractSizeRange('Asking RM1,200 per sq ft')` -> null. `extractSizeRange('Land Size: 8.5 acres')` -> null. `extractSizeRange('50m infinity pool')` -> null.
    - Every value the extractor emits satisfies `200 <= min <= max <= 20000`.
  </behavior>

  <action>
Implement D4, D2 and D1's data layer. Server-only, fully verifiable offline.

**1. D4 — region qualifier (`src/inventory/search.ts`)**

Add a `REGION_ALIASES` set of normalized multi-token region names next to
`LOCATION_QUALIFIER_TOKENS` (around :237): `klang valley`, `greater kl`, `greater kuala lumpur`,
`lembah klang`, `巴生谷`. Document WHY in a comment: the whole D2 corpus sits inside this region,
so matching it as a literal substring of `name + locationText` behaves like a narrow
neighbourhood filter (5 of 82 survive) — which is the reported defect. The correct behaviour is
identical to the existing bare-"Kuala Lumpur" handling: nothing discriminating survives, so the
gate is skipped.

In `locationNeedles` (:373-402), after `normalizeLocationText(rawSegment)` and BEFORE the
qualifier strip, `continue` past any segment whose normalized form is in `REGION_ALIASES`, and
also past a segment that reduces to a region once qualifier tokens are removed (so "in the Klang
Valley area" behaves the same as "Klang Valley"). Implement this by testing the
qualifier-filtered `meaningful.join(' ')` against `REGION_ALIASES` as well as the raw segment.
A `pref` that consists only of regions therefore yields zero groups, `locationNeedles` returns
null, `locationApplied` stays false, and `matchedCriteria.locationPref` stays null at :729 — no
row claims a location match it cannot back up. Do NOT add a region-to-area mapping table; that is
explicitly out of scope (D4 and the note at :366-370).

**2. D2 — admit unpriced projects (`src/inventory/search.ts`)**

Change `projectMatchesPrice` (:429-437) so `priceValue <= 0` no longer forces `false`: an unpriced
project passes the bound test (it is "unknown", not "out of range"). Keep both bounds inclusive
and keep the real comparison for known prices. `export` the function so the corpus test can call
it directly. Rewrite the doc comment: it currently asserts "the remedy is to backfill priceValue,
not to loosen the gate", which will contradict the code. Replace that paragraph with the D2
decision, the fact that the user was shown the tradeoff and chose it, and the two hard invariants
it depends on — the price cell renders empty for these rows, and `priceBand` is never used as a
price fallback because `priceBandFor(0)` labels every unpriced project as the cheapest band.

Then make `matchedCriteria` honest at :718-731. `priceMax` is currently
`priceApplied ? criteria.priceMax : null`, which after this change would make an unpriced
survivor claim a verified budget match. Make it per-project: the requested bound only when the
gate ran AND this project's own `priceValue` is a real positive number; otherwise null. Leave the
`locationPref`, `bedrooms`, `segment`, `nationality` and `bumiputera` lines untouched.

Leave the affordability gate at :653-666 alone — an unpriced project already passed
`0 <= ceiling` before this change, so its behaviour is unchanged and affordability is not
reported in `matchedCriteria`. Leave `MIN_RELEVANCE` and `applySegmentWeights` alone. Do not add
an unpriced-last tiebreak to the ranking: D2 says mix them in, and score order is the honest mix.

**3. D1 — size fields, extractor, backfill**

`src/firebase/collections.ts`: add two nullable optional fields to `ProjectDoc` next to
`bedrooms`: `sizeMinSqft?: number | null` and `sizeMaxSqft?: number | null`, documented as the
built-up sqft range across all layouts, deterministically extracted from `description` by
`src/inventory/size-extract.ts` and populated by `scripts/backfill-project-sizes.ts`. State in the
comment that they are deliberately NOT in `EMBEDDING_RELEVANT_FIELDS` (`src/inventory/crud.ts:90`)
per D1 — the sqft text already lives inside the embedded `description`, so numeric mirrors would
force a needless re-embed of 82 projects. Do not touch `EMBEDDING_RELEVANT_FIELDS`.

`src/inventory/size-extract.ts` (new, pure, zero imports): export
`extractSizeRange(description: string): { minSqft: number; maxSqft: number } | null`. Scan for
ALL numeric sqft mentions and return the global min and max.
- Number form: `\d{1,3}(?:,\d{3})+|\d{2,5}`, commas stripped before parsing.
- Unit form: only an explicit square-foot unit — `sqft`, `sq ft`, `sq. ft.`, `square feet`,
  `square foot`. Do NOT accept a bare `sf` alternative: it matches inside `psf` and would turn a
  per-square-foot PRICE into a size.
- Reject a candidate whose immediate left context (last ~24 chars) ends in a currency prefix or
  the word "per" — that is a psf price, not an area. Reject one whose right context begins with a
  psf/price word.
- Plausibility clamp: discard any value outside `[200, 20000]`. This is what kills acre land
  sizes, pool lengths and `RM0.65 psf`.
- A range written with a hyphen, en dash, em dash or the word "to" contributes both endpoints;
  a single mention contributes itself as both min and max.
- Return null when nothing plausible survives. Guarantee `min <= max`.
Explain each guard in a comment with the input it exists to reject, so the next reader does not
"simplify" the psf guard away.

`scripts/backfill-project-sizes.ts` (new): mirror `scripts/backfill-kbchunk-category.ts` exactly.
Dry run by default, `--apply` to write. Read the whole `projects` collection via `adminDb`
(`limit(500)`), compute `extractSizeRange(doc.description)` for each, and write ONLY
`{ sizeMinSqft, sizeMaxSqft }` via `bulkWriter().update()` — never `updateProject`, which would
trip `assertAdmin` and the re-embed delta check. Idempotent and safe to re-run: skip a doc whose
stored pair already equals the computed pair, so a second run reports zero writes and a run after
an extractor fix repairs only what changed. Never write any other field; never touch `embedding`
or `priceBand`. Print one line per project (name, extracted range or "null", and the source
substring that produced it) plus a summary: total / parsed / null / to-update / unchanged. Header
comment must state the two commands (dry run, then `--apply`) and that this needs
`--env-file=.env.local` for admin credentials.

**4. Tests**

`src/inventory/size-extract.test.ts` (new): (a) hand-written fixture cases covering every bullet
in `<behavior>` above including all four rejection traps; (b) a corpus sweep that loads
`projects.inventory.json`, runs `extractSizeRange` over every `records[].input.description`, and
asserts the parsed count, the null count, `200 <= min <= max <= 20000` for every result, and the
exact extracted range for at least six named projects verified by eye against their description
text. Do NOT invent the two counts — run the sweep in report mode first (Step B of `<verify>`),
review all 82 lines against their source text, then pin the observed numbers as assertions with a
comment recording the review date. If a value parses WRONGLY, fix the extractor; do not widen the
assertion to accommodate it.

`tests/finder-corpus-gates.test.ts` (new): import the real `locationNeedles`,
`projectMatchesLocation` and the newly exported `projectMatchesPrice` from
`@/src/inventory/search` and run them over `projects.inventory.json` `records[].input`. This file
needs the same three `vi.mock` blocks as `src/inventory/search.test.ts:277-301` because importing
the module pulls Firebase admin and the embed client. Assert every count in `<behavior>`. Record
the pre-fix numbers (Klang Valley 5 of 82, 3 with the budget) in comments as the regression this
file pins, and assert the post-fix numbers as the live expectation. If an actual count differs
from the RESEARCH figure, STOP and report the discrepancy — do not edit the expectation to match
what the code happens to do.

`src/inventory/search.test.ts`: add a D4 case (a Klang Valley query returns found:true with
`matchedCriteria.locationPref === null`), a D2 case (a fixture with `priceValue: 0` appears in the
result for a stated `priceMax` and its `matchedCriteria.priceMax` is null while a priced
survivor's is the requested bound), and keep every existing case green — especially the Cheras
refusal at :665 and the KLCC proximity guard at :716.
  </action>

  <verify>
    <automated>npx vitest run src/inventory/size-extract.test.ts tests/finder-corpus-gates.test.ts src/inventory/search.test.ts</automated>

Step B (run BEFORE pinning the counts, report mode, no writes):
`npx tsx --env-file=.env.local scripts/backfill-project-sizes.ts`
Review all 82 printed lines against the source description text. Report: how many of 82 parsed,
how many are null, and any that parsed wrongly (D1 requires all three numbers).

Step C (mutation checks — each one must FAIL the named test, then be reverted):
1. Delete `'klang valley'` from `REGION_ALIASES` -> `tests/finder-corpus-gates.test.ts` fails and
   the Klang Valley survivor count drops to 5. Revert.
2. Restore the `price <= 0` early return in `projectMatchesPrice` -> the 50-row assertion fails
   (becomes 18). Revert.
3. Remove the psf left-context guard from `extractSizeRange` -> the psf trap case in
   `src/inventory/size-extract.test.ts` fails. Revert.
4. Change `matchedCriteria.priceMax` back to the blanket `priceApplied` form -> the D2 honesty
   case in `src/inventory/search.test.ts` fails. Revert.
After all four reverts: `npx vitest run` is green.
  </verify>

  <done>
    - `locationNeedles` returns null for all five Klang Valley phrasings; `Cheras` / `Bangsar` / `Petaling Jaya` still yield 0 / 8 / 4 survivors over the real corpus.
    - The driving prompt's gate chain yields 82 -> 50 (18 priced + 32 unpriced) over `projects.inventory.json`, asserted in `tests/finder-corpus-gates.test.ts`.
    - An unpriced survivor's `matchedCriteria.priceMax` is `null`; a priced survivor's is the requested bound.
    - The stale `projectMatchesPrice` doc comment no longer contradicts the code.
    - `extractSizeRange` rejects psf prices, per-sq-ft prices, acre land sizes and metre measurements; all emitted values fall in [200, 20000] with `min <= max`.
    - `scripts/backfill-project-sizes.ts` dry-runs by default, writes only `sizeMinSqft`/`sizeMaxSqft`, and reports zero writes on an immediate second `--apply` run.
    - `EMBEDDING_RELEVANT_FIELDS` is unchanged (no re-embed).
    - All four mutations in Step C were performed, each failed its named test, and each was reverted.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Split the cap — bounded model payload, complete client rows, model-authored highlight (D3)</name>
  <files>src/inventory/search.ts, src/agents/finder/schema.ts, src/agents/finder/tools.ts, src/agents/finder/tools.test.ts, src/agents/finder/prompt.ts, src/agents/finder/index.ts, app/api/chat/route.ts, app/[lang]/chat/decode-structured-output.ts, app/[lang]/chat/decode-structured-output.test.ts, app/[lang]/chat/decode-stream-chunk.ts, app/[lang]/chat/decode-stream-chunk.test.ts, app/[lang]/chat/chat-input.tsx</files>

  <behavior>
    - `searchProjects` returns up to `MAX_ROWS` (100) matches; `MAX_MATCHES` (8) is now the MODEL cap only.
    - The `searchProjects` tool's `execute` returns the full result AND pushes a `FinderRow[]` projection of it into the request-scoped sink; `toModelOutput` projects the result down to at most `MAX_MATCHES` entries.
    - A serialized `toModelOutput` view of a 60-row result is under 8,000 characters and contains no `embedding`, `description` or `sizeMinSqft`-bearing 60-row payload; the sink still holds all 60 rows.
    - `attachFinderRows(output, rows)` sets `output.rows` to the server's ordered array, ADDING rows the model never emitted, and leaves the output untouched when `rows` is undefined or empty (older persisted turn).
    - A `highlight` present on `matches[i]` is joined to the row with the same `projectId`; a row with no matching match, or a match with an empty highlight, yields an empty highlight — never a thrown render.
    - `parseMessageMetadata` recovers `finderRows` from a `finish` chunk, drops malformed entries item by item, and returns no `finderRows` for a non-array value.
    - `FinderRow` carries no `priceBand`: a row cannot advertise `under_500k` for an unpriced project because the band never reaches the client.
  </behavior>

  <action>
Make the model's payload bounded while the client gets every row. The rows must come from tool
truth, not from what the model chose to retype.

**1. `MAX_ROWS` (`src/inventory/search.ts`)**

Add `export const MAX_ROWS = 100` next to `MAX_MATCHES` (:221) and change the slice at :697 to
use it. Document both: `MAX_ROWS` is a payload sanity ceiling for the CLIENT table (the corpus is
82 projects today; revisit above a few hundred), `MAX_MATCHES` remains the MODEL cap and keeps its
existing token sizing rationale — the tool result is re-sent on every step of the 5-step loop and
`TOKEN_CAP` is 300,000 per 24h per agent. Update the `MAX_MATCHES` comment so it no longer claims
to be the slice. Update the top-N cap case in `src/inventory/search.test.ts` (the suite at :980)
to assert the `MAX_ROWS` slice.

**2. `FinderRow` + `highlight` (`src/agents/finder/schema.ts`)**

Export `FinderRowSchema` and `type FinderRow` with exactly: `projectId` (min 1), `name` (min 1),
`priceValue` (number, 0 means unknown), `bedrooms` (number, 0 means unknown), `tenure`,
`locationText`, `vpStatus`, `bumiQuota`, `foreignEligible`, `sizeMinSqft` (nullable, default
null), `sizeMaxSqft` (nullable, default null), `score`. It is an allowlist: do NOT include
`priceBand` (a client that never receives it cannot render an unpriced project as the cheapest
band), `description` (2,553 chars average) or `embedding` (~8 KB per project). Say so in the
comment.

Add `rows: z.array(FinderRowSchema).default([])` to `FinderOutputSchema` (:234), documented as
SERVER-attached and never model-authored. Add
`highlight: z.string().min(1).max(120).optional()` to `FinderMatchSchema` (:140-207) with the D3
note: presentation only, model-authored, run-to-run variance accepted, must never be load-bearing
for filtering, ranking or `matchedCriteria`, and a missing value degrades to an empty cell.
`.optional()` and never required — `dropUnrenderableMatches` (:319) validates each match against
this schema, so a required new field would delete real matches (the quick-056 failure).

`decodeFinderOutput`'s populated-state check at :359-362 must stay as it is: `rows` alone is not
a populated state (the server only attaches rows to an envelope that already decoded).

**3. Tool: full truth out, bounded view to the model (`src/agents/finder/tools.ts`)**

Add `export type FinderRowSink = { rows: FinderRow[] }` and take an optional second parameter on
`makeSearchProjectsTool(userLang, sink?)`. Add a private `toFinderRow(m: ProjectMatch): FinderRow`
projection. Inside `execute`, after the collateral attach at :225-241 and before returning:
when the result is `found` and a sink was passed, replace the sink's contents with
`result.matches.map(toFinderRow)` (replace, not append — the prompt already tells the model that
only the CURRENT search result counts, so the last search wins).

Add `toModelOutput` to the `tool({...})` options: project the result to at most `MAX_MATCHES`
entries, preserving the existing per-match shape (including inline collateral for the top
`INLINE_COLLATERAL_MATCHES`, unchanged at 3) and passing `found:false` results through untouched.
`toModelOutput` is confirmed present in the installed `ai@5.0.193`
(`node_modules/@ai-sdk/provider-utils/dist/index.d.ts:772`) — verify that line before writing, and
if the signature differs from expectation read the installed types rather than guessing.

Both mechanisms are deliberate and each does one job: `toModelOutput` bounds what the MODEL sees
(the CONTEXT constraint), the sink is what the ROUTE reads. The sink exists because
`onStepFinish` receiving raw-vs-projected tool output is an SDK semantics question this claim
cannot settle offline; reading the sink removes that from the critical path. Do not delete either
one as redundant.

`src/agents/finder/index.ts`: thread an optional fourth parameter through
`makeTools(userLang, agentUid?, leadId?, rowSink?)` into `makeSearchProjectsTool`. Optional, so
`ReturnType<typeof finderAgent.makeTools>` — the type `app/api/chat/route.ts:750-753` depends on —
is unchanged.

**4. Prompt (`src/agents/finder/prompt.ts`)**

Mirror the existing collateral rule at :89-93 and the Output Format list at :140-160:
- Omit the `rows` field entirely; the system attaches the full result table. Whatever the model
  writes there is replaced.
- The table shows the complete result set, so the model does not need to transcribe it. Keep
  writing `matches` for the strongest handful the tool returned, with a rationale each — that is
  the narrative shortlist, not the result list.
- Add `highlight`: one short phrase (max ~15 words), the single most useful concrete fact about
  this project from the tool result — never invented, never a price for a project whose
  `priceValue` is 0, and omitted entirely rather than padded when there is nothing concrete.
Do NOT tell the model to enumerate every project: the model only sees `MAX_MATCHES` and a longer
output lengthens a turn that already gets killed mid-flight (quick-067/070).

**5. Route plumbing (`app/api/chat/route.ts`)**

Next to `collateralByProject` (:597) declare `const finderRowSink = { rows: [] as FinderRow[] }`.
Pass it as the fourth argument at :783. In `doPersistAssistant` (:663-673), extend the existing
finder enrichment so the stored body also carries the rows — the condition currently requires a
non-empty `collateralByProject`, so widen it to fire when EITHER collateral or rows exist, then
apply `attachCollateral` and `attachFinderRows` to the decoded envelope before re-serialising.
This is the quick-072 lesson and it is load-bearing: `messageMetadata` fires only on `start` and
`finish` (:1224-1228), so a truncated turn's rows must already be in the persisted row or a
reloaded thread renders an empty table. In `messageMetadata` at :1236-1248 add
`finderRows: pillar === 'finder' && finderRowSink.rows.length > 0 ? finderRowSink.rows : undefined`.
Leave `onStepFinish` (:879-910) alone.

**6. Client plumbing**

`app/[lang]/chat/decode-structured-output.ts`: add `attachFinderRows(output, rows)` beside
`attachCollateral` (:385), same contract — pure, server-truth-wins, and a no-op when `rows` is
undefined or empty so an older persisted turn renders exactly as before. Unlike
`attachCollateral` it ADDS rows the model never emitted; that is the point, and it is why the
table renders from `rows` rather than from `matches`.

`app/[lang]/chat/decode-stream-chunk.ts`: add `finderRows?: FinderRow[]` to
`StreamMessageMetadata` (:81-99) and validate it in `parseMessageMetadata` (:118-155) with the
same item-by-item discipline as `collateralByProject` (:140-152) — parse each entry through
`FinderRowSchema.safeParse` and drop failures rather than rendering a malformed row.

`app/[lang]/chat/chat-input.tsx`: alongside `serverCollateral` (:414) capture
`serverFinderRows` from the metadata, and at :518 chain
`attachFinderRows(attachCollateral(decoded, serverCollateral), serverFinderRows)`. Add the import
at :44. Nothing else in this file changes.

**7. Tests**

`src/agents/finder/tools.test.ts`: build a 60-match `found:true` fixture and assert — `execute`
returns all 60; the sink holds all 60; `toModelOutput` yields at most 8 entries;
`JSON.stringify(toModelOutput(result)).length < 8000`; the serialized model view contains no
`embedding` and no `description` key; a `found:false` result passes through `toModelOutput`
unchanged. Follow the mock pattern in `src/inventory/search.test.ts:277-301`.

`app/[lang]/chat/decode-structured-output.test.ts`: `attachFinderRows` adds unemitted rows,
preserves server order, is a no-op for undefined/empty rows, and a round trip through
`decodeFinderOutput` of an envelope carrying a `highlight` keeps it while an envelope carrying a
model-written `rows` value still ends up with the server's rows after attach.

`app/[lang]/chat/decode-stream-chunk.test.ts`: `finderRows` parsed from a `finish` chunk; a
malformed entry dropped while its valid siblings survive; a non-array value yields no
`finderRows`.
  </action>

  <verify>
    <automated>npx vitest run src/agents/finder src/inventory app/[lang]/chat/decode-structured-output.test.ts app/[lang]/chat/decode-stream-chunk.test.ts</automated>

Mutation checks (each must FAIL the named assertion, then be reverted):
1. Remove `toModelOutput` from the tool options -> the `< 8000` character assertion in
   `src/agents/finder/tools.test.ts` fails. Revert.
2. Stop writing to the sink in `execute` -> the "sink holds all 60" assertion fails. Revert.
3. Make `attachFinderRows` enrich only existing matches instead of setting `rows` -> the
   "adds unemitted rows" assertion in `decode-structured-output.test.ts` fails. Revert.
4. Add `priceBand` to `FinderRowSchema` -> confirm no test catches it, then remove it and add the
   assertion that closes that hole: `FinderRowSchema` has no `priceBand` key. This is the one gap
   the mutation exercise finds rather than confirms; fix it.
Then: `npx vitest run` green.
  </verify>

  <done>
    - `searchProjects` slices at `MAX_ROWS = 100`; `MAX_MATCHES = 8` documents itself as the model cap and is consumed in `tools.ts`.
    - A 60-row result serializes to under 8,000 chars for the model while the sink holds all 60; both are asserted.
    - `FinderRowSchema` has no `priceBand`, `description` or `embedding` key, asserted by test.
    - `attachFinderRows` adds server rows the model never emitted and is a no-op for an older persisted turn.
    - Rows reach the client on BOTH paths: `messageMetadata.finderRows` on a completed turn, and the persisted envelope on a truncated one.
    - `highlight` is optional on `FinderMatchSchema`, so `dropUnrenderableMatches` still keeps a match that omits it.
    - `INLINE_COLLATERAL_MATCHES` is still 3 and `onStepFinish` is unchanged.
    - All four mutations were performed with the stated outcomes; mutation 4's gap is closed by a new assertion.
  </done>
</task>

<task type="auto">
  <name>Task 3: The table, the per-row action, and trilingual strings</name>
  <files>app/[lang]/chat/match-table.tsx, app/[lang]/chat/match-table.test.ts, app/[lang]/chat/match-list.tsx, app/[lang]/chat/message-list.tsx, app/[lang]/chat/chat-shell.tsx, src/i18n/messages/en.json, src/i18n/messages/ms.json, src/i18n/messages/zh.json</files>

  <action>
Render the rows as one paginated table with a per-row action, in three languages, on a 440px
phone.

**1. `app/[lang]/chat/match-table.tsx` (new, `'use client'` — it uses `usePagination` and
`useTranslations`)**

Props: `{ rows: FinderRow[]; matches: FinderMatch[]; onAsk?: (prompt: string) => void; className?: string }`.

Build the display rows by joining each `FinderRow` to `matches` on `projectId` to pick up
`highlight` (and nothing else). Server row order is the ranking — preserve it. `usePagination(displayRows, 10)`
+ `<Paginator>` from `app/[lang]/_components/paginator.tsx` (the D1-discretion default; the
`pagination.previous|next|pageOf` keys already exist in all three catalogs). Above the table,
render the total count from `chat.matchTable.rowCount`.

Compose the vendored `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableBody`/`TableCell` from
`@/components/ui/table`. It already wraps itself in `relative w-full overflow-x-auto` (:7-19) —
that IS the horizontal-scroll affordance, so do not add another scroll container and do not add
any horizontal-centring utility to it (see `<done>` item 4 for the exact class and the quick-081
reason: centring an overflowing scroll container clips BOTH ends).

Columns, in order: Name · Price · Size · Beds · Tenure · Location · Highlight · Action.
Reuse the already-trilingual `inventory.colName|colPrice|colTenure|colBedrooms|colLocation|colActions`
via a second `useTranslations('inventory')` hook, and add only the genuinely new headers under
`chat.matchTable`. That keeps the new-string count and the translation burden minimal.

Make the Name cell (header and body) stick to the left edge inside the scroll container with
`sticky left-0 z-10` plus an opaque background, so scrolling right does not lose which row you
are on. Keep the `projectId` in a `title` attribute and a `data-project-id` on the row — it is the
grounding citation (D-04) and the admin key, exactly as `match-list.tsx:176` does today.

Export two pure formatters so they are unit-testable in the `node` vitest environment (there is
no jsdom in this repo, so component rendering is not available):
- `formatPrice(priceValue: number): string | null` — null for `priceValue <= 0` or a non-finite
  value. NEVER a zero-valued currency string, and never derived from a price band. The cell
  renders an em dash for null with the `chat.matchTable.priceUnknown` text as its `title` and
  screen-reader label. This is D2's hard invariant: an unpriced row must not claim a budget match.
- `formatSize(min: number | null, max: number | null): string | null` — null when either bound is
  missing; a single number when they are equal; otherwise `min–max`, thousands-separated, with the
  unit in the column header rather than repeated per cell.
Beds renders an em dash when `bedrooms <= 0` (0 means unknown on 29 of 82 projects). Location is
truncated with `truncate` and carries the full text in `title`. Highlight renders an empty cell
when absent.

The action cell is a `<Button variant="ghost" size="sm">` with `min-h-11` (the 44px touch-target
floor this repo uses), labelled `chat.matchTable.showMore`, `aria-label` from
`chat.matchTable.showMoreAria` with the project name, disabled when `onAsk` is absent. On click it
calls `onAsk(t('showMorePrompt', { name, projectId }))`. The prompt template MUST be a translated
key, not an English literal: the agent replies in the language of the incoming message, so an
English prompt would flip a BM or 中文 conversation to English. Include the `projectId` in the
template — it is the grounding citation and it lets the Finder's `answer` branch and
`fetchCollateral` pick up files the search's inline top-3 missed.

**2. Wire it in**

`match-list.tsx`: add `onAsk?: (prompt: string) => void` to `MatchListProps`. In the
`matches.length > 0` branch (:125-137), render `<MatchTable>` when `output.rows` is non-empty and
keep the existing `MatchCard` list as the fallback when it is empty (an older persisted turn, or a
turn whose rows never arrived). Leave the clarifying-question, refusal and answer branches at
:69-122 exactly as they are, and leave `MatchCard`, `criteriaToLabels` and the icons untouched.
Update the file header comment: it now composes a client child, and the whole subtree is already
inside the `'use client'` `chat-shell.tsx` island, so a function prop crossing into it is fine.
Do NOT retro-internationalize the existing hardcoded English at :97, :148 and :249 — out of scope
(see `<deferred>`).

`message-list.tsx`: add `onAsk?: (prompt: string) => void` to `MessageListProps` (:54-59) and
forward it to `<MatchList>` (:130). This file hand-lists the props it forwards, which is exactly
how quick-080 silently dropped `onLeadRequired` — the guard test below pins it.

`chat-shell.tsx`: pass `onAsk={(prompt) => handleSuggestion(prompt, 'finder')}` to `<MessageList>`
(:311-316). `handleSuggestion` (:211) already sets `submittedSuggestion`, which
`chat-input.tsx:606-615` picks up by `id` and dispatches with that pillar for that send only. Reuse
this path exactly; invent nothing.

**3. Strings (all three catalogs, identical key sets)**

Add under `chat.matchTable`: `colSize`, `colHighlight`, `showMore`, `showMoreAria`,
`showMorePrompt`, `priceUnknown`, `rowCount`, `notOnRecord`. Write real BM and 中文 —
`src/i18n/__tests__/i18n-parity.test.ts` fails the moment a key exists in one catalog and not the
others, and a copy-pasted English value is worse than a missing one. `showMorePrompt` takes
`{name}` and `{projectId}`; `showMoreAria` takes `{name}`; `rowCount` takes `{count}`.

**4. `app/[lang]/chat/match-table.test.ts` (new)**

Real assertions where the `node` environment allows, source assertions that carry their reason
where it does not — the `app/[lang]/chat/mobile-layout.test.ts` precedent.
- Unit-test the exported formatters: `formatPrice(0)` and `formatPrice(-1)` are null;
  `formatPrice(950000)` is a formatted RM string; `formatSize(null, 1800)` is null;
  `formatSize(904, 904)` is a single number; `formatSize(1600, 1800)` is a range.
- i18n cross-check, not a grep: parse every `t('...')` key out of `match-table.tsx` and assert each
  one resolves in `en.json`, `ms.json` AND `zh.json` under the namespace it was called with. This
  is falsifiable — adding a `t('nope')` call must fail it.
- Prop-forwarding guard (the quick-080 lesson): assert `chat-shell.tsx` passes `onAsk` to
  `MessageList`, `message-list.tsx` forwards `onAsk` to `MatchList`, and `match-list.tsx` forwards
  `onAsk` to `MatchTable`.
- Mobile guards with their reasons: the source must not contain the horizontal-centring utility
  named in `<done>` item 4; it must not gate any wrap on Tailwind's `sm` breakpoint (640px, which
  is wider than the 440px target device — the quick-083 regression); the Name cell must carry the
  sticky-left classes; the action button must carry `min-h-11`.
  </action>

  <verify>
    <automated>npx vitest run app/[lang]/chat src/i18n</automated>

Mutation checks (each must FAIL and name the offending file, then be reverted):
1. Delete the `onAsk` forward in `message-list.tsx` -> the prop-forwarding guard fails naming
   `message-list.tsx`. Revert.
2. Make `formatPrice` fall back to a zero-valued currency string for `priceValue: 0` -> the
   `formatPrice(0)` assertion fails. Revert.
3. Remove the `ms.json` entry for `chat.matchTable.showMorePrompt` -> both the i18n cross-check in
   `match-table.test.ts` AND `src/i18n/__tests__/i18n-parity.test.ts` fail. Revert.
4. Add a horizontal-centring utility to the table wrapper -> the quick-081 guard fails. Revert.
Then: `npx vitest run` green.
  </verify>

  <human-check>
NOT provable offline — this repo has a history of claims whose data-render path was never
smoke-tested (quick-080 was found only by signing into a real browser). The following requires a
live authenticated session and MUST be done before the claim is marked done:

Prerequisite: `npx tsx --env-file=.env.local scripts/backfill-project-sizes.ts --apply` has been
run against the live Firestore. Until it has, the Size column is correctly empty for every row —
the table is not broken, the data is not there yet.

1. `npm run dev`, sign in, open `/en/chat`, select the Finder pillar.
2. Send: `show me a list of 1mil property within Klang Valley`.
3. Confirm: a table, not cards. Roughly 50 rows, paginated 10 per page, Prev/Next working.
4. Confirm: unpriced rows show an em dash in Price — never `RM 0` and never a price band — and
   their criteria line does not claim a budget match.
5. Confirm: Size shows a sqft range for the projects whose description states one.
6. Tap a row's action button. Confirm a new turn is dispatched, the reply is prose about that one
   project, and its supporting documents are listed.
7. Repeat step 2 in BM and 中文. Confirm the headers, the button and the dispatched prompt are all
   translated, and that the reply comes back in that language.
8. DevTools device mode at 320 / 399 / 400 / 440 px: the Name column stays pinned while the rest
   scrolls horizontally; neither end of the scroll strip is clipped; nothing overflows the
   viewport. Measure in-page rather than eyeballing (the quick-083 lesson).
9. Reload the thread. Confirm the table renders from the persisted envelope with all rows intact
   (this is the truncated-turn path).
  </human-check>

  <done>
    - Finder matches render as one paginated table (10/page) with Name · Price · Size · Beds · Tenure · Location · Highlight · Action, sourced from `output.rows`.
    - `MatchCard` remains the fallback when `rows` is empty; the clarifying-question, refusal and answer branches are byte-identical to before.
    - `formatPrice(0)` returns null and no cell can render a zero-valued price or a price band.
    - `onAsk` is forwarded chat-shell -> MessageList -> MatchList -> MatchTable and lands on `handleSuggestion(prompt, 'finder')`; no new dispatch mechanism was invented.
    - `chat.matchTable.*` has identical key sets in en/ms/zh with real translations; `src/i18n/__tests__/i18n-parity.test.ts` is green.
    - `match-table.tsx` contains no `justify-center` and no `sm:`-gated wrap; the Name cell carries `sticky left-0`; the action button carries `min-h-11`.
    - `app/[lang]/chat/mobile-layout.test.ts` and `tests/dialog-mobile-width.test.ts` are still green (no dialog and no chat-header change in this claim).
    - No new dependency in `package.json` (`@tanstack/react-table` stays absent).
    - All four mutations were performed with the stated outcomes and reverted.
    - The `<human-check>` list above has been executed in a real authenticated browser and its results recorded in `CLAIM.md`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tool result -> model context | Every tool result is re-sent on all 5 steps of the Finder loop; size is a cost and availability concern, not just a latency one |
| server -> client | `messageMetadata` + the persisted message envelope now carry a 100-row array; whatever is in `FinderRow` reaches the browser and the Firestore message doc |
| model output -> rendered UI | `highlight` is model-authored free text rendered in a table cell |
| local operator -> Firestore | the backfill script writes to the live `projects` collection outside the `assertAdmin` Server-Action gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-085-01 | Denial of Service | `searchProjects` -> Finder model loop | high | mitigate | `MAX_ROWS` ceiling caps the payload and `toModelOutput` caps the model view at `MAX_MATCHES`; Task 2 asserts a 60-row result serializes under 8,000 chars for the model, so the 300,000/24h `TOKEN_CAP` cannot be drained by a single wide turn |
| T-085-02 | Information Disclosure | `FinderRow` -> client + persisted message doc | medium | mitigate | `FinderRowSchema` is a strict allowlist with no `embedding` (~8 KB/project) and no `description` (2,553 chars avg); asserted by test. Zod strips anything else |
| T-085-03 | Tampering (grounding) | `matchedCriteria` on unpriced survivors | high | mitigate | D2 loosens the price gate, so `matchedCriteria.priceMax` becomes per-project and is nulled for `priceValue <= 0`; `formatPrice` returns null for those rows and `priceBand` is excluded from `FinderRow` entirely, so no row can advertise `under_500k` |
| T-085-04 | Tampering (grounding) | location gate skip for a region qualifier | medium | mitigate | `locationNeedles` returning null leaves `locationApplied` false, so `matchedCriteria.locationPref` stays null and no row claims a Klang Valley match; `tests/finder-corpus-gates.test.ts` pins that Cheras/Bangsar/Petaling Jaya filtering still works, so the skip cannot be over-broad |
| T-085-05 | Tampering (grounding) | `status:'active'` enforcement under a "return everything" change | high | mitigate | rows are projected from `searchProjects` output only; no second query path is added, and `projectsRef().where('status','==','active')` at `search.ts:554` is untouched |
| T-085-06 | Elevation of Privilege | `scripts/backfill-project-sizes.ts` | medium | mitigate | dry-run by default; `--apply` writes only `sizeMinSqft`/`sizeMaxSqft` via `bulkWriter`; operator-run locally with `--env-file=.env.local`; no server route, Server Action or client surface is added; idempotent so a mistaken re-run is a no-op |
| T-085-07 | Spoofing / Injection | model-authored `highlight` rendered in a cell | low | accept | capped at 120 chars, rendered as text (not markdown, not `dangerouslySetInnerHTML`), presentation-only and never load-bearing for filtering, ranking or `matchedCriteria` per D3 |
| T-085-08 | Repudiation | audit trail | low | accept | no change to the audit path; this claim adds no client-related conversation write and logs no PII |

No package-manager install task appears in this plan (`<constraints>`: no new dependency), so no
`T-085-SC` supply-chain checkpoint is required. If any task turns out to need an install, STOP:
that needs a `## Package Legitimacy Audit` in RESEARCH.md and a blocking human checkpoint first.
</threat_model>

<source_audit>
## Multi-Source Coverage Audit

| # | Source | Item | Covered by | Status |
|---|--------|------|-----------|--------|
| 1 | CONTEXT D1 | Real `sizeMinSqft`/`sizeMaxSqft` fields on `ProjectDoc` | Task 1 | COVERED |
| 2 | CONTEXT D1 | Deterministic regex extractor, fixture-tested | Task 1 (`src/inventory/size-extract.ts` + test) | COVERED |
| 3 | CONTEXT D1 | One-off idempotent backfill that persists them | Task 1 (`scripts/backfill-project-sizes.ts`) | COVERED |
| 4 | CONTEXT D1 | Table renders from the real fields, never re-parsing prose | Task 2 (`FinderRow`) + Task 3 (`formatSize`) | COVERED |
| 5 | CONTEXT D1 | Report parsed / null / wrongly-parsed counts over all 82 | Task 1 `<verify>` Step B | COVERED |
| 6 | CONTEXT D1 | Do NOT add size to `EMBEDDING_RELEVANT_FIELDS`; flag in summary | Task 1 action + `<deferred>` | COVERED |
| 7 | CONTEXT D1 | `developer` and `bathrooms` out of scope | not planned, by decision | EXCLUDED |
| 8 | CONTEXT D2 | Unpriced projects mixed into the flat table with a blank price cell | Task 1 (`projectMatchesPrice`) + Task 3 (`formatPrice`) | COVERED |
| 9 | CONTEXT D2 | Update the comment that contradicts the loosened gate | Task 1 | COVERED |
| 10 | CONTEXT D2 | Unpriced row never claims a budget match; `priceBand` never a price fallback | Task 1 (per-project `matchedCriteria`) + Task 2 (`priceBand` excluded from `FinderRow`) | COVERED |
| 11 | CONTEXT D3 | Model-authored per-row `highlight`, prompted, presentation-only, degrades to empty | Task 2 (schema + prompt) + Task 3 (cell) | COVERED |
| 12 | CONTEXT D4 | "Klang Valley" as a non-discriminating region alias; gate skipped; `locationPref` null | Task 1 (`REGION_ALIASES`) | COVERED |
| 13 | CONTEXT D4 | No region-to-area mapping table | not planned, by decision | EXCLUDED |
| 14 | CONTEXT discretion | 10 rows/page via existing `usePagination` default | Task 3 | COVERED |
| 15 | CONTEXT constraint | Attributes added to the Finder schema or Zod strips them | Task 2 (`FinderRowSchema` + `rows` on `FinderOutputSchema`) | COVERED |
| 16 | CONTEXT constraint | Split the cap with `toModelOutput`; do not just raise `MAX_MATCHES` | Task 2 | COVERED |
| 17 | CONTEXT constraint | 440px mobile; `mobile-layout.test.ts` + `dialog-mobile-width.test.ts` stay green | Task 3 guards + `<human-check>` step 8 | COVERED |
| 18 | CONTEXT constraint | New strings in en/ms/zh or `i18n-parity.test.ts` fails | Task 3 | COVERED |
| 19 | CONTEXT constraint | Reuse the existing one-shot prompt path for the row button | Task 3 (`handleSuggestion` -> `submittedSuggestion`) | COVERED |
| 20 | CONTEXT constraint | Supporting documents via `CollateralDoc`; no KB-chunk join | Task 3 (row button asks for documents; `fetchCollateral` serves the follow-up turn) | COVERED |
| 21 | CONTEXT constraint | `status:'active'`, source-ID citations, no hard-coded model ID, `tenantId` | T-085-05; `projectId` kept on every row; nothing touches `modelFor` | COVERED |
| 22 | CONTEXT constraint | No new dependency; no new Firestore index | Task 3 `<done>`; scoring stays an in-memory dot product | COVERED |
| 23 | RESEARCH Move 1 | Decide `tenurePref` (accepted by `inputSchema`, dropped by `execute`) | not planned | DEFERRED — see `<deferred>` |
| 24 | RESEARCH pitfall 5 | RSC -> client serialization of `vpDate` | avoided: `vpDate` is not a `FinderRow` field and not a column | EXCLUDED |
| 25 | CLAIM.md | "Retrieval should query the database AND check embeddings" | already true today (`search.ts` Stage A Firestore gate + Stage B dot product); Task 1 removes the region gate that was hiding it | COVERED |

No unplanned items. Every locked decision has an implementing task, and no deferred idea from
CONTEXT.md appears in the plan.
</source_audit>

<deferred>
Tempting, adjacent, and deliberately NOT in this diff. Minimal-fix discipline: each of these is a
separate claim.

1. **`tenurePref` is a false affordance.** `tools.ts:184` accepts it and `execute` (:191-205) never
   forwards it to `searchProjects`. RESEARCH flagged it; it is not one of the four decisions.
2. **`match-list.tsx` retro-i18n.** The existing hardcoded English at :97, :148 and :249 stays.
   Only the NEW table strings are translated, which is what parity requires.
3. **New projects get null sizes.** D1 scoped this to a one-off backfill, so neither `createProject`
   nor `scripts/scrape-skool/to-inventory.ts` populates the size fields. Mitigation until a
   follow-up claim: re-run `scripts/backfill-project-sizes.ts --apply` after every inventory import.
4. **No re-embed.** Per D1 the new size fields stay out of `EMBEDDING_RELEVANT_FIELDS`; the sqft
   text is already inside the embedded `description`, so semantic recall is unaffected. Flag this
   explicitly in the claim summary rather than letting it pass silently.
5. **Highlight only populates the top rows.** The model writes `highlight` only for the matches it
   sees, and CONTEXT caps that at ~8. On a 50-row table the Highlight column is populated for the
   strongest handful and empty below. Widening it means sending all 100 rows to the model, which is
   the token blowup CONTEXT forbids. The concrete attribute columns carry every row.
6. **Inline collateral stays at the top 3.** `INLINE_COLLATERAL_MATCHES` is unchanged, so only 3
   rows can show files inline; the row button is the path to files for the rest. Raising it re-opens
   the quick-054 blowup (collateral is re-sent on every step).
7. **Unpriced rows are not sorted last.** D2 says mix them in; relevance order is the honest mix.
   A "priced first" tiebreak is a ranking change nobody asked for.
8. **`embedding` still ships to the inventory admin client.** Pre-existing STATE deferred item from
   quick-030, unrelated to this claim. `FinderRow` does not carry it.
9. **Persisted envelope grows.** A 50-row envelope is roughly 10-12 KB of JSON in a message doc
   (limit 1 MB). Accepted.
</deferred>

<verification>
Gate commands, in order, all four must pass before the claim is done:

```
npx tsc --noEmit
npx vitest run
npx eslint app src tests scripts
npm run build
```

Provable offline (and therefore mandatory before any commit):
- the D4 region alias, by real match counts over `projects.inventory.json`
- the D2 price-gate loosening, by the same corpus counts
- `matchedCriteria` honesty for unpriced survivors
- `extractSizeRange` correctness and its four rejection traps
- the cap split, by a serialized-size assertion on `toModelOutput` plus a completeness assertion
  on the sink
- `attachFinderRows` adding unemitted rows, and metadata parsing
- `formatPrice(0)` never producing a price
- i18n key parity across all three catalogs
- prop forwarding chat-shell -> MessageList -> MatchList -> MatchTable

NOT provable offline — needs a live authenticated browser (Task 3 `<human-check>`):
- that the table actually renders with data end to end (the exact class of bug quick-080 was)
- that the row button's dispatched turn returns prose plus supporting documents
- layout behaviour at 320 / 399 / 400 / 440 px
- that the reloaded-thread path renders rows from the persisted envelope
- that the backfill's `--apply` run populated the live `projects` collection

Every guard test added by this plan must be validated by reintroducing the bug it guards (the
mutation lists in each task's `<verify>`). A source-grep test that has never been seen to fail is
not evidence. Record each mutation, its observed failure, and the revert in the `## Verification`
section of `CLAIM.md`.
</verification>

<success_criteria>
- `show me a list of 1mil property within Klang Valley` returns ~50 rows in one paginated table, not 3 rows and not 5 cards.
- Price, Size, Beds, Tenure, Location and Highlight are visible per row; unpriced rows show an empty price and claim no budget match.
- The model still receives at most 8 matches; a 60-row result's model view is under 8,000 serialized characters.
- Tapping a row's action button dispatches a Finder turn for that one project and returns its supporting documents.
- All four gate commands pass; `i18n-parity`, `mobile-layout` and `dialog-mobile-width` are green.
- All twelve mutation checks were performed, each failed its named test, and each was reverted.
- `CLAIM.md` has a filled `## What has changed` and a `## Verification` section containing the Regression Report and the browser-check results.
</success_criteria>

<output>
This is a quick claim, not a phase. Do NOT write a SUMMARY file.

On completion, update `.planning/quick/quick-kayinleong-085/CLAIM.md`:
- `## What has changed` — the four decisions as implemented, with the files touched
- `## Verification` — the Regression Report: what was tested, what passed, what was ruled out and
  why, the twelve mutation results, the backfill's parsed/null/wrong counts, and the browser-check
  outcomes
- front-matter `status: done`
- flag in the summary: the no-re-embed decision (deferred item 4) and the top-rows-only Highlight
  limitation (deferred item 5)

Commit per task with the owner-scoped prefix: `fix(quick-kayinleong-085): …`. Do not push without
explicit user confirmation (standing instruction in STATE.md).
</output>
