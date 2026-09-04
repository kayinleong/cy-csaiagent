# Claim: quick-kayinleong-086
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-04
- status: claimed
- summary: the Finder answers budget+area queries with queryInventory — a coarse priceBand tool with no location filter and no row sink — so the table never renders and the model invents an exclusivity claim ("the only active project") that is false 18 times over

## What is wrong

User report: *"show me > 1.5mils house within klang valley"* returns **one card**, not the table.
Second report after a fresh turn: still one result. User's own reading: *"Klang Valley means
including KL and Selangor"* — which is correct, and is already what `searchProjects` does.

Evidence from the two post-fix turns persisted in Firestore
(`2026-09-03T16:41:46Z`, `2026-09-04T02:34:13Z`), both routed `finder:classifier`:

    envelope keys=[matches]   matches=1   ROWS=KEY ABSENT

`rows` is absent, so `match-list.tsx:145` (`rows.length > 0`) falls back to `MatchCard`.

**The model used `queryInventory`, not `searchProjects`.** Proven by elimination — no plausible
`searchProjects` input can return 1 match:

| criteria | rows |
|---|---|
| priceMin 1.5M + "Klang Valley" | **50** |
| priceMin 1.5M + "klang valley" (lowercase) | 50 |
| priceMin 1.5M, no location | 50 |
| priceMin 1.5M + KV + 4 beds | 50 |
| priceMin 1.5M + KV + own_stay + malaysian | 50 |
| priceMin 1.5M + KV + bumi=false | 42 |
| priceMax 1.5M + KV (if the parser flips `>`) | 65 |
| priceMin 1.5M + "Ampang" | 3 |

The floor is 3. Meanwhile `queryInventory(priceBand:'above_1.2m', vpStatus:true)` returns
**9 docs, 5 of them >1.5M, AT6 among them** — the shape that produces this answer.

Three defects compound:

1. **`makeQueryInventoryTool` takes no sink** (`src/agents/finder/tools.ts:336`). quick-085 wired
   the row sink into `makeSearchProjectsTool` only, so any turn answered by `queryInventory` can
   never render a table. This is quick-085 under-delivering, not a pre-existing bug.
2. **`queryInventory` cannot express this query.** It filters `priceBand` (4 coarse buckets — it
   cannot say ">RM1.5M") and has **no location filter at all**. Its own description invites the
   misuse: *"show active leasehold projects under RM500k"*.
3. **The model filtered and claimed exclusivity itself.** It narrowed 9 docs to 1 and asserted
   *"The only active D2 project in Klang Valley priced above RM1.5M"*. There are **18**. That is a
   grounding violation — the prompt's rule is "only recommend projects returned by the
   searchProjects tool", and the deterministic gates were bypassed entirely.

## What will change

Scope to be fixed after diagnosis is confirmed by a real model-driven tool-selection test.

## What has changed

_(pending)_

## Verification

_(pending)_
