# Claim: quick-kayinleong-080
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: done
- summary: the lead sheet never opened because ChatInput silently dropped the prop — found by finally driving a real browser session instead of grepping source

## What was wrong

`chat-input.tsx` has TWO components: `useChatStream`, which does the work, and `ChatInput`,
which wraps it and **hand-lists** the props it forwards.

quick-077 added `onLeadRequired` to `ChatInputProps`, to `useChatStream`'s signature, and to
the shell's JSX — three places, all greppable, all asserted, all passing — but never to
`ChatInput`'s forwarding list. The prop reached `ChatInput` and stopped. `useChatStream` read
`undefined`, the `&& onLeadRequired` guard fell through, and the agent got the generic toast.

tsc cannot see it: an optional prop that is simply not destructured is legal.

## How I finally found it

I had been reasoning about this for three attempts because I could not sign in. The way
through was `signInWithCustomToken` from the page: mint a custom token with the Admin SDK,
load the Firebase SDK from a CDN in the browser, sign in for real. That writes to the same
IndexedDB the app reads, so the app came up fully authenticated as a real agent.

Then a single `console.log` in the branch settled it in one run:

    [DEBUG-079] 400 branch { error: 'leadId required for reply',
                             expected: 'leadId required for reply',
                             matches: true, hasCallback: undefined }

`matches: true, hasCallback: undefined`. No more guessing.

## What has changed

- `ChatInput` now forwards `onLeadRequired` into `useChatStream`.
- A guard that compares the two lists: every prop in `useChatStream`'s
  `Pick<ChatInputProps, …>` must appear in the `= useChatStream({…})` call.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1136 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Driven end to end in a browser, as a signed-in agent
1. Auto mode, typed "The lead said the price is too high, what should I reply?"
2. **The lead sheet opened** — "Which lead?", search field, Recent leads.
3. Picked the lead -> the message **re-sent by itself** (second bubble).
4. A grounded draft streamed back and rendered as readable prose.

### The guard was proven, twice, and the first version was wrong
Removing the forwarding must fail the test. On the first attempt it did NOT: my regex
`useChatStream\(\{…\}\)` matched the hook's own DECLARATION, so the check compared the prop
list against itself and could never fail. Anchoring on `= useChatStream({` fixed it, and now:

    × ChatInput FORWARDS every prop useChatStream asks for
      AssertionError: ChatInput does not forward: onLeadRequired

    tsc errors: 0

## The pattern worth naming

Three bugs in a row in this one feature, and **every one of them passed a test I had written**:

| claim | bug | the test that missed it |
|---|---|---|
| 077 | TDZ `ReferenceError` | grepped that the line was PRESENT |
| 079 | prop never forwarded | grepped that the prop was PRESENT in three files |
| 080 (first try) | guard compared a list to itself | I did not run it against the bug |

Grepping source proves a line EXISTS. That is almost never the thing in doubt. Two habits
came out of this and are worth keeping: **verify a guard by reintroducing the bug**, and
**for a client-side flow, drive a real browser** — the custom-token sign-in above makes that
possible in about a minute.

## Honest gaps

1. **The draft rendered as prose, not the ReplyDraftCard.** The envelope was truncated so
   quick-051's salvage produced readable text instead. Correct degradation, but the card is
   the intended surface — worth a look.
2. **Only the objection-handling path was exercised**, with the one lead that exists.
3. **No jsdom harness.** These guards are still static analysis of source text; they are
   sharper than a grep but they do not execute the component.
