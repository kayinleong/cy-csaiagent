# Claim: quick-kayinleong-070
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: persist the reply AS IT STREAMS — for Finder every character arrives in the final step, so step-boundary writes save nothing

## What will change

User: "there is 2 recommendation by agent, but when revisit the history it's gone, please
fix this. please make sure this issue is fix so i dont have to keep asking u to fix". Fair —
this is the fifth attempt and the previous four all missed the mechanism.

Now that the Anthropic account has credit I ran a REAL Finder turn end to end against the
local dev server, and measured the thing instead of reasoning about it:

- turn completed, **34177ms**, streamed 3184 chars, persisted correctly
- the assistant row's **createTime -> updateTime was 95ms**

That 95ms is the whole answer. quick-061/063 write at STEP boundaries, and for Finder the
step sequence is: step 1 calls searchProjects (no text — the quick-048 anti-narration rule
forbids it), step 2 calls fetchCollateral (no text), step 3 emits the entire JSON envelope.
**Every character arrives in the last step.** So the step-boundary write has nothing to save
until generation is already finished, and a turn killed during that final generation loses
100% of it.

That is also exactly why Coach never lost a reply and Finder always did — not because Finder
is slower, but because Finder's output is one late burst.

Planned: persist from `onChunk`, throttled, so the row grows WHILE the model is generating.
`onChunk` is awaited by the SDK ("the stream processing will pause until the callback promise
is resolved"), so the write is guaranteed to land while the invocation is alive.

## What has changed

`app/api/chat/route.ts` — a throttled `onChunk` handler.

Text deltas accumulate into `liveText` and are persisted through the existing idempotent,
upgrade-only writer whenever BOTH thresholds are crossed: `FLUSH_EVERY_MS = 2000` and
`FLUSH_EVERY_CHARS = 600`. `liveText` resets in `onStepFinish` once that step's text has
been banked into `turnText`, so nothing is counted twice.

**Awaited deliberately.** The SDK documents that "the stream processing will pause until the
callback promise is resolved" — the same guarantee that made quick-063's write survive. A
floating write here would be dropped on teardown, which is the mistake quick-061 made.

Cost: a 3184-char envelope generated over ~28s takes roughly 5-8 extra updates. Cheap next
to losing the answer.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1085 passed**, 197 skipped, 0 failed (was 1081; **+4**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### The measurement that finally identified the mechanism
Ran a REAL Finder turn end to end against the local dev server with a minted Firebase ID
token (now that the account has credit):

- completed in **34177ms**, streamed 3184 chars, persisted correctly
- the assistant row's **createTime -> updateTime was 95ms**

That 95ms is the whole answer. quick-061/063 write at STEP boundaries, and Finder's sequence
is searchProjects (no text — the quick-048 anti-narration rule forbids narration),
fetchCollateral (no text), then the entire JSON envelope. **Every character arrives in the
last step**, so a step-boundary write has nothing to save until generation has already
finished, and a turn killed during that final burst loses 100% of it.

It is also why Coach never lost a reply and Finder always did — not speed, but one late burst.

### Proven end to end, not reasoned
Started a real turn and ABANDONED the request at 20s, which is what a platform timeout does:

| | before quick-070 | after |
|---|---|---|
| streamed to the client | 1479 chars | 1479 chars |
| **persisted** | **nothing** | **1353 chars**, `rd=finder:manual-override:partial` |

Then fed that stored row through the real `mapConversationMessages` — the history loader's
own mapper:

    === revisiting chat-kill-1787931401118 ===
      user      "find me a 2-bedroom in Bangsar, budget 900k"
      assistant RENDERS AS A MATCH CARD
         matches: 2
           - Bangsar Hill Park      collateral=4
           - Residensi 38 Bangsar   collateral=4

Two recommendations, with their files, surviving a mid-generation kill. That is the reported
symptom, closed. quick-056's truncated-envelope repair is what decodes the partial — it now
has a real job rather than a hypothetical one.

### Regression surface
- **The normal path is unchanged.** A turn that finishes still ends with `onFinish`'s
  authoritative `fullTurnText`, real citations and the real token count, and the writer's
  length guard means a checkpoint can never truncate the final text.
- **Throttling is pinned**: 100 rapid deltas produce at most 2 writes, so a long reply
  cannot turn into a write-per-token.
- **Non-text chunks are ignored** (pinned) — tool-call and tool-result deltas write nothing.
- **No double-counting** (pinned) — a step's text appears once after `onStepFinish` banks it.
- Four route tests needed the stream promise awaited; the route does
  `void result.consumeStream()`, so POST returns before the stream drains.

## Honest gaps

1. **A turn killed before ~600 chars exist still loses the reply.** The first checkpoint
   needs 600 chars AND 2s. Lowering the thresholds trades writes for coverage; these were
   chosen so a short reply costs one write.
2. **The reply is still 34s.** This makes the loss survivable, it does not make the turn
   fast. A killed turn now yields a `:partial` card rather than the whole answer, and
   quick-067's round-trip saving is the only speedup so far.
3. **`:partial` is not surfaced in the UI.** The transcript is honest in `routeDecision` but
   the agent sees a card with no indication it was cut short. Worth a badge.
4. **Not verified on the deployed site** — proven locally against live Firestore with a real
   model call and a real abandoned request, which is as close as I can get without the
   platform's own kill.
