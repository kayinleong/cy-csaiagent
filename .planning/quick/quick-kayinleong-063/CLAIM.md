# Claim: quick-kayinleong-063
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
