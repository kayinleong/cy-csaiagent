---
status: complete
claim: quick-kayinleong-106
item: 2 (Damansara Heights nearby set should include the Bangsar projects in budget)
researched: 2026-11-25
data: live Firestore `projects`, read-only (86 active of 90), code at a36a781
---

# Research: Damansara Heights "around" set misses the Bangsar projects

## Answer in one paragraph
"Around Damansara Heights" has **no geography behind it**. A project counts as `nearby` only
when its own `locationText` happens to **name** "Damansara Heights" in a clause that is not its
address. One Eleven Menerung qualifies only because its text says "between BSC & **Pavilion
Damansara Heights**" (a mall) and "MRT Pavilion Damansara Heights" (a station). Bangsar Hill
Park, Parkside Residences and Residensi 38 never mention Damansara Heights, so the **location
gate drops them before price, bedrooms, ranking or the model are involved**. The no-adjacency
rule was deliberate (085 D4). The fix is a small, explicit, directed neighbour map in
`src/inventory/search.ts`. A neighbour can widen the gate but can never make a project `in_area`.
The prompt's "no adjacency data" rule also has to be reworded.

## 1. How in-area / nearby works today (evidence)
| Step | Where | What it does |
|---|---|---|
| Needles | `src/inventory/search.ts:584-624` `locationNeedles` | "Damansara Heights" → `[{phrase:"damansara height", tokens:["damansara","height"]}]` (live run). Same for "damansara height" and "Damansara Heights, KL". |
| Gate haystack | `search.ts:477-481` `locationHaystack` | `name` + sheet `area` (address clauses, `:493-496`) + the address clauses of `locationText`. Proximity clauses (`PROXIMITY_CLAUSE`, `:428-429`) and the clauses after them are dropped (`splitAddressClauses`, `:503-529`). |
| Gate | `search.ts:1035-1047` | `candidates.filter(projectMatchesLocation)` is a **hard filter**. Projects that fail are gone, and nothing later re-admits them. |
| Classify | `search.ts:692-699` `projectLocationMatch` | `in_area` if a needle hits `name`/`area`/`ownAddressText`. Otherwise `nearby`. `ownAddressText` (`:669-674`) also treats "between" as a proximity run (`OWN_ADDRESS_RUN_START`, `:655`), and keeps only the first name of a slash list. |
| Order | `search.ts:1147-1158` | in_area rows first, then nearby rows, each in score order. Sliced at `MAX_ROWS`=100 (`:286`). |
| Table vs model | `src/agents/finder/tools.ts:341` / `:362-371` | The table (sink) gets **all** rows. The model sees the first `MAX_MATCHES`=8 (`search.ts:270`). |

The design records the no-adjacency choice: `search.ts:351-354` ("No adjacency or drive-time
data exists … inventing one was ruled out of scope (D4)"), `:554-556`, `:580-582`. So does the
prompt (`src/agents/finder/prompt.ts:147`, "There is no distance or adjacency data in the
system"), and `src/agents/finder/finder.test.ts:763-768` pins that wording.

**Why One Eleven qualifies.** Live `locationText` = "Bangsar, between BSC & Pavilion Damansara
Heights, 180m walk to MRT Pavilion Damansara Heights". "between" is **not** in `PROXIMITY_CLAUSE`
(`:428-429`), so the clause "between BSC & Pavilion Damansara Heights" stays in the gate haystack
and matches the phrase "damansara height". The third clause is dropped ("180m" opens a run).
`ownAddressText` treats "between" as proximity, so the project is classified `nearby`. The match
comes from **text coincidence (a mall/MRT name), not proximity data.** Majestic @ Kiara Reserve
is `nearby` the same way ("Mont Kiara / Damansara Heights, …", slash rule).

**Prompt.** Nothing tells the model to trim the nearby list. `prompt.ts:148-152` says to present
the nearby group after the in-area projects. `prompt.ts:129` ("you only see the top few") is
about the 8-row model cap.

## 2. Did the screenshot's search run with a budget?
Yes, but not with RM1.5M-2.5M. Live, `searchProjects` with location "Damansara Heights" (same
freeText) gives:

| Budget | Result |
|---|---|
| none | Royal Suites, The Cedar, Pavilion DH, **PDH Imperial**, DC Residensi + nearby **Majestic**, One Eleven (7) |
| 1.5M-2.5M | Royal Suites, Pavilion DH, DC Residensi + nearby One Eleven (4). **No Cedar** |
| floor 1.5M only | 6: Royal Suites, Cedar, Pavilion DH, **Imperial**, DC + nearby One Eleven |
| ceiling 2.5M only | Royal Suites, Pavilion DH, DC + nearby Majestic, One Eleven |

The screenshot (Royal Suites, Cedar, DC, Pavilion DH + One Eleven) fits only a floor in
**(RM1.2M, RM2.1M]** and a ceiling in **[RM2,946,200, RM5,050,000)**:
- Majestic is out, so its top price of RM1.2M is under the floor.
- DC Residensi is in, so its top gross price of RM2.1M reaches the floor.
- The Cedar is in, so its from price of RM2,946,200 is within the ceiling.
- Imperial is out, so its from price of RM5.05M is over the ceiling.

The floor is checked against `projectTopPrice` and the ceiling against `priceValue`
(`search.ts:747-755`, `:777-790`). So the model passed a guessed budget, plausibly priceMin
1.5M and priceMax around 3M. That is consistent with it reading
`<FIN_HASH:…>.5MIL TO <FIN_HASH:…>.5MIL`. `FINANCIAL_REGEX` (`src/audit/pdpa.ts:97`) is
case-sensitive on `mil`, so "RM1.5MIL" matches only "RM1". The sibling owns that fix.

DC Residensi being `in_area` also shows that the **104/105 code is live**: it needs the `area`
field and the plural fold.

**This item does not depend on the budget fix.** With an exact RM1.5M-2.5M budget, the Bangsar
projects are still removed by the location gate.

## 3. The Bangsar projects (live, active, residential)
| Project | area / locationText (own address) | from | top (floor) | Layouts in RM1.5-2.5M, 2-3 BR | DH gate | Bangsar 1.5-2.5M |
|---|---|---|---|---|---|---|
| One Eleven Menerung @ Bangsar | Bangsar / "Bangsar, between BSC & Pavilion DH…" | 1,920,000 | 6,600,000 | M1 2BR 1.92-2.28M, M1-A 2BR 2.16-2.19M, M1-B 2BR 2.35M (nett) | **pass (text)** → nearby | pass |
| **Bangsar Hill Park** | Bangsar / "Lorong Maarof, Bangsar, …near KLCC and Bangsar CBD" | 841,000 | 1,700,000 | 1A, 1B 3BR gross 1.6-1.7M; 3B 3BR gross 1.4-1.6M | **fail** | pass |
| **Parkside Residences** | Setia Federal Hill / "Jalan Bangsar, Setia Federal Hill, KL; 400m to Bangsar LRT…" | 588,000 | 1,700,000 | E2 3BR nett 1.6-1.7M (E1 3BR TBC) | **fail** | pass (via "Jalan Bangsar") |
| **Residensi 38 Bangsar** | Bangsar / "Bangsar, Kuala Lumpur; …" | 0 (unpriced) | none | 9 layouts 580-1,442 sqft, no prices or bedrooms per layout; project bedrooms=2 | **fail** | pass (unknown price admitted, `:751`) |
| The Lantern Bangsar | Bangsar / "Jalan Abdullah, Bangsar…" | 0 | none | 1-2BR, ≤1,092 sqft, no prices | fail | pass (unpriced) |
| Pinnacle Bangsar Residence | Bangsar | 0 | none | 4-6BR, 4,677-7,942 sqft (not 2-3BR) | fail | pass (unpriced) |
| Rhombus | Bangsar | 6,100,000 | 6,100,000 | none | fail | fail (ceiling) |
| ViiA Residences | Bangsar (text: KL Eco City) | 862,000 | 1,100,000 | 1BR only | fail | fail (floor) |
| Riana Trees | Bangsar South | 628,000 | 628,000 | none | fail | fail (floor) |

**The 3 the user most likely means** [ASSUMED, to confirm with the user]: the three **priced**
Bangsar projects with 2-3BR layouts actually in RM1.5-2.5M are One Eleven Menerung, **Bangsar
Hill Park** and **Parkside Residences** (Jalan Bangsar). They are exactly the priced rows of a
plain "Bangsar, RM1.5M-2.5M" search, and that search also returns Pinnacle, Lantern and
Residensi 38 as unpriced. If the user counts by the sheet's Area = "Bangsar" instead, the third
is **Residensi 38 Bangsar** (2BR, unpriced).

**Why each is excluded today.** The same reason applies to all three: the **location gate**
(`search.ts:1041`). Each project's name, `area` and address clauses never contain "damansara
height". It is not the budget (all three pass `projectMatchesPrice(…, 1.5M, 2.5M)` live). It is
not bedrooms (not a filter, `:1208-1213`), status (all active), the result cap (5 rows ≪ 100),
sort order, or the model (the table shows every row it gets).

## 4. Recommended fix (minimal)
**A directed neighbour map in `src/inventory/search.ts`, applied in `searchProjects` only.**
```ts
/** Areas the client treats as "around" another area. Directed, explicit, user-confirmed. */
const AREA_NEIGHBOURS: ReadonlyArray<{ area: string; around: readonly string[] }> = [
  { area: 'Damansara Heights', around: ['Bangsar'] },
]
export function neighbourNeedles(needles: LocationNeedleGroup[]): LocationNeedleGroup[] | null
// keys compiled once with locationNeedles(area)[0].phrase; a needle group whose phrase
// equals a key contributes locationNeedles(n) for each neighbour; de-duplicated; null if none.
```
- **Gate** (`:1041`): keep `projectMatchesLocation(doc, needles) || (around !== null &&
  projectMatchesLocation(doc, around))`. A neighbour project passes through the same address-only
  haystack, so "near Bangsar" landmark clauses still do not count.
- **Classification needs no change.** `projectLocationMatch(doc, needles)` (`:692`) uses the
  **original** needles, so a neighbour-only project can never be `in_area`. Its
  `matchedCriteria.locationPref` stays null (`:1206-1207`), and the UI groups it under "Other
  projects around Damansara Heights" (`locationArea` = the pref, `tools.ts:221`).
- **Match the key on the exact phrase** after normalising and plural folding. "Damansara Heights",
  "damansara height" and "Damansara Heights, KL" all hit the key (verified live). "Pavilion
  Damansara Heights" (phrase `pavilion damansara height`) and "Bukit Damansara" do not.
- **Directed, not symmetric.** A Bangsar search is unchanged unless the user also asks for
  Bangsar → Damansara Heights.
- **Comments and prompt.** Rewrite the "no adjacency" notes (`:351-354`, `:554-556`, `:580-582`)
  to name the map as the one exception. Reword `prompt.ts:147-148` so that `nearby` means "its
  text names the area, or the area is listed as around it". Keep the ban on distance, "close to"
  and "next to" wording. Update `finder.test.ts:763-768` to assert the new wording (still no
  distance claims).
- **Not the client sheet's `area`.** That column is each project's own area, not its neighbours,
  so it cannot provide adjacency. A Firestore/admin-editable map could come later; for one entry,
  a code constant is the minimal change.

**Simulated live with the map** `{DH: [Bangsar]}` (read-only, pure gates):
- **RM1.5M-2.5M:** 3 in_area (Royal Suites, Pavilion DH, DC Residensi) + 6 nearby (One Eleven,
  **Bangsar Hill Park**, **Parkside**, Residensi 38, The Lantern, Pinnacle).
- **No budget:** 15 (adds Riana Trees "Bangsar South", Rhombus and ViiA as nearby).
- A wider list (Bukit Tunku, Taman Duta, Mont Kiara, Sri Hartamas, Bukit Damansara) adds Lagenda
  Tunku (1.5-2.5M); with no budget it also adds Miranda Hill and Eden BRDB. Hold this list until
  the user confirms it.

## 5. Pitfalls the plan must handle
1. **Unpriced Bangsar rows.** With the map, the nearby group holds 3 unpriced projects (Pinnacle
   is 4-6BR, 4,677+ sqft). They come in by the 085 D2 rule (`:751`), not by this change. The user
   said "3", so ask whether the nearby group should drop unpriced projects when a budget is set.
   That would be a nearby-only rule; do not change the global D2 rule silently.
2. **Model cap.** 3 + 6 = 9 rows > `MAX_MATCHES` 8, so the model does not see the lowest-scored
   nearby row (live: Residensi 38, 0.644), though the table does. That is acceptable, but the
   reply must not claim "these are all".
3. **"bangsar" matches "Bangsar South" and "Jalan Bangsar"** (whole-word phrase, `:537-541`).
   Riana Trees and Parkside get in that way. That is consistent with a Bangsar search today.
4. **Order.** Nearby rows stay in score order after in_area. Text-nearby rows (One Eleven) and
   map-nearby rows mix. That is fine, since both carry `nearby`.
5. **Bedrooms is not a filter.** "2 or 3 bedroom" only ranks. Do not add a bedroom gate here.

## 6. Regression surface
- **Searches.** Only searches whose needle phrase equals a map key change (`damansara height`).
  All other area searches are identical by construction: the extra OR is null for them. Re-run
  105's 38-area live comparison (that script was session scratch and is not in the repo). Use
  the distinct live `area` values plus the 105 list. Expect a diff only for "Damansara Heights"
  / "damansara height" (+Bangsar rows, all `nearby`).
- **`in_area` rows.** No row can change from `in_area` (the classifier is unchanged). No project
  leaves any search (the gate is an OR).
- **`found:false` gate attribution** (`:1040-1046`). A DH search can no longer return `location`
  no_match while a Bangsar project exists. Keep "every match nearby → say DH has none itself"
  (`prompt.ts:152`).
- **Unchanged:** `matchedCriteria` (location only for `in_area`), the price gate, and
  `queryInventory` / `projectDetail` (no location gate).

## 7. Test plan
- `src/inventory/search.test.ts`, new `describe('quick-kayinleong-106: Damansara Heights is around Bangsar')`:
  1. `neighbourNeedles(locationNeedles('Damansara Heights'))` equals the Bangsar group. The same
     holds for "damansara height" and "Damansara Heights, KL". It is null for "Bangsar",
     "Pavilion Damansara Heights", "Cheras" and "Bukit Damansara".
  2. `searchProjects` DH 1.5M-2.5M with live-shaped fixtures (Bangsar Hill Park, Parkside, One
     Eleven, Royal Suites, Pavilion DH, DC) returns the DH projects `in_area` first, then all
     three Bangsar ones `nearby`. `matchedCriteria.locationPref` is null on nearby rows.
  3. Directed: a Bangsar search does not return Pavilion DH.
  4. A Bangsar project whose text only says "near Bangsar" stays out (the proximity rule still
     applies to neighbours).
  5. The existing 103 case (`:1611-1625`) still passes unchanged.
- `src/agents/finder/tools.test.ts:~200`: a map-nearby row carries `locationMatch:'nearby'`
  and `locationArea:'Damansara Heights'`.
- `src/agents/finder/finder.test.ts:763-768`: update to the new wording. It still asserts
  "no data on how FAR".
- Live read-only check before deploy (see below), plus the 38-area before/after diff.

## 8. Live read-only simulation (how it was run; reuse after the fix)
Scripts (session scratch, not committed; read-only, print names/prices/areas only):
`/private/tmp/claude-502/-Users-ka-yin-leong-Documents-Personal-cy-csaiagent/7bb562df-40b6-49a2-84ad-d300bf8674cc/scratchpad/sim-nearby.ts`
(gates + real `searchProjects`, Gemini query embed) and `.../scratchpad/sim-fix.ts` (map emulation).
```bash
cd /Users/ka.yin.leong/Documents/Personal/cy-csaiagent
node_modules/.bin/tsx --tsconfig ./tsconfig.json --env-file=.env <scratchpad>/sim-nearby.ts
```
The env file in this checkout is `.env` (there is no `.env.local`; the scripts' docstrings say
`.env.local`). The full model loop: `node_modules/.bin/tsx --env-file=.env
scripts/diag-finder-toolpick.ts "<prompt>"`. It bypasses PDPA pseudonymization, so it reads the
budget correctly where production does not.

## Open questions for the user
1. Which 3 do you mean: One Eleven + Bangsar Hill Park + Parkside (priced), or Residensi 38
   instead of Parkside?
2. Should unpriced projects be left out of the "around" group when a budget is given?
3. Is the map one-way (Damansara Heights → Bangsar) or both ways, and should Bukit Tunku, Taman
   Duta, Mont Kiara or Sri Hartamas also count as around Damansara Heights?
