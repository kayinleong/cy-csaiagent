# Claim: quick-kayinleong-070
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
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

## Verification

_(pending)_
