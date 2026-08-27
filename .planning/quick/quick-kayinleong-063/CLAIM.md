# Claim: quick-kayinleong-063
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: the assistant write is a floating promise in an SDK callback and serverless drops it — await it inside onStepFinish, which the AI SDK does await

## What will change

New evidence. A Finder turn at 02:24:45 that the user WATCHED render a complete card left:
- the user message written (same handler, same `appendMessage`, `await`ed in the request path)
- **no usageEvent**
- **no assistant message**
- **no `:partial` row**, even though quick-061's step-boundary write is deployed (the
  quick-062 card design is visibly live, and 062 was committed after 061)

So the turn streamed fine and every write that was NOT awaited by the request handler
vanished. The one write that survives is the one the handler awaits.

`node_modules/ai/dist/index.mjs:2469` — `await (onStepFinish == null ? void 0 : onStepFinish(...))`.
The SDK AWAITS onStepFinish. Making it async and awaiting the persist puts the write inside
the stream's own lifecycle, while the invocation is provably alive, instead of leaving it as
a floating promise for the platform to drop at response end.

## What has changed

One keyword, in `app/api/chat/route.ts`:

```
onStepFinish: async (step) => {
  ...
  await persistAssistantOnce(turnText.join('\n\n'), 'partial')
}
```

quick-061 wrote the same call as `void persistAssistantOnce(...)` and its comment
explicitly rejected `after()` on the grounds that it defers past the response. That
reasoning was right and still incomplete: a bare floating promise is not tied to ANYTHING,
so the serverless runtime is free to drop it at response close — which is what the data
shows happening.

The AI SDK awaits this callback (`await (onStepFinish == null ? void 0 : onStepFinish(...))`,
`ai/dist/index.mjs:2469`). Awaiting inside it puts the write in the stream's own lifecycle,
at a point where the invocation is provably alive because the SDK is blocked on it.

onError / onAbort keep `after()` — they fire when there is no stream left to ride.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1053 passed**, 197 skipped, 0 failed (was 1051; **+2**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### The evidence
The 02:24:45 Finder turn, which the user watched render a complete match card:

| record | written? |
|---|---|
| user message (awaited in the request path) | **yes** |
| usageEvent (end of onFinish) | no |
| assistant message | no |
| `:partial` row (quick-061, floating) | **no** |

The 062 card design is visibly live and 062 was committed after 061, so 061 WAS deployed and
its step write still produced nothing. Firestore writes from that invocation demonstrably
work — the user message is proof. The only thing separating them is whether the request
awaited the promise.

### What the test pins
`resolves only AFTER the row is written` captures the exact promise the SDK awaits and
asserts the row is on disk once it settles — with **no `setTimeout` flush anywhere**, unlike
every other test in this area. The flush those tests need is the symptom this claim removes.

### Regression surface
- **Latency:** one Firestore write per step, at most 5 (`stopWhen: stepCountIs(5)`), on a
  turn already running for seconds. The SDK now waits ~50-150ms per step boundary.
- **No double-write:** the same idempotent, upgrade-only writer as 057/061 — awaiting it
  changes when it resolves, not what it does.
- The 061 tests still pass unchanged, including the ones that use a flush.

## Honest gaps

1. **Still not verified live.** This is the fourth attempt at this bug, and each previous
   one was reasoned from data and still incomplete. What is different here is a mechanism
   confirmed in the SDK source rather than inferred, and a test that needs no flush.
2. **onFinish's writes are still floating from the platform's point of view** — the citations
   and the real token count ride on it. If it is dropped, the row keeps its step-assembled
   text and its `:partial` marker. That is now a degraded row rather than no row.
3. **The underlying cause of Finder turns ending early is still unmeasured** — I cannot read
   their function logs.
