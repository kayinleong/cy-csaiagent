# Claim: quick-kayinleong-061
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: lost replies are 100% Finder and onFinish never runs — persist the assistant text incrementally so a killed process cannot take the whole turn with it

## What will change

User: "the chat history save text, but does not save json response and that is why it
cannot show ai replies". Measured against live Firestore, and they are pointing at something
real that my 055/057 framing missed entirely:

| pillar | user | assistant | deficit |
|---|---|---|---|
| finder | 67 | 42 | **25** |
| coach  | 24 | 24 | 0 |
| reply  |  4 |  4 | 0 |

Every lost thread is `pillar=finder`. Coach and Reply have never lost one.

And the decisive split — `usageEvents` is written at the END of onFinish:

| pillar | usageEvents | assistant msgs | gap |
|---|---|---|---|
| finder | 41 | 42 | ~0 |

The gap is ~0, so **onFinish never ran** for the 25 lost turns. There are also **zero**
`:error` / `:aborted` markers, so onError and onAbort did not run either. No callback fires
at all — consistent with the process being killed (Netlify function timeout). Successful
Finder turns reach 21.0s; Coach tops out at 11.6s.

Of the 42 Finder replies that DID store, only 2 are JSON envelopes and 40 are prose — the
heavy tool-loop turns are the ones dying, exactly as reported.

Planned: write the assistant message from `onStepFinish`, not only at the end. No callback
can be relied on, so the text must already be on disk before the process dies.

## What has changed

`app/api/chat/route.ts` only. One line does the work; the rest is making it safe.

- **`onStepFinish` now calls `persistAssistantOnce(turnText.join(...), 'partial')`.** The
  text is on disk at every step boundary instead of only at the end.
- Deliberately **NOT** `after()` — that defers until the response is sent, which is exactly
  too late. A plain floating call starts the write immediately, while the process is alive.
- A new `'partial'` outcome is recorded in `routeDecision` (D-02). A row still marked
  `:partial` means the process died mid-turn — which makes the failure OBSERVABLE for the
  first time, in the app and in Firestore.
- `persistedOutcome` lets a `:partial` row be **finalised even when the text did not grow**,
  or a turn ending on its last step would stay flagged interrupted forever. Terminal-to-
  terminal is deliberately NOT an exception, so a short `onFinish` payload still cannot
  truncate a longer stored reply.
- The empty-text warning is suppressed for `'partial'`; a tool-only step legitimately has no
  text and would log on every healthy Finder turn.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1042 passed**, 197 skipped, 0 failed (was 1038; **+4**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### The evidence this was built from
| pillar | user | assistant | deficit | usageEvents | gap |
|---|---|---|---|---|---|
| finder | 67 | 42 | **25** | 41 | ~0 |
| coach  | 24 | 24 | 0 | 24 | 0 |
| reply  |  4 |  4 | 0 | 4 | 0 |

`usageEvents` is written at the END of onFinish, so a gap of ~0 means **onFinish never ran**.
Zero `:error` / `:aborted` markers means onError and onAbort did not run either. No callback
fires at all. Successful Finder turns reach 21.0s wall-clock, Coach 11.6s, and of the 42
stored Finder replies only 2 are JSON envelopes while 40 are prose — the heavy tool-loop
turns are the ones dying.

### What the tests pin
Step-1 text persists when NO callback ever fires (the reported failure, and the one thing
quick-055 and quick-057 could not do); steps extend ONE row rather than appending per step;
a completed turn ends with the `:partial` marker cleared; a tool-only step writes nothing.

### Regression surface
- **Write volume:** one append plus up to four updates per turn, bounded by
  `stopWhen: stepCountIs(5)`. Small documents, and the reply is worth more than the writes.
- **Three existing tests changed** because they asserted the WRITE PATTERN (call counts on
  append) rather than the end state. Each was re-pointed at the final stored value, and each
  still asserts the same guarantee: the marker ends `:error`, one row holds the complete
  text, a shorter payload never truncates. No assertion was weakened to pass.
- The normal path still ends with the authoritative `fullTurnText`, real citations and the
  real token count.

## Honest gaps

1. **The CAUSE is still not proven.** "No callback fires" points hard at the process being
   killed — a Netlify function timeout is the obvious candidate at 21s+ — but I cannot read
   their function logs, so this is a strong inference, not a measurement. What this claim
   changes is that the cause no longer has to be known for the reply to survive.
2. **A killed turn still loses the LAST step**, which for Finder is usually the JSON
   envelope itself. The agent gets the narration and any earlier prose, not the ranked card.
   Better than an empty thread; not the whole answer.
3. **Not verified live** — no authenticated session to reproduce a timing-out Finder turn.
4. **The real cure is making Finder turns faster** (fewer steps, smaller tool payloads).
   quick-054 cut collateral 98%; the step budget of 5 model round trips is the remaining
   cost and is untouched here.
