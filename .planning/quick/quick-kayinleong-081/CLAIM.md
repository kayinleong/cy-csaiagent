# Claim: quick-kayinleong-081
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: claimed
- summary: the chat header is unusable at 375px — the pillar tabs clip mid-word to "ach" and "Find"

## What is wrong

Driven at a real 375x812 viewport, signed in as a real agent. The header reads:

    [history] [D2] [AI]  ach    Find  [Talk to my coach]  [signout]

The pillar selector — the primary control on this surface, and this is a mobile-first
product — is clipped to fragments.

The cause is `justify-center` on a container that is also `overflow-x-auto`. When the content
is wider than the box, centring clips BOTH ends, which is exactly the "ach" / "Find" pattern.
Left-aligned overflow would at least start at "Auto" and scroll.

Space at 375px: history 32 + logo 32 + AI badge ~28 + "Talk to my coach" ~135 + sign-out 32 +
padding ~24 leaves roughly 70px for four tabs that need ~210.

Planned: left-align the overflow below `sm`, make "Talk to my coach" icon-only on mobile the
way sign-out already is, and tighten tab padding. Keep the AI badge — CHAT-05 requires it to
be persistent.

## Verification

_(pending)_
