# Claim: quick-kayinleong-048
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: done
- summary: A Finder turn shows NO loading indicator during its tool call (the bubble half-writes then freezes), its multi-step text runs together with no paragraph break ("Let me search now.The search returned"), and tool-use narration leaks as prose instead of the JSON envelope — so the MatchList card never renders.

## Context / Symptom

"Find me a 2-bedroom in Cheras, budget 800k" → after two clarifying rounds the final
bubble rendered:

  "Got it. Let me search now.The search returned results, but none are in Cheras and
   none are a clean 2-bedroom within RM800k from Cheras specifically. Let me identify
   the closest qualifying matches — ..."

User: "this message will stop at here without loading indicator, then only append the
rest of the message once it got the response. if u look into that whole message, it's
not properly formatted as well."

NOT a defect: the trailing half-sentence in the screenshot is simply where the stream had
reached (the user describes it appending afterwards) — not a truncation. No step-budget or
maxOutputTokens change is warranted.

Three real root causes:

1. **No indicator during a tool call.** `app/[lang]/chat/chat-shell.tsx:168-170` derives
   `isStreaming` as "last message is an assistant AND content === ''". The instant the
   first token lands, content is non-empty and the indicator disappears — so the entire
   `searchProjects` round-trip between step 1's text and step 2's text has no feedback at
   all. `useChatStream` (`chat-input.tsx:128`) owns the REAL streaming state and never
   propagates it upward, so chat-shell is guessing from message shape.

2. **Multi-step text concatenated with no separator.** In the AI SDK v5 UI Message
   Stream each step's text is its own block: `text-start` carries an `id`, and every
   `text-delta` carries that same `id` (`ai/dist/index.d.ts:1730-1736`).
   `parseTextDelta` (`decode-stream-chunk.ts`) ignores the id and returns only the
   delta, so the caller appends step 2's first token straight onto step 1's last
   character → "Let me search now.The search returned".

3. **Tool-use narration leaks and the card never renders.**
   `src/agents/finder/prompt.ts` has NO instruction against narrating tool use and no
   "return only the JSON object" rule — the same gap the Coach prompt had before
   quick-046. So the model emits conversational prose ("Got it. Let me search now.",
   "Let me identify the closest qualifying matches") instead of a clean FinderOutput
   envelope, `decodeFinderOutput` fails to parse it, and message-list falls back to a raw
   prose bubble instead of the MatchList card. Reply has the same gap.

## What will change

- `app/[lang]/chat/chat-input.tsx` + `chat-shell.tsx`: propagate the real `isStreaming`
  from the hook that owns it, replacing chat-shell's message-shape guess, so the
  indicator stays up for the whole turn including tool calls.
- `app/[lang]/chat/decode-stream-chunk.ts`: add a block-id-aware parser so a new text
  block after a tool call is separated by a paragraph break. `parseTextDelta` kept
  byte-identical for its existing tests.
- `src/agents/finder/prompt.ts` + `src/agents/reply/prompt.ts`: forbid tool-use narration
  and require the bare JSON object (no preamble, no code fence), mirroring the Coach
  output-contract fix from quick-046.
- Tests for all three.

## Scope added mid-claim (user re-raised)

The navigation-feedback request from 047 was sent again. Re-reading it against what 047
actually shipped surfaced two genuine gaps, so this claim completes that work rather than
declaring it done: (a) on mobile the sidebar is a **Sheet**, closed during navigation, so
047's inline spinner is invisible on a phone — and D2 agents are on phones; (b)
`home-surface.tsx` has its own `<Link>`s (two dashboard links + the quick-action tiles,
the main mobile nav path) with no indicator at all.

## What has changed

Two commits.

### 1. Finder streaming + formatting (`10705a5`)
- `chat-input.tsx` / `chat-shell.tsx`: new `onStreamingChange` lifts the REAL
  `isStreaming` out of `useChatStream`, replacing chat-shell's message-shape guess. The
  indicator now stays up for the whole turn, tool calls included.
- `decode-stream-chunk.ts`: new `parseTextChunk` keeps the text-block `id`, plus an
  exported `TEXT_BLOCK_SEPARATOR`. `chat-input` inserts a blank line ONLY at a block
  boundary — never mid-block (those newlines are the model's own formatting) and never at
  the start of a message.
- `src/agents/finder/prompt.ts` + `src/agents/reply/prompt.ts`: forbid tool-use narration,
  require the bare JSON object. `parseTextDelta` left byte-identical for its existing tests.

### 2. Global route progress bar (`b6d2b63`)
- New `app/[lang]/_components/route-progress.tsx` — `useLinkStatus`, portalled to
  `document.body`, wired into the sidebar links and all four home-surface links.
- `app/globals.css`: indeterminate sliding segment, 180 ms delay, `z-index: 60`.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **872 passed**, 197 skipped, 0 failed (was 860; +12), confirmed
  across **5 consecutive full runs** (an earlier single run under heavy machine load had
  shown transient failures; captured logs this time and none reproduced)
- `npx eslint app src` → **0 errors** (66 pre-existing warnings)
- `npm run build` → exit 0, 72 static pages
- Browser: the `route-progress` rule resolves to `position: fixed` / `top: 0` / full
  viewport width / `height: 2px` / `z-index: 60` / `opacity: 0` with `animation-delay:
  0.18s` and `fill-mode: forwards` / `pointer-events: none`, and the `::after` segment
  slides infinitely in the primary colour. Server log clean (only dev-only HMR websocket
  retries from the preview proxy).

### Regression surface audited
- **`isStreaming` has three consumers**, all re-checked: `MessageList`'s indicator, the
  hero-vs-list switch (`messages.length === 0 && !isStreaming`), and the input/send
  disabled state (which already used the hook's own real flag). Lifting the real value
  makes the derivation strictly more accurate — it can no longer latch on an empty
  assistant bubble, which was also half of quick-046's RC-3.
- **Separator insertion is boundary-only**, guarded on both "there is already content" and
  "the id actually changed", with tests for same-block deltas, three-step turns, and the
  never-open-with-a-blank-line case.
- **`parseTextDelta` untouched**, so its existing tests still pin the old behaviour; a new
  test asserts the two agree on the delta itself.
- **Prompt changes are additive** — tests assert the Finder grounding mandate and the
  Reply "Not an inbound message" branch from 047 both survive.
- **Portal choice is load-bearing**, not cosmetic: a plain `position: fixed` child of the
  mobile Sheet would anchor to the transformed drawer, not the viewport.

### Self-inflicted bug caught before commit
The narration rule originally contained a literal triple-backtick, which **terminated the
template literal** and broke both prompt files (29 + 30 tsc errors). Reverted both with
`git checkout` and re-applied describing the fence in prose instead. Recorded in the
commit message as a warning for future edits to those files.

### Honest gaps — NOT verified
1. **The progress bar and nav spinner actually appearing mid-navigation** need an
   authenticated session to reach the console. CSS, portal target and wiring are verified;
   the live behaviour is not.
2. **The Finder MatchList card rendering** depends on the model now emitting clean JSON —
   a prompt-level change, so model-dependent. The step-boundary and streaming fixes are
   deterministic and test-covered; the card is not.
3. **No `prefers-reduced-motion` emulation** was run; the reasoning is from reading the
   guard (it overrides duration and iteration-count but not delay), not observed.
