# Claim: quick-kayinleong-075
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: hide Reply from the chat page — one flag governing the pillar tab and the hero card, so the two cannot disagree

## What will change

User: "in chat page, hide the reply mode, show only auto finder and coach".

Reply is surfaced to an agent in three places:
1. the pillar tab in `chat-header.tsx` (hard-coded JSX)
2. a hero suggestion card — `SUGGESTIONS` in `hero-empty-state.tsx` includes
   `{ key: 'reply', pillar: 'reply' }`, which PINS the Reply pillar when tapped
3. Auto-routing — both `heuristic.ts` (regexes for "draft a reply", "what should I say")
   and the LLM classifier can pick Reply on their own

Planned: hide **1 and 2** behind a single exported flag. Hiding the tab while leaving a
tappable Reply card on the empty state would contradict the request outright.

**Leaving 3 alone, deliberately.** Changing what the router is allowed to choose is a
behaviour change to the routing layer, not a UI one, and it would mean rewriting the
heuristic and classifier tests that currently pin Reply routing — weakening the suite for a
pillar that is meant to come back. Flagged in the report rather than decided silently.

Worth knowing when deciding on 3: Reply has **0 kbChunks** (measured in quick-066), so any
turn that does reach it answers `no_sop_match`.

## What has changed

**`REPLY_PILLAR_ENABLED = false`** in `chat-header.tsx`, read by every surface that offers
Reply so they cannot disagree:

- the **pillar tab** — wrapped, not deleted. The pillar is fully built (schema, agent, route
  dispatch, ReplyDraftCard, lead-selector wiring) and deleting the JSX would lose that
  plumbing; bringing it back is a one-line flip.
- the **hero suggestion card** — filtered out of `SUGGESTIONS`. Tapping a card PINS its
  pillar, so leaving it would have given agents a one-tap route into a mode the header says
  does not exist.
- the **hero subtitle** — a third surface I did not expect to find. It read *"Or paste a
  client message and I'll draft a reply in your voice"*, a pitch for a mode they can no
  longer pick. Now swaps to a `heroSubtitleNoReply` variant.

The variant is the original sentence with the Reply clause **removed**, in all three
locales — a deletion, not prose I invented in a language I cannot check:

    en  Ask about D2 projects, sales SOPs, or your onboarding journey.
    ms  Tanya tentang projek D2, SOP jualan, atau perjalanan onboarding anda.
    zh  询问 D2 项目、销售 SOP 或你的入职培训旅程。

`PillarOverride` still includes `'reply'`, so the server keeps accepting it.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1125 passed**, 197 skipped, 0 failed (was 1118; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Seen in a real browser
Loaded `/en/chat` with a minted session:
- tabs read **Auto · Coach · Finder** — no Reply
- subtitle reads "Ask about D2 projects, sales SOPs, or your onboarding journey."
- three cards: Finder, Coach, Coach — the "Draft: loan eligibility…" card is gone

A first attempt to verify by grepping the HTML gave a FALSE PASS on the cards:
`NextIntlClientProvider` ships the whole message catalog to the client, so every string
appears in the markup whether or not it is rendered. Caught it by looking at the page.

### Regression surface
- **Nothing about Reply is removed** — agent, schema, route dispatch, ReplyDraftCard,
  lead-selector and the `reply` i18n keys are all untouched.
- The other three tabs are unconditional (pinned by a test).
- `heroSubtitle` is left in place, so flipping the flag restores the original copy.
- Tests pin: the flag is off; the tab is GATED rather than deleted; the hero card uses the
  same flag; the subtitle swaps; every locale has the variant, none of them mention a reply,
  and each is a prefix of the original — which is what makes it a deletion.

## Honest gaps — one needs your decision

1. **Auto can still route to Reply.** `src/router/heuristic.ts` matches "draft a reply",
   "what should I say", "how should I respond", and the LLM classifier lists Reply as a
   choice. So an agent who pastes a client message in Auto can still land on a Reply card
   even though the mode is hidden.

   I left this deliberately: it is a routing change, not a UI one, and it would mean
   rewriting the heuristic and classifier tests that pin Reply routing — weakening the suite
   for a pillar meant to come back. **Worth knowing when you decide: Reply has 0 kbChunks
   (measured in quick-066), so a turn that reaches it answers `no_sop_match`.** Say the word
   and I will gate the router behind the same flag.

2. **Not checked in BM or 中文 in the browser** — the strings are verified by test, but I
   did not load the page in those locales.

3. **`/en/leads` and the admin Reply surfaces are untouched** — this claim is the chat page
   only, as asked.
