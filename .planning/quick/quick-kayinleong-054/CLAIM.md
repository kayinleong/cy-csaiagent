# Claim: quick-kayinleong-054
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: fetchCollateral returns EVERY collateral item for a project — up to 1,060, ~55k tokens for one call. It is re-sent on every step of the 5-step loop, which is a prime driver of the usage cap, the truncation, AND the schema drift (the model reshapes the huge list into {brochures:[...]}).

## Evidence

A user pasted the raw SSE stream for one Finder turn. It called `fetchCollateral` for
THREE projects. Measured against live Firestore:

| collateral per project | |
|---|---|
| max | **1,060** (~55,650 tokens for ONE call) |
| Bangsar Hill Park (in the stream) | **660** (~34,650 tokens) |
| mean / p50 | 140 / 71 |
| total | 12,020 across 86 projects |

`src/agents/finder/tools.ts:300` — `collateralRef().where('projectId','==',projectId).get()`
with no `limit()`, no ranking, no cap. The overwhelming majority is `whatsapp-media`
(1,053 of the 1,060 on the worst project): individual chat photos, not sales collateral.

The tool result is re-sent on EVERY step of `stopWhen: stepCountIs(5)`, so a single Finder
turn can carry six figures of collateral payload.

## Why this is the root cause of several separate complaints

- **Usage cap.** TOKEN_CAP was raised 50k → 300k in quick-050 based on a measured 5,812
  mean. That measurement predates heavy collateral use; a turn like this blows through it
  on its own.
- **Truncation.** An enormous context crowds the response.
- **Schema drift (quick-053).** The model emits `collateral: {brochures:[...]}` because it
  is trying to condense 660 items into something presentable. quick-053 repairs the shape,
  which is correct and still needed — but the model should never have been handed 660
  items to condense.

## What will change

`src/agents/finder/tools.ts` — rank and cap what `fetchCollateral` returns:
1. Curated, named types first (drive, project-info, showroom-video, fb-ads, reels,
   drone-footage, teaser, demand-gen) — these are the handful of real links.
2. Then documents (.pdf/.xlsx/.docx/.pptx) — brochures, sales kits, FAQs, price charts.
3. Individual photos/videos last, and mostly excluded by the cap.

Report the true total so the model can say "660 files available" without listing them.

## Verification

_(pending)_
