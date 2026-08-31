# Claim: quick-kayinleong-079
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
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

## Verification

_(pending)_
