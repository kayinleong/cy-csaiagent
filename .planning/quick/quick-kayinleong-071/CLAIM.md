# Claim: quick-kayinleong-071
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: the MODEL chooses which collateral URLs to transcribe, so the same project gets different files every time — the server has the real list, it should attach it

## The user's two questions, measured

Ran the identical Finder query three times against live data:

| run | duration | output | collateral URLs the model emitted |
|---|---|---|---|
| 1 | 75601ms | 9478 chars | **19** |
| 2 | 50001ms | 6885 chars | **10** |
| 3 | 48260ms | 6410 chars | **9** |

**1. Why the same project shows different attachments.** How it works today: `collateralFor()`
reads every collateral doc for the project, drops any without a web-addressable `externalUrl`
(quick-050), ranks them — documents, then curated non-WhatsApp, then videos, then photos —
and caps at 12 (quick-054). That part is deterministic. Then the tool result is handed to the
model, and **the model decides which of those 12 to copy into its JSON output, character by
character.** 19, then 10, then 9. That is the inconsistency: it is a generation choice, not a
data or retrieval difference.

**2. The truncated onboarding answer.** Their token-limit hypothesis is out — no
`maxOutputTokens` is set anywhere in the agent path, and the router request shows the SDK
default of 128000, far above a ~3.6k-char answer. Their FIRST hypothesis is right: it is a
time cutoff. The same Coach onboarding turn completes locally in **37766ms** and ends on a
complete sentence; in production it was killed mid-generation. quick-070 is why they can see
the partial at all.

Both have one fix. Transcribing ~19 URLs at ~200 chars each is roughly 40% of the output the
model has to generate, so removing it makes the answer both consistent AND materially faster.

Planned: the server attaches collateral from the tool results — the same pattern quick-046
used for citations, and for the same reason ("strictly more trustworthy than asking the model
to restate chunk IDs it can get wrong").

## What has changed

**The server attaches collateral; the model no longer writes URLs.**
- `attachCollateral(output, byProject)` — pure, in the decode module, used by BOTH the live
  client and the server's persist path so they cannot drift.
- The route harvests `projectId -> collateral[]` from the tool results and ships it in
  `messageMetadata` (the quick-046 pattern) AND rewrites the persisted envelope with it, so a
  revisited turn shows the same files as the live one.
- The Finder prompt now says to OMIT collateral entirely.

**A latent bug found on the way, and it is the bigger one.**
`extractCitationChunkIds`, `extractFinderProjectIds`, `extractReplySopIds` and the KB-miss
signal all read `tr.result`. **AI SDK v5 names that field `output`** — `result` is not on a
v5 `TypedToolResult` at all (`StaticToolResult`: toolCallId, toolName, input, output). So
since the v5 upgrade:
- Coach turns carried **no citations**, and since `kbMiss` is
  `retrievalAttempted && citations.length === 0`, a Coach turn that DID retrieve was still
  reported as a knowledge gap.
- `finderSlot` never recorded a discussed project; the Reply grounding trail was always empty.

Every extractor was wrapped in try/catch returning `[]`, which is exactly why it never
surfaced. Now read through a `toolOutput()` accessor that prefers `output` and falls back to
`result`.

**`matchedCriteria` fields now default.** With the collateral rule in place the model
returned only `{ locationPref: 'Bangsar' }` per match; all six fields were required, so
`dropUnrenderableMatches` discarded EVERY match and the agent got nothing. These are
display-only — `criteriaToLabels()` already skips unknown/null — and losing a real,
tool-verified project over a display field is the wrong trade. `projectId` is still required:
that is what a card cannot be grounded without.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1092 passed**, 197 skipped, 0 failed (was 1085; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Three identical live runs, before and after

| | before | after |
|---|---|---|
| run 1 | 75601ms — **19** model-written URLs | 25669ms — **0** |
| run 2 | 50001ms — **10** | 24876ms — **0** |
| run 3 | 48260ms — **9** | 24743ms — **0** |

Stored result, identical on all three runs:

    8 match(es): Bangsar Hill Park:12  The Lantern Bangsar:12  Pinnacle Bangsar Res:12
                 Residensi 38 Bangsar:0  One Eleven Menerung:0  Parkside Residences:0
                 Rhombus:0  Aspire office @ KL e:0

Same matches, same file counts, every time — and **~50% faster**, because transcribing ~19
URLs at ~200 chars each was roughly 40% of what the model had to generate.

### Regression surface
- **Older persisted turns are untouched**: a projectId with no server entry keeps whatever
  collateral it already had (pinned), so history written before this renders unchanged.
- **`attachCollateral` never mutates its input** and is a no-op without a map (pinned).
- Metadata is validated item by item in `parseMessageMetadata` — a malformed entry is
  dropped rather than rendered as a broken link, since this is what the agent forwards.
- The persist-time rewrite only runs when the text DECODES; a truncated turn is stored
  verbatim and quick-056's repair handles it exactly as before.
- One quick-056 test encoded the old strictness — it asserted a match missing
  `matchedCriteria` gets dropped. Retargeted at a genuine husk (no `projectId`) and a second
  test added for the case that now correctly survives. The guarantee it protects — one husk
  must not cost the complete matches — is unchanged.

## Honest gaps

1. **Only the top 3 matches carry files** (`INLINE_COLLATERAL_MATCHES`, quick-067), so
   matches 4-8 show none. Consistent now, but an agent seeing 8 projects and 3 with files may
   read that as the same inconsistency. Now that the model no longer pays output tokens for
   URLs, the only cost of widening it is Firestore reads and model INPUT tokens — worth
   revisiting, deliberately not changed in the same pass.
2. **A turn is still ~25s.** Halved, not solved.
3. **The citation fix is not verified end to end.** The field name is confirmed against the
   SDK's own type, but I did not re-run a Coach turn to watch citations appear and the false
   kb_miss stop. That is the next thing to check.
4. Nothing backfills the citations or finderSlot entries lost while the extractors were
   silently returning nothing.
