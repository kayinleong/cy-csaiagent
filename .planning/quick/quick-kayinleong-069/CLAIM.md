# Claim: quick-kayinleong-069
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

`src/router/index.ts` — `classifyIntent()` is wrapped. On any throw, `routeAsync` returns
`{ pillar: 'coach', reason: 'classifier_unavailable' }` and logs the error NAME only (never
the provider's message, which carries account details).

'coach' is the same safe default the low-confidence branch already used (Pitfall 2 / D-01),
so this adds no new routing behaviour — only a new way to reach an existing one. The reason
lands in `routeDecision` (D-02), so a fallback-routed turn is distinguishable in the
transcript from one the classifier actually decided.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1081 passed**, 197 skipped, 0 failed (was 1077; **+4**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Tested end to end on the local dev server
Started the dev server, minted a real Firebase ID token for an existing agent uid
(`createCustomToken` -> Identity Toolkit `signInWithCustomToken`; the token and API key were
never printed), and POSTed real turns to `/api/chat`.

| | before | after |
|---|---|---|
| Auto mode (classifier throws) | **500, Content-Length 0** | **200 `text/event-stream`** in 766ms |
| persisted | nothing | user message, `rd=coach:classifier_unavailable` |

### Tests
The classifier throwing falls back to coach; the reason is observable as
`coach:classifier_unavailable`; a heuristic hit still wins so the fallback cannot mask
correct routing; and a manual override still wins with the classifier down.

### Regression surface
- **Only the throw path is new.** Success, below-threshold and above-threshold branches are
  untouched, and the 131 existing router tests pass unchanged.
- The heuristic runs BEFORE the classifier, so a Finder or Reply question with a clear
  keyword never reaches the fallback (pinned).
- Manual override still short-circuits everything (pinned).
- No provider text is logged.

## The actual blocker, which is NOT code

**The Anthropic account is out of credit.**

```
Error [AI_APICallError]: Your credit balance is too low to access the Anthropic API.
  at async classifyIntent (src/router/classifier.ts:89:22)
[chat] stream error { pillar: 'finder', name: 'AI_APICallError', ... }
[chat] turn produced no text; nothing persisted { pillar: 'finder', outcome: 'error' }
```

Both failure shapes trace to it, and neither is fixable in this repo:
- **Auto mode** — the classifier's call fails. This claim stops that being a blank 500.
- **Any mode** — the AGENT's own model call fails, so the stream opens and closes with zero
  text. The persistence machinery from 055/061/063 is behaving correctly by declining to
  write an empty bubble: **the reply is missing because there is no reply.**

## Corrections to what I told the user earlier

1. **It is not a Netlify function timeout.** I said that twice, in quick-067's claim and in
   my reply. The 500 reproduces locally in **1504ms**. The timing evidence I built that on
   (successful Finder turns reaching 21.0s, this request past 40s) was real but circumstantial,
   and I stopped at a hypothesis that fit instead of running the thing.
2. **quick-067's premise was wrong**, though the change itself is still worth having — one
   fewer model round trip is a genuine saving. Its claim overstates the diagnosis.
3. **The Finder-only loss pattern in quick-061 has a simpler explanation**: Finder turns make
   more model calls than Coach, so they were likelier to hit a failing provider.

## Honest gaps

1. **No AI reply is possible until the account is topped up.** Everything here makes the
   failure survivable and legible; it cannot make the model answer.
2. **Not re-tested after top-up** — the end-to-end run proves the 500 is gone and the turn
   opens, not that a full turn now completes.
3. **The router call requests `max_tokens: 128000` for a tiny classification** (visible in
   the logged request body). Wasteful and worth its own look; not the cause, so untouched.
