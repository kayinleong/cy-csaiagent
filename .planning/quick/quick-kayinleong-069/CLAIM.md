# Claim: quick-kayinleong-069
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: the LLM router throwing takes the whole turn down with a blank 500 — a classifier is an optimisation, its failure must not be fatal

## What will change

**I was wrong about the timeout, and I said it twice.** Ran the chat end to end on the local
dev server with a real minted Firebase ID token, and read the server logs:

```
Error [AI_APICallError]: Your credit balance is too low to access the Anthropic API.
    at async classifyIntent (src/router/classifier.ts:89:22)
    at async routeAsync (src/router/index.ts:83:26)
    at async POST (app/api/chat/route.ts:490:20)
POST /api/chat 500 in 1504ms
```

**The Anthropic account is out of credit.** 1504ms, not 40 seconds. Two shapes:

| mode | path | result |
|---|---|---|
| **Auto** | heuristic misses -> LLM classifier -> billing 400 -> **unhandled throw** | **500, empty body** — the DevTools capture |
| **Manual pillar** | classifier skipped -> 200 SSE opens -> the AGENT's model call fails | stream ends with 0 text, `onError` fires, nothing persisted |

Logs from the manual run:
```
[chat] stream error { pillar: 'finder', name: 'AI_APICallError', message: 'Your credit balance is too low...' }
[chat] turn produced no text; nothing persisted { pillar: 'finder', outcome: 'error' }
```

So the persistence machinery from 055/061/063 is behaving correctly — it declines to write an
empty bubble. The reply is missing because **there is no reply**.

Topping up the Anthropic account is the fix, and only the account owner can do it. What IS a
real code defect: an unhandled throw in the ROUTER kills the turn with a blank 500.

Planned: the router degrades instead of throwing. A classifier is an optimisation over the
heuristic; its failure should cost routing accuracy, not the turn.

## Verification

_(pending)_
