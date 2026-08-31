# Claim: quick-kayinleong-075
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
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

## Verification

_(pending)_
