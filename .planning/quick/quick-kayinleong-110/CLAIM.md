# Claim: quick-kayinleong-110
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-110 (from origin/main f4d845a)
- started: 2026-11-27
- status: done
- summary: When nothing matches the area or budget, the Finder explains why and suggests alternatives: projects slightly above the budget in the same area, and projects in other areas within the budget. Every search answer ends with a summary (what you asked, what fits, what I suggest).

## The request
"let say if the property and price we wanted isnt in the list but AI will justify why and suggest something else ... 'im looking for 1.5mil in bangsar' but there's no 1.5mil in bangsar and ai can suggest other project but could be slightly higher price". The user chose to allow other areas too. "the AI also can ends with: summarise what i want and then what AI can suggest".

This reverses part of the quick-050/098 rule ("never answer an area with projects from a different area"). It stays honest because:
- the SERVER picks every alternative;
- each one is labelled, as over budget by a stated amount or as in another area named by its own address;
- none is ever presented as a match;
- nothing is phrased as near (there is no distance data).

## What will change
**Wave 1 (shared contract, orchestrator)**
- `src/agents/finder/schema.ts`:
  - `FinderRow` gains `alternative` ('over_budget' | 'other_area'), `overBudgetRM` and `overBudgetPct`.
  - `FinderOutput` gains `summary` ({ asked, found, suggestion }, model-written, optional, clipped, never rejects).

**Wave 2 (parallel, file-disjoint)**
- A. Orchestrator:
  - `src/inventory/search.ts`: a no_match emptied by the location or price gate carries `alternatives`:
    - over budget: same area (in-area only), a stated from price over `priceMax` by at most 30%, within the income ceiling, cheapest first, at most 3;
    - other areas: outside the requested area, same property type, within the budget with a price on record, within the income ceiling, ranked by relevance above the floor, at most 3.
  - `src/agents/finder/tools.ts`: alternatives become table rows and summaries. A no_match REPLACES the rows, so no stale table. The model sees alternatives without layouts or details.
  - `app/api/chat/route.ts`: the saved refusal also carries its rows and summaries.
  - `src/agents/finder/prompt.ts`: alternatives rules and the summary rule.
  - Tests for each.
- B. UI agent (`app/[lang]/chat/*`, `src/i18n/messages/*.json`):
  - the refusal card is followed by the alternative tables ("Slightly above your budget", with "+N%" on the price, and "In other areas");
  - a summary box ends the matches and refusal states;
  - EN / BM / 中文 strings;
  - tests.

**Wave 3:** the full test suite, tsc and lint. Real-model runs: a budget miss in an area, an area with no stock, and a normal match (summary present). A browser check of the refusal + alternatives + summary layout.

## What has changed
Commits:
- 3c7dfe0 (contract)
- 53a3913 (server)
- c8257e7 (chat UI, built by a Sonnet subagent against the 3c7dfe0 contract, file-disjoint)
- b6c861d and a614545 (fixes from the real runs and the browser check)

**Contract** (`src/agents/finder/schema.ts`):
- `FinderRow.alternative` ('over_budget' | 'other_area'), `overBudgetRM`, `overBudgetPct`.
- `FinderOutput.summary` { asked, found, suggestion }: model-written, each line clipped at 600 chars, never rejecting.

**Search** (`src/inventory/search.ts`):
- `withAlternatives` runs when the location gate (`gate: 'location'`) or the price gate (`gate: 'price'`) empties the result.
  - **Over budget** (price miss with a `priceMax`): from the projects that passed the location and type gates, IN the area only, with a STATED from price above `priceMax` by at most `OVER_BUDGET_TOLERANCE` (30%), cheapest first.
  - **Other areas** (a location was given): eligible projects outside the requested area, of the requested type, passing the budget gate with a STATED from price when a budget was given, ranked by relevance above `MIN_RELEVANCE`.
  - At most `MAX_ALTERNATIVES` (3) of each. The income ceiling applies to both.
  - With nothing to offer, the result is byte-identical to before and no embedding call is made.
- The match mapping moved into `toProjectMatch`, shared with alternatives:
  - an over-budget alternative never claims `matchedCriteria.priceMax`;
  - an other-area alternative never claims `locationPref`.
- `ProjectMatch.alternative` and `SearchResult.no_match.alternatives` are new.

**Tool** (`src/agents/finder/tools.ts`):
- Alternatives become rows (`recordSearchRows`) and Details data.
- A no_match now REPLACES the rows (empty when there are no alternatives). Before, it left the previous search's rows in the sink.
- `toModelOutput` strips layouts and details from alternatives.
- The tool description mentions alternatives.

**Route** (`app/api/chat/route.ts`): a saved refusal keeps its alternative rows and Details data.

**Prompt** (`src/agents/finder/prompt.ts`):
- The quick-050 "never substitute" rule is narrowed to projects the model picks itself.
- New alternatives rules:
  - over budget: always say how far over, and never call one "the only project" in an area;
  - other area: name its real area, never call it near or "nearby areas";
  - keep alternatives out of `matches`.
- Next steps may name a returned alternative.
- New "Closing Summary" section, and `summary` in the Output Format.

**Chat UI** (`app/[lang]/chat/`):
- `MatchList`, refusal branch: the card, headed "No exact match" when alternatives exist, then the alternative tables, then the summary.
- The summary box (`finder-summary.tsx`, plain text) ends the matches, refusal, card-fallback and answer states.
- `MatchGroups`: alternative rows never join the recommended or nearby groups. New groups "Slightly above your budget" and "In other areas", in the order recommended, nearby, over budget, other areas.
- `match-table.tsx`: a "+N%" badge on an over-budget price; an alternatives table counts "N alternatives", not "matching projects".
- `decode-structured-output.ts`:
  - `attachSummaries` also applies to a refusal. Without this, alternative rows could not open their Details.
  - `normalizeFinderShape` keeps a bare-string summary as the suggestion line.
- EN / BM / 中文 strings; the refusal headers are now translated.

**Tests:**
- `search.test.ts`: 7 new.
- `tools.test.ts`: 3 new, plus the row allowlist (17 keys).
- `finder.test.ts`: 1 new, and the 050 rule test updated.
- `finder-alternatives.test.ts`: 20 new.

## Verification
- **Real Finder** (claude-sonnet-4-6, this branch's code, live data, read-only), three cases:
  - **"damansara heights under RM500k, own stay"** (gate price):
    - Royal Suites under "Slightly above your budget" (+26%, RM130k over), and Luminar Subang under "In other areas" (from RM411k).
    - The summary restates the request, says nothing in Damansara Heights fits, and suggests both with their real numbers, saying Luminar "is in a different area".
  - **"3 bedroom in puchong around RM700k"** (gate location): three in-budget alternatives elsewhere (Riana Trees, Luminar Subang, Lunar Seputeh), each named by its own area. The summary points to Details for 3-bed availability.
  - **"1.5mil in bangsar, 3 bedroom"**: a normal match (Bangsar Hill Park, Parkside, The Lantern). No alternatives; the summary is present.
  - **Fixes these runs drove:**
    - An estimate-only project (Star Residences KLCC) had appeared with an empty price. Other-area alternatives now need a stated price.
    - "The only active project in Damansara Heights" appeared twice (the area has five). Forbidden in every part of the reply; the re-run says "the closest in-area option".
    - "nearby areas" in a next step. The next-steps rule now says "other areas"; one of two re-runs still used it in a generic question (see Known limitations).
- **Browser** (a temporary fixture page with the real `MatchList` and the Damansara Heights output; not committed, moved out of the repo afterwards):
  - "No exact match", then "Slightly above your budget" with "+26%", then "In other areas", then the summary.
  - It first showed "1 MATCHING PROJECTS" under both alternative headings, fixed to "1 alternative".
  - At 375px there is no horizontal page scroll (scrollWidth 375); the tables scroll in their own strip.
  - The alternative row's Details opened its layouts (Type M1).
  - The console errors seen were missing-message errors from hot reload before the language files refreshed; there were none after a full reload.
- **Tests:** `npx vitest run` passes 1891, 223 skipped. The only failure is `tests/finder-corpus-gates.test.ts`, which needs the gitignored `projects.inventory.json` (it failed before this claim too).
- **Other checks:**
  - `npx tsc --noEmit -p .` clean, once the dev server regenerated `.next/dev/types` without the removed fixture route.
  - `eslint` on every changed file: 0 errors (the test files' existing `_args` warnings).
  - Secret scan of the diff: clean.

## Regression report
- **Found searches.** Unchanged: alternatives are built only on a location or price no_match. The shared `toProjectMatch` produces the same matches; all 74 earlier search tests pass, and a found search never carries `alternative` (test).
- **Refusals with nothing to offer.** Byte-identical result, and no embedding call (test). The refusal card is unchanged apart from translated headers.
- **Other no-match gates** (eligibility, property type, relevance, inventory) and the ineligible / financing result are untouched.
- **Grounding.**
  - An over-budget alternative never claims `priceMax`; an other-area one never claims `locationPref` (tests).
  - Alternatives respect the income ceiling, property type and status 'active' (they come from the same eligible pool).
- **Table.** Recommended and nearby groups render exactly as before when no row is an alternative (existing tests pass). The +N% badge never shows on an unknown price.
- **Stale rows.** A no_match now empties the table. Before, a refusal after a found search kept the earlier rows in the sink; they were not shown, but would now have been attached.
- **Persisted turns.**
  - An older envelope without `summary` or `alternative` decodes unchanged (optional fields).
  - A saved refusal with rows decodes and renders the alternatives and summary (test).

## Known limitations
- **Not deployed:** nothing is pushed or merged.
- **Wording variance.** The model can still write "nearby areas" in a generic next-step question (1 of 2 re-runs). It does not claim any listed alternative is near.
- **No bedroom filtering.** Alternatives are not filtered by bedrooms, like matches (bedrooms is not a filter, since 0 means unknown on many projects). The summary is told to send the agent to Details for layouts.
- **Neighbours are not prioritised.** Other-area alternatives are ranked by relevance, not proximity: there is no distance data. AREA_NEIGHBOURS (Damansara Heights → Bangsar) is not used to order them.
- **Under-budget picks are out of scope.** A budget FLOOR miss (everything in the area is cheaper) gets other-area alternatives but no "slightly below budget" ones, because the request was about higher prices.
