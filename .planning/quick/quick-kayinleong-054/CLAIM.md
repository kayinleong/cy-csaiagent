# Claim: quick-kayinleong-054
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: Two defects found in a raw SSE capture of a real Finder turn — my own quick-048 block separator never fires because the SDK REUSES the text-block id across steps, and fetchCollateral returns EVERY collateral row for a project (~200 items, called 3x, re-sent each step).

## Evidence

A raw SSE capture of "Find me a 2-bedroom in Bangsar, budget 900k, dont ask me anything
just show me the details".

### A. The quick-048 separator never fires

    {"type":"text-start","id":"0"}   -> "Let me search the inventory now."
    {"type":"text-end","id":"0"}
    ...tool calls...
    {"type":"text-start","id":"0"}   -> "{\n  \"matches\": [ ..."

Both text blocks carry **id "0"**. `chat-input.tsx:357` computes
`isNewBlock = currentTextBlockId !== null && textChunk.id !== currentTextBlockId`, so with
a repeated id the separator is NEVER inserted and the narration welds straight onto the
JSON — exactly the "Let me search now.The search returned" defect quick-048 claimed to fix.
The fix was verified against a synthetic stream with DIFFERENT ids; the real SDK reuses
them. The reliable signal is the `text-start` / `text-end` events, not the id.

Not currently user-visible for Finder (quick-053's salvage tolerates a prose prefix, and
`extractJsonObject` slices first-brace-to-last-brace), but it is live for every Coach turn,
which streams prose and has no envelope to slice.

### B. fetchCollateral is unbounded

`src/agents/finder/tools.ts:300` — `collateralRef().where('projectId','==',projectId).get()`
with no limit. In the capture, The Lantern Bangsar returned ~200 items and the model called
`fetchCollateral` THREE times (once per match). Every item is a long Firebase download URL
(~200 chars), and the tool result is re-sent on each subsequent step of the
`stopWhen: stepCountIs(5)` loop.

That is on the order of tens of thousands of tokens for one turn, which fits the measured
data: Finder averages 7,209 tokens/turn versus Coach's 3,273, and one recorded user-day
burned 70,939 tokens in only 4 turns. quick-050 capped `searchProjects` at MAX_MATCHES=8
but left this path unbounded.

It is also poor output: the agent wants the brochure, sales kit, FAQ and price list — not
200 WhatsApp photos, .opus voice notes and .vcf contact cards.

## What will change

- `app/[lang]/chat/decode-stream-chunk.ts` + `chat-input.tsx`: detect block boundaries from
  `text-start`/`text-end`, not from an id change.
- `src/agents/finder/tools.ts`: bound `fetchCollateral` and rank documents ahead of raw
  media, so the model gets the useful files.

## Verification

_(pending)_
