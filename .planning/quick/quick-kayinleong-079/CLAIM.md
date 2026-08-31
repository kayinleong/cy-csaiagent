# Claim: quick-kayinleong-079
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: quick-077's lead handoff threw a ReferenceError on every call, so the agent still got "Something went wrong" — and my own test gave false confidence

## What went wrong

The user reported the lead picker still does not open: DevTools shows
`{error: "leadId required for reply"}` and the toast reads "Something went wrong. Please try
again."

First I confirmed the fix is actually deployed — fetched `/en/chat` from Netlify with a real
session and searched all 17 client chunks for the marker string. **Present.** So this was my
code failing, not a stale build.

The bug, measured on the source:

```
  const assistantMsgId = ...   at char 14072
  m.id !== assistantMsgId      at char 13031   <-- 1041 chars EARLIER
```

quick-077's handler removed the "empty assistant placeholder" — but on a `!response.ok` path
the placeholder **has not been created yet**; it is declared after the error block. So the
reference sat in `assistantMsgId`'s temporal dead zone, threw `ReferenceError` on every
single call, and the outer `catch` turned it into the generic toast. The line was both
broken AND unnecessary.

**tsc did not catch it** because the reference is inside a `setMessages(prev => …)` callback,
and TypeScript cannot know when a callback runs, so TDZ is not a compile error there.

**My test did not catch it either, and that is the more important failure.** I asserted
`expect(INPUT).toMatch(/filter\(\(m\) => m\.id !== assistantMsgId\)/)` — a grep of the source.
It proved the line was PRESENT, which was never in doubt. It could not tell me the line
threw.

## What will change

1. Delete the line. There is no placeholder to remove at that point.
2. Replace the source-grep assertion with one that would actually have caught this: no
   identifier may be referenced before its `const` declaration in that handler.

## What has changed

**One line deleted** in `chat-input.tsx`, plus the comment explaining why it must not come
back. On a `!response.ok` path there is no assistant placeholder to remove — it is created
below the error block — so the line was broken and pointless at the same time.

**The test replaced with one that would have caught it.** The old assertion grepped the
source for the line. The new one strips comments and then compares POSITIONS: the first use
of `assistantMsgId` must be its own declaration.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1135 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### The guard was proven, not assumed
Reintroduced the exact bug and re-ran:

    × never touches assistantMsgId before it is declared
      AssertionError: assistantMsgId is used at 5399, before its declaration at 6035 —
      that is a temporal dead zone and throws at runtime

    tsc errors on chat-input: 0

The test fails and **tsc still passes** — which is the whole point. TypeScript cannot flag it
because the reference was inside a `setMessages(prev => …)` callback, and it has no way to
know when a callback runs.

Then restored the fix and confirmed 10/10 green.

### First I ruled out a stale deploy
Fetched `/en/chat` from Netlify with a real minted session and searched all 17 client chunks
for the marker string. **Present** — along with the quick-075/076 and quick-062 markers. So
the fix was live and failing, not missing.

### Swept for the same class of bug
Scanned every `const`/`let` in the file for a reference preceding its declaration (comments
and string literals stripped). Three hits, all noise from a scope-unaware scanner: `body`
matches the `body:` key in the fetch init, `text` and `t` match identifiers in other scopes.
`assistantMsgId` was the only real one.

## Honest gaps

1. **Still not clicked through.** Driving the modal needs a real Firebase CLIENT session and I
   only have a server cookie. What I can now say is that the handler no longer throws and the
   guard proves it stays that way — not that the whole flow works on screen.
2. **Two of your three testers will see an empty picker.** Measured: 1 lead exists, owned by
   `U9ZHLmgH…`. The other two agents who have chatted own none, so the sheet opens showing
   "No leads yet — add one before drafting a reply." (translated in all three locales). That
   is a clear dead end rather than a confusing one, but it is a dead end — they need a lead
   assigned before Reply can work for them.
3. **The lesson worth keeping**: a test that greps source text proves a line is PRESENT,
   which is rarely the thing in doubt. It cannot prove the line runs.
