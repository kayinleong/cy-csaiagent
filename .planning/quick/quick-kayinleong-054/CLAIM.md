# Claim: quick-kayinleong-054
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: done
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

## What has changed

One commit (`7e0376a`).

- `decode-stream-chunk.ts`: new `isTextBlockEnd()`; `chat-input.tsx` keys the separator on
  the `text-end` EVENT instead of an id change.
- `src/agents/finder/tools.ts`: `rankAndCapCollateral()` + `MAX_COLLATERAL_ITEMS = 12`,
  applied inside `fetchCollateral`, with a count logged when it truncates.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **990 passed**, 197 skipped, 0 failed (was 980; **+10**)
- `npx eslint app src` → **0 errors**; `npm run build` → exit 0
- Tests use the VERBATIM block shape from the capture (two blocks, both id "0"), plus a
  three-block case, same-block deltas, and the never-open-with-a-blank-line guard.
- Ranking tests assert document-before-media order, extension matching THROUGH the
  `?alt=media&token=` query string, stability within a rank band, and the 200 → 12 cap.

### Blast radius of defect A, stated precisely
For **Finder** it was masked: `extractJsonObject` slices first-brace-to-last-brace and
quick-053's salvage tolerates a prose prefix. For **Coach** it was fully live — Coach
streams prose with no envelope to slice, so every multi-step Coach turn has been running
its narration straight into its answer since quick-048.

### Why quick-048 shipped broken
Its tests used a synthetic stream with DISTINCT block ids. The real SDK reuses id "0". I
verified the fix against my own assumption about the wire format instead of against the
wire format. The new tests are built from a real capture.

### Regression surface
- `parseTextChunk` and `parseTextDelta` unchanged; `isTextBlockEnd` is additive.
- The separator can only fire where the id-based test previously fired and more, so no
  turn that rendered correctly starts rendering worse.
- `rankAndCapCollateral` is a pure function over the already-filtered item list;
  `webAddressableUrl` filtering and the storage-path omission warning from quick-050 are
  untouched.
- Agent tools remain read-only.

## Honest gaps — NOT verified

1. **No live model call.** The token saving is arithmetic on the capture (~200 items × 3
   calls × 5 steps → 12 × 3), not a measured before/after on a real turn.
2. **MAX_COLLATERAL_ITEMS = 12 is a judgement call**, not tuned against agent behaviour. If
   agents report a missing file, that is the number to revisit.
3. **No authenticated click-through.**
