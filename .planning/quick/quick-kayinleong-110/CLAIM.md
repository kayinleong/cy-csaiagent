# Claim: quick-kayinleong-110
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-110 (from origin/main f4d845a)
- started: 2026-11-27
- status: in-progress
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
(pending)

## Verification
(pending)
