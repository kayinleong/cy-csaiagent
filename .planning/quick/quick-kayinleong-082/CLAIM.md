# Claim: quick-kayinleong-082
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: claimed
- summary: the pillar tabs still clip below ~360px — stop tuning breakpoints and let the strip wrap to its own row

## What is wrong

quick-081 fixed 375px. The user reports it "still same", so I checked narrower.

First I confirmed the fix is actually live: the deployed CSS bundle
(`/_next/static/chunks/10jj-ozcgfds8.css`, 176 KB) contains both `sm:justify-center` and
`85vw`. My earlier probe said ABSENT because it looked in `/_next/static/css/` — Next puts
CSS under `/_next/static/chunks/`. The probe was wrong, not the deploy.

At **320x700**, signed in as a real agent:

    [history] [AI]  Auto  Coach  Finde|  (*)  [signout]

"Finder" is cut mid-word and Reply is off-screen entirely. Same class of failure as before,
just at a narrower width — which means quick-081 bought one breakpoint, not a fix.

## What will change

Stop trading header items against tab space. Let the container **wrap**, so on narrow screens
the tab strip takes its own full-width row and always fits at any width. One render, pure
CSS, no duplicated ARIA.

## Verification

_(pending)_
