# Claim: quick-kayinleong-051
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: done
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

## What has changed

One commit (`ebfe715`).

- `src/agents/finder/schema.ts`: new optional `answer` — a conversational markdown reply.
- `src/agents/finder/prompt.ts`: an "Answering a question ABOUT a project" section placed
  BEFORE the output format, so the model reads it before being told the only shapes are
  matches/refusal/clarifyingQuestion. Grounding still mandatory on that path; the four
  output states are declared mutually exclusive.
- `app/[lang]/chat/match-list.tsx`: `rationale` and the new `answer` both render through
  MarkdownMessage.
- `app/[lang]/chat/decode-structured-output.ts`: `answer` counts as a populated state, and
  new `salvageStructuredText()` recovers readable prose from a broken envelope.
- Salvage wired into both the live path (`chat-input.tsx`) and history
  (`conversation-messages-map.ts`).

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **969 passed**, 197 skipped, 0 failed (was 953; **+16**)
- `npx eslint app src` → **0 errors**
- `npm run build` → exit 0

### What the new tests pin
- Salvage recovers `answer` and `rationale` from a truncated envelope, decodes `\n` and
  `\"` rather than returning them literally, does not stop early on an escaped quote,
  tolerates a leading code fence, prefers `answer` over `rationale`, and returns null for
  ordinary prose or an empty value rather than inventing text.
- `decodeFinderOutput` treats an answer-only output as populated, while a genuinely empty
  `{matches: []}` is still rejected.
- The prompt branch precedes `## Output Format`, forbids essays in a rationale, keeps
  grounding, and declares exclusivity.
- **The Finder prompt contains no backtick.** I broke that file this way in quick-048,
  wrote a warning about it in that commit, and then repeated it here. The suite now catches
  it instead of tsc after the fact.

### Regression surface
- `FinderOutput.answer` is OPTIONAL, so every existing output shape still parses and every
  existing test passes unchanged.
- `MatchList` gains a state ahead of the matches branch; the refusal, clarifying-question
  and empty branches are untouched.
- Salvage only fires when a decode has ALREADY failed and the content starts with `{`, so
  ordinary prose turns are never touched.
- `decodeFinderOutput`'s populated-check widened, never narrowed — nothing that decoded
  before stops decoding.

## Honest gaps — NOT verified

1. **No live model call.** Whether the model actually uses `answer` for a conversational
   question is prompt-dependent and unproven. The salvage path is the deterministic
   backstop if it does not.
2. **No authenticated click-through** — the rendered markdown card is unverified in a
   browser.
3. **The orphan-turn bug is untouched** (see below) and could still produce a turn that
   never persists.

## Carried

- **The reported turn persisted NO assistant message** — user message at
  2026-08-26T07:22:41Z with no reply after it. Needs its own claim.
- Truncation confirmed in production data by the model's own words ("I had the analysis in
  the previous response but it got cut off"), from before the quick-050 fix.
