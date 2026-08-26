# Claim: quick-kayinleong-061
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
