# Claim: quick-kayinleong-051
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: Finder dumps a raw JSON envelope when the agent asks a CONVERSATIONAL question about one project ("tell me about kensho taman desa, good for stay or rental"). Three causes: no conversational branch in the prompt, rationale rendered as plain text not markdown, and no graceful fallback when the envelope fails to decode.

## Symptom

"tell me about kensho taman desa, good for stay or rental" rendered as a fenced code block
containing `{"matches":[{"projectId":"…","rationale":"…"}]}`, cut off mid-string.

## Root causes

1. **No conversational branch in the Finder prompt.** The agent asked ABOUT one project,
   not FOR a set of matches, but the prompt admits only three shapes: matches, refusal,
   clarifyingQuestion. So the model does the only thing available — stuffs a full markdown
   essay into `matches[0].rationale`. That is a category error, not a formatting slip.
   Coach got a greetings branch in quick-046 and Reply got a "not an inbound" branch in
   quick-047; Finder never got the equivalent.

2. **quick-048 removed the graceful-degradation path.** Its "Return ONLY the bare JSON
   object" rule is correct for card rendering, but before it the model answered these
   questions in readable prose. Firestore confirms the change in behaviour: assistant
   turns stored on 2026-08-25 are prose ("Here are the key collateral files for **Kensho
   @ Taman Desa**…", `startsWithBrace=false`), whereas the reported turn is bare JSON.
   So a fix of mine made this specific case worse, and it needs the conversational branch
   to be safe.

3. **`match-list.tsx:175` renders `{rationale}` as PLAIN TEXT.** Even a successfully
   decoded card would show literal `**Own-Stay angle**` and collapse the model's `\n-`
   bullets, because the model legitimately writes structured prose there.

4. **No fallback when the envelope fails to decode.** The reported JSON is truncated
   mid-string, so `decodeFinderOutput` returns null and the raw text falls through to
   MarkdownMessage, which renders it as a code block. Nothing salvages it.

## Also observed (recorded, investigated separately)

- **The reported turn persisted NO assistant message.** Firestore has the user message
  (`routeDecision: finder:classifier:…`, 2026-08-26T07:22:41Z) with no assistant reply
  after it, even though the client clearly rendered tokens. Since quick-046 writes the
  user message BEFORE the model call, an orphan user message means `onFinish` never
  completed — the documented-but-accepted tradeoff from that claim. Needs its own
  investigation; not fixed here.
- **Truncation is independently confirmed by the model itself.** A stored assistant turn
  from 2026-08-25 opens: "Fair point. I had the analysis in the previous response but it
  got cut off." That is the agent apologising to the user for the quick-050 truncation
  bug, in production data.

## What will change

- `src/agents/finder/prompt.ts`: a conversational branch — when the agent asks about a
  specific known project rather than for matches, answer in prose, not the envelope.
- `app/[lang]/chat/match-list.tsx`: render `rationale` through MarkdownMessage.
- Client fallback: a finder turn whose content will not decode must not dump raw JSON.

## Verification

_(pending)_
